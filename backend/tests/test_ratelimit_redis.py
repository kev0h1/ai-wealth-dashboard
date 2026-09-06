"""Covers the Redis-backed sliding-window path in app.core.ratelimit with a
small fake async Redis (real network access to Redis is not assumed in
every environment this test suite runs in)."""
import asyncio
from types import SimpleNamespace

import pytest

from app.core import ratelimit
from app.core.ratelimit import check_rate_limit, _hits


def _req(path: str, ip: str = "1.2.3.4"):
    return SimpleNamespace(
        url=SimpleNamespace(path=path),
        headers={"X-Real-IP": ip},
        client=SimpleNamespace(host=ip),
    )


class _FakePipeline:
    def __init__(self, store: dict):
        self._store = store
        self._ops = []
        self._raise = False

    def zremrangebyscore(self, key, min_score, max_score):
        self._ops.append(("zremrangebyscore", key, min_score, max_score))
        return self

    def zcard(self, key):
        self._ops.append(("zcard", key))
        return self

    def zadd(self, key, mapping):
        self._ops.append(("zadd", key, dict(mapping)))
        return self

    def expire(self, key, seconds):
        self._ops.append(("expire", key, seconds))
        return self

    async def execute(self):
        if self._raise:
            raise ConnectionError("simulated Redis outage")
        results = []
        for op in self._ops:
            kind = op[0]
            key = op[1]
            zset = self._store.setdefault(key, {})
            if kind == "zremrangebyscore":
                _, _, lo, hi = op
                removed = [m for m, s in zset.items() if lo <= s <= hi]
                for m in removed:
                    del zset[m]
                results.append(len(removed))
            elif kind == "zcard":
                results.append(len(zset))
            elif kind == "zadd":
                _, _, mapping = op
                added = sum(1 for m in mapping if m not in zset)
                zset.update(mapping)
                results.append(added)
            elif kind == "expire":
                results.append(True)
        return results


class _FakeRedis:
    def __init__(self):
        self.store: dict[str, dict[str, float]] = {}
        self._raise_on_execute = False

    def pipeline(self):
        pipe = _FakePipeline(self.store)
        pipe._raise = self._raise_on_execute
        return pipe


@pytest.fixture
def fake_redis(monkeypatch):
    _hits.clear()
    client = _FakeRedis()

    async def _ok():
        return True

    monkeypatch.setattr(ratelimit, "redis_ok", _ok)
    monkeypatch.setattr(ratelimit, "get_redis", lambda: client)
    yield client
    _hits.clear()


def test_under_limit_passes(fake_redis):
    for _ in range(29):
        assert asyncio.run(check_rate_limit(_req("/auth/google"))) is None


def test_at_limit_returns_429(fake_redis):
    for _ in range(30):
        assert asyncio.run(check_rate_limit(_req("/auth/google"))) is None
    resp = asyncio.run(check_rate_limit(_req("/auth/google")))
    assert resp is not None and resp.status_code == 429


def test_window_expiry_frees_slot(fake_redis, monkeypatch):
    current = [1_000_000.0]
    monkeypatch.setattr(ratelimit.time, "time", lambda: current[0])

    for _ in range(30):
        assert asyncio.run(check_rate_limit(_req("/auth/google"))) is None
    resp = asyncio.run(check_rate_limit(_req("/auth/google")))
    assert resp is not None and resp.status_code == 429

    # Advance past the 60s window: the old entries fall out of range on the
    # next ZREMRANGEBYSCORE, freeing the slot.
    current[0] += 61
    assert asyncio.run(check_rate_limit(_req("/auth/google"))) is None


def test_redis_exception_falls_back_to_local(fake_redis):
    fake_redis._raise_on_execute = True
    # Local fallback has its own 30/60s limit, so this should behave exactly
    # like the in-process deque test: 30 through, the 31st rejected.
    for _ in range(30):
        assert asyncio.run(check_rate_limit(_req("/auth/google", ip="9.9.9.9"))) is None
    resp = asyncio.run(check_rate_limit(_req("/auth/google", ip="9.9.9.9")))
    assert resp is not None and resp.status_code == 429
