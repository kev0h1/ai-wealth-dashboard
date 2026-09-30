"""Focused no-database checks for G176 source-account selection semantics."""
import asyncio
from types import SimpleNamespace

from bson import ObjectId

import pytest
from fastapi import HTTPException

from app.services.account_plan_sources import chosen_source, owned_plan_balance, validate_source_account
import app.routers.allocations as allocations
import app.routers.commitments as commitments


class _Cursor:
    def __init__(self, docs): self.docs = docs
    async def to_list(self, _): return [dict(d) for d in self.docs]


class _Collection:
    def __init__(self, docs=()): self.docs = [dict(d) for d in docs]
    def find(self, query, *args):
        def matches(d):
            for key, value in query.items():
                if key == "$and":
                    if not all(matches_clause(d, clause) for clause in value): return False
                    continue
                if key == "$or":
                    if not any(matches_clause(d, clause) for clause in value): return False
                    continue
                if isinstance(value, dict):
                    if "$ne" in value and d.get(key) == value["$ne"]: return False
                    if "$exists" in value and (key in d) != value["$exists"]: return False
                    if "$eq" in value and (key not in d or d.get(key) != value["$eq"]): return False
                elif d.get(key) != value: return False
            return True
        def matches_clause(d, clause):
            for key, value in clause.items():
                if isinstance(value, dict):
                    if "$exists" in value and (key in d) != value["$exists"]: return False
                    if "$eq" in value and (key not in d or d.get(key) != value["$eq"]): return False
                    if "$ne" in value and d.get(key) == value["$ne"]: return False
                elif d.get(key) != value:
                    return False
            return True
        return _Cursor([d for d in self.docs if matches(d)])
    async def find_one(self, query, *args):
        return next((dict(d) for d in self.find(query).docs), None)
    async def insert_one(self, doc):
        doc.setdefault("_id", ObjectId())
        self.docs.append(dict(doc))
        return SimpleNamespace(inserted_id=doc["_id"])
    async def update_one(self, query, update):
        for doc in self.docs:
            if any(doc is candidate for candidate in self.find(query).docs):
                doc.update(update.get("$set", {}))
                return SimpleNamespace(matched_count=1)
        return SimpleNamespace(matched_count=0)


def test_account_plans_get_infers_only_legacy_allocations_and_normalises_unknown(monkeypatch):
    allocation = {"_id": "a1", "user_id": "u", "name": "Rainy day", "fill_account_id": "saving"}
    goal = {"_id": "g1", "user_id": "u", "name": "Trip", "status": "active", "funding_pots": [{"account_id": "saving"}]}
    monkeypatch.setattr(allocations, "allocations_col", _Collection([allocation]))
    monkeypatch.setattr(allocations, "commitments_col", _Collection([goal]))
    async def accounts(_): return {"current": _accounts()["current"], "saving": _accounts()["saving"]}
    async def serial(*_):
        return {"period_start": "2026-09-01", "period_end": "2026-09-30", "amount_per_period": 25.0,
                "filled_this_period": 10.0, "remaining": 15.0, "active": True, "completed": False,
                "pending": False, "fill_display_name": "Savings"}
    calls = []
    async def inferred(*args): calls.append(args); return "current"
    async def ledger(*args, **kwargs): return {"commitments": {"g1": {"total_claimed": 0, "claims": {}}}}
    async def slice_(*args): return {"per_period_slice": 35.0}
    monkeypatch.setattr(allocations, "owned_account_map", accounts)
    monkeypatch.setattr(allocations, "_serialise", serial)
    async def cfg(_): return {"type": "calendar_month"}
    monkeypatch.setattr(allocations, "_pay_cfg", cfg)
    monkeypatch.setattr("app.services.companion._direct_fill_leg_source", inferred)
    monkeypatch.setattr(commitments, "compute_pot_ledger", ledger)
    monkeypatch.setattr(commitments, "_pot_progress_and_slice", slice_)
    result = asyncio.run(allocations.list_account_plans({"email": "u"}))
    assert len(calls) == 1  # inference is invoked only for the legacy allocation
    rows = {r["id"]: r for r in result["items"]}
    assert rows["allocation:a1"]["source_basis"] == "recent-transfers"
    assert rows["allocation:a1"]["source_account_id"] == "current"
    assert rows["goal:g1"]["source_basis"] == "unknown"
    assert rows["goal:g1"]["filled_amount"] is None
    assert rows["goal:g1"]["remaining"] == rows["goal:g1"]["period_amount"] == 35.0


def test_account_plans_get_marks_pending_completed_and_inactive_allocations_not_active(monkeypatch):
    docs = [{"_id": key, "user_id": "u", "name": key, "fill_account_id": "saving"} for key in ("pending", "completed", "inactive")]
    monkeypatch.setattr(allocations, "allocations_col", _Collection(docs))
    monkeypatch.setattr(allocations, "commitments_col", _Collection())
    async def accounts(_): return {"saving": _accounts()["saving"]}
    states = iter([
        {"period_start":"2026-09-01", "period_end":"2026-09-30", "amount_per_period":10, "filled_this_period":0, "remaining":0, "active":True, "completed":False, "pending":True, "fill_display_name":"Savings"},
        {"period_start":"2026-09-01", "period_end":"2026-09-30", "amount_per_period":10, "filled_this_period":10, "remaining":0, "active":True, "completed":True, "pending":False, "fill_display_name":"Savings"},
        {"period_start":"2026-09-01", "period_end":"2026-09-30", "amount_per_period":10, "filled_this_period":0, "remaining":10, "active":False, "completed":False, "pending":False, "fill_display_name":"Savings"},
    ])
    async def serial(*_): return next(states)
    async def ledger(*args, **kwargs): return {"commitments": {}}
    monkeypatch.setattr(allocations, "owned_account_map", accounts)
    monkeypatch.setattr(allocations, "_serialise", serial)
    async def cfg(_): return {"type": "calendar_month"}
    monkeypatch.setattr(allocations, "_pay_cfg", cfg)
    monkeypatch.setattr(commitments, "compute_pot_ledger", ledger)
    assert all(not r["active"] for r in asyncio.run(allocations.list_account_plans({"email": "u"}))["items"])


def test_account_plans_passes_all_goal_siblings_to_shared_ledger(monkeypatch):
    goals = [
        {"_id": "old", "user_id": "u", "name": "Older", "status": "active", "funding_pots": [{"account_id": "saving"}]},
        {"_id": "new", "user_id": "u", "name": "Newer", "status": "active", "funding_pots": [{"account_id": "saving"}]},
    ]
    monkeypatch.setattr(allocations, "allocations_col", _Collection())
    monkeypatch.setattr(allocations, "commitments_col", _Collection(goals))
    async def accounts(_): return {"saving": {**_accounts()["saving"], "balance": 100}}
    async def cfg(_): return {"type": "calendar_month"}
    seen = {}
    async def ledger(uid, docs, balances):
        seen.update(uid=uid, ids={d["_id"] for d in docs}, balance=balances["saving"])
        return {"commitments": {"old": {"total_claimed": 100, "claims": {"saving": 100}}, "new": {"total_claimed": 0, "claims": {}}}}
    async def slice_(doc, *_): return {"per_period_slice": 0 if doc["_id"] == "old" else 50}
    monkeypatch.setattr(allocations, "owned_account_map", accounts)
    monkeypatch.setattr(allocations, "_pay_cfg", cfg)
    monkeypatch.setattr(commitments, "compute_pot_ledger", ledger)
    monkeypatch.setattr(commitments, "_pot_progress_and_slice", slice_)
    rows = asyncio.run(allocations.list_account_plans({"email": "u"}))["items"]
    assert seen == {"uid": "u", "ids": {"old", "new"}, "balance": 100.0}
    assert {r["remaining"] for r in rows} == {0, 50}


def test_account_plans_includes_legacy_statusless_goals_but_excludes_terminal_and_other_users(monkeypatch):
    def goal(identifier, **extra):
        return {"_id": identifier, "user_id": "u", "name": identifier,
                "funding_pots": [{"account_id": "saving"}], **extra}
    docs = [
        goal("legacy"),
        goal("active", status="active"),
        goal("done", status="done"),
        goal("cancelled", status="cancelled"),
        {**goal("other", status="active"), "user_id": "someone-else"},
    ]
    monkeypatch.setattr(allocations, "allocations_col", _Collection())
    monkeypatch.setattr(allocations, "commitments_col", _Collection(docs))
    async def accounts(_): return {"saving": {**_accounts()["saving"], "balance": 50}}
    async def cfg(_): return {"type": "calendar_month"}
    seen = {}
    async def ledger(uid, docs, balances):
        seen["ids"] = {doc["_id"] for doc in docs}
        return {"commitments": {doc["_id"]: {"total_claimed": 0, "claims": {}} for doc in docs}}
    async def slice_(*_): return {"per_period_slice": 10}
    monkeypatch.setattr(allocations, "owned_account_map", accounts)
    monkeypatch.setattr(allocations, "_pay_cfg", cfg)
    monkeypatch.setattr(commitments, "compute_pot_ledger", ledger)
    monkeypatch.setattr(commitments, "_pot_progress_and_slice", slice_)
    rows = asyncio.run(allocations.list_account_plans({"email": "u"}))["items"]
    assert seen["ids"] == {"legacy", "active"}
    assert {row["record_id"] for row in rows} == {"legacy", "active"}


def _accounts():
    return {
        "current": {"_id": "current", "type": "bank", "subtype": "CURRENT_ACCOUNT", "currency": "GBP", "balance": 0},
        "saving": {"_id": "saving", "type": "bank", "subtype": "SAVINGS_ACCOUNT", "currency": "GBP", "balance": 0},
        "card": {"_id": "card", "type": "credit_card", "subtype": "CREDIT_CARD", "currency": "GBP"},
        "usd": {"_id": "usd", "type": "bank", "subtype": "CURRENT_ACCOUNT", "currency": "USD"},
        "manual": {"_id": "manual", "account_type": "current", "_account_plan_manual": True},
    }


def test_explicit_source_requires_owned_eligible_non_destination_account():
    accounts = _accounts()
    assert validate_source_account("current", accounts, {"saving"}) == "current"
    assert validate_source_account("manual", accounts, {"saving"}) == "manual"
    assert validate_source_account(None, accounts, {"saving"}) is None
    for bad in ("saving", "card", "usd", "foreign", ""):
        with pytest.raises(HTTPException):
            validate_source_account(bad, accounts, {"saving"})


def test_owned_plan_balance_honours_real_shapes_and_does_not_invent_zero():
    assert owned_plan_balance({"balance": 0}) == 0.0
    assert owned_plan_balance({"current_balance": -25}) == -25.0
    assert owned_plan_balance({"available_balance": 12.5}) == 12.5
    assert owned_plan_balance({"_account_plan_manual": True, "balance": 0}) == 0.0
    assert owned_plan_balance({"_account_plan_manual": True, "current_balance": 9}) is None
    assert owned_plan_balance({}) is None
    assert owned_plan_balance({"balance": float("nan")}) is None
    assert owned_plan_balance({"balance": float("inf")}) is None


def test_presence_distinguishes_legacy_inference_from_explicit_null_and_stale_choice():
    accounts = _accounts()
    assert chosen_source({}, accounts, {"saving"}) == (None, "legacy")
    assert chosen_source({"source_account_id": None}, accounts, {"saving"}) == (None, "unknown")
    assert chosen_source({"source_account_id": "current"}, accounts, {"saving"}) == ("current", "chosen")
    # A stale explicit selection never falls back to historical inference.
    assert chosen_source({"source_account_id": "card"}, accounts, {"saving"}) == (None, "unknown")


def test_allocation_create_update_owns_source_and_null_clears_without_omission_reset(monkeypatch):
    col = _Collection()
    monkeypatch.setattr(allocations, "allocations_col", col)
    async def yes(*_): return True
    async def no(*_, **__): return False
    async def cfg(_): return {"type": "calendar_month"}
    async def sources(_): return {"current": _accounts()["current"], "saving": _accounts()["saving"]}
    async def serial(doc, *_): return doc
    monkeypatch.setattr(allocations, "_account_owned", yes)
    monkeypatch.setattr(allocations, "_conflicts", no)
    monkeypatch.setattr(allocations, "_pay_cfg", cfg)
    monkeypatch.setattr(allocations, "owned_account_map", sources)
    monkeypatch.setattr(allocations, "_serialise", serial)
    async def no_cache_invalidate(_): pass
    monkeypatch.setattr(allocations.response_cache, "ainvalidate", no_cache_invalidate)
    body = {"name": "Rainy", "amount_per_period": 20, "fill_account_id": "saving",
            "match_type": "description_contains", "match_value": "transfer", "recurrence": "every_period",
            "source_account_id": "current"}
    created = asyncio.run(allocations.create_allocation(body, {"email": "u"}))
    assert created["source_account_id"] == "current"
    doc = col.docs[0]
    asyncio.run(allocations.update_allocation(str(doc["_id"]), {"name": "Renamed"}, {"email": "u"}))
    assert col.docs[0]["source_account_id"] == "current"  # omitted means preserve
    asyncio.run(allocations.update_allocation(str(doc["_id"]), {"source_account_id": None}, {"email": "u"}))
    assert col.docs[0]["source_account_id"] is None
    with pytest.raises(HTTPException):
        asyncio.run(allocations.update_allocation(str(doc["_id"]), {"source_account_id": "foreign"}, {"email": "u"}))


def test_goal_update_relink_clears_existing_self_source(monkeypatch):
    oid = ObjectId()
    doc = {"_id": oid, "user_id": "u", "name": "Trip", "status": "active", "source_account_id": "current",
           "funding_pots": [{"account_id": "saving", "baseline": 0, "count_existing": False}]}
    col = _Collection([doc])
    monkeypatch.setattr(commitments, "commitments_col", col)
    async def pots(_): return [{"account_id": "current", "baseline": 0, "count_existing": False}]
    async def serial(*_): return {"ok": True}
    monkeypatch.setattr(commitments, "_build_pots", pots)
    monkeypatch.setattr(commitments, "_serialise_one_with_siblings", serial)
    asyncio.run(commitments.update_commitment(str(oid), {"funding_pots": [{"account_id": "current"}]}, {"email": "u"}))
    assert col.docs[0]["source_account_id"] is None


@pytest.mark.parametrize("account_map", [
    {},
    {"saving": {"_id": "saving", "type": "bank", "subtype": "SAVINGS_ACCOUNT", "currency": "GBP"}},
])
def test_account_plans_rejects_foreign_or_unavailable_goal_pots_without_ledger_fallback(monkeypatch, account_map):
    goal = {"_id": "g", "user_id": "u", "name": "Goal", "status": "active", "funding_pots": [{"account_id": "saving"}]}
    monkeypatch.setattr(allocations, "allocations_col", _Collection())
    monkeypatch.setattr(allocations, "commitments_col", _Collection([goal]))
    async def accounts(_): return account_map
    async def cfg(_): return {"type": "calendar_month"}
    async def must_not_run(*args, **kwargs): raise AssertionError("invalid pots never reach ledger")
    monkeypatch.setattr(allocations, "owned_account_map", accounts)
    monkeypatch.setattr(allocations, "_pay_cfg", cfg)
    monkeypatch.setattr(commitments, "compute_pot_ledger", must_not_run)
    with pytest.raises(HTTPException) as error:
        asyncio.run(allocations.list_account_plans({"email": "u"}))
    assert error.value.status_code == 503


def test_account_plans_excludes_done_goal_before_any_global_balance_lookup(monkeypatch):
    done = {"_id": "done", "user_id": "u", "name": "Finished", "status": "done", "funding_pots": [{"account_id": "saving"}]}
    monkeypatch.setattr(allocations, "allocations_col", _Collection())
    monkeypatch.setattr(allocations, "commitments_col", _Collection([done]))
    async def accounts(_): return {"saving": _accounts()["saving"]}
    async def cfg(_): return {"type": "calendar_month"}
    async def ledger(*args, **kwargs): return {"commitments": {}}
    monkeypatch.setattr(allocations, "owned_account_map", accounts)
    monkeypatch.setattr(allocations, "_pay_cfg", cfg)
    monkeypatch.setattr(commitments, "compute_pot_ledger", ledger)
    # If the terminal goal were passed through, its slice fallback could call
    # commitments._live_balance. Filtering makes both helpers unreachable.
    async def must_not_run(*args, **kwargs): raise AssertionError("terminal goal must not be scored")
    monkeypatch.setattr(commitments, "_pot_progress_and_slice", must_not_run)
    assert asyncio.run(allocations.list_account_plans({"email": "u"})) == {"items": []}
