"""Unit test for app.routers.admin_usage's `GET /admin/sync-stats`
(A106): calls the router function directly with a plain dict standing in
for the `current_user` dependency, the same convention
tests/test_admin_llm_usage.py documents and uses — no HTTP client, no real
Mongo.

This file only exercises the A106 addition (the `orphaned_revocations`
pending count); `last_reconcile` and `finexer_requests` are left at their
simplest possible fakes since they're not what this test is proving.
"""
import asyncio

import app.routers.admin_usage as admin_usage
from app.routers.admin_usage import admin_sync_stats


class _FakeWorkerRunsCol:
    """Only find_one is used by admin_sync_stats, for `last_reconcile`."""

    async def find_one(self, filt):
        return None


class _FakeCursor:
    def __init__(self, docs):
        self._docs = docs

    def __aiter__(self):
        return self._gen()

    async def _gen(self):
        for d in self._docs:
            yield d


class _FakeFinexerConsentsCol:
    """Only find(...) is used by admin_sync_stats, for `finexer_requests`."""

    def __init__(self, docs=None):
        self.docs = docs or []

    def find(self, filt, proj=None):
        return _FakeCursor(self.docs)


class _FakeOrphanedRevocationsCol:
    def __init__(self, count: int):
        self._count = count

    async def count_documents(self, filt):
        return self._count


def test_admin_sync_stats_reports_pending_orphaned_revocations(monkeypatch):
    monkeypatch.setattr(admin_usage, "worker_runs_col", _FakeWorkerRunsCol())
    monkeypatch.setattr(admin_usage, "finexer_consents_col", _FakeFinexerConsentsCol())
    monkeypatch.setattr(admin_usage, "orphaned_revocations_col", _FakeOrphanedRevocationsCol(2))

    result = asyncio.run(admin_sync_stats(user={"name": "Bot"}))

    assert result["orphaned_revocations"] == {"pending": 2}


def test_admin_sync_stats_reports_zero_when_no_markers_pending(monkeypatch):
    monkeypatch.setattr(admin_usage, "worker_runs_col", _FakeWorkerRunsCol())
    monkeypatch.setattr(admin_usage, "finexer_consents_col", _FakeFinexerConsentsCol())
    monkeypatch.setattr(admin_usage, "orphaned_revocations_col", _FakeOrphanedRevocationsCol(0))

    result = asyncio.run(admin_sync_stats(user={"name": "Bot"}))

    assert result["orphaned_revocations"] == {"pending": 0}
