"""A27: the catch-all rate limit's Redis-backed path, and — the actual
VERIFY requirement on the A27 backlog item — what happens when Redis is
unreachable. Same fake-Redis convention as tests/test_ratelimit_redis.py.

Decision under test: when Redis is down, `check_keyed_limit` (shared by
every rule in this module, old and new) falls back to the in-process
deque rather than either (a) blocking every request outright ("fail
closed", which would turn a transient Redis blip into a full outage for
every real user trying to see their own bank data) or (b) letting every
request through with no bound at all ("fail open" in the unlimited
sense). This is "fail open" only in the narrow sense of "keeps serving
requests"; it is NOT unbounded — each replica still enforces its own
local copy of the same limit. See app.core.ratelimit's module docstring
and the CATCH_ALL_* comment for the full reasoning; this file proves the
mechanism, not just asserts the intent in prose.
"""
import asyncio
from types import SimpleNamespace

import pytest

from app.core import ratelimit
from app.core.ratelimit import (
    _hits,
    check_catch_all_ip_limit,
    check_catch_all_user_limit,
    CATCH_ALL_IP_LIMIT,
    CATCH_ALL_USER_LIMIT,
)


def _req(path: str, ip: str = "203.0.113.40"):
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


def test_catch_all_ip_limit_enforced_via_redis(fake_redis):
    limit, _window = CATCH_ALL_IP_LIMIT
    for _ in range(limit):
        assert asyncio.run(check_catch_all_ip_limit(_req("/accounts", ip="203.0.113.41"))) is None
    resp = asyncio.run(check_catch_all_ip_limit(_req("/accounts", ip="203.0.113.41")))
    assert resp is not None and resp.status_code == 429


def test_catch_all_user_limit_enforced_via_redis(fake_redis):
    limit, _window = CATCH_ALL_USER_LIMIT
    for _ in range(limit):
        assert asyncio.run(check_catch_all_user_limit(_req("/accounts"), "redis-user@example.com")) is None
    resp = asyncio.run(check_catch_all_user_limit(_req("/accounts"), "redis-user@example.com"))
    assert resp is not None and resp.status_code == 429


def test_redis_down_falls_back_to_local_and_still_enforces_ip_limit(fake_redis):
    """The actual VERIFY item: Redis unreachable must not mean unlimited."""
    fake_redis._raise_on_execute = True
    limit, _window = CATCH_ALL_IP_LIMIT
    for _ in range(limit):
        assert asyncio.run(check_catch_all_ip_limit(_req("/accounts", ip="203.0.113.42"))) is None
    resp = asyncio.run(check_catch_all_ip_limit(_req("/accounts", ip="203.0.113.42")))
    assert resp is not None and resp.status_code == 429


def test_redis_down_falls_back_to_local_and_still_enforces_user_limit(fake_redis):
    fake_redis._raise_on_execute = True
    limit, _window = CATCH_ALL_USER_LIMIT
    for _ in range(limit):
        assert asyncio.run(
            check_catch_all_user_limit(_req("/accounts"), "redis-down-user@example.com")
        ) is None
    resp = asyncio.run(check_catch_all_user_limit(_req("/accounts"), "redis-down-user@example.com"))
    assert resp is not None and resp.status_code == 429


def test_redis_down_does_not_crash_the_request_it_just_degrades(fake_redis):
    """Never raises, whatever Redis does — a rate-limit check failing
    closed with an unhandled exception would be worse than either
    deliberate direction (it would 500 every request, not just throttle
    some)."""
    fake_redis._raise_on_execute = True
    # Should not raise.
    result = asyncio.run(check_catch_all_ip_limit(_req("/accounts", ip="203.0.113.43")))
    assert result is None or result.status_code == 429
