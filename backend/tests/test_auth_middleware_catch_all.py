"""A27: proves the catch-all rate limit is actually wired into
app.core.auth.auth_middleware, not just implemented and unused — an
unauthenticated caller hammering a protected route with no/garbage bearer
tokens is IP-limited before the token is ever validated, and a real
session's requests are limited per-user once the token validates. Same
`_FakeMiddlewareRequest`/`_run` convention as tests/test_oauth_server.py.
"""
import asyncio
from types import SimpleNamespace

import pytest

import app.core.auth as auth_mod
from app.core import ratelimit
from app.core.config import serializer


def _run(coro):
    return asyncio.run(coro)


class _FakeURL:
    def __init__(self, path):
        self.path = path


class _FakeRequest:
    def __init__(self, path, headers=None, method="GET", ip="203.0.113.60"):
        self.url = _FakeURL(path)
        self.headers = headers or {}
        self.method = method
        self.client = SimpleNamespace(host=ip)


async def _call_next(_request):
    class _Resp:
        status_code = 200
    return _Resp()


@pytest.fixture(autouse=True)
def _force_local_and_clear(monkeypatch):
    async def _not_ok():
        return False
    monkeypatch.setattr(ratelimit, "redis_ok", _not_ok)
    ratelimit._hits.clear()
    yield
    ratelimit._hits.clear()


def test_unauthenticated_flood_against_protected_route_is_ip_limited():
    """The literal gap named in the A27 ticket: an anonymous caller
    spamming a protected route with no bearer token must not be
    unlimited, even though it never resolves to a user identity."""
    limit, _window = ratelimit.CATCH_ALL_IP_LIMIT
    ip = "203.0.113.61"
    for _ in range(limit):
        resp = _run(auth_mod.auth_middleware(_FakeRequest("/accounts", ip=ip), _call_next))
        assert resp.status_code == 401  # no bearer token — always 401, but not blocked by the limiter yet
    resp = _run(auth_mod.auth_middleware(_FakeRequest("/accounts", ip=ip), _call_next))
    assert resp.status_code == 429


def test_ip_limited_before_token_is_even_decoded():
    """A garbage bearer token still costs a signature-verification attempt
    per request — this must be bounded by IP too, not just a valid
    identity."""
    limit, _window = ratelimit.CATCH_ALL_IP_LIMIT
    ip = "203.0.113.62"
    headers = {"Authorization": "Bearer not-a-real-token"}
    for _ in range(limit):
        resp = _run(auth_mod.auth_middleware(_FakeRequest("/accounts", headers=headers, ip=ip), _call_next))
        assert resp.status_code == 401
    resp = _run(auth_mod.auth_middleware(_FakeRequest("/accounts", headers=headers, ip=ip), _call_next))
    assert resp.status_code == 429


def test_valid_session_is_rate_limited_per_user_not_ip():
    token = serializer.dumps({"email": "middleware-catchall@example.com", "name": "Test"})
    headers = {"Authorization": f"Bearer {token}"}
    limit, _window = ratelimit.CATCH_ALL_USER_LIMIT
    # Same user, different IPs each time — still one shared budget.
    for i in range(limit):
        ip = f"203.0.113.{70 + (i % 5)}"
        resp = _run(auth_mod.auth_middleware(_FakeRequest("/accounts", headers=headers, ip=ip), _call_next))
        assert resp.status_code == 200
    resp = _run(auth_mod.auth_middleware(
        _FakeRequest("/accounts", headers=headers, ip="203.0.113.79"), _call_next
    ))
    assert resp.status_code == 429


def test_two_different_users_behind_the_same_ip_have_separate_budgets():
    ip = "203.0.113.80"
    limit, _window = ratelimit.CATCH_ALL_USER_LIMIT
    token_a = serializer.dumps({"email": "office-user-a@example.com", "name": "A"})
    token_b = serializer.dumps({"email": "office-user-b@example.com", "name": "B"})
    for _ in range(limit):
        resp = _run(auth_mod.auth_middleware(
            _FakeRequest("/accounts", headers={"Authorization": f"Bearer {token_a}"}, ip=ip), _call_next
        ))
        assert resp.status_code == 200
    # User A is now at their limit; user B, same IP, is unaffected.
    resp = _run(auth_mod.auth_middleware(
        _FakeRequest("/accounts", headers={"Authorization": f"Bearer {token_b}"}, ip=ip), _call_next
    ))
    assert resp.status_code == 200


def test_a_realistic_home_page_load_does_not_trip_the_limit():
    """CLAUDE.md/A27: Home fires roughly a dozen requests on mount (several
    from HomePage.tsx itself, plus BottomNav/PennySheetProvider) — a
    handful of simulated page loads for the same user must stay well
    clear of both the general and expensive per-user budgets."""
    token = serializer.dumps({"email": "home-load-user@example.com", "name": "Test"})
    headers = {"Authorization": f"Bearer {token}"}
    # A generous reading of one Home load: 13 general requests plus 3 that
    # hit an EXPENSIVE_PREFIXES route (safe-to-spend, transactions/search,
    # cashflow), repeated for 4 reloads inside the window.
    home_load_paths = (
        ["/accounts", "/today", "/needle-summary", "/investments/accounts", "/preferences"]
        + ["/safe-to-spend", "/transactions/search", "/cashflow"]
    )
    for _reload in range(4):
        for path in home_load_paths:
            resp = _run(auth_mod.auth_middleware(_FakeRequest(path, headers=headers), _call_next))
            assert resp.status_code == 200, f"{path} tripped the catch-all on a realistic Home load"
