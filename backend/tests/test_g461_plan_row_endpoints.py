"""Exercise the actual plan PATCH handlers with isolated owned records.

Only the surrounding persistence and forecasts are faked. Validation,
route clearing, compare-and-set predicates and contribution preservation
run through the production handlers.
"""
import asyncio
from copy import deepcopy
from datetime import date, datetime
from types import SimpleNamespace

from bson import ObjectId
from fastapi import HTTPException
import pytest

from app.routers import allocations, commitments
from app.services import plan_fulfilment, plan_tracking

UID = "g461-fixture"
USER = {"email": UID}
TODAY = date(2026, 11, 12)
RULE = {"match_type": "description_contains", "match_value": "Savings Challenge"}


def matches(doc, query):
    for key, value in query.items():
        if key == "$or":
            if not any(matches(doc, branch) for branch in value): return False
        elif isinstance(value, dict) and any(str(k).startswith("$") for k in value):
            present, actual = key in doc, doc.get(key)
            if "$exists" in value and present != value["$exists"]: return False
            if "$eq" in value and (not present or actual != value["$eq"]): return False
            if "$ne" in value and actual == value["$ne"]: return False
            if "$in" in value and actual not in value["$in"]: return False
            if "$gte" in value and (actual is None or actual < value["$gte"]): return False
            if "$lte" in value and (actual is None or actual > value["$lte"]): return False
        elif doc.get(key) != value:
            return False
    return True


class Store:
    def __init__(self, docs=()):
        self.docs = deepcopy(list(docs))
        self.before_update = None

    def find(self, query, *_):
        rows = [deepcopy(doc) for doc in self.docs if matches(doc, query)]
        async def to_list(_): return rows
        return SimpleNamespace(to_list=to_list)

    async def find_one(self, query, *_):
        return next((deepcopy(doc) for doc in self.docs if matches(doc, query)), None)

    async def insert_one(self, doc):
        doc.setdefault("_id", ObjectId())
        self.docs.append(deepcopy(doc))
        return SimpleNamespace(inserted_id=doc["_id"])

    async def update_one(self, query, update):
        if self.before_update:
            self.before_update(self.docs[0])
            self.before_update = None
        for doc in self.docs:
            if matches(doc, query):
                doc.update(deepcopy(update.get("$set", {})))
                for key in update.get("$unset", {}): doc.pop(key, None)
                return SimpleNamespace(matched_count=1)
        return SimpleNamespace(matched_count=0)


def account(identifier, subtype="CURRENT_ACCOUNT", currency="GBP", **extra):
    return {"_id": identifier, "user_id": UID, "type": "bank", "subtype": subtype,
            "name": identifier, "currency": currency, "balance": 123.45, **extra}


def aside(**extra):
    return {"_id": ObjectId(), "user_id": UID, "name": "Challenge", "amount_per_period": 50,
            "source_account_id": "current", "destination_account_id": "pot", "tracking_mode": "manual",
            "fill_account_id": "", "match_type": "description_contains", "match_value": "", "fill_display_name": "",
            "active": True, "recurrence": "every_period", "effective_from": datetime(2026, 10, 1),
            "period_contributions": {"2026-11-30": {"contribution_pence": 6000}}, **extra}


@pytest.fixture
def environment(monkeypatch):
    owned = [account("current"), account("joint"), account("pot", "SAVINGS_ACCOUNT"),
             account("other-pot", "SAVINGS_ACCOUNT"), account("usd", currency="USD"),
             account("card", "CREDIT_CARD"), account("excluded", include_in_safe_to_spend=False)]
    account_store, empty = Store(owned), Store()
    account_map = {doc["_id"]: doc for doc in owned}
    async def owned_map(_): return deepcopy(account_map)
    async def cfg(_): return {"type": "calendar_month"}
    async def invalidate(_): pass
    async def kinds(_): return {"Savings": "moved", "Groceries": "spend"}
    for module in (allocations, commitments):
        monkeypatch.setattr(module, "owned_account_map", owned_map)
        monkeypatch.setattr(module, "accounts_col", account_store)
        monkeypatch.setattr(module, "yapily_accounts_col", empty)
        monkeypatch.setattr(module, "manual_accounts_col", empty)
        monkeypatch.setattr(module, "_pay_cfg", cfg)
    monkeypatch.setattr(allocations, "transactions_col", empty)
    monkeypatch.setattr(allocations, "yapily_transactions_col", empty)
    monkeypatch.setattr(allocations, "commitments_col", empty)
    monkeypatch.setattr(commitments, "commitments_col", empty)
    monkeypatch.setattr(plan_tracking, "get_category_kinds", kinds)
    monkeypatch.setattr(plan_tracking, "owned_account_map", owned_map)
    monkeypatch.setattr(allocations.response_cache, "ainvalidate", invalidate)
    monkeypatch.setattr(allocations.timeutil, "user_today", lambda: TODAY)
    async def serial_goal(_uid, doc): return deepcopy(doc)
    monkeypatch.setattr(commitments, "_serialise_one_with_siblings", serial_goal)
    return SimpleNamespace(monkeypatch=monkeypatch, empty=empty, accounts=account_map)


def patch_aside(env, doc, body, store=None):
    store = store or Store([doc])
    env.monkeypatch.setattr(allocations, "allocations_col", store)
    return asyncio.run(allocations.update_allocation(str(doc["_id"]), body, USER)), store


@pytest.mark.parametrize("body,field,value", [
    ({"source_account_id": "joint"}, "source_account_id", "joint"),
    ({"destination_account_id": "other-pot"}, "destination_account_id", "other-pot"),
    ({"fill_rule": RULE, "category_tracking": None}, "fill_rule", RULE),
    ({"fill_rule": None}, "fill_rule", None),
    ({"category_tracking": {"category": "Savings", "destination_account_ids": ["pot"]}}, "category_tracking", {"category": "Savings", "destination_account_ids": ["pot"]}),
])
def test_set_aside_each_row_saves_and_preserves_period_contribution(environment, body, field, value):
    original = aside(fill_rule=RULE)
    result, store = patch_aside(environment, original, body)
    assert result[field] == value
    assert store.docs[0]["effective_from"] == original["effective_from"]
    assert store.docs[0]["period_contributions"] == original["period_contributions"]
    if field in ("source_account_id", "destination_account_id", "category_tracking"):
        assert not store.docs[0].get("fill_rule")


@pytest.mark.parametrize("body", [
    {"source_account_id": "someone-elses-account"}, {"source_account_id": "pot"},
    {"source_account_id": "card"}, {"source_account_id": "usd"}, {"source_account_id": "excluded"},
    {"destination_account_id": "someone-elses-account"}, {"destination_account_id": "current"},
    {"destination_account_id": "card"}, {"destination_account_id": "usd"},
    {"fill_rule": {"match_type": "all", "match_value": "Challenge"}},
    {"fill_rule": {"match_type": "description_contains", "match_value": ""}},
    {"fill_rule": RULE, "category_tracking": {"category": "Savings"}},
    {"category_tracking": {"category": "Nonexistent"}},
])
def test_set_aside_invalid_row_edits_do_not_write(environment, body):
    original = aside()
    store = Store([original])
    with pytest.raises(HTTPException): patch_aside(environment, original, body, store)
    assert store.docs == [original]


def test_set_aside_foreign_owner_and_concurrent_tracking_edit_are_refused(environment):
    original = aside(user_id="another-user")
    with pytest.raises(HTTPException) as foreign:
        patch_aside(environment, original, {"fill_rule": RULE})
    assert foreign.value.status_code == 404
    original = aside()
    store = Store([original])
    store.before_update = lambda doc: doc.update(fill_rule={"match_type": "description_equals", "match_value": "New payment"})
    with pytest.raises(HTTPException) as conflict:
        patch_aside(environment, original, {"source_account_id": "joint"}, store)
    assert conflict.value.status_code == 409
    assert store.docs[0]["source_account_id"] == "current"
    assert store.docs[0]["fill_rule"]["match_value"] == "New payment"


def test_legacy_incoming_rule_survives_unrelated_edit_and_can_be_replaced(environment):
    original = aside(tracking_mode="existing_payment", fill_account_id="pot", match_value="Original credit", fill_display_name="Original credit")
    result, _ = patch_aside(environment, original, {"name": "New name"})
    assert result["tracking_mode"] == "existing_payment" and result["match_value"] == "Original credit"
    result, _ = patch_aside(environment, original, {"tracking_mode": "manual", "source_account_id": "current", "destination_account_id": "pot", "fill_rule": RULE, "category_tracking": None})
    assert result["fill_rule"] == RULE and result["fill_account_id"] == "" and result["match_value"] == ""


@pytest.mark.parametrize("body", [
    {"source_account_id": "joint"}, {"funding_pots": [{"account_id": "other-pot", "count_existing": False}]},
    {"fill_rule": RULE}, {"fill_rule": None}, {"category_tracking": {"category": "Savings"}},
])
def test_goal_row_patch_preserves_unchanged_progress_and_contribution(environment, body):
    doc = {"_id": ObjectId(), "user_id": UID, "name": "Challenge", "amount": 500,
           "status": "active", "target_date": "2027-01-01", "source_account_id": "current",
           "funding_pots": [{"account_id": "pot", "kind": "connected", "count_existing": False, "baseline": 42.50}],
           "fill_rule": RULE, "period_contributions": {"2026-11-30": {"contribution_pence": 6000}}}
    store = Store([doc])
    environment.monkeypatch.setattr(commitments, "commitments_col", store)
    result = asyncio.run(commitments.update_commitment(str(doc["_id"]), body, USER))
    assert result["period_contributions"] == doc["period_contributions"]
    if "funding_pots" not in body: assert result["funding_pots"] == doc["funding_pots"]
    if "source_account_id" in body or "funding_pots" in body: assert result["fill_rule"] is None
    if "category_tracking" in body: assert result["category_tracking"] == body["category_tracking"] and result["fill_rule"] is None


def test_explicit_payment_picker_lists_source_series_without_inventing_transfer_suggestion(environment):
    rows = [{"_id": "one", "user_id": UID, "account_id": "current", "transaction_type": "debit", "date": datetime(2026, 11, 11), "amount": 12.04, "description": "Challenge", "merchant_name": "Challenge"},
            {"_id": "foreign", "user_id": "another-user", "account_id": "current", "transaction_type": "debit", "date": datetime(2026, 11, 11), "amount": 99, "description": "Foreign"}]
    environment.monkeypatch.setattr(plan_fulfilment, "transactions_col", Store(rows))
    environment.monkeypatch.setattr(plan_fulfilment, "yapily_transactions_col", Store())
    default = asyncio.run(commitments.plan_fill_candidates("current", "", USER))
    explicit = asyncio.run(commitments.plan_fill_candidates("current", "", USER, include_source_payments=True))
    assert default == {"items": [], "suggestion": None}
    assert [item["match_value"] for item in explicit["items"]] == ["Challenge"]
    assert explicit["items"][0]["is_transfer"] is False and explicit["suggestion"] is None


def test_account_plan_amounts_reconcile_after_a_source_payment(environment):
    doc = aside(fill_rule=RULE)
    payment = {"user_id": UID, "account_id": "current", "transaction_type": "debit", "amount": 12.04,
               "description": "Savings Challenge", "date": datetime(2026, 11, 11)}
    environment.monkeypatch.setattr(allocations, "allocations_col", Store([doc]))
    environment.monkeypatch.setattr(allocations, "transactions_col", Store([payment]))
    result = asyncio.run(allocations.list_account_plans(USER))
    plan = result["items"][0]
    assert plan["filled_amount"] == 12.04
    assert plan["period_amount"] == 60
    assert round(plan["filled_amount"] + plan["remaining"], 2) == plan["period_amount"]


def test_rival_only_claims_debits_inside_its_effective_window(environment):
    current = aside(fill_rule=RULE, created_at=datetime(2026, 10, 2))
    future = aside(fill_rule=RULE, effective_from=datetime(2026, 11, 20), created_at=datetime(2026, 10, 1))
    payment = {"user_id": UID, "account_id": "current", "transaction_type": "debit", "amount": 12.04,
               "description": "Savings Challenge", "date": datetime(2026, 11, 11)}
    environment.monkeypatch.setattr(allocations, "allocations_col", Store([current, future]))
    environment.monkeypatch.setattr(allocations, "transactions_col", Store([payment]))
    result = asyncio.run(allocations._serialise(current, date(2026, 11, 1), date(2026, 11, 30)))
    assert result["filled_this_period"] == 12.04


def test_existing_incoming_rule_owns_transfer_before_new_source_rule(environment):
    current = aside(fill_rule=RULE)
    incoming = aside(tracking_mode="existing_payment", fill_account_id="pot", match_value="Original credit")
    rows = [{"user_id": UID, "account_id": "current", "transaction_type": "debit", "amount": 12.04,
             "description": "Savings Challenge", "date": datetime(2026, 11, 11)},
            {"user_id": UID, "account_id": "pot", "transaction_type": "credit", "amount": 12.04,
             "description": "Original credit", "date": datetime(2026, 11, 11)}]
    environment.monkeypatch.setattr(allocations, "allocations_col", Store([current, incoming]))
    environment.monkeypatch.setattr(allocations, "transactions_col", Store(rows))
    first = asyncio.run(allocations._serialise(current, date(2026, 11, 1), date(2026, 11, 30)))
    legacy = asyncio.run(allocations._serialise(incoming, date(2026, 11, 1), date(2026, 11, 30)))
    assert first["filled_this_period"] == 0 and legacy["filled_this_period"] == 12.04


def test_duplicate_feed_copies_count_once_and_failed_payment_read_keeps_reserve(environment):
    doc = aside(fill_rule=RULE)
    payment = {"_id": ObjectId(), "transaction_id": "same-payment", "user_id": UID, "account_id": "current",
               "transaction_type": "debit", "amount": 12.04, "description": "Savings Challenge", "date": datetime(2026, 11, 11)}
    environment.monkeypatch.setattr(allocations, "allocations_col", Store([doc]))
    environment.monkeypatch.setattr(allocations, "transactions_col", Store([payment]))
    environment.monkeypatch.setattr(allocations, "yapily_transactions_col", Store([{**payment, "_id": ObjectId()}]))
    result = asyncio.run(allocations._serialise(doc, date(2026, 11, 1), date(2026, 11, 30)))
    assert result["filled_this_period"] == 12.04
    async def unavailable(*_args, **_kwargs): raise RuntimeError("Synthetic feed unavailable")
    environment.monkeypatch.setattr(allocations, "source_debits_this_period", unavailable)
    result = asyncio.run(allocations._serialise(doc, date(2026, 11, 1), date(2026, 11, 30)))
    assert result["filled_this_period"] == 0 and result["remaining"] == result["period_amount"]
