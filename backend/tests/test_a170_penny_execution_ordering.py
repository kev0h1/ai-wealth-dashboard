"""Deterministic interleavings against two clients on the disposable test DB.

Barriers wrap real Mongo operations, never sleep or replace atomic predicates.
Executors only write synthetic effects to this same test database.
"""
import asyncio
from datetime import datetime, timedelta
import uuid

import pytest
from fastapi import HTTPException
from motor.motor_asyncio import AsyncIOMotorClient

from app.core.config import MONGO_DB, MONGO_URI
import app.routers.can_i as routes
import app.services.penny_tools as tools


class Gate:
    """Pause once immediately before/after the selected real DB operation."""
    def __init__(self, col, method, predicate, *, after=False):
        self.col, self.method, self.predicate, self.after = col, method, predicate, after
        self.entered, self.release = asyncio.Event(), asyncio.Event()
        self.used = False

    def __getattr__(self, name):
        operation = getattr(self.col, name)
        if name != self.method:
            return operation

        async def gated(*args, **kwargs):
            selected = not self.used and self.predicate(*args, **kwargs)
            if selected:
                self.used = True
                if not self.after:
                    self.entered.set()
                    await self.release.wait()
            result = await operation(*args, **kwargs)
            if selected and self.after:
                self.entered.set()
                await self.release.wait()
            return result
        return gated


def _is_claim(query, update, **kwargs):
    return "execution_claim" in update.get("$set", {})


def _is_authorisation(query, update, **kwargs):
    return "penny_execution_sequence" in update.get("$inc", {})


def _is_completion(query, update, **kwargs):
    return "executed_at" in update.get("$set", {})


@pytest.fixture
def run_case(monkeypatch):
    def run(case, generation=None):
        async def check():
            assert MONGO_DB.startswith("wealth_test_"), "Only the suite's disposable database is permitted"
            clients = [AsyncIOMotorClient(MONGO_URI, serverSelectionTimeoutMS=2000) for _ in range(2)]
            db, other_db = (client[MONGO_DB] for client in clients)
            prefs, proposals, effects = (db[f"a170_{name}"] for name in ("prefs", "proposals", "effects"))
            uid = f"a170-{uuid.uuid4().hex}"
            pid = f"{uid}-proposal"
            now = datetime.now()
            pref = {"user_id": uid, "penny_agent_consent": "original-consent"}
            if generation is not None:
                pref["penny_consent_generation"] = generation
            doc = {"_id": pid, "user_id": uid, "kind": "test_action", "params": {},
                   "created_at": now, "expires_at": now + timedelta(minutes=15),
                   "executed_at": None, "cancelled_at": None, "result": None}
            if generation is not None:
                doc["penny_consent_generation"] = generation
            await prefs.create_index("user_id", unique=True)
            await prefs.insert_one(pref)
            await proposals.insert_one(doc)
            monkeypatch.setattr(routes, "preferences_col", prefs)
            monkeypatch.setattr(routes, "penny_proposals_col", proposals)
            monkeypatch.setattr(tools, "preferences_col", other_db["a170_prefs"])
            monkeypatch.setattr(tools, "penny_proposals_col", other_db["a170_proposals"])

            async def executor(actor, params):
                assert actor == uid
                await effects.insert_one({"user_id": uid, "proposal_id": pid})
                return {"ok": True}

            monkeypatch.setattr(routes, "_PROPOSAL_EXECUTORS", {"test_action": executor})
            try:
                # Bound every barrier: a broken interleaving fails, never hangs.
                await asyncio.wait_for(case(uid, pid, prefs, proposals, effects), timeout=10)
            finally:
                for col in (prefs, proposals, effects):
                    await col.delete_many({"user_id": uid})
                for client in clients:
                    client.close()
        asyncio.run(check())
    return run


async def _expect_status(awaitable, status):
    with pytest.raises(HTTPException) as exc:
        await awaitable
    assert exc.value.status_code == status


@pytest.mark.parametrize("generation", [None, 0, 7])
def test_revoke_wins_before_proposal_claim(monkeypatch, run_case, generation):
    async def check(uid, pid, prefs, proposals, effects):
        gate = Gate(proposals, "find_one_and_update", _is_claim)
        monkeypatch.setattr(routes, "penny_proposals_col", gate)
        task = asyncio.create_task(routes.execute_proposal(pid, user={"email": uid}))
        await gate.entered.wait()
        result = await routes.revoke_agent_consent_route(user={"email": uid})
        assert result["proposals_cancelled"] == 1
        gate.release.set()
        await _expect_status(task, 410)
        assert await effects.count_documents({"user_id": uid}) == 0
    run_case(check, generation)


@pytest.mark.parametrize("regrant", [False, True])
def test_revoke_wins_after_claim_before_authorisation(monkeypatch, run_case, regrant):
    async def check(uid, pid, prefs, proposals, effects):
        gate = Gate(prefs, "find_one_and_update", _is_authorisation)
        monkeypatch.setattr(routes, "preferences_col", gate)
        task = asyncio.create_task(routes.execute_proposal(pid, user={"email": uid}))
        await gate.entered.wait()
        await routes.revoke_agent_consent_route(user={"email": uid})
        if regrant:
            # Deliberately restore the identical consent value: only the epoch
            # can distinguish this ABA from the executor's earlier snapshot.
            await prefs.update_one({"user_id": uid}, {"$set": {"penny_agent_consent": "original-consent"}})
        gate.release.set()
        await _expect_status(task, 403)
        doc = await proposals.find_one({"_id": pid})
        assert doc["cancelled_at"] and not doc["executed_at"]
        assert await effects.count_documents({"user_id": uid}) == 0
    run_case(check)


def test_authorisation_wins_before_revoke_and_finishes_once(monkeypatch, run_case):
    async def check(uid, pid, prefs, proposals, effects):
        gate = Gate(prefs, "find_one_and_update", _is_authorisation, after=True)
        monkeypatch.setattr(routes, "preferences_col", gate)
        task = asyncio.create_task(routes.execute_proposal(pid, user={"email": uid}))
        await gate.entered.wait()
        assert (await routes.revoke_agent_consent_route(user={"email": uid}))["proposals_cancelled"] == 0
        await _expect_status(routes.cancel_proposal(pid, user={"email": uid}), 409)
        gate.release.set()
        assert (await task)["replayed"] is False
        replay = await routes.execute_proposal(pid, user={"email": uid})
        assert replay["replayed"] and replay["result"] == {"ok": True}
        doc = await proposals.find_one({"_id": pid})
        assert doc["executed_at"] and not doc["cancelled_at"]
        assert await effects.count_documents({"user_id": uid}) == 1
    run_case(check, generation=7)


def test_simultaneous_confirms_only_dispatch_once(monkeypatch, run_case):
    async def check(uid, pid, prefs, proposals, effects):
        gate = Gate(proposals, "find_one_and_update", _is_claim)
        monkeypatch.setattr(routes, "penny_proposals_col", gate)
        stale = asyncio.create_task(routes.execute_proposal(pid, user={"email": uid}))
        await gate.entered.wait()
        assert (await routes.execute_proposal(pid, user={"email": uid}))["replayed"] is False
        gate.release.set()
        assert (await stale)["replayed"] is True
        assert await effects.count_documents({"user_id": uid}) == 1
    run_case(check)


def test_duplicate_while_executor_is_running_cannot_dispatch(monkeypatch, run_case):
    async def check(uid, pid, prefs, proposals, effects):
        gate = Gate(proposals, "find_one_and_update", _is_completion)
        monkeypatch.setattr(routes, "penny_proposals_col", gate)
        task = asyncio.create_task(routes.execute_proposal(pid, user={"email": uid}))
        await gate.entered.wait()
        await _expect_status(routes.execute_proposal(pid, user={"email": uid}), 409)
        gate.release.set()
        await task
        assert await effects.count_documents({"user_id": uid}) == 1
    run_case(check)


def test_expiry_between_snapshot_and_claim_prevents_dispatch(monkeypatch, run_case):
    async def check(uid, pid, prefs, proposals, effects):
        gate = Gate(proposals, "find_one_and_update", _is_claim)
        monkeypatch.setattr(routes, "penny_proposals_col", gate)
        task = asyncio.create_task(routes.execute_proposal(pid, user={"email": uid}))
        await gate.entered.wait()
        await proposals.update_one({"_id": pid}, {"$set": {"expires_at": datetime.now() - timedelta(seconds=1)}})
        gate.release.set()
        await _expect_status(task, 410)
        assert not (await proposals.find_one({"_id": pid})).get("execution_claim")
        assert await effects.count_documents({"user_id": uid}) == 0
    run_case(check)


def test_cancel_wins_before_claim(monkeypatch, run_case):
    async def check(uid, pid, prefs, proposals, effects):
        gate = Gate(proposals, "find_one_and_update", _is_claim)
        monkeypatch.setattr(routes, "penny_proposals_col", gate)
        task = asyncio.create_task(routes.execute_proposal(pid, user={"email": uid}))
        await gate.entered.wait()
        assert (await routes.cancel_proposal(pid, user={"email": uid}))["cancelled"]
        gate.release.set()
        await _expect_status(task, 410)
        assert await effects.count_documents({"user_id": uid}) == 0
    run_case(check)


@pytest.mark.parametrize("failure", ["error", "http", "cancelled", "persist"])
def test_uncertain_attempt_is_never_retried(monkeypatch, run_case, failure):
    async def check(uid, pid, prefs, proposals, effects):
        if failure == "persist":
            class FailingCompletion:
                def __getattr__(self, name):
                    return getattr(proposals, name)

                async def find_one_and_update(self, query, update, **kwargs):
                    if _is_completion(query, update):
                        raise RuntimeError("synthetic result storage failure")
                    return await proposals.find_one_and_update(query, update, **kwargs)
            monkeypatch.setattr(routes, "penny_proposals_col", FailingCompletion())
        else:
            async def partial_executor(actor, params):
                await effects.insert_one({"user_id": uid})
                if failure == "http":
                    raise HTTPException(503, "synthetic downstream failure")
                if failure == "cancelled":
                    raise asyncio.CancelledError()
                raise RuntimeError("synthetic executor failure")
            monkeypatch.setattr(routes, "_PROPOSAL_EXECUTORS", {"test_action": partial_executor})
        expected = asyncio.CancelledError if failure == "cancelled" else RuntimeError if failure == "persist" else HTTPException
        with pytest.raises(expected):
            await routes.execute_proposal(pid, user={"email": uid})
        await routes.revoke_agent_consent_route(user={"email": uid})
        await routes.grant_agent_consent(user={"email": uid})
        await _expect_status(routes.execute_proposal(pid, user={"email": uid}), 409)
        doc = await proposals.find_one({"_id": pid})
        assert doc["execution_claim"] and not doc["executed_at"] and not doc["cancelled_at"]
        assert await effects.count_documents({"user_id": uid}) == 1
    run_case(check)


def test_delayed_insert_cannot_revive_after_revoke_and_regrant(monkeypatch, run_case):
    async def check(uid, pid, prefs, proposals, effects):
        gate = Gate(proposals, "insert_one", lambda *args, **kwargs: True)
        monkeypatch.setattr(tools, "penny_proposals_col", gate)
        task = asyncio.create_task(tools._create_proposal(uid, "test_action", {}, "test", "test"))
        await gate.entered.wait()
        await routes.revoke_agent_consent_route(user={"email": uid})
        await routes.grant_agent_consent(user={"email": uid})
        gate.release.set()
        result = await task
        await _expect_status(routes.execute_proposal(result["proposal_id"], user={"email": uid}), 410)
        # A fresh proposal in the new epoch can still be executed.
        fresh = await tools._create_proposal(uid, "test_action", {}, "test", "test")
        assert (await routes.execute_proposal(fresh["proposal_id"], user={"email": uid}))["executed"]
        assert await effects.count_documents({"user_id": uid}) == 1
    run_case(check)


def test_old_revoke_cleanup_does_not_cancel_new_generation(monkeypatch, run_case):
    async def check(uid, pid, prefs, proposals, effects):
        gate = Gate(tools.penny_proposals_col, "update_many", lambda *args, **kwargs: True)
        monkeypatch.setattr(tools, "penny_proposals_col", gate)
        task = asyncio.create_task(routes.revoke_agent_consent_route(user={"email": uid}))
        await gate.entered.wait()
        await routes.grant_agent_consent(user={"email": uid})
        fresh = await tools._create_proposal(uid, "test_action", {}, "test", "test")
        gate.release.set()
        assert (await task)["proposals_cancelled"] == 1
        assert not (await proposals.find_one({"_id": fresh["proposal_id"]}))["cancelled_at"]
        assert (await routes.execute_proposal(fresh["proposal_id"], user={"email": uid}))["executed"]
    run_case(check, generation=7)


def test_removed_proposal_is_not_recreated_after_execution(monkeypatch, run_case):
    async def check(uid, pid, prefs, proposals, effects):
        gate = Gate(proposals, "find_one_and_update", _is_completion)
        monkeypatch.setattr(routes, "penny_proposals_col", gate)
        task = asyncio.create_task(routes.execute_proposal(pid, user={"email": uid}))
        await gate.entered.wait()
        await proposals.delete_one({"_id": pid})
        gate.release.set()
        await _expect_status(task, 409)
        await _expect_status(routes.execute_proposal(pid, user={"email": uid}), 404)
        assert await proposals.count_documents({"_id": pid}) == 0
        assert await effects.count_documents({"user_id": uid}) == 1
    run_case(check)
