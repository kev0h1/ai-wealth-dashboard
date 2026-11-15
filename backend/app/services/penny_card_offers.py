"""G472: small Penny tools for one card rate or one card offer.

`propose_set_card_terms` replaces a whole promo list on every call, which is
fragile for "add one offer". These four tools each change ONE thing, and every
one is read-modify-write at execute time:

  propose_set_card_rates   the purchase rate and/or the cash rate
  propose_add_card_offer   add one offer (type, rate, balance, end date, revert rate)
  propose_update_card_offer change only the given fields of one offer, by its id
  propose_remove_card_offer remove one offer, by its id

Doctrine:
 * The card is named by the user (name, bank or last 4 digits). More than one
   match is an `ambiguous` result with each candidate's last 4, never a guess.
 * The stored offer list is re-read when the proposal is CONFIRMED, edited, and
   validated by the same `_normalise_promos` the routes use (4 offer cap,
   duplicate and id rules, date and rate ranges).
 * The write goes through `save_card_rates`, the scoped update the card sheet
   uses, so `bt_offers`, the statement override and the payment fields are not
   touched. Offer ids are preserved on update.
 * Penny never invents a rate: every rate and balance in a proposal must appear
   as a number in the user's own words (`_user_texts`, injected server side by
   the agent loop; dates are removed first), otherwise the tool asks for it.
   The check is per conversation, not per card or per field.
"""
import math
import re
from datetime import date

from fastapi import HTTPException

CARD_OFFER_TOOL_NAMES = frozenset({
    "propose_set_card_rates", "propose_add_card_offer",
    "propose_update_card_offer", "propose_remove_card_offer",
})

_OFFER_TYPES = ["purchase", "balance_transfer", "money_transfer", "cash"]
_TYPE_LABEL = {
    "purchase": "purchase", "balance_transfer": "balance transfer",
    "money_transfer": "money transfer", "cash": "cash",
}
_OFFER_FIELD_KEYS = ("offer_type", "apr_pct", "until", "balance", "revert_apr_pct")
_CLEARABLE = ("balance", "revert_apr_pct")

_CARD_REF = {"type": "string", "description": "The card's name, bank or last 4 digits, as the user says it, or an id from get_accounts."}
_ID_NOTE = "The offer's id, exactly as get_accounts shows it under card_terms.promos."

PROPOSE_SET_CARD_RATES_SCHEMA = {
    "type": "function",
    "function": {
        "name": "propose_set_card_rates",
        "description": (
            "Propose setting a credit card's purchase rate and/or cash rate, changing nothing else on the "
            "card (its offers and payment settings stay as they are). Use for 'set my NatWest purchase rate "
            "to 23.2%'. Each rate must be a number the user typed in this conversation; never infer, round "
            "or recall one. If they have not given it, ask them. Supply at least one of the two."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "card_ref": _CARD_REF,
                "purchase_apr_pct": {"type": "number", "description": "Purchase rate, 0-100."},
                "cash_apr_pct": {"type": "number", "description": "Cash advance rate, 0-100."},
            },
            "required": ["card_ref"],
        },
    },
}

PROPOSE_ADD_CARD_OFFER_SCHEMA = {
    "type": "function",
    "function": {
        "name": "propose_add_card_offer",
        "description": (
            "Propose adding ONE rate offer to a credit card without touching its other offers, for example "
            "'add a 0% balance transfer of £1,455 ending 1 June 2028'. Needs offer_type, apr_pct (the offer's "
            "rate) and until (ISO date, today or later). balance (what sits on the offer) and revert_apr_pct "
            "(the rate after it ends) are optional; leave them out when the user has not said. Every rate and "
            "balance must be a number the user typed in this conversation, never one you infer. A card holds at "
            "most 4 offers, and two offers of the same type and end date need different balances."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "card_ref": _CARD_REF,
                "offer_type": {"type": "string", "enum": _OFFER_TYPES},
                "apr_pct": {"type": "number", "description": "The offer's rate, 0-100."},
                "until": {"type": "string", "description": "ISO date (YYYY-MM-DD) the offer ends, today or later."},
                "balance": {"type": "number", "description": "Optional, the balance on this offer in pounds."},
                "revert_apr_pct": {"type": "number", "description": "Optional, the rate after the offer ends, 0-100."},
            },
            "required": ["card_ref", "offer_type", "apr_pct", "until"],
        },
    },
}

PROPOSE_UPDATE_CARD_OFFER_SCHEMA = {
    "type": "function",
    "function": {
        "name": "propose_update_card_offer",
        "description": (
            "Propose changing ONE existing offer on a credit card, by its id, changing only the fields you "
            "supply. Read the card with get_accounts first to find the offer's id; never invent an id. "
            "Rates and balances must be numbers the user typed in this conversation. Pass null for balance "
            "or revert_apr_pct to clear it. At least one field besides card_ref and offer_id is required."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "card_ref": _CARD_REF,
                "offer_id": {"type": "string", "description": _ID_NOTE},
                "offer_type": {"type": "string", "enum": _OFFER_TYPES},
                "apr_pct": {"type": "number", "description": "The offer's rate, 0-100."},
                "until": {"type": "string", "description": "ISO date (YYYY-MM-DD), today or later."},
                "balance": {"type": ["number", "null"], "description": "Balance on this offer in pounds, or null to clear."},
                "revert_apr_pct": {"type": ["number", "null"], "description": "Rate after the offer ends, or null to clear."},
            },
            "required": ["card_ref", "offer_id"],
        },
    },
}

PROPOSE_REMOVE_CARD_OFFER_SCHEMA = {
    "type": "function",
    "function": {
        "name": "propose_remove_card_offer",
        "description": (
            "Propose removing ONE offer from a credit card, by its id, leaving the card's other offers and "
            "rates alone. Read the card with get_accounts first to find the offer's id; never invent an id."
        ),
        "parameters": {
            "type": "object",
            "properties": {"card_ref": _CARD_REF, "offer_id": {"type": "string", "description": _ID_NOTE}},
            "required": ["card_ref", "offer_id"],
        },
    },
}

# The per-offer fields a whole-list `propose_set_card_terms` save must accept and keep.
_WHOLE_LIST_OFFER_PROPERTIES = {
    "id": {"type": "string", "description": "The offer's id as get_accounts shows it. Keep it on an offer you are not replacing."},
    "offer_type": {"type": "string", "enum": _OFFER_TYPES},
    "balance": {"type": "number", "description": "Balance on this offer in pounds."},
    "revert_apr_pct": {"type": "number", "description": "Rate after the offer ends, 0-100."},
    "as_of": {"type": "string", "description": "ISO date the figures are from."},
}


def add_offer_fields_to_whole_list_schema(schema: dict) -> None:
    schema["function"]["parameters"]["properties"]["promos"]["items"]["properties"].update(_WHOLE_LIST_OFFER_PROPERTIES)


CARD_OFFER_SCHEMAS = [
    PROPOSE_SET_CARD_RATES_SCHEMA, PROPOSE_ADD_CARD_OFFER_SCHEMA,
    PROPOSE_UPDATE_CARD_OFFER_SCHEMA, PROPOSE_REMOVE_CARD_OFFER_SCHEMA,
]


# ── Rules shared by the proposal and the executor ──────────────────────────
class OfferEditError(ValueError):
    """A refusal written for the person, never a system message."""


def _today() -> date:
    from app.core import timeutil
    return timeutil.user_today()


def _num(value, label: str, lo: float, hi: float) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
        raise OfferEditError(f"{label} must be a number")
    if not lo <= value <= hi:
        raise OfferEditError(f"{label} must be between {lo:g} and {hi:,.0f}")
    return round(float(value), 2)


def clean_fields(fields: dict, *, adding: bool) -> dict:
    """The offer fields a person gave, checked for shape. Keys the model left out stay out."""
    out: dict = {}
    for key in _OFFER_FIELD_KEYS:
        if key not in fields:
            continue
        value = fields[key]
        if value is None:
            if adding and key in _CLEARABLE:
                continue  # an optional field left blank when adding
            if key in _CLEARABLE:
                out[key] = None
                continue
            raise OfferEditError(f"{key} cannot be empty")
        if key == "offer_type":
            if value not in _OFFER_TYPES:
                raise OfferEditError("offer_type must be purchase, balance_transfer, money_transfer or cash")
            out[key] = value
        elif key == "until":
            try:
                out[key] = date.fromisoformat(str(value)).isoformat()
            except ValueError:
                raise OfferEditError("until must be an ISO date (YYYY-MM-DD)")
        elif key == "balance":
            out[key] = _num(value, "balance", 0, 10_000_000)
        else:
            out[key] = _num(value, key, 0, 100)
    if adding:
        for key in ("offer_type", "apr_pct", "until"):
            if key not in out:
                raise OfferEditError(f"{key} is required to add an offer")
    return out


def apply_offer_change(existing_promos: list, op: str, offer_id: str | None, fields: dict) -> list[dict]:
    """The stored offers with ONE change applied, validated by the routes' own
    `_normalise_promos`. Raises HTTPException (its authored detail) or OfferEditError."""
    from app.routers.card_terms import (
        CardPromo, CardTermsBody, _OFFER_TYPE_KIND, _normalise_promos, _promo_dup_key, _promos_with_ids,
    )

    promos = [dict(p) for p in _promos_with_ids(existing_promos or [])]
    today = _today()
    index = None
    if op != "add":
        wanted = str(offer_id or "").strip()
        index = next((i for i, p in enumerate(promos) if wanted and p["id"] == wanted), None)
        if index is None:
            ids = ", ".join(p["id"] for p in promos) or "none"
            raise OfferEditError(f"This card has no offer with id '{wanted}'. Offer ids on this card: {ids}.")
        if op == "update" and promos[index].get("until") and date.fromisoformat(promos[index]["until"]) < today \
                and "until" not in fields:
            raise OfferEditError(
                f"The offer {wanted} has already ended. Give it a new end date in the future, or remove it."
            )

    def _ended(i: int, p: dict) -> bool:
        return i != index and bool(p.get("until")) and date.fromisoformat(p["until"]) < today

    # Ended offers the change does not touch are carried through exactly as stored. They are
    # left out of the "until must be today or later" check, but still count for the cap and duplicates.
    kept = {p["id"]: p for i, p in enumerate(promos) if _ended(i, p)}
    live = [p for i, p in enumerate(promos) if not _ended(i, p)]
    if op == "remove":
        live = [p for p in live if p["id"] != promos[index]["id"]]
    elif op == "add":
        item = {
            "kind": _OFFER_TYPE_KIND[fields["offer_type"]], "offer_type": fields["offer_type"],
            "apr_pct": fields["apr_pct"], "until": fields["until"], "as_of": today.isoformat(),
        }
        for key in _CLEARABLE:
            if fields.get(key) is not None:
                item[key] = fields[key]
        live.append(item)
    else:
        item = dict(promos[index])  # keeps its id
        for key, value in fields.items():
            if value is None:
                item.pop(key, None)
            else:
                item[key] = value
        if "offer_type" in fields:
            item["kind"] = _OFFER_TYPE_KIND[fields["offer_type"]]
        if any(k in fields for k in ("apr_pct", "balance", "revert_apr_pct")):
            item["as_of"] = today.isoformat()
        live = [item if p["id"] == item["id"] else p for p in live]

    normalised = _normalise_promos(CardTermsBody(status="confirmed", promos=[CardPromo(**p) for p in live])) if live else []
    if len(normalised) + len(kept) > 4:
        raise OfferEditError("A card holds at most 4 offers. Remove one first.")
    taken_keys = {_promo_dup_key(p) for p in kept.values()}
    for p in normalised:
        if _promo_dup_key(p) in taken_keys or p["id"] in kept:
            raise OfferEditError("This card already has an offer of that kind ending on that date. Two offers need different end dates or balances.")
    by_id = {p["id"]: p for p in normalised}
    out = [kept[p["id"]] if p["id"] in kept else by_id.pop(p["id"]) for p in promos if p["id"] in kept or p["id"] in by_id]
    out.extend(by_id.values())  # a newly added offer goes last
    return out


def _pct(value) -> str:
    return f"{round(float(value), 2):.2f}".rstrip("0").rstrip(".") + "%"


def _gbp(value) -> str:
    return f"£{float(value):,.2f}"


def _date(raw) -> str:
    try:
        return date.fromisoformat(str(raw)).strftime("%-d %b %Y")
    except (TypeError, ValueError):
        return str(raw)


def describe_offer(p: dict) -> str:
    label = _TYPE_LABEL.get(p.get("offer_type") or "", "")
    if not label:
        label = {"purchases": "purchase", "balance_transfer": "balance transfer", "both": "purchase and balance transfer"}.get(p.get("kind"), "")
    text = f"{_pct(p['apr_pct'])} {label} offer until {_date(p['until'])}".replace("  ", " ")
    if p.get("balance") is not None:
        text += f" on {_gbp(p['balance'])}"
    if p.get("revert_apr_pct") is not None:
        text += f", then {_pct(p['revert_apr_pct'])}"
    return text


# ── Never invent a rate ────────────────────────────────────────────────────
_NUMBER = re.compile(r"(?<![\d.])(?:\d[\d,]*(?:\.\d+)?|\.\d+)")
_ZERO_WORDS = re.compile(r"\b(?:zero|interest[- ]free)\b", re.I)
_MONTH = r"(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)"
_ORD = r"(?:st|nd|rd|th)?"
# Date expressions, so a day, month or year is never read as a typed rate or balance.
_DATES = re.compile(
    r"\b\d{4}-\d{1,2}-\d{1,2}\b"
    r"|\b\d{1,2}/\d{1,2}/\d{2,4}\b"
    rf"|\b\d{{1,2}}{_ORD}\s+(?:of\s+)?{_MONTH}\b(?:,?\s+\d{{4}})?"
    rf"|\b{_MONTH}\s+\d{{1,2}}{_ORD}\b(?:,?\s+\d{{4}})?"
    rf"|\b{_MONTH}\s+\d{{4}}\b",
    re.I,
)


def numbers_typed(texts) -> list[float]:
    found: list[float] = []
    for text in texts or []:
        for m in _NUMBER.findall(_DATES.sub(" ", text or "")):
            try:
                found.append(round(float(m.replace(",", "")), 4))
            except ValueError:
                continue
    return found


def _first_unprovenanced(named: dict, user_texts) -> str | None:
    """The first field whose number the user never typed, or None when all were."""
    typed = numbers_typed(user_texts)
    said_zero = any(_ZERO_WORDS.search(t or "") for t in user_texts or [])
    for label, value in named.items():
        if value is None:
            continue
        target = round(float(value), 4)
        if target in typed or (target == 0 and said_zero):
            continue
        return label
    return None


def _ask_for(label: str, card_name: str) -> dict:
    noun = {
        "purchase_apr_pct": "purchase rate", "cash_apr_pct": "cash rate", "apr_pct": "offer rate",
        "revert_apr_pct": "rate after the offer ends", "balance": "balance on the offer",
    }.get(label, label)
    return {"needs_input": True, "ask": f"What is the {noun} on {card_name}? Type the number and I'll use it."}


# ── Card resolution ────────────────────────────────────────────────────────
_LAST4 = re.compile(r"^\W*(?:[a-z ]*?(?:ending|ends|last (?:4|four)(?: digits)?)(?:\s+(?:in|with|on))?\W*)?[x*•.\s]*(\d{4})\W*$", re.I)


async def resolve_card(uid: str, card_ref):
    """One owned credit card, by id, name, bank or last 4 digits. Several matches
    come back as `ambiguous` with each candidate's last 4, never a guess."""
    from app.services import penny_tools as pt

    ref = str(card_ref or "").strip()
    if not ref:
        return {"error": "card_ref required"}
    m = _LAST4.match(ref)
    if m:
        from app.routers.accounts import get_accounts as _route_get_accounts
        accs = await _route_get_accounts(user={"email": uid})
        cards = [a for a in accs if pt._account_kind(a) == "Credit"]
        if not cards:
            return {"error": "no credit-card accounts connected"}
        hits = [a for a in cards if pt._last4(getattr(a, "account_number", None)) == m.group(1)]
        if len(hits) == 1:
            return {"account": hits[0]}
        if len(hits) > 1:
            return {"ambiguous": True, "matches": [pt._card_candidate_summary(a) for a in hits]}
        if not any(a.id == ref for a in cards):
            return {"error": f"no credit card ending {m.group(1)}", "available": [pt._card_candidate_summary(a) for a in cards]}
    return await pt._resolve_credit_card_for_propose(uid, ref)


async def _stored_terms(uid: str, account_id: str) -> dict:
    from app.routers.card_terms import _serialize_terms, card_terms_col
    return _serialize_terms(await card_terms_col.find_one({"_id": f"{uid}:{account_id}"})) or {}


async def _card_or_reply(uid: str, card_ref):
    resolved = await resolve_card(uid, card_ref)
    if resolved.get("account") is None:
        return None, (resolved if resolved.get("ambiguous") else {"error": resolved.get("error") or "card not found", **({"available": resolved["available"]} if resolved.get("available") else {})})
    return resolved["account"], None


# ── Proposal builders ──────────────────────────────────────────────────────
async def exec_propose_set_card_rates(uid: str, args: dict) -> dict:
    from app.services import penny_tools as pt

    account, reply = await _card_or_reply(uid, args.get("card_ref"))
    if reply:
        return reply
    given = {k: args[k] for k in ("purchase_apr_pct", "cash_apr_pct") if k in args and args[k] is not None}
    if not given:
        return pt._tool_error("supply purchase_apr_pct, cash_apr_pct or both")
    try:
        clean = {k: _num(v, k, 0, 100) for k, v in given.items()}
    except OfferEditError as exc:
        return pt._tool_error(exc.args[0])
    missing = _first_unprovenanced(clean, args.get("_user_texts"))
    if missing:
        return _ask_for(missing, account.name)
    stored = await _stored_terms(uid, account.id)
    bits, before = [], []
    if "purchase_apr_pct" in clean:
        bits.append(f"purchase rate to {_pct(clean['purchase_apr_pct'])}")
        before.append(f"purchase {_pct(stored['apr_pct'])}" if stored.get("apr_pct") is not None else "purchase not set")
    if "cash_apr_pct" in clean:
        bits.append(f"cash rate to {_pct(clean['cash_apr_pct'])}")
        before.append(f"cash {_pct(stored['cash_apr_pct'])}" if stored.get("cash_apr_pct") is not None else "cash not set")
    summary = f"Set {account.name} ({account.provider}) {' and '.join(bits)}."
    consequence = "Only the rate changes. The card's offers and payment settings stay as they are."
    params = {"account_id": account.id, **{("apr_pct" if k == "purchase_apr_pct" else k): v for k, v in clean.items()}}
    return await pt._create_proposal(
        uid, "set_card_rates", params, summary, consequence,
        before=", ".join(before), after=" and ".join(bits), entity=account.name,
    )


async def _propose_offer_change(uid: str, op: str, args: dict) -> dict:
    from app.services import penny_tools as pt

    account, reply = await _card_or_reply(uid, args.get("card_ref"))
    if reply:
        return reply
    offer_id = str(args.get("offer_id") or "").strip()
    if op != "add" and not offer_id:
        return pt._tool_error("offer_id required, read it from get_accounts")
    try:
        fields = clean_fields({k: args[k] for k in _OFFER_FIELD_KEYS if k in args}, adding=op == "add") if op != "remove" else {}
        if op == "update" and not fields:
            return pt._tool_error("supply at least one field to change")
        missing = _first_unprovenanced(
            {k: v for k, v in fields.items() if k in ("apr_pct", "balance", "revert_apr_pct")}, args.get("_user_texts"),
        )
        if missing:
            return _ask_for(missing, account.name)
        stored = await _stored_terms(uid, account.id)
        existing = stored.get("promos") or []
        try:
            result = apply_offer_change(existing, op, offer_id, fields)
        except HTTPException as exc:
            return pt._tool_error(str(exc.detail))
    except OfferEditError as exc:
        return pt._tool_error(exc.args[0])

    from app.routers.card_terms import _promos_with_ids
    old = next((p for p in _promos_with_ids(existing) if p["id"] == offer_id), None) if op != "add" else None
    if op == "add":
        new = next(p for p in result if p["id"] not in {q["id"] for q in _promos_with_ids(existing)})
        summary = f"Add a {describe_offer(new)} to {account.name} ({account.provider})."
        before, after = None, describe_offer(new)
    elif op == "update":
        new = next(p for p in result if p["id"] == offer_id)
        summary = f"Change the {describe_offer(old)} on {account.name} ({account.provider}) to a {describe_offer(new)}."
        before, after = describe_offer(old), describe_offer(new)
    else:
        summary = f"Remove the {describe_offer(old)} from {account.name} ({account.provider})."
        before, after = describe_offer(old), "Removed"
    consequence = "Only this offer changes. The card's other offers, rates and payment settings stay as they are."
    params = {"account_id": account.id, "op": op, "offer_id": offer_id or None, "fields": fields}
    return await pt._create_proposal(
        uid, f"{op}_card_offer", params, summary, consequence,
        before=before, after=after, entity=account.name,
    )


async def exec_propose_add_card_offer(uid: str, args: dict) -> dict:
    return await _propose_offer_change(uid, "add", args)


async def exec_propose_update_card_offer(uid: str, args: dict) -> dict:
    return await _propose_offer_change(uid, "update", args)


async def exec_propose_remove_card_offer(uid: str, args: dict) -> dict:
    return await _propose_offer_change(uid, "remove", args)


# ── Confirm-time executors (registered in can_i._PROPOSAL_EXECUTORS) ────────
async def execute_set_card_rates(uid: str, params: dict) -> dict:
    from app.routers.card_terms import CardRatesBody, save_card_rates

    updates = {k: params[k] for k in ("apr_pct", "cash_apr_pct") if k in params}
    return await save_card_rates(params["account_id"], CardRatesBody(**updates), user={"email": uid})


async def _execute_offer_change(uid: str, params: dict, op: str) -> dict:
    from datetime import datetime, timezone
    from app.routers.card_terms import _PAYMENT_FIELDS, _owned_card_or_404, _update_scoped_terms

    account_id = params["account_id"]
    await _owned_card_or_404(uid, account_id)
    stored = await _stored_terms(uid, account_id)  # the CURRENT list, read now, not at propose time
    try:
        promos = apply_offer_change(stored.get("promos") or [], op, params.get("offer_id"), params.get("fields") or {})
    except OfferEditError as exc:
        raise HTTPException(409, exc.args[0])
    # The same scoped update save_card_rates makes. The changed offer was validated above; going through
    # save_card_rates would re-check every stored offer's end date and refuse an untouched ended one.
    updates = {"status": "confirmed", "confirmed_at": datetime.now(timezone.utc), "promos": promos}  # naive-ok: persisted UTC confirmation audit timestamp, not a calendar decision.
    defaults = {field: None for field in _PAYMENT_FIELDS}
    defaults.update(apr_pct=None, promos=[], min_payment_note=None, bt_offers=[], product_key=None, usage=None)
    return await _update_scoped_terms(uid, account_id, updates, defaults)


async def execute_add_card_offer(uid: str, params: dict) -> dict:
    return await _execute_offer_change(uid, params, "add")


async def execute_update_card_offer(uid: str, params: dict) -> dict:
    return await _execute_offer_change(uid, params, "update")


async def execute_remove_card_offer(uid: str, params: dict) -> dict:
    return await _execute_offer_change(uid, params, "remove")


PROPOSE_EXECUTORS = {
    "propose_set_card_rates": exec_propose_set_card_rates,
    "propose_add_card_offer": exec_propose_add_card_offer,
    "propose_update_card_offer": exec_propose_update_card_offer,
    "propose_remove_card_offer": exec_propose_remove_card_offer,
}
