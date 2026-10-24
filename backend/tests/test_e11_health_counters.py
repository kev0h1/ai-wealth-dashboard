"""E11: /ops/health Finexer block carries the user and history sync counters."""
import asyncio
from datetime import datetime

from app.services import finexer_webhooks as fxw
from tests.test_finexer_webhook_a167 import _Col


class _EmptyCur:
    def sort(self, *_a):
        return self

    def limit(self, _n):
        return self

    def __aiter__(self):
        async def g():
            return
            yield
        return g()


def test_health_reads_user_and_history_counters(monkeypatch):
    now = datetime(2026, 10, 24, 12, 0, 0)
    consents = _Col([])
    consents.find = lambda q, p=None: _EmptyCur()
    runs = _Col([
        {"_id": "finexer_api_calls:2026-10-24", "user_syncs": 4, "history_syncs": 1},
        {"_id": "finexer_api_calls:2026-10-23", "user_syncs": 7},
    ])
    import app.db.collections as colls
    monkeypatch.setattr(colls, "finexer_consents_col", consents)
    monkeypatch.setattr(colls, "worker_runs_col", runs)
    h = asyncio.run(fxw.webhook_health(now))
    assert (h["user_syncs_today"], h["history_syncs_today"]) == (4, 1)
    assert (h["user_syncs_yesterday"], h["history_syncs_yesterday"]) == (7, 0)
