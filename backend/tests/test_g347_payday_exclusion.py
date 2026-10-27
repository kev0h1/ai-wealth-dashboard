"""G347: only declared movements are payday-plan transfer destinations."""
import asyncio
from datetime import date, datetime, time, timedelta

import app.core.timeutil as timeutil
import app.services.categories as categories
import app.services.companion as companion


class _Cursor:
    def __init__(self, rows):
        self._rows = rows

    def __aiter__(self):
        return self._iterate()

    async def _iterate(self):
        for row in self._rows:
            yield row


class _Transactions:
    """In-memory subset of the two queries `_usual_payday_moves_raw` makes."""
    def __init__(self, rows):
        self._rows = rows

    def find(self, query, projection=None):
        bounds = query["date"]
        return _Cursor([
            row for row in self._rows
            if row["transaction_type"] == query["transaction_type"]
            and bounds["$gte"] <= row["date"] < bounds["$lt"]
        ])


def test_payday_destinations_only_include_declared_movements(monkeypatch):
    """Matched credits do not turn excluded, income, or spend into a move."""
    paydays = (date(2026, 9, 1), date(2026, 8, 1), date(2026, 7, 1), date(2026, 6, 1))
    kinds = {
        "House Fund": "movement",
        "Not counted": "excluded",
        "Income correction": "income",
        "Coffee": "discretionary",
    }
    rows = []
    for payday in paydays:
        posted = datetime.combine(payday + timedelta(days=1), time.min)
        for category, amount, destination in (
            ("House Fund", 100.0, "saving-account"),
            ("Not counted", 200.0, "excluded-destination"),
            ("Income correction", 300.0, "income-destination"),
            ("Coffee", 400.0, "spend-destination"),
        ):
            rows.extend((
                {"user_id": "user", "transaction_type": "debit", "date": posted,
                 "account_id": "salary-account", "category": category, "amount": amount},
                {"user_id": "user", "transaction_type": "credit", "date": posted,
                 "account_id": destination, "category": "Transfer", "amount": amount},
            ))

    async def fake_kinds(uid):
        assert uid == "user"
        return kinds

    monkeypatch.setattr(timeutil, "user_today", lambda: date(2026, 10, 27))
    monkeypatch.setattr(categories, "get_category_kinds", fake_kinds)
    monkeypatch.setattr(companion, "transactions_col", _Transactions(rows))

    result = asyncio.run(companion._usual_payday_moves_raw(
        "user", "salary-account", {"type": "calendar_month"},
    ))

    assert result == {"saving-account": [100.0, 100.0, 100.0, 100.0]}
