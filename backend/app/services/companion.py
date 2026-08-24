"""Companion spine — rhythm-aware today-engine.

Computes up to 3 items (moves first, one card per at-risk destination account) for a user's home screen.
Zero LLM calls — all copy is deterministic from live data.
Zero hardcodes — computed generically for any user.
"""
import hashlib
import logging
import math
import re
from datetime import date, datetime, time, timedelta
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
    transactions_col,
)

log = logging.getLogger(__name__)
from app.routers.analytics import _build_cashflow_response, income_credit_ok
from app.services.card_rates import is_credit_card_account
from app.services.categories import MOVEMENT
from app.services.categorisation import series_key


_WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]

# At most this many cover/gap cards render at once. Anything beyond is disclosed
# honestly on the last card rather than silently dropped.
_MOVE_CARD_CAP = 2


def _weekday_name(d: date) -> str:
    return _WEEKDAYS[d.weekday()]


def _when_label(d: date, today: date) -> str:
    """Distance-aware date label: today/tomorrow/weekday-name (2-6 days)/short-date (>=7 days).
    Prevents "lands Friday" reading as "this Friday" when the date is actually weeks away."""
    days_away = (d - today).days
    if days_away <= 0:
        return "today"
    if days_away == 1:
        return "tomorrow"
    if days_away < 7:
        return _weekday_name(d)
    return d.strftime("%a %-d %b")


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


# Small allowlist of known acronyms/initialisms that must stay upper-case
# when humanising an account/product display name (e.g. "NW World
# Mastercard" should keep "NW", not become "Nw"). Deliberately tiny and
# scoped to humanise_account_name only — not shared with the broader
# _humanise_bill_name pipeline above.
_ACCOUNT_NAME_ACRONYMS = {"NW", "HSBC", "ISA", "AMEX"}


def humanise_account_name(name: str) -> str:
    """Title-case a shouty ALL-CAPS account/product name for display, e.g.
    "THE NUMBER ONE REWARD PLATINUM" -> "The Number One Reward Platinum".
    Words already in `_ACCOUNT_NAME_ACRONYMS` are left upper-case; mixed-case
    names (already human-formatted) pass through untouched. This only
    re-cases — it never repairs upstream truncation/spelling issues (e.g. a
    provider-supplied "Mastercar").

    Used only in the payday-gap/cliff/trajectory message templates below —
    does not globally rewrite account names anywhere else in the app. Every
    one of those templates interpolates the result immediately before a
    sentence-ending "." (e.g. "...gap before {name} payday.", "...carried on
    {name}."); a provider-supplied name that itself ends in "." (seen live —
    "THE NUMBER ONE REWARD PLATINUM" style names occasionally arrive with a
    trailing full stop) would otherwise render as a double period. Stripped
    here, once, so every calling template gets exactly one terminator.
    """
    raw = (name or "").strip()
    if not raw:
        return raw
    raw = raw.rstrip(".").rstrip()

    def _title_word(m: re.Match) -> str:
        w = m.group(0)
        if w.upper() in _ACCOUNT_NAME_ACRONYMS:
            return w.upper()
        return w.title() if len(w) >= 2 and w.isupper() else w

    return re.sub(r"[A-Za-z]+", _title_word, raw)


def _ceil5(amount: float) -> int:
    """Round up to nearest £5."""
    return math.ceil(amount / 5) * 5


def _fmt_overdrawn(amount: float) -> str:
    """Pence-precision string for a live overdrawn amount (no £ prefix), e.g.
    2.48 -> "2.48", 2.0 -> "2". The overdraft trigger has no noise floor (any
    strictly negative live balance qualifies — see `_overdraft_deficits`), so
    rounding to whole pounds could turn a real -£0.30 deficit into "£0
    overdrawn", which reads as nonsense. Whole-pound amounts still print
    without pence, matching the rest of this file's £-formatting."""
    a = abs(amount)
    if abs(a - round(a)) < 0.005:
        return f"{int(round(a)):,}"
    return f"{a:,.2f}"


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


# Money that isn't real spend (declared kind movement or income) is excluded
# from "everyday spend" so the payday-plan target isn't inflated by money
# already accounted for elsewhere (savings moves, debt payments, transfers).
# Formerly a local set that mirrored cashflow.py's; now read once per call from
# app.services.categories.


def _median(vals: list[float]) -> float:
    """Median of a list — mirrors cashflow.py's _median (sort, take middle;
    average of the two middles when the count is even)."""
    if not vals:
        return 0.0
    s = sorted(vals)
    n = len(s)
    mid = n // 2
    return s[mid] if n % 2 else (s[mid - 1] + s[mid]) / 2


async def _per_account_everyday_spend(uid: str, recurring_keys: set) -> dict[str, float]:
    """Median per-account everyday (non-recurring, non-transfer-like) discretionary
    spend over the last 3 FULL pay periods (strictly before the current in-progress
    one). Powers the payday-plan per-account target alongside bills + buffer.
    Accounts with zero qualifying txns across all 3 periods are simply absent."""
    try:
        from app.services.pay_period import get_pay_period_for_date, prev_pay_period
        from app.services.categories import get_category_kinds, is_non_spend

        prefs = await preferences_col.find_one({"user_id": uid}) or {}
        pay_cfg = prefs.get("pay_period_config", {"type": "calendar_month"})

        # ONE kind-map read for the 100-day scan below.
        kinds = await get_category_kinds(uid)

        cutoff = datetime.utcnow() - timedelta(days=100)
        txns: list[dict] = []
        async for t in transactions_col.find(
            {"user_id": uid, "transaction_type": "debit", "date": {"$gte": cutoff}},
            {"amount": 1, "date": 1, "account_id": 1, "category": 1, "custom_category": 1,
             "merchant_name": 1, "description": 1},
        ):
            txns.append(t)

        cur_start, _ = get_pay_period_for_date(date.today(), pay_cfg)
        periods: list[tuple[date, date]] = []
        _walk_start = cur_start
        for _ in range(3):
            _p_start, _p_end = prev_pay_period(_walk_start, pay_cfg)
            periods.append((_p_start, _p_end))
            _walk_start = _p_start

        per_acct_sums: dict[str, list[float]] = {}
        for t in txns:
            cat = t.get("custom_category") or t.get("category") or ""
            if is_non_spend(kinds, cat):
                continue
            if series_key(t) in recurring_keys:
                continue
            t_date = t.get("date")
            if t_date is None:
                continue
            if hasattr(t_date, "date"):
                t_date = t_date.date()
            acct_id = str(t.get("account_id") or "")
            amount = abs(float(t.get("amount") or 0))
            for idx, (p_start, p_end) in enumerate(periods):
                if p_start <= t_date <= p_end:
                    per_acct_sums.setdefault(acct_id, [0.0, 0.0, 0.0])[idx] += amount
                    break

        result: dict[str, float] = {}
        for acct_id, sums in per_acct_sums.items():
            if any(s > 0 for s in sums):
                result[acct_id] = _median(sums)
        return result
    except Exception:
        return {}


async def _usual_payday_moves_raw(uid: str, salary_acct_id: str, pay_cfg: dict) -> dict[str, list[float]]:
    """Shared body behind `_usual_payday_moves` / `_usual_payday_moves_with_counts`
    — per destination, the list of matched transfer amounts across the 4 most
    recent paydays (one entry per payday that actually matched). Kept as its
    own function so neither caller re-runs the debit/credit matching query
    twice for the same request."""
    try:
        from app.services.pay_period import get_pay_period_for_date, prev_pay_period
        from app.services.categories import get_category_kinds, is_non_spend, is_income

        # ONE kind-map read for this whole call, reused for every debit across
        # all 4 paydays below (never per-transaction).
        kinds = await get_category_kinds(uid)

        cur_start, _ = get_pay_period_for_date(date.today(), pay_cfg)
        paydays: list[date] = []
        _walk_start = cur_start
        for _ in range(4):
            _p_start, _p_end = prev_pay_period(_walk_start, pay_cfg)
            paydays.append(_p_start)
            _walk_start = _p_start

        dest_amounts: dict[str, list[float]] = {}
        for payday in paydays:
            window_start = datetime.combine(payday, time.min)
            window_end = datetime.combine(payday + timedelta(days=5), time.min)

            debits: list[dict] = []
            async for d in transactions_col.find(
                {
                    "user_id": uid,
                    "transaction_type": "debit",
                    "date": {"$gte": window_start, "$lt": window_end},
                },
                {"amount": 1, "date": 1, "account_id": 1, "category": 1, "custom_category": 1},
            ):
                if str(d.get("account_id") or "") != str(salary_acct_id):
                    continue
                d_cat = d.get("custom_category") or d.get("category") or ""
                # Use the declared-kind helper instead of a hand-rolled name
                # set, so a custom category kinded `movement` (e.g. a
                # user-created savings pot name) is recognised as a payday
                # destination too — the literal set only ever covered the
                # 4 built-ins. `is_income` is excluded explicitly: plain
                # `is_non_spend` also covers `income`, and measurement against
                # live data showed some accounts have debit transactions
                # categorised `Income` (refunds/reversals) that the old
                # literal set never matched — including them would be a
                # behaviour change, not just a generalisation, so income is
                # kept out to match today's behaviour exactly.
                if not is_non_spend(kinds, d_cat) or is_income(kinds, d_cat):
                    continue
                debits.append(d)

            if not debits:
                continue

            credits: list[dict] = []
            async for c in transactions_col.find(
                {
                    "user_id": uid,
                    "transaction_type": "credit",
                    "date": {"$gte": window_start, "$lt": window_end},
                },
                {"amount": 1, "date": 1, "account_id": 1, "category": 1, "custom_category": 1},
            ):
                if str(c.get("account_id") or "") == str(salary_acct_id):
                    continue
                credits.append(c)

            used: set[int] = set()
            for d in debits:
                d_amt = abs(float(d.get("amount") or 0))
                d_date = d.get("date")
                d_date = d_date.date() if hasattr(d_date, "date") else d_date
                if d_date is None:
                    continue
                for ci, c in enumerate(credits):
                    if ci in used:
                        continue
                    c_amt = abs(float(c.get("amount") or 0))
                    c_date = c.get("date")
                    c_date = c_date.date() if hasattr(c_date, "date") else c_date
                    if c_date is None:
                        continue
                    if abs(d_amt - c_amt) < 0.02 and abs((c_date - d_date).days) <= 3:
                        used.add(ci)
                        dest_id = str(c.get("account_id") or "")
                        dest_amounts.setdefault(dest_id, []).append(c_amt)
                        break

        return dest_amounts
    except Exception:
        return {}


async def _usual_payday_moves(uid: str, salary_acct_id: str, pay_cfg: dict) -> dict[str, int]:
    """Historical median amount moved OUT of the salary account, per destination
    account, on the 4 most recent paydays — matched by amount + timing against a
    credit landing elsewhere. Surfaces "usual" alongside the freshly computed
    `move` on each payday-plan destination card."""
    dest_amounts = await _usual_payday_moves_raw(uid, salary_acct_id, pay_cfg)
    return {
        dest_id: int(round(_median(amounts)))
        for dest_id, amounts in dest_amounts.items()
        if amounts
    }


async def _usual_payday_moves_with_counts(
    uid: str, salary_acct_id: str, pay_cfg: dict
) -> tuple[dict[str, int], dict[str, int]]:
    """Same historical medians as `_usual_payday_moves`, plus — per
    destination — how many of the 4 most recent paydays actually contributed
    a matched transfer. Used by spend_impact.py's move-consequence confidence
    gate: a single lucky match should never be read as an established habit.
    Shares `_usual_payday_moves_raw`'s query rather than re-deriving it."""
    dest_amounts = await _usual_payday_moves_raw(uid, salary_acct_id, pay_cfg)
    medians = {
        dest_id: int(round(_median(amounts)))
        for dest_id, amounts in dest_amounts.items()
        if amounts
    }
    counts = {dest_id: len(amounts) for dest_id, amounts in dest_amounts.items() if amounts}
    return medians, counts


async def _active_commitment_slices(
    uid: str, pay_cfg: dict, live_balances: dict[str, float]
) -> dict[str, dict]:
    """Per-destination payday slices for the user's ACTIVE commitments (named
    future big expenses funded from one or more pots — goals v2).

    Returns {dest_account_id: {"slice_total": int, "names": [str]}} — the
    sum of each commitment's per-period slice routed to that destination plus
    the commitment names, so the payday plan can lift a pot's move to cover
    them. Routing rule (documented contract): a goal's WHOLE slice goes to its
    FIRST CONNECTED pot; manual (offline) pots NEVER receive automated legs —
    the user moves that money by hand — so a goal funded only by manual pots
    contributes no leg at all (its progress still counts everywhere).
    Legacy v1 docs (funding_account_id/baseline_balance, no funding_pots) are
    read as one connected pot with count_existing off.

    Progress/remaining/slice come from commitments.compute_pot_ledger +
    _pot_progress_and_slice — the SAME pot-ledger allocation and slice maths
    Planning and the sheet preview use (a pound already claimed by an older
    goal never counts twice here either), fed with this walk's OWN
    `live_balances` so the payday plan's numbers can never drift from what
    the balance sweep already found.
    Failure-tolerant by design: any error (including commitments_col not
    existing yet) returns {} and the plan builds exactly as before.
    """
    try:
        # Defensive import at use-site — the collection ships separately, and
        # this module must keep importing cleanly if it lands later.
        from app.db.collections import commitments_col
        from app.routers.commitments import (
            _doc_pots,
            _pot_progress_and_slice,
            compute_pot_ledger,
        )

        today_d = date.today()
        docs = await commitments_col.find(
            {"user_id": uid, "status": "active"},
            {"name": 1, "amount": 1, "target_date": 1, "funding_pots": 1,
             "funding_account_id": 1, "baseline_balance": 1, "contributed": 1,
             "created_at": 1},
        ).to_list(None)
        if not docs:
            return {}

        ledger = await compute_pot_ledger(uid, docs=docs, balances=live_balances)

        out: dict[str, dict] = {}
        for c in docs:
            pots = _doc_pots(c)
            if not pots:
                continue
            # Whole slice → FIRST CONNECTED pot; manual-only goals get no leg.
            dest = next(
                (str(p["account_id"]) for p in pots
                 if (p.get("kind") or "connected") == "connected"),
                None,
            )
            if dest is None:
                continue
            try:
                slice_info = await _pot_progress_and_slice(c, pay_cfg, ledger, today_d)
            except Exception:
                continue
            entry = out.setdefault(dest, {"slice_total": 0, "names": []})
            entry["slice_total"] += int(slice_info["per_period_slice"])
            name = str(c.get("name") or "").strip()
            if name:
                entry["names"].append(name)
        return out
    except Exception:
        return {}


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


def _walk_events(
    events: list[tuple[int, str, float, bool, dict]],
    balances: dict[str, float],
) -> tuple[dict[str, float], dict[str, float], dict[str, dict], dict[str, list[dict]]]:
    """The per-account running-balance walk at the heart of the at-risk/
    shortfall simulation — extracted so `spend_impact._bills_risk` can run
    the exact same walk (once at usual pace, once with an extra projected
    outflow layered in) rather than re-implementing it. Behaviour is
    byte-identical to the inline loop this replaces inside
    `compute_today_items` — the only change is that the `bal >= amount` /
    "bill bounces" branches collapsed into one, since both computed the
    same `new_bal = bal - amount` either way; the old split only mattered
    for *deciding* whether to touch `shortfall_bill`, which the `new_bal < 0`
    check below still does identically.

    `events` — (days_away, acct, amount, is_income, item) tuples, already
    sorted by the caller (days_away, then bills-before-income same-day —
    conservative: an on-payday debit must be covered by balance, not that
    day's income).
    `balances` — starting balance per account; an account absent from this
    dict defaults to £0 the first time an event references it (matches the
    prior inline behaviour, where `running` only ever held keys for
    accounts that had at least one assessable bill).

    Returns (running, min_running, shortfall_bill, bounced_bills):
      running        — final balance per account after every event.
      min_running    — the lowest point each account's balance touched.
      shortfall_bill — first bill (by walk order) that drove each account
                        negative, keyed by account id.
      bounced_bills  — EVERY bill (by walk order, not just the first) that
                        left an account negative, keyed by account id. A
                        deficit cascades — once an account is short, every
                        later bill on it counts until income recovers it —
                        so this is the full set `shortfall_bill` only takes
                        the head of. Callers use it to tell whether a
                        deficit is genuinely caused by an obligation
                        (commitment/discretionary) or only ever by the
                        user's own movement (savings/transfer/investment/
                        debt) — see `compute_today_items`' recommendation
                        gating, which must not instruct a "move money" fix
                        for a plan the user made for their own money, but
                        must still fire when movement merely starves a real
                        bill further down the same account's timeline.
    """
    running: dict[str, float] = dict(balances)
    min_running: dict[str, float] = dict(balances)
    shortfall_bill: dict[str, dict] = {}
    bounced_bills: dict[str, list[dict]] = {}

    for _days_away, acct, amount, is_income, item in events:
        if is_income:
            running[acct] = running.get(acct, 0.0) + amount
        else:
            new_bal = running.get(acct, 0.0) - amount
            running[acct] = new_bal
            min_running[acct] = min(min_running.get(acct, new_bal), new_bal)
            if new_bal < 0:
                if acct not in shortfall_bill:
                    shortfall_bill[acct] = item
                bounced_bills.setdefault(acct, []).append(item)

    return running, min_running, shortfall_bill, bounced_bills


def _gate_recommendation(
    dest_acct: str,
    min_bal: float,
    shortfall_bill: dict[str, dict],
    bounced_bills: dict[str, list[dict]],
    optimistic_min_running: dict[str, float],
) -> dict | None:
    """Decide whether `dest_acct`'s deficit (from the conservative walk)
    should reach the "move money" recommendation engine, and if so, which
    bill to represent it with. Returns the display bill dict, or None to
    suppress the recommendation entirely.

    Pulled out of `compute_today_items` as a pure, DB-free function so the
    two suppression rules can be unit-tested directly: see
    tests/test_companion_shortfall.py.

    Two independent gates, either one suppresses:

    (a) SAME-DAY INCOME — reliable income already credited to this exact
        account (via `credited_incomes`, which is what `optimistic_min_running`
        is built from) landing the SAME day as the outflows that would
        otherwise bounce. The conservative walk (outflows-before-inflows on a
        shared day) still drives `min_bal`/`shortfall_bill`/`bounced_bills` —
        this only asks "if that income were credited first instead, would the
        account ever actually go negative?" A recommendation is an
        instruction to act; "move £X right now" is wrong when the money that
        covers it is already expected in that same account that same day.

    (b) MOVEMENT-ONLY — of every bill this account's deficit actually
        bounces (not just the first — a deficit cascades), is at least one a
        genuine commitment/discretionary obligation? If every bounced item is
        `movement` (the user's own standing order to savings/another own
        account/investment/debt), there is no obligation that can fail
        expensively here, so no recommendation fires. `shortfall_bill` (the
        FIRST bounced item) is deliberately not used alone: it can itself be
        the movement that starts the drain while a later, genuinely-owed bill
        on the same account also bounces and must still be covered — in that
        case this returns THAT bill, not the movement, so the card's copy
        never misdescribes a standing order as "your bill".
    """
    if optimistic_min_running.get(dest_acct, min_bal) >= -0.5:
        return None
    bounced = bounced_bills.get(dest_acct, [])
    real_bounced = [b for b in bounced if b.get("kind") != MOVEMENT]
    if not real_bounced:
        return None
    return real_bounced[0]


# ── Overdraft destinations ────────────────────────────────────────────────────
# An account can be genuinely negative today independent of any bill: either
# with nothing due on it inside the window at all (`_walk_events` never seeds
# `running`/`min_running` for such an account — only `assessable_bills`
# accounts get seeded), or WITH a bill in the window whose every bounce is
# `movement` (the user's own standing order) — `_gate_recommendation` gate (b)
# deliberately suppresses THAT, because it exists to stop Penny nagging about
# a PROJECTED shortfall the user created by moving their own money. That
# suppression has no business hiding a card about money the user is ALREADY
# overdrawn on TODAY — the live balance is a fact, not a forecast. These two
# pure, DB-free helpers back the overdraft branch added to
# `compute_today_items` (see "4b. OVERDRAFT SEEDING" and step 1's shortfall
# collection) — same pattern as `_gate_recommendation`, unit-tested directly.

def _overdraft_deficits(
    accounts: list[dict],
    live_balances: dict[str, float],
) -> dict[str, float]:
    """Every account whose LIVE balance today is strictly negative. Returns
    {account_id: live_balance} for every qualifying account.

    Deliberately INDEPENDENT of whether `_walk_events` touched the account
    (i.e. whether it has an in-window bill) and independent of what
    `_gate_recommendation` decided about any bill on it — the trigger is the
    live balance alone. The caller decides separately (in `compute_today_
    items`) whether an account already produced a bill-backed shortfall and,
    if so, lets that win rather than double-emitting (see step 1).

    TRIGGER — deliberately NO noise floor: any strictly negative live
    balance qualifies. Unlike the -0.5 thresholds used elsewhere in this
    file (`_REOPEN_THRESHOLD`, `_gate_recommendation`'s same-day-income
    gate), this reads a REAL bank balance, not a projection — -£0.01 here is
    a fact, not simulation noise, so there is no threshold to tidy into one.

    Credit cards are excluded — a negative card balance is ordinary debt
    against a credit limit, never an overdraft. Offline/manual accounts are
    excluded by construction (`compute_today_items` only ever calls this
    with `all_uk_accounts`, never `offline_accounts` — offline stays
    source-only, per product decision) AND belt-and-braces here via the
    `_offline` marker (`_is_offline`), in case a caller ever passes one in.
    """
    out: dict[str, float] = {}
    for acc in accounts:
        sid = acc.get("_str_id")
        if not sid:
            continue
        if is_credit_card_account(acc) or _is_offline(acc):
            continue
        bal = live_balances.get(sid, 0.0)
        if bal < 0:
            out[sid] = bal
    return out


def _shortfall_for_destination(
    dest_acct: str,
    min_bal: float,
    shortfall_bill: dict[str, dict],
    bounced_bills: dict[str, list[dict]],
    optimistic_min_running: dict[str, float],
    overdraft_today: dict[str, float],
    window_income: list[dict],
    confirmed_income_keys: set,
) -> tuple[int, float, dict | None] | None:
    """Decide the single (days_away, shortfall_amount, bill | None) entry to
    represent `dest_acct` with, or `None` to emit nothing for it — the "one
    shortfall per destination, bill-backed wins" rule described in
    `compute_today_items`' step 1. Pulled out as a pure, DB-free function so
    the movement-only-bounce-but-live-overdrawn case and the no-double-
    emission rule can be unit-tested directly (see
    tests/test_companion_shortfall.py).

    `dest_acct` reaches this via up to two independent routes:
      - bill-backed: `dest_acct in shortfall_bill`, gated by
        `_gate_recommendation` (same-day income + movement-only rules).
      - overdraft: `dest_acct in overdraft_today` (a live negative balance
        today, from `_overdraft_deficits` — independent of any bill), gated
        by `_overdraft_covered_by_today_income`.

    An account can genuinely qualify for both at once: overdrawn TODAY *and*
    carrying an in-window bill whose every bounce is `movement` — gate (b)
    suppresses recommending THAT specifically (it exists to stop Penny
    nagging about a shortfall the user caused by moving their own money), but
    that has no business hiding the fact that the account is ALSO overdrawn
    right now, which is not a projection. The bill-backed route wins
    whenever it fires (richer copy, and its `min_running`-derived amount
    already clears the live deficit too, since the walk starts from that
    same live balance) — the overdraft route is a fallback for when the
    account is genuinely negative today but no bill-backed card says so.
    """
    if dest_acct in shortfall_bill:
        # `_gate_recommendation` applies the two suppression rules (same-day
        # income, movement-only) — see its docstring — and picks the right
        # bill to represent the card with when it doesn't suppress.
        _display_bill = _gate_recommendation(
            dest_acct, min_bal, shortfall_bill, bounced_bills, optimistic_min_running
        )
        if _display_bill is not None:
            return (_display_bill["days_away"], abs(min_bal), _display_bill)
    if dest_acct in overdraft_today:
        # OVERDRAFT fallback — either no bill drove this deficit at all, or
        # the only bill(s) that did were movement-only and gate (b) rightly
        # suppressed them above; the account is independently negative RIGHT
        # NOW (`overdraft_today`, a live balance read). Size this off the
        # LIVE balance, not `min_bal` — for an account that also has an
        # in-window movement bill, `min_bal` is the CONSERVATIVE full-walk
        # figure and can be more negative than the live balance (it already
        # counts that suppressed movement going out). Sizing off `min_bal`
        # here would silently fund the very movement gate (b) just declined
        # to recommend covering — exactly what gate (b) exists to prevent.
        # The live-balance figure is the honest "you're overdrawn right now"
        # fact on its own.
        _od_deficit = abs(overdraft_today[dest_acct])
        # Gate (a)'s same-day-income spirit still applies, via
        # `_overdraft_covered_by_today_income` (the shared walk never saw
        # this account's income when it has no bill, so
        # `optimistic_min_running` can't answer this for us either way).
        # Sorted as days_away=0 by the caller: it's happening right now.
        if not _overdraft_covered_by_today_income(
            _od_deficit, dest_acct, window_income, confirmed_income_keys
        ):
            return (0, _od_deficit, None)
    return None


def _overdraft_covered_by_today_income(
    deficit: float,
    dest_acct: str,
    window_income: list[dict],
    confirmed_income_keys: set,
) -> bool:
    """True when reliable income already attributed to `dest_acct` (passing
    `income_credit_ok`) and expected TODAY (`days_away == 0`) would, on its
    own, clear the live deficit.

    Mirrors gate (a) of `_gate_recommendation` for overdraft destinations,
    which never enter the shared `_walk_events` simulation in the first
    place (no bill on the account this window means no event, so the
    walk never sees the account's income either — this reasons over
    `window_income` directly instead). A recommendation is an instruction
    to act; "move money" is wrong when the money that already clears the
    account is landing there today anyway.
    """
    today_income = sum(
        float(i["amount"])
        for i in window_income
        if i.get("days_away") == 0
        and income_credit_ok(i, dest_acct, confirmed_income_keys)
    )
    return today_income >= deficit


# A "done" recommendation only had a one-way lifecycle: nothing ever put it
# back into play if the SAME fingerprinted shortfall reopened later. These two
# pure, DB-free helpers back the reactivation pass in `compute_today_items`
# (see "5c. Reactivation" below) and its celebration-damping partner in the
# step-7 auto-verification pass — both unit-tested directly, same pattern as
# `_gate_recommendation` above.

# Same noise floor already used twice elsewhere in this file: the emission
# loop's own "is this destination actually covered" check (`dest_gap > 0.5`)
# and the same-day-income gate above (`optimistic_min_running... >= -0.5`). A
# doc that dipped to -£0.02 and bounced back is projection noise, not a
# genuinely reopened shortfall — reactivating on that would flap.
_REOPEN_THRESHOLD = -0.5

# Bank data here only refreshes on the 4-hourly sync cron (see
# `sync_worker.py`'s `task_reconcile_truelayer` schedule), so the account
# state a celebration reacts to cannot genuinely change faster than that
# under normal use. Capping re-celebration to once per that same window means
# a balance that flaps across £0 between reactivation and resolution — e.g. a
# stray pending debit clearing and re-posting — resolves quietly (the doc
# still goes back to "done", just without a fresh "Sorted" toast/push) rather
# than congratulating the user every time projections wobble.
_RECELEBRATE_COOLDOWN_SECONDS = 4 * 3600


def _should_reactivate(stored: dict, min_running: dict[str, float]) -> bool:
    """True when a stored "done" move/payday_plan doc's destination(s) show a
    materially reopened shortfall in THIS request's `min_running` walk.

    Multi-destination (payday_plan) docs reopen if ANY listed destination is
    materially negative again — the plan's promise covered all of them, so a
    single account slipping back into deficit breaks it just as much as one
    ever did when the doc was first built."""
    dest_accts = stored.get("_dest_accts")
    if dest_accts and isinstance(dest_accts, list) and len(dest_accts) > 0:
        return any(min_running.get(d, 0.0) < _REOPEN_THRESHOLD for d in dest_accts)
    dest = stored.get("_dest_acct")
    if not dest:
        return False
    return min_running.get(dest, 0.0) < _REOPEN_THRESHOLD


def _recelebration_gated(stored: dict, now_utc: datetime) -> bool:
    """True when a doc that was previously reactivated resolved again TOO
    SOON after its last celebration — resolve it quietly (status "done", no
    new `_celebrated`/toast) instead of congratulating the user again.

    A doc that has never been reactivated (`_reactivated_at` absent) is
    always free to celebrate — this only damps the repeat-flap case."""
    if not stored.get("_reactivated_at"):
        return False
    ca = stored.get("_celebrated_at")
    if ca is None:
        return False
    return (now_utc - ca).total_seconds() < _RECELEBRATE_COOLDOWN_SECONDS


async def compute_today_items(uid: str, payday_preview: bool = False) -> list[dict]:
    """Compute companion items for `uid`. Cap at 3, moves first (one card per at-risk destination).

    `payday_preview`: force the Payday Plan section on regardless of window
    position, for design/QA. Preview mode builds and returns the card without
    persisting it and without suppressing the normal per-destination cards.
    """

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
    try:
        payday_buffer = max(0, min(500, int(prefs.get("payday_buffer", 50))))
    except (TypeError, ValueError):
        payday_buffer = 50
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

    # Payday Plan window — the moment to distribute the month. Position within
    # the CURRENT pay period (distinct from `next_pay`, which describes the
    # upcoming payday, not where `today_d` sits in the period that's live now).
    from app.services.pay_period import get_pay_period_for_date as _pp_get_period
    _pstart, _pend = _pp_get_period(today_d, pay_cfg)
    days_into_period = (today_d - _pstart).days + 1
    payday_window = days_into_period <= 3  # payday + 2 days: the moment to distribute the month

    window_end = next_pay  # inclusive of payday: bills/income with days_away <= days_to_pay
    lookahead = 5 if days_to_pay <= 1 else 0  # last-day lookahead: assess the next period's first 5 days once the current one is ending

    window_bills = [b for b in resp["upcoming_bills"] if b["days_away"] <= days_to_pay + lookahead]
    window_income = [i for i in resp["upcoming_income"] if i["days_away"] <= days_to_pay + lookahead]
    # Snapshot BEFORE preview consumption (below) mutates window_income by removing
    # reliably-credited items — the payday-plan salary-account selection always
    # reasons over the untouched window, preview or not.
    _orig_window_income = list(window_income)

    # Skip bills where we have no balance data, or the bill is on a credit card
    # (credit cards have a credit limit, not an available balance, so a bill
    # against one must never count toward at-risk/shortfall). Must match
    # at_risk_count's assessable_bills filter in app/routers/analytics.py.
    assessable_bills = [
        b for b in window_bills
        if b.get("account_balance") is not None
        and b["account_balance"] >= 0
        and not b.get("is_credit_card")
    ]

    # ── 3. Load ALL accounts ONCE; seed live balances from the same listing ─
    # (Single fetch pass replaces the old per-bill `$in` fetch here plus the
    # separate full listing in step 5 — same fields, one round trip per col.)
    all_uk_accounts: list[dict] = []
    _acct_proj = {"name": 1, "balance": 1, "current_balance": 1, "available_balance": 1,
                  "subtype": 1, "account_subtype": 1, "type": 1, "provider": 1, "currency": 1,
                  "nickname": 1, "display_name": 1}
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

    # PREVIEW = payday morning: reliable payday income is credited to its
    # landing account up front so the plan distributes the salary rather than
    # scraping pots mid-month.
    if payday_preview:
        _preview_consumed: list[dict] = []
        for i in window_income:
            _acct = str(i.get("account_id") or "")
            if income_credit_ok(i, _acct, confirmed_income_keys):
                live_balances[_acct] = live_balances.get(_acct, 0.0) + float(i["amount"])
                _preview_consumed.append(i)
        if _preview_consumed:
            _consumed_ids = {id(_i) for _i in _preview_consumed}
            window_income = [i for i in window_income if id(i) not in _consumed_ids]

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

    events.sort(key=lambda e: (e[0], 1 if e[3] else 0))  # same-day: bills before income (conservative — an on-payday debit must be covered by balance, not that day's income)

    # Walk shared with spend_impact._bills_risk (see _walk_events docstring) —
    # same events, same starting balances, same result as the inline loop
    # this replaced.
    _seed_balances = dict(running)
    running, min_running, shortfall_bill, bounced_bills = _walk_events(events, running)

    # SAME-DAY INCOME — for RECOMMENDATION gating only, never for the at-risk
    # DISPLAY. The conservative walk above (outflows-before-inflows on a
    # shared day) stays exactly as it was: analytics.py's at-risk badge and
    # the Planning page's own simulation both keep reasoning "a payment can
    # leave before the salary clears", and this walk still feeds
    # min_running/shortfall_bill/bounced_bills for everyone downstream. But a
    # RECOMMENDATION is an instruction to act, not a warning, and "move £X
    # right now" is simply wrong when reliable income (already vetted by
    # income_credit_ok, already attributed to this exact account) is
    # expected to land in that SAME account on the SAME day as the
    # outflows it's supposedly short for. This second walk answers exactly
    # that question — same events, same credited incomes, only the same-day
    # tie-break flips to income-before-outflows — and is consulted below
    # only to decide whether a "move money" card should fire, never to
    # change the amounts or the conservative simulation itself.
    _optimistic_events = sorted(events, key=lambda e: (e[0], 0 if e[3] else 1))
    _, optimistic_min_running, _, _ = _walk_events(_optimistic_events, _seed_balances)

    # ── 4b. OVERDRAFT SEEDING ────────────────────────────────────────────────
    # An account can be genuinely negative TODAY, independent of any bill (see
    # `_overdraft_deficits`'s docstring — no-bill-in-window and movement-only-
    # bounce are both covered). `_walk_events` above only ever seeds `running`/
    # `min_running` for accounts that appear in `assessable_bills` (see its
    # docstring); `_walk_events` itself, its inputs and its ordering are shared
    # byte-for-byte with `spend_impact._bills_risk` and analytics.py's at-risk
    # simulation, so they must not change. `_overdraft_today` is therefore
    # computed unconditionally (every negative live balance, whether or not
    # the walk touched that account), but only written into `running`/
    # `min_running` for keys the walk left untouched — an account the walk DID
    # compute already has the correct, more conservative figure there (its own
    # bill-driven walk, which is at least as negative as the live balance), so
    # writing over it would both be redundant and, worse, could UNDERSTATE a
    # genuine bill-driven deficit with the smaller live-balance figure.
    _overdraft_today = _overdraft_deficits(all_uk_accounts, live_balances)
    for _od_acct, _od_bal in _overdraft_today.items():
        if _od_acct not in running:
            running[_od_acct] = _od_bal
            min_running[_od_acct] = _od_bal

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

    # ── 5c. Reactivation — undo a stale "done" when a shortfall genuinely
    # reopens ─────────────────────────────────────────────────────────────
    # A doc reaches "done" when its destination's shortfall clears (step 7,
    # below, owns the rest of the lifecycle). Nothing previously undid that:
    # if the SAME fingerprinted shortfall reopened later, step 6's own-doc
    # check (`existing.get("status") == "done": continue`) suppressed it
    # forever, and step 7's reactivation branch only ever ran for
    # shortfalls that were ALREADY clearing again (`min_running >= 0`),
    # never for ones that had gone negative once more.
    #
    # This runs FIRST — before the Payday Plan section and step 6's
    # emission loop both read `companion_items_col` for "is this already
    # done" — using the `min_running` this request already computed. A doc
    # flipped back to "active" here is read as active by both, so the
    # recommendation reappears the SAME cycle, not a cycle late.
    async for _rstored in companion_items_col.find({
        "uid": uid,
        "type": {"$in": ["move", "payday_plan"]},
        "status": "done",
    }):
        _rid = _rstored["_id"]
        if _rid in dismissed:
            continue
        _rwindow = _rstored.get("_window_end", "")
        if _rwindow and date.fromisoformat(_rwindow) < today_d:
            continue  # expired — step 7 below retires it, not this pass
        if not _should_reactivate(_rstored, min_running):
            continue
        await companion_items_col.update_one(
            {"_id": _rid, "uid": uid},
            {
                "$set": {
                    "status": "active",
                    "_celebrated": False,
                    "_reactivated_at": datetime.utcnow(),
                },
                "$inc": {"_reactivation_count": 1},
            },
        )

    # Step 1: Collect shortfalls — a destination only reaches the
    # recommendation engine (the "move money" cards below) when its deficit
    # is genuinely something Penny is willing to instruct the user to act on.
    # `_shortfall_for_destination` (see its docstring) picks between the
    # bill-backed route (`shortfall_bill` + `_gate_recommendation`'s same-day-
    # income / movement-only gates) and the overdraft route (`_overdraft_
    # today`, a live negative balance today, independent of any bill), and
    # guarantees at most one entry per destination — the bill-backed route
    # wins when both would otherwise fire.
    #
    # `bill` is `None` for an OVERDRAFT shortfall — every downstream consumer
    # of `shortfalls` must check for that before reading bill fields.
    shortfalls = []  # (first_bounce_days_away, shortfall_amount, dest_acct, bill | None)
    for dest_acct, min_bal in min_running.items():
        if min_bal >= 0 or dest_acct == "__unknown__":
            continue
        _result = _shortfall_for_destination(
            dest_acct, min_bal, shortfall_bill, bounced_bills, optimistic_min_running,
            _overdraft_today, window_income, confirmed_income_keys,
        )
        if _result is None:
            continue
        _days_away, _amt, _bill = _result
        shortfalls.append((_days_away, _amt, dest_acct, _bill))
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
        ev.sort(key=lambda e: (e[0], 1 if e[1] > 0 else 0))  # same-day: outflows before inflows (mirrors conservative ordering above)
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
        # Belt-and-braces: a linked credit card must never enter the source
        # pool, regardless of what _is_current/_is_savings match — its
        # balance is debt against a credit limit, not money to move.
        if is_credit_card_account(acc):
            continue
        bal = live_balances.get(sid, float(acc.get("balance") or 0))
        if _is_current(acc) or _is_savings(acc) or _is_offline(acc):
            mn = _source_min_running(sid, bal)
            source_min_run[sid] = mn
            source_capacity[sid] = mn

    # Step 3: For every shortfall, find a source (split across multiple if needed)
    covered: list[dict] = []     # each entry = list of leg dicts
    uncovered: list[dict] = []
    dest_summaries: dict[str, dict] = {}
    # Per-destination shortfall amount actually used to size the move — kept
    # so the emission loop and the fingerprint bucketing below (dest_bucketed)
    # read the SAME figure Step 3 built legs against, rather than re-deriving
    # it from `min_running` directly (which, for an overdraft destination
    # that also carries a suppressed movement bill, can be more negative than
    # the figure actually used here — see the branch immediately below).
    dest_shortfall: dict[str, float] = {}

    for _days_away, _shortfall_amt, dest_acct, bill in shortfalls:
        # `bill` is None for an OVERDRAFT destination. Every field below that
        # would normally come from the bill must be handled honestly instead
        # of falling back to a fabricated one.
        is_overdraft = bill is None

        if is_overdraft:
            # Size off the LIVE balance (`_overdraft_today`), not
            # `min_running[dest_acct]`. The two coincide for an account with
            # no in-window bill at all (nothing else ever touches
            # `min_running` for it), but for an account that ALSO carries a
            # movement-only bill gate (b) suppressed, `min_running` is the
            # more negative post-movement figure — sizing off it here would
            # silently fund the very movement gate (b) just declined to
            # recommend covering. See step 1's matching comment.
            shortfall = abs(_overdraft_today[dest_acct])
        else:
            shortfall = abs(min_running[dest_acct])
        dest_shortfall[dest_acct] = shortfall
        amount_needed = _ceil5(shortfall) + 10

        # Bill details
        if is_overdraft:
            bill_name = None
            bill_amount = None
            bill_weekday = None
        else:
            bill_name = bill.get("name", "bill")
            bill_amount = int(round(float(bill.get("amount", 0))))
            bill_date = date.fromisoformat(bill["expected_date"])
            bill_weekday = _when_label(bill_date, today_d)

        # Destination account details
        dest_name = _clean_name(bill.get("account_name") if bill else None, dest_acct)
        dest_provider = "Bank"
        dest_balance = live_balances.get(dest_acct, 0.0)
        for acc in all_uk_accounts:
            if acc["_str_id"] == dest_acct:
                dest_name = _clean_name(acc.get("name"), dest_name)
                dest_provider = _provider_of(acc)
                dest_balance = live_balances.get(dest_acct, float(acc.get("balance") or 0))
                break

        if is_overdraft:
            # No in-window bill exists at all — an empty bill list is the
            # honest answer, not a fabricated one (see `_build_move_map`'s
            # "no fallback" comment below for why the old `dest_bills =
            # [bill]` line would have been wrong here).
            dest_summaries[dest_acct] = {
                "account_id": dest_acct,
                "name": dest_name,
                "provider": dest_provider,
                "balance": float(dest_balance),
                "needs_total": 0,
                "needs_by": "",
                "bills": [],
                "is_overdraft": True,
            }
        else:
            # Fan-in destination summary: ALL of this account's in-window bills that land
            # on or before its first income event (bills sort before income on the same
            # day — conservative — so a bill on the income day is NOT covered by that
            # income and must still be held in balance).
            first_income_day = min(
                (i["days_away"] for i in credited_incomes.get(dest_acct, [])), default=None
            )
            dest_bills = sorted(
                (
                    b for b in assessable_bills
                    if (b["account_id"] or "__unknown__") == dest_acct
                    and (first_income_day is None or b["days_away"] <= first_income_day)
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
                "needs_by": _when_label(date.fromisoformat(dest_bills[0]["expected_date"]), today_d),
                "bills": [
                    {"label": _humanise_bill_name(b.get("name", "bill")), "amount": int(round(float(b["amount"])))}
                    for b in dest_bills
                ],
                "is_overdraft": False,
            }

        def _build_move_map(src_id, src_name, src_provider, src_balance, src_own_bills, leg_amount):
            if src_own_bills > 0:
                safe_note = f"Covers its own £{int(round(src_own_bills)):,} of bills with room to spare"
            elif is_overdraft:
                safe_note = "Nothing due from this account right now"
            else:
                safe_note = f"Nothing due from this account before {bill_weekday}"
            if is_overdraft:
                # Describe the actual state — there is no bill to name.
                incoming = f"£{_fmt_overdrawn(dest_balance)} overdrawn right now"
            else:
                human_bill = _humanise_bill_name(bill_name)
                incoming = f"£{bill_amount:,} {human_bill} expected {bill_weekday}"
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
                "is_overdraft": is_overdraft,
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
                f"around {_when}. It has landed in {_landing}, not {_dest_nm.strip()}. "
                f"If it does arrive, you'll simply need less."
            )
        else:
            income_note_by_dest[_dest] = (
                f"This plan doesn't count the £{int(round(_amt)):,} that sometimes arrives "
                f"around {_when}. It hasn't been steady enough to plan around. "
                f"If it lands, you'll simply need less."
            )

    # Per-destination bucketed amounts — the fingerprint input. Bucketing to the
    # nearest £50 keeps a card's identity stable under £1-level drift while a
    # materially different problem produces a different card.
    dest_bucketed: dict[str, int] = {}
    for _da, _sa, dest_acct_fp, _bill in shortfalls:
        dest_bucketed[dest_acct_fp] = round((_ceil5(dest_shortfall[dest_acct_fp]) + 10) / 50) * 50

    # Grouped once, up front — shared by the Payday Plan card below and the
    # per-destination emission loop.
    legs_by_dest: dict[str, list[dict]] = {}
    for leg in covered:
        legs_by_dest.setdefault(leg["dest_acct"], []).append(leg)
    uncovered_by_dest: dict[str, dict] = {u["dest_acct"]: u for u in uncovered}

    # ── 5b. PAYDAY PLAN — salary allocation engine, payday + 2 days ─────────
    # On the moment that sets up the whole period, we allocate the landed
    # salary across the user's own non-credit-card accounts: per account,
    # target = period bills + typical everyday spend + buffer; move =
    # max(0, target − balance). `payday_preview` forces this section on (for
    # design/QA) without persisting the doc or suppressing the normal
    # per-destination cards.
    _effective_payday_window = payday_window or payday_preview
    _suppress_moves = False
    if _effective_payday_window:
        # PREVIEW reads the PROJECTED payday-morning balance — today's live
        # balance carried through the running-balance walk above (`running`),
        # which already debits this period's remaining bills and credits
        # window income on top of the preview salary credit (step 4). Using
        # today's raw snapshot instead would ignore that the current period's
        # bills drain the account before payday actually arrives. Falls back
        # to live_balances for accounts the walk never touched (no bills in
        # window). Real payday keeps live_balances as-is: the salary has
        # genuinely landed and the window IS the fresh period, so there's no
        # "before payday" drain left to project. Deliberately NOT floored at
        # 0 — an account genuinely projected negative needs target + the
        # deficit to actually recover, not just the target.
        _bal = (
            (lambda acct_id: running.get(acct_id, live_balances.get(acct_id, 0.0)))
            if payday_preview
            else (lambda acct_id: live_balances.get(acct_id, 0.0))
        )

        # Salary account + amount — the most reliable in-window income item,
        # falling back to "the current account with the most cash" when no
        # income is confidently landing this window (e.g. mid-month preview).
        # Reasons over the UNMUTATED income snapshot, preview or not.
        _income_candidates = [
            i for i in _orig_window_income
            if income_credit_ok(i, str(i.get("account_id") or ""), confirmed_income_keys)
        ]
        if _income_candidates:
            _salary_income = max(_income_candidates, key=lambda i: float(i["amount"]))
            salary_acct = str(_salary_income.get("account_id") or "")
            salary_amount = int(round(float(_salary_income["amount"])))
        else:
            _current_accts = [a for a in all_uk_accounts if not is_credit_card_account(a)]
            if _current_accts:
                salary_acct = max(_current_accts, key=lambda a: _bal(a["_str_id"]))["_str_id"]
            else:
                salary_acct = None
            salary_amount = 0

        # Degenerate case — no accounts at all. Skip the card rather than crash.
        if salary_acct is not None:
            # Mid-month preview must see bills that fall early in the NEXT
            # period (e.g. a mortgage/loan due on the 1st) — window_bills only
            # spans to the next payday, so it undercounts a preview taken
            # mid-period. On a real payday the window already spans the whole
            # period, so window_bills stays correct there.
            #
            # NEXT-PERIOD ONLY (days_away > days_to_pay): the incoming salary
            # funds the period that's about to START, not the one ending
            # today. Using the full unbounded horizon here stacked the rest
            # of THIS period's bills AND all of next period's against one
            # salary (~5 weeks of demand vs 1 month), crushing discretionary
            # allocations to near-zero. The current period's remaining bills
            # are already accounted for separately — they drain the balance
            # `_bal` below projects forward to payday morning, so funding
            # them again here would double-count them.
            _plan_bills = (
                [
                    b for b in resp["upcoming_bills"]
                    if not b.get("is_credit_card") and b.get("days_away", 0) > days_to_pay
                ]
                if payday_preview
                else window_bills
            )

            def _acct_bills(acct_id: str) -> tuple[float, int]:
                """Sum/count of THIS account's bills from `_plan_bills` (ALL
                known bills, not just the balance-assessable subset
                `assessable_bills` is scoped to) — the payday plan sizes
                targets off everything due, regardless of whether we have
                balance data to shortfall-simulate."""
                _total = 0.0
                _count = 0
                for _b in _plan_bills:
                    if str(_b.get("account_id") or "") == acct_id and not _b.get("is_credit_card"):
                        _total += float(_b["amount"])
                        _count += 1
                return _total, _count

            recurring_keys = {r.get("key") for r in (cached.get("recurring_spend") or []) if r.get("key")}
            everyday_spend = await _per_account_everyday_spend(uid, recurring_keys)
            usual_moves = await _usual_payday_moves(uid, salary_acct, pay_cfg)
            # Active commitments lift their destination pot's move to at least
            # the sum of their per-period slices ({} on any failure). Each
            # goal's whole slice routes to its FIRST CONNECTED pot; manual
            # (offline) pots never appear as keys — they aren't plan dests.
            commitment_slices = await _active_commitment_slices(uid, pay_cfg, live_balances)

            def _salary_bills_excl_own_dests(acct_id: str) -> tuple[float, int]:
                """Like `_acct_bills`, but excludes predicted bills that
                duplicate this plan's own dest legs. Standing orders FROM the
                salary account TO the user's own accounts (e.g. a £100/mo
                "RAINY DAY SAVER STO") get predicted as recurring bills here
                AND re-created as this plan's own dest moves below — own-
                account standing orders are re-created as this plan's legs —
                reserving them as bills too would double-count; external
                outflows (investments, card DDs) stay reserved, since they
                have no matching dest move. Each `usual_moves` value is
                consumed at most once so two £100 bills against a single
                £100 usual dest only drop one."""
                _remaining = list(usual_moves.values())
                _total = 0.0
                _count = 0
                for _b in _plan_bills:
                    if str(_b.get("account_id") or "") != acct_id or _b.get("is_credit_card"):
                        continue
                    _amt = float(_b["amount"])
                    _match_idx = next(
                        (i for i, u in enumerate(_remaining) if abs(u - _amt) <= 2), None
                    )
                    if _match_idx is not None:
                        _remaining.pop(_match_idx)
                        continue
                    _total += _amt
                    _count += 1
                return _total, _count

            _salary_bills_total, _ = _salary_bills_excl_own_dests(salary_acct)
            _salary_spend_typical = int(everyday_spend.get(salary_acct, 0))
            _salary_target = _salary_bills_total + _salary_spend_typical + payday_buffer
            distributable = _bal(salary_acct) - _salary_target

            dests: list[dict] = []
            for acc in all_uk_accounts:
                acct_id = acc["_str_id"]
                if is_credit_card_account(acc):
                    continue
                if acct_id == salary_acct:
                    continue
                if acct_id in excluded_sources:
                    continue
                bills_total, bill_count = _acct_bills(acct_id)
                balance = _bal(acct_id)
                usual = usual_moves.get(acct_id)  # int or None — None means "no usual pattern seen"
                if _is_savings(acc):
                    # Savings pots: the user's saving intent is theirs (Grow
                    # owns recommendations) — mirror their ritual, never
                    # auto-buffer. No spend/buffer padding; the move is
                    # whatever they usually put in (accumulation, not
                    # target-filling — e.g. £100/mo to Rainy Day continues
                    # regardless of balance; pots with no habitual funding
                    # get nothing). Bills billed to a savings account are
                    # rare but still get covered on top.
                    spend_typical = 0
                    buffer = 0
                    move = usual if usual else 0
                    if bills_total > 0:
                        move = max(move, _ceil5(max(0.0, bills_total - balance)))
                    target = move + bills_total
                else:
                    spend_typical = int(everyday_spend.get(acct_id, 0))
                    buffer = payday_buffer
                    target = bills_total + spend_typical + buffer
                    move_raw = max(0.0, target - balance)
                    move = _ceil5(move_raw) if move_raw > 0 else 0
                # Commitments routed to this pot: the move becomes at least
                # the sum of their per-period slices (never lowered).
                _commit = commitment_slices.get(acct_id)
                if _commit:
                    _c_slice = int(_commit.get("slice_total") or 0)
                    if _c_slice > 0 and move < _c_slice:
                        move = _c_slice
                        if _is_savings(acc):
                            target = move + bills_total
                if not (move > 0 or usual is not None):
                    continue
                _dest_entry = {
                    "account_id": acct_id,
                    "name": _clean_name(acc.get("name"), acct_id),
                    "provider": _provider_of(acc),
                    "balance": int(round(balance)),
                    "bills_total": int(round(bills_total)),
                    "bill_count": bill_count,
                    "spend_typical": spend_typical,
                    "buffer": int(buffer),
                    "target": int(round(target)),
                    "move": int(move),
                    "usual": int(usual) if usual is not None else None,
                }
                if _commit and _commit.get("names"):
                    _dest_entry["commitment_names"] = list(_commit["names"])
                dests.append(_dest_entry)

            dests.sort(key=lambda d: d["move"], reverse=True)
            dests = dests[:10]

            total_moves = sum(d["move"] for d in dests)
            trimmed = False
            # Only trim when there's something to trim — an already-empty
            # destination list (nothing to move) is never "a tight month".
            if total_moves > 0 and total_moves > distributable:
                trimmed = True
                overage = total_moves - distributable

                # Phase 1 — reduce each dest's buffer portion, largest-move
                # dest first, until the overage clears or every buffer hits 0.
                for d in sorted(dests, key=lambda d: d["move"], reverse=True):
                    if overage <= 0:
                        break
                    cut = min(d["buffer"], overage)
                    if cut <= 0:
                        continue
                    d["buffer"] -= cut
                    d["target"] -= cut
                    d["move"] = max(0.0, d["move"] - cut)
                    overage -= cut

                # Phase 2 — if overage remains, scale down spend_typical
                # proportionally to each dest's share of the total spend_typical
                # pool, never cutting a dest's move below its bills-only floor.
                if overage > 0:
                    _pool = sum(d["spend_typical"] for d in dests if d["spend_typical"] > 0)
                    if _pool > 0:
                        for d in dests:
                            if overage <= 0 or d["spend_typical"] <= 0:
                                continue
                            weight = d["spend_typical"] / _pool
                            share = overage * weight
                            floor = max(0.0, d["bills_total"] - d["balance"])
                            max_cut = max(0.0, d["move"] - floor)
                            cut = min(share, d["spend_typical"], max_cut)
                            if cut <= 0:
                                continue
                            d["spend_typical"] -= cut
                            d["target"] -= cut
                            d["move"] = max(floor, d["move"] - cut)

                # Re-derive final integer moves (respecting each dest's
                # bills-only floor) and re-round the other fields.
                for d in dests:
                    floor = max(0.0, d["bills_total"] - d["balance"])
                    floor_ceil = _ceil5(floor) if floor > 0 else 0
                    move_ceil = _ceil5(d["move"]) if d["move"] > 0 else 0
                    d["move"] = max(move_ceil, floor_ceil)
                    d["buffer"] = int(round(d["buffer"]))
                    d["spend_typical"] = int(round(d["spend_typical"]))
                    d["target"] = int(round(d["bills_total"])) + d["spend_typical"] + d["buffer"]

                total = sum(d["move"] for d in dests)
            else:
                total = total_moves

            n_moves = len([d for d in dests if d["move"] > 0])
            covered = bool(total <= distributable)
            stays = int(distributable - total) if (distributable - total) >= 0 else 0

            if total > 0:
                headline = f"Payday plan: split £{salary_amount:,} across {n_moves} accounts"
            else:
                headline = "Payday plan: every account is already set"

            _salary_acc_obj = next((a for a in all_uk_accounts if a["_str_id"] == salary_acct), None)
            _salary_name = _clean_name(_salary_acc_obj.get("name") if _salary_acc_obj else None, salary_acct)
            _salary_provider = _provider_of(_salary_acc_obj) if _salary_acc_obj else "Bank"

            if covered:
                body = f"£{total:,} distributed, £{stays:,} stays in {_salary_name}."
            elif trimmed:
                body = f"A tight month: buffers trimmed so every payment is covered. £{total:,} distributed."
            else:
                body = f"£{total:,} distributed across {n_moves} accounts."

            _pp_fp = _shortfall_fingerprint([(d["account_id"], round(d["move"] / 50) * 50) for d in dests])
            _pp_item_id = f"payday_plan:{_pstart.isoformat()}:{_pp_fp}"

            if _pp_item_id not in dismissed:
                payday_plan_item = {
                    "id": _pp_item_id,
                    "type": "payday_plan",
                    "headline": headline,
                    "body": body,
                    "covered": covered,
                    "total": int(total),
                    "trimmed": bool(trimmed),
                    "salary": {
                        "account_id": salary_acct,
                        "name": _salary_name,
                        "provider": _salary_provider,
                        "amount": int(salary_amount),
                        "stays": stays,
                    },
                    "dests": dests,
                    "estimated": False,
                    "action": {"label": "See what's due ›", "route": "/planning"},
                }
                if payday_preview:
                    # Preview never touches persistence or state — build and
                    # return only, and never suppress the normal move cards.
                    payday_plan_item["preview"] = True
                    items.append(payday_plan_item)
                elif payday_window:
                    # Persist like the existing plan docs so the multi-dest
                    # auto-verification pass (step 7 below) flips this to "done"
                    # and celebrates once every listed destination clears.
                    _pp_existing = await companion_items_col.find_one({"_id": _pp_item_id, "uid": uid})
                    if not (_pp_existing and _pp_existing.get("status") == "done"):
                        _pp_doc = {
                            "_id": _pp_item_id,
                            "uid": uid,
                            "type": "payday_plan",
                            "status": "active",
                            "headline": headline,
                            "body": body,
                            "action": {"label": "See what's due ›", "route": "/planning"},
                            "estimated": False,
                            "created_at": datetime.utcnow(),
                            "_window_end": window_end.isoformat(),
                            "_dest_accts": [d["account_id"] for d in dests if d["move"] > 0],
                            "_total": int(total),
                            "covered": covered,
                            "dests": dests,
                            "salary": payday_plan_item["salary"],
                            "trimmed": bool(trimmed),
                        }
                        await companion_items_col.update_one(
                            {"_id": _pp_item_id, "uid": uid},
                            {"$set": {k: v for k, v in _pp_doc.items() if k != "_id"}},
                            upsert=True,
                        )
                        items.append(payday_plan_item)
                        # The plan card replaces the per-destination cards during
                        # the payday window.
                        _suppress_moves = True

    # ── 6. Emission — ONE CARD PER AT-RISK DESTINATION ──────────────────────
    # Each card is a self-contained instruction about ONE account: its own headline,
    # its own destination block (needs / by when / that account's bills), its own
    # source rows, its own total, its own footer and its own residual. Each carries
    # a per-destination fingerprinted id, so dismissal and auto-verification resolve
    # one account without touching the other. Ordered most urgent first — `shortfalls`
    # is already sorted by (first bounce day, then largest gap).
    emitted_dests = 0
    capped_out = 0

    for _da, _sa, dest_acct, bill in ([] if _suppress_moves else shortfalls):
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
            # Humanise once — the destination's ALL-CAPS product name is
            # shown in the headline, then referred to as "it" on second
            # mention in the body (no repeated full name, no shouting caps).
            _dest_display = humanise_account_name(u["dest_name"])
            if u.get("is_overdraft"):
                # OVERDRAFT, no viable source — describe the real state
                # honestly rather than inventing a bill to blame it on.
                headline = f"{_dest_display} is £{_fmt_overdrawn(u['shortfall'])} overdrawn."
                body = (
                    f"It's overdrawn right now, and there's no easy transfer source "
                    f"that can safely cover it without leaving another account short."
                )
            else:
                headline = f"£{int(round(u['shortfall']))} gap before {_dest_display} payday."
                body = (
                    f"Your £{u['bill_amount']} {_humanise_bill_name(u['bill_name'])} payment is expected "
                    f"{u['bill_weekday']}, but it's £{int(round(u['shortfall']))} short of cover, "
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
                "_dest_name": u["dest_name"],
                "_dest_needs_total": dest_summaries[dest_acct]["needs_total"],
                "_dest_bill_count": len(dest_summaries[dest_acct]["bills"]),
                "_bill_name": u["bill_name"],
                "_bill_amount": u["bill_amount"],
                "_is_overdraft": bool(u.get("is_overdraft")),
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
        # misrepresentation being fixed. Re-reads `dest_shortfall` (built in
        # Step 3) rather than `min_running[dest_acct]` directly — for an
        # overdraft destination that also carries a suppressed movement bill,
        # `min_running` is the more negative post-movement figure; `dest_
        # shortfall` is the live-balance figure Step 3 actually built legs
        # against, and this must stay consistent with that.
        amount_needed = _ceil5(dest_shortfall[dest_acct]) + 10
        _raw_gap = amount_needed - sum(float(_l["amount"]) for _l in dest_legs)
        dest_gap = _raw_gap if _raw_gap > 4 else 0.0
        dest_covered = dest_gap <= 0.5

        _is_overdraft_dest = bool(dest_summary.get("is_overdraft"))

        headline = f"Move £{total:,} to {dest_name}"
        if n_rows == 1:
            _r = rows[0]
            _covers_phrase = "covers it." if dest_covered else "covers most of it."
            _ds = dest_summaries.get(dest_acct) or {}
            _ds_bills = _ds.get("bills") or []
            _shortfall_i = int(round(_r["shortfall"]))
            if _is_overdraft_dest:
                # No bill drove this — the account is simply negative right
                # now (a live balance read, not a projection; see
                # `_overdraft_deficits`'s no-threshold rationale). Describe
                # the actual state instead of inventing a bill.
                _overdrawn_str = _fmt_overdrawn(_r["shortfall"])
                _clears_phrase = (
                    "clears it and leaves a small cushion." if dest_covered else "covers most of it."
                )
                body = (
                    f"It's £{_overdrawn_str} overdrawn right now. "
                    f"Moving £{total:,} from {_r['move_map']['from']['name']} {_clears_phrase}"
                )
            elif len(_ds_bills) > 1:
                # Account-level story: several payments leave this account before
                # payday; quote the total vs held so the shortfall is legible.
                _spare = int(round(total - _r["shortfall"]))
                _spare_phrase = f", with about £{_spare} spare." if (dest_covered and _spare >= 2) else "."
                _all_phrase = "covers all of them" if dest_covered else "covers most of it"
                body = (
                    f"{len(_ds_bills)} payments (£{_ds.get('needs_total', 0):,}) leave {dest_name} "
                    f"before period end and it holds £{int(round(_ds.get('balance', 0)))}. "
                    f"£{_shortfall_i} short. "
                    f"Moving £{total:,} from {_r['move_map']['from']['name']} {_all_phrase}{_spare_phrase}"
                )
            else:
                body = (
                    f"Your £{_r['bill_amount']} {_humanise_bill_name(_r['bill_name'])} is expected "
                    f"{_r['bill_weekday']} from {dest_name}. "
                    f"It's £{_shortfall_i} short. "
                    f"Moving £{total:,} from {_r['move_map']['from']['name']} {_covers_phrase}"
                )
        elif dest_covered:
            body = f"£{total:,} across {n_rows} moves keeps everything clearing at {dest_name}."
        else:
            body = f"£{total:,} across {n_rows} moves covers most of what {dest_name} needs."

        residual = None
        if dest_gap > 0.5:
            _residual_tail = (
                "so it may need a different plan." if _is_overdraft_dest
                else "so one payment may need a different plan."
            )
            residual = (
                f"These moves cover £{total:,}, but {dest_name} is still "
                f"£{int(round(dest_gap))} short, {_residual_tail}"
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
            "_is_overdraft": _is_overdraft_dest,
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
            "One more account is short this window. It'll show here once these are cleared."
            if capped_out == 1
            else f"{capped_out} more accounts are short this window. They'll show here once these are cleared."
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
            f"Sorted: {dest_name} is covered"
            if dest_name
            else "Sorted: those payments are covered"
        )
        _at_clause = f" at {dest_name}" if dest_name else ""
        if stored.get("_is_overdraft"):
            body = "It's back above £0."
        elif needs_total and bill_count > 1:
            body = f"£{int(round(float(needs_total))):,} of payments{_at_clause} are safe."
        elif bill_amount:
            body = f"The £{int(round(float(bill_amount))):,} {_humanise_bill_name(bill_name)} is safe."
        elif needs_total:
            body = f"£{int(round(float(needs_total))):,} of payments{_at_clause} are safe."
        else:
            body = "Everything due there before period end is safe."
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
        "type": {"$in": ["move", "payday_plan"]},
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
                    if _recelebration_gated(stored, _cel_now_utc):
                        # Reactivated and resolved again too soon after its
                        # last celebration — go quietly "done" with no fresh
                        # toast/push. See `_recelebration_gated` for why.
                        await companion_items_col.update_one(
                            {"_id": stored_id, "uid": uid},
                            {"$set": {"status": "done"}},
                        )
                        continue
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
                        "headline": "Sorted: this week's payments are covered",
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
                if _recelebration_gated(stored, _cel_now_utc):
                    # Reactivated and resolved again too soon after its last
                    # celebration — go quietly "done" with no fresh toast/push.
                    await companion_items_col.update_one(
                        {"_id": stored_id, "uid": uid},
                        {"$set": {"status": "done"}},
                    )
                    continue
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

    # ── 7b. Insight win narration ───────────────────────────────────────────
    # A savings insight whose triggering merchant has gone silent for 45+ days
    # is a verified saving (savings_insights stamps verified_savings /
    # verified_merchant / verified_at). Narrate it here as a celebration —
    # the user's own figure leads. First surfacing stamps celebrated_at on the
    # insight doc; the card then lives until dismissed or 7 days pass (same
    # stamp-then-lapse convention as move celebrations, on the insight's own
    # weekly cadence rather than the 24-hour "sorted" window).
    try:
        from app.db.collections import savings_insights_col

        _win_now = datetime.utcnow()
        _win_cursor = savings_insights_col.find({
            "user_id": uid,
            "verified_savings": {"$gt": 0},
            "celebration_lapsed": {"$ne": True},
        }).sort("verified_at", -1).limit(_MOVE_CARD_CAP)
        async for _ins in _win_cursor:
            _win_id = f"insight_win:{_ins.get('insight_id', str(_ins['_id']))}"
            if _win_id in dismissed:
                continue
            _win_ca = _ins.get("celebrated_at")
            if _win_ca is None:
                _win_ca = _win_now
                await savings_insights_col.update_one(
                    {"_id": _ins["_id"]},
                    {"$set": {"celebrated_at": _win_ca}},
                )
            if (_win_now - _win_ca).total_seconds() >= 7 * 86400:
                await savings_insights_col.update_one(
                    {"_id": _ins["_id"]},
                    {"$set": {"celebration_lapsed": True}},
                )
                continue
            _win_amt = float(_ins.get("verified_savings") or 0)
            if _win_amt <= 0:
                continue
            # Whole pounds where exact, pence where they matter — the figure
            # is verified from the user's own transactions, never hedged.
            _win_amt_str = f"{_win_amt:,.2f}".removesuffix(".00")
            _win_merchant = str(_ins.get("verified_merchant") or "").strip()
            _win_body = (
                f"{_win_merchant} hasn't taken a payment in over 6 weeks. That change stuck."
                if _win_merchant
                else "That payment hasn't gone out in over 6 weeks. That change stuck."
            )
            celebration_items.append({
                "id": _win_id,
                "type": "celebration",
                "headline": f"£{_win_amt_str}/mo is staying in your pocket",
                "body": _win_body,
                "action": None,
                "estimated": False,
            })
    except Exception as _win_exc:
        log.warning("insight win narration failed for %s: %s", uid, _win_exc)

    # ── 8. RHYTHM items ─────────────────────────────────────────────────────
    rhythm_items: list[dict] = []
    portrait = await behaviour_portrait_col.find_one({"_id": uid})
    if portrait and portrait.get("status") == "ok":
        traits_by_id = {t["id"]: t for t in portrait.get("traits", [])}
        today_obj = date.today()
        year_month = today_obj.strftime("%Y-%m")

        # BEHAVIOURS.md consent rule: a trait the user marked "keep" is an
        # accepted part of who they are — coaching/anticipation cards tied to
        # it must NOT fire. Only celebration-style items (e.g. the saving_habit
        # streak) remain allowed for a kept trait.
        def _trait_kept(trait_id: str) -> bool:
            return (traits_by_id.get(trait_id) or {}).get("choice") == "keep"

        # front_loader: within 3 days BEFORE the 1st of next month
        next_month_1st = (today_obj.replace(day=1) + timedelta(days=32)).replace(day=1)
        days_to_month_end = (next_month_1st - today_obj).days

        # Anticipation card — suppressed when the trait is marked "keep" (consent rule).
        if "front_loader" in traits_by_id and not _trait_kept("front_loader") and 0 < days_to_month_end <= 3:
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
        # Anticipation card — suppressed when the trait is marked "keep" (consent rule).
        if "credit_switch" in traits_by_id and not _trait_kept("credit_switch") and today_obj.day in (8, 9, 10):
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
                    f"This is the week your credit cards usually take over {card_desc}. "
                    f"Nothing to do, just so it doesn't sneak up."
                )
                # Personalise with the real month-to-date card delta, when available.
                # Falls back to the generic body above on any error or if the
                # movement so far this period is too small to be worth naming.
                try:
                    from app.services.needle import (
                        _credit_card_account_ids as _cs_cc_ids,
                        _txns_for_period as _cs_txns_for_period,
                        _card_delta as _cs_card_delta,
                    )
                    from app.services.pay_period import get_pay_period_for_date as _cs_get_period

                    _cs_period_start, _ = _cs_get_period(today_d, pay_cfg)
                    _cs_cc_id_set = await _cs_cc_ids(uid)
                    _cs_cc_txns = (
                        await _cs_txns_for_period(uid, _cs_period_start, today_d, _cs_cc_id_set)
                        if _cs_cc_id_set
                        else []
                    )
                    _cs_delta = _cs_card_delta(_cs_cc_txns)
                    if _cs_delta >= 10:
                        body = (
                            f"This is the week your credit cards usually take over {card_desc}. "
                            f"£{int(round(_cs_delta))} has gone on credit cards so far this month. "
                            f"Nothing to do now, it just joins your card plan."
                        )
                except Exception:
                    pass
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
                    "body": f"Looks like £{_amt:,.0f} from {_merchant} is expected on {_phrase}.",
                    "action": {"label": "Yes, that's it", "route": "/income/confirm-payday", "kind": "confirm_payday"},
                    "secondary_action": {"label": "No, set it myself", "route": "/spend", "kind": "set_payday"},
                    "estimated": False,
                    "proposal": proposal,
                })
    except Exception as _ask_exc:
        log.warning("ask:payday item failed for %s: %s", uid, _ask_exc)

    # ── 8d. ASK item (card terms) ───────────────────────────────────────────
    # Debt advice needs card terms (APR, promo end dates) and open banking
    # never provides them — they must be ASKED (Consent Rule: one dismissible
    # ask, never a nag). Emitted only while ≥1 card still wants an answer AND
    # the user actually carries a card balance worth planning around.
    try:
        if "ask:card_terms" not in dismissed:
            from app.db.collections import card_terms_col
            from app.services.card_rates import is_ask_eligible

            _cc_accounts = [a for a in all_uk_accounts if is_credit_card_account(a)]
            _has_balance = any(
                abs(live_balances.get(a["_str_id"], 0.0)) > 0.005 for a in _cc_accounts
            )
            if _cc_accounts and _has_balance:
                _terms_by_acct = {
                    d.get("account_id"): d
                    async for d in card_terms_col.find({"user_id": uid})
                }
                _ct_now = datetime.utcnow()
                _eligible = [
                    a for a in _cc_accounts
                    if is_ask_eligible(_terms_by_acct.get(a["_str_id"]), _ct_now)
                ]
                if _eligible:
                    _n = len(_eligible)
                    _ct_body = (
                        "Tell me the rate on your card and I can plan around it. Takes a minute."
                        if _n == 1 else
                        f"Tell me the rates on your {_n} cards and I can plan around them. Takes a minute."
                    )
                    ask_items.append({
                        "id": "ask:card_terms",
                        "type": "ask",
                        "headline": "Want your card picture sharp?",
                        "body": _ct_body,
                        "action": {"label": "Add my rates", "route": "/accounts?cardTerms=1", "kind": "card_terms"},
                        "estimated": False,
                    })
    except Exception as _ct_exc:
        log.warning("ask:card_terms item failed for %s: %s", uid, _ct_exc)

    # ── 8e. CLIFF items (promo rate ending) ────────────────────────────────
    # A confirmed promo ending within 60 days on a card that carries a balance
    # is a standing fact worth stating (facts, not coaching — no advice verbs).
    # One cliff per card at a time (the soonest non-dismissed qualifying promo);
    # the id carries the promo's end date so dismissing one cliff never
    # suppresses a different promo's later cliff on the same card.
    cliff_items: list[dict] = []
    try:
        from app.db.collections import card_terms_col
        from app.routers.card_terms import _promos_from_legacy
        from app.services.card_rates import is_credit_card_account as _is_cc

        _cliff_cc = [a for a in all_uk_accounts if _is_cc(a)]
        if _cliff_cc:
            _cliff_terms = {
                d.get("account_id"): d
                async for d in card_terms_col.find({"user_id": uid, "status": "confirmed"})
            }
            _cliff_window = 60
            for _acc in _cliff_cc:
                _sid = _acc["_str_id"]
                _doc = _cliff_terms.get(_sid)
                if not _doc:
                    continue
                _bal_mag = abs(live_balances.get(_sid, 0.0))
                if _bal_mag < 50:
                    continue
                _stored = _doc.get("promos")
                _promos = _stored if isinstance(_stored, list) else _promos_from_legacy(
                    _doc.get("on_promo"), _doc.get("promo_kind"), _doc.get("promo_end")
                )
                _qualifying = []
                for _p in _promos:
                    try:
                        _until_d = date.fromisoformat(str(_p.get("until") or ""))
                    except ValueError:
                        continue
                    _days_left = (_until_d - today_d).days
                    if 0 <= _days_left <= _cliff_window:   # today inclusive; ended promos excluded
                        _qualifying.append((_until_d, _p))
                _qualifying.sort(key=lambda t: t[0])
                for _until_d, _p in _qualifying:
                    _cliff_id = f"cliff:{_sid}:{_until_d.isoformat()}"
                    if _cliff_id in dismissed:
                        continue   # try the next-soonest promo on this card
                    _card_name = humanise_account_name(_clean_name(
                        _acc.get("nickname") or _acc.get("display_name") or _acc.get("name")
                    ) or "Credit card")
                    _when = _until_d.strftime("%-d %b")
                    _bal_str = f"£{int(round(_bal_mag)):,}"
                    _promo_rate = f"{float(_p.get('apr_pct') or 0.0):g}%"
                    if _p.get("kind") == "balance_transfer":
                        _headline = f"{_promo_rate} on balance transfers at {_card_name} ends {_when}, {_bal_str} is on it."
                    else:
                        _headline = f"{_promo_rate} on {_card_name} ends {_when}, {_bal_str} is on it."
                    _apr = _doc.get("apr_pct")
                    if _apr:
                        _monthly = int(round(_bal_mag * float(_apr) / 1200))
                        _body = f"From then it'd cost {float(_apr):g}%, about £{_monthly:,} a month, unless it's cleared or moved."
                    else:
                        _body = "Add its standard rate and I can say what that costs."
                    cliff_items.append({
                        "id": _cliff_id,
                        "type": "cliff",
                        "headline": _headline,
                        "body": _body,
                        "action": {"label": "See the card ›", "route": f"/accounts?cardTerms={_sid}"},
                        "estimated": False,
                        "_until": _until_d.isoformat(),
                    })
                    break   # one cliff per card at a time
            cliff_items.sort(key=lambda i: i["_until"])
            for _ci in cliff_items:
                _ci.pop("_until", None)
    except Exception as _cliff_exc:
        log.warning("cliff items failed for %s: %s", uid, _cliff_exc)

    # ── 8f. TRAJECTORY item (debt payoff trajectory) ──────────────────────────
    # Emitted when the debt picture is bad or drifting — silence is the reward
    # when verdict is "good".  At most ONE trajectory item is ever emitted.
    # The id carries the verdict so a worsening verdict re-appears immediately.
    # The /debt-plan page now exists — wire the button.
    trajectory_items: list[dict] = []
    try:
        from app.services.debt_plan import get_debt_plan_cached as _get_debt_plan

        _plan = await _get_debt_plan(uid)
        _verdict_str = _plan["totals"]["verdict"]

        if _verdict_str != "good":
            _traj_id = f"trajectory:{_verdict_str}:{today_d.strftime('%Y-%m')}"
            if _traj_id not in dismissed:
                _monthly_interest_now = _plan["totals"].get("monthly_interest_now") or 0.0
                _debt_free_month = _plan["totals"]["debt_free_month"]
                _material_cards = [c for c in _plan["cards"] if c["debt"] >= 50 and c.get("classification") != "cleared_monthly"]

                def _fmt_month(ym_str: str) -> str:
                    """Format 'YYYY-MM' → 'Mon YYYY' (omit year if same as today)."""
                    _y, _m = int(ym_str[:4]), int(ym_str[5:7])
                    _d_ref = date(_y, _m, 1)
                    if _y == today_d.year:
                        return _d_ref.strftime("%b")
                    return _d_ref.strftime("%b %Y")

                def _fmt_gbp(x: float) -> str:
                    return f"£{int(round(x)):,}"

                # Find the earliest first_interest_month that follows a promo segment
                # (i.e. the card where interest kicks in when a 0% promo expires)
                _promo_cliff_card = None
                _promo_cliff_month = None
                for _c in _material_cards:
                    _fim = _c.get("first_interest_month")
                    if not _fim:
                        continue
                    # Check whether any segment before _fim is a promo
                    _rs = _c.get("rate_schedule") or []
                    _has_promo = any(s["source"] == "promo" and (s["until"] or "") < _fim for s in _rs)
                    if not _has_promo:
                        # Also check: if any promo segment's until == previous month
                        _has_promo = any(s["source"] == "promo" for s in _rs)
                    if _has_promo and _c.get("balance_at_first_interest") is not None:
                        if _promo_cliff_month is None or _fim < _promo_cliff_month:
                            _promo_cliff_month = _fim
                            _promo_cliff_card = _c

                _traj_headline: str
                _traj_body: str
                _cliff_body: str = ""

                # Interest is always cited as the monthly bleed (£X a month right
                # now) — figure is observed from interest-charge transactions,
                # never derived arithmetic. Never a horizon-capped integral.
                if _verdict_str == "drifting":
                    if (
                        _debt_free_month
                        and _promo_cliff_card is not None
                        and _promo_cliff_month is not None
                        and _promo_cliff_card.get("monthly_interest_at_first")
                        and _promo_cliff_card.get("balance_at_first_interest")
                    ):
                        _bafi = _promo_cliff_card["balance_at_first_interest"]
                        _mif = _promo_cliff_card["monthly_interest_at_first"]
                        _traj_headline = (
                            f"At your current pace the cards clear in {_fmt_month(_debt_free_month)},"
                            f" £{int(round(_bafi)):,} would still be on the {humanise_account_name(_promo_cliff_card['name'])}"
                            f" when its 0% ends in {_fmt_month(_promo_cliff_month)}."
                        )
                        _cliff_body = f"From then it'd cost about £{int(round(_mif)):,} a month unless it's cleared or moved."
                    else:
                        _cliff_body = ""
                        _dfm_str = _fmt_month(_debt_free_month) if _debt_free_month else "unknown"
                        if _monthly_interest_now >= 1:
                            _traj_headline = (
                                f"At your current pace the cards clear in {_dfm_str},"
                                f" {_fmt_gbp(_monthly_interest_now)} a month in interest right now."
                            )
                        else:
                            _traj_headline = (
                                f"At your current pace the cards clear in {_dfm_str}."
                            )
                else:  # bad
                    if (
                        _promo_cliff_card is not None
                        and _promo_cliff_month is not None
                        and _promo_cliff_card.get("monthly_interest_at_first")
                        and _promo_cliff_card.get("balance_at_first_interest")
                    ):
                        _bafi = _promo_cliff_card["balance_at_first_interest"]
                        _mif = _promo_cliff_card["monthly_interest_at_first"]
                        _n_mat = len(_material_cards)
                        if _n_mat == 1:
                            _solo = _material_cards[0]
                            _traj_headline = (
                                f"The cards aren't coming down at your current pace,"
                                f" £{int(round(_solo['debt'])):,} carried on {humanise_account_name(_solo['name'])}."
                            )
                        else:
                            _carried_total = _plan["totals"]["buckets"]["carried_total"]
                            _traj_headline = (
                                f"The cards aren't coming down at your current pace,"
                                f" £{int(round(_carried_total)):,} carried across {_n_mat} cards."
                            )
                        _cliff_body = (
                            f"£{int(round(_bafi)):,} will still be on the {humanise_account_name(_promo_cliff_card['name'])}"
                            f" when its 0% ends in {_fmt_month(_promo_cliff_month)}."
                            f" From then it'd cost about £{int(round(_mif)):,} a month unless it's cleared or moved."
                        )
                    elif _monthly_interest_now >= 1:
                        _cliff_body = ""
                        _traj_headline = (
                            f"The cards aren't coming down at your current pace,"
                            f" {_fmt_gbp(_monthly_interest_now)} a month in interest right now."
                        )
                    else:
                        _cliff_body = ""
                        _n_mat = len(_material_cards)
                        if _n_mat == 1:
                            _solo = _material_cards[0]
                            _traj_headline = (
                                f"Your card isn't coming down at your current pace,"
                                f" {_fmt_gbp(_solo['debt'])} carried on {humanise_account_name(_solo['name'])}."
                            )
                        else:
                            _buckets = (_plan["totals"].get("buckets") or {})
                            _carried_total_fallback = _buckets.get("carried_total") or sum(c["debt"] for c in _material_cards)
                            _traj_headline = (
                                f"The cards aren't coming down at your current pace,"
                                f" £{int(round(_carried_total_fallback)):,} carried across {_n_mat} cards."
                            )

                # Body: combine cliff sentence + honest note when any material card has no rate on file
                _no_rate_count = sum(
                    1 for _c in _material_cards if _c.get("flags", {}).get("terms_missing")
                )
                _body_parts = []
                if _cliff_body:
                    _body_parts.append(_cliff_body)
                if _no_rate_count > 0:
                    _body_parts.append(
                        f"{_no_rate_count} card{'s have' if _no_rate_count > 1 else ' has'}"
                        f" no rate on file, so interest there isn't counted."
                    )
                _traj_body = " ".join(_body_parts)

                trajectory_items.append({
                    "id": _traj_id,
                    "type": "trajectory",
                    "headline": _traj_headline,
                    "body": _traj_body,
                    "action": {"label": "See the route ›", "route": "/debt-plan"},
                    "estimated": False,
                })
    except Exception as _traj_exc:
        log.warning("trajectory item failed for %s: %s", uid, _traj_exc)

    # ── 8g. RHYTHM CHECKPOINT items (category overspend question) ────────────────
    # Surfaces the rhythm question ("X ran N× your usual") on the Home brief.
    # At most ONE item per brief; highest multiple wins; Consent Rule: skip categories
    # already answered or aimed at this period.
    rhythm_checkpoint_items: list[dict] = []
    intent_pace_items: list[dict] = []
    try:
        from app.services.pace import (
            _BASELINE_DAYS as _PACE_BASELINE_DAYS,
            _read_cached_baseline,
            _write_cached_baseline,
            _total_baseline,
            load_spend_txns as _load_spend_txns,
            shaped_fraction as _shaped_fraction,
        )
        from app.services.categories import (
            get_category_kinds as _get_category_kinds,
            is_non_spend as _is_non_spend,
        )
        from app.services.checkpoints import engaged_categories as _engaged_categories

        # ONE kind-map read, shared by load_spend_txns and both loops below.
        _rc_kinds = await _get_category_kinds(uid)
        from app.db.collections import transactions_col as _rc_txns_col, yapily_transactions_col as _rc_yapily_col

        # ── resolve the current period ─────────────────────────────────────────
        from app.services.pay_period import get_pay_period_for_date as _get_period
        _rc_period_start, _rc_period_end = _get_period(today_d, pay_cfg)

        # ── load baseline (reuse cache — same key pace uses) ───────────────────
        _rc_baseline_key = _rc_period_start.isoformat()
        _rc_cached = await _read_cached_baseline(uid, _rc_baseline_key)
        if _rc_cached is not None:
            _rc_baseline, _rc_months = _rc_cached
            _rc_txns = await _load_spend_txns(
                uid, _rc_period_start, _rc_period_end, kind_map=_rc_kinds
            )
        else:
            _rc_txns = await _load_spend_txns(
                uid,
                _rc_period_start - timedelta(days=_PACE_BASELINE_DAYS),
                _rc_period_end,
                kind_map=_rc_kinds,
            )
            _rc_baseline, _rc_months = _total_baseline(_rc_txns, _rc_period_start)
            await _write_cached_baseline(uid, _rc_baseline_key, _rc_baseline, _rc_months)

        # thin history guard — same rule pace uses
        _rc_thin = _rc_months < 2

        # ── per-category period totals ─────────────────────────────────────────
        _rc_cat_spent: dict[str, float] = {}
        for _t in _rc_txns:
            if _rc_period_start <= _t["date"] <= _rc_period_end:
                _c = _t["category"]
                _rc_cat_spent[_c] = _rc_cat_spent.get(_c, 0.0) + _t["amount"]

        # ── days elapsed (pace rule: suppress multiple when < 5 days in) ───────
        _rc_days_elapsed = max(1, (today_d - _rc_period_start).days)
        _rc_suppress = _rc_days_elapsed < 5

        # ── Consent Rule: categories already answered/aimed this period ────────
        _rc_engaged = await _engaged_categories(uid, _rc_period_end)

        # ── score each eligible category ──────────────────────────────────────
        _rc_candidates: list[tuple[float, float, str]] = []  # (multiple, spent, category)
        for _cat, _spent in _rc_cat_spent.items():
            if _is_non_spend(_rc_kinds, _cat):
                continue
            if _cat in _rc_engaged:
                continue
            if _rc_suppress:
                continue
            _usual_30d = _rc_baseline.get(_cat)
            if _rc_thin or not _usual_30d:
                continue
            _usual_rate = _usual_30d / 30
            # Shaped "usual by now" (pace.py's shared S(f_now)) instead of the
            # linear rate*days_elapsed — so this multiple never contradicts
            # the shaped Spend page's own multiple for the same category.
            _rc_period_days = (_rc_period_end - _rc_period_start).days + 1
            _rc_shaped_frac = await _shaped_fraction(
                uid, _rc_period_start, pay_cfg, category=_cat, kind_map=_rc_kinds
            )
            _usual_by_now = _usual_rate * _rc_period_days * _rc_shaped_frac
            if _usual_by_now <= 0.01:
                continue
            _multiple = round(_spent / _usual_by_now, 1)
            if _multiple < 2.0:
                continue
            if _spent < 40.0:
                continue
            _rc_candidates.append((_multiple, _spent, _cat))

        if _rc_candidates:
            # highest multiple, tie-break by spent
            _rc_candidates.sort(key=lambda t: (t[0], t[1]), reverse=True)
            _rc_mult, _rc_spent, _rc_cat = _rc_candidates[0]
            _rc_item_id = f"rhythm:{_rc_cat}:{_rc_period_end.isoformat()}"

            if _rc_item_id not in dismissed:
                # ── dominant: largest single transaction if it accounts for ≥70% ──
                _rc_dominant = None
                try:
                    from datetime import datetime as _datetime
                    _rc_start_dt = _datetime(_rc_period_start.year, _rc_period_start.month, _rc_period_start.day)
                    _rc_end_dt = _datetime(_rc_period_end.year, _rc_period_end.month, _rc_period_end.day, 23, 59, 59)
                    _rc_raw_txns: list[dict] = []
                    for _col in (_rc_txns_col, _rc_yapily_col):
                        async for _doc in _col.find(
                            {
                                "user_id": uid,
                                "transaction_type": {"$in": ["debit", "credit"]},
                                "date": {"$gte": _rc_start_dt, "$lte": _rc_end_dt},
                            },
                            {
                                "amount": 1, "date": 1, "category": 1, "custom_category": 1,
                                "transaction_type": 1, "merchant_name": 1, "description": 1,
                            },
                        ):
                            _doc_cat = _doc.get("custom_category") or _doc.get("category") or "Other"
                            if _doc_cat != _rc_cat:
                                continue
                            _doc_amt = abs(float(_doc.get("amount") or 0))
                            if _doc.get("transaction_type") == "credit":
                                _doc_amt = -_doc_amt
                            if _doc_amt <= 0:
                                continue
                            _rc_raw_txns.append({
                                "amount": _doc_amt,
                                "name": (_doc.get("merchant_name") or _doc.get("description") or "").strip(),
                                "date": (
                                    _doc["date"].date()
                                    if hasattr(_doc.get("date"), "date")
                                    else _doc.get("date")
                                ),
                            })
                    if _rc_raw_txns and _rc_spent > 0:
                        _rc_biggest = max(_rc_raw_txns, key=lambda x: x["amount"])
                        if _rc_biggest["amount"] / _rc_spent >= 0.70:
                            _rc_dominant = {
                                "name": _rc_biggest["name"],
                                "amount": round(_rc_biggest["amount"], 2),
                                "date": _rc_biggest["date"].isoformat() if hasattr(_rc_biggest["date"], "isoformat") else str(_rc_biggest["date"]),
                            }
                except Exception as _dom_exc:
                    log.warning("rhythm checkpoint dominant failed for %s: %s", uid, _dom_exc)

                rhythm_checkpoint_items.append({
                    "id": _rc_item_id,
                    "type": "rhythm",
                    "headline": f"{_rc_cat} is running {_rc_mult:.1f}× your usual",
                    "body": f"£{_rc_spent:.2f} so far this period.",
                    "action": None,
                    "estimated": False,
                    "payload": {
                        "category": _rc_cat,
                        "multiple": _rc_mult,
                        "spent": round(_rc_spent, 2),
                        "period_end": _rc_period_end.isoformat(),
                        "dominant": _rc_dominant,
                    },
                })

        # ── 8h. INTENT PACE items (tracking a chosen change) ──────────────────
        # Closes the Mirror's intent loop: a quiet, factual mid-period pace line
        # for each category the user explicitly asked to work on. BEHAVIOURS.md
        # consent rule: this fires ONLY on an explicit "change" choice or an
        # active checkpoint the user created — never uninvited. Descriptive
        # figures, zero judgement, no risk colour. Reuses the SAME cached
        # per-category pace baseline machinery as the rhythm checkpoint above.
        try:
            if 8 <= _rc_days_elapsed <= 20 and not _rc_thin:
                _ip_change_cats: set[str] = set()
                if portrait and portrait.get("status") == "ok":
                    for _tr in portrait.get("traits", []):
                        if _tr.get("choice") != "change":
                            continue
                        _tr_cat = _tr.get("ref_category")
                        if not _tr_cat and _tr.get("id") == "signature_pleasure":
                            # Legacy cached portrait (pre-ref_category): the
                            # category only lives inside the title string.
                            _tr_title = _tr.get("title") or ""
                            if _tr_title.startswith("Your Signature: "):
                                _tr_cat = _tr_title[len("Your Signature: "):].strip()
                        if _tr_cat:
                            _ip_change_cats.add(_tr_cat)

                # An active checkpoint is the same consent signal, made in the Door.
                from app.services.checkpoints import checkpoint_map_for_period as _ip_cp_map
                _ip_cp = await _ip_cp_map(
                    uid, _rc_period_start, _rc_period_end, cat_spent=_rc_cat_spent
                )
                _ip_change_cats |= set(_ip_cp.keys())

                for _ip_cat in sorted(_ip_change_cats):
                    if _is_non_spend(_rc_kinds, _ip_cat):
                        continue
                    _ip_usual_30d = _rc_baseline.get(_ip_cat)
                    if not _ip_usual_30d:
                        continue  # no history — no "usual by now" to state
                    _ip_id = f"intent_pace:{_rc_period_start.isoformat()}:{_ip_cat}"
                    if _ip_id in dismissed:
                        continue
                    _ip_spent = _rc_cat_spent.get(_ip_cat, 0.0)
                    # Shaped "usual by now" instead of the linear
                    # rate*days_elapsed — see the rhythm-checkpoint multiple
                    # above for the same rationale.
                    _ip_period_days = (_rc_period_end - _rc_period_start).days + 1
                    _ip_shaped_frac = await _shaped_fraction(
                        uid, _rc_period_start, pay_cfg, category=_ip_cat, kind_map=_rc_kinds
                    )
                    _ip_pro_rata = _ip_usual_30d / 30 * _ip_period_days * _ip_shaped_frac
                    intent_pace_items.append({
                        "id": _ip_id,
                        "type": "intent_pace",
                        "headline": (
                            f"{_ip_cat}: £{int(round(_ip_spent))} so far "
                            f"vs £{int(round(_ip_pro_rata))} usual by now"
                        ),
                        "body": "Tracking the change you asked for, no action needed.",
                        "action": None,
                        "estimated": False,
                    })
        except Exception as _ip_exc:
            log.warning("intent pace item failed for %s: %s", uid, _ip_exc)
    except Exception as _rc_exc:
        log.warning("rhythm checkpoint item failed for %s: %s", uid, _rc_exc)

    # ── 9. Merge and cap at 3 ───────────────────────────────────────────────
    # Moves are capped at emission time (_MOVE_CARD_CAP); the slice is belt-and-braces.
    # Celebrations get the same allowance as move cards, so covering two accounts is
    # acknowledged twice rather than one card vanishing without a word.
    # Cliff items slot after celebrations (important standing fact), then trajectory
    # (debt pace — with the cliffs, after celebrations, before asks), then asks.
    result = (
        items[:_MOVE_CARD_CAP]
        + celebration_items[:_MOVE_CARD_CAP]
        + cliff_items[:2]
        + trajectory_items[:1]
        + ask_items[:1]
        + rhythm_checkpoint_items[:1]
        + needle_items[:1]
        + rhythm_items
        + intent_pace_items
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
