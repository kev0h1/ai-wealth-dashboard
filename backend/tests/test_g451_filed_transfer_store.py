"""G451 stored-history contracts: no request-time matching or money work."""
import asyncio
from copy import deepcopy
from datetime import date
from types import SimpleNamespace
from unittest.mock import AsyncMock

from app.services import filed_transfers as history, transfer_review_store


class Cursor:
    def __init__(self, rows): self.rows = rows
    async def to_list(self, _): return list(self.rows)


class Store:
    def __init__(self, rows=()): self.rows = {row["_id"]: dict(row) for row in rows}; self.calls = []
    async def find_one(self, query, *_args):
        self.calls.append(("find_one", query))
        return deepcopy(self.rows.get(query.get("_id")))
    def find(self, query, *_args):
        return Cursor([row for row in self.rows.values() if all(row.get(k) == v for k, v in query.items())])
    async def update_one(self, query, update, upsert=False):
        self.calls.append(("update_one", query, update, upsert))
        row = self.rows.get(query.get("_id"))
        if row is None and upsert:
            row = {"_id": query["_id"]}; self.rows[row["_id"]] = row
        if row is not None and all(row.get(k) == v for k, v in query.items() if k != "_id"):
            row.update(update.get("$setOnInsert", {}) if len(row) == 1 else {})
            row.update(update.get("$set", {}))
            for key, value in update.get("$inc", {}).items(): row[key] = row.get(key, 0) + value
            return SimpleNamespace(matched_count=1)
        return SimpleNamespace(matched_count=0)
    async def update_many(self, query, update):
        self.calls.append(("update_many", query, update))
        for row in self.rows.values():
            if all(row.get(k) == v for k, v in query.items()):
                row.update(update.get("$set", {}))
                for key, value in update.get("$inc", {}).items(): row[key] = row.get(key, 0) + value


def run(coro): return asyncio.run(coro)


def saved(uid="u", scope="all::all", *, stale=False):
    return {"_id": f"{uid}::filed-transfers::{scope}", "user_id": uid, "scope_key": scope,
            "shape": history._STORE_SHAPE, "generation": 0, "stale": stale,
            "state": {"items": [{"series_key": "sorted:one", "actor": "sorted", "can_undo": True}],
                      "scope_total": 12, "scope_currency": "GBP", "scope": None, "complete": True,
                      "updated_at": "2026-01-01T00:00:00+00:00"}}


def test_get_reads_only_saved_state_and_never_builds(monkeypatch):
    store = Store([saved()]); monkeypatch.setattr(history, "filed_transfer_store_col", store)
    monkeypatch.setattr(history, "_build_filed_transfers", lambda *_a, **_k: (_ for _ in ()).throw(AssertionError("GET built")))
    out = run(history.list_filed_transfers("u"))
    assert out["status"] == "ready" and out["total_series"] == 1
    assert [call[0] for call in store.calls] == ["find_one"]


def test_missing_scope_prepares_with_no_definitive_zero(monkeypatch):
    monkeypatch.setattr(history, "filed_transfer_store_col", Store())
    queued = []; monkeypatch.setattr(history, "refresh_filed_transfers_soon", lambda *a, **k: queued.append((a, k)))
    out = run(history.list_filed_transfers("u", start=date(2026, 1, 1), end=date(2026, 1, 31)))
    assert out["status"] == "preparing" and out["total_series"] is None and out["scope_total"] is None
    assert queued and queued[0][1]["start"] == date(2026, 1, 1)


def test_stale_keeps_evidence_but_disables_undo(monkeypatch):
    monkeypatch.setattr(history, "filed_transfer_store_col", Store([saved(stale=True)]))
    queued = []; monkeypatch.setattr(history, "refresh_filed_transfers_soon", lambda *a, **k: queued.append(1))
    out = run(history.list_filed_transfers("u"))
    assert out["status"] == "stale" and not out["items"][0]["can_undo"] and queued


def test_mark_stale_queues_every_saved_scope(monkeypatch):
    period = saved(scope="2026-01-01::2026-01-31")
    store = Store([saved(), period]); monkeypatch.setattr(history, "filed_transfer_store_col", store)
    queued = []; monkeypatch.setattr(history, "refresh_filed_transfers_soon", lambda uid, **scope: queued.append(scope))
    run(history.mark_filed_transfers_stale("u"))
    assert len(queued) == 2 and all(row["stale"] and row["generation"] == 1 for row in store.rows.values())


def test_first_build_invalidated_during_read_never_publishes_old_inputs(monkeypatch):
    store = Store()
    monkeypatch.setattr(history, "filed_transfer_store_col", store)
    monkeypatch.setattr(history, "refresh_filed_transfers_soon", lambda *_a, **_k: None)
    builds = []
    async def build(uid, **_scope):
        builds.append(uid)
        assert store.rows, "The sentinel must exist before reading the inputs"
        if len(builds) == 1:
            await history.mark_filed_transfers_stale(uid)
        return {"items": [], "scope_total": len(builds)}
    monkeypatch.setattr(history, "_build_filed_transfers", build)
    async def scenario():
        await history.refresh_filed_transfers("u")
        doc = store.rows[history._store_id("u", None, None)]
        assert doc["stale"] and "state" not in doc and doc["generation"] == 1
        await history.refresh_filed_transfers("u")
        assert not doc["stale"] and doc["state"]["scope_total"] == 2
    run(scenario())


def test_invalidation_between_generation_read_and_save_is_guarded(monkeypatch):
    class ConcurrentStore(Store):
        async def update_one(self, query, update, upsert=False):
            if "state" in update.get("$set", {}):
                row = self.rows[query["_id"]]
                row["generation"] += 1
                row["stale"] = True
            return await super().update_one(query, update, upsert)
    store = ConcurrentStore([saved()])
    monkeypatch.setattr(history, "filed_transfer_store_col", store)
    monkeypatch.setattr(history, "_build_filed_transfers", AsyncMock(return_value={"items": [], "scope_total": 999}))
    run(history.refresh_filed_transfers("u"))
    doc = store.rows[history._store_id("u", None, None)]
    assert doc["stale"] and doc["generation"] == 1 and doc["state"]["scope_total"] == 12


def test_change_during_inflight_refresh_runs_one_more_build(monkeypatch):
    store = Store()
    monkeypatch.setattr(history, "filed_transfer_store_col", store)
    async def scenario():
        entered, release, rebuilt = asyncio.Event(), asyncio.Event(), asyncio.Event()
        calls = []
        async def build(_uid, **_scope):
            calls.append(1)
            if len(calls) == 1:
                entered.set()
                await release.wait()
            else:
                rebuilt.set()
            return {"items": [], "scope_total": len(calls)}
        monkeypatch.setattr(history, "_build_filed_transfers", build)
        history.refresh_filed_transfers_soon("inflight-user")
        await asyncio.wait_for(entered.wait(), 1)
        await history.mark_filed_transfers_stale("inflight-user")
        release.set()
        await asyncio.wait_for(rebuilt.wait(), 1)
        await asyncio.sleep(0)
        doc = store.rows[history._store_id("inflight-user", None, None)]
        assert not doc["stale"] and doc["generation"] == 1 and doc["state"]["scope_total"] == 2
        assert history._store_id("inflight-user", None, None) not in history._refreshing
    run(scenario())


def test_background_store_failure_is_contained(monkeypatch, caplog):
    store = Store()
    monkeypatch.setattr(store, "update_one", AsyncMock(side_effect=RuntimeError("store unavailable")))
    monkeypatch.setattr(history, "filed_transfer_store_col", store)
    run(history.refresh_filed_transfers("u"))
    assert "filed transfer history refresh failed" in caplog.text


def test_review_decision_invalidates_history_before_it_returns(monkeypatch):
    monkeypatch.setattr(transfer_review_store, "transfer_review_store_col", Store())
    stale = AsyncMock()
    monkeypatch.setattr(history, "mark_filed_transfers_stale", stale)
    run(transfer_review_store.mark_stale("confirmed-user"))
    stale.assert_awaited_once_with("confirmed-user")
