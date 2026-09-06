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
    yield
    pending_login._pending.clear()


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


def test_second_pop_is_none(fake_redis):
    asyncio.run(_store_pending("state-2", "token:abc"))
    asyncio.run(_pop_pending("state-2"))
    assert asyncio.run(_pop_pending("state-2")) is None


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
    # Consumed: a second pop finds nothing.
    assert asyncio.run(_pop_pending("state-4")) is None
