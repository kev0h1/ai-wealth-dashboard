"""G291 category-tracking evidence is read-only and uses canonical spend rules."""
import asyncio
from datetime import datetime, date, timezone

import pytest
from bson import ObjectId
from fastapi import HTTPException

from app.services import plan_tracking
from app.services.spending import SpendingContext
import app.routers.allocations as allocations


DAY = date(2026, 10, 12)
KIND = {"Groceries": "discretionary", "Transfer": "movement", "Debt": "movement"}


def _row(identifier, amount, *, account="current", debit=True, category="Groceries", day=DAY, **extra):
    return {
        "id": identifier, "amount": amount, "account_id": account,
        "transaction_type": "debit" if debit else "credit", "category": category,
        "date": datetime.combine(day, datetime.min.time()), "description": identifier,
        **extra,
    }


def _context(rows=()):
    return SpendingContext.from_docs(list(rows), KIND, {"name_tokens": [], "own_ids": set(), "own_map": {}})


def _manual(*, identifier="current", category="Groceries", created=None):
    out = {
        "_id": identifier, "_kind": "set-aside", "source_account_id": "current",
        "category_tracking": {"category": category},
    }
    if created is not None:
        out["created_at"] = created
    return out


def _goal(*, identifier="goal", created=None):
    out = {
        "_id": identifier, "_kind": "goal", "source_account_id": "current",
        "funding_pots": [{"account_id": "pot"}],
        "category_tracking": {"category": "Groceries"},
    }
    if created is not None:
        out["created_at"] = created
    return out


def test_category_spend_nets_refunds_deduplicates_and_honours_custom_category():
    rows = [
        _row("shop", 40, custom_category="Groceries"),
        _row("shop", 40, custom_category="Groceries"),  # duplicate feed copy
        _row("refund", 15, debit=False, custom_category="Groceries"),
        _row("other", 100, custom_category="Other"),
    ]
    result = plan_tracking.summarise_activity(rows, _manual(), [], DAY, DAY, _context(rows))
    assert result["mode"] == "spending"
    assert (result["count"], result["gross"], result["refunds"], result["amount"]) == (2, 40, 15, 25)
    assert [row["id"] for row in result["items"]] == ["refund", "shop"]


def test_category_spend_excludes_canonical_moves_and_card_repayments():
    rows = [
        _row("linked", 30, linked_offline_account_id="saving"),
        _row("transfer", 30, category="Transfer"),
        _row("card", 30, category="Debt", description="Credit card payment 1234"),
        _row("food", 20),
    ]
    # Only the food row has the selected category. A transfer-shaped selected
    # category must not become spend merely because the plan tracks it.
    current = _manual(category="Transfer")
    assert plan_tracking.summarise_activity(rows, current, [], DAY, DAY, _context(rows))["amount"] == 0
    assert plan_tracking.summarise_activity(rows, _manual(), [], DAY, DAY, _context(rows))["amount"] == 20


def test_goal_requires_verified_matching_sink_and_each_credit_is_used_once():
    # The linked destination is the canonical own-money evidence: this is a
    # real move, not an everyday Groceries debit merely paired by amount.
    debit_one = _row("out-1", 50, linked_offline_account_id="pot")
    debit_two = _row("out-2", 50, linked_offline_account_id="pot")
    sink = _row("in-1", 50, account="pot", debit=False, category="Transfer")
    wrong_sink = _row("wrong", 50, account="elsewhere", debit=False, category="Transfer")
    rows = [debit_one, debit_two, sink, wrong_sink]
    result = plan_tracking.summarise_activity(rows, _goal(), [], DAY, DAY, _context(rows))
    assert result["mode"] == "transfers"
    assert result["count"] == 1 and result["amount"] == 50
    assert result["items"][0]["id"] in {"out-1", "out-2"}


def test_payment_rule_rival_wins_but_current_keeps_its_own_category_evidence():
    row = _row("shop", 45)
    current = _manual(identifier="current", created=datetime(2026, 1, 2, tzinfo=timezone.utc))
    payment_rival = {
        "_id": "payment", "_kind": "goal", "source_account_id": "current",
        "fill_rule": {"match_type": "description_contains", "match_value": "shop"},
    }
    assert plan_tracking.summarise_activity([row], current, [payment_rival], DAY, DAY, _context([row]))["amount"] == 0
    assert plan_tracking.summarise_activity([row], current, [], DAY, DAY, _context([row]))["amount"] == 45


def test_oldest_category_claimant_wins_except_the_current_record():
    row = _row("shop", 25)
    old = _manual(identifier="old", created=datetime(2026, 1, 1, tzinfo=timezone.utc))
    new = _manual(identifier="new", created=datetime(2026, 2, 1, tzinfo=timezone.utc))
    assert plan_tracking.summarise_activity([row], new, [old], DAY, DAY, _context([row]))["amount"] == 0
    assert plan_tracking.summarise_activity([row], old, [new], DAY, DAY, _context([row]))["amount"] == 25


def test_category_evidence_can_be_negative_and_respects_link_once_and_effective_boundaries():
    refund = _row("refund", 30, debit=False)
    other_goal = _row("already-linked", 20, linked_goal_id="another-goal")
    before_effective = _row("before-effective", 10)
    current = _manual()
    current["effective_from"] = date(2026, 10, 13)
    assert plan_tracking.summarise_activity([refund, other_goal, before_effective], current, [], DAY, DAY, _context([refund, other_goal, before_effective]))["amount"] == 0

    assert plan_tracking.summarise_activity([other_goal], _manual(), [], DAY, DAY, _context([other_goal]))["count"] == 0

    negative = plan_tracking.summarise_activity([refund], _manual(), [], DAY, DAY, _context([refund]))
    assert (negative["gross"], negative["refunds"], negative["amount"]) == (0, 30, -30)

    once = _manual()
    once.update({"recurrence": "once", "created_period_start": date(2026, 10, 13), "created_period_end": date(2026, 10, 31)})
    assert plan_tracking.summarise_activity([_row("old", 10)], once, [], DAY, DAY, _context())["count"] == 0


def test_tracking_validation_rejects_foreign_destination_and_unknown_category(monkeypatch):
    accounts = {"mine": {"currency": "GBP"}}

    async def categories(_):
        return {"Groceries": "discretionary"}
    monkeypatch.setattr(plan_tracking, "get_category_kinds", categories)

    with pytest.raises(HTTPException) as foreign:
        asyncio.run(plan_tracking.validate_tracking(
            {"category": "Groceries", "destination_account_ids": ["theirs"]}, "u", account_map=accounts
        ))
    assert foreign.value.status_code == 404

    with pytest.raises(HTTPException) as unknown:
        asyncio.run(plan_tracking.validate_tracking({"category": "Not mine"}, "u", account_map=accounts))
    assert unknown.value.status_code == 400


def test_category_activity_rejects_foreign_plan_before_any_activity_read(monkeypatch):
    foreign_id = "64c0ffee0000000000000001"
    calls = []

    class _Plans:
        async def find_one(self, query):
            calls.append(query)
            return None

    async def accounts(_):
        return {
            "current": {"currency": "GBP", "type": "CURRENT", "subtype": "CURRENT_ACCOUNT", "balance": 100},
            "pot": {"currency": "GBP", "type": "SAVINGS", "subtype": "SAVINGS_ACCOUNT", "balance": 100},
        }

    async def categories(_):
        return {"Groceries": "discretionary"}

    monkeypatch.setattr(plan_tracking, "owned_account_map", accounts)
    monkeypatch.setattr(plan_tracking, "get_category_kinds", categories)
    monkeypatch.setattr(plan_tracking, "commitments_col", _Plans())
    with pytest.raises(HTTPException) as denied:
        asyncio.run(plan_tracking.category_activity({
            "kind": "goal", "commitment_id": foreign_id, "source_account_id": "current",
            "destination_account_ids": ["pot"], "category": "Groceries",
        }, "owner"))
    assert denied.value.status_code == 404
    assert len(calls) == 1 and calls[0]["user_id"] == "owner" and "_id" in calls[0]


def test_category_activity_rejects_invalid_source_before_database_reads(monkeypatch):
    class _NeverRead:
        async def find_one(self, *_):
            raise AssertionError("invalid source must not read a plan")

    async def accounts(_):
        return {"current": {"currency": "GBP", "type": "CURRENT", "subtype": "CURRENT_ACCOUNT", "balance": 100}}

    async def categories(_):
        return {"Groceries": "discretionary"}

    monkeypatch.setattr(plan_tracking, "owned_account_map", accounts)
    monkeypatch.setattr(plan_tracking, "get_category_kinds", categories)
    monkeypatch.setattr(plan_tracking, "commitments_col", _NeverRead())
    with pytest.raises(HTTPException) as denied:
        asyncio.run(plan_tracking.category_activity({
            "kind": "goal", "source_account_id": "foreign", "category": "Groceries",
        }, "owner"))
    assert denied.value.status_code == 400


def test_category_activity_rejects_foreign_destination_before_plan_read(monkeypatch):
    class _NeverRead:
        async def find_one(self, *_):
            raise AssertionError("foreign destination must not read a plan")

    async def accounts(_):
        return {"current": {"currency": "GBP", "type": "CURRENT", "subtype": "CURRENT_ACCOUNT", "balance": 100}}

    async def categories(_):
        return {"Groceries": "discretionary"}

    monkeypatch.setattr(plan_tracking, "owned_account_map", accounts)
    monkeypatch.setattr(plan_tracking, "get_category_kinds", categories)
    monkeypatch.setattr(plan_tracking, "commitments_col", _NeverRead())
    with pytest.raises(HTTPException) as denied:
        asyncio.run(plan_tracking.category_activity({
            "kind": "goal", "source_account_id": "current", "destination_account_ids": ["foreign"],
            "category": "Groceries",
        }, "owner"))
    assert denied.value.status_code == 404


def test_category_activity_uses_current_period_and_saved_once_window(monkeypatch):
    """The endpoint is scoped, clips future activity, and honours a once plan's
    immutable period rather than today’s pay-period configuration."""
    uid = "owner"
    allocation_id = "64c0ffee0000000000000001"
    in_window = _row("inside", 30, day=date(2026, 10, 10), user_id=uid)
    future = _row("future", 40, day=date(2026, 10, 20), user_id=uid)
    outside_once = _row("outside-once", 50, day=date(2026, 9, 30), user_id=uid)

    class _Cursor:
        def __init__(self, docs): self.docs = docs
        async def to_list(self, _): return [dict(row) for row in self.docs]

    class _Transactions:
        def __init__(self, rows): self.rows = rows; self.queries = []
        def find(self, query, *_):
            self.queries.append(query)
            lo, hi = query["date"]["$gte"], query["date"]["$lte"]
            return _Cursor([row for row in self.rows if row["user_id"] == query["user_id"] and lo <= row["date"] <= hi])

    allocation = {
        "_id": plan_tracking.ObjectId(allocation_id), "user_id": uid, "active": True, "recurrence": "once",
        "created_period_start": date(2026, 10, 1), "created_period_end": date(2026, 10, 31),
        "source_account_id": "current", "funding_pots": [], "category_tracking": {"category": "Groceries"},
    }

    class _Plans:
        async def find_one(self, query):
            return dict(allocation) if query == {"_id": allocation["_id"], "user_id": uid} else None
        def find(self, query, *_):
            return _Cursor([allocation] if query == {"user_id": uid, "active": True} else [])

    class _Prefs:
        async def find_one(self, query):
            assert query == {"user_id": uid}
            return {"pay_period_config": {"type": "calendar_month"}}

    async def accounts(_):
        return {"current": {"currency": "GBP", "type": "CURRENT", "subtype": "CURRENT_ACCOUNT", "balance": 100}}
    async def categories(_): return {"Groceries": "discretionary"}
    async def identity(_): return {"name_tokens": [], "own_ids": set(), "own_map": {}}

    txns = _Transactions([in_window, future, outside_once])
    monkeypatch.setattr(plan_tracking, "owned_account_map", accounts)
    monkeypatch.setattr(plan_tracking, "get_category_kinds", categories)
    monkeypatch.setattr(plan_tracking, "user_identity", identity)
    monkeypatch.setattr(plan_tracking, "commitments_col", _Plans())
    monkeypatch.setattr(plan_tracking, "allocations_col", _Plans())
    monkeypatch.setattr(plan_tracking, "preferences_col", _Prefs())
    monkeypatch.setattr(plan_tracking, "transactions_col", txns)
    monkeypatch.setattr(plan_tracking, "yapily_transactions_col", _Transactions([]))
    monkeypatch.setattr(plan_tracking.timeutil, "user_today", lambda: date(2026, 10, 12))

    result = asyncio.run(plan_tracking.category_activity({
        "kind": "set-aside", "allocation_id": allocation_id, "source_account_id": "current", "category": "Groceries", "preview": True,
    }, uid))
    assert result["period_start"] == "2026-10-01" and result["period_end"] == "2026-10-31"
    assert result["amount"] == 30 and [row["id"] for row in result["items"]] == ["inside"]
    assert all(query["user_id"] == uid for query in txns.queries)


def test_saved_plan_activity_ignores_malicious_route_category_and_window_body(monkeypatch):
    uid = "owner"
    allocation_id = ObjectId()
    row = _row("saved-groceries", 22, user_id=uid)

    class _Cursor:
        def __init__(self, docs): self.docs = docs
        async def to_list(self, _): return [dict(doc) for doc in self.docs]

    saved = {
        "_id": allocation_id, "user_id": uid, "active": True, "source_account_id": "current",
        "category_tracking": {"category": "Groceries"}, "effective_from": date(2026, 10, 1),
    }
    class _Plans:
        async def find_one(self, query):
            return dict(saved) if query == {"_id": allocation_id, "user_id": uid} else None
        def find(self, query, *_):
            return _Cursor([saved] if query == {"user_id": uid, "active": True} else [])
    class _Transactions:
        def __init__(self): self.query = None
        def find(self, query, *_):
            self.query = query
            return _Cursor([row])
    class _Prefs:
        async def find_one(self, _): return {"pay_period_config": {"type": "calendar_month"}}
    async def accounts(_):
        return {"current": {"currency": "GBP", "type": "CURRENT", "subtype": "CURRENT_ACCOUNT", "balance": 100}}
    async def categories(_): return {"Groceries": "discretionary", "Other": "discretionary"}
    async def identity(_): return {"name_tokens": [], "own_ids": set(), "own_map": {}}

    txns = _Transactions()
    monkeypatch.setattr(plan_tracking, "owned_account_map", accounts)
    monkeypatch.setattr(plan_tracking, "get_category_kinds", categories)
    monkeypatch.setattr(plan_tracking, "user_identity", identity)
    monkeypatch.setattr(plan_tracking, "allocations_col", _Plans())
    monkeypatch.setattr(plan_tracking, "commitments_col", _Plans())
    monkeypatch.setattr(plan_tracking, "preferences_col", _Prefs())
    monkeypatch.setattr(plan_tracking, "transactions_col", txns)
    monkeypatch.setattr(plan_tracking, "yapily_transactions_col", _Transactions())
    monkeypatch.setattr(plan_tracking.timeutil, "user_today", lambda: DAY)

    result = asyncio.run(plan_tracking.category_activity({
        "kind": "set-aside", "allocation_id": str(allocation_id),
        "source_account_id": "foreign", "destination_account_ids": ["foreign"],
        "category": "Other", "effective_from": "2099-01-01",
    }, uid))
    assert result["category"] == "Groceries" and result["amount"] == 22
    assert txns.query["account_id"]["$in"] == ["current"]


def test_manual_allocation_persists_category_tracking_and_rejects_dual_or_foreign(monkeypatch):
    """Route-level regression: category tracking is a manual-plan field only."""
    uid = "owner"

    class _Allocations:
        def __init__(self): self.docs = []; self.identifier = ObjectId(); self.last_filter = None
        async def insert_one(self, doc):
            doc["_id"] = self.identifier; self.docs.append(dict(doc)); return type("R", (), {"inserted_id": self.identifier})()
        async def find_one(self, query):
            return next((dict(doc) for doc in self.docs if doc.get("_id") == query.get("_id") and doc.get("user_id") == query.get("user_id")), None)
        async def update_one(self, query, update):
            self.last_filter = query
            for doc in self.docs:
                if doc.get("_id") == query.get("_id") and doc.get("user_id") == query.get("user_id"):
                    doc.update(update["$set"])
                    return type("R", (), {"matched_count": 1})()
            return type("R", (), {"matched_count": 0})()

    async def accounts(_):
        return {
            "current": {"currency": "GBP", "type": "CURRENT", "subtype": "CURRENT_ACCOUNT", "balance": 100},
            "next": {"currency": "GBP", "type": "CURRENT", "subtype": "CURRENT_ACCOUNT", "balance": 100},
            "pot": {"currency": "GBP", "type": "SAVINGS", "subtype": "SAVINGS_ACCOUNT", "balance": 100},
            "other-pot": {"currency": "GBP", "type": "SAVINGS", "subtype": "SAVINGS_ACCOUNT", "balance": 100},
        }
    async def categories(_): return {"Groceries": "discretionary"}
    async def cfg(_): return {"type": "calendar_month"}
    async def no_conflict(*_): return False
    async def no_cache(*_): return None
    async def serial(doc, *_): return doc
    store = _Allocations()
    monkeypatch.setattr(allocations, "allocations_col", store)
    monkeypatch.setattr(allocations, "owned_account_map", accounts)
    monkeypatch.setattr(allocations, "_pay_cfg", cfg)
    monkeypatch.setattr(allocations, "_conflicts", no_conflict)
    monkeypatch.setattr(allocations, "_serialise", serial)
    monkeypatch.setattr(allocations.response_cache, "ainvalidate", no_cache)
    monkeypatch.setattr(allocations.timeutil, "user_today", lambda: date(2026, 10, 12))
    monkeypatch.setattr(plan_tracking, "get_category_kinds", categories)

    body = {
        "name": "Groceries", "amount_per_period": 300, "tracking_mode": "manual",
        "source_account_id": "current", "recurrence": "every_period",
        "destination_account_id": "pot",
        "category_tracking": {"category": "Groceries", "destination_account_ids": ["pot"]},
    }
    out = asyncio.run(allocations.create_allocation(body, {"email": uid}))
    assert out["category_tracking"] == {"category": "Groceries", "destination_account_ids": ["pot"]}
    assert store.docs[0]["category_tracking"] == out["category_tracking"]
    assert out["destination_account_id"] == "pot"
    assert out["fill_account_id"] == out["match_value"] == ""

    mismatch = {
        **body, "name": "Mismatched route", "destination_account_id": "other-pot",
    }
    with pytest.raises(HTTPException) as mismatched:
        asyncio.run(allocations.create_allocation(mismatch, {"email": uid}))
    assert mismatched.value.status_code == 400 and len(store.docs) == 1

    dual = {**body, "tracking_mode": "existing_payment", "fill_account_id": "pot", "match_type": "description_contains", "match_value": "groceries"}
    with pytest.raises(HTTPException) as conflict:
        asyncio.run(allocations.create_allocation(dual, {"email": uid}))
    assert conflict.value.status_code == 400 and len(store.docs) == 1

    foreign = {**body, "category_tracking": {"category": "Groceries", "destination_account_ids": ["foreign"]}}
    with pytest.raises(HTTPException) as denied:
        asyncio.run(allocations.create_allocation(foreign, {"email": uid}))
    assert denied.value.status_code == 404 and len(store.docs) == 1

    with pytest.raises(HTTPException) as patch_mismatch:
        asyncio.run(allocations.update_allocation(
            str(store.identifier), {
                "destination_account_id": "other-pot",
                "category_tracking": {"category": "Groceries", "destination_account_ids": ["pot"]},
            }, {"email": uid}
        ))
    assert patch_mismatch.value.status_code == 400
    assert store.docs[0]["destination_account_id"] == "pot"
    assert store.docs[0]["category_tracking"]["destination_account_ids"] == ["pot"]

    rerouted = asyncio.run(allocations.update_allocation(
        str(store.identifier), {"destination_account_id": "other-pot"}, {"email": uid}
    ))
    assert rerouted["destination_account_id"] == "other-pot"
    assert rerouted["category_tracking"] is None

    changed = asyncio.run(allocations.update_allocation(
        str(store.identifier), {"source_account_id": "next"}, {"email": uid}
    ))
    assert changed["source_account_id"] == "next"
    assert changed["category_tracking"] is None
    assert store.last_filter["destination_account_id"] == "other-pot"

    not_now = {key: value for key, value in body.items() if key not in {"category_tracking", "destination_account_id"}}
    not_now["name"] = "Rainy day"
    source_only = asyncio.run(allocations.create_allocation(not_now, {"email": uid}))
    assert "category_tracking" not in source_only and "destination_account_id" not in source_only
    assert source_only["fill_account_id"] == source_only["match_value"] == ""


@pytest.mark.parametrize("destination,expected", [
    ("foreign", 404), ("card", 422), ("usd", 422), ("current", 400),
])
def test_manual_destination_rejects_foreign_card_non_gbp_and_self(destination, expected):
    accounts = {
        "current": {"currency": "GBP", "type": "CURRENT", "subtype": "CURRENT_ACCOUNT"},
        "card": {"currency": "GBP", "type": "credit_card", "subtype": "CREDIT_CARD"},
        "usd": {"currency": "USD", "type": "SAVINGS", "subtype": "SAVINGS_ACCOUNT"},
    }
    with pytest.raises(HTTPException) as error:
        allocations._manual_destination(destination, "current", accounts)
    assert error.value.status_code == expected


def test_manual_destination_is_optional_and_never_creates_a_payment_fill():
    accounts = {"current": {"currency": "GBP", "type": "CURRENT", "subtype": "CURRENT_ACCOUNT"}}
    assert allocations._manual_destination(None, "current", accounts) is None
