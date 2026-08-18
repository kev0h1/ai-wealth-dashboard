"""Grocery receipt scanning → itemised shopping baskets.

A photo of a receipt is sent to a vision LLM (via OpenRouter) which extracts
normalised line items. We store the structured result per-user and discard the
raw image — the parsed JSON is the asset, both for the user's own itemised
spend / price history and (later) a crowd-sourced price catalogue.
"""
import re
import json
import uuid
import logging
from datetime import datetime

import httpx
from fastapi import APIRouter, Depends, HTTPException

from app.core.auth import current_user
from app.core.config import OPENROUTER_API_KEY, OPENROUTER_PROVIDER_PREFS
from app.core.subscription import check_scan_limit, increment_scan_usage
from app.db.collections import shopping_baskets_col

router = APIRouter(tags=["baskets"])

VISION_MODEL = "anthropic/claude-haiku-4-5"

ITEM_CATEGORIES = [
    "Produce", "Dairy & Eggs", "Meat & Fish", "Bakery", "Frozen", "Pantry",
    "Drinks", "Snacks", "Household", "Health & Beauty", "Alcohol", "Other",
]

_PROMPT = (
    "You are transcribing a photo of a grocery shopping receipt. Every item you "
    "output must be text you can actually see printed on the receipt.\n\n"
    "CRITICAL — read before extracting anything:\n"
    "Never invent, guess, infer, or complete a 'typical' or 'plausible' shopping "
    "basket for this type of store. Do not add an item because it seems like the "
    "kind of thing this shop would sell, or to round out a category. Every single "
    "item in your output must correspond to a specific line of printed text you "
    "can point to on the receipt. If the photo is blurry, cropped, glared-out, or "
    "you are not confident you are reading actual printed text, it is CORRECT and "
    "EXPECTED to return fewer items — including zero — rather than fabricate ones. "
    "Returning an empty items array is a completely normal, successful outcome for "
    "an unclear photo. Fabricating even one plausible-looking item that isn't "
    "really printed on the receipt is a serious failure, worse than returning "
    "nothing.\n\n"
    "Return ONLY a JSON object, no prose, with this exact shape:\n"
    "{\n"
    '  "shop": string|null,            // store/brand name, e.g. "Tesco" — only if legible\n'
    '  "purchased_at": string|null,    // ISO date YYYY-MM-DD if present\n'
    '  "currency": string,             // ISO code, default "GBP"\n'
    '  "total": number|null,           // grand total paid, only if legible\n'
    '  "items": [\n'
    '    {\n'
    '      "name": string,             // product name as printed; expand obvious abbreviations only\n'
    '      "qty": number,              // quantity, default 1\n'
    '      "unit_price": number|null,  // price per unit, only if legible\n'
    '      "line_price": number|null,  // total for this line, only if legible\n'
    f'      "category": string         // one of: {", ".join(ITEM_CATEGORIES)}\n'
    '    }\n'
    '  ]\n'
    "}\n"
    "Other rules: exclude non-product lines (subtotals, savings, card/cash, "
    "change, loyalty points, store address). Numbers must be plain numerics with "
    "no currency symbols. If a value on an otherwise-legible item is unreadable, "
    "use null for that field — but only include the item at all if its name is "
    'genuinely visible. If this is not a receipt, return {"shop": null, "items": []}.'
)


def _data_uri(image: str) -> str:
    """Accept a data URI as-is, or wrap bare base64 as a JPEG data URI."""
    image = (image or "").strip()
    if image.startswith("data:"):
        return image
    return f"data:image/jpeg;base64,{image}"


def _num(v):
    try:
        return round(float(v), 4) if v is not None else None
    except (TypeError, ValueError):
        return None


def _clean_items(raw_items) -> list[dict]:
    items = []
    for it in (raw_items or []):
        if not isinstance(it, dict):
            continue
        name = (it.get("name") or "").strip()
        if not name:
            continue
        cat = it.get("category") if it.get("category") in ITEM_CATEGORIES else "Other"
        qty = _num(it.get("qty")) or 1
        items.append({
            "name": name[:120],
            "qty": qty,
            "unit_price": _num(it.get("unit_price")),
            "line_price": _num(it.get("line_price")),
            "category": cat,
        })
    return items


def _serialize(doc: dict) -> dict:
    return {
        "id": doc["_id"],
        "shop": doc.get("shop"),
        "purchased_at": doc.get("purchased_at"),
        "date_estimated": doc.get("date_estimated", False),
        "currency": doc.get("currency", "GBP"),
        "total": doc.get("total"),
        "item_count": doc.get("item_count", 0),
        "items": doc.get("items", []),
        "created_at": doc.get("created_at").isoformat() if doc.get("created_at") else None,
    }


async def _extract_receipt(image_uri: str) -> dict:
    """Call the vision LLM and return parsed {shop, purchased_at, currency, total, items}."""
    async with httpx.AsyncClient(timeout=60) as http:
        r = await http.post(
            "https://openrouter.ai/api/v1/chat/completions",
            headers={"Authorization": f"Bearer {OPENROUTER_API_KEY}"},
            json={
                "model": VISION_MODEL,
                "max_tokens": 2000,
                "temperature": 0,
                "messages": [
                    {"role": "system", "content": _PROMPT},
                    {"role": "user", "content": [
                        {"type": "text", "text": "Extract this receipt."},
                        {"type": "image_url", "image_url": {"url": image_uri}},
                    ]},
                ],
                "provider": OPENROUTER_PROVIDER_PREFS,
            },
        )
    data = r.json()
    if "choices" not in data:
        logging.warning("Receipt scan: no choices in response: %s", str(data)[:300])
        raise HTTPException(502, "Couldn't read the receipt, please try again.")
    raw = data["choices"][0]["message"]["content"].strip()
    if raw.startswith("```"):
        raw = re.sub(r"^```(?:json)?\s*", "", raw)
        raw = re.sub(r"\s*```\s*$", "", raw).strip()
    m = re.search(r"\{.*\}", raw, re.DOTALL)
    if not m:
        raise HTTPException(422, "Couldn't read that receipt, try a clearer photo.")
    try:
        return json.loads(m.group())
    except json.JSONDecodeError:
        raise HTTPException(422, "Couldn't read that receipt, try a clearer photo.")


@router.post("/baskets/scan-receipt")
async def scan_receipt(body: dict, user: dict = Depends(current_user)):
    image = body.get("image")
    if not image:
        raise HTTPException(400, "Missing image")
    await check_scan_limit(user["email"])

    parsed = await _extract_receipt(_data_uri(image))
    items = _clean_items(parsed.get("items"))
    if not items:
        raise HTTPException(422, "No items found, make sure the whole receipt is in shot.")

    # No legible date on the receipt: fall back to the scan date, flagged as
    # estimated so the UI can say so instead of showing "Date unknown".
    purchased_at   = parsed.get("purchased_at") or None
    date_estimated = purchased_at is None
    if date_estimated:
        purchased_at = datetime.now().strftime("%Y-%m-%d")

    doc = {
        "_id": uuid.uuid4().hex,
        "user_id": user["email"],
        "shop": (parsed.get("shop") or None),
        "purchased_at": purchased_at,
        "date_estimated": date_estimated,
        "currency": (parsed.get("currency") or "GBP"),
        "total": _num(parsed.get("total")),
        "item_count": len(items),
        "items": items,
        "created_at": datetime.now(),
    }
    await shopping_baskets_col.insert_one(doc)
    await increment_scan_usage(user["email"])
    return _serialize(doc)


_CURRENCY_SYMBOLS = {"GBP": "£", "EUR": "€", "USD": "$"}

# Tokens that describe size/packaging rather than the product itself.
_SIZE_RE = re.compile(
    r"\b\d+(\.\d+)?\s?(g|kg|mg|ml|l|cl|oz|lb|pk|pack|ct|pt|pints?|litres?|"
    r"grams?|kilos?|kilograms?|millilitres?|count|sheets?|rolls?|bags?)\b",
    re.I,
)
_PACK_RE = re.compile(r"\bx\s?\d+\b", re.I)
_NUM_RE = re.compile(r"\d+(\.\d+)?")


def _norm_name(name: str) -> str:
    """Collapse a raw item name to a grouping key, dropping size/pack tokens."""
    s = (name or "").lower()
    s = _PACK_RE.sub(" ", s)
    s = _SIZE_RE.sub(" ", s)
    s = _NUM_RE.sub(" ", s)
    s = re.sub(r"[^a-z ]", " ", s)
    s = re.sub(r"\s+", " ", s).strip()
    return s


def _unit_price(it: dict):
    up = it.get("unit_price")
    if isinstance(up, (int, float)) and up > 0:
        return round(float(up), 2)
    lp = it.get("line_price")
    qty = it.get("qty") or 1
    if isinstance(lp, (int, float)) and lp > 0 and qty:
        return round(float(lp) / qty, 2)
    return None


def _obs_date(doc: dict):
    pa = doc.get("purchased_at")
    if pa:
        try:
            return datetime.fromisoformat(str(pa)[:10]).date().isoformat()
        except ValueError:
            pass
    ca = doc.get("created_at")
    return ca.date().isoformat() if ca else None


def _compute_insights(docs: list[dict]) -> dict:
    # key -> { name, dates: {date: (price, store)}, stores: {store: (date, price)} }
    groups: dict[str, dict] = {}
    currency = "GBP"
    for doc in docs:
        currency = doc.get("currency") or currency
        store = (doc.get("shop") or "Unknown").strip()
        date = _obs_date(doc)
        for it in doc.get("items", []):
            key = _norm_name(it.get("name", ""))
            price = _unit_price(it)
            if not key or price is None or not date:
                continue
            g = groups.setdefault(key, {"name": it["name"], "dates": {}, "stores": {}})
            g["name"] = it["name"]
            # cheapest price seen that day for this item
            prev = g["dates"].get(date)
            if prev is None or price < prev[0]:
                g["dates"][date] = (price, store)
            # latest price per store
            s_prev = g["stores"].get(store)
            if s_prev is None or date >= s_prev[0]:
                g["stores"][store] = (date, price)

    sym = _CURRENCY_SYMBOLS.get(currency, currency + " ")

    item_trends = []
    for key, g in groups.items():
        dated = sorted(g["dates"].items())  # [(date, (price, store))]
        if len(dated) < 2:
            continue
        (_, (prev_price, _)), (last_date, (latest_price, store)) = dated[-2], dated[-1]
        if prev_price <= 0:
            continue
        pct = round((latest_price - prev_price) / prev_price * 100, 1)
        item_trends.append({
            "key": key, "name": g["name"], "latest": latest_price,
            "previous": prev_price, "pct_change": pct, "currency": currency,
            "store": store, "date": last_date,
        })

    store_prices = []
    for key, g in groups.items():
        if len(g["stores"]) < 2:
            continue
        by_price = sorted(g["stores"].items(), key=lambda kv: kv[1][1])  # by price asc
        cheap_store, (_, cheap_price) = by_price[0]
        dear_store, (_, dear_price) = by_price[-1]
        saving = round(dear_price - cheap_price, 2)
        if saving <= 0:
            continue
        store_prices.append({
            "key": key, "name": g["name"], "cheapest_store": cheap_store,
            "cheapest_price": cheap_price, "dearest_store": dear_store,
            "dearest_price": dear_price, "saving": saving, "currency": currency,
        })

    item_trends.sort(key=lambda t: abs(t["pct_change"]), reverse=True)
    store_prices.sort(key=lambda s: s["saving"], reverse=True)

    headline = None
    total_saving = round(sum(s["saving"] for s in store_prices), 2)
    if len(store_prices) >= 2 and total_saving >= 2:
        # Aggregate beats single-item trivia: "your basket" not "your salmon"
        top = store_prices[0]
        headline = (
            f"{len(store_prices)} of your regular items are {sym}{total_saving:.2f} cheaper elsewhere. "
            f"Biggest: {top['name']} at {top['cheapest_store']}"
        )
    elif len(docs) < 5:
        # Single-item callouts from a handful of receipts are trivia, not insight
        headline = "Scan more receipts to compare your prices across stores"
    elif store_prices and store_prices[0]["saving"] >= 2:
        s = store_prices[0]
        headline = f"{s['name']} is {sym}{s['saving']:.2f} cheaper at {s['cheapest_store']}"
    elif item_trends:
        t = item_trends[0]
        if t["pct_change"]:
            arrow = "up" if t["pct_change"] > 0 else "down"
            headline = f"{t['name']} {arrow} {abs(t['pct_change']):.0f}% since last time"

    return {
        "receipt_count": len(docs),
        "item_trends": item_trends[:8],
        "store_prices": store_prices[:8],
        "headline": headline,
    }


@router.get("/baskets/insights")
async def basket_insights(user: dict = Depends(current_user)):
    docs = await shopping_baskets_col.find(
        {"user_id": user["email"]}
    ).sort("created_at", -1).to_list(200)
    return _compute_insights(docs)


@router.get("/baskets")
async def list_baskets(user: dict = Depends(current_user)):
    docs = await shopping_baskets_col.find(
        {"user_id": user["email"]}
    ).sort("created_at", -1).to_list(100)
    return [_serialize(d) for d in docs]


@router.get("/baskets/{basket_id}")
async def get_basket(basket_id: str, user: dict = Depends(current_user)):
    doc = await shopping_baskets_col.find_one({"_id": basket_id, "user_id": user["email"]})
    if not doc:
        raise HTTPException(404, "Basket not found")
    return _serialize(doc)


@router.delete("/baskets/{basket_id}")
async def delete_basket(basket_id: str, user: dict = Depends(current_user)):
    res = await shopping_baskets_col.delete_one({"_id": basket_id, "user_id": user["email"]})
    if res.deleted_count == 0:
        raise HTTPException(404, "Basket not found")
    return {"ok": True}
