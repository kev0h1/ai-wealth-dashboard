"""Income stream schedule derivation and next-occurrence stepping."""
from datetime import date, timedelta
import calendar
from typing import Any

PAYDAY_MIN_OCCURRENCES = 3
PAYDAY_AMOUNT_TOLERANCE = 0.20
PAYDAY_MIN_AMOUNT = 100.0


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


def income_merchant_label(key: str) -> str:
    """Human merchant name extracted from a raw transaction key."""
    from app.services.companion import _humanise_bill_name
    name = _humanise_bill_name(key)
    # Strip trailing UK bank payment-method tokens
    import re
    tokens = r"\b(BGC|BAC|BACS|FPI|FPO|FP|CR|TFR|STO|DD|DDR|SO)\b"
    name = re.sub(tokens, "", name, flags=re.IGNORECASE)
    # Collapse whitespace
    name = re.sub(r"\s+", " ", name).strip()
    # Title-case remaining ALL-CAPS words of >=3 chars
    def _title_word(m):
        w = m.group(0)
        return w.title() if len(w) >= 3 and w.isupper() else w
    name = re.sub(r"[A-Za-z]+", _title_word, name)
    return name if name else key


def payday_phrase(schedule: dict) -> str:
    """Plain-English cadence phrase for use inside a sentence."""
    def ordinal(n: int) -> str:
        if 11 <= n <= 13:
            return f"{n}th"
        suffix = {1: "st", 2: "nd", 3: "rd"}.get(n % 10, "th")
        return f"{n}{suffix}"

    WEEKDAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]
    t = schedule["type"]
    if t == "last_weekday":
        return f"the last {WEEKDAY_NAMES[schedule['weekday']]} of the month"
    elif t == "day_of_month":
        return f"the {ordinal(schedule['day'])} of each month"
    elif t == "biweekly":
        return f"every other {WEEKDAY_NAMES[schedule['weekday']]}"
    elif t == "weekly":
        return f"every {WEEKDAY_NAMES[schedule['weekday']]}"
    else:
        return "on a regular schedule"


def schedule_to_pay_period_config(schedule: dict) -> dict | None:
    """Map a confirmed income schedule to the pay_period_config shape."""
    t = schedule.get("type")
    if t == "last_weekday":
        py_wd = schedule["weekday"]
        return {"type": "last_weekday_of_month", "weekday": (py_wd + 1) % 7}
    elif t == "day_of_month":
        return {"type": "monthly_pay_date", "day": schedule["day"]}
    elif t == "biweekly":
        py_wd = schedule["weekday"]
        anchor = schedule["anchor"]
        return {"type": "biweekly", "weekday": (py_wd + 1) % 7, "referenceDate": anchor}
    elif t == "weekly":
        py_wd = schedule["weekday"]
        return {"type": "weekly", "weekday": (py_wd + 1) % 7}
    else:
        return None


def propose_payday_from_candidates(candidates: list[dict], today: date) -> dict | None:
    """PURE function. Picks the best payday proposal from detected candidates."""
    import statistics

    survivors = []
    for c in candidates:
        if c.get("category") != "Income":
            continue
        dates = c.get("dates", [])
        amounts = c.get("amounts", [])
        if len(dates) < PAYDAY_MIN_OCCURRENCES:
            continue
        if not amounts:
            continue
        median_amt = statistics.median(amounts)
        if median_amt < PAYDAY_MIN_AMOUNT:
            continue
        if any(abs(a - median_amt) > PAYDAY_AMOUNT_TOLERANCE * median_amt for a in amounts):
            continue
        sched = derive_schedule(dates)
        if sched is None:
            continue
        ppc = schedule_to_pay_period_config(sched)
        if ppc is None:
            continue
        # Check cadence regularity
        sorted_dates = sorted(dates)
        intervals = [(sorted_dates[i+1] - sorted_dates[i]).days for i in range(len(sorted_dates)-1)]
        if not intervals:
            continue
        avg_interval = sum(intervals) / len(intervals)
        tol = max(3.0, avg_interval * 0.25)
        if any(abs(iv - avg_interval) > tol for iv in intervals):
            continue
        survivors.append((median_amt, c, sched, ppc))

    if not survivors:
        return None

    # Pick largest median amount
    _, best, sched, ppc = max(survivors, key=lambda x: x[0])
    key = best["key"]
    dates = sorted(best["dates"])
    amounts = best["amounts"]
    median_amt = statistics.median(amounts)

    return {
        "key": key,
        "merchant": income_merchant_label(key),
        "amount": round(median_amt, 2),
        "occurrences": len(dates),
        "schedule": sched,
        "schedule_label": schedule_label(sched),
        "payday_phrase": payday_phrase(sched),
        "pay_period_config": ppc,
        "next_date": next_occurrence(sched, today).isoformat(),
        "last_seen": dates[-1].isoformat(),
        "account_id": best.get("account_id"),
    }


async def get_payday_proposal(uid: str, today: date | None = None) -> dict | None:
    """DB-aware wrapper: fetch transactions, detect recurring income, propose payday."""
    import logging
    _log = logging.getLogger(__name__)
    try:
        from datetime import datetime, timedelta
        from app.db.collections import transactions_col, yapily_transactions_col
        from app.routers.analytics import _detect_recurring
        from collections import defaultdict

        if today is None:
            today = date.today()

        cutoff = datetime.now() - timedelta(days=90)
        proj = {"merchant_name": 1, "description": 1, "amount": 1, "date": 1,
                "transaction_type": 1, "category": 1, "custom_category": 1, "account_id": 1}
        raw = await transactions_col.find(
            {"user_id": uid, "date": {"$gte": cutoff}}, proj
        ).to_list(None)
        raw += await yapily_transactions_col.find(
            {"user_id": uid, "date": {"$gte": cutoff}}, proj
        ).to_list(None)
        credits = [t for t in raw if t.get("transaction_type") == "credit"
                   and (t.get("custom_category") or t.get("category") or "Other") not in {"Transfer"}]

        # Detect recurring income to get the candidate key set
        detected = _detect_recurring(credits, today=today, is_income=True)

        # Build dates/amounts per key by re-bucketing the same in-memory credits list
        key_dates: dict[str, list] = defaultdict(list)
        key_amounts: dict[str, list] = defaultdict(list)
        key_account: dict[str, str] = {}
        for t in credits:
            k = (t.get("merchant_name") or t.get("description", "")[:35]).strip()
            if not k:
                continue
            d = t["date"]
            if isinstance(d, datetime):
                d = d.date()
            key_dates[k].append(d)
            key_amounts[k].append(abs(float(t.get("amount", 0))))
            if "account_id" in t:
                key_account[k] = str(t["account_id"])

        # Build candidates from detected patterns
        candidates = []
        for p in detected:
            k = p["key"]
            dates = sorted(key_dates.get(k, []))
            amounts = key_amounts.get(k, [])
            candidates.append({
                "key": k,
                "category": p.get("category", "Other"),
                "account_id": key_account.get(k),
                "dates": dates,
                "amounts": amounts,
            })

        return propose_payday_from_candidates(candidates, today)
    except Exception as exc:
        import logging as _logging
        _logging.getLogger(__name__).warning("get_payday_proposal failed for %s: %s", uid, exc)
        return None
