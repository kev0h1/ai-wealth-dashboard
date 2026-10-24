"""E11: POST /accounts/sync-history for Finexer users. Fakes only."""
import asyncio

import app.routers.accounts as accounts_router
from tests.test_refresh_recompute import FakeCol, _patch_sync_all, _fresh_cashflow_doc, UID


def _run():
    async def go():
        res = await accounts_router.sync_history(user={"email": UID})
        pending = list(accounts_router._background_tasks)
        if pending:
            await asyncio.gather(*pending)
        return res
    return asyncio.run(go())


def _setup(monkeypatch, *, tl, fx):
    from app.core.build import engine_build
    col = FakeCol([_fresh_cashflow_doc(UID, engine_build=engine_build())])
    _patch_sync_all(monkeypatch, col, truelayer_new=0)
    monkeypatch.setattr(accounts_router, "connections_col", FakeCol([{"_id": "conn-1", "user_id": UID}] if tl else []))
    monkeypatch.setattr(accounts_router, "_finexer_consents_col",
                        FakeCol([{"_id": "cst-1", "user_id": UID, "status": "authorized"}] if fx else []))
    counted = []

    async def spy(**inc):
        counted.append(inc)

    monkeypatch.setattr(accounts_router, "bump_daily_counters", spy)

    async def _not_paused(*_a, **_k):
        return False

    monkeypatch.setattr(accounts_router, "open_banking_paused", _not_paused)
    return counted


def test_finexer_only_user_is_told_nothing_more_to_fetch(monkeypatch):
    counted = _setup(monkeypatch, tl=False, fx=True)
    res = _run()
    assert res["history_fetched"] is False
    assert res["finexer_consents"] == 1
    assert res["message"] == "Your figures have been refreshed from the history your bank has shared."
    assert "Full sync complete" not in res["message"]
    assert "—" not in res["message"] and "!" not in res["message"]
    assert counted == [{"history_syncs": 1}]


def test_truelayer_user_still_gets_full_sync(monkeypatch):
    _setup(monkeypatch, tl=True, fx=True)
    res = _run()
    assert res["message"] == "Full sync complete"
    assert res["history_fetched"] is True


def test_no_connections_is_explained(monkeypatch):
    _setup(monkeypatch, tl=False, fx=False)
    res = _run()
    assert res["message"].startswith("No bank connections")
    assert res["finexer_consents"] == 0
