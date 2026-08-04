"""Companion spine — rhythm-aware today-engine.

Computes up to 3 items (moves first, one card per at-risk destination account) for a user's home screen.
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
    manual_accounts_col,
    cashflow_cache_col,
    preferences_col,
    behaviour_portrait_col,
    companion_items_col,
    needle_history_col,
)

log = logging.getLogger(__name__)
from app.routers.analytics import _build_cashflow_response, income_credit_ok


_WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]

# At most this many cover/gap cards render at once. Anything beyond is disclosed
# honestly on the last card rather than silently dropped.
_MOVE_CARD_CAP = 2


def _weekday_name(d: date) -> str:
    return _WEEKDAYS[d.weekday()]


# Industry display aliases (applied before general cleanup)
_BILL_ALIASES: list[tuple[re.Pattern, str]] = [
    (re.compile(r"\bB/CARD\b", re.IGNORECASE), "Barclaycard"),
    (re.compile(r"\bDDR\b", re.IGNORECASE), ""),
    (re.compile(r"\bDD\b(?=\s|$)", re.IGNORECASE), ""),
    (re.compile(r"\bSTO\b(?=\s|$)", re.IGNORECASE), ""),
]


def _humanise_bill_name(name: str) -> str:
    """Human-friendly bill name for display.

    Rules (applied in order):
    1. MTG <digits> → "mortgage payment" (keep existing rule).
    2. If the name is already mixed-case (has both upper and lower letters),
       only strip card-fragment patterns and long digit runs — leave the rest.
    3. Otherwise (bank ALL-CAPS names):
       a. Apply industry aliases (B/CARD, DDR, DD suffix, STO suffix).
       b. Strip digit runs of ≥4 chars.
       c. Strip card-fragment patterns like "3766–32000" / "3766-32000".
       d. Strip trailing account-ref tokens (1–2 char ALL-CAPS at end).
       e. Collapse whitespace; trim dangling separators (-, /, ·, –, —, _).
       f. Title-case remaining ALL-CAPS words (≥3 chars).
    """
    raw = (name or "").strip()
    if not raw:
        return "bill"

    # Rule 1: mortgage shorthand
    if re.fullmatch(r"MTG[\s\-]*\d+", raw, re.IGNORECASE):
        return "mortgage payment"

    # Rule 2: mixed-case pass-through — only strip noise, don't recase
    has_lower = bool(re.search(r"[a-z]", raw))
    has_upper = bool(re.search(r"[A-Z]", raw))
    if has_lower and has_upper:
        # Just strip long digit runs and card-fragment patterns, tidy whitespace
        cleaned = re.sub(r"\d{4,}", "", raw)
        cleaned = re.sub(r"\b\d{4}[\s\-–—]\d{2,}\b", "", cleaned)
        cleaned = re.sub(r"\s+", " ", cleaned).strip(" -–—_/·").strip()
        return cleaned or "bill"

    # Rule 3: ALL-CAPS bank names — full normalisation pipeline
    cleaned = raw

    # 3a. Industry aliases
    for pattern, replacement in _BILL_ALIASES:
        cleaned = pattern.sub(replacement, cleaned)

    # 3b. Strip digit runs ≥4 chars
    cleaned = re.sub(r"\d{4,}", "", cleaned)

    # 3c. Strip card-fragment patterns (e.g. "3766–32000", "3766-32000")
    cleaned = re.sub(r"\b\d{4}[\s\-–—]\d{2,}\b", "", cleaned)

    # 3d. Strip trailing 1–2 char ALL-CAPS tokens (the "VG", "D" residue)
    cleaned = re.sub(r"\s+[A-Z]{1,2}$", "", cleaned)

    # 3e. Collapse whitespace; trim dangling separators
    cleaned = re.sub(r"\s+", " ", cleaned).strip(" -–—_/·").strip()

    # 3f. Title-case ALL-CAPS words ≥3 chars (MAN, FEE etc title-case; 1-2 char tokens
    #     like "DD", "VG" are already stripped in step 3d before reaching here).
    def _title_word(m: re.Match) -> str:
        w = m.group(0)
        return w.title() if len(w) >= 3 and w.isupper() else w

    cleaned = re.sub(r"[A-Za-z]+", _title_word, cleaned)

    return cleaned or "bill"


def _ceil5(amount: float) -> int:
    """Round up to nearest £5."""
    return math.ceil(amount / 5) * 5


def _clean_name(name: str | None, fallback: str = "") -> str:
    """Account names arrive from providers padded with whitespace; user-facing
    copy must never carry it."""
    return " ".join(str(name or "").split()) or fallback


# Raw provider/account ids are 16+ hex chars — they must never reach copy.
_RAW_ID_RE = re.compile(r"^[0-9a-fA-F]{16,}$")


def _display_name_ok(name: str | None) -> bool:
    """True when `name` is usable user-facing copy — non-empty and not a raw
    provider/account id."""
    return bool(name) and not _RAW_ID_RE.fullmatch(str(name))


async def _lookup_account_name(account_id: str) -> str | None:
    """Live display-name lookup for an account id across all account collections."""
    from bson import ObjectId

    ids: list = [account_id]
    try:
        ids.append(ObjectId(account_id))
    except Exception:
        pass
    for col in (accounts_col, yapily_accounts_col, manual_accounts_col):
        for _id in ids:
            doc = await col.find_one({"_id": _id}, {"name": 1})
            if doc:
                return _clean_name(doc.get("name")) or None
    return None


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


# ── Module-level account classifiers ──────────────────────────────────────────
# Lifted out of compute_today_items so the offline pass can share them without
# re-defining inside the closure. Logic is byte-identical to the former nested defs.

def _is_savings(acc: dict) -> bool:
    st = (acc.get("account_subtype") or acc.get("subtype") or "").upper()
    return "SAVING" in st or "ISA" in st


def _is_current(acc: dict) -> bool:
    st = (acc.get("account_subtype") or acc.get("subtype") or "").upper()
    t = (acc.get("type") or "").upper()
    return "TRANSACTION" in st or "CURRENT" in st or t == "BANK"


def _is_offline(acc: dict) -> bool:
    """Manually-tracked (offline) accounts — real cash or a wallet the user
    moves by hand. Flagged on the normalised dicts built in compute_today_items;
    they never carry the type/subtype fields the other two classifiers read."""
    return bool(acc.get("_offline"))


async def compute_today_items(uid: str) -> list[dict]:
    """Compute companion items for `uid`. Cap at 3, moves first (one card per at-risk destination)."""

    # ── 1. Load cashflow cache + prefs (once — threaded through below) ──────
    cached = await cashflow_cache_col.find_one({"_id": uid})
    if not cached:
        return []

    prefs = await preferences_col.find_one({"user_id": uid}) or {}
    excluded_sources = {str(a) for a in (prefs.get("cover_plan_excluded_accounts") or [])}
    confirmed_income_keys = {
        s.get("key") for s in (prefs.get("income_streams") or [])
        if s.get("status") == "confirmed"
    }
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

    # Offline (manually-tracked) accounts are legitimate cover-plan SOURCES —
    # the user just makes the transfer by hand. They stay OUT of
    # all_uk_accounts on purpose: that list drives the pooled verdict, the
    # rhythm cash sum and destination lookups, none of which should change.
    # Manual credit cards are never a source.
    offline_accounts: list[dict] = []
    async for _macc in manual_accounts_col.find(
        {"user_id": uid}, {"name": 1, "balance": 1, "account_type": 1}
    ):
        if (_macc.get("account_type") or "") == "credit_card":
            continue
        offline_accounts.append({
            "_id": _macc["_id"],
            "_str_id": str(_macc["_id"]),
            "_offline": True,
            "name": _macc.get("name") or "Offline account",
            "balance": float(_macc.get("balance") or 0.0),
            "provider": "Offline",
        })
    for _oacc in offline_accounts:
        live_balances[_oacc["_str_id"]] = _oacc["balance"]

    # ── 4. Running-balance simulation (same logic as at_risk_count) ─────────
    running: dict[str, float] = {}
    for b in assessable_bills:
        acct = b["account_id"] or "__unknown__"
        if acct not in running:
            running[acct] = live_balances.get(str(acct), float(b.get("account_balance") or 0))

    # Income is credited ONLY to the account its history actually landed in,
    # and only when the prediction is reliable (income_credit_ok) — a cover
    # plan's arithmetic must never lean on money that might land elsewhere.
    # credited_incomes records what each account's walk actually assumed, so
    # plans can disclose it (assumed_incomes) and note what they excluded.
    events: list[tuple[int, str, float, bool, dict]] = []
    credited_incomes: dict[str, list[dict]] = {}
    for b in assessable_bills:
        events.append((b["days_away"], b["account_id"] or "__unknown__", float(b["amount"]), False, b))
    for i in window_income:
        acct = str(i.get("account_id") or "")
        if acct in running and income_credit_ok(i, acct, confirmed_income_keys):
            events.append((i["days_away"], acct, float(i["amount"]), True, i))
            credited_incomes.setdefault(acct, []).append(i)

    events.sort(key=lambda e: (e[0], 0 if e[3] else 1))

    # Track minimum running balance per account
    min_running: dict[str, float] = {k: v for k, v in running.items()}
    # Track the first bill that caused a shortfall per account
    shortfall_bill: dict[str, dict] = {}

    for days_away, acct, amount, is_income, item in events:
        if is_income:
            running[acct] = running.get(acct, 0.0) + amount
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
    # _is_savings, _is_current, _is_offline are module-level (above compute_today_items)

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

    # Step 2: Track remaining source capacity across successive moves.
    # SOURCE SAFETY — capacity is min-running-based, not sum-based: simulate the
    # source's OWN full window (its bills debited on their days, its
    # own-attributed incomes credited on theirs). A contribution debited at
    # day 0 shifts the whole trajectory down linearly, so the max safe
    # contribution that keeps the source's running minimum ≥ £10 is
    # (min_running − 10); the £10 buffer is applied at candidate-build time,
    # for current and savings sources alike. Incomes are credited only when
    # attributed to this source AND reliable (income_credit_ok) — a source's
    # contribution never leans on money that might land elsewhere.
    def _source_min_running(sid: str, start_balance: float) -> float:
        ev: list[tuple[int, float]] = [
            (b["days_away"], -float(b["amount"]))
            for b in assessable_bills
            if (b["account_id"] or "__unknown__") == sid
        ]
        ev += [
            (i["days_away"], float(i["amount"]))
            for i in window_income
            if income_credit_ok(i, sid, confirmed_income_keys)
        ]
        ev.sort(key=lambda e: (e[0], 0 if e[1] > 0 else 1))
        run = start_balance
        mn = run
        for _d, delta in ev:
            run += delta
            mn = min(mn, run)
        return mn

    source_capacity: dict[str, float] = {}
    source_min_run: dict[str, float] = {}
    for acc in all_uk_accounts + offline_accounts:
        sid = acc["_str_id"]
        bal = live_balances.get(sid, float(acc.get("balance") or 0))
        if _is_current(acc) or _is_savings(acc) or _is_offline(acc):
            mn = _source_min_running(sid, bal)
            source_min_run[sid] = mn
            source_capacity[sid] = mn

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
        dest_name = _clean_name(bill.get("account_name"), dest_acct)
        dest_provider = "Bank"
        dest_balance = live_balances.get(dest_acct, 0.0)
        for acc in all_uk_accounts:
            if acc["_str_id"] == dest_acct:
                dest_name = _clean_name(acc.get("name"), dest_name)
                dest_provider = _provider_of(acc)
                dest_balance = live_balances.get(dest_acct, float(acc.get("balance") or 0))
                break

        # Fan-in destination summary: ALL of this account's in-window bills that land
        # before its first income event (income sorts before bills on the same day,
        # so a bill on the income day is excluded — income covers it).
        first_income_day = min(
            (i["days_away"] for i in credited_incomes.get(dest_acct, [])), default=None
        )
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

        # Build ordered candidate sources: current accounts first (excluding savings
        # accounts which would otherwise match _is_current via type=="BANK"), then
        # savings, then offline (manually-tracked) accounts. Offline accounts are
        # last because reaching them requires the user to make a manual transfer, so
        # they are treated as the least liquid option. Accounts explicitly excluded
        # by the user's cover_plan_excluded_accounts preference are skipped in all passes.
        candidate_sources = []
        for acc in all_uk_accounts:
            sid = acc["_str_id"]
            if sid == dest_acct:
                continue
            if sid in excluded_sources:
                continue
            if _is_current(acc) and not _is_savings(acc):
                if min_running.get(sid, 0.0) < 0:
                    continue  # skip accounts that are themselves short
                headroom = source_capacity.get(sid, 0.0) - 10  # keep £10 buffer
                if headroom >= 5:
                    candidate_sources.append(("current", sid, acc, headroom))
        for acc in all_uk_accounts:
            sid = acc["_str_id"]
            if sid == dest_acct:
                continue
            if sid in excluded_sources:
                continue
            if _is_savings(acc):
                headroom = source_capacity.get(sid, 0.0) - 10  # keep £10 buffer
                if headroom >= 5:
                    candidate_sources.append(("savings", sid, acc, headroom))
        # Offline accounts last: real money, but reaching it means a manual
        # transfer, so in practice it is the least liquid source we suggest.
        for acc in offline_accounts:
            sid = acc["_str_id"]
            if sid == dest_acct:
                continue
            if sid in excluded_sources:
                continue
            headroom = source_capacity.get(sid, 0.0) - 10  # keep £10 buffer
            if headroom >= 5:
                candidate_sources.append(("offline", sid, acc, headroom))

        # Build legs (without headline — assigned after consolidation below).
        # headroom is re-read from source_capacity each iteration (not the stale
        # snapshot) to prevent over-draw when one source covers multiple destinations.
        legs = []
        used_sources: set[str] = set()   # belt-and-braces: one source per destination
        remaining = amount_needed
        for src_type, sid, acc, _headroom_snapshot in candidate_sources:
            if remaining <= 0:
                break
            # Re-read live capacity — the snapshot is stale if this source already
            # contributed to an earlier destination in this shortfall pass.
            headroom = source_capacity.get(sid, 0.0) - 10
            if headroom < 5:
                continue
            # Belt-and-braces: skip if this source already has a leg for this destination
            if sid in used_sources:
                continue
            leg_amount = min(remaining, headroom)
            # Floor partial legs to nearest £5; final leg takes exact remainder
            if leg_amount < remaining:
                leg_amount = math.floor(leg_amount / 5) * 5
            if leg_amount < 5:
                continue
            src_name = _clean_name(acc.get("name"), sid)
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
            used_sources.add(sid)
            remaining -= leg_amount

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

    # SOURCE SAFETY guarantee — checked GLOBALLY, across every card. A source may
    # fund more than one destination (that genuinely is two transfers), so the
    # invariant is its TOTAL contribution across ALL cards: debited at day 0, the
    # source's own running balance must stay >= £10 through the full window. The
    # trajectory shifts down linearly, so min_after = min_running − total.
    contrib_by_source: dict[str, float] = {}
    for leg in covered:
        _src = leg["move_map"]["from"]["account_id"]
        contrib_by_source[_src] = contrib_by_source.get(_src, 0.0) + float(leg["amount"])
    sources_safe = bool(covered) and all(
        source_min_run.get(_src, 0.0) - _total_c >= 10 - 1e-6
        for _src, _total_c in contrib_by_source.items()
    )

    # Excluded-income honesty, PER DESTINATION: if a predicted income was kept OUT of
    # a shortfall destination's arithmetic (wrong landing account, or too shaky to
    # plan around) and crediting it would have raised THAT account's window minimum,
    # say so on THAT account's card — the plan stands without it.
    _credited_ids = {id(i) for lst in credited_incomes.values() for i in lst}
    _excluded_incomes = [i for i in window_income if id(i) not in _credited_ids]

    def _walk_min(dest: str, extra_income: dict | None = None) -> float:
        ev = [
            (b["days_away"], -float(b["amount"]))
            for b in assessable_bills
            if (b["account_id"] or "__unknown__") == dest
        ]
        ev += [(i2["days_away"], float(i2["amount"])) for i2 in credited_incomes.get(dest, [])]
        if extra_income is not None:
            ev.append((extra_income["days_away"], float(extra_income["amount"])))
        ev.sort(key=lambda e: (e[0], 0 if e[1] > 0 else 1))
        run = live_balances.get(dest, 0.0)
        mn = run
        for _d, _delta in ev:
            run += _delta
            mn = min(mn, run)
        return mn

    income_note_by_dest: dict[str, str] = {}
    for _da, _sa, _dest, _bill in shortfalls:
        _base_min = _walk_min(_dest)
        _cands = [
            (float(_inc["amount"]), _inc)
            for _inc in _excluded_incomes
            if _walk_min(_dest, _inc) > _base_min + 0.5
        ]
        if not _cands:
            continue
        _amt, _inc = max(_cands, key=lambda t: t[0])
        _dest_nm = _clean_name(
            next((a.get("name") for a in all_uk_accounts if a["_str_id"] == _dest), None),
            _dest,
        )
        _when = date.fromisoformat(_inc["expected_date"]).strftime("%-d %b")
        _landing = " ".join(
            x for x in [_inc.get("account_bank"), _inc.get("account_name")] if x
        ).strip()
        if str(_inc.get("account_id") or "") and _landing:
            income_note_by_dest[_dest] = (
                f"This plan doesn't count the £{int(round(_amt)):,} that sometimes arrives "
                f"around {_when} — it has landed in {_landing}, not {_dest_nm.strip()}. "
                f"If it does arrive, you'll simply need less."
            )
        else:
            income_note_by_dest[_dest] = (
                f"This plan doesn't count the £{int(round(_amt)):,} that sometimes arrives "
                f"around {_when} — it hasn't been steady enough to plan around. "
                f"If it lands, you'll simply need less."
            )

    # Per-destination bucketed amounts — the fingerprint input. Bucketing to the
    # nearest £50 keeps a card's identity stable under £1-level drift while a
    # materially different problem produces a different card.
    dest_bucketed: dict[str, int] = {}
    for _da, _sa, dest_acct_fp, _bill in shortfalls:
        dest_bucketed[dest_acct_fp] = round((_ceil5(abs(min_running[dest_acct_fp])) + 10) / 50) * 50

    # ── 6. Emission — ONE CARD PER AT-RISK DESTINATION ──────────────────────
    # Each card is a self-contained instruction about ONE account: its own headline,
    # its own destination block (needs / by when / that account's bills), its own
    # source rows, its own total, its own footer and its own residual. Each carries
    # a per-destination fingerprinted id, so dismissal and auto-verification resolve
    # one account without touching the other. Ordered most urgent first — `shortfalls`
    # is already sorted by (first bounce day, then largest gap).
    legs_by_dest: dict[str, list[dict]] = {}
    for leg in covered:
        legs_by_dest.setdefault(leg["dest_acct"], []).append(leg)
    uncovered_by_dest: dict[str, dict] = {u["dest_acct"]: u for u in uncovered}

    emitted_dests = 0
    capped_out = 0

    for _da, _sa, dest_acct, bill in shortfalls:
        dest_fp = _shortfall_fingerprint([(dest_acct, dest_bucketed.get(dest_acct, 0))])
        dest_legs = legs_by_dest.get(dest_acct) or []

        # ── (a) No viable source for this destination: the "no easy cover" card ──
        if not dest_legs:
            u = uncovered_by_dest.get(dest_acct)
            if not u:
                continue
            item_id = f"move:{dest_acct}:{window_end.isoformat()}:{dest_fp}"
            if item_id in dismissed:
                continue
            existing = await companion_items_col.find_one({"_id": item_id, "uid": uid})
            if existing and existing.get("status") == "done":
                continue
            if emitted_dests >= _MOVE_CARD_CAP:
                capped_out += 1
                continue
            headline = f"£{int(round(u['shortfall']))} gap before {u['dest_name']} payday"
            body = (
                f"Your £{u['bill_amount']} {_humanise_bill_name(u['bill_name'])} lands "
                f"{u['bill_weekday']}, but {u['dest_name']} is £{int(round(u['shortfall']))} "
                f"short and there's no easy transfer source right now."
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
                "_dest_name": u["dest_name"],
                "_dest_needs_total": dest_summaries[dest_acct]["needs_total"],
                "_dest_bill_count": len(dest_summaries[dest_acct]["bills"]),
                "_bill_name": u["bill_name"],
                "_bill_amount": u["bill_amount"],
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
            emitted_dests += 1
            continue

        # ── (b) This destination has funding: the cover card ──
        item_id = f"plan:{window_end.isoformat()}:{dest_fp}"
        if item_id in dismissed:
            continue
        existing = await companion_items_col.find_one({"_id": item_id, "uid": uid})
        if existing and existing.get("status") == "done":
            continue
        if emitted_dests >= _MOVE_CARD_CAP:
            capped_out += 1
            continue

        # One row per source WITHIN this destination, first-appearance order.
        _src_order: list[str] = []
        _src_legs: dict[str, list[dict]] = {}
        for _leg in dest_legs:
            _fsrc = _leg["move_map"]["from"]["account_id"]
            if _fsrc not in _src_legs:
                _src_order.append(_fsrc)
                _src_legs[_fsrc] = []
            _src_legs[_fsrc].append(_leg)
        rows: list[dict] = []
        for _fsrc in _src_order:
            _grp = _src_legs[_fsrc]
            _row = dict(_grp[0])
            _row["amount"] = int(round(sum(float(_l["amount"]) for _l in _grp)))
            _row["headline"] = f"Move £{_row['amount']:,} from {_row['_src_name']}"
            rows.append(_row)

        total = sum(r["amount"] for r in rows)
        n_rows = len(rows)
        dest_summary = dest_summaries[dest_acct]
        dest_name = dest_summary["name"]

        # This destination's own arithmetic — never a pooled figure.
        # RATIONALE: the pooled figure counted bills on accounts with no balance
        # data (credit cards) that the cover plan cannot assess, so asserting it
        # on a card that fully covers its own destination was exactly the
        # misrepresentation being fixed.
        amount_needed = _ceil5(abs(min_running[dest_acct])) + 10
        _raw_gap = amount_needed - sum(float(_l["amount"]) for _l in dest_legs)
        dest_gap = _raw_gap if _raw_gap > 4 else 0.0
        dest_covered = dest_gap <= 0.5

        headline = f"Move £{total:,} to {dest_name}"
        if n_rows == 1:
            _r = rows[0]
            _covers_phrase = "covers it." if dest_covered else "covers most of it."
            body = (
                f"Your £{_r['bill_amount']} {_humanise_bill_name(_r['bill_name'])} lands "
                f"{_r['bill_weekday']} from {dest_name}. "
                f"It's £{int(round(_r['shortfall']))} short. "
                f"Moving £{total:,} from {_r['move_map']['from']['name']} {_covers_phrase}"
            )
        elif dest_covered:
            body = f"£{total:,} across {n_rows} moves keeps everything clearing at {dest_name}."
        else:
            body = f"£{total:,} across {n_rows} moves covers most of what {dest_name} needs."

        residual = None
        if dest_gap > 0.5:
            residual = (
                f"These moves cover £{total:,}, but {dest_name} is still "
                f"£{int(round(dest_gap))} short — one payment may need a different plan."
            )

        assumed_incomes = [
            {"name": i["name"], "amount": round(float(i["amount"]), 2), "expected_date": i["expected_date"]}
            for i in credited_incomes.get(dest_acct, [])
        ]
        income_note = income_note_by_dest.get(dest_acct)

        item_doc = {
            "_id": item_id,
            "uid": uid,
            "type": "move",
            "status": "active",
            "headline": headline,
            "body": body,
            "action": {"label": "See what's due ›", "route": "/planning"},
            "estimated": False,
            "created_at": datetime.utcnow(),
            "_dest_acct": dest_acct,
            "_dest_name": dest_name,
            "_dest_needs_total": dest_summary["needs_total"],
            "_dest_bill_count": len(dest_summary["bills"]),
            "_bill_name": rows[0]["bill_name"],
            "_bill_amount": rows[0]["bill_amount"],
            "_window_end": window_end.isoformat(),
            "_total": total,
            "plan_dest": dest_summary,
            "covered": dest_covered,
            "amount": total,
            "sources_safe": sources_safe,
            "assumed_incomes": assumed_incomes,
            "income_note": income_note,
        }
        if n_rows == 1:
            item_doc["move_map"] = rows[0]["move_map"]
        if residual is not None:
            item_doc["residual"] = residual
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
            "action": {"label": "See what's due ›", "route": "/planning"},
            "estimated": False,
            "moves": [
                {"headline": r["headline"], "amount": r["amount"], "move_map": r["move_map"]}
                for r in rows
            ],
            "summary": body,
            "plan_dest": dest_summary,
            "covered": dest_covered,
            "amount": total,
            "sources_safe": sources_safe,
            "assumed_incomes": assumed_incomes,
        }
        if n_rows == 1:
            emit["move_map"] = rows[0]["move_map"]
        if residual is not None:
            emit["residual"] = residual
        if income_note is not None:
            emit["income_note"] = income_note
        items.append(emit)
        emitted_dests += 1

    # Honest disclosure rather than a silent drop: say how many at-risk accounts
    # are waiting behind the cap, on the last card that did render.
    if capped_out and items:
        overflow_note = (
            "One more account is short this window — it'll show here once these are cleared."
            if capped_out == 1
            else f"{capped_out} more accounts are short this window — they'll show here once these are cleared."
        )
        items[-1]["overflow_note"] = overflow_note
        await companion_items_col.update_one(
            {"_id": items[-1]["id"], "uid": uid},
            {"$set": {"overflow_note": overflow_note}},
        )

    # ── 7. Auto-verification + celebration pass ─────────────────────────────
    # Active moves whose destination now clears its window flip to "done" and
    # celebrate. Done moves KEEP celebrating on every run — the reward moment
    # must outlive one cache TTL — until the user dismisses the celebration or
    # the pay window it belonged to ends (then the doc expires, same as actives).
    celebration_items: list[dict] = []
    _cel_candidates: list[dict] = []

    async def _resolve_dest_display_name(stored: dict) -> tuple[str | None, bool]:
        """Display name for a stored move/plan doc's destination, re-derived
        each run: stored _dest_name → live account lookup by id → None (the
        caller falls back to generic-but-warm copy). NEVER a raw account id.
        Second element: True when the name came from the live lookup, so the
        caller can heal the stored doc."""
        nm = _clean_name(stored.get("_dest_name"))
        if _display_name_ok(nm):
            return nm, False
        dest = str(stored.get("_dest_acct") or "")
        if not dest:
            return None, False
        acc = next((a for a in all_uk_accounts if a["_str_id"] == dest), None)
        if acc:
            nm = _clean_name(acc.get("name"))
            if _display_name_ok(nm):
                return nm, True
        nm = await _lookup_account_name(dest)
        if _display_name_ok(nm):
            return nm, True
        return None, False

    def _celebration_payload(stored: dict, dest_name: str | None) -> dict:
        """Celebration copy for a covered destination — self-contained and calm.
        Old docs may lack any of the underscore fields; every branch degrades to
        warm copy rather than a raw id or a £0 figure."""
        bill_name = stored.get("_bill_name") or "bill"
        bill_amount = stored.get("_bill_amount") or 0
        bill_count = int(stored.get("_dest_bill_count") or 0)
        needs_total = stored.get("_dest_needs_total")
        headline = (
            f"Sorted — {dest_name} is covered"
            if dest_name
            else "Sorted — those payments are covered"
        )
        _at_clause = f" at {dest_name}" if dest_name else ""
        if needs_total and bill_count > 1:
            body = f"£{int(round(float(needs_total))):,} of payments{_at_clause} are safe."
        elif bill_amount:
            body = f"The £{int(round(float(bill_amount))):,} {_humanise_bill_name(bill_name)} is safe."
        elif needs_total:
            body = f"£{int(round(float(needs_total))):,} of payments{_at_clause} are safe."
        else:
            body = "Everything due there before payday is safe."
        return {
            "id": f"celebrate:{stored['_id']}",
            "type": "celebration",
            "headline": headline,
            "body": body,
            "action": None,
            "estimated": False,
        }

    def _celebration_lapsed(stored: dict, now_utc: datetime) -> bool:
        """Return True when the stored celebration is past its 24-hour window.
        Docs without _celebrated_at are treated as NOT lapsed (they get healed below)."""
        ca = stored.get("_celebrated_at")
        if ca is None:
            return False
        return (now_utc - ca).total_seconds() >= 86400

    _cel_now_utc = datetime.utcnow()

    async for stored in companion_items_col.find({
        "uid": uid,
        "type": "move",
        "$or": [
            {"status": "active", "_celebrated": {"$ne": True}},
            {"status": "done", "_celebrated": True},
        ],
    }):
        stored_dest = stored.get("_dest_acct")
        stored_window = stored.get("_window_end", "")
        stored_id = stored["_id"]
        stored_status = stored.get("status")
        if stored_id in dismissed:
            continue
        # If the stored item is already emitted in this run, skip
        if any(i["id"] == stored_id for i in items):
            continue
        # Window closed → expired, whether the move was still active or already
        # done+celebrated. A celebration lives until dismissal or window end.
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
                if stored_status == "active":
                    await companion_items_col.update_one(
                        {"_id": stored_id, "uid": uid},
                        {"$set": {"status": "done", "_celebrated": True, "_celebrated_at": _cel_now_utc}},
                    )
                # Legacy heal: docs already done+celebrated without _celebrated_at
                # get stamped now so they get a full 24 h from this moment.
                if stored.get("_celebrated_at") is None:
                    await companion_items_col.update_one(
                        {"_id": stored_id, "uid": uid},
                        {"$set": {"_celebrated_at": _cel_now_utc}},
                    )
                    stored = dict(stored)
                    stored["_celebrated_at"] = _cel_now_utc
                # 24-hour lapse gate
                if _celebration_lapsed(stored, _cel_now_utc):
                    if not stored.get("_celebration_lapsed"):
                        await companion_items_col.update_one(
                            {"_id": stored_id, "uid": uid},
                            {"$set": {"_celebration_lapsed": True}},
                        )
                    continue
                _cel_candidates.append({
                    "cel_id": f"celebrate:{stored_id}",
                    "group": stored_dest_accts[0] if len(stored_dest_accts) == 1 else "__pooled__",
                    "richness": 0,
                    "created_at": stored.get("created_at") or datetime.min,
                    "item": {
                        "id": f"celebrate:{stored_id}",
                        "type": "celebration",
                        "headline": "Sorted — this week's payments are covered",
                        "body": f"£{stored_total:,} of payments are safe.",
                        "action": None,
                        "estimated": False,
                    },
                })
            elif stored_status == "active" and len(stored_dest_accts) > 1 and emitted_dests > 0:
                # Legacy pooled plan card, superseded by per-destination cards emitted
                # this run. Retire it quietly — the new cards own these destinations.
                await companion_items_col.update_one(
                    {"_id": stored_id, "uid": uid},
                    {"$set": {"status": "expired"}},
                )
            continue
        # Single-dest logic — only celebrate while the destination still clears
        # its window; a re-opened shortfall must not be toasted as sorted.
        if stored_dest and min_running.get(stored_dest, 0.0) >= 0:
            if stored_status == "active":
                await companion_items_col.update_one(
                    {"_id": stored_id, "uid": uid},
                    {"$set": {"status": "done", "_celebrated": True, "_celebrated_at": _cel_now_utc}},
                )
            dest_name, _healed = await _resolve_dest_display_name(stored)
            if _healed:
                # Heal whitespace-damaged / pre-_dest_name docs in place so the
                # next run resolves without a lookup.
                await companion_items_col.update_one(
                    {"_id": stored_id, "uid": uid},
                    {"$set": {"_dest_name": dest_name}},
                )
            # Legacy heal: docs already done+celebrated without _celebrated_at
            # get stamped now so they get a full 24 h from this moment.
            if stored.get("_celebrated_at") is None:
                await companion_items_col.update_one(
                    {"_id": stored_id, "uid": uid},
                    {"$set": {"_celebrated_at": _cel_now_utc}},
                )
                stored = dict(stored)
                stored["_celebrated_at"] = _cel_now_utc
            # 24-hour lapse gate
            if _celebration_lapsed(stored, _cel_now_utc):
                if not stored.get("_celebration_lapsed"):
                    await companion_items_col.update_one(
                        {"_id": stored_id, "uid": uid},
                        {"$set": {"_celebration_lapsed": True}},
                    )
                continue
            _cel_candidates.append({
                "cel_id": f"celebrate:{stored_id}",
                "group": stored_dest,
                "richness": (
                    2 if (int(stored.get("_dest_bill_count") or 0) > 1 and stored.get("_dest_needs_total"))
                    else 1 if stored.get("_bill_amount")
                    else 0
                ),
                "created_at": stored.get("created_at") or datetime.min,
                "item": _celebration_payload(stored, dest_name),
            })

    # One celebration per destination: several generations of docs can cover the
    # same account (legacy pooled, per-dest, gap cards); toasting each one is
    # noise, not warmth. The richest, newest doc speaks for the group — and a
    # dismissal of ANY of the group's celebrations silences the whole group, so
    # dismissing "Sorted — X is covered" never resurfaces X under an older id.
    _cel_groups: dict[str, list[dict]] = {}
    for _c in _cel_candidates:
        _cel_groups.setdefault(_c["group"], []).append(_c)
    _cel_winners = [
        max(_grp, key=lambda c: (c["richness"], c["created_at"]))
        for _grp in _cel_groups.values()
        if not any(c["cel_id"] in dismissed for c in _grp)
    ]
    _cel_winners.sort(key=lambda c: c["created_at"], reverse=True)
    celebration_items.extend(_w["item"] for _w in _cel_winners)

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

        if 0 <= days_into_period <= 1:
            # The just-closed period
            closed_start, closed_end = _prev_pay_period(curr_start, pay_cfg)
            needle_id = f"needle:{closed_end.isoformat()}"
            if needle_id not in dismissed:
                # Invitation only — no figures (figures live in ThisMonthStrip LAST MONTH mode)
                weekday = closed_end.strftime("%A")
                needle_items.append({
                    "id": needle_id,
                    "type": "needle",
                    "headline": f"Your month closed on {weekday}.",
                    "body": "",
                    "action": {"label": "Here's how it went ›", "route": "/month/story?which=last"},
                    "estimated": False,
                    "_period_end": closed_end.isoformat(),
                })
    except Exception as _needle_exc:
        log.warning("needle item failed for %s: %s", uid, _needle_exc)

    # ── 8c. ASK item (payday confirmation) ─────────────────────────────────
    ask_items: list[dict] = []
    try:
        from app.services.income import get_payday_proposal, payday_phrase as _payday_phrase

        _confirmed_pay = _get_confirmed_payday(prefs, today_d)
        if _confirmed_pay is None and "ask:payday" not in dismissed:
            proposal = await get_payday_proposal(uid, today_d)
            if proposal is not None:
                _amt = proposal["amount"]
                _merchant = proposal["merchant"]
                _phrase = proposal["payday_phrase"]
                ask_items.append({
                    "id": "ask:payday",
                    "type": "ask",
                    "headline": "Is this your payday?",
                    "body": f"Looks like £{_amt:,.0f} from {_merchant} lands on {_phrase}.",
                    "action": {"label": "Yes, that's it", "route": "/income/confirm-payday", "kind": "confirm_payday"},
                    "secondary_action": {"label": "No — set it myself", "route": "/spend", "kind": "set_payday"},
                    "estimated": False,
                    "proposal": proposal,
                })
    except Exception as _ask_exc:
        log.warning("ask:payday item failed for %s: %s", uid, _ask_exc)

    # ── 9. Merge and cap at 3 ───────────────────────────────────────────────
    # Moves are capped at emission time (_MOVE_CARD_CAP); the slice is belt-and-braces.
    # Celebrations get the same allowance as move cards, so covering two accounts is
    # acknowledged twice rather than one card vanishing without a word.
    result = (
        items[:_MOVE_CARD_CAP]
        + celebration_items[:_MOVE_CARD_CAP]
        + ask_items[:1]
        + needle_items[:1]
        + rhythm_items
    )
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
