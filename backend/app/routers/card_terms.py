"""Card terms capture — phase 1 of the debt planner.

Open-banking AIS never provides card terms (APR, 0% promo end dates, BT
offers), so terms are ASKED and the user's answer is the truth. We prefill
with the product's publicly advertised REPRESENTATIVE rate (FCA 51% rule:
representative ≠ the user's actual rate — responses carry that distinction
so the frontend can phrase honestly). The user confirms or corrects, and
the user owns their corrections (BEHAVIOURS.md).
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
    "Representative APR — the advertised rate at least 51% of accepted "
    "applicants get. Yours may be different; you can correct it."
)


def _clean(s) -> str:
    return " ".join(str(s or "").split())


class BtOffer(BaseModel):
    ends: Optional[str] = None      # ISO date
    fee_pct: Optional[float] = None
    note: Optional[str] = None


async def _user_credit_cards(uid: str) -> list[dict]:
    """Every credit-card account for this user — TrueLayer and Finexer rows
    both live in accounts_col (unified collections)."""
    raw = await accounts_col.find({"user_id": uid}).to_list(None)
    return [a for a in raw if is_credit_card_account(a)]


def _serialize_terms(doc: dict | None) -> dict | None:
    if not doc:
        return None
    confirmed_at = doc.get("confirmed_at")
    return {
        "apr_pct": doc.get("apr_pct"),
        "on_promo": bool(doc.get("on_promo")),
        "promo_kind": doc.get("promo_kind"),
        "promo_end": doc.get("promo_end"),
        "min_payment_note": doc.get("min_payment_note"),
        "bt_offers": doc.get("bt_offers") or [],
        "status": doc.get("status"),
        "confirmed_at": confirmed_at.isoformat() if isinstance(confirmed_at, datetime) else confirmed_at,
        "product_key": doc.get("product_key"),
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
    on_promo: bool = False
    promo_kind: Optional[Literal["purchases", "balance_transfer", "both"]] = None
    promo_end: Optional[str] = None          # ISO date
    min_payment_note: Optional[str] = None
    bt_offers: list[BtOffer] = []
    # Legacy-tolerance fields — kept for old clients
    bt_offer_available: Optional[bool] = None
    bt_offer_note: Optional[str] = None
    product_key: Optional[str] = None


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
    """
    uid = user["email"]
    await _owned_card_or_404(uid, account_id)

    now = datetime.utcnow()
    if body.status == "skipped":
        doc = {
            "user_id": uid,
            "account_id": account_id,
            "apr_pct": None,
            "on_promo": False,
            "promo_kind": None,
            "promo_end": None,
            "min_payment_note": None,
            "bt_offers": [],
            "status": "skipped",
            "confirmed_at": now,
            "product_key": body.product_key,
        }
    else:
        if body.apr_pct is not None and not (0 <= body.apr_pct <= 100):
            raise HTTPException(400, "apr_pct must be between 0 and 100")
        promo_kind = None
        promo_end = None
        if body.on_promo:
            if not body.promo_end:
                raise HTTPException(400, "promo_end is required when on_promo")
            try:
                promo_end_d = date.fromisoformat(body.promo_end)
            except ValueError:
                raise HTTPException(400, "promo_end must be an ISO date (YYYY-MM-DD)")
            if promo_end_d < date.today():
                raise HTTPException(400, "promo_end must be today or in the future")
            promo_end = promo_end_d.isoformat()
            promo_kind = body.promo_kind
        bt_offers_list = _normalise_bt_offers(body)
        doc = {
            "user_id": uid,
            "account_id": account_id,
            "apr_pct": round(float(body.apr_pct), 2) if body.apr_pct is not None else None,
            "on_promo": bool(body.on_promo),
            "promo_kind": promo_kind,
            "promo_end": promo_end,
            "min_payment_note": _clip_note(body.min_payment_note),
            "bt_offers": bt_offers_list,
            "status": "confirmed",
            "confirmed_at": now,
            "product_key": body.product_key,
        }

    # One doc per (user, account) — deterministic id, upsert on every save.
    await card_terms_col.update_one(
        {"_id": f"{uid}:{account_id}"}, {"$set": doc}, upsert=True
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
