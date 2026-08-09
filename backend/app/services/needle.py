"""Month-close needle — the reward that closes the product's core loop.

Two facts, deterministically computed from transaction data:
  1. MOVEMENT  — net credit-card balance change this period vs last.
  2. MONTH-END CASH — cash in current accounts at the moment before payday.

All copy is template-rendered. Zero LLM calls in this module.
Design doctrine (BEHAVIOURS.md):
  - Descriptive only, never advice.
  - Red-is-Risk: card growth is stated in neutral slate, never red/amber.
  - The needle is a REWARD surface; bounce events are omitted entirely (they
    surface elsewhere; including them here would undermine the reward).
"""
from __future__ import annotations

import re
import logging
from datetime import date, datetime, timedelta, timezone
from typing import Any

from app.db.collections import (
    transactions_col,
    accounts_col,
    behaviour_portrait_col,
    needle_history_col,
)

log = logging.getLogger(__name__)

# Word-boundary returned/unpaid keywords (shared approach from behaviour.py)
_RETURNED_RE = re.compile(
    r"\b(returned|unpaid|bounced|dishonoured|dishonoure|late fee|overdraft fee|rejected payment)\b",
    re.IGNORECASE,
)


def _fmt(amount: float) -> str:
    """Format a positive amount as £X or £X,XXX."""
    return f"£{abs(amount):,.0f}"


def _abs_amounts(txns: list[dict]) -> tuple[float, float]:
    """Return (sum_debits, sum_credits) for a list of credit-card transactions."""
    debits = sum(float(t.get("amount", 0) or 0) for t in txns if t.get("transaction_type") == "debit")
    credits_ = sum(float(t.get("amount", 0) or 0) for t in txns if t.get("transaction_type") == "credit")
    return debits, credits_


async def _credit_card_account_ids(uid: str) -> set[str]:
    """Return account_ids that are credit-card accounts for this user."""
    raw = await accounts_col.find({"user_id": uid}).to_list(None)
    ids = set()
    for a in raw:
        subtype = (a.get("account_subtype") or a.get("subtype") or "").upper()
        atype = (a.get("account_type") or a.get("type") or "").lower()
        if "CREDIT" in subtype or atype in ("credit", "credit_card"):
            ids.add(str(a.get("account_id") or a.get("_id")))
    return ids


async def _current_account_ids(uid: str) -> list[dict]:
    """Return account docs that are current/transaction accounts.

    Classification is subtype-first, mirroring analytics.py's safe-to-spend
    endpoint and HomePage.tsx isSavings heuristic:
      - If subtype is present: include ONLY accounts whose subtype contains
        "TRANSACTION" or "CURRENT" AND does NOT contain "SAVING".
      - If subtype is absent/empty: fall back to type == "bank" (may include
        accounts without subtype data from older provider syncs).
    Savings pots (subtype="SAVINGS") are explicitly excluded so their balances
    never inflate the reconstructed current-account cash figure.
    """
    raw = await accounts_col.find({"user_id": uid}).to_list(None)
    result = []
    for a in raw:
        subtype = (a.get("account_subtype") or a.get("subtype") or "").upper()
        atype = (a.get("account_type") or a.get("type") or "").lower()
        if subtype:
            # Subtype present — use it exclusively; never include if SAVING
            if ("TRANSACTION" in subtype or "CURRENT" in subtype) and "SAVING" not in subtype:
                result.append(a)
        else:
            # Subtype absent — fall back to type == "bank"
            if atype == "bank":
                result.append(a)
    return result


def _to_dt(val: Any) -> datetime | None:
    """Coerce a date/datetime/string to a naive UTC datetime."""
    if val is None:
        return None
    if isinstance(val, datetime):
        return val.replace(tzinfo=None)
    if isinstance(val, date):
        return datetime(val.year, val.month, val.day)
    if isinstance(val, str):
        try:
            return datetime.fromisoformat(val.replace("Z", "+00:00")).replace(tzinfo=None)
        except ValueError:
            pass
        try:
            return datetime.strptime(val[:10], "%Y-%m-%d")
        except ValueError:
            pass
    return None


async def _txns_for_period(
    uid: str,
    period_start: date,
    period_end: date,
    account_ids: set[str] | None = None,
) -> list[dict]:
    """Fetch transactions for uid in [period_start, period_end] inclusive.
    Optionally filtered to `account_ids`.
    """
    start_dt = datetime(period_start.year, period_start.month, period_start.day)
    end_dt = datetime(period_end.year, period_end.month, period_end.day, 23, 59, 59)

    query: dict[str, Any] = {
        "user_id": uid,
        "date": {"$gte": start_dt, "$lte": end_dt},
    }
    if account_ids:
        query["account_id"] = {"$in": list(account_ids)}

    return await transactions_col.find(query).to_list(None)


def _card_delta(txns: list[dict]) -> float:
    """Net balance growth on credit cards: sum(debits) - sum(credits).

    Positive  → cards grew (more owed).
    Negative  → cards shrank (paid down / under-spent vs payments).
    """
    debits, credits_ = _abs_amounts(txns)
    return debits - credits_


async def _reconstruct_cash(uid: str, as_of: date) -> float:
    """Reconstruct total cash across current accounts at end-of-day `as_of`.

    Algorithm:
      live_balance - net_flow_since(as_of + 1)

    where net_flow = sum(credits since as_of+1) - sum(debits since as_of+1).
    Adding debits back and subtracting credits gives the balance AT as_of.
    """
    current_accounts = await _current_account_ids(uid)
    if not current_accounts:
        return 0.0

    total = 0.0
    day_after = as_of + timedelta(days=1)
    day_after_dt = datetime(day_after.year, day_after.month, day_after.day)

    for acc in current_accounts:
        acc_id = str(acc.get("account_id") or acc.get("_id"))
        live_bal = float(acc.get("balance") or acc.get("current_balance") or acc.get("available_balance") or 0)

        # Fetch all transactions since the day after as_of on this account
        subsequent = await transactions_col.find(
            {"user_id": uid, "account_id": acc_id, "date": {"$gte": day_after_dt}}
        ).to_list(None)

        net_since = 0.0
        for t in subsequent:
            amt = float(t.get("amount", 0) or 0)
            if t.get("transaction_type") == "credit":
                net_since += amt   # money came in after as_of → wasn't there at as_of
            else:
                net_since -= amt   # money went out after as_of → was still there at as_of

        total += live_bal - net_since

    return total


def _card_movement_line(delta: float, delta_prev: float | None) -> str:
    """Generate the movement line copy.

    Rules (BEHAVIOURS.md):
      - Cards down (delta < 0): factual positive, compare to last month if available.
      - Cards held steady (|delta| < 20): "held steady".
      - Cards grew (delta > 0): calm, factual, neutral tone — never advice.
    """
    if abs(delta) < 20:
        return "Credit cards held steady — balance barely moved this month."

    if delta < 0:
        # Cards shrank — positive direction
        line = f"Credit cards down {_fmt(abs(delta))} — your balance fell this period."
        if delta_prev is not None and abs(delta_prev) >= 20:
            if delta_prev > 0:
                # Last month grew, this month shrank — improvement
                swing = delta_prev - delta  # both contribute positively
                line += f" {_fmt(abs(swing))} better than last month."
            elif delta_prev < 0:
                # Both months shrank — compare magnitudes
                if abs(delta) > abs(delta_prev):
                    extra = abs(delta) - abs(delta_prev)
                    line += f" {_fmt(extra)} more than last month."
                elif abs(delta) < abs(delta_prev):
                    less = abs(delta_prev) - abs(delta)
                    line += f" {_fmt(less)} less than last month, but back on pace."
                else:
                    line += " Back on pace."
        return line

    # Cards grew — informational, calm, not alarming
    return f"Credit cards carried {_fmt(delta)} more this month."


def _history_is_credible(history: list[float], has_txns: bool) -> bool:
    """Return True when the cash history is non-degenerate and data-backed.

    Rules (honesty guard — reward surfaces must never assert unsupported claims):
      - At least 2 prior values must be present.
      - Not all prior values are identical (degenerate history = reconstruction
        loop froze on one date, repeating the same computed value).
      - has_txns: the reconstruction actually found transaction data (not just
        live balances with zero subsequent transactions = balance never changes).
    """
    if len(history) < 2:
        return False
    if all(v == history[0] for v in history):
        return False
    if not has_txns:
        return False
    return True


def _cash_line(cash: float, history: list[float], history_credible: bool = True) -> str:
    """Generate the month-end cash line.

    history = list of prior period-end cash values (oldest first).
    history_credible = False suppresses the superlative (honesty guard).
    """
    base = f"You reached payday with {_fmt(cash)} in hand."
    if not history or not history_credible:
        return base
    all_vals = history + [cash]
    if cash == max(all_vals) and len(history) >= 2:
        n = len(all_vals)
        base += f" — the most in {n} months."
    return base


def _headline(delta: float, cash: float, cash_history: list[float], history_credible: bool = True) -> str:
    """Pick the strongest TRUE positive headline.

    Priority:
      1. Cards shrank → needle moved (strongest signal).
      2. Best cash in N months → landed the month (only when history is credible).
      3. Neutral fallback.

    history_credible = False suppresses the cash-based superlative (honesty guard).
    """
    cards_shrank = delta < -20
    if cards_shrank:
        return "Your month closed — and the needle moved."

    if history_credible:
        all_vals = cash_history + [cash]
        if cash == max(all_vals) and len(all_vals) >= 2:
            return "You landed the month."

    return "Your month, closed."


async def _compute_needle_facts(uid: str, period_start: date, period_end: date) -> dict:
    """Compute needle facts WITHOUT writing to needle_history_col."""
    # ── Credit-card delta ────────────────────────────────────────────────────
    cc_ids = await _credit_card_account_ids(uid)
    cc_txns = await _txns_for_period(uid, period_start, period_end, cc_ids) if cc_ids else []
    delta = _card_delta(cc_txns)

    # Previous period
    from app.services.pay_period import prev_pay_period, get_pay_period_for_date
    from app.db.collections import preferences_col
    prefs = await preferences_col.find_one({"user_id": uid}) or {}
    pay_cfg = prefs.get("pay_period_config", {"type": "calendar_month"})

    prev_start, prev_end = prev_pay_period(period_start, pay_cfg)
    cc_txns_prev = await _txns_for_period(uid, prev_start, prev_end, cc_ids) if cc_ids else []
    delta_prev = _card_delta(cc_txns_prev) if cc_txns_prev else None

    # ── Month-end cash ───────────────────────────────────────────────────────
    # First check needle_history for stored values (exact, preferred)
    cash_history: list[float] = []
    cash_history_dates: list[str] = []
    cash_history_has_txns: bool = False  # honesty guard: did we see any transactions?

    # Walk back up to 5 prior periods.
    # IMPORTANT: advance via prev_pay_period(walk_start) not prev_pay_period(walk_end).
    # Using walk_end produces walk_end-1 which is inside the same period → infinite
    # loop returning the identical end-date on every iteration.
    walk_start, walk_end = prev_start, prev_end
    for _ in range(5):
        history_id = f"{uid}:{walk_end.isoformat()}"
        stored = await needle_history_col.find_one({"_id": history_id})
        if stored and "month_end_cash" in stored:
            cash_history.insert(0, float(stored["month_end_cash"]))
            cash_history_dates.insert(0, walk_end.isoformat())
            cash_history_has_txns = True  # stored doc implies real data was computed
        else:
            # Reconstruct
            try:
                reconstructed = await _reconstruct_cash(uid, walk_end)
                cash_history.insert(0, reconstructed)
                cash_history_dates.insert(0, walk_end.isoformat())
                # Check if any transactions were used in reconstruction
                # (absence of movement in ALL accounts for a past date means zero data)
                day_after = walk_end + timedelta(days=1)
                day_after_dt = datetime(day_after.year, day_after.month, day_after.day)
                current_accounts = await _current_account_ids(uid)
                for acc in current_accounts:
                    acc_id = str(acc.get("account_id") or acc.get("_id"))
                    cnt = await transactions_col.count_documents({
                        "user_id": uid, "account_id": acc_id, "date": {"$gte": day_after_dt}
                    })
                    if cnt > 0:
                        cash_history_has_txns = True
                        break
            except Exception as e:
                log.warning("needle: cash reconstruction failed for %s at %s: %s", uid, walk_end, e)
        walk_start, walk_end = prev_pay_period(walk_start, pay_cfg)
        if walk_end < period_start - timedelta(days=365):
            break  # don't walk more than a year back

    # Current period-end cash
    month_end_cash = await _reconstruct_cash(uid, period_end)

    # ── Bounce count ─────────────────────────────────────────────────────────
    # Reuse behaviour.py's word-boundary keyword approach (import concept, not function).
    # Bounce count is computed but NOT surfaced in needle copy — the needle is a
    # reward surface. Fees already appear in the Spend tab. (By design: BEHAVIOURS.md)
    all_period_txns = await _txns_for_period(uid, period_start, period_end)
    bounce_count = 0
    for t in all_period_txns:
        desc = (t.get("description") or t.get("name") or "").lower()
        if _RETURNED_RE.search(desc):
            bounce_count += 1

    # ── Saving streak ────────────────────────────────────────────────────────
    streak_weeks: int | None = None
    portrait = await behaviour_portrait_col.find_one({"_id": uid})
    if portrait and portrait.get("status") == "ok":
        for trait in portrait.get("traits", []):
            if trait.get("id") == "saving_habit":
                for ev in trait.get("evidence", []):
                    m = re.search(r"(\d+)-week", ev)
                    if m:
                        streak_weeks = int(m.group(1))
                        break
                break

    # ── Copy lines ───────────────────────────────────────────────────────────
    history_credible = _history_is_credible(cash_history, cash_history_has_txns)
    movement_line = _card_movement_line(delta, delta_prev)
    cash_line_text = _cash_line(month_end_cash, cash_history, history_credible)
    headline_text = _headline(delta, month_end_cash, cash_history, history_credible)

    lines: dict[str, str] = {
        "headline": headline_text,
        "movement": movement_line,
        "cash": cash_line_text,
    }
    if streak_weeks and streak_weeks >= 4:
        lines["streak"] = f"Saving streak intact — {streak_weeks} weeks."

    doc = {
        "_id": f"{uid}:{period_end.isoformat()}",
        "uid": uid,
        "period_start": period_start.isoformat(),
        "period_end": period_end.isoformat(),
        "card_delta": delta,
        "card_delta_prev": delta_prev,
        "month_end_cash": month_end_cash,
        "cash_history": cash_history,
        "cash_history_dates": cash_history_dates,
        "cash_history_credible": history_credible,
        "bounce_count": bounce_count,
        "streak_weeks": streak_weeks,
        "lines": lines,
        "computed_at": datetime.now(timezone.utc).isoformat(),
    }

    return doc  # NO update_one here


def _build_tomorrow_strings(lines: dict) -> dict:
    """Build the push + brief copy for a needle close — reusable by preview."""
    push_title = lines.get("headline", "Your month, closed.")
    push_body = lines.get("movement", "")
    if push_body and len(push_body) > 130:
        push_body = push_body[:127] + "…"

    brief_parts = []
    if lines.get("movement"):
        brief_parts.append(lines["movement"])
    if lines.get("cash"):
        brief_parts.append(lines["cash"])
    if lines.get("streak"):
        brief_parts.append(lines["streak"])
    brief_body = " ".join(brief_parts)

    return {
        "push_title": push_title,
        "push_body": push_body,
        "brief_headline": push_title,
        "brief_body": brief_body,
    }


async def compute_needle(uid: str, period_start: date, period_end: date) -> dict:
    """Compute the month-close needle for a CLOSED pay period.

    Returns a doc suitable for storage in needle_history_col.
    """
    doc = await _compute_needle_facts(uid, period_start, period_end)

    # Idempotent upsert
    await needle_history_col.update_one(
        {"_id": doc["_id"]},
        {"$set": {k: v for k, v in doc.items() if k != "_id"}},
        upsert=True,
    )

    return doc
