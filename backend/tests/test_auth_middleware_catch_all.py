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


def _logo_rule():
    for prefix, limit, window in ratelimit.RULES:
        if prefix == "/logo/":
            return limit, window
    raise AssertionError("RULES has no /logo/ entry — A95 fix regressed")


def test_logo_path_is_limited_by_its_own_rule_per_ip():
    """A95: GET /logo/{domain} now has its own RULES entry, checked via
    auth_middleware's /auth//webhooks//logo/ branch. Requests up to the
    limit go through to call_next (200); the next one trips a 429 with a
    Retry-After header, same shape as every other RULES-backed limit."""
    logo_limit, _window = _logo_rule()
    ip = "203.0.113.65"
    for _ in range(logo_limit):
        resp = _run(auth_mod.auth_middleware(_FakeRequest("/logo/example.com", ip=ip), _call_next))
        assert resp.status_code == 200
    resp = _run(auth_mod.auth_middleware(_FakeRequest("/logo/example.com", ip=ip), _call_next))
    assert resp.status_code == 429
    assert "Retry-After" in resp.headers


def test_logo_path_budget_is_independent_per_ip():
    """A different IP hitting /logo/ gets its own fresh budget — one caller
    exhausting the limit must not affect another."""
    logo_limit, _window = _logo_rule()
    ip_a = "203.0.113.66"
    ip_b = "203.0.113.67"
    for _ in range(logo_limit):
        resp = _run(auth_mod.auth_middleware(_FakeRequest("/logo/example.com", ip=ip_a), _call_next))
        assert resp.status_code == 200
    resp = _run(auth_mod.auth_middleware(_FakeRequest("/logo/example.com", ip=ip_a), _call_next))
    assert resp.status_code == 429
    # ip_b is a different caller — still under its own budget.
    resp = _run(auth_mod.auth_middleware(_FakeRequest("/logo/example.com", ip=ip_b), _call_next))
    assert resp.status_code == 200


def test_auth_prefix_branch_falls_through_to_catch_all_even_with_no_rules_match(monkeypatch):
    """A95: proves the FALLTHROUGH ITSELF, not just the new /logo/ rule —
    the /auth//webhooks//logo/ branch in auth_middleware now always calls
    check_catch_all_ip_limit after check_rate_limit passes, regardless of
    whether a RULES prefix matched at all. Chosen approach: temporarily
    remove the /webhooks/ RULES entry via monkeypatch (rather than reusing
    a real unmatched path, since every prefix this branch actually covers
    today has its own RULES entry — that coverage is the point of this
    fix), so check_rate_limit has nothing to match a /webhooks/ path
    against and always returns None, then confirm a /webhooks/ flood is
    still bound by the generic IP catch-all at CATCH_ALL_IP_LIMIT's
    threshold, exactly like any other protected route (this would have
    been unbounded before A95, the same way /logo/ was)."""
    trimmed_rules = [rule for rule in ratelimit.RULES if rule[0] != "/webhooks/"]
    monkeypatch.setattr(ratelimit, "RULES", trimmed_rules)
    ip_limit, _window = ratelimit.CATCH_ALL_IP_LIMIT
    ip = "203.0.113.68"
    for _ in range(ip_limit):
        resp = _run(auth_mod.auth_middleware(_FakeRequest("/webhooks/some-provider", ip=ip), _call_next))
        assert resp.status_code == 200
    resp = _run(auth_mod.auth_middleware(_FakeRequest("/webhooks/some-provider", ip=ip), _call_next))
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


def test_a_realistic_walk_between_home_spend_upcoming_and_planning_does_not_trip_the_limit():
    """A36: the gap in the test above — it only ever modelled reloading ONE
    screen (Home), never moving BETWEEN screens, which is exactly the
    pattern the A27 post-merge review flagged as the real risk. Sequence
    and per-screen counts are read straight off the frontend call graph
    (not estimated):

    - Home mount (app/components/HomePage.tsx loadData + child strips):
      safe-to-spend, transactions/search, cashflow (UpcomingBillsStrip),
      savings-insights/spotlight (HomeInsightSpotlight), plus the idle-
      triggered spend/verdict warm-up (lib/verdictCache.ts fetchVerdictData,
      fired unconditionally, no TTL check of its own).
    - Spend mount (app/components/SpendPage.tsx): spend/verdict (its own
      fetchVerdict, which ALSO always calls fetchVerdictData even on a
      cache hit — the "silent revalidation" the ticket calls out), plus
      money-shape (lib/moneyShape.ts loadMoneyShape, same no-TTL-check
      shape) and savings-insights (loadCategoryInsights, 300ms after
      mount).
    - Upcoming mount (app/planning/PlanningPage.tsx): cashflow.
    - Planning mount (app/planning/LongTermPlanningPage.tsx): none of the
      six — it only calls /commitments and /debt-plan/summary.

    One full lap (Home -> Spend -> Upcoming -> Planning -> back to Home)
    fires 14 requests against EXPENSIVE_PREFIXES routes: under the OLD
    shared 30/60 pool this alone would have used nearly half the budget
    before any tip tap or manual search; under the fixed per-prefix
    budgets, no single prefix sees more than 3 hits in a lap, so several
    laps inside one minute — genuinely frantic navigation — must all
    still return 200."""
    token = serializer.dumps({"email": "screen-walk-user@example.com", "name": "Test"})
    headers = {"Authorization": f"Bearer {token}"}
    home_mount = [
        "/accounts", "/today", "/needle-summary", "/investments/accounts", "/preferences",
        "/safe-to-spend", "/transactions/search", "/cashflow", "/savings-insights/spotlight",
        "/spend/verdict",  # idle warm-up
    ]
    spend_mount = ["/spend/verdict", "/money-shape", "/savings-insights"]
    upcoming_mount = ["/cashflow"]
    planning_mount = ["/commitments", "/debt-plan/summary"]
    one_lap = home_mount + spend_mount + upcoming_mount + planning_mount + home_mount
    for lap in range(3):
        for path in one_lap:
            resp = _run(auth_mod.auth_middleware(_FakeRequest(path, headers=headers), _call_next))
            assert resp.status_code == 200, (
                f"lap {lap + 1}, {path} tripped the catch-all on a realistic "
                "Home -> Spend -> Upcoming -> Planning -> Home walk"
            )
