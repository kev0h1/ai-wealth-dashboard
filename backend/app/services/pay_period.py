"""Pay period date math — mirrors frontend payPeriod.ts."""
import calendar as _calendar
from datetime import date as _date, timedelta


def _js_to_py_weekday(js_weekday: int) -> int:
    return (js_weekday - 1) % 7


def _last_py_weekday_of_month(year: int, month: int, py_weekday: int) -> _date:
    last = _date(year, month, _calendar.monthrange(year, month)[1])
    return last - timedelta(days=(last.weekday() - py_weekday) % 7)


def _period_last_weekday(ref: _date, py_weekday: int) -> tuple[_date, _date]:
    y, m = ref.year, ref.month
    this_pay = _last_py_weekday_of_month(y, m, py_weekday)
    if ref >= this_pay:
        nm = m % 12 + 1; ny = y + (1 if m == 12 else 0)
        return this_pay, _last_py_weekday_of_month(ny, nm, py_weekday) - timedelta(days=1)
    pm = 12 if m == 1 else m - 1; py_ = y - 1 if m == 1 else y
    return _last_py_weekday_of_month(py_, pm, py_weekday), this_pay - timedelta(days=1)


def _period_calendar_month(ref: _date) -> tuple[_date, _date]:
    y, m = ref.year, ref.month
    return _date(y, m, 1), _date(y, m, _calendar.monthrange(y, m)[1])


def _period_monthly_pay_date(ref: _date, pay_day: int) -> tuple[_date, _date]:
    def clamp(yr, mo, d): return min(d, _calendar.monthrange(yr, mo)[1])
    y, m, d = ref.year, ref.month, ref.day
    tp = clamp(y, m, pay_day)
    if d >= tp:
        nm = m % 12 + 1; ny = y + (1 if m == 12 else 0)
        np = clamp(ny, nm, pay_day)
        return _date(y, m, tp), _date(ny, nm, np) - timedelta(days=1)
    pm = 12 if m == 1 else m - 1; py_ = y - 1 if m == 1 else y
    pp = clamp(py_, pm, pay_day)
    return _date(py_, pm, pp), _date(y, m, tp) - timedelta(days=1)


def _period_weekly(ref: _date, js_weekday: int) -> tuple[_date, _date]:
    py_wd = _js_to_py_weekday(js_weekday)
    start = ref - timedelta(days=(ref.weekday() - py_wd) % 7)
    return start, start + timedelta(days=6)


def _period_biweekly(ref: _date, reference_date_str: str) -> tuple[_date, _date]:
    ref_start = _date.fromisoformat(reference_date_str)
    n = (ref - ref_start).days // 14
    start = ref_start + timedelta(days=n * 14)
    return start, start + timedelta(days=13)


def get_pay_period_for_date(ref: _date, config: dict) -> tuple[_date, _date]:
    t = config.get("type", "calendar_month")
    if t == "calendar_month":        return _period_calendar_month(ref)
    if t == "last_friday":           return _period_last_weekday(ref, 4)
    if t == "last_weekday_of_month": return _period_last_weekday(ref, _js_to_py_weekday(config.get("weekday", 4)))
    if t == "monthly_pay_date":      return _period_monthly_pay_date(ref, config.get("day", 1))
    if t == "weekly":                return _period_weekly(ref, config.get("weekday", 1))
    if t == "biweekly":              return _period_biweekly(ref, config.get("referenceDate", "2024-01-01"))
    return _period_calendar_month(ref)


def prev_pay_period(start: _date, config: dict) -> tuple[_date, _date]:
    return get_pay_period_for_date(start - timedelta(days=1), config)


def _next_payday(today: _date, config: dict) -> _date:
    """Return the first day of the next pay period strictly after today."""
    _start, end = get_pay_period_for_date(today, config)
    return end + timedelta(days=1)


def period_rhythm_label(config: dict) -> str | None:
    """Human-readable pay-period rhythm, or None when it doesn't map to a
    clean cadence (e.g. "custom") — callers should fall back to a concrete
    date in that case rather than saying "/period" with no qualifier.

    Mirrors the `type` values in `get_pay_period_for_date` above and the
    frontend's PayPeriodConfig (lib/payPeriod.ts): the four month-anchored
    types ("calendar_month", "monthly_pay_date", "last_friday",
    "last_weekday_of_month") are all a once-a-month rhythm; "weekly" is
    self-explanatory; "biweekly" is a strict 14-day cycle from a reference
    date (labelled "Every two weeks" in PayPeriodSettingsSheet.tsx) — NOT
    a 4-weekly or twice-a-month cadence, so it's labelled accordingly.
    """
    t = (config or {}).get("type", "calendar_month")
    if t in ("calendar_month", "monthly_pay_date", "last_friday", "last_weekday_of_month"):
        return "monthly"
    if t == "weekly":
        return "weekly"
    if t == "biweekly":
        return "every 2 weeks"
    return None  # "custom" — irregular, no clean rhythm to name


# ── Current-period window boundary (2026-08-28 decision) ────────────────────
#
# Owner decision, verbatim (2026-08-28): "we still want to have some
# visibility over the next pay period but I don't think it should count in
# the existing one." A bill/income/inflow scheduled ON payday itself
# (days_away == days_to_pay) belongs to the pay period that's about to
# START, not the one ending today — it must stop counting in the current
# period's at-risk/shortfall/to-last arithmetic, while staying VISIBLE as a
# distinct "payday split" (see companion.py's `payday_split` payload).
#
# This makes the EXCLUSIVE boundary (`0 <= days_away < days_to_pay`) the one
# true current-window boundary, used everywhere the window is computed:
# companion.py's payday plan + shortfall/move-rec engine, spend_impact.py's
# bills-risk walk, and analytics.py's at_risk_count. It was already, and
# independently, the boundary `compute_safe_to_spend` (app/routers/
# analytics.py) uses for its own event-timeline walk — that function is the
# precedent this decision aligns the other three sites to, and it is NOT
# changed by this decision.
#
# The one deliberate exception is the LAST-DAY LOOKAHEAD: once payday is
# today or tomorrow (`days_to_pay <= 1`), the window still extends through
# `days_to_pay + 5` INCLUSIVE of payday day itself. That widening exists to
# assess the next period's first few days at the turn of the period, before
# the next period's own cache has properly built out — behaviour that
# predates and is unrelated to the payday-day-visibility decision above, and
# stays exactly as it was. In that regime there is no separate "payday day"
# slice: it is simply part of the (widened) current window, so
# `is_payday_day` always reports False there — the two helpers below stay a
# clean partition (current / payday-day / strictly-after) in every regime,
# including the `days_to_pay == 0` edge case (today itself is a confirmed
# payday) where the ordinary window is correctly empty and today's items
# read as "payday day".
def in_current_window(days_away: int, days_to_pay: int) -> bool:
    """True when an item at `days_away` counts in the CURRENT pay period's
    arithmetic (at-risk, shortfall, move-recommendation, to-last-payday
    sims). Exclusive of payday day itself, except during the last-day
    lookahead (`days_to_pay <= 1`), where the widened window still includes
    it — see the module-level note above."""
    if days_to_pay <= 1:
        return 0 <= days_away <= days_to_pay + 5
    return 0 <= days_away < days_to_pay


def is_payday_day(days_away: int, days_to_pay: int) -> bool:
    """True when an item falls exactly ON payday — visible (e.g. in
    companion.py's `payday_split`) but deliberately excluded from
    `in_current_window` so it stops counting in the period that's ending.
    Always False during the last-day lookahead regime (`days_to_pay <= 1`),
    since that widened window already swallows payday day as part of
    `in_current_window` — see the module-level note above; the two helpers
    must never both be True for the same item."""
    if days_to_pay <= 1:
        return False
    return days_away == days_to_pay
