"""Read-only provenance for income totals, using the walk's selected events.

Never selects a new income, changes its date/amount or runs another forecast.
The only history we describe is the rows the existing detector actually used.
"""
from datetime import date, datetime, timedelta
from math import isfinite
from urllib.parse import urlencode

from app.services.account_names import display_account_name

MAX_SOURCE_IDS = 100
MAX_SOURCE_ID_LENGTH = 200
MAX_HISTORY_LINK_LENGTH = 6000


def _day(value) -> str | None:
    if isinstance(value, datetime):
        return value.date().isoformat()
    if isinstance(value, date):
        return value.isoformat()
    try:
        return date.fromisoformat(str(value)[:10]).isoformat()
    except (TypeError, ValueError):
        return None


def _valid_id(value: str) -> bool:
    return bool(value.strip()) and len(value) <= MAX_SOURCE_ID_LENGTH and not any(ord(c) < 32 or 127 <= ord(c) <= 159 for c in value)


def income_history(rows: list[dict]) -> dict:
    """A bounded cache addition alongside the detector's existing evidence."""
    days = sorted(day for row in rows if (day := _day(row.get("date"))))
    ids = list(dict.fromkeys(str(row["_id"]) for row in rows if row.get("_id") is not None))
    usable = [value for value in ids if _valid_id(value)]
    return {
        "transaction_ids": usable[:MAX_SOURCE_IDS],
        "source_ids_complete": len(usable) == len(ids) and all(row.get("_id") is not None for row in rows) and len(ids) <= MAX_SOURCE_IDS,
        "occurrences": len(rows),
        "first_received": days[0] if days else None,
        "last_received": days[-1] if days else None,
    }


def _history_link(ids: list[str], *, exact: bool, start: str, end: str) -> tuple[str, str]:
    ids = list(dict.fromkeys(ids))
    if exact and ids and len(ids) <= MAX_SOURCE_IDS and all(_valid_id(value) for value in ids):
        query = [("transaction_id", value) for value in ids]
        query += [("txn_type", "credit"), ("label", "Source credits")]
        href = "/transactions?" + urlencode(query)
        if len(href) <= MAX_HISTORY_LINK_LENGTH:
            return href, "sources"
    # Explicitly broad fallback supported by the task; never call this an
    # exact source filter. No amount, account number or bank text in the URL.
    return "/transactions?" + urlencode({"category": "Income", "txn_type": "credit", "from": start, "to": end}), "income_period"


def _cadence(event: dict, stream: dict) -> str | None:
    schedule = stream.get("schedule")
    kind = schedule.get("type") if isinstance(schedule, dict) else None
    if kind in {"day_of_month", "last_weekday"}:
        return "monthly"
    if kind == "weekly":
        return "weekly"
    if kind == "biweekly":
        return "every 2 weeks"
    interval = event.get("avg_interval")
    if isinstance(interval, bool) or not isinstance(interval, (int, float)) or not isfinite(interval) or interval <= 0:
        return None
    if event.get("monthly_anchor") is not None:
        return "monthly"
    if 6 <= interval <= 8:
        return "weekly"
    if 13 <= interval <= 15:
        return "every 2 weeks"
    return f"about every {max(1, round(interval))} days"


def build_income_evidence(*, before_payday: list[dict], expected_pay: list[dict],
                          income_total: float, pay_total: float, today: date,
                          confirmed_keys: set, income_streams: list | None = None) -> dict:
    """Describe the caller's exact selected lists, including repeated dates."""
    source_streams = income_streams if isinstance(income_streams, (list, tuple)) else []
    streams = {str(stream.get("key")): stream for stream in source_streams
               if isinstance(stream, dict) and stream.get("status") == "confirmed" and stream.get("key")}
    end = today.isoformat()
    default_start = (today - timedelta(days=90)).isoformat()

    def group(events: list[dict], total: float, *, payday: bool) -> dict:
        out = {"total": total, "status": "complete", "items": [],
               "transactions_href": None, "transactions_scope": "none"}
        all_ids: list[str] = []
        all_exact = True
        all_starts = [default_start]
        try:
            for event in events:
                if isinstance(event.get("amount"), bool):
                    raise ValueError("Income amount is not a number")
                amount = float(event["amount"])
                expected = _day(event.get("expected_date"))
                if not expected and isinstance(event.get("days_away"), int):
                    expected = (today + timedelta(days=event["days_away"])).isoformat()
                if not isfinite(amount) or amount < 0 or not expected:
                    raise ValueError("Income event has no reliable amount or date")
                key = event.get("name")
                if not isinstance(key, str) or not key.strip():
                    raise ValueError("Income event has no series identity")
                alias = event.get("confirmed_alias")
                confirmed = key in confirmed_keys or alias in confirmed_keys or event.get("source") == "confirmed"
                stream = streams.get(key) or streams.get(alias) or {}
                raw_history = event.get("income_history")
                history = raw_history if isinstance(raw_history, dict) else {}
                raw_ids = history.get("transaction_ids")
                ids = [str(value) for value in raw_ids] if isinstance(raw_ids, (list, tuple)) else []
                exact = history.get("source_ids_complete") is True and isinstance(raw_ids, (list, tuple))
                start = min(default_start, _day(history.get("first_received")) or default_start)
                href, scope = _history_link(ids, exact=exact, start=start, end=end)
                all_starts.append(start)
                all_ids.extend(ids)
                all_exact = all_exact and exact and bool(ids)
                basis = "Based on the income schedule you confirmed." if confirmed else "Predicted from recurring credits categorised as Income."
                if payday:
                    basis += " Shown as Expected pay because it is forecast on payday."
                    if not confirmed:
                        basis += " It has not been confirmed as pay."
                if not history:
                    basis += " Source history is not available in this snapshot."
                elif not ids:
                    basis += " No matching historical credits are available."
                if event.get("edited"):
                    basis += " You edited this occurrence."
                count = history.get("occurrences", event.get("occurrences"))
                count = count if isinstance(count, int) and not isinstance(count, bool) and count >= 0 else None
                out["items"].append({
                    "key": key,
                    "payer": next((event[field].strip() for field in ("display_name", "rule_label")
                                   if isinstance(event.get(field), str) and event[field].strip()), "Expected income"),
                    "amount": amount,
                    "expected_date": expected,
                    "account_id": str(event["account_id"]) if event.get("account_id") else None,
                    "account_name": display_account_name(event["account_name"]) if event.get("account_name") else None,
                    "account_bank": event.get("account_bank") or None,
                    "cadence": _cadence(event, stream),
                    "last_received": _day(history.get("last_received")),
                    "occurrences": count,
                    "confirmed": confirmed,
                    "basis": basis,
                    "transactions_href": href,
                    "transactions_scope": scope,
                })
            if isinstance(total, bool) or not isfinite(total) or round(sum(row["amount"] for row in out["items"]) * 100) != round(total * 100):
                raise ValueError("Income list does not reconcile to the supplied total")
            out["items"].sort(key=lambda row: (row["expected_date"], row["payer"], row["key"]))
            if events:
                out["transactions_href"], out["transactions_scope"] = _history_link(
                    all_ids, exact=all_exact, start=min(all_starts), end=end,
                )
        except (KeyError, TypeError, ValueError, OverflowError):
            out.update(status="unavailable", items=[], transactions_href=None, transactions_scope="none")
        return out

    return {
        "as_of": end,
        "before_payday": group(before_payday, income_total, payday=False),
        "expected_pay": group(expected_pay, pay_total, payday=True),
    }
