"""G228: easing a goal plan's contribution for one pay period.

A plan (a commitment) reserves `ceil5(remaining / periods_left)` each pay period.
When cash is short the user may take some or all of THIS period's contribution
off, and chooses how the difference is made up:

  keep_date    later periods carry it (their slice rises), the target date stays
  keep_amount  later slices stay as they are, the target date moves

Everything here is pure (no database), so the router, the Home brief and the
tests share one set of figures. A plan stores

    period_eased: {period_end_iso: {contribution_pence, usual_pence, mode,
                                    noted_at, note, cleared?, previous_target_date?}}

Only the key for the period being evaluated shapes a slice, so an easing lapses
by itself when the next period starts. Lapsed keys stay as history for the caps
(never two periods running, at most two in a rolling 12 months). Money is never
moved by an easing: it only changes what the plan asks of this period.
"""
from __future__ import annotations

import math
from datetime import date, timedelta
from typing import Any

from app.services.pay_period import get_pay_period_for_date

# Caps (Kevin 2026-10-07, G228 round 2).
MAX_LATER_RISE_NUM, MAX_LATER_RISE_DEN = 5, 4  # later slice at most 125% of usual
MAX_DATE_MOVE_PERIODS = 2
MAX_EASED_PERIODS_12M = 2
MODES = ("keep_date", "keep_amount")

# Static refusal copy (never interpolates request data).
MSG_ALREADY = "This plan has already been eased for this period."
MSG_COUNT = "A plan can only be eased in two periods a year."
MSG_CONSECUTIVE = "A plan cannot be eased in two periods running."
MSG_NOTHING = "There is nothing to take off this period."
MSG_NOT_LOWER = "Choose a contribution below the usual one."
MSG_WHOLE = "Choose a whole number of pounds."
MSG_NO_LATER = "There are no later periods to spread this over."
MSG_RISE = "That would raise later contributions by more than a quarter."
MSG_DATE = "That would move the date by more than two pay periods."
MSG_MODE = "Choose to keep the date or keep the amount."


def ceil5(amount: float) -> int:
    return math.ceil(round(amount, 6) / 5) * 5


def _entry_active(entry: Any) -> bool:
    return isinstance(entry, dict) and not entry.get("cleared") and isinstance(entry.get("contribution_pence"), int) \
        and not isinstance(entry.get("contribution_pence"), bool)


def live_entry(period_eased: dict | None, live_key: str) -> dict | None:
    """The easing in force for the period ending `live_key`, or None."""
    entry = (period_eased or {}).get(live_key)
    return entry if _entry_active(entry) else None


def history_state(period_eased: dict | None, live_key: str, period_start: date) -> dict:
    """Counts used by the period-level caps. Cleared entries still count: they
    were eased, then the plan itself was edited."""
    keys = []
    for k in (period_eased or {}):
        try:
            keys.append(date.fromisoformat(str(k)))
        except ValueError:
            continue
    live = date.fromisoformat(live_key)
    since = live - timedelta(days=365)
    count = sum(1 for k in keys if since < k <= live)
    prev_key = (period_start - timedelta(days=1)).isoformat()
    return {
        "count_12m": count,
        "consecutive": prev_key in (period_eased or {}),
        "live_present": live_key in (period_eased or {}),
    }


def period_cap_reason(period_eased: dict | None, live_key: str, period_start: date) -> str | None:
    """Why this plan cannot be eased now, from history alone (None = may be)."""
    h = history_state(period_eased, live_key, period_start)
    # Any live key, cleared by a plan edit or not, means this period is spent:
    # editing the plan ends the easing but never buys a second one.
    if h["live_present"]:
        return MSG_ALREADY
    if h["consecutive"]:
        return MSG_CONSECUTIVE
    if h["count_12m"] >= MAX_EASED_PERIODS_12M:
        return MSG_COUNT
    return None


def later_slice(remaining: float, contribution: int, later_periods: int) -> int | None:
    """Per-period slice for the later periods once `contribution` is taken this
    period (the engine's own rounding, up to £5)."""
    if later_periods <= 0:
        return None
    return ceil5(max(0.0, remaining - contribution) / later_periods)


def extra_periods(remaining: float, contribution: int, usual: int, later_periods: int) -> int:
    """Pay periods the date must move so later slices can stay at `usual`."""
    if usual <= 0:
        return 0
    needed = math.ceil(round(max(0.0, remaining - contribution) / usual, 6))
    return max(0, needed - max(0, later_periods))


def move_date(target: date, periods: int, cfg: dict) -> date:
    """`target` moved on by whole pay periods: the start of the period that many
    after the one holding `target`, so the engine counts exactly that many more
    period starts."""
    if periods <= 0:
        return target
    start, _end = get_pay_period_for_date(target, cfg)
    cur = start
    for _ in range(periods):
        _s, e = get_pay_period_for_date(cur, cfg)
        cur = e + timedelta(days=1)
    return cur


def ease_options(
    *, remaining: float, later_periods: int, usual: int, contribution: int, target: date, cfg: dict,
) -> dict:
    """Both ways of making up an easing to `contribution` (whole pounds) this
    period, each with its figure or the reason it is refused. The caller has
    already validated 0 <= contribution < usual.

    `later_periods` is the number of pay-period starts from the NEXT period
    through the target date, which is exactly what the engine will divide by
    when it next sizes a slice, so the figures here are the engine's own."""
    later_n = max(0, later_periods)
    kd_slice = later_slice(remaining, contribution, later_n)
    if kd_slice is None:
        kd_refused = MSG_NO_LATER
    elif kd_slice * MAX_LATER_RISE_DEN > usual * MAX_LATER_RISE_NUM:
        kd_refused = MSG_RISE
    else:
        kd_refused = None
    extra = extra_periods(remaining, contribution, usual, later_n)
    ka_refused = MSG_DATE if extra > MAX_DATE_MOVE_PERIODS else None
    new_target = move_date(target, extra, cfg) if extra and not ka_refused else target
    ka_slice = later_slice(remaining, contribution, later_n + extra) if (later_n + extra) > 0 else None
    return {
        "contribution": contribution,
        "usual_slice": usual,
        "keep_date": {
            "later_slice": kd_slice,
            "date_moves_periods": 0,
            "target_date": target.isoformat(),
            "refused": kd_refused,
        },
        "keep_amount": {
            "later_slice": ka_slice,
            "date_moves_periods": extra,
            "target_date": new_target.isoformat(),
            "refused": ka_refused,
        },
    }


def validate_contribution(raw: Any, usual: int) -> tuple[int | None, str | None]:
    """(whole pounds, None) when `raw` pence is in [0, usual) pounds, else
    (None, static refusal copy)."""
    if isinstance(raw, bool) or not isinstance(raw, (int, float)) or raw != raw:
        return None, MSG_WHOLE
    if raw < 0 or raw % 100 != 0:
        return None, MSG_WHOLE
    pounds = int(raw) // 100
    if usual <= 0:
        return None, MSG_NOTHING
    if pounds >= usual:
        return None, MSG_NOT_LOWER
    return pounds, None
