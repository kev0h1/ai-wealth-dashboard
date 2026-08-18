"""Card terms capture — phase 1 of the debt planner.

Open-banking AIS never provides card terms (APR, promo rate windows, BT
offers), so terms are ASKED and the user's answer is the truth. We prefill
with the product's publicly advertised REPRESENTATIVE rate (FCA 51% rule:
representative ≠ the user's actual rate — responses carry that distinction
so the frontend can phrase honestly). The user confirms or corrects, and
the user owns their corrections (BEHAVIOURS.md).

A card can carry multiple concurrent promo windows (e.g. 0 % purchases
until one date AND 0 % balance transfers until another). These are stored
as a list under the ``promos`` key. Legacy docs that still carry the flat
on_promo/promo_kind/promo_end shape are mapped on read; they are fully
migrated to the new shape on the next user-initiated save.
"""
from datetime import date, datetime
from typing import Literal, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app.core.auth import current_user
from app.db.collections import accounts_col, card_terms_col
from app.services import response_cache
from app.services.card_rates import (
    derive_product_identity,
    is_ask_eligible,
    is_credit_card_account,
    lookup_product_rate,
)

router = APIRouter(tags=["card-terms"])

# Honest phrasing hook for the frontend — a product's advertised figure, not
# the user's own rate.
_RATE_NOTE = (
    "Representative APR: the advertised rate at least 51% of accepted "
    "applicants get. Yours may be different; you can correct it."
)


def _clean(s) -> str:
    return " ".join(str(s or "").split())


class BtOffer(BaseModel):
    ends: Optional[str] = None      # ISO date
    fee_pct: Optional[float] = None
    note: Optional[str] = None


class CardPromo(BaseModel):
    kind: Literal["purchases", "balance_transfer", "both"]
    apr_pct: float = 0.0
    until: Optional[str] = None   # ISO date — required, validated in _normalise_promos


async def _user_credit_cards(uid: str) -> list[dict]:
    """Every credit-card account for this user — TrueLayer and Finexer rows
    both live in accounts_col (unified collections)."""
    raw = await accounts_col.find({"user_id": uid}).to_list(None)
    return [a for a in raw if is_credit_card_account(a)]


def _promos_from_legacy(on_promo, promo_kind, promo_end) -> list[dict]:
    """Map the old flat promo triple into the new promos list format.

    Used both on read (legacy docs) and when an old client POSTs the flat
    fields. A missing promo_kind falls back to "purchases" — the old form
    required a kind before saving, so a missing value is a near-impossible
    edge case; "purchases" is the most conservative claim.
    """
    if on_promo and promo_end:
        return [{"kind": promo_kind or "purchases", "apr_pct": 0.0, "until": promo_end}]
    return []


def _serialize_terms(doc: dict | None) -> dict | None:
    if not doc:
        return None
    confirmed_at = doc.get("confirmed_at")
    # New shape wins; legacy docs are mapped on read — legacy keys are NOT
    # forwarded to callers.
    stored_promos = doc.get("promos")
    if isinstance(stored_promos, list):
        promos = stored_promos
    else:
        promos = _promos_from_legacy(
            doc.get("on_promo"), doc.get("promo_kind"), doc.get("promo_end")
        )
    return {
        "apr_pct": doc.get("apr_pct"),
        "promos": promos,
        "min_payment_note": doc.get("min_payment_note"),
        "bt_offers": doc.get("bt_offers") or [],
        "status": doc.get("status"),
        "confirmed_at": confirmed_at.isoformat() if isinstance(confirmed_at, datetime) else confirmed_at,
        "product_key": doc.get("product_key"),
        "usage": doc.get("usage") if doc.get("usage") in ("clear_monthly", "carry") else None,
    }


@router.get("/card-terms")
async def list_card_terms(user: dict = Depends(current_user)):
    uid = user["email"]
    cards = await _user_credit_cards(uid)
    docs = {
        d.get("account_id"): d
        async for d in card_terms_col.find({"user_id": uid})
    }
    now = datetime.utcnow()
    out = []
    for a in cards:
        aid = str(a["_id"])
        doc = docs.get(aid)
        out.append({
            "account_id": aid,
            "name": _clean(a.get("nickname") or a.get("display_name") or a.get("name")) or "Credit card",
            "provider": a.get("provider") or a.get("provider_id") or "",
            "balance": float(a.get("balance") or 0.0),
            "currency": a.get("currency") or "GBP",
            "source": a.get("source") or "truelayer",
            "terms": _serialize_terms(doc),
            "ask_eligible": is_ask_eligible(doc, now),
        })
    return {"status": "ok", "cards": out, "rate_note": _RATE_NOTE}


async def _owned_card_or_404(uid: str, account_id: str) -> dict:
    acc = await accounts_col.find_one({"_id": account_id, "user_id": uid})
    if not acc or not is_credit_card_account(acc):
        raise HTTPException(404, "No such credit-card account")
    return acc


@router.post("/card-terms/{account_id}/lookup")
async def lookup_card_terms(account_id: str, user: dict = Depends(current_user)):
    """Product identification + cached-or-fresh representative-APR prefill.

    Never 500s on a Tavily failure — a failed lookup degrades to
    {status: "not_found"} and the user types the rate themselves.
    """
    uid = user["email"]
    acc = await _owned_card_or_404(uid, account_id)
    identity = derive_product_identity(acc)
    result = await lookup_product_rate(identity)
    return {
        "status": "ok",
        "product_key": result["product_key"],
        "display_name": result["display_name"],
        "representative_apr": result["representative_apr"],
        "stale": result["stale"],
        "candidates": result["candidates"],
        "lookup_status": result["status"],
        "source_url": result["source_url"],
        "ambiguous": identity["ambiguous"],
        "rate_basis": "representative",
        "rate_note": _RATE_NOTE,
    }


class CardTermsBody(BaseModel):
    status: Literal["confirmed", "skipped"] = "confirmed"
    apr_pct: Optional[float] = None
    # Legacy-tolerance fields — old clients still post the flat promo triple;
    # new clients send promos instead.  Both are accepted; promos wins when
    # non-empty.
    on_promo: bool = False
    promo_kind: Optional[Literal["purchases", "balance_transfer", "both"]] = None
    promo_end: Optional[str] = None          # ISO date
    promos: list[CardPromo] = []
    min_payment_note: Optional[str] = None
    bt_offers: list[BtOffer] = []
    # Legacy-tolerance fields — kept for old clients
    bt_offer_available: Optional[bool] = None
    bt_offer_note: Optional[str] = None
    usage: Optional[Literal["clear_monthly", "carry"]] = None
    product_key: Optional[str] = None


def _normalise_promos(body: "CardTermsBody") -> list[dict]:
    """Validate and normalise the promos list from the request body.

    If body.promos is empty and body.on_promo is true, maps the legacy flat
    triple into a single-element list first (preserving old-client behaviour).
    Returns a list of plain dicts {"kind", "apr_pct", "until"}.
    """
    promos = list(body.promos)

    if not promos:
        if body.on_promo:
            # Preserve old-client error for missing promo_end
            if not body.promo_end:
                raise HTTPException(400, "promo_end is required when on_promo")
            raw = _promos_from_legacy(body.on_promo, body.promo_kind, body.promo_end)
            # _promos_from_legacy returns dicts; convert to CardPromo for uniform validation
            typed = []
            for r in raw:
                typed.append(CardPromo(**r))
            promos = typed

    if not promos:
        return []

    if len(promos) > 4:
        raise HTTPException(400, "at most 4 promo rates")

    result = []
    seen: set[tuple] = set()
    for p in promos:
        # Validate apr_pct
        apr = p.apr_pct
        if not (0 <= apr <= 30):
            raise HTTPException(400, "promo apr_pct must be between 0 and 30")
        apr = round(apr, 2)

        # Validate until — required
        until = p.until
        if not until:
            raise HTTPException(400, "until is required for each promo")
        try:
            until_d = date.fromisoformat(until)
        except ValueError:
            raise HTTPException(400, "until must be an ISO date (YYYY-MM-DD)")
        if until_d < date.today():
            raise HTTPException(400, "until must be today or in the future")
        until = until_d.isoformat()

        # Duplicate check: same kind + same until is not allowed
        key = (p.kind, until)
        if key in seen:
            raise HTTPException(400, "two promos of the same kind must end on different dates")
        seen.add(key)

        result.append({"kind": p.kind, "apr_pct": apr, "until": until})

    return result


def _normalise_bt_offers(body: "CardTermsBody") -> list[dict]:
    """Normalise bt_offers from the request body, with legacy fallback."""
    if not body.bt_offers and body.bt_offer_available is True:
        # Legacy mapping: single offer from the old flat fields
        note = _clean(body.bt_offer_note)
        return [{"ends": None, "fee_pct": None, "note": note[:120] if note else None}]

    offers = body.bt_offers
    if len(offers) > 6:
        raise HTTPException(400, "at most 6 balance-transfer offers")

    result = []
    for offer in offers:
        # Validate fee_pct
        fee_pct = offer.fee_pct
        if fee_pct is not None:
            if not (0 <= fee_pct <= 15):
                raise HTTPException(400, "fee_pct must be between 0 and 15")
            fee_pct = round(fee_pct, 2)

        # Validate ends
        ends = offer.ends
        if ends is not None:
            try:
                ends_d = date.fromisoformat(ends)
            except ValueError:
                raise HTTPException(400, "ends must be an ISO date (YYYY-MM-DD)")
            if ends_d < date.today():
                raise HTTPException(400, "ends must be today or in the future")
            ends = ends_d.isoformat()

        # Clean note
        note = _clean(offer.note)
        note = note[:120] if note else None

        # Drop fully blank rows
        if ends is None and fee_pct is None and not note:
            continue

        result.append({"ends": ends, "fee_pct": fee_pct, "note": note})

    return result


def _clip_note(s: Optional[str]) -> Optional[str]:
    s = _clean(s)
    return s[:300] if s else None


@router.post("/card-terms/{account_id}")
async def save_card_terms(
    account_id: str, body: CardTermsBody, user: dict = Depends(current_user)
):
    """Confirm, correct, or skip ('Later') the terms for one card.

    Skipped records the explicit 'Later' so the ask doesn't nag every visit
    (re-ask eligibility after 14 days); everything else is stored null.

    On every confirmed save the full document is replaced (replace_one), so
    any legacy-shaped doc is fully migrated the first time the user re-saves —
    legacy keys vanish without any one-off data-migration pass.
    """
    uid = user["email"]
    await _owned_card_or_404(uid, account_id)
    existing = await card_terms_col.find_one({"_id": f"{uid}:{account_id}"}) or {}

    now = datetime.utcnow()
    if body.status == "skipped":
        doc = {
            "_id": f"{uid}:{account_id}",
            "user_id": uid,
            "account_id": account_id,
            "apr_pct": None,
            "promos": [],
            "min_payment_note": None,
            "bt_offers": [],
            "status": "skipped",
            "confirmed_at": now,
            "product_key": body.product_key,
            "usage": existing.get("usage"),
        }
    else:
        if body.apr_pct is not None and not (0 <= body.apr_pct <= 100):
            raise HTTPException(400, "apr_pct must be between 0 and 100")
        promos_list = _normalise_promos(body)
        bt_offers_list = _normalise_bt_offers(body)
        doc = {
            "_id": f"{uid}:{account_id}",
            "user_id": uid,
            "account_id": account_id,
            "apr_pct": round(float(body.apr_pct), 2) if body.apr_pct is not None else None,
            "promos": promos_list,
            "min_payment_note": _clip_note(body.min_payment_note),
            "bt_offers": bt_offers_list,
            "status": "confirmed",
            "confirmed_at": now,
            "product_key": body.product_key,
            "usage": body.usage,
        }

    # Full-document replace: legacy-shaped docs (on_promo/promo_kind/promo_end)
    # are completely overwritten the first time the user re-saves, migrating
    # them to the new shape in one step.  The _id is included in the
    # replacement doc so MongoDB preserves it.
    await card_terms_col.replace_one(
        {"_id": f"{uid}:{account_id}"}, doc, upsert=True
    )
    # Terms affect the companion ask (and future debt plans) — drop this
    # user's short-TTL response caches, same pattern as accounts.py writes.
    response_cache.invalidate(uid)
    return {"status": "ok", "terms": _serialize_terms(doc)}


@router.delete("/card-terms/{account_id}")
async def clear_card_terms(account_id: str, user: dict = Depends(current_user)):
    """Remove this card's terms doc entirely (user owns their data). The
    card becomes ask-eligible again."""
    uid = user["email"]
    await _owned_card_or_404(uid, account_id)
    res = await card_terms_col.delete_one({"_id": f"{uid}:{account_id}", "user_id": uid})
    response_cache.invalidate(uid)
    return {"status": "ok", "deleted": res.deleted_count == 1}
