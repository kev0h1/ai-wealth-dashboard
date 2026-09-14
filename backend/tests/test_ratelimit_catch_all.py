"""A27: the catch-all rate limit (app.core.ratelimit.check_catch_all_ip_limit
/ check_catch_all_user_limit) and its wiring into app.core.auth.auth_middleware
— the piece that closes the gap flagged in the A27 backlog item: every data
endpoint (transactions search, safe-to-spend, accounts, spend verdict,
cashflow) was previously unlimited outside the seven auth/webhook/push
prefixes in ratelimit.RULES.

Same conventions as tests/test_ratelimit.py / tests/test_ratelimit_redis.py:
`_hits.clear()` per test (module-global state), `_force_local_path` forces
the in-process deque path unless a test explicitly wants the Redis path via
a fake client. Distinct IPs/identities from those other files' fixtures
(`203.0.113.x`, `catchall-*@example.com`) so accumulated hits from other
test modules sharing the same process never leak into these assertions.
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
    EXPENSIVE_USER_LIMIT,
)


def _req(path: str, ip: str = "203.0.113.10"):
    return SimpleNamespace(
        url=SimpleNamespace(path=path),
        headers={"X-Real-IP": ip},
        client=SimpleNamespace(host=ip),
    )


@pytest.fixture(autouse=True)
def _force_local_path_and_clear(monkeypatch):
    async def _not_ok():
        return False
    monkeypatch.setattr(ratelimit, "redis_ok", _not_ok)
    _hits.clear()
    yield
    _hits.clear()


# ── IP-keyed catch-all ────────────────────────────────────────────────────


def test_ip_catch_all_allows_up_to_the_limit():
    limit, _window = CATCH_ALL_IP_LIMIT
    for _ in range(limit):
        assert asyncio.run(check_catch_all_ip_limit(_req("/accounts", ip="203.0.113.11"))) is None
    resp = asyncio.run(check_catch_all_ip_limit(_req("/accounts", ip="203.0.113.11")))
    assert resp is not None and resp.status_code == 429
    assert "Retry-After" in resp.headers


def test_ip_catch_all_applies_to_any_path_not_just_rules_prefixes():
    """The actual A27 gap: /transactions/search, /safe-to-spend etc were
    previously unlimited because ratelimit.RULES only ever covered
    /auth/, /webhooks/ and two /push/ paths."""
    limit, _window = CATCH_ALL_IP_LIMIT
    for _ in range(limit):
        assert asyncio.run(check_catch_all_ip_limit(_req("/transactions/search", ip="203.0.113.12"))) is None
    resp = asyncio.run(check_catch_all_ip_limit(_req("/transactions/search", ip="203.0.113.12")))
    assert resp is not None and resp.status_code == 429


def test_ip_catch_all_is_per_ip():
    limit, _window = CATCH_ALL_IP_LIMIT
    for _ in range(limit):
        asyncio.run(check_catch_all_ip_limit(_req("/accounts", ip="203.0.113.13")))
    assert asyncio.run(check_catch_all_ip_limit(_req("/accounts", ip="203.0.113.14"))) is None


# ── User-keyed catch-all ─────────────────────────────────────────────────


def test_user_catch_all_allows_up_to_the_limit():
    limit, _window = CATCH_ALL_USER_LIMIT
    for _ in range(limit):
        assert asyncio.run(check_catch_all_user_limit(_req("/accounts"), "catchall-a@example.com")) is None
    resp = asyncio.run(check_catch_all_user_limit(_req("/accounts"), "catchall-a@example.com"))
    assert resp is not None and resp.status_code == 429


def test_user_catch_all_is_per_identity_not_per_ip():
    """Two different users behind the same IP (office/NAT) must not share a
    budget."""
    limit, _window = CATCH_ALL_USER_LIMIT
    same_ip = "203.0.113.20"
    for _ in range(limit):
        asyncio.run(check_catch_all_user_limit(_req("/accounts", ip=same_ip), "catchall-b@example.com"))
    assert asyncio.run(check_catch_all_user_limit(_req("/accounts", ip=same_ip), "catchall-c@example.com")) is None


def test_user_catch_all_follows_the_user_across_ips():
    """One user roaming networks must not get a fresh budget per IP."""
    limit, _window = CATCH_ALL_USER_LIMIT
    for i in range(limit):
        ip = f"203.0.113.{30 + (i % 5)}"
        asyncio.run(check_catch_all_user_limit(_req("/accounts", ip=ip), "catchall-d@example.com"))
    resp = asyncio.run(check_catch_all_user_limit(_req("/accounts", ip="203.0.113.99"), "catchall-d@example.com"))
    assert resp is not None and resp.status_code == 429


def test_expensive_prefix_has_a_tighter_budget_than_the_general_limit():
    exp_limit, _exp_window = EXPENSIVE_USER_LIMIT
    general_limit, _general_window = CATCH_ALL_USER_LIMIT
    assert exp_limit < general_limit, "expensive endpoints must be stricter than the general catch-all"

    for _ in range(exp_limit):
        assert asyncio.run(
            check_catch_all_user_limit(_req("/transactions/search"), "catchall-e@example.com")
        ) is None
    resp = asyncio.run(check_catch_all_user_limit(_req("/transactions/search"), "catchall-e@example.com"))
    assert resp is not None and resp.status_code == 429


def test_expensive_prefix_limit_is_independent_of_a_different_users_general_traffic():
    """Hitting the general limit on /accounts must not affect a fresh
    user's expensive-endpoint budget, and vice versa — they're different
    keys."""
    exp_limit, _exp_window = EXPENSIVE_USER_LIMIT
    for _ in range(exp_limit):
        assert asyncio.run(
            check_catch_all_user_limit(_req("/safe-to-spend"), "catchall-f@example.com")
        ) is None
    # A cheap, non-expensive path for the SAME user is a separate budget
    # (the general one), still open.
    assert asyncio.run(check_catch_all_user_limit(_req("/accounts"), "catchall-f@example.com")) is None


@pytest.mark.parametrize("path", [
    "/transactions/search", "/safe-to-spend", "/cashflow",
    "/spend/verdict", "/money-shape", "/savings-insights",
])
def test_every_named_expensive_prefix_is_tighter_than_general(path):
    exp_limit, _exp_window = EXPENSIVE_USER_LIMIT
    for _ in range(exp_limit):
        assert asyncio.run(check_catch_all_user_limit(_req(path), f"catchall-g-{path}@example.com")) is None
    resp = asyncio.run(check_catch_all_user_limit(_req(path), f"catchall-g-{path}@example.com"))
    assert resp is not None and resp.status_code == 429
