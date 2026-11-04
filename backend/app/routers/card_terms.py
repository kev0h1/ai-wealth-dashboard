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
from math import isfinite
from typing import Literal, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, StrictInt, field_validator

from app.core.auth import current_user
from app.core import timeutil
from app.db.collections import accounts_col, card_terms_col
from app.services.account_kinds import is_credit_card_account
from app.services.counted_accounts import is_excluded
from app.services.card_statements import mask_long_digits as _mask_long_digits, normalise_match_rule as _normalise_match_rule
from app.services.card_rates import (
    derive_product_identity,
    is_ask_eligible,
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


class PaymentMatch(BaseModel):
    """G413: which of the paying account's payments is this card's bill.

    "contains" needs `text` (for example the tail of a card reference);
    "payment" needs `series_key` (a payment the user picked from that account).
    """
    kind: Literal["contains", "payment"]
    text: Optional[str] = None
    series_key: Optional[str] = None
    label: Optional[str] = None


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
        # G412: these are optional facts from the card statement.  An absent
        # legacy field is deliberately indistinguishable from an unanswered
        # new field, rather than inventing a payment or a statement date.
        "statement_close_day": doc.get("statement_close_day"),
        "payment_due_day": doc.get("payment_due_day"),
        "payment_due_days_after_close": doc.get("payment_due_days_after_close"),
        "payment_method": doc.get("payment_method") if doc.get("payment_method") in ("full", "minimum", "fixed", "manual") else None,
        "payment_account_id": str(doc["payment_account_id"]) if doc.get("payment_account_id") is not None else None,
        "fixed_payment_amount": doc.get("fixed_payment_amount"),
        # G413: absent on every legacy document, which reads as no rule.
        "payment_match": _normalise_match_rule(doc.get("payment_match")),
    }


@router.get("/card-terms")
async def list_card_terms(user: dict = Depends(current_user)):
    uid = user["email"]
    cards = await _user_credit_cards(uid)
    docs = {
        str(d.get("account_id")): d
        async for d in card_terms_col.find({"user_id": uid})
        if d.get("account_id") is not None
    }
    now = datetime.utcnow()
    # The canonical engine calculates bills from transactions only when the
    # statement facts are complete.  It is intentionally optional here: a
    # terms read remains useful if old data or an engine read is unavailable.
    statement_bills: dict[str, dict] = {}
    configured_ids: set[str] = set()
    try:
        from app.services.card_statements import has_statement_dates, load_statement_bills
        configured_ids = {
            str(aid) for aid, doc in docs.items()
            if doc and has_statement_dates(doc)
        }
        if configured_ids:
            statement_bills = await load_statement_bills(
                uid, cards=cards, terms=docs, today=timeutil.user_today()
            )
    except Exception:
        # No invented statement amount.  The saved terms remain readable and
        # the client can honestly show that an estimate is unavailable.
        configured_ids = set()
        statement_bills = {}
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
            # A181: the bank-reported card class kept on the account at sync; never guessed from the name.
            "card_class": str(a.get("finexer_class") or "").strip().lower() or None,
            "terms": _serialize_terms(doc),
            "statement_bill": statement_bills.get(aid) if aid in configured_ids else None,
            "ask_eligible": is_ask_eligible(doc, now),
        })
    return {"status": "ok", "cards": out, "rate_note": _RATE_NOTE}


async def _owned_card_or_404(uid: str, account_id: str) -> dict:
    acc = await accounts_col.find_one({"_id": account_id, "user_id": uid})
    if not acc or not is_credit_card_account(acc):
        raise HTTPException(404, "No such credit-card account")
    return acc


@router.get("/card-terms/{account_id}/recent-payments")
async def recent_payer_payments(account_id: str, payer_id: str, user: dict = Depends(current_user)):
    """G413: the paying account's recent payments, one row per recurring
    series, so a person can pick the one that is this card's bill. Read only,
    scoped to the signed-in user, and the payer must be one of their own
    counted cash accounts. Narratives are the user's own, shortened."""
    uid = user["email"]
    await _owned_card_or_404(uid, account_id)
    payer_id = _clean(payer_id)
    try:
        from bson import ObjectId
        keys = [payer_id, ObjectId(payer_id)] if ObjectId.is_valid(payer_id) else [payer_id]
    except Exception:
        keys = [payer_id]
    payer = await accounts_col.find_one({"_id": {"$in": keys}, "user_id": uid})
    if not payer or is_credit_card_account(payer) or is_excluded(payer):
        raise HTTPException(422, "Choose one of your counted current accounts")
    from datetime import time, timedelta, timezone
    from app.db.collections import transactions_col
    from app.services.own_account_transfers import series_key
    cutoff = datetime.combine(timeutil.user_today() - timedelta(days=100), time.min, tzinfo=timezone.utc)
    rows = await transactions_col.find(
        {"user_id": uid, "account_id": str(payer["_id"]), "transaction_type": "debit", "date": {"$gte": cutoff}},
        {"description": 1, "merchant_name": 1, "amount": 1, "date": 1, "own_transfer_match": 1},
    ).to_list(None)
    rows.sort(key=lambda r: r.get("date") or datetime.min, reverse=True)
    seen: dict[str, dict] = {}
    for r in rows:
        key = series_key(r)
        if not key or key in seen:
            continue
        seen[key] = {
            "series_key": key,
            "label": _mask_long_digits(_clean(r.get("description") or r.get("merchant_name") or key))[:80],
            "last_amount": round(abs(float(r.get("amount") or 0.0)), 2),
            "last_date": (r["date"].date() if isinstance(r.get("date"), datetime) else r.get("date")).isoformat() if r.get("date") else None,
        }
        if len(seen) >= 30:
            break
    return {"status": "ok", "payments": list(seen.values())}


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
    # Optional statement and payment facts.  We merge these against an
    # existing record below because old clients still save only APR/promos.
    # `StrictInt` deliberately rejects 12.5 and booleans rather than quietly
    # changing the user's date rule.
    statement_close_day: Optional[StrictInt] = None
    payment_due_day: Optional[StrictInt] = None
    payment_due_days_after_close: Optional[StrictInt] = None
    payment_method: Optional[Literal["full", "minimum", "fixed", "manual"]] = None
    payment_account_id: Optional[str] = None
    fixed_payment_amount: Optional[float] = None
    payment_match: Optional[PaymentMatch] = None

    @field_validator("fixed_payment_amount", mode="before")
    @classmethod
    def _fixed_payment_amount_is_not_bool(cls, value):
        # `bool` is a Python `int`, and Pydantic's ordinary float coercion
        # would otherwise turn True into £1.00.  It is not a money amount.
        if isinstance(value, bool):
            raise ValueError("fixed_payment_amount must be a number")
        return value


_PAYMENT_FIELDS = (
    "statement_close_day",
    "payment_due_day",
    "payment_due_days_after_close",
    "payment_method",
    "payment_account_id",
    "fixed_payment_amount",
    "payment_match",
)


def _submitted(body: CardTermsBody, field: str) -> bool:
    """Did this request name a new payment field?

    `model_fields_set` distinguishes a legacy client omitting an optional
    field from a user deliberately clearing it with JSON null.  The latter
    must win, otherwise a person could never remove a statement setting.
    """
    return field in body.model_fields_set


def normalise_payment_settings(existing: dict | None, body: CardTermsBody) -> dict:
    """Merge the new optional payment facts without losing legacy settings."""
    existing = existing or {}
    merged = {
        field: getattr(body, field) if _submitted(body, field) else existing.get(field)
        for field in _PAYMENT_FIELDS
    }
    match = merged.get("payment_match")
    if isinstance(match, BaseModel):
        match = match.model_dump(exclude_none=True)
    merged["payment_match"] = match
    return merged


async def _validate_payment_settings(
    uid: str, settings: dict, *, validate_source: bool = True
) -> dict:
    """Validate a merged statement-payment record before writing anything.

    An incomplete record is valid: Open Banking does not supply statement
    dates, and a partial answer must not create a guessed bill.  Once a
    source account is chosen it must be the user's included, connected GBP
    cash account, never the card itself or another customer's account.
    """
    close_day = settings["statement_close_day"]
    due_day = settings["payment_due_day"]
    due_offset = settings["payment_due_days_after_close"]
    method = settings["payment_method"]
    fixed = settings["fixed_payment_amount"]

    if close_day is not None and (isinstance(close_day, bool) or not isinstance(close_day, int) or not 1 <= close_day <= 31):
        raise HTTPException(400, "statement_close_day must be between 1 and 31")
    if due_day is not None and (isinstance(due_day, bool) or not isinstance(due_day, int) or not 1 <= due_day <= 31):
        raise HTTPException(400, "payment_due_day must be between 1 and 31")
    if due_offset is not None and (isinstance(due_offset, bool) or not isinstance(due_offset, int) or not 1 <= due_offset <= 366):
        raise HTTPException(400, "payment_due_days_after_close must be between 1 and 366")
    if due_day is not None and due_offset is not None:
        raise HTTPException(400, "choose either payment_due_day or payment_due_days_after_close")
    if method is not None and method not in ("full", "minimum", "fixed", "manual"):
        raise HTTPException(400, "payment_method is not recognised")
    if fixed is not None and (isinstance(fixed, bool) or not isinstance(fixed, (int, float)) or not isfinite(fixed) or fixed <= 0):
        raise HTTPException(400, "fixed_payment_amount must be greater than 0")
    if method == "fixed" and fixed is None:
        raise HTTPException(400, "fixed_payment_amount is required for a fixed payment")
    if method != "fixed" and fixed is not None:
        raise HTTPException(400, "fixed_payment_amount is only used for a fixed payment")

    source_id = _clean(settings["payment_account_id"])
    settings["payment_account_id"] = source_id or None
    # G413: the match rule names a payment from the paying account, so it
    # needs that account, and must be one of the two supported shapes.
    raw_match = settings.get("payment_match")
    if raw_match is None:
        settings["payment_match"] = None
    else:
        match = _normalise_match_rule(raw_match)
        if match is None:
            raise HTTPException(400, "payment_match needs some text (at least 3 letters or digits) or a chosen payment")
        if not source_id:
            raise HTTPException(422, "Choose the paying account before adding a payment match rule")
        settings["payment_match"] = match
    if not source_id:
        return settings
    # An APR or promo-only legacy save must not become impossible merely
    # because a once-selected current account has since been disconnected.
    # The stored source remains an honest historical answer; the statement
    # engine will surface it as unavailable.  A person selecting a source in
    # this request is always checked afresh below.
    if not validate_source:
        return settings

    # Account ids may be either strings or ObjectIds depending on the bank
    # provider.  Import lazily so the route remains simple under test fakes.
    try:
        from bson import ObjectId
        source_keys = [source_id, ObjectId(source_id)] if ObjectId.is_valid(source_id) else [source_id]
    except Exception:
        source_keys = [source_id]
    source = await accounts_col.find_one({"_id": {"$in": source_keys}, "user_id": uid})
    if not source:
        raise HTTPException(422, "Choose one of your connected current accounts")
    if str(source.get("currency") or "GBP").upper() != "GBP":
        raise HTTPException(422, "Choose a GBP current account")
    if is_credit_card_account(source) or is_excluded(source):
        raise HTTPException(422, "Choose a counted current account")
    # Savings/ISA pots and debt accounts are not cash payment sources.  The
    # current-account classifier accepts a bare bank type, but the explicit
    # savings/debt checks keep that fallback from admitting a savings pot.
    from app.services.account_kinds import is_current_account, is_debt_account, is_savings_account
    if not is_current_account(source) or is_savings_account(source) or is_debt_account(source):
        raise HTTPException(422, "Choose a counted current account")
    return settings


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
        if until_d < timeutil.user_today():
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
            if ends_d < timeutil.user_today():
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
    card = await _owned_card_or_404(uid, account_id)
    existing = await card_terms_col.find_one({"_id": f"{uid}:{account_id}"}) or {}

    now = datetime.utcnow()
    if body.status == "skipped":
        # A Later answer only defers rates/promos.  It cannot silently erase
        # statement/payment facts the person has already supplied.
        payment = {field: existing.get(field) for field in _PAYMENT_FIELDS}
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
            **payment,
        }
    else:
        if body.apr_pct is not None and not (0 <= body.apr_pct <= 100):
            raise HTTPException(400, "apr_pct must be between 0 and 100")
        promos_list = _normalise_promos(body)
        bt_offers_list = _normalise_bt_offers(body)
        payment = await _validate_payment_settings(
            uid,
            normalise_payment_settings(existing, body),
            validate_source=_submitted(body, "payment_account_id"),
        )
        # A statement date alone is still useful on a foreign-currency card,
        # but a full/fixed GBP payment instruction would fabricate an FX-free
        # cash debit.  Keep APR and other card-term edits available until a
        # supported currency conversion model exists.
        payment_changed = any(_submitted(body, field) for field in _PAYMENT_FIELDS)
        if (
            payment_changed
            and payment["payment_method"] in ("full", "fixed")
            and payment["payment_account_id"]
            and str(card.get("currency") or "GBP").upper() != "GBP"
        ):
            raise HTTPException(422, "Card payments need a GBP card and GBP current account")
        # The older clear/carry question is now a derived compatibility field,
        # not a second answer in the UI.  A manual payment has no inferred
        # cadence, and a legacy request with no payment-method field retains
        # its existing explicit usage.
        usage = body.usage
        if payment["payment_method"] == "full":
            usage = "clear_monthly"
        elif payment["payment_method"] in ("minimum", "fixed"):
            usage = "carry"
        elif payment["payment_method"] == "manual":
            usage = None
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
            "usage": usage,
            **payment,
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
    # G412's canonical statement-payment engine reads live card terms rather
    # than recurrence-cache data.  Use the established H145 refresh path so
    # the acknowledged save invalidates every money response before return;
    # it degrades safely if cache warm-up cannot complete.
    from app.routers.analytics import _refresh_after_override
    await _refresh_after_override(uid)
    return {"status": "ok", "terms": _serialize_terms(doc)}


@router.delete("/card-terms/{account_id}")
async def clear_card_terms(account_id: str, user: dict = Depends(current_user)):
    """Remove this card's terms doc entirely (user owns their data). The
    card becomes ask-eligible again."""
    uid = user["email"]
    await _owned_card_or_404(uid, account_id)
    res = await card_terms_col.delete_one({"_id": f"{uid}:{account_id}", "user_id": uid})
    from app.routers.analytics import _refresh_after_override
    await _refresh_after_override(uid)
    return {"status": "ok", "deleted": res.deleted_count == 1}
