"""A132: commitments goal-pot account lookups are scoped to the caller.

Found 2026-09-30 by the G176 review (pre-existing on main, no exploit
attempted). `_live_balance`, `_account_name` and `_pot_kind` looked accounts
up by `_id` alone, so a pot could reference, and read the balance or kind of,
an account the caller does not own. Every lookup now carries `user_id` in the
query itself. Create/update with a foreign (or missing) account is a 404 with
one shared body; a stored pot pointing at a foreign account renders as
unavailable. Fake in-memory collections, per this suite's convention.
"""
import asyncio
from datetime import date, datetime, timedelta, timezone

import pytest
from bson import ObjectId
from fastapi import HTTPException

import app.routers.commitments as commitments

UID = "owner@example.com"
OTHER = "someone-else@example.com"
FUTURE = (date.today() + timedelta(days=200)).isoformat()


def _match(doc, query):
    for k, v in query.items():
        if isinstance(v, dict) and ("$exists" in v or "$eq" in v):
            if "$exists" in v and (k in doc) != v["$exists"]:
                return False
            if "$eq" in v and doc.get(k) != v["$eq"]:
                return False
        elif doc.get(k) != v:
            return False
    return True


class _Cur:
    def __init__(self, docs): self._d = docs
    async def to_list(self, n): return list(self._d)


class _Res:
    def __init__(self, **kw): self.__dict__.update(kw)


class FakeCol:
    def __init__(self, docs=None): self.docs = list(docs or [])
    def find(self, q=None, p=None): return _Cur([d for d in self.docs if _match(d, q or {})])
    async def find_one(self, q=None, p=None):
        return next((d for d in self.docs if _match(d, q or {})), None)
    async def insert_one(self, doc):
        doc.setdefault("_id", ObjectId())
        self.docs.append(doc)
        return _Res(inserted_id=doc["_id"])
    async def update_one(self, filt, update, upsert=False):
        for d in self.docs:
            if _match(d, filt):
                d.update(update.get("$set") or {})
                return _Res(matched_count=1)
        return _Res(matched_count=0)


async def _boom(*a, **k): raise RuntimeError("not needed")


FOREIGN_CONNECTED = ObjectId()
FOREIGN_MANUAL = ObjectId()
OWN_CONNECTED = ObjectId()
OWN_MANUAL = ObjectId()
OWN_INVEST = ObjectId()


@pytest.fixture
def env(monkeypatch):
    cols = {
        "commitments_col": FakeCol(),
        "accounts_col": FakeCol([
            {"_id": OWN_CONNECTED, "user_id": UID, "name": "Own Saver", "balance": 250.0},
            {"_id": OWN_INVEST, "user_id": UID, "name": "Own ISA", "balance": 900.0, "type": "INVESTMENT"},
            {"_id": FOREIGN_CONNECTED, "user_id": OTHER, "name": "Secret Saver", "balance": 9999.0},
        ]),
        "yapily_accounts_col": FakeCol(),
        "manual_accounts_col": FakeCol([
            {"_id": OWN_MANUAL, "user_id": UID, "name": "Own Cash", "balance": 40.0},
            {"_id": FOREIGN_MANUAL, "user_id": OTHER, "name": "Secret Cash", "balance": 7777.0},
        ]),
        "preferences_col": FakeCol(),
        "savings_goals_col": FakeCol(),
    }
    for k, v in cols.items():
        monkeypatch.setattr(commitments, k, v)
    monkeypatch.setattr(commitments, "_cashflow", _boom)
    monkeypatch.setattr(commitments, "get_debt_plan_cached", _boom)
    async def noop(_): pass
    monkeypatch.setattr(commitments.response_cache, "ainvalidate", noop)
    return cols


def _create(pots):
    body = {"name": "Trip", "amount": 100, "target_date": FUTURE, "funding_pots": pots}
    return asyncio.run(commitments.create_commitment(body, user={"email": UID}))


def _seed_goal(env, pots):
    doc = {
        "_id": ObjectId(), "user_id": UID, "name": "Seeded", "amount": 100.0,
        "target_date": FUTURE, "status": "active", "contributed": 0.0,
        "created_at": datetime.now(timezone.utc), "funding_pots": pots,
    }
    env["commitments_col"].docs.append(doc)
    return doc


@pytest.mark.parametrize("foreign", [FOREIGN_CONNECTED, FOREIGN_MANUAL])
def test_create_with_foreign_account_is_404_and_stores_nothing(env, foreign):
    with pytest.raises(HTTPException) as e:
        _create([{"account_id": str(foreign)}])
    assert e.value.status_code == 404
    assert env["commitments_col"].docs == []


def test_create_missing_and_foreign_are_indistinguishable(env):
    with pytest.raises(HTTPException) as missing:
        _create([{"account_id": str(ObjectId())}])
    with pytest.raises(HTTPException) as foreign:
        _create([{"account_id": str(FOREIGN_CONNECTED)}])
    assert (missing.value.status_code, missing.value.detail) == (foreign.value.status_code, foreign.value.detail)


def test_create_foreign_count_existing_also_404(env):
    with pytest.raises(HTTPException) as e:
        _create([{"account_id": str(FOREIGN_MANUAL), "count_existing": True}])
    assert e.value.status_code == 404


def test_legacy_single_funding_account_foreign_404(env):
    body = {"name": "Trip", "amount": 100, "target_date": FUTURE,
            "funding_account_id": str(FOREIGN_CONNECTED)}
    with pytest.raises(HTTPException) as e:
        asyncio.run(commitments.create_commitment(body, user={"email": UID}))
    assert e.value.status_code == 404
    assert env["commitments_col"].docs == []


@pytest.mark.parametrize("own,kind,bal", [
    (OWN_CONNECTED, "connected", 250.0),
    (OWN_MANUAL, "manual", 40.0),
    (OWN_INVEST, "connected", 900.0),
])
def test_create_with_own_account_works(env, own, kind, bal):
    out = _create([{"account_id": str(own)}])
    pot = out["funding_pots"][0]
    assert pot["kind"] == kind
    stored = env["commitments_col"].docs[0]["funding_pots"][0]
    assert stored["baseline"] == bal and stored["kind"] == kind


def test_update_to_foreign_account_is_404_and_goal_unchanged(env):
    doc = _seed_goal(env, [{"account_id": str(OWN_CONNECTED), "kind": "connected",
                            "baseline": 10.0, "count_existing": False}])
    before = [dict(p) for p in doc["funding_pots"]]
    with pytest.raises(HTTPException) as e:
        asyncio.run(commitments.update_commitment(
            str(doc["_id"]), {"funding_pots": [{"account_id": str(FOREIGN_CONNECTED)}]},
            {"email": UID}))
    assert e.value.status_code == 404
    assert env["commitments_col"].docs[0]["funding_pots"] == before


def test_update_to_own_account_works(env):
    doc = _seed_goal(env, [])
    out = asyncio.run(commitments.update_commitment(
        str(doc["_id"]), {"funding_pots": [{"account_id": str(OWN_MANUAL)}]}, {"email": UID}))
    assert out["funding_pots"][0]["kind"] == "manual"


def test_read_of_foreign_pot_is_unavailable(env):
    doc = _seed_goal(env, [{"account_id": str(FOREIGN_CONNECTED), "kind": "connected",
                            "baseline": 0.0, "count_existing": True}])
    cfg = asyncio.run(commitments._pay_cfg(UID))
    ledger = asyncio.run(commitments.compute_pot_ledger(UID, docs=[doc]))
    out = asyncio.run(commitments._serialise(doc, cfg, ledger))
    pot = out["funding_pots"][0]
    assert pot["kind"] == "unknown"
    assert pot["name"] is None
    assert pot["contributing_balance"] == 0
    assert out["progress"] == 0
    assert ledger["accounts"][str(FOREIGN_CONNECTED)]["live"] == 0.0
    assert "9999" not in repr(out) and "Secret" not in repr(out)


def test_helpers_filter_at_query_level(env):
    assert asyncio.run(commitments._live_balance(str(FOREIGN_CONNECTED), UID)) is None
    assert asyncio.run(commitments._live_balance(str(FOREIGN_MANUAL), UID)) is None
    assert asyncio.run(commitments._pot_kind(str(FOREIGN_MANUAL), UID)) is None
    assert asyncio.run(commitments._account_name(str(FOREIGN_CONNECTED), UID)) is None
    assert asyncio.run(commitments._live_balance(str(OWN_CONNECTED), UID)) == 250.0
    assert asyncio.run(commitments._pot_kind(str(OWN_MANUAL), UID)) == "manual"
    assert asyncio.run(commitments._account_name(str(OWN_INVEST), UID)) == "Own ISA"
    # the legitimate owner of the foreign ids still reads them
    assert asyncio.run(commitments._live_balance(str(FOREIGN_CONNECTED), OTHER)) == 9999.0
