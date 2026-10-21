"""G291 goal editing keeps the financial contract intact."""
import asyncio
from datetime import date, datetime, timedelta, timezone
from types import SimpleNamespace

import pytest
from bson import ObjectId
from fastapi import HTTPException

import app.routers.commitments as commitments


UID = "g291@example.com"
TODAY = date(2026, 10, 12)


class _Cursor:
    def __init__(self, docs): self.docs = docs
    async def to_list(self, _): return [dict(doc) for doc in self.docs]


class _Collection:
    def __init__(self, docs=()): self.docs = list(docs); self.writes = []
    def find(self, query, *_):
        def match(doc):
            for key, wanted in query.items():
                if isinstance(wanted, dict) and "$ne" in wanted:
                    if doc.get(key) == wanted["$ne"]: return False
                elif doc.get(key) != wanted:
                    return False
            return True
        return _Cursor([doc for doc in self.docs if match(doc)])
    async def find_one(self, query, *_):
        return next((dict(doc) for doc in self.find(query).docs), None)
    async def update_one(self, query, update):
        for doc in self.docs:
            if doc.get("_id") == query.get("_id") and doc.get("user_id") == query.get("user_id"):
                self.writes.append((query, update))
                doc.update(update.get("$set", {}))
                return SimpleNamespace(matched_count=1)
        return SimpleNamespace(matched_count=0)


def _goal(**extra):
    return {
        "_id": ObjectId(), "user_id": UID, "name": "Japan", "status": "active",
        "amount": 1000.0, "target_date": "2027-10-01", "contributed": 175.0,
        "created_at": datetime(2026, 1, 1, tzinfo=timezone.utc),
        "funding_pots": [{"account_id": "pot", "kind": "connected", "baseline": 100.0, "count_existing": False}],
        "source_account_id": "current", **extra,
    }


@pytest.fixture
def env(monkeypatch):
    col = _Collection()
    monkeypatch.setattr(commitments, "commitments_col", col)
    async def cfg(_): return {"type": "calendar_month"}
    async def no_debt(_): return None
    async def feasibility(_): return None
    async def balance(account, _): return {"pot": 360.0}.get(account)
    async def kind(*_): return "connected"
    async def invalidate(_): return None
    monkeypatch.setattr(commitments, "_pay_cfg", cfg)
    monkeypatch.setattr(commitments, "_debt_ctx", no_debt)
    monkeypatch.setattr(commitments, "_feasibility_ctx", feasibility)
    monkeypatch.setattr(commitments, "_live_balance", balance)
    monkeypatch.setattr(commitments, "_pot_kind", kind)
    monkeypatch.setattr(commitments.response_cache, "ainvalidate", invalidate)
    monkeypatch.setattr(commitments.timeutil, "user_today", lambda: TODAY)
    return col


def test_preview_date_edit_keeps_existing_baseline_and_manual_contribution(env, monkeypatch):
    goal = _goal()
    env.docs.append(goal)
    seen = {}
    async def ledger(_uid, docs):
        draft = next(doc for doc in docs if str(doc["_id"]) == str(goal["_id"]))
        seen["draft"] = draft
        return {"commitments": {str(draft["_id"]): {"total_claimed": 260.0, "claims": {"pot": 260.0}}},
                "accounts": {"pot": {"free": 0.0, "claimed_by": []}}}
    monkeypatch.setattr(commitments, "compute_pot_ledger", ledger)
    out = asyncio.run(commitments.preview_commitment({
        "commitment_id": str(goal["_id"]), "amount": 1000, "target_date": "2028-01-01",
    }, {"email": UID}))
    assert seen["draft"]["funding_pots"][0]["baseline"] == 100.0
    assert seen["draft"]["contributed"] == 175.0
    assert out["starting_progress"] == 435.0


def test_paused_goal_stops_slice_but_keeps_progress_and_ledger_claim(env):
    goal = _goal(paused=True)
    ledger = {"commitments": {str(goal["_id"]): {"total_claimed": 260.0, "claims": {"pot": 260.0}}}}
    info = asyncio.run(commitments._pot_progress_and_slice(goal, {"type": "calendar_month"}, ledger, TODAY))
    assert info["progress"] == 435.0
    assert info["per_period_slice"] == 0
    assert info["planned_per_period_slice"] > 0
    assert ledger["commitments"][str(goal["_id"])]["claims"]["pot"] == 260.0


def test_pause_update_is_strict_boolean_and_terminal_goals_cannot_resume(env, monkeypatch):
    active = _goal()
    done = _goal(status="done", paused=True)
    env.docs.extend([active, done])
    async def serial(_uid, doc): return doc
    monkeypatch.setattr(commitments, "_serialise_one_with_siblings", serial)
    with pytest.raises(HTTPException) as bad:
        asyncio.run(commitments.update_commitment(str(active["_id"]), {"paused": 1}, {"email": UID}))
    assert bad.value.status_code == 400
    with pytest.raises(HTTPException) as terminal:
        asyncio.run(commitments.update_commitment(str(done["_id"]), {"paused": False}, {"email": UID}))
    assert terminal.value.status_code == 409
    out = asyncio.run(commitments.update_commitment(str(active["_id"]), {"paused": True}, {"email": UID}))
    assert out["paused"] is True and env.docs[0]["status"] == "active"


def test_terminal_status_guard_remains_strict():
    with pytest.raises(HTTPException) as error:
        commitments._check_status_transition("done", "active")
    assert error.value.status_code == 409


def test_goal_create_persists_category_mode_and_refuses_dual_payment_mode(env, monkeypatch):
    class _CreateCollection(_Collection):
        async def insert_one(self, doc):
            doc.setdefault("_id", ObjectId())
            self.docs.append(dict(doc))
            return SimpleNamespace(inserted_id=doc["_id"])

    store = _CreateCollection()
    monkeypatch.setattr(commitments, "commitments_col", store)
    async def pots(raw, _):
        assert raw == [{"account_id": "pot"}]
        return [{"account_id": "pot", "kind": "connected", "baseline": 0, "count_existing": False}]
    async def accounts(_):
        return {"current": {"currency": "GBP", "type": "CURRENT", "subtype": "CURRENT_ACCOUNT"}}
    async def tracking(raw, _):
        assert raw == {"category": "Groceries"}
        return {"category": "Groceries"}
    async def serial(_, doc): return doc
    async def invalidate(_): return None
    monkeypatch.setattr(commitments, "_build_pots", pots)
    monkeypatch.setattr(commitments, "owned_account_map", accounts)
    monkeypatch.setattr(commitments.plan_tracking, "validate_tracking", tracking)
    monkeypatch.setattr(commitments, "_serialise_one_with_siblings", serial)
    monkeypatch.setattr(commitments.response_cache, "ainvalidate", invalidate)
    body = {
        "name": "Japan", "amount": 2000, "target_date": "2028-01-01",
        "funding_pots": [{"account_id": "pot"}], "source_account_id": "current",
        "category_tracking": {"category": "Groceries"},
    }
    out = asyncio.run(commitments.create_commitment(body, user={"email": UID}))
    assert out["category_tracking"] == {"category": "Groceries"}
    assert store.docs[0]["category_tracking"] == {"category": "Groceries"}
    with pytest.raises(HTTPException) as dual:
        asyncio.run(commitments.create_commitment({**body, "name": "Japan travel", "fill_rule": {"match_type": "description_contains", "match_value": "Japan"}}, user={"email": UID}))
    assert dual.value.status_code == 400 and len(store.docs) == 1


def test_goal_update_persists_category_and_payment_rule_clears_it(env, monkeypatch):
    goal = _goal()
    env.docs.append(goal)
    async def tracking(raw, _):
        return {"category": raw["category"]} if raw is not None else None
    async def serial(_, doc): return doc
    monkeypatch.setattr(commitments.plan_tracking, "validate_tracking", tracking)
    monkeypatch.setattr(commitments, "_serialise_one_with_siblings", serial)
    saved = asyncio.run(commitments.update_commitment(
        str(goal["_id"]), {"category_tracking": {"category": "Groceries"}}, {"email": UID}
    ))
    assert saved["category_tracking"] == {"category": "Groceries"}
    payment = asyncio.run(commitments.update_commitment(
        str(goal["_id"]), {"fill_rule": {"match_type": "description_contains", "match_value": "Japan"}}, {"email": UID}
    ))
    assert payment["category_tracking"] is None
