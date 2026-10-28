"""G351: goal contribution schedules other than equal amounts. Pure, no I/O.

A schedule is stored on a commitment as ``schedule`` (absent or
``{"type": "equal"}`` means the original equal-slices rule):

    {"type": "arithmetic", "start_pence": int, "step_pence": int,
     "step_unit": "day"|"week"|"period", "start_date": iso,
     "count": int|None, "end_date": iso|None}
    {"type": "fixed", "start_date": iso, "amounts_pence": [int, ...],
     "unit": "period"}
    {"type": "percent_of_pay", "percent": float, "start_date": iso,
     "expected_pay_pence": int, "count": int|None, "end_date": iso|None}

Everything derives from one list of events, (due date, pence): a day block is
due on its own day, a week block on the first day of that week (weeks counted
from start_date), a period block on the first day of that pay period (the
first block is due on start_date itself). A pay period's contribution is the
sum of the events due inside it. Totals, ends, on-track targets and the next
few periods all read the same events, so none of them can drift apart.
"""
from datetime import date, timedelta

from app.services.pay_period import get_pay_period_for_date

MAX_PENCE = 100_000_000
MAX_DAYS = 3660
MAX_WEEKS = 520
MAX_PERIODS = 120
_UNIT_CAP = {"day": MAX_DAYS, "week": MAX_WEEKS, "period": MAX_PERIODS}
_UNIT_NOUN = {"day": "day", "week": "week", "period": "pay period"}
_TYPES = ("equal", "arithmetic", "fixed", "percent_of_pay")

INVALID = "Choose a schedule with amounts above £0, a start date and a clear end."


def is_scheduled(schedule) -> bool:
    return isinstance(schedule, dict) and schedule.get("type") in _TYPES[1:]


def _d(value, field: str) -> date:
    try:
        return date.fromisoformat(str(value)[:10])
    except (TypeError, ValueError):
        raise ValueError(f"The {field} is not a valid date.")


def _int(value, field: str, lo: int, hi: int) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or not lo <= value <= hi:
        raise ValueError(f"The {field} is outside the allowed range.")
    return value


def validate(schedule) -> dict:
    """Return the cleaned schedule (only known keys, ISO dates) or raise ValueError."""
    if not isinstance(schedule, dict):
        raise ValueError(INVALID)
    kind = schedule.get("type")
    if kind not in _TYPES:
        raise ValueError(INVALID)
    if kind == "equal":
        return {"type": "equal"}
    start = _d(schedule.get("start_date"), "start date")
    out: dict = {"type": kind, "start_date": start.isoformat()}
    if kind == "fixed":
        amounts = schedule.get("amounts_pence")
        if not isinstance(amounts, list) or not 1 <= len(amounts) <= MAX_PERIODS:
            raise ValueError(f"Enter between 1 and {MAX_PERIODS} amounts.")
        out["amounts_pence"] = [_int(a, "amount", 1, MAX_PENCE) for a in amounts]
        out["unit"] = "period"
        if sum(out["amounts_pence"]) > MAX_PENCE:
            raise ValueError("The total is above £1,000,000.")
        return out
    count = schedule.get("count")
    end = schedule.get("end_date")
    if count is None and end is None:
        raise ValueError("Say how long the schedule runs, as a number or an end date.")
    unit = "period" if kind == "percent_of_pay" else schedule.get("step_unit")
    if unit not in _UNIT_CAP:
        raise ValueError("Choose day, week or pay period for the step.")
    cap = _UNIT_CAP[unit]
    out["count"] = None if count is None else _int(count, "length", 1, cap)
    if end is not None:
        end_d = _d(end, "end date")
        if end_d < start:
            raise ValueError("The end date is before the start date.")
        span = (end_d - start).days
        if span > MAX_DAYS or (unit == "week" and span // 7 + 1 > MAX_WEEKS) or (unit == "period" and span > MAX_PERIODS * 31):
            raise ValueError("The schedule runs for too long.")
        out["end_date"] = end_d.isoformat()
    else:
        out["end_date"] = None
    if kind == "arithmetic":
        out["start_pence"] = _int(schedule.get("start_pence"), "starting amount", 1, MAX_PENCE)
        out["step_pence"] = _int(schedule.get("step_pence", 0), "step", 0, MAX_PENCE)
        out["step_unit"] = unit
        if sum(a for _d_, a in _events(out, {"type": "calendar_month"})) > MAX_PENCE:
            raise ValueError("The total is above £1,000,000.")
    else:
        pct = schedule.get("percent")
        if isinstance(pct, bool) or not isinstance(pct, (int, float)) or not 0 < pct <= 100:
            raise ValueError("Choose a percentage above 0 and up to 100.")
        out["percent"] = round(float(pct), 2)
        pay = schedule.get("expected_pay_pence")
        out["expected_pay_pence"] = None if pay is None else _int(pay, "pay figure", 1, MAX_PENCE)
    return out


# ── Pay-period helpers ───────────────────────────────────────────────────────

def enumerate_periods(start: date, end: date, cfg: dict):
    """Yield (period_start, period_end) for each pay period overlapping
    [start, end], beginning with the one holding `start`."""
    if end < start:
        return
    cur, pe = get_pay_period_for_date(start, cfg)
    for _ in range(MAX_PERIODS * 6):
        yield cur, pe
        if pe >= end:
            return
        cur = pe + timedelta(days=1)
        _s, pe = get_pay_period_for_date(cur, cfg)


def _nth_period_starts(start: date, cfg: dict, n: int) -> list[tuple[date, date]]:
    out = []
    cur, pe = get_pay_period_for_date(start, cfg)
    for _ in range(n):
        out.append((cur, pe))
        cur = pe + timedelta(days=1)
        _s, pe = get_pay_period_for_date(cur, cfg)
    return out


# ── Events ───────────────────────────────────────────────────────────────────

def _limit(schedule: dict, default_cap: int) -> int:
    count = schedule.get("count")
    return default_cap if count is None else min(count, default_cap)


def _events(schedule: dict, cfg: dict, expected_pay_pence: int | None = None) -> list[tuple[date, int]]:
    kind = schedule.get("type")
    start = date.fromisoformat(str(schedule["start_date"])[:10])
    end = schedule.get("end_date")
    end_d = date.fromisoformat(str(end)[:10]) if end else None
    events: list[tuple[date, int]] = []
    if kind == "arithmetic":
        unit = schedule["step_unit"]
        a0, step = int(schedule["start_pence"]), int(schedule.get("step_pence") or 0)
        n_max = _limit(schedule, _UNIT_CAP[unit])
        if unit == "period":
            for i, (ps, _pe) in enumerate(_nth_period_starts(start, cfg, n_max)):
                due = start if i == 0 else ps
                if end_d and due > end_d:
                    break
                events.append((due, a0 + i * step))
            return events
        stride = 1 if unit == "day" else 7
        for i in range(n_max):
            due = start + timedelta(days=i * stride)
            if end_d and due > end_d:
                break
            events.append((due, a0 + i * step))
        return events
    if kind == "fixed":
        for i, (ps, _pe) in enumerate(_nth_period_starts(start, cfg, len(schedule["amounts_pence"]))):
            events.append((start if i == 0 else ps, int(schedule["amounts_pence"][i])))
        return events
    if kind == "percent_of_pay":
        pay = expected_pay_pence if expected_pay_pence is not None else schedule.get("expected_pay_pence")
        amount = round(int(pay) * float(schedule["percent"]) / 100) if pay else 0
        for i, (ps, _pe) in enumerate(_nth_period_starts(start, cfg, _limit(schedule, MAX_PERIODS))):
            due = start if i == 0 else ps
            if end_d and due > end_d:
                break
            events.append((due, amount))
        return events
    return events


def daily_amounts(schedule: dict, start: date, end: date, cfg: dict | None = None) -> list[int]:
    """Pence due on each day of [start, end] (0 on days with nothing due)."""
    if end < start or (end - start).days > MAX_DAYS:
        return []
    by_day: dict[date, int] = {}
    for due, amt in _events(schedule, cfg or {"type": "calendar_month"}):
        by_day[due] = by_day.get(due, 0) + amt
    return [by_day.get(start + timedelta(days=i), 0) for i in range(( end - start).days + 1)]


def period_amount(schedule: dict, period_start: date, period_end: date, cfg: dict,
                  *, expected_pay_pence: int | None = None) -> int:
    """Pence due inside [period_start, period_end] (inclusive)."""
    if not is_scheduled(schedule):
        return 0
    return sum(a for due, a in _events(schedule, cfg, expected_pay_pence) if period_start <= due <= period_end)


def total_pence(schedule: dict, cfg: dict, *, expected_pay_pence: int | None = None) -> int:
    return sum(a for _due, a in _events(schedule, cfg, expected_pay_pence))


def end_date(schedule: dict, cfg: dict) -> date | None:
    """Last day the schedule asks for money: the last day block, or the end of
    the pay period holding the last week or period block."""
    ev = _events(schedule, cfg)
    if not ev:
        return None
    last = max(due for due, _a in ev)
    if schedule.get("type") == "arithmetic" and schedule.get("step_unit") == "day":
        return last
    return get_pay_period_for_date(last, cfg)[1]


def planned_to_date(schedule: dict, today: date, cfg: dict) -> int:
    """Pence the schedule has asked for up to and including `today`. This is
    the on-track yardstick: money due later in the live period is not yet owed,
    so a goal is never reported behind for amounts that are still to come."""
    return sum(a for due, a in _events(schedule, cfg) if due <= today)


def next_periods(schedule: dict, today: date, cfg: dict, n: int = 3) -> list[dict]:
    """The `n` pay periods after the live one, as {start, end, amount (pence)},
    stopping once the schedule has run out."""
    last = end_date(schedule, cfg)
    if last is None:
        return []
    out = []
    _s, cur_end = get_pay_period_for_date(today, cfg)
    cur = cur_end + timedelta(days=1)
    while len(out) < n and cur <= last:
        ps, pe = get_pay_period_for_date(cur, cfg)
        out.append({"start": ps.isoformat(), "end": pe.isoformat(), "amount": period_amount(schedule, ps, pe, cfg)})
        cur = pe + timedelta(days=1)
    return out


def periods_count(schedule: dict, cfg: dict) -> int:
    ev = _events(schedule, cfg)
    if not ev:
        return 0
    first, last = min(d for d, _a in ev), max(d for d, _a in ev)
    return sum(1 for _ in enumerate_periods(first, last, cfg))


# ── Plain English ────────────────────────────────────────────────────────────

def fmt_pence(pence: int) -> str:
    if pence < 100:
        return f"{pence}p"
    pounds, rem = divmod(pence, 100)
    return f"£{pounds:,}" if rem == 0 else f"£{pounds:,}.{rem:02d}"


def fmt_money(pence: int) -> str:
    """Always pounds and pence, for totals ("£2,671.80")."""
    return f"£{pence / 100:,.2f}"


def fmt_date(d: date) -> str:
    return f"{d.day} {d.strftime('%b %Y')}"


def _plural(n: int, noun: str) -> str:
    return f"{n} {noun}" if n == 1 else f"{n} {noun}s"


def schedule_label(schedule: dict) -> str:
    kind = (schedule or {}).get("type")
    if kind == "equal" or not kind:
        return "Equal amounts each pay period"
    start = date.fromisoformat(str(schedule["start_date"])[:10])
    if kind == "fixed":
        amts = schedule["amounts_pence"]
        shown = ", ".join(fmt_pence(a) for a in amts[:4])
        more = f" and {len(amts) - 4} more" if len(amts) > 4 else ""
        return f"{shown}{more}, one a pay period from {fmt_date(start)}"
    tail = ""
    if schedule.get("count"):
        unit = "pay period" if kind == "percent_of_pay" else _UNIT_NOUN[schedule["step_unit"]]
        tail = f" for {_plural(int(schedule['count']), unit)}"
    elif schedule.get("end_date"):
        tail = f" until {fmt_date(date.fromisoformat(str(schedule['end_date'])[:10]))}"
    if kind == "percent_of_pay":
        pct = schedule["percent"]
        pct_s = f"{pct:g}"
        return f"{pct_s}% of pay each pay period, from {fmt_date(start)}{tail}"
    unit = schedule["step_unit"]
    per = "pay period" if unit == "period" else unit
    first = f"{fmt_pence(schedule['start_pence'])} a {per}"
    rise = f", rising by {fmt_pence(schedule['step_pence'])} a {per}" if schedule.get("step_pence") else ""
    return f"{first}{rise}, from {fmt_date(start)}{tail}"


def public_schedule(schedule: dict) -> dict:
    """The stored shape is already the public shape (pence integers, ISO dates)."""
    return dict(schedule)
