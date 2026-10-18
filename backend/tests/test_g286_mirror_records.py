"""G286: Mirror evidence is bounded, owned, and does not create new state."""
import asyncio
from copy import deepcopy
from datetime import date, datetime

import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient

import app.routers.behaviour as behaviour_router
import app.services.mirror_feedback as mirror_feedback
from app.core.auth import current_user


UID = "owner@example.com"


class _Cursor:
    def __init__(self, docs):
        self.docs = docs
        self.sort_calls = []
        self.limit_calls = []

    def sort(self, fields):
        self.sort_calls.append(fields)
        return self

    def limit(self, size):
        self.limit_calls.append(size)
        return self

    async def to_list(self, size):
        return deepcopy(self.docs[:size])


class _ReadOnlyTransactions:
    def __init__(self, typed_docs):
        self.typed_docs = typed_docs
        self.queries = []
        self.cursors = []

    def find(self, query, projection):
        self.queries.append(deepcopy(query))
        # The service deliberately makes one bounded query for each persisted
        # date type. This fake need not reimplement Mongo's regex grammar.
        typed = self.typed_docs[0 if isinstance(query["date"]["$gte"], datetime) else 1]
        docs = [doc for doc in typed if doc.get("user_id") == query["user_id"]]
        cursor = _Cursor(docs)
        self.cursors.append(cursor)
        return cursor


class _UpdateResult:
    def __init__(self, matched_count):
        self.matched_count = matched_count


class _Portraits:
    def __init__(self, docs):
        self.docs = deepcopy(docs)
        self.calls = []

    async def update_one(self, query, update):
        self.calls.append((deepcopy(query), deepcopy(update)))
        for doc in self.docs:
            if doc.get("_id") != query.get("_id"):
                continue
            trait_id = query.get("traits.id")
            trait = next((item for item in doc.get("traits", []) if item.get("id") == trait_id), None)
            if trait is not None:
                trait["choice"] = update["$set"]["traits.$.choice"]
                return _UpdateResult(1)
        return _UpdateResult(0)


def test_latest_payment_records_filters_and_normalises_bounded_mixed_dates(monkeypatch):
    today = date(2026, 10, 18)
    docs = _ReadOnlyTransactions(([
        {"_id": "new", "user_id": UID, "date": datetime(2026, 10, 18, 10), "amount": 7,
         "transaction_type": "debit", "description": "Returned direct debit", "merchant_name": "Bank"},
        {"_id": "future", "user_id": UID, "date": datetime(2026, 10, 19), "amount": 9,
         "transaction_type": "debit", "description": "Late fee"},
        {"_id": "nan", "user_id": UID, "date": datetime(2026, 10, 17), "amount": float("nan"),
         "transaction_type": "credit", "description": "Bounced payment"},
        {"_id": "old", "user_id": UID, "date": datetime(2026, 4, 20), "amount": 1,
         "transaction_type": "debit", "description": "unpaid"},
        {"_id": "other-user", "user_id": "other@example.com", "date": datetime(2026, 10, 18), "amount": 99,
         "transaction_type": "debit", "description": "returned"},
    ], [
        {"_id": "fallback", "user_id": UID, "date": "2026-10-17", "amount": -2.5,
         "name": "Overdraft fee"},
        {"_id": "description_wins", "user_id": UID, "date": "2026-10-16", "amount": 5,
         "transaction_type": "credit", "description": "ordinary purchase", "name": "late fee"},
        {"_id": "bad-type", "user_id": UID, "date": "2026-10-15", "amount": 4,
         "transaction_type": "unknown", "description": "bounced"},
    ]))
    monkeypatch.setattr(mirror_feedback, "transactions_col", docs)
    monkeypatch.setattr(mirror_feedback.timeutil, "user_today", lambda: today)

    result = asyncio.run(mirror_feedback.latest_payment_records(UID))

    assert result["window_start"] == "2026-04-21"
    assert result["window_end"] == "2026-10-18"
    assert [(record["id"], record["date"], record["amount"]) for record in result["records"]] == [
        ("new", "2026-10-18", -7.0), ("fallback", "2026-10-17", -2.5),
    ]
    assert all(query["user_id"] == UID for query in docs.queries)
    assert len(docs.queries) == 2
    assert all(cursor.limit_calls == [50] for cursor in docs.cursors)
    assert all(cursor.sort_calls == [[("date", -1), ("_id", -1)]] for cursor in docs.cursors)
    assert not hasattr(docs, "update_one") and not hasattr(docs, "insert_one")


def test_latest_payment_records_returns_latest_six_in_stable_order(monkeypatch):
    today = date(2026, 10, 18)
    rows = [
        {"_id": f"{index:02d}", "user_id": UID, "date": f"2026-10-{index:02d}", "amount": index,
         "transaction_type": "debit", "description": "returned payment"}
        for index in range(1, 9)
    ]
    docs = _ReadOnlyTransactions(([], rows))
    monkeypatch.setattr(mirror_feedback, "transactions_col", docs)
    monkeypatch.setattr(mirror_feedback.timeutil, "user_today", lambda: today)

    result = asyncio.run(mirror_feedback.latest_payment_records(UID))

    assert [record["id"] for record in result["records"]] == ["08", "07", "06", "05", "04", "03"]


def test_payment_record_bounds_are_london_days_across_bst(monkeypatch):
    docs = _ReadOnlyTransactions(([
        {"_id": "start", "user_id": UID, "date": datetime(2026, 4, 20, 23, 30), "amount": 5, "transaction_type": "debit", "description": "late fee"},
        {"_id": "end", "user_id": UID, "date": datetime(2026, 10, 18, 22, 30), "amount": 6, "transaction_type": "debit", "description": "returned payment"},
        {"_id": "tomorrow", "user_id": UID, "date": datetime(2026, 10, 18, 23, 30), "amount": 7, "transaction_type": "debit", "description": "late fee"},
    ], []))
    monkeypatch.setattr(mirror_feedback, "transactions_col", docs)
    monkeypatch.setattr(mirror_feedback.timeutil, "user_today", lambda: date(2026, 10, 18))
    result = asyncio.run(mirror_feedback.latest_payment_records(UID))
    assert docs.queries[0]["date"] == {"$gte": datetime(2026, 4, 20, 23), "$lt": datetime(2026, 10, 18, 23)}
    assert [(r["id"], r["date"]) for r in result["records"]] == [("end", "2026-10-18"), ("start", "2026-04-21")]


def test_payment_records_route_uses_authenticated_user_only(monkeypatch):
    seen = []

    async def evidence(uid):
        seen.append(uid)
        return {"records": [], "window_start": "2026-04-21", "window_end": "2026-10-18", "checked_at": "now"}

    monkeypatch.setattr(behaviour_router, "latest_payment_records", evidence)
    app = FastAPI()
    app.include_router(behaviour_router.router)
    app.dependency_overrides[current_user] = lambda: {"email": UID}
    client = TestClient(app)

    response = client.get("/mirror/payment-records?user_id=other@example.com")

    assert response.status_code == 200
    assert seen == [UID]


def test_choice_rejects_unknown_or_foreign_traits_without_false_consent(monkeypatch):
    portraits = _Portraits([
        {"_id": UID, "traits": [{"id": "known", "choice": None}]},
        {"_id": "other@example.com", "traits": [{"id": "foreign", "choice": None}]},
    ])
    monkeypatch.setattr(behaviour_router, "behaviour_portrait_col", portraits)

    with pytest.raises(HTTPException) as unknown:
        asyncio.run(behaviour_router.set_mirror_choice(behaviour_router.ChoiceBody(trait_id="missing", choice="keep"), {"email": UID}))
    with pytest.raises(HTTPException) as foreign:
        asyncio.run(behaviour_router.set_mirror_choice(behaviour_router.ChoiceBody(trait_id="foreign", choice="change"), {"email": UID}))

    assert unknown.value.status_code == 404 and foreign.value.status_code == 404
    assert portraits.docs[0]["traits"][0]["choice"] is None
    assert portraits.docs[1]["traits"][0]["choice"] is None


def test_choice_is_idempotent_when_the_same_choice_is_already_saved(monkeypatch):
    portraits = _Portraits([{"_id": UID, "traits": [{"id": "known", "choice": "keep"}]}])
    monkeypatch.setattr(behaviour_router, "behaviour_portrait_col", portraits)

    result = asyncio.run(behaviour_router.set_mirror_choice(
        behaviour_router.ChoiceBody(trait_id="known", choice="keep"), {"email": UID}
    ))

    assert result == {"ok": True, "trait_id": "known", "choice": "keep"}
    assert portraits.calls[0][0] == {"_id": UID, "traits.id": "known"}
