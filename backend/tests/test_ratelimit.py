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


@pytest.fixture(autouse=True)
def _force_local_path(monkeypatch):
    """These tests exercise the original in-process deque behaviour, so
    force redis_ok() False regardless of whether a real Redis is reachable
    from this test environment; tests/test_ratelimit_redis.py covers the
    Redis-backed path on its own with a fake client."""
    async def _not_ok():
        return False
    monkeypatch.setattr(ratelimit, "redis_ok", _not_ok)


def test_auth_limit_kicks_in():
    _hits.clear()
    for _ in range(30):
        assert asyncio.run(check_rate_limit(_req("/auth/google"))) is None
    resp = asyncio.run(check_rate_limit(_req("/auth/google")))
    assert resp is not None and resp.status_code == 429


def test_limits_are_per_ip():
    _hits.clear()
    for _ in range(30):
        asyncio.run(check_rate_limit(_req("/auth/google", ip="10.0.0.1")))
    # Different IP unaffected
    assert asyncio.run(check_rate_limit(_req("/auth/google", ip="10.0.0.2"))) is None


def test_unmatched_paths_not_limited():
    _hits.clear()
    for _ in range(100):
        assert asyncio.run(check_rate_limit(_req("/accounts"))) is None
