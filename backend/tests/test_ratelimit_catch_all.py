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


# ── A36: per-prefix budgets, not one shared pool ─────────────────────────
#
# The A27 post-merge review found all six EXPENSIVE_PREFIXES drew from ONE
# 30/60 bucket per user, so a probe that hammered only /safe-to-spend hit
# 429 after just 24 requests once 15 earlier, unrelated-endpoint requests
# (a realistic Home load) had already consumed part of the shared window.
# These tests prove the fix: each prefix now gets its OWN 30/60 budget.


def test_exhausting_one_expensive_prefix_leaves_a_different_prefix_open_for_the_same_user():
    """The literal A36 bug: under the old shared pool, this would fail —
    running a different expensive endpoint's budget to zero used to also
    block this one for the same user. Now they're independent keys."""
    exp_limit, _exp_window = EXPENSIVE_USER_LIMIT
    identity = "catchall-h@example.com"
    for _ in range(exp_limit):
        assert asyncio.run(check_catch_all_user_limit(_req("/safe-to-spend"), identity)) is None
    # /safe-to-spend is now exhausted for this user...
    resp = asyncio.run(check_catch_all_user_limit(_req("/safe-to-spend"), identity))
    assert resp is not None and resp.status_code == 429
    # ...but a completely different expensive prefix, same user, is untouched.
    for path in ("/cashflow", "/spend/verdict", "/money-shape", "/savings-insights", "/transactions/search"):
        assert asyncio.run(check_catch_all_user_limit(_req(path), identity)) is None, (
            f"{path} was blocked by /safe-to-spend's own exhausted budget — prefixes are leaking"
        )


def test_realistic_navigation_across_all_six_prefixes_never_trips_any_one_of_them():
    """Measured from the frontend call graph (HomePage.tsx, SpendPage.tsx,
    PlanningPage.tsx, lib/verdictCache.ts, lib/moneyShape.ts): one lap of
    Home -> Spend -> Upcoming -> Planning -> Home costs at most 3 hits to
    any single expensive prefix (cashflow: UpcomingBillsStrip on both Home
    visits + PlanningPage's Upcoming mount; spend/verdict: Home's idle
    warm-up on both visits + Spend's own fetch; savings-insights: Home's
    spotlight on both visits + Spend's category-insights list). Ten laps in
    a minute — a genuinely frantic amount of navigation — is still under
    the 30/60 per-prefix budget for every prefix."""
    identity = "catchall-lap@example.com"
    one_lap = (
        # Home (1st visit): loadData's parallel fetches + UpcomingBillsStrip
        # + HomeInsightSpotlight + the idle-triggered verdict warm-up.
        ["/safe-to-spend", "/transactions/search", "/cashflow", "/savings-insights/spotlight", "/spend/verdict"]
        # Spend (period view): verdict revalidation + money-shape + the
        # category-insights list (a different /savings-insights sub-path,
        # same prefix bucket).
        + ["/spend/verdict", "/money-shape", "/savings-insights"]
        # Upcoming (PlanningPage): its own cashflow fetch.
        + ["/cashflow"]
        # Planning (LongTermPlanningPage): none of the six.
        # Home (2nd visit): same shape as the first.
        + ["/safe-to-spend", "/transactions/search", "/cashflow", "/savings-insights/spotlight", "/spend/verdict"]
    )
    for lap in range(10):
        for path in one_lap:
            resp = asyncio.run(check_catch_all_user_limit(_req(path), identity))
            assert resp is None, f"lap {lap + 1}, {path} tripped the per-prefix limit on realistic navigation"


def test_genuine_single_endpoint_abuse_still_trips_even_after_realistic_browsing():
    """The abuse pattern the limit exists to stop: a script hammering ONE
    expensive endpoint. Unlike the old shared pool (where 15 unrelated
    requests ate into the budget before the probe even started, tripping
    at request 24 of 35), a realistic navigation lap first, THEN a
    sequential flood of one endpoint, still allows the full 30/60 for that
    endpoint on its own — and still trips once the probe exceeds it."""
    exp_limit, _exp_window = EXPENSIVE_USER_LIMIT
    identity = "catchall-abuse@example.com"
    # First, a realistic lap through every screen (5 expensive prefixes).
    for path in ("/safe-to-spend", "/transactions/search", "/cashflow", "/savings-insights/spotlight", "/spend/verdict"):
        assert asyncio.run(check_catch_all_user_limit(_req(path), identity)) is None
    # Now the deliberate probe: 35 sequential calls to /safe-to-spend alone.
    tripped_at = None
    for i in range(1, 36):
        resp = asyncio.run(check_catch_all_user_limit(_req("/safe-to-spend"), identity))
        if resp is not None:
            tripped_at = i
            break
    assert tripped_at is not None, "35 sequential calls to one expensive endpoint must eventually trip"
    # It already had 1 hit from the realistic lap above, so it trips on the
    # (exp_limit)th request of the probe itself (30th here), not earlier —
    # proving the prior, unrelated-endpoint traffic didn't erode this budget.
    assert tripped_at == exp_limit, (
        f"expected the probe to trip on request {exp_limit}, tripped on {tripped_at} instead — "
        "suggests another prefix's traffic is still leaking into this one's budget"
    )
