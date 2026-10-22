"""G256: a goal plan's per-period contribution is fulfilled by a matched
OUTGOING transfer from its paying account (PLANS-FRAMEWORK.md section 3,
detection 1), using the same rule shape set-asides use.

  fill_rule  {match_type: description_equals | description_contains,
              match_value}  stored on the commitment doc. Validation and the
              equals/contains semantics are the allocation rule's own
              (services/description_match.py), so the two cannot drift.

Rules (all derived on read, nothing about a period is stored):

  * Only a DEBIT on the plan's paying account (chosen, or inferred from
    transfers per G230) inside the current pay period, matching the rule,
    counts. A rise in the destination balance is never the trigger; a
    same-period credit of about the same size in the sink is reported as
    `seen_in_sink`, confirmation only.
  * Matched amounts sum. Fulfilled when the sum reaches 85% of the slice due
    (tolerance 15%, the same PLAN_OVERLAP_TOLERANCE G235 uses to decide a
    transfer could be the contribution). Why a tolerance at all: the slice is
    rounded up to a whole 5 pounds and recomputed once the pot has risen, so
    a real 80 pound transfer must still count against an 83 or 85 pound
    slice. (Set-asides need none: they sum fills against the envelope.)
    Over-payment fulfils the period; the excess is progress, not credit.
  * Fulfilled releases the whole slice (the debit already lowered the pooled
    balance, so reserving it again would count the money twice). A partial
    match releases only what has left the account: the unmet remainder stays
    reserved. No roll-over or missed prompt exists yet (build item 5), so an
    unmet remainder simply stays reserved until the period ends and the next
    period starts from the usual, recalculated slice.
  * With no rule, no source or any failure, nothing changes: the plan stays
    "estimated" and reserves its full slice (fail closed).
"""
from __future__ import annotations

import logging
import math
import re
from collections import defaultdict
from datetime import date, datetime, timedelta

from fastapi import HTTPException

from app.core import timeutil
from app.db.collections import transactions_col, yapily_transactions_col
from app.services.categories import clean_name
from app.services.categorisation import series_key
from app.services.description_match import matches_contains, matches_equals

logger = logging.getLogger(__name__)

MATCH_TYPES = ("description_equals", "description_contains")
FULFIL_TOLERANCE = 0.15  # same figure as account_position.PLAN_OVERLAP_TOLERANCE
CANDIDATE_WINDOW_DAYS = 90
_MAX_MATCH_VALUE = 80


def validate_fill_rule(raw) -> dict | None:
    """None clears the rule. Otherwise {match_type, match_value}, validated
    exactly like an allocation's rule (400 on a bad type or empty value)."""
    if raw is None:
        return None
    if not isinstance(raw, dict):
        raise HTTPException(400, "fill_rule must be an object or null")
    match_type = str(raw.get("match_type") or "").strip()
    if match_type not in MATCH_TYPES:
        raise HTTPException(400, "match_type must be 'description_equals' or 'description_contains'")
    match_value = str(raw.get("match_value") or "").strip()
    if not match_value:
        raise HTTPException(400, "match_value required")
    return {"match_type": match_type, "match_value": match_value[:_MAX_MATCH_VALUE]}


def rule_matches(rule: dict, txn: dict) -> bool:
    if rule.get("match_type") == "description_equals":
        return matches_equals(txn.get("description"), rule.get("match_value"))
    if rule.get("match_type") == "description_contains":
        return matches_contains(rule.get("match_value"), txn.get("description"), txn.get("merchant_name"))
    return False


def display_name(txn: dict) -> str:
    return clean_name((txn.get("merchant_name") or "").strip() or (txn.get("description") or ""))


def _day(t: dict):
    d = t.get("date")
    return d.date() if hasattr(d, "date") else d


def _bounds(start: date, end: date) -> tuple[datetime, datetime]:
    return (datetime(start.year, start.month, start.day),
            datetime(end.year, end.month, end.day, 23, 59, 59))


async def _load(uid: str, account_ids: list[str], kind: str, start: date, end: date) -> list[dict]:
    if not account_ids or start > end:
        return []
    lo, hi = _bounds(start, end)
    q = {"user_id": uid, "account_id": {"$in": account_ids}, "transaction_type": kind,
         "date": {"$gte": lo, "$lte": hi}}
    proj = {
        "account_id": 1, "amount": 1, "merchant_name": 1, "description": 1, "date": 1,
        # The candidate gate uses the same persisted classification fields
        # that sync/categorisation writes. Keep them in the projection rather
        # than silently falling through to a loose text heuristic.
        "category": 1, "custom_category": 1,
    }
    out: list[dict] = []
    for col in (transactions_col, yapily_transactions_col):
        out += await col.find(q, proj).to_list(None)
    return out


def assess(
    expected_pence: int,
    matched_pence: int,
    *,
    exact: bool = False,
    tolerance: float = FULFIL_TOLERANCE,
) -> dict:
    """Pure fulfilment arithmetic. `unmet_pence` is what stays reserved."""
    expected_pence = max(0, int(expected_pence))
    matched_pence = max(0, int(matched_pence))
    tolerance = 0.0 if exact else max(0.0, float(tolerance))
    if matched_pence == 0:
        return {"state": "unmet", "unmet_pence": expected_pence}
    if expected_pence == 0 or matched_pence >= expected_pence * (1 - tolerance) - 1e-9:
        return {"state": "fulfilled", "unmet_pence": 0}
    return {"state": "partial", "unmet_pence": expected_pence - matched_pence}


def _created_key(doc: dict):
    """Earliest-created first: created_at, else the ObjectId's own timestamp."""
    created = doc.get("created_at")
    if hasattr(created, "timestamp"):
        try:
            return (created.replace(tzinfo=None) if getattr(created, "tzinfo", None) else created).timestamp(), str(doc.get("_id"))
        except Exception:
            pass
    oid = doc.get("_id")
    gen = getattr(oid, "generation_time", None)
    return (gen.timestamp() if gen else 0.0, str(oid))


def claims_debit(me: dict, rivals: list[dict], txn: dict, my_expected_pence: int) -> bool:
    """One debit fulfils at most one plan. Among the plans whose rule matches it
    on this source: an exact-amount plan (slice due equals the debit, to the
    penny) wins, otherwise the earliest-created. Every plan evaluates the same
    inputs, so `_pot_progress_and_slice` and `/account-plans` always agree.
    `me` and each rival: {doc, expected_pence}."""
    amount_pence = int(round(abs(float(txn.get("amount") or 0)) * 100))
    field = [me] + [r for r in rivals if rule_matches(r["rule"], txn)]
    exact = [c for c in field if c["expected_pence"] == amount_pence]
    pool = exact or field
    winner = min(pool, key=lambda c: _created_key(c["doc"]))
    return winner is me


async def period_fulfilment(
    uid: str, doc: dict, expected_pounds: float, source_id: str | None,
    start: date, end: date, rivals: list[dict] | None = None,
    *, exact: bool = False,
) -> dict | None:
    """Fulfilment of this period's slice, or None when the plan has no rule or
    no known paying account (it then reserves its full slice, as before)."""
    rule = validate_fill_rule(doc.get("fill_rule")) if doc.get("fill_rule") else None
    if rule is None or not source_id:
        return None
    expected_value = float(expected_pounds)
    if not math.isfinite(expected_value):
        raise ValueError("expected_pounds must be finite")
    expected_pence = max(0, int(round(expected_value * 100)))
    window_end = min(end, timeutil.user_today())
    debits = await _load(uid, [source_id], "debit", start, window_end)
    hits = sorted((t for t in debits if rule_matches(rule, t)), key=lambda t: t["date"])
    if rivals:
        me = {"doc": doc, "rule": rule, "expected_pence": expected_pence}
        hits = [t for t in hits if claims_debit(me, rivals, t, me["expected_pence"])]
    matched_pence = sum(int(round(abs(float(t.get("amount") or 0)) * 100)) for t in hits)
    matched = matched_pence / 100
    verdict = assess(expected_pence, matched_pence, exact=exact)
    seen = False
    if matched_pence:
        pots = [str(p["account_id"]) for p in (doc.get("funding_pots") or []) if p.get("account_id")]
        credits = await _load(uid, pots, "credit", start, window_end)
        seen = any(
            abs(abs(float(c.get("amount") or 0)) - matched) <= matched * FULFIL_TOLERANCE
            for c in credits
        )
    return {
        "state": verdict["state"],
        "expected_pence": expected_pence,
        "matched_pence": matched_pence,
        "unmet_pence": verdict["unmet_pence"],
        "unmet": verdict["unmet_pence"] / 100 if exact else math.ceil(verdict["unmet_pence"] / 100),
        "seen_in_sink": seen,
        "matched": [
            {"date": _day(t).isoformat(), "amount": round(abs(float(t.get("amount") or 0)), 2),
             "label": display_name(t) or "Transfer"}
            for t in hits
        ],
    }


# ── candidates and the suggested rule ────────────────────────────────────────

async def fill_candidates(
    uid: str, source_id: str, pot_ids: list[str], account_map: dict[str, dict],
) -> dict:
    """Recent debit series that have corroborated own-transfer legs in a pot.

    A goal rule must never be suggested from ordinary purchases. Pairing stays
    deliberately conservative: distinct owned source/pot accounts, same-day
    exact amount, and transfer evidence on both legs. The latter makes
    an amount coincidence between unrelated accounts a miss, not an invented
    transfer identity.
    """
    today = timeutil.user_today()
    start = today - timedelta(days=CANDIDATE_WINDOW_DAYS)
    debits = await _load(uid, [source_id], "debit", start, today)
    credits = await _load(uid, [p for p in pot_ids if p != source_id], "credit", start, today)

    groups: dict[str, list[dict]] = defaultdict(list)
    for t in debits:
        groups[series_key(t)].append(t)

    def _account_tokens(account_ids: list[str]) -> set[str]:
        tokens: set[str] = set()
        for account_id in account_ids:
            account = account_map.get(str(account_id)) or {}
            for raw in (account_id, account.get("name"), account.get("display_name")):
                token = re.sub(r"[^a-z0-9]", "", str(raw or "").lower())
                if len(token) >= 4:
                    tokens.add(token)
        return tokens

    def transfer_evidence(t: dict, counterpart_ids: list[str]) -> bool:
        category = t.get("custom_category") or t.get("category")
        if category in {"Transfer", "Savings", "Debt", "Investment"}:
            return True
        # Free text is evidence only when it names a known counterpart AND
        # names a bank-transfer rail. A generic "from" or "to" appears in
        # plenty of purchase narratives and must not turn an amount/date
        # coincidence into an own transfer.
        text = re.sub(r"[^a-z0-9]", "", f"{t.get('merchant_name') or ''} {t.get('description') or ''}".lower())
        raw = f"{t.get('merchant_name') or ''} {t.get('description') or ''}".lower()
        rail = re.search(r"\b(?:transfer|standing\s+order|faster\s+payment)\b", raw)
        return bool(rail and any(token in text for token in _account_tokens(counterpart_ids)))

    credits_by_key: dict[tuple, list[dict]] = defaultdict(list)
    for c in credits:
        credits_by_key[(_day(c), round(abs(float(c.get("amount") or 0)), 2))].append(c)

    items: list[dict] = []
    best = None
    for key, members in groups.items():
        members.sort(key=lambda t: t["date"], reverse=True)
        latest = members[0]
        matched_pots: set[str] = set()
        paired = 0
        pending = {pair_key: list(pair_credits) for pair_key, pair_credits in credits_by_key.items()}
        for m in members:
            k = (_day(m), round(abs(float(m.get("amount") or 0)), 2))
            pool = pending.get(k, [])
            if not transfer_evidence(m, pot_ids):
                continue
            match_index = next((
                i for i, c in enumerate(pool)
                if str(c.get("account_id") or "") in pot_ids and transfer_evidence(c, [source_id])
            ), None)
            if match_index is not None:
                credit = pool.pop(match_index)
                matched_pots.add(str(credit.get("account_id")))
                paired += 1
        if not paired:
            continue
        item = {
            "series_key": key,
            "display_name": display_name(latest) or key,
            "last_amount": round(abs(float(latest.get("amount") or 0)), 2),
            "last_date": _day(latest).isoformat(),
            "occurrences_90d": len(members),
            "is_transfer": True,
            "matched_pot_ids": [pot_id for pot_id in pot_ids if pot_id in matched_pots],
        }
        items.append(item)
        # `pot_ids` preserves the selected pot first. A matching selected
        # sink wins over a more frequent alternate transfer series.
        selected = bool(pot_ids and pot_ids[0] in matched_pots)
        score = (selected, paired, item["last_date"])
        if best is None or score > best[0]:
            best = (score, item, members)
    items.sort(
        key=lambda c: (bool(pot_ids and pot_ids[0] in c["matched_pot_ids"]), c["last_date"]),
        reverse=True,
    )

    suggestion = None
    if best is not None:
        _score, item, members = best
        rule = {"match_type": "description_contains", "match_value": item["display_name"]}
        if not all(rule_matches(rule, m) for m in members[:1]):
            # The cleaned display name must match its own debit, or fall back
            # to the raw description; otherwise offer nothing rather than a
            # rule that would never fire.
            raw = str(members[0].get("description") or "").strip()[:_MAX_MATCH_VALUE]
            rule = {"match_type": "description_contains", "match_value": raw}
            if not raw or not rule_matches(rule, members[0]):
                rule = None
        if rule:
            suggestion = {**rule, "fill_display_name": rule["match_value"],
                          "last_amount": item["last_amount"], "last_date": item["last_date"],
                          "occurrences_90d": item["occurrences_90d"]}
    return {"items": items, "suggestion": suggestion}
