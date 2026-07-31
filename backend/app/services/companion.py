"""Companion spine — rhythm-aware today-engine.

Computes up to 3 items (moves first) for a user's home screen.
Zero LLM calls — all copy is deterministic from live data.
Zero hardcodes — computed generically for any user.
"""
import hashlib
import logging
import math
import re
from datetime import date, datetime, timedelta
from typing import Any

from app.db.collections import (
    accounts_col,
    yapily_accounts_col,
    cashflow_cache_col,
    preferences_col,
    behaviour_portrait_col,
    companion_items_col,
    needle_history_col,
)

log = logging.getLogger(__name__)
from app.routers.analytics import _build_cashflow_response


_WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]


def _weekday_name(d: date) -> str:
    return _WEEKDAYS[d.weekday()]


def _humanise_bill_name(name: str) -> str:
    """Human-friendly bill name for display: strip long references.

    'MTG 77243755'-style mortgage references render as 'mortgage payment';
    generically, digit-runs of 6+ chars are removed and whitespace tidied.
    """
    raw = (name or "").strip()
    if re.fullmatch(r"MTG[\s\-]*\d+", raw, re.IGNORECASE):
        return "mortgage payment"
    cleaned = re.sub(r"\d{6,}", "", raw)
    cleaned = re.sub(r"\s+", " ", cleaned).strip(" -–—_/").strip()
    return cleaned or "bill"


def _ceil5(amount: float) -> int:
    """Round up to nearest £5."""
    return math.ceil(amount / 5) * 5


def _shortfall_fingerprint(shortfall_tuples: list[tuple[str, int]]) -> str:
    """Stable 10-char hex fingerprint over sorted (account_id, bucketed_amount) pairs.

    bucketed_amount = nearest £50, preventing identity churn from £1-level drift
    while distinct problems produce distinct ids.
    """
    sorted_pairs = sorted(shortfall_tuples)
    raw = repr(sorted_pairs).encode()
    return hashlib.sha1(raw).hexdigest()[:10]


async def _live_balance(account_id: str) -> float | None:
    """Fetch current balance for a single account across all account collections."""
    from bson import ObjectId

    def _try_oid(v: str):
        try:
            return ObjectId(v)
        except Exception:
            return v

    oid = _try_oid(account_id)
    for col in (accounts_col, yapily_accounts_col):
        doc = await col.find_one(
            {"_id": oid},
            {"balance": 1, "current_balance": 1, "available_balance": 1},
        )
        if doc:
            bal = doc.get("balance") or doc.get("current_balance") or doc.get("available_balance") or 0.0
            return float(bal)
    return None


async def compute_today_items(uid: str) -> list[dict]:
    """Compute companion items for `uid`. Cap at 3, moves first."""

    # ── 1. Load cashflow cache + prefs (once — threaded through below) ──────
    cached = await cashflow_cache_col.find_one({"_id": uid})
    if not cached:
        return []

    prefs = await preferences_col.find_one({"user_id": uid}) or {}
    resp = await _build_cashflow_response(cached, uid=uid, prefs=prefs)

    # ── 2. Determine pay window ─────────────────────────────────────────────
    from app.services.pay_period import _next_payday as _calc_next_payday
    from app.services.income import get_confirmed_payday as _get_confirmed_payday

    pay_cfg = prefs.get("pay_period_config", {"type": "calendar_month"})
    today_d = date.today()
    confirmed_result = _get_confirmed_payday(prefs, today_d)
    if confirmed_result:
        next_pay, _ = confirmed_result
    else:
        next_pay = _calc_next_payday(today_d, pay_cfg)
    days_to_pay = (next_pay - today_d).days
    window_end = next_pay  # exclusive upper bound (bills with days_away < days_to_pay)

    window_bills = [b for b in resp["upcoming_bills"] if b["days_away"] < days_to_pay]
    window_income = [i for i in resp["upcoming_income"] if i["days_away"] < days_to_pay]

    # Skip bills with no balance data (credit cards / unknown accounts)
    assessable_bills = [
        b for b in window_bills
        if b.get("account_balance") is not None and b["account_balance"] >= 0
    ]

    # ── 3. Load ALL accounts ONCE; seed live balances from the same listing ─
    # (Single fetch pass replaces the old per-bill `$in` fetch here plus the
    # separate full listing in step 5 — same fields, one round trip per col.)
    all_uk_accounts: list[dict] = []
    _acct_proj = {"name": 1, "balance": 1, "current_balance": 1, "available_balance": 1,
                  "subtype": 1, "account_subtype": 1, "type": 1, "provider": 1, "currency": 1}
    async for acc in accounts_col.find({"user_id": uid}, _acct_proj):
        acc["_str_id"] = str(acc["_id"])
        all_uk_accounts.append(acc)
    async for acc in yapily_accounts_col.find({"user_id": uid}, {**_acct_proj, "institution_id": 1}):
        acc["_str_id"] = str(acc["_id"])
        all_uk_accounts.append(acc)

    live_balances: dict[str, float] = {
        acc["_str_id"]: float(
            acc.get("balance") or acc.get("current_balance") or acc.get("available_balance") or 0.0
        )
        for acc in all_uk_accounts
    }

    # ── 4. Running-balance simulation (same logic as at_risk_count) ─────────
    running: dict[str, float] = {}
    for b in assessable_bills:
        acct = b["account_id"] or "__unknown__"
        if acct not in running:
            running[acct] = live_balances.get(str(acct), float(b.get("account_balance") or 0))

    events: list[tuple[int, str, float, bool, dict]] = []
    for b in assessable_bills:
        events.append((b["days_away"], b["account_id"] or "__unknown__", float(b["amount"]), False, b))
    for i in window_income:
        for acct in list(running.keys()):
            events.append((i["days_away"], acct, float(i["amount"]), True, i))

    events.sort(key=lambda e: (e[0], 0 if e[3] else 1))

    # Track minimum running balance per account
    min_running: dict[str, float] = {k: v for k, v in running.items()}
    # Track the first bill that caused a shortfall per account
    shortfall_bill: dict[str, dict] = {}
    processed_income: set[tuple[int, str]] = set()

    for days_away, acct, amount, is_income, item in events:
        if is_income:
            key = (days_away, acct)
            if key not in processed_income:
                running[acct] = running.get(acct, 0.0) + amount
                processed_income.add(key)
        else:
            bal = running.get(acct, 0.0)
            if bal >= amount:
                running[acct] = bal - amount
                min_running[acct] = min(min_running.get(acct, bal - amount), bal - amount)
            else:
                # Bill bounces — ALWAYS debit running balance so next bill accumulates deficit
                new_bal = bal - amount
                running[acct] = new_bal
                min_running[acct] = min(min_running.get(acct, new_bal), new_bal)
                if new_bal < 0 and acct not in shortfall_bill:
                    shortfall_bill[acct] = item

    # ── 5. Source-selection helpers (accounts already loaded in step 3) ─────
    def _is_savings(acc: dict) -> bool:
        st = (acc.get("account_subtype") or acc.get("subtype") or "").upper()
        return "SAVING" in st or "ISA" in st

    def _is_current(acc: dict) -> bool:
        st = (acc.get("account_subtype") or acc.get("subtype") or "").upper()
        t = (acc.get("type") or "").upper()
        return "TRANSACTION" in st or "CURRENT" in st or t == "BANK"

    def _provider_of(acc: dict) -> str:
        return acc.get("provider") or acc.get("institution_id") or "Bank"

    # Compute per-account total upcoming bills in window (for source viability)
    acct_bills_total: dict[str, float] = {}
    for b in assessable_bills:
        a = b["account_id"] or "__unknown__"
        acct_bills_total[a] = acct_bills_total.get(a, 0.0) + float(b["amount"])

    # ── 6. Build MOVE items ─────────────────────────────────────────────────
    items: list[dict] = []
    dismissed = await _get_dismissed(uid)

    # Step 1: Collect shortfalls
    shortfalls = []  # (first_bounce_days_away, shortfall_amount, dest_acct, bill)
    for dest_acct, min_bal in min_running.items():
        if min_bal >= 0 or dest_acct == "__unknown__":
            continue
        bill = shortfall_bill.get(dest_acct)
        if not bill:
            continue
        shortfalls.append((bill["days_away"], abs(min_bal), dest_acct, bill))
    shortfalls.sort(key=lambda t: (t[0], -t[1]))  # most urgent, then largest

    # Step 2: Track remaining source capacity across successive moves
    source_capacity: dict[str, float] = {}
    for acc in all_uk_accounts:
        sid = acc["_str_id"]
        bal = live_balances.get(sid, float(acc.get("balance") or 0))
        if _is_current(acc):
            source_capacity[sid] = bal - acct_bills_total.get(sid, 0.0)
        elif _is_savings(acc):
            source_capacity[sid] = bal

    # Step 3: For every shortfall, find a source (split across multiple if needed)
    covered: list[dict] = []     # each entry = list of leg dicts
    uncovered: list[dict] = []
    dest_summaries: dict[str, dict] = {}

    for _days_away, _shortfall_amt, dest_acct, bill in shortfalls:
        shortfall = abs(min_running[dest_acct])
        amount_needed = _ceil5(shortfall) + 10

        # Bill details
        bill_name = bill.get("name", "bill")
        bill_amount = int(round(float(bill.get("amount", 0))))
        bill_date = date.fromisoformat(bill["expected_date"])
        bill_weekday = _weekday_name(bill_date)

        # Destination account details
        dest_name = bill.get("account_name") or dest_acct
        dest_provider = "Bank"
        dest_balance = live_balances.get(dest_acct, 0.0)
        for acc in all_uk_accounts:
            if acc["_str_id"] == dest_acct:
                dest_name = acc.get("name", dest_name)
                dest_provider = _provider_of(acc)
                dest_balance = live_balances.get(dest_acct, float(acc.get("balance") or 0))
                break

        # Fan-in destination summary: ALL of this account's in-window bills that land
        # before its first income event (income sorts before bills on the same day,
        # so a bill on the income day is excluded — income covers it).
        first_income_day = min((i["days_away"] for i in window_income), default=None)
        dest_bills = sorted(
            (
                b for b in assessable_bills
                if (b["account_id"] or "__unknown__") == dest_acct
                and (first_income_day is None or b["days_away"] < first_income_day)
            ),
            key=lambda b: b["days_away"],
        )
        if not dest_bills:
            dest_bills = [bill]
        dest_summaries[dest_acct] = {
            "account_id": dest_acct,
            "name": dest_name,
            "provider": dest_provider,
            "balance": float(dest_balance),
            "needs_total": int(round(sum(float(b["amount"]) for b in dest_bills))),
            "needs_by": _weekday_name(date.fromisoformat(dest_bills[0]["expected_date"])),
            "bills": [
                {"label": _humanise_bill_name(b.get("name", "bill")), "amount": int(round(float(b["amount"])))}
                for b in dest_bills
            ],
        }

        def _build_move_map(src_id, src_name, src_provider, src_balance, src_own_bills, leg_amount):
            if src_own_bills > 0:
                safe_note = f"Covers its own £{int(round(src_own_bills)):,} of bills with room to spare"
            else:
                safe_note = f"Nothing due from this account before {bill_weekday}"
            human_bill = _humanise_bill_name(bill_name)
            incoming = f"£{bill_amount:,} {human_bill} lands {bill_weekday}"
            return {
                "from": {
                    "account_id": src_id,
                    "name": src_name,
                    "provider": src_provider,
                    "balance": float(src_balance),
                    "safe_note": safe_note,
                },
                "to": {
                    "account_id": dest_acct,
                    "name": dest_name,
                    "provider": dest_provider,
                    "balance": float(dest_balance),
                    "incoming": incoming,
                },
            }

        # Build ordered candidate sources: current accounts first, then savings
        candidate_sources = []
        for acc in all_uk_accounts:
            sid = acc["_str_id"]
            if sid == dest_acct:
                continue
            if _is_current(acc):
                if min_running.get(sid, 0.0) < 0:
                    continue  # skip accounts that are themselves short
                headroom = source_capacity.get(sid, 0.0) - 10  # keep £10 buffer
                if headroom >= 5:
                    candidate_sources.append(("current", sid, acc, headroom))
        for acc in all_uk_accounts:
            sid = acc["_str_id"]
            if sid == dest_acct:
                continue
            if _is_savings(acc):
                headroom = source_capacity.get(sid, 0.0)
                if headroom >= 5:
                    candidate_sources.append(("savings", sid, acc, headroom))

        # Build legs (without headline — assigned below once we know total leg count)
        legs = []
        remaining = amount_needed
        for src_type, sid, acc, headroom in candidate_sources:
            if remaining <= 0:
                break
            leg_amount = min(remaining, headroom)
            # Floor partial legs to nearest £5; final leg takes exact remainder
            if leg_amount < remaining:
                leg_amount = math.floor(leg_amount / 5) * 5
            if leg_amount < 5:
                continue
            src_name = acc.get("name", sid)
            src_balance = live_balances.get(sid, float(acc.get("balance") or 0))
            src_provider = _provider_of(acc)
            src_own_bills = acct_bills_total.get(sid, 0.0)
            move_map = _build_move_map(sid, src_name, src_provider, src_balance, src_own_bills, leg_amount)
            legs.append({
                "amount": leg_amount,
                "dest_acct": dest_acct,
                "dest_name": dest_name,
                "bill_name": bill_name,
                "bill_amount": bill_amount,
                "bill_weekday": bill_weekday,
                "shortfall": shortfall,
                "move_map": move_map,
                "_src_name": src_name,
            })
            source_capacity[sid] = source_capacity.get(sid, 0.0) - leg_amount
            remaining -= leg_amount

        # Assign headlines now that we know the total number of legs for this shortfall
        if len(legs) == 1:
            legs[0]["headline"] = f"Move £{legs[0]['amount']:,} to {dest_name}"
        else:
            for leg in legs:
                leg["headline"] = f"Move £{leg['amount']:,} from {leg['_src_name']}"

        if legs:
            covered.extend(legs)
        else:
            uncovered.append({
                "dest_acct": dest_acct,
                "dest_name": dest_name,
                "dest_provider": dest_provider,
                "dest_balance": dest_balance,
                "bill_name": bill_name,
                "bill_amount": bill_amount,
                "bill_weekday": bill_weekday,
                "shortfall": shortfall,
            })

    # Step 4: Residual honesty — replicate pooled verdict maths
    def _sts_is_savings(acc):
        return "saving" in (acc.get("subtype") or "").lower()

    def _sts_is_credit(acc):
        return (
            "credit" in (acc.get("type") or "").lower()
            or "credit" in (acc.get("subtype") or "").lower()
        )

    pooled = 0.0
    for acc in all_uk_accounts:
        if str(acc.get("currency", "GBP")).upper() not in {"GBP", ""}:
            continue
        bal = float(acc.get("balance") or 0)
        if _sts_is_savings(acc) or _sts_is_credit(acc) or bal < 0:
            continue
        pooled += bal

    _ev = [(b["days_away"], -float(b["amount"])) for b in resp["upcoming_bills"] if 0 <= b["days_away"] < days_to_pay]
    _ev += [(i["days_away"], float(i["amount"])) for i in resp["upcoming_income"] if 0 <= i["days_away"] < days_to_pay]
    _ev.sort(key=lambda e: (e[0], 0 if e[1] > 0 else 1))
    _run = pooled
    pooled_min = _run
    for _d, _delta in _ev:
        _run += _delta
        pooled_min = min(pooled_min, _run)

    residual: str | None = None
    # Check if any shortfall was only partially covered
    partially_covered_gap = 0.0
    for _days_away, _shortfall_amt, dest_acct, bill in shortfalls:
        amount_needed = _ceil5(abs(min_running[dest_acct])) + 10
        covered_for_dest = sum(
            leg["amount"] for leg in covered if leg["dest_acct"] == dest_acct
        )
        gap = amount_needed - covered_for_dest
        if gap > 4:
            partially_covered_gap += gap

    if partially_covered_gap > 0.5:
        covered_total = sum(leg["amount"] for leg in covered)
        residual = (
            f"These moves cover £{covered_total:,}, but the window still runs "
            f"£{int(round(partially_covered_gap))} short — one payment may need a different plan."
        )
    elif pooled_min < -0.5:
        residual = (
            f"Even with these moves, the window runs £{int(round(abs(pooled_min)))} short "
            f"— one payment may need a different plan."
        )

    # Build per-dest bucketed amounts for fingerprinting
    dest_bucketed: dict[str, int] = {}
    for _da, _sa, dest_acct_fp, _bill in shortfalls:
        _amount_needed_fp = _ceil5(abs(min_running[dest_acct_fp])) + 10
        dest_bucketed[dest_acct_fp] = round(_amount_needed_fp / 50) * 50

    plan_fp = _shortfall_fingerprint([(d, b) for d, b in dest_bucketed.items()])

    # Step 5: Emission
    n_covered = len(covered)
    if n_covered == 1:
        m = covered[0]
        dest_acct = m["dest_acct"]
        _move_fp = _shortfall_fingerprint([(dest_acct, dest_bucketed.get(dest_acct, 0))])
        item_id = f"move:{dest_acct}:{window_end.isoformat()}:{_move_fp}"
        if item_id not in dismissed:
            existing = await companion_items_col.find_one({"_id": item_id, "uid": uid})
            if not (existing and existing.get("status") == "done"):
                headline = m["headline"]
                bill_name = m["bill_name"]
                bill_amount = m["bill_amount"]
                dest_name = m["dest_name"]
                shortfall = m["shortfall"]
                source_name = m["move_map"]["from"]["name"]
                amount_needed = m["amount"]
                move_map = m["move_map"]
                # "covers it" only when no residual gap remains for this shortfall
                _covers_phrase = "covers it." if partially_covered_gap <= 0.5 else "covers most of it."
                body = (
                    f"Your £{bill_amount} {bill_name} lands {m['bill_weekday']} from {dest_name}. "
                    f"It's £{int(round(shortfall))} short. "
                    f"Moving £{amount_needed} from {source_name} {_covers_phrase}"
                )
                item_doc = {
                    "_id": item_id,
                    "uid": uid,
                    "type": "move",
                    "status": "active",
                    "headline": headline,
                    "body": body,
                    "action": {"label": "View accounts", "route": "/accounts"},
                    "estimated": False,
                    "move_map": move_map,
                    "created_at": datetime.utcnow(),
                    "_dest_acct": dest_acct,
                    "_source_acct": move_map["from"]["account_id"],
                    "_bill_name": bill_name,
                    "_bill_amount": bill_amount,
                    "_window_end": window_end.isoformat(),
                }
                if residual is not None:
                    item_doc["residual"] = residual
                item_doc["plan_dest"] = dest_summaries[dest_acct]
                item_doc["covered"] = partially_covered_gap <= 0.5
                item_doc["amount"] = m["amount"]
                await companion_items_col.update_one(
                    {"_id": item_id, "uid": uid},
                    {"$set": {k: v for k, v in item_doc.items() if k != "_id"}},
                    upsert=True,
                )
                emit = {
                    "id": item_id,
                    "type": "move",
                    "headline": headline,
                    "body": body,
                    "action": {"label": "View accounts", "route": "/accounts"},
                    "estimated": False,
                    "move_map": move_map,
                }
                if residual is not None:
                    emit["residual"] = residual
                emit["plan_dest"] = dest_summaries[dest_acct]
                emit["covered"] = partially_covered_gap <= 0.5
                emit["amount"] = m["amount"]
                items.append(emit)

    elif n_covered >= 2:
        item_id = f"plan:{window_end.isoformat()}:{plan_fp}"
        if item_id not in dismissed:
            existing = await companion_items_col.find_one({"_id": item_id, "uid": uid})
            if not (existing and existing.get("status") == "done"):
                total = sum(m["amount"] for m in covered)
                n = len(covered)
                fully_covered = (partially_covered_gap <= 0.5)
                if fully_covered:
                    summary = f"£{total:,} across {n} moves keeps everything clearing."
                else:
                    summary = f"£{total:,} across {n} moves covers most of it."
                headline = "Cover this week's payments"
                item_doc = {
                    "_id": item_id,
                    "uid": uid,
                    "type": "move",
                    "status": "active",
                    "headline": headline,
                    "body": summary,
                    "action": {"label": "View accounts", "route": "/accounts"},
                    "estimated": False,
                    "created_at": datetime.utcnow(),
                    "_dest_accts": list({m["dest_acct"] for m in covered}),
                    "_window_end": window_end.isoformat(),
                    "_total": total,
                }
                if residual is not None:
                    item_doc["residual"] = residual
                item_doc["plan_dest"] = dest_summaries[covered[0]["dest_acct"]]
                item_doc["covered"] = fully_covered
                await companion_items_col.update_one(
                    {"_id": item_id, "uid": uid},
                    {"$set": {k: v for k, v in item_doc.items() if k != "_id"}},
                    upsert=True,
                )
                emit = {
                    "id": item_id,
                    "type": "move",
                    "headline": headline,
                    "body": summary,
                    "action": {"label": "View accounts", "route": "/accounts"},
                    "estimated": False,
                    "moves": [{"headline": m["headline"], "amount": m["amount"], "move_map": m["move_map"]} for m in covered],
                    "summary": summary,
                }
                if residual is not None:
                    emit["residual"] = residual
                emit["plan_dest"] = dest_summaries[covered[0]["dest_acct"]]
                emit["covered"] = fully_covered
                items.append(emit)

    # Uncovered shortfalls: emit "no easy cover" variant, capped so len(items) < 2
    for u in uncovered:
        if len(items) >= 2:
            break
        dest_acct = u["dest_acct"]
        dest_name = u["dest_name"]
        shortfall = u["shortfall"]
        bill_name = u["bill_name"]
        bill_amount = u["bill_amount"]
        bill_weekday = u["bill_weekday"]
        _move_fp = _shortfall_fingerprint([(dest_acct, dest_bucketed.get(dest_acct, 0))])
        item_id = f"move:{dest_acct}:{window_end.isoformat()}:{_move_fp}"
        if item_id in dismissed:
            continue
        existing = await companion_items_col.find_one({"_id": item_id, "uid": uid})
        if existing and existing.get("status") == "done":
            continue
        headline = f"£{int(round(shortfall))} gap before {dest_name} payday"
        body = (
            f"Your £{bill_amount} {bill_name} lands {bill_weekday}, "
            f"but {dest_name} is £{int(round(shortfall))} short "
            f"and there's no easy transfer source right now."
        )
        item_doc = {
            "_id": item_id,
            "uid": uid,
            "type": "move",
            "status": "active",
            "headline": headline,
            "body": body,
            "action": None,
            "estimated": False,
            "created_at": datetime.utcnow(),
            "_dest_acct": dest_acct,
            "_no_source": True,
            "_window_end": window_end.isoformat(),
        }
        await companion_items_col.update_one(
            {"_id": item_id, "uid": uid},
            {"$set": {k: v for k, v in item_doc.items() if k != "_id"}},
            upsert=True,
        )
        items.append({
            "id": item_id,
            "type": "move",
            "headline": headline,
            "body": body,
            "action": None,
            "estimated": False,
        })

    # ── 7. Auto-verification pass: flip previously "active" moves to "done" ─
    celebration_items: list[dict] = []
    async for stored in companion_items_col.find(
        {"uid": uid, "type": "move", "status": "active", "_celebrated": {"$ne": True}}
    ):
        stored_dest = stored.get("_dest_acct")
        stored_window = stored.get("_window_end", "")
        stored_id = stored["_id"]
        if stored_id in dismissed:
            continue
        # If the stored item is already emitted in this run, skip
        if any(i["id"] == stored_id for i in items):
            continue
        # Check if window still open
        if stored_window and date.fromisoformat(stored_window) < today_d:
            await companion_items_col.update_one(
                {"_id": stored_id, "uid": uid},
                {"$set": {"status": "expired"}},
            )
            continue
        # Handle plan docs (multiple dest accounts)
        stored_dest_accts = stored.get("_dest_accts")
        if stored_dest_accts and isinstance(stored_dest_accts, list) and len(stored_dest_accts) > 0:
            if all(min_running.get(d, 0.0) >= 0 for d in stored_dest_accts):
                stored_total = stored.get("_total", 0)
                await companion_items_col.update_one(
                    {"_id": stored_id, "uid": uid},
                    {"$set": {"status": "done", "_celebrated": True}},
                )
                cel_id = f"celebrate:{stored_id}"
                if cel_id not in dismissed:
                    celebration_items.append({
                        "id": cel_id,
                        "type": "celebration",
                        "headline": "Sorted — this week's payments are covered",
                        "body": f"£{stored_total:,} of payments are safe.",
                        "action": None,
                        "estimated": False,
                    })
            continue
        # Single-dest logic (unchanged)
        if stored_dest and min_running.get(stored_dest, 0.0) >= 0:
            bill_name = stored.get("_bill_name", "bill")
            bill_amount = stored.get("_bill_amount", 0)
            dest_name_stored = stored.get("headline", "").replace("Move £", "").split(" to ")[-1] if "to " in stored.get("headline", "") else stored_dest
            await companion_items_col.update_one(
                {"_id": stored_id, "uid": uid},
                {"$set": {"status": "done", "_celebrated": True}},
            )
            cel_id = f"celebrate:{stored_id}"
            if cel_id not in dismissed:
                celebration_items.append({
                    "id": cel_id,
                    "type": "celebration",
                    "headline": f"Sorted — {dest_name_stored} is covered",
                    "body": f"The £{bill_amount} {bill_name} is safe.",
                    "action": None,
                    "estimated": False,
                })

    # ── 8. RHYTHM items ─────────────────────────────────────────────────────
    rhythm_items: list[dict] = []
    portrait = await behaviour_portrait_col.find_one({"_id": uid})
    if portrait and portrait.get("status") == "ok":
        traits_by_id = {t["id"]: t for t in portrait.get("traits", [])}
        today_obj = date.today()
        year_month = today_obj.strftime("%Y-%m")

        # front_loader: within 3 days BEFORE the 1st of next month
        next_month_1st = (today_obj.replace(day=1) + timedelta(days=32)).replace(day=1)
        days_to_month_end = (next_month_1st - today_obj).days

        if "front_loader" in traits_by_id and 0 < days_to_month_end <= 3:
            trait = traits_by_id["front_loader"]
            evidence = trait.get("evidence", [])
            # Extract avg early-month from evidence e.g. "£300 average early-month spend"
            avg_early_month = 0
            for ev in evidence:
                if "average early-month spend" in ev:
                    try:
                        avg_early_month = int(float(ev.split("£")[1].split(" ")[0].replace(",", "")))
                    except Exception:
                        pass

            # Current cash across current accounts
            current_cash = sum(
                live_balances.get(acc["_str_id"], float(acc.get("balance") or 0))
                for acc in all_uk_accounts
                if _is_current(acc)
            )

            rid = f"rhythm:cliff:{year_month}"
            if rid not in dismissed:
                headline = f"Your heavy week starts {next_month_1st.strftime('%-d %b')}"
                body = (
                    f"Around £{avg_early_month} of commitments land in the first 7 days. "
                    f"Right now you hold £{int(round(current_cash))} across current accounts. · estimated"
                )
                rhythm_items.append({
                    "id": rid,
                    "type": "rhythm",
                    "headline": headline,
                    "body": body,
                    "action": None,
                    "estimated": True,
                })

        # credit_switch: day 8, 9 or 10 of the month
        if "credit_switch" in traits_by_id and today_obj.day in (8, 9, 10):
            trait = traits_by_id["credit_switch"]
            evidence = trait.get("evidence", [])
            early_pct = late_pct = None
            for ev in evidence:
                if "Credit card share:" in ev:
                    try:
                        parts = ev.split(":")[1].strip()
                        e_part, l_part = parts.split(",")
                        early_pct = int(e_part.strip().split("%")[0])
                        late_pct = int(l_part.strip().split("%")[0])
                    except Exception:
                        pass

            rid = f"rhythm:switch:{year_month}"
            if rid not in dismissed:
                if early_pct is not None and late_pct is not None:
                    card_desc = f"({early_pct}% → {late_pct}% of spending)"
                else:
                    card_desc = ""
                headline = "Card season"
                body = (
                    f"This is the week your cards usually take over {card_desc}. "
                    f"Nothing to do — just so it doesn't sneak up."
                )
                rhythm_items.append({
                    "id": rid,
                    "type": "rhythm",
                    "headline": headline,
                    "body": body,
                    "action": None,
                    "estimated": False,
                })

        # saving_habit streak celebration
        if "saving_habit" in traits_by_id:
            trait = traits_by_id["saving_habit"]
            evidence = trait.get("evidence", [])
            streak = 0
            for ev in evidence:
                m = re.search(r"(\d+)-week", ev)
                if m:
                    streak = int(m.group(1))
                    break

            if streak >= 4:
                n = (streak // 4) * 4
                last_celebrated = portrait.get("last_streak_celebrated", 0)
                if n > last_celebrated:
                    rid = f"celebrate:streak:{n}"
                    if rid not in dismissed:
                        # Update portrait to mark this n as celebrated
                        await behaviour_portrait_col.update_one(
                            {"_id": uid},
                            {"$set": {"last_streak_celebrated": n}},
                        )
                        celebration_items.append({
                            "id": rid,
                            "type": "celebration",
                            "headline": f"{n} weeks of saving, unbroken",
                            "body": "Still going. That habit is yours.",
                            "action": None,
                            "estimated": False,
                        })

    # ── 8b. NEEDLE item (period close reward) ──────────────────────────────
    needle_items: list[dict] = []
    try:
        from app.services.needle import compute_needle
        from app.services.pay_period import get_pay_period_for_date, prev_pay_period as _prev_pay_period

        # Check if today is within 3 days AFTER a period close
        # i.e., the current period started 0-2 days ago
        curr_start, curr_end = get_pay_period_for_date(today_d, pay_cfg)
        days_into_period = (today_d - curr_start).days  # 0 = first day of period

        if 0 <= days_into_period <= 2:
            # The just-closed period
            closed_start, closed_end = _prev_pay_period(curr_start, pay_cfg)
            needle_id = f"needle:{closed_end.isoformat()}"
            if needle_id not in dismissed:
                # Try stored needle first (idempotent)
                stored_needle = await needle_history_col.find_one({"_id": f"{uid}:{closed_end.isoformat()}"})
                if stored_needle and "lines" in stored_needle:
                    needle_doc = stored_needle
                else:
                    needle_doc = await compute_needle(uid, closed_start, closed_end)

                lines = needle_doc.get("lines", {})
                headline_txt = lines.get("headline", "Your month, closed.")
                body_parts = []
                if lines.get("movement"):
                    body_parts.append(lines["movement"])
                if lines.get("cash"):
                    body_parts.append(lines["cash"])
                if lines.get("streak"):
                    body_parts.append(lines["streak"])
                body_txt = " ".join(body_parts)

                # Store card_delta so frontend can apply correct accent colour
                needle_items.append({
                    "id": needle_id,
                    "type": "needle",
                    "headline": headline_txt,
                    "body": body_txt,
                    "action": {"label": "Play your month ›", "route": "/month/story?which=last"},
                    "estimated": False,
                    # Extra metadata for frontend accent — won't break existing CompanionItem shape
                    # (frontend ignores unknown fields gracefully)
                    "_card_delta": needle_doc.get("card_delta", 0),
                    "_period_end": closed_end.isoformat(),
                })
    except Exception as _needle_exc:
        log.warning("needle item failed for %s: %s", uid, _needle_exc)

    # ── 9. Merge and cap at 3 ───────────────────────────────────────────────
    # needle is priority above rhythm but below moves/celebrations
    result = items[:2] + celebration_items[:1] + needle_items[:1] + rhythm_items
    return result[:3]


async def _get_dismissed(uid: str) -> set[str]:
    """Load dismissed item IDs for this user."""
    doc = await companion_items_col.find_one({"_id": f"dismissed:{uid}"})
    if not doc:
        return set()
    return set(doc.get("ids", []))


async def dismiss_item(uid: str, item_id: str) -> None:
    """Persist a dismissed item id so it never shows again."""
    await companion_items_col.update_one(
        {"_id": f"dismissed:{uid}"},
        {"$addToSet": {"ids": item_id}},
        upsert=True,
    )
