"""app.core.pending_login: the mobile OAuth hand-off store used by
/auth/google/mobile-callback (writer) and /auth/mobile/poll (reader).
Covers the Redis-backed path (with a tiny fake async client) and the
in-process fallback used when Redis is unavailable."""
import asyncio
import time

import pytest

from app.core import pending_login
from app.core.pending_login import _pop_pending, _store_pending


class _FakeRedis:
    def __init__(self):
        self.store: dict[str, tuple[str, float]] = {}

    async def set(self, key, value, ex=None):
        expires_at = time.time() + ex if ex else None
        self.store[key] = (value, expires_at)
        return True

    async def get(self, key):
        entry = self.store.get(key)
        if not entry:
            return None
        value, expires_at = entry
        if expires_at is not None and expires_at < time.time():
            return None
        return value

    async def getdel(self, key):
        entry = self.store.pop(key, None)
        if not entry:
            return None
        value, expires_at = entry
        if expires_at is not None and expires_at < time.time():
            return None
        return value


@pytest.fixture(autouse=True)
def _clear_local():
    pending_login._pending.clear()
    pending_login._replay.clear()
    yield
    pending_login._pending.clear()
    pending_login._replay.clear()


@pytest.fixture
def fake_redis(monkeypatch):
    client = _FakeRedis()

    async def _ok():
        return True

    monkeypatch.setattr(pending_login, "redis_ok", _ok)
    monkeypatch.setattr(pending_login, "get_redis", lambda: client)
    return client


def test_store_then_pop_returns_value_once(fake_redis):
    asyncio.run(_store_pending("state-1", "token:abc"))
    assert asyncio.run(_pop_pending("state-1")) == "token:abc"


def test_second_pop_of_an_error_is_none(fake_redis):
    asyncio.run(_store_pending("state-2", "error:invite_only"))
    assert asyncio.run(_pop_pending("state-2")) == "error:invite_only"
    assert asyncio.run(_pop_pending("state-2")) is None


def test_token_is_replayable_within_grace_then_gone(fake_redis, monkeypatch):
    # A133: a client that lost/failed the first response can poll again.
    current = [1_000_000.0]
    monkeypatch.setattr(pending_login.time, "time", lambda: current[0])
    asyncio.run(_store_pending("state-r", "token:abc"))
    assert asyncio.run(_pop_pending("state-r")) == "token:abc"
    current[0] += 10
    assert asyncio.run(_pop_pending("state-r")) == "token:abc"
    current[0] += 25  # 35s after the first read, past the 30s grace
    assert asyncio.run(_pop_pending("state-r")) is None


def test_unknown_state_is_none(fake_redis):
    assert asyncio.run(_pop_pending("never-stored")) is None


def test_expired_entry_is_none(fake_redis, monkeypatch):
    current = [1_000_000.0]
    monkeypatch.setattr(pending_login.time, "time", lambda: current[0])
    asyncio.run(_store_pending("state-3", "token:abc"))
    current[0] += 301  # past the 300s TTL
    assert asyncio.run(_pop_pending("state-3")) is None


def test_fallback_path_when_redis_unavailable(monkeypatch):
    async def _not_ok():
        return False

    monkeypatch.setattr(pending_login, "redis_ok", _not_ok)
    asyncio.run(_store_pending("state-4", "token:xyz"))
    assert asyncio.run(_pop_pending("state-4")) == "token:xyz"
    # A133: replayable within the grace window, then gone.
    assert asyncio.run(_pop_pending("state-4")) == "token:xyz"
    pending_login._replay["state-4"] = ("token:xyz", time.time() - 1)
    assert asyncio.run(_pop_pending("state-4")) is None


def test_fallback_error_is_single_read(monkeypatch):
    async def _not_ok():
        return False

    monkeypatch.setattr(pending_login, "redis_ok", _not_ok)
    asyncio.run(_store_pending("state-5", "error:auth_failed"))
    assert asyncio.run(_pop_pending("state-5")) == "error:auth_failed"
    assert asyncio.run(_pop_pending("state-5")) is None
