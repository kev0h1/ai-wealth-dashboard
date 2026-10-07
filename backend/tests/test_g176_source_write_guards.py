"""Regression coverage for G176's account-plan source-link write guards.

These tests deliberately use a fail-closed Motor-shaped fake.  In particular,
``$exists`` distinguishes a legacy missing key from a deliberate null, and
every ``update_one`` reports a real ``matched_count``.  That makes the tests
exercise the complete ownership plus snapshot CAS filter rather than merely
checking that a happy-path update changes an in-memory document.
"""
import asyncio
from copy import deepcopy

import pytest
from bson import ObjectId
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient

import app.routers.allocations as allocations
import app.routers.commitments as commitments
from app.core.auth import current_user


UID = "owner@example.com"
USER = {"email": UID}


def _matches(doc, query):
    """Subset of Mongo matching used by the source-link CAS filters.

    Unknown operators fail closed.  A fake which treats them as a match would
    make a missing/null snapshot regression look protected when it is not.
    """
    for key, condition in (query or {}).items():
        if key == "$and":
            if not all(_matches(doc, part) for part in condition):
                return False
            continue
        if key == "$or":
            if not any(_matches(doc, part) for part in condition):
                return False
            continue
        present = key in doc
        value = doc.get(key)
        if isinstance(condition, dict):
            supported = False
            if "$exists" in condition:
                supported = True
                if present is not bool(condition["$exists"]):
                    return False
            if "$eq" in condition:
                supported = True
                if not present or value != condition["$eq"]:
                    return False
            if "$ne" in condition:
                supported = True
                if present and value == condition["$ne"]:
                    return False
            if "$in" in condition:
                supported = True
                if value not in condition["$in"]:
                    return False
            if not supported:
                return False
        elif not present or value != condition:
            return False
    return True


class _Cursor:
    def __init__(self, docs): self.docs = docs
    async def to_list(self, _): return [deepcopy(doc) for doc in self.docs]


class _Result:
    def __init__(self, matched_count): self.matched_count = matched_count


class _CasCollection:
    def __init__(self, docs=()):
        self.docs = [deepcopy(doc) for doc in docs]
        self.writes = []

    def find(self, query=None, *args, **kwargs):
        return _Cursor([doc for doc in self.docs if _matches(doc, query or {})])

    async def find_one(self, query=None, *args, **kwargs):
        return next((doc for doc in self.docs if _matches(doc, query or {})), None)

    async def update_one(self, query, update, *args, **kwargs):
        self.writes.append((deepcopy(query), deepcopy(update)))
        doc = next((doc for doc in self.docs if _matches(doc, query)), None)
        if doc is None:
            return _Result(0)
        doc.update(update.get("$set", {}))
        return _Result(1)


class _RaceCollection(_CasCollection):
    """Return an owned stale read, then mutate/remove the stored document."""
    def __init__(self, docs, mutate):
        super().__init__(docs)
        self._mutate = mutate
        self._read_once = False

    async def find_one(self, query=None, *args, **kwargs):
        doc = await super().find_one(query, *args, **kwargs)
        if doc is not None and not self._read_once:
            self._read_once = True
            snapshot = deepcopy(doc)
            self._mutate(self.docs[0])
            return snapshot
        return doc


async def _cache_spy(calls, uid): calls.append(uid)


def _allocation(oid=None, **extra):
    return {
        "_id": oid or ObjectId(), "user_id": UID, "name": "Rainy day",
        "amount_per_period": 20.0, "fill_account_id": "saving",
        "match_type": "description_contains", "match_value": "salary",
        "active": True, "recurrence": "every_period", **extra,
    }


def _goal(oid=None, **extra):
    return {
        "_id": oid or ObjectId(), "user_id": UID, "name": "Holiday",
        "amount": 500.0, "status": "active",
        "funding_pots": [{"account_id": "saving", "baseline": 0, "count_existing": False}],
        "funding_account_id": "saving", **extra,
    }


def _source_accounts():
    return {
        "current": {"_id": "current", "type": "bank", "subtype": "CURRENT_ACCOUNT", "currency": "GBP"},
        "saving": {"_id": "saving", "type": "bank", "subtype": "SAVINGS_ACCOUNT", "currency": "GBP"},
        "other": {"_id": "other", "type": "bank", "subtype": "SAVINGS_ACCOUNT", "currency": "GBP"},
    }


def _setup_allocation(monkeypatch, col):
    calls = []
    monkeypatch.setattr(allocations, "allocations_col", col)
    monkeypatch.setattr(allocations.response_cache, "ainvalidate", lambda uid: _cache_spy(calls, uid))
    async def accounts(_): return _source_accounts()
    async def owned(*_): return True
    async def conflicts(*_, **__): return False
    async def cfg(_): return {"type": "calendar_month"}
    async def serial(doc, *_): return deepcopy(doc)
    monkeypatch.setattr(allocations, "owned_account_map", accounts)
    monkeypatch.setattr(allocations, "_account_owned", owned)
    monkeypatch.setattr(allocations, "_conflicts", conflicts)
    monkeypatch.setattr(allocations, "_pay_cfg", cfg)
    monkeypatch.setattr(allocations, "_serialise", serial)
    return calls


def _setup_goal(monkeypatch, col):
    calls = []
    monkeypatch.setattr(commitments, "commitments_col", col)
    monkeypatch.setattr(commitments.response_cache, "ainvalidate", lambda uid: _cache_spy(calls, uid))
    async def accounts(_): return _source_accounts()
    async def pots(raw):
        return [{"account_id": str(p["account_id"]), "baseline": 0, "count_existing": False} for p in raw]
    async def serial(_, doc): return deepcopy(doc)
    monkeypatch.setattr(commitments, "owned_account_map", accounts)
    monkeypatch.setattr(commitments, "_build_pots", pots)
    monkeypatch.setattr(commitments, "_serialise_one_with_siblings", serial)
    return calls


def test_allocation_source_only_write_scopes_owner_and_cas_snapshots(monkeypatch):
    doc = _allocation(source_account_id="current")
    col = _CasCollection([doc])
    calls = _setup_allocation(monkeypatch, col)

    result = asyncio.run(allocations.update_allocation(str(doc["_id"]), {"source_account_id": "other"}, USER))

    assert result["source_account_id"] == "other"
    assert {key: value for key, value in col.docs[0].items() if key != "source_account_id"} == {
        key: value for key, value in doc.items() if key != "source_account_id"
    }
    assert col.writes[0][0]["_id"] == doc["_id"]
    assert col.writes[0][0]["user_id"] == UID
    assert col.writes[0][0]["fill_account_id"] == "saving"
    assert col.writes[0][0]["source_account_id"] == "current"
    assert calls == [UID]


@pytest.mark.parametrize("old_source,expected", [("missing", {"$exists": False}), (None, {"$eq": None, "$exists": True})])
def test_allocation_cas_distinguishes_missing_and_explicit_null_source(monkeypatch, old_source, expected):
    extra = {} if old_source == "missing" else {"source_account_id": old_source}
    doc = _allocation(**extra)
    col = _CasCollection([doc])
    _setup_allocation(monkeypatch, col)
    asyncio.run(allocations.update_allocation(str(doc["_id"]), {"source_account_id": "current"}, USER))
    assert col.writes[0][0]["source_account_id"] == expected


def test_allocation_foreign_id_and_invalid_combined_relink_are_atomic(monkeypatch):
    foreign = _allocation(user_id="attacker@example.com")
    own = _allocation()
    col = _CasCollection([foreign, own])
    _setup_allocation(monkeypatch, col)
    with pytest.raises(HTTPException) as exc:
        asyncio.run(allocations.update_allocation(str(foreign["_id"]), {"source_account_id": "current"}, USER))
    assert exc.value.status_code == 404
    with pytest.raises(HTTPException):
        asyncio.run(allocations.update_allocation(str(own["_id"]), {"fill_account_id": "current", "source_account_id": "current"}, USER))
    assert col.writes == []
    assert own["fill_account_id"] == "saving"


def test_allocation_valid_combined_edit_keeps_recognised_fields_and_drops_attacker_fields(monkeypatch):
    doc = _allocation(source_account_id="current")
    col = _CasCollection([doc])
    _setup_allocation(monkeypatch, col)
    asyncio.run(allocations.update_allocation(str(doc["_id"]), {
        "amount_per_period": 45, "fill_account_id": "other", "source_account_id": "current",
        "_id": ObjectId(), "user_id": "attacker", "amount": 0, "remaining": 0, "unrecognised": "nope",
    }, USER))
    stored = col.docs[0]
    assert stored["amount_per_period"] == 45.0
    assert stored["fill_account_id"] == "other"
    assert stored["source_account_id"] == "current"
    assert "unrecognised" not in stored and stored["user_id"] == UID
    assert "amount" not in stored and "remaining" not in stored


@pytest.mark.parametrize("mutation", [
    lambda doc: doc.update(fill_account_id="other"),
    lambda doc: doc.update(source_account_id="other"),
    lambda doc: doc.update(user_id="attacker@example.com"),
    lambda doc: doc.clear(),
])
def test_allocation_concurrent_destination_source_owner_or_delete_conflict_has_no_cache_invalidation(monkeypatch, mutation):
    doc = _allocation(source_account_id="current")
    col = _RaceCollection([doc], mutation)
    calls = _setup_allocation(monkeypatch, col)
    with pytest.raises(HTTPException) as exc:
        asyncio.run(allocations.update_allocation(str(doc["_id"]), {"source_account_id": "other"}, USER))
    assert exc.value.status_code == 409
    assert calls == []
    assert len(col.writes) == 1


def test_goal_source_only_write_cas_includes_pots_legacy_source_and_status(monkeypatch):
    doc = _goal(source_account_id="current")
    col = _CasCollection([doc])
    calls = _setup_goal(monkeypatch, col)
    asyncio.run(commitments.update_commitment(str(doc["_id"]), {"source_account_id": "other"}, USER))
    filt = col.writes[0][0]
    assert filt["_id"] == doc["_id"] and filt["user_id"] == UID
    assert filt["funding_pots"] == doc["funding_pots"]
    assert filt["funding_account_id"] == "saving"
    assert filt["source_account_id"] == "current"
    assert filt["status"] == "active"
    assert {key: value for key, value in col.docs[0].items() if key not in ("source_account_id", "source_unset")} == {
        key: value for key, value in doc.items() if key != "source_account_id"
    }
    assert calls == [UID]


@pytest.mark.parametrize("legacy_value,expected", [
    ("missing", {"$exists": False}), (None, {"$eq": None, "$exists": True}),
])
def test_goal_cas_preserves_legacy_missing_and_null_mirrors(monkeypatch, legacy_value, expected):
    doc = _goal(**({} if legacy_value == "missing" else {"funding_account_id": legacy_value}))
    if legacy_value == "missing":
        doc.pop("funding_account_id")
    col = _CasCollection([doc])
    _setup_goal(monkeypatch, col)
    asyncio.run(commitments.update_commitment(str(doc["_id"]), {"source_account_id": "current"}, USER))
    assert col.writes[0][0]["funding_account_id"] == expected


@pytest.mark.parametrize("status", ["done", "cancelled"])
@pytest.mark.parametrize("body", [
    {"source_account_id": "current"},
    {"status": "done", "source_account_id": "current"},
])
def test_goal_source_edit_is_refused_for_terminal_or_combined_terminal_status(monkeypatch, status, body):
    doc = _goal(status=status)
    col = _CasCollection([doc])
    _setup_goal(monkeypatch, col)
    with pytest.raises(HTTPException) as exc:
        asyncio.run(commitments.update_commitment(str(doc["_id"]), body, USER))
    assert exc.value.status_code == 409
    assert col.writes == []


def test_goal_foreign_record_and_self_destination_combined_edits_fail_without_write(monkeypatch):
    foreign = _goal(user_id="attacker@example.com")
    own = _goal(source_account_id="current")
    col = _CasCollection([foreign, own])
    _setup_goal(monkeypatch, col)
    with pytest.raises(HTTPException) as exc:
        asyncio.run(commitments.update_commitment(str(foreign["_id"]), {"source_account_id": "current"}, USER))
    assert exc.value.status_code == 404
    with pytest.raises(HTTPException):
        asyncio.run(commitments.update_commitment(str(own["_id"]), {"funding_pots": [{"account_id": "current"}], "source_account_id": "current"}, USER))
    assert col.writes == []


def test_goal_valid_combined_pot_source_edit_retains_fields_not_attacker_payload(monkeypatch):
    doc = _goal(source_account_id="current")
    col = _CasCollection([doc])
    _setup_goal(monkeypatch, col)
    asyncio.run(commitments.update_commitment(str(doc["_id"]), {
        "amount": 600, "funding_pots": [{"account_id": "other"}], "source_account_id": "current",
        "_id": ObjectId(), "user_id": "attacker", "progress": 500, "remaining": 0, "fill_account_id": "attacker", "unknown": True,
    }, USER))
    stored = col.docs[0]
    assert stored["amount"] == 600.0
    assert stored["funding_pots"][0]["account_id"] == "other"
    assert stored["funding_account_id"] == "other" and stored["source_account_id"] == "current"
    assert stored["user_id"] == UID and "unknown" not in stored and "progress" not in stored
    assert "remaining" not in stored and "fill_account_id" not in stored


@pytest.mark.parametrize("mutation", [
    lambda doc: doc.update(funding_pots=[{"account_id": "other", "baseline": 0, "count_existing": False}]),
    lambda doc: doc.update(funding_account_id="other"),
    lambda doc: doc.update(source_account_id="other"),
    lambda doc: doc.update(status="done"),
    lambda doc: doc.update(user_id="attacker@example.com"),
    lambda doc: doc.clear(),
])
def test_goal_concurrent_snapshot_change_conflicts_without_second_write_or_cache(monkeypatch, mutation):
    doc = _goal(source_account_id="current")
    col = _RaceCollection([doc], mutation)
    calls = _setup_goal(monkeypatch, col)
    with pytest.raises(HTTPException) as exc:
        asyncio.run(commitments.update_commitment(str(doc["_id"]), {"source_account_id": "other"}, USER))
    assert exc.value.status_code == 409
    assert len(col.writes) == 1 and calls == []


@pytest.mark.parametrize("before,after", [
    ({}, {"source_account_id": None}),
    ({"source_account_id": None}, {}),
    ({"source_account_id": "current"}, {"source_account_id": "other"}),
])
def test_allocation_source_presence_races_are_cas_conflicts(monkeypatch, before, after):
    doc = _allocation(**before)
    def mutate(stored):
        stored.pop("source_account_id", None)
        stored.update(after)
    col = _RaceCollection([doc], mutate)
    calls = _setup_allocation(monkeypatch, col)
    with pytest.raises(HTTPException) as exc:
        asyncio.run(allocations.update_allocation(str(doc["_id"]), {"source_account_id": "current"}, USER))
    assert exc.value.status_code == 409 and calls == [] and len(col.writes) == 1


def test_destination_change_racing_source_selection_is_cas_conflict(monkeypatch):
    doc = _allocation()  # legacy missing source
    col = _RaceCollection([doc], lambda stored: stored.update(source_account_id="current"))
    calls = _setup_allocation(monkeypatch, col)
    with pytest.raises(HTTPException) as exc:
        asyncio.run(allocations.update_allocation(str(doc["_id"]), {"fill_account_id": "other"}, USER))
    assert exc.value.status_code == 409 and calls == [] and len(col.writes) == 1


def test_goal_destination_change_racing_source_selection_is_cas_conflict(monkeypatch):
    doc = _goal()  # legacy missing source
    col = _RaceCollection([doc], lambda stored: stored.update(source_account_id="current"))
    calls = _setup_goal(monkeypatch, col)
    with pytest.raises(HTTPException) as exc:
        asyncio.run(commitments.update_commitment(
            str(doc["_id"]), {"funding_pots": [{"account_id": "other"}]}, USER,
        ))
    assert exc.value.status_code == 409 and calls == [] and len(col.writes) == 1


def test_goal_legacy_single_pot_and_statusless_source_edit_remains_valid(monkeypatch):
    doc = _goal()
    doc.pop("funding_pots")
    doc.pop("status")
    col = _CasCollection([doc])
    _setup_goal(monkeypatch, col)
    asyncio.run(commitments.update_commitment(str(doc["_id"]), {"source_account_id": "current"}, USER))
    filt = col.writes[0][0]
    assert filt["funding_pots"] == {"$exists": False}
    assert filt["funding_account_id"] == "saving"
    assert filt["status"] == {"$exists": False}
    assert col.docs[0]["source_account_id"] == "current"


def test_goal_combined_active_to_done_and_source_edit_is_atomic_409(monkeypatch):
    doc = _goal(status="active")
    col = _CasCollection([doc])
    _setup_goal(monkeypatch, col)
    with pytest.raises(HTTPException) as exc:
        asyncio.run(commitments.update_commitment(str(doc["_id"]), {"status": "done", "source_account_id": "current"}, USER))
    assert exc.value.status_code == 409 and col.writes == [] and col.docs[0]["status"] == "active"


@pytest.mark.parametrize("path,patch_target", [
    ("/account-plans", (allocations, "owned_account_map")),
    ("/allocations/000000000000000000000001", (allocations, "owned_account_map")),
    ("/commitments/000000000000000000000001", (commitments, "owned_account_map")),
])
def test_account_plan_and_source_patch_raw_exceptions_do_not_leak(monkeypatch, path, patch_target):
    module, name = patch_target
    async def explode(*args, **kwargs): raise RuntimeError("database password: should never reach the client")
    monkeypatch.setattr(module, name, explode)
    if path.startswith("/allocations/"):
        async def owned(*args, **kwargs): return _allocation(ObjectId("000000000000000000000001"))
        monkeypatch.setattr(allocations, "_get_owned", owned)
    if path.startswith("/commitments/"):
        async def owned(*args, **kwargs): return _goal(ObjectId("000000000000000000000001"))
        monkeypatch.setattr(commitments, "_get_owned", owned)
    app = FastAPI(debug=False)
    app.include_router(allocations.router)
    app.include_router(commitments.router)
    app.dependency_overrides[current_user] = lambda: USER
    client = TestClient(app, raise_server_exceptions=False)
    response = client.get(path) if path == "/account-plans" else client.patch(path, json={"source_account_id": "current"})
    assert response.status_code == 500
    assert "database password" not in response.text
