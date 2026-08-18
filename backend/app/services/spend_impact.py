"""The Spend → Plan bridge — the impact engine.

Answers one question the Spend page's pace reading never used to: "so what?".
If the pace shown right now holds for the rest of the period, does that
change what moves on payday, or when a card clears / a goal lands?

Doctrine
--------
- Never promises external money movement ("will") — everything here is a
  hedged projection ("if this holds", "about", "could be").
- Silence is the default. Most periods say nothing here at all — see the
  SILENCE RULES constants below, which gate every consequence.
- Pure-ish and cheap: this module never re-derives the payday-plan
  allocation maths (target/balance/trim) that lives in companion.py, and
  never re-derives the amortisation maths that lives in debt_plan.py. It
  calls their existing standalone helpers directly. Where a clean call
  wasn't available (there is no single "salary account" helper), the
  lighter option was taken: a cheap heuristic (`_infer_salary_account`)
  instead of replaying companion.py's whole payday-plan window logic.

Projection method ("if this holds" floor)
------------------------------------------
The projected total excess for the rest of the period is simply the excess
already accrued today — i.e. the assumption is the user reverts to their
usual daily rate for the remaining days, so the period-end excess is no
larger than what has already happened. This is the conservative floor, not
a forecast that spending keeps accelerating. `total_excess` (signed: positive
= over usual, negative = under usual) is computed by the caller
(`spend_verdict.py`, which already has the per-category pace signals) and
handed in on `verdict_ctx` — this module never re-touches transactions.

MOVE DELTA derivation (documented simplification)
---------------------------------------------------
"Usual move" = sum, PER DESTINATION, of max(companion._usual_payday_moves's
historical median transfer to that destination, active commitment slices
routed to that destination) + sum(debt_plan's current card
`movement.monthly`, cards with a balance only). The per-destination max()
matches companion.py:1170-1176's own rule exactly, for the same reason: a
commitment that is already being regularly funded shows up in its own
historical `_usual_payday_moves` figure, so adding the commitment slice on
top of it double-counts that money. A commitment slice is only ever added
on its own when its destination has NO historical usual move at all (a
newly created goal, or one funded from an account the salary never
usually touches). This is still a lighter-weight approximation of the
whole payday-plan trim/target walk (no balance/target/buffer maths, no
trimming) — just not an additive one. "Projected move" assumes the
period's signed excess eats into (or, if negative, frees up) the salary
account's distributable balance pound for pound:
`projected = max(0, usual - total_excess)`.

HORIZON derivation
-------------------
Debt: takes the plan's most material card (the one that sets
`totals.debt_free_month`, or the material card with the latest payoff),
and re-runs debt_plan._amortise with `movement.monthly - total_excess` in
place of the stored movement. If the resulting payoff month differs from
the stored one, that is the horizon.

Goal: walks ACTIVE commitments (oldest first — the pot-ledger claim order)
and, for the first one whose required per-period slice would still be
positive after the same delta, re-derives a new ETA month by pay-period
count. If that ETA lands in a different calendar month than the
commitment's stored `target_date`, that is the horizon.

Resolver order (Grow waterfall, filtered to what's actually affected):
debt > safety net > goal. Safety net (the single un-dated "safety net
funded" pillar goal, `app/routers/goals.py`) has no per-goal target month
to shift, so there is nothing to horizon-name for it this round — the slot
is left in the resolver order for when that changes.

`bills_risk` derivation ("at this pace" projection — the one exception)
------------------------------------------------------------------------
Every consequence above floors at today's already-accrued excess ("if this
holds": the assumption is the user reverts to usual for the days left, so
the projected total never grows past what's already happened). Bills-risk
is deliberately the ONE place that uses the aggressive projection instead:
today's daily excess rate (`total_excess / days_elapsed`) is assumed to
CONTINUE for every remaining day of the period, spread as extra daily debit
events on the salary/primary spending account (`_infer_salary_account` —
the same cheap heuristic `_usual_move_total` already uses; documented
simplification, see that function's docstring). This is intentionally
alarmist relative to the rest of the module: a bill going unpaid is a
harder consequence than a smaller payday move, so it earns the pessimistic
read rather than the floor.

`companion.py`'s `_walk_events` (the same per-account running-balance walk
`compute_today_items`'s own at-risk/shortfall sim uses) is run TWICE on the
same bills/income timeline: once unmodified (usual pace) and once with the
extra pace-outflow layered in. Causation test: a bill only qualifies as
bills-risk when its account's baseline walk stayed non-negative but the
paced walk goes materially negative — i.e. the excess pace is what causes
or materially worsens the shortfall. A bill that would already be short at
usual pace is left alone here; that is companion's Safe-to-Spend/shortfall
territory, not a spend consequence, and re-flagging it here would just be
noise on top of a card the user already sees. Resolver order in
`compute_spend_impact` puts `bills_risk` ahead of `horizon`/`move_delta`/
`permission` — a bill at risk is a harder fact than a smaller payday move
or a pushed-out horizon.
"""
from __future__ import annotations

import logging
import math
from datetime import date, datetime, timedelta

from app.db.collections import (
    accounts_col,
    cashflow_cache_col,
    commitments_col,
    preferences_col,
    transactions_col,
)
from app.services.categories import get_category_kinds, is_income

logger = logging.getLogger(__name__)

# ── Silence rules (the product) ──────────────────────────────────────────────
MIN_DAYS_ELAPSED = 5          # nothing fires before the period is 5 days old
MOVE_SILENCE_ABS = 25.0       # £ floor — a smaller delta is noise, not news
MOVE_SILENCE_FRAC = 0.10      # or 10% of the usual move, whichever is bigger
EXCESS_SILENCE_FLOOR = 0.50   # sub-50p signed excess is rounding, not a fact
GOAL_HORIZON_MAX_PERIODS = 120  # cap on a re-projected goal ETA (~10yr of periods)

# HORIZON CLAIM CAP — doctrine: "No conviction on predictions" (income/bill
# events and any external-money-movement claim get hedged, never a bare
# promise; see project memory `feedback_no_conviction_on_predictions`). A
# single mid-period excess reading (`_debt_horizon`/`_goal_horizon` both
# extrapolate from one period's delta) must never be allowed to manufacture a
# multi-year schedule change out of one period's noise. When the projected
# shift exceeds this many months in EITHER direction, the horizon consequence
# is suppressed entirely (the resolver falls through to move/permission
# instead) rather than surfaced with a disclaimer. Sustained improvement or
# slippage will keep re-showing a <=12-month shift period after period, which
# is the honest way to earn a bigger claim over time.
HORIZON_CLAIM_CAP_MONTHS = 12

# MOVE-CONSEQUENCE CONFIDENCE GATE — a near-new user with no established
# payday-move habit (moved_total £0, nothing yet in companion._usual_payday_moves'
# 4-payday history) must never be told their move "shrinks to about £0": there
# was never a move to shrink. `_usual_payday_moves_with_counts` (companion.py)
# is the only place that knows, per destination, how many of the 4 most recent
# paydays actually contributed a matched transfer — that count is the cheapest
# real evidence of a habit this module can get without re-deriving the whole
# payday-plan walk. The gate fires on whichever destination's HISTORICAL usual
# (not an active-commitment slice — a brand-new goal is a decision, not a
# habit) actually drives `_usual_move_total`'s sum; if none of the destinations
# are usual-driven, there is no habit evidence at all and the gate blocks by
# construction (evidence count stays 0).
MOVE_CONFIDENCE_FLOOR = 25.0        # £ — same order as MOVE_SILENCE_ABS, kept
                                     # as its own constant since it documents a
                                     # different rule (confidence, not noise)
MOVE_CONFIDENCE_MIN_PAYDAYS = 2     # contributing paydays required to trust "usual"
MOVE_SOFTEN_FLOOR = 10.0            # £ — below this, "shrinks to about £X" reads
                                     # as a bleak fake-precise number; say "nothing
                                     # spare" instead (see compose_reading / here)

# BILLS-RISK CAUSATION FLOOR — the paced walk's minimum running balance must
# clear more than this far past zero before a newly-negative account counts
# as "caused" by the excess pace. Guards the boundary against float-rounding
# noise flipping a near-£0 balance negative and reading as a manufactured
# risk; same order of magnitude as EXCESS_SILENCE_FLOOR, kept separate since
# it documents a different rule (causation, not overall-excess noise).
BILLS_RISK_MATERIAL_FLOOR = 0.50

_SALARY_LOOKBACK_DAYS = 60


def _yyyymm_diff_months(a: str, b: str) -> int:
    """Absolute month distance between two 'YYYY-MM' labels."""
    ay, am = (int(x) for x in a.split("-"))
    by, bm = (int(x) for x in b.split("-"))
    return abs((by - ay) * 12 + (bm - am))


def _pretty_yyyymm(label: str | None) -> str | None:
    """'2027-05' -> 'May 2027'."""
    if not label:
        return None
    try:
        y, m = label.split("-")
        return date(int(y), int(m), 1).strftime("%b %Y")
    except Exception:
        return None


async def _pay_cfg(uid: str) -> dict:
    prefs = await preferences_col.find_one({"user_id": uid}) or {}
    return prefs.get("pay_period_config", {"type": "calendar_month"})


async def _infer_salary_account(uid: str, kind_map: dict | None = None) -> str | None:
    """Cheap salary-account heuristic: the account with the most income-kind
    credit money landing over the last 60 days. This is deliberately lighter
    than companion.py's own in-window salary detection (which additionally
    reasons about payday timing and falls back to "biggest current account")
    — good enough for sizing a usual-move baseline, not precise enough to
    reuse for the payday plan itself.
    """
    if kind_map is None:
        kind_map = await get_category_kinds(uid)
    since = datetime.combine(date.today() - timedelta(days=_SALARY_LOOKBACK_DAYS), datetime.min.time())
    sums: dict[str, float] = {}
    try:
        async for t in transactions_col.find(
            {"user_id": uid, "transaction_type": "credit", "date": {"$gte": since}},
            {"amount": 1, "account_id": 1, "category": 1, "custom_category": 1},
        ):
            cat = t.get("custom_category") or t.get("category") or ""
            if not is_income(kind_map, cat):
                continue
            aid = str(t.get("account_id") or "")
            if not aid:
                continue
            sums[aid] = sums.get(aid, 0.0) + abs(float(t.get("amount") or 0))
    except Exception:
        logger.exception("spend_impact: salary-account inference failed for %s", uid)
        return None
    if not sums:
        return None
    return max(sums, key=sums.get)


async def _live_balances_map(uid: str) -> dict[str, float]:
    out: dict[str, float] = {}
    try:
        async for a in accounts_col.find({"user_id": uid}, {"balance": 1}):
            out[str(a["_id"])] = float(a.get("balance") or 0.0)
    except Exception:
        logger.exception("spend_impact: live-balance fetch failed for %s", uid)
    return out


# ── Bills-risk consequence ───────────────────────────────────────────────────

def _ordinal(n: int) -> str:
    if 10 <= n % 100 <= 20:
        suffix = "th"
    else:
        suffix = {1: "st", 2: "nd", 3: "rd"}.get(n % 10, "th")
    return f"{n}{suffix}"


def _humanise_bill_date(d: date, today: date) -> str:
    """"the 24th" while the bill still falls inside the CURRENT calendar
    month (the common case — a bills-risk window is almost always inside
    the live pay period), "Tue 24 Aug" once it doesn't (the last-day
    lookahead into next period's first few days) — an ordinal alone would
    misread as "this month" for a date that's actually weeks off."""
    if d.year == today.year and d.month == today.month:
        return f"the {_ordinal(d.day)}"
    return d.strftime("%a %-d %b")


async def _cashflow_window(uid: str) -> dict | None:
    """The bills/income timeline + starting balances `_bills_risk` runs
    `companion._walk_events` over. This is the same subset of
    `companion.compute_today_items` steps 1-3 that
    `app/routers/analytics.py`'s `at_risk_count` also independently
    re-gathers today (existing precedent for this duplication in the
    codebase) — the piece that must never be duplicated is the WALK itself
    (`_walk_events`, imported below), not the window build that feeds it.

    Returns None when there's nothing to assess (no cashflow cache yet, or
    no bill this user's balance data can price)."""
    from app.routers.analytics import _build_cashflow_response, income_credit_ok
    from app.services.income import get_confirmed_payday as _get_confirmed_payday
    from app.services.pay_period import _next_payday as _calc_next_payday

    cached = await cashflow_cache_col.find_one({"_id": uid})
    if not cached:
        return None

    prefs = await preferences_col.find_one({"user_id": uid}) or {}
    confirmed_income_keys = {
        s.get("key") for s in (prefs.get("income_streams") or [])
        if s.get("status") == "confirmed"
    }
    resp = await _build_cashflow_response(cached, uid=uid, prefs=prefs)

    pay_cfg = prefs.get("pay_period_config", {"type": "calendar_month"})
    today_d = date.today()
    confirmed_result = _get_confirmed_payday(prefs, today_d)
    next_pay = confirmed_result[0] if confirmed_result else _calc_next_payday(today_d, pay_cfg)
    days_to_pay = (next_pay - today_d).days
    lookahead = 5 if days_to_pay <= 1 else 0  # mirrors companion.py's last-day lookahead
    window_bills = [b for b in resp["upcoming_bills"] if b["days_away"] <= days_to_pay + lookahead]
    window_income = [i for i in resp["upcoming_income"] if i["days_away"] <= days_to_pay + lookahead]

    # Same assessability filter as companion.py/analytics.py: no balance
    # data, or a credit card (credit limit, not available balance), must
    # never enter the walk.
    assessable_bills = [
        b for b in window_bills
        if b.get("account_balance") is not None
        and b["account_balance"] >= 0
        and not b.get("is_credit_card")
    ]
    if not assessable_bills:
        return None

    live_balances = await _live_balances_map(uid)

    balances: dict[str, float] = {}
    for b in assessable_bills:
        acct = b["account_id"] or "__unknown__"
        if acct not in balances:
            balances[acct] = live_balances.get(str(acct), float(b.get("account_balance") or 0))

    events: list[tuple[int, str, float, bool, dict]] = []
    for b in assessable_bills:
        events.append((b["days_away"], b["account_id"] or "__unknown__", float(b["amount"]), False, b))
    for i in window_income:
        acct = str(i.get("account_id") or "")
        if acct in balances and income_credit_ok(i, acct, confirmed_income_keys):
            events.append((i["days_away"], acct, float(i["amount"]), True, i))
    events.sort(key=lambda e: (e[0], 1 if e[3] else 0))  # bills before income same-day, matching companion.py

    return {"events": events, "balances": balances, "today": today_d}


async def _bills_risk(uid: str, total_excess: float, period: dict) -> dict | None:
    """Does the AT-THIS-PACE (aggressive) projection push a bill that would
    otherwise clear into a shortfall? See the module docstring's
    "bills_risk derivation" section for the full projection + causation
    rationale. Returns {"bill", "date", "amount"} or None (silent by
    default, same doctrine as the rest of this module).

    Silent whenever: the period isn't running a genuine excess
    (`total_excess <= 0` — under/at-usual pace can never CAUSE a new
    shortfall), there's no `days_left` to project across, no assessable
    bills/income timeline exists yet, or no salary/primary spending account
    can be inferred to attribute the projected outflow to.
    """
    days_elapsed = period.get("days_elapsed") or 0
    days_left = period.get("days_left")
    if total_excess <= 0 or not days_left or days_elapsed <= 0:
        return None

    try:
        window = await _cashflow_window(uid)
        if window is None:
            return None
        events, balances, today_d = window["events"], window["balances"], window["today"]

        from app.services.companion import _humanise_bill_name, _walk_events

        # Baseline: the same walk companion.py's own shortfall sim runs, no
        # extra outflow. This is the "at usual pace" comparison — a bill
        # already short here is companion's territory, not a spend
        # consequence.
        _, baseline_min_running, _ = _walk_events(events, balances)

        salary_acct = await _infer_salary_account(uid)
        if salary_acct is None:
            return None

        # AT THIS PACE (not "if this holds"): today's daily excess rate
        # assumed to continue for every day left in the period, spread as
        # one extra debit event per remaining day on the salary/primary
        # spending account — the documented simplification (see module
        # docstring); a reasonable proxy for "where discretionary spend
        # actually happens" without replaying companion's whole per-account
        # attribution.
        daily_excess_rate = total_excess / days_elapsed
        extra_events: list[tuple[int, str, float, bool, dict]] = [
            (day, salary_acct, daily_excess_rate, False, {"_synthetic_pace": True})
            for day in range(1, int(days_left) + 1)
        ]
        paced_events = sorted(events + extra_events, key=lambda e: (e[0], 1 if e[3] else 0))
        _, paced_min_running, paced_shortfall_bill = _walk_events(paced_events, balances)

        # Causation test: only a bill whose account was NOT already
        # projected negative at usual pace, but IS once the excess pace is
        # layered in, counts — see module docstring.
        candidates = [
            bill
            for acct, bill in paced_shortfall_bill.items()
            if not bill.get("_synthetic_pace")
            and baseline_min_running.get(acct, 0.0) >= 0
            and paced_min_running.get(acct, 0.0) < -BILLS_RISK_MATERIAL_FLOOR
        ]
        if not candidates:
            return None
        candidates.sort(key=lambda b: (b["days_away"], -float(b.get("amount") or 0)))  # most urgent, then largest — matches companion.py's shortfall ordering
        bill = candidates[0]
        bill_date = date.fromisoformat(bill["expected_date"])
        return {
            "bill": _humanise_bill_name(bill.get("name", "bill")),
            "date": _humanise_bill_date(bill_date, today_d),
            "amount": int(round(float(bill.get("amount", 0)))),
        }
    except Exception:
        logger.exception("spend_impact: bills-risk computation failed for %s", uid)
        return None


async def _usual_move_total(uid: str, pay_cfg: dict) -> tuple[float, str | None, int]:
    """Per destination, max(companion._usual_payday_moves's historical
    figure, active commitment slice routed there) — matching
    companion.py:1170-1176's own rule so a regularly-funded commitment
    (already present in its own historical transfers) is never counted
    twice. Plus sum(debt_plan's current card movement.monthly). See module
    docstring for the full rationale.

    Also returns `evidence_paydays`: the largest contributing-payday count
    (0-4) among destinations whose HISTORICAL usual value — not an active
    commitment's slice — is what actually wins the per-destination max()
    above. A commitment slice with no matching payday history is a decision
    ("I'm saving for this"), not a demonstrated habit, so it contributes
    nothing to this evidence figure even though it does count toward
    `total`. If no destination's total is usual-driven, `evidence_paydays`
    is 0 — the confidence gate in `_compute_move_and_horizon` reads this as
    "no move habit on file"."""
    kind_map = await get_category_kinds(uid)
    salary_acct = await _infer_salary_account(uid, kind_map)
    if salary_acct is None:
        return 0.0, None, 0

    try:
        from app.services.companion import _active_commitment_slices, _usual_payday_moves_with_counts

        usual_moves, usual_counts = await _usual_payday_moves_with_counts(uid, salary_acct, pay_cfg)
        live_balances = await _live_balances_map(uid)
        commitment_slices = await _active_commitment_slices(uid, pay_cfg, live_balances)
    except Exception:
        logger.exception("spend_impact: usual-move lookup failed for %s", uid)
        usual_moves, usual_counts, commitment_slices = {}, {}, {}

    try:
        from app.services.debt_plan import get_debt_plan_cached

        plan = await get_debt_plan_cached(uid)
        debt_transfer = sum(
            (c.get("movement") or {}).get("monthly") or 0.0
            for c in plan.get("cards", [])
            if c.get("debt", 0) > 0 and ((c.get("movement") or {}).get("monthly") or 0) > 0
        )
    except Exception:
        logger.exception("spend_impact: debt-transfer lookup failed for %s", uid)
        debt_transfer = 0.0

    dest_ids = set(usual_moves.keys()) | set(commitment_slices.keys())
    dests_total = 0.0
    evidence_paydays = 0
    for dest_id in dest_ids:
        usual_val = float(usual_moves.get(dest_id) or 0.0)
        slice_val = float((commitment_slices.get(dest_id) or {}).get("slice_total") or 0.0)
        dests_total += max(usual_val, slice_val)
        if usual_val > 0 and usual_val >= slice_val:
            evidence_paydays = max(evidence_paydays, usual_counts.get(dest_id, 0))

    total = dests_total + debt_transfer
    return float(total), salary_acct, evidence_paydays


async def _debt_horizon(uid: str, delta: float) -> dict | None:
    """Re-run `_amortise` on the plan's constraining material card with
    `movement.monthly - delta` in place of the stored movement. Uses the
    card's public `rate_schedule` (not the internal projection schedule
    debt_plan.py strips before caching) — a known, documented approximation;
    see module docstring."""
    try:
        from app.services.debt_plan import MATERIAL_BALANCE, _amortise, get_debt_plan_cached

        plan = await get_debt_plan_cached(uid)
        cards = [
            c for c in plan.get("cards", [])
            if c.get("debt", 0) >= MATERIAL_BALANCE and c.get("payoff_month")
        ]
        if not cards:
            return None
        debt_free_month = (plan.get("totals") or {}).get("debt_free_month")
        card = next((c for c in cards if c["payoff_month"] == debt_free_month), None)
        if card is None:
            card = max(cards, key=lambda c: c["payoff_month"])

        movement_monthly = (card.get("movement") or {}).get("monthly") or 0.0
        adjusted_movement = movement_monthly - delta
        adjusted = _amortise(card["debt"], adjusted_movement, date.today(), card.get("rate_schedule") or [])
        new_payoff = adjusted.get("payoff_month")
        if not new_payoff or new_payoff == card["payoff_month"]:
            return None
        if _yyyymm_diff_months(card["payoff_month"], new_payoff) > HORIZON_CLAIM_CAP_MONTHS:
            # One period's delta extrapolated into a multi-year schedule
            # change — see HORIZON_CLAIM_CAP_MONTHS. Suppress rather than
            # surface; the resolver falls through to move/permission.
            return None
        return {
            "kind": "debt",
            "name": card.get("name") or "your card",
            "from_month": _pretty_yyyymm(card["payoff_month"]),
            "to_month": _pretty_yyyymm(new_payoff),
        }
    except Exception:
        logger.exception("spend_impact: debt horizon failed for %s", uid)
        return None


def _advance_periods(today: date, n: int, pay_cfg: dict) -> date:
    """Start date of the n-th pay period from today (n >= 1)."""
    from app.services.pay_period import get_pay_period_for_date

    start, end = get_pay_period_for_date(today, pay_cfg)
    for _ in range(max(1, n)):
        start, end = get_pay_period_for_date(end + timedelta(days=1), pay_cfg)
    return start


async def _goal_horizon(uid: str, delta: float, pay_cfg: dict) -> dict | None:
    """Walk ACTIVE commitments oldest-first (the pot-ledger claim order) and
    name the first one whose ETA, at (its required slice - delta), lands in
    a different calendar month than its stored target_date."""
    try:
        from app.routers.commitments import _ledger_sort_key, _pot_progress_and_slice, compute_pot_ledger

        docs = await commitments_col.find({"user_id": uid, "status": "active"}).to_list(None)
        if not docs:
            return None
        ledger = await compute_pot_ledger(uid, docs=docs)
        today = date.today()
        for doc in sorted(docs, key=_ledger_sort_key):
            info = await _pot_progress_and_slice(doc, pay_cfg, ledger, today)
            remaining = info["remaining"]
            orig_slice = info["per_period_slice"]
            if remaining <= 0 or orig_slice <= 0:
                continue
            adjusted_slice = orig_slice - delta
            if adjusted_slice <= 0:
                # Can't project a finite ETA at this rate — no fabricated
                # promise, silently skip this goal rather than guess.
                continue
            new_periods = math.ceil(remaining / adjusted_slice)
            if new_periods > GOAL_HORIZON_MAX_PERIODS:
                # A near-zero adjusted slice can blow this up arbitrarily
                # (bad/thin data) — cap it rather than let `_advance_periods`
                # loop hundreds of times or walk dates out past anything
                # meaningful. No horizon for this goal, try the next one.
                continue
            if new_periods == info["periods_left"]:
                continue
            new_target_start = _advance_periods(today, new_periods, pay_cfg)
            try:
                orig_target = date.fromisoformat(str(doc["target_date"])[:10])
            except Exception:
                continue
            if new_target_start.strftime("%Y-%m") == orig_target.strftime("%Y-%m"):
                continue
            if (
                _yyyymm_diff_months(
                    orig_target.strftime("%Y-%m"), new_target_start.strftime("%Y-%m"),
                )
                > HORIZON_CLAIM_CAP_MONTHS
            ):
                # One period's delta extrapolated into a multi-year schedule
                # change — see HORIZON_CLAIM_CAP_MONTHS. No fabricated
                # multi-year claim; try the next goal instead of surfacing it.
                continue
            return {
                "kind": "goal",
                "name": str(doc.get("name") or "your goal"),
                "from_month": orig_target.strftime("%b %Y"),
                "to_month": new_target_start.strftime("%b %Y"),
            }
        return None
    except Exception:
        logger.exception("spend_impact: goal horizon failed for %s", uid)
        return None


async def _compute_move_and_horizon(uid: str, delta: float, pay_cfg: dict) -> tuple[dict | None, dict | None]:
    """`delta` is the signed excess (positive = over usual, so the move
    shrinks / payoff slips; negative = under usual, so the move grows /
    payoff pulls forward). Returns (move, horizon), either may be None."""
    usual_move, salary_acct, evidence_paydays = await _usual_move_total(uid, pay_cfg)

    move_out = None
    has_move_confidence = usual_move >= MOVE_CONFIDENCE_FLOOR and evidence_paydays >= MOVE_CONFIDENCE_MIN_PAYDAYS
    if salary_acct is not None and usual_move > 0 and has_move_confidence:
        threshold = max(MOVE_SILENCE_ABS, MOVE_SILENCE_FRAC * usual_move)
        if abs(delta) >= threshold:
            projected = max(0.0, usual_move - delta)
            move_out = {"usual": round(usual_move, 2), "projected": round(projected, 2)}
    # Gated (no real move habit on file): fall through silently — the caller
    # already tries horizon next, then the movement/none fallback. No
    # substitute promise is fabricated here.

    horizon_out = await _debt_horizon(uid, delta)
    if horizon_out is None:
        horizon_out = await _goal_horizon(uid, delta, pay_cfg)

    return move_out, horizon_out


async def compute_spend_impact(uid: str, verdict_ctx: dict) -> dict:
    """The GET /spend/verdict `impact` block.

    `verdict_ctx` — built by spend_verdict.py from signals it already
    computed this request:
        {"period": <period block, incl. days_elapsed/closed/thin_history>,
         "total_excess": <signed £, actual - usual_by_now, across every
                           baselined spend category, Other excluded>}

    Silent (all-None) whenever: the period is closed, the baseline is still
    learning, fewer than MIN_DAYS_ELAPSED days have elapsed, or the signed
    excess itself rounds to nothing.

    Resolver order — bills_risk > horizon > move_delta/permission. A bill
    actually at risk of going unpaid outranks a smaller payday move or a
    pushed-out horizon; see the module docstring's "bills_risk derivation"
    section.
    """
    empty = {"consequence": None, "move": None, "horizon": None, "bills_risk": None}

    period = verdict_ctx.get("period") or {}
    if period.get("closed"):
        return empty
    if period.get("thin_history"):
        return empty
    days_elapsed = period.get("days_elapsed") or 0
    if days_elapsed < MIN_DAYS_ELAPSED:
        return empty

    total_excess = verdict_ctx.get("total_excess")
    if total_excess is None or abs(total_excess) < EXCESS_SILENCE_FLOOR:
        return empty

    pay_cfg = await _pay_cfg(uid)
    move_out, horizon_out = await _compute_move_and_horizon(uid, total_excess, pay_cfg)
    bills_risk_out = await _bills_risk(uid, total_excess, period)

    if bills_risk_out is not None:
        consequence = "bills_risk"
    elif horizon_out is not None:
        consequence = "horizon"
    elif move_out is not None:
        consequence = "move_delta" if total_excess > 0 else "permission"
    else:
        consequence = None

    return {"consequence": consequence, "move": move_out, "horizon": horizon_out, "bills_risk": bills_risk_out}


# ── /spend/intent-preview — price the consent sheet before the user answers ──

async def compute_intent_preview(uid: str, category: str) -> dict:
    """Server-composed lines for the "file as new normal" consent sheet.
    Treats the category's CURRENT excess as if it recurs every period going
    forward (i.e. the elevated daily rate becomes the new usual) and reuses
    the same move/horizon derivation the verdict's impact block uses.

    Raises ValueError if the category isn't currently notable (nothing to
    preview against — the sheet is only ever opened from a notable card).
    """
    from app.services.spend_verdict import compute_spend_verdict

    verdict = await compute_spend_verdict(uid)
    entry = next(
        (n for n in (verdict.get("notables") or []) + (verdict.get("quiet_flags") or [])
         if n.get("category") == category),
        None,
    )
    if entry is None:
        raise ValueError(f"'{category}' is not currently over usual, nothing to preview")

    excess = float(entry.get("excess") or 0.0)
    multiple = entry.get("multiple")

    lines: list[str] = []
    if multiple is not None and multiple >= 1.9:
        lines.append(f"This roughly doubles your usual {category} for the period.")
    else:
        lines.append(f"This raises your usual {category} by about £{round(excess):,} a period.")

    pay_cfg = await _pay_cfg(uid)
    move_out, horizon_out = await _compute_move_and_horizon(uid, excess, pay_cfg)

    if move_out is not None:
        if move_out["projected"] < MOVE_SOFTEN_FLOOR:
            lines.append("If this holds, there may be nothing spare to move this payday.")
        else:
            lines.append(
                f"Your usual payday move trims from about £{move_out['usual']:,.0f} "
                f"to about £{move_out['projected']:,.0f}."
            )

    if horizon_out is not None:
        if horizon_out["kind"] == "debt":
            lines.append(
                f"Your card clear-by moves from {horizon_out['from_month']} to {horizon_out['to_month']}."
            )
        else:
            lines.append(
                f"Your {horizon_out['name']} moves from {horizon_out['from_month']} "
                f"to {horizon_out['to_month']}."
            )

    return {"title": f"File {category} as your new normal?", "lines": lines}
