"""Income stream schedule derivation and next-occurrence stepping."""
from datetime import date, timedelta
import calendar
from typing import Any


def derive_schedule(dates: list[date]) -> dict | None:
    """
    From observed dates, derive ONE of four schedule patterns or return None.
    Intervals are calendar gaps between consecutive sorted dates.
    Ranges: weekly 5-9, biweekly 11-18, monthly 26-33, else None.
    """
    if len(dates) < 2:
        return None
    sorted_dates = sorted(dates)
    intervals = [(sorted_dates[i + 1] - sorted_dates[i]).days for i in range(len(sorted_dates) - 1)]
    avg = sum(intervals) / len(intervals)

    if 5 <= avg <= 9:  # weekly
        weekdays = [d.weekday() for d in sorted_dates]
        modal_wd = max(set(weekdays), key=weekdays.count)
        return {"type": "weekly", "weekday": modal_wd}

    elif 11 <= avg <= 18:  # biweekly
        weekdays = [d.weekday() for d in sorted_dates]
        modal_wd = max(set(weekdays), key=weekdays.count)
        anchor = sorted_dates[-1].isoformat()
        return {"type": "biweekly", "weekday": modal_wd, "anchor": anchor}

    elif 26 <= avg <= 33:  # monthly
        days_of_month = [d.day for d in sorted_dates]
        modal_day = max(set(days_of_month), key=days_of_month.count)

        def is_last_weekday_of_month(d: date) -> bool:
            _, last = calendar.monthrange(d.year, d.month)
            last_date = date(d.year, d.month, last)
            last_wd = last_date - timedelta(days=(last_date.weekday() - d.weekday()) % 7)
            return last_wd == d

        if all(is_last_weekday_of_month(d) for d in sorted_dates):
            weekdays = [d.weekday() for d in sorted_dates]
            if len(set(weekdays)) == 1:
                return {"type": "last_weekday", "weekday": weekdays[0]}

        if all(abs(d.day - modal_day) <= 1 for d in sorted_dates):
            return {"type": "day_of_month", "day": modal_day}

        # Fallback: use most recent date's day
        return {"type": "day_of_month", "day": sorted_dates[-1].day}

    else:
        return None


def next_occurrence(schedule: dict, after: date) -> date:
    """
    Return the next date strictly after `after` for the given schedule.
    """
    t = schedule["type"]

    if t == "day_of_month":
        day = schedule["day"]
        # Try the current month first
        year, month = after.year, after.month
        _, days_in_month = calendar.monthrange(year, month)
        candidate = date(year, month, min(day, days_in_month))
        if candidate > after:
            return candidate
        # Advance to next month
        if month == 12:
            year += 1
            month = 1
        else:
            month += 1
        _, days_in_month = calendar.monthrange(year, month)
        return date(year, month, min(day, days_in_month))

    elif t == "last_weekday":
        wd = schedule["weekday"]
        year, month = after.year, after.month
        for _ in range(13):  # at most 13 months
            _, last = calendar.monthrange(year, month)
            last_date = date(year, month, last)
            # last occurrence of wd in this month
            last_wd_date = last_date - timedelta(days=(last_date.weekday() - wd) % 7)
            if last_wd_date > after:
                return last_wd_date
            # Advance to next month
            if month == 12:
                year += 1
                month = 1
            else:
                month += 1
        raise ValueError("Could not find next last_weekday occurrence")

    elif t == "weekly":
        wd = schedule["weekday"]
        delta = (wd - after.weekday()) % 7
        if delta == 0:
            delta = 7
        return after + timedelta(days=delta)

    elif t == "biweekly":
        anchor = date.fromisoformat(schedule["anchor"])
        days_since = (after - anchor).days
        periods_elapsed = days_since // 14
        candidate = anchor + timedelta(days=(periods_elapsed + 1) * 14)
        while candidate <= after:
            candidate += timedelta(days=14)
        return candidate

    else:
        raise ValueError(f"Unknown schedule type: {t}")


def schedule_label(schedule: dict) -> str:
    """
    Human copy for each type.
    """
    def ordinal(n: int) -> str:
        if 11 <= n <= 13:
            return f"{n}th"
        suffix = {1: "st", 2: "nd", 3: "rd"}.get(n % 10, "th")
        return f"{n}{suffix}"

    WEEKDAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]

    t = schedule["type"]
    if t == "day_of_month":
        return f"around the {ordinal(schedule['day'])} each month"
    elif t == "last_weekday":
        return f"the last {WEEKDAY_NAMES[schedule['weekday']]} each month"
    elif t == "biweekly":
        return f"every other {WEEKDAY_NAMES[schedule['weekday']]}"
    elif t == "weekly":
        return f"every {WEEKDAY_NAMES[schedule['weekday']]}"
    else:
        return "on a regular schedule"


def get_confirmed_payday(uid_prefs: dict, today: date) -> tuple[date, dict] | None:
    """
    From prefs["income_streams"] (confirmed only), find the minimum next_occurrence
    across all confirmed streams. Also return the primary stream (largest avg_amount).
    Returns (next_date, primary_stream_dict) or None if no confirmed streams.
    """
    confirmed = [
        s for s in (uid_prefs.get("income_streams") or [])
        if s.get("status") == "confirmed" and s.get("schedule")
    ]
    if not confirmed:
        return None

    primary = max(confirmed, key=lambda s: float(s.get("avg_amount") or 0))

    # Find minimum next occurrence across all confirmed streams
    min_date = None
    for s in confirmed:
        try:
            nd = next_occurrence(s["schedule"], today)
            if min_date is None or nd < min_date:
                min_date = nd
        except Exception:
            continue

    if min_date is None:
        return None

    return (min_date, primary)
