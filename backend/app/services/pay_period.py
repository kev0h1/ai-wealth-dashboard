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
