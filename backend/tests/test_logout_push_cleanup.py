"""A120 (pentest AND-07 / IOS-07): /auth/logout must drop every push
registration for the user (web push, APNs, FCM), so a signed-out device stops
receiving pushes, and a cleanup failure must never stop the revoke.

In-memory fake collections, no Mongo (same pattern as test_apns_push_pruning).
"""
import asyncio
import logging

import app.core.push as push
import app.routers.auth as auth_router

ME = "a120-me@example.com"
OTHER = "a120-other@example.com"


class _Res:
    def __init__(self, n):
        self.deleted_count = n


class FakeCol:
    def __init__(self, docs):
        self.docs = list(docs)

    async def delete_many(self, query):
        keep = [d for d in self.docs if any(d.get(k) != v for k, v in query.items())]
        n = len(self.docs) - len(keep)
        self.docs = keep
        return _Res(n)


class BoomCol:
    async def delete_many(self, query):
        raise RuntimeError("mongo down")


def _run(coro):
    return asyncio.new_event_loop().run_until_complete(coro)


def _cols():
    return (
        FakeCol([{"_id": "w1", "user_id": ME}, {"_id": "w2", "user_id": ME}, {"_id": "w3", "user_id": OTHER}]),
        FakeCol([{"_id": "a1", "user_id": ME}, {"_id": "a2", "user_id": OTHER}]),
        FakeCol([{"_id": "f1", "user_id": ME}, {"_id": "f2", "user_id": OTHER}]),
    )


def test_logout_removes_all_of_my_push_registrations_and_only_mine(monkeypatch):
    web, apns, fcm = _cols()
    monkeypatch.setattr(push, "push_subscriptions_col", web)
    monkeypatch.setattr(push, "apns_tokens_col", apns)
    monkeypatch.setattr(push, "fcm_tokens_col", fcm)
    revoked = []

    async def fake_revoke(email, now=None):
        revoked.append(email)

    monkeypatch.setattr(auth_router, "revoke_sessions", fake_revoke)

    assert _run(auth_router.logout(user={"email": ME, "name": "T"})) == {"ok": True}

    assert revoked == [ME]
    assert [d["_id"] for d in web.docs] == ["w3"]
    assert [d["_id"] for d in apns.docs] == ["a2"]
    assert [d["_id"] for d in fcm.docs] == ["f2"]


def test_push_cleanup_failure_does_not_stop_the_revoke(monkeypatch, caplog):
    monkeypatch.setattr(push, "push_subscriptions_col", BoomCol())
    monkeypatch.setattr(push, "apns_tokens_col", FakeCol([]))
    monkeypatch.setattr(push, "fcm_tokens_col", FakeCol([]))
    revoked = []

    async def fake_revoke(email, now=None):
        revoked.append(email)

    monkeypatch.setattr(auth_router, "revoke_sessions", fake_revoke)

    with caplog.at_level(logging.WARNING):
        assert _run(auth_router.logout(user={"email": ME, "name": "T"})) == {"ok": True}

    assert revoked == [ME]
    assert any("push cleanup failed" in r.getMessage() for r in caplog.records)
    assert ME not in caplog.text  # masked email only
