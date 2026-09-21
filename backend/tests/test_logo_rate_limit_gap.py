"""Pentest A49 (WP2), API-16: pins the observed behaviour that
`/logo/{domain}` has no effective rate limit of any kind.

`docs/security/PENTEST-METHODOLOGY.md` section 6.2's `API-16` row flagged
this as a candidate gap (originally A47/A48's reconnaissance): the
`/logo/` prefix is routed through `app.core.auth.auth_middleware`'s
open-but-rate-limited branch (same branch as `/auth/` and `/webhooks/`),
but `app.core.ratelimit.RULES` has no entry whose prefix matches `/logo/`.
This is a behaviour-recording test, not a fix: it records what the code
currently does so a future change to either `RULES` or the middleware's
`/logo/` branch cannot silently regress this without failing a test. See
`docs/security/pentest-runs/A49-2026-09-21/records.md` (`API-16`) for the
full pentest record and finding.

Two things are recorded, both required to fully explain the gap:

1. `check_rate_limit` itself falls through its `RULES` loop for a `/logo/`
   path and returns `None` (test_ratelimit.py's existing
   `test_unmatched_paths_not_limited` already shows this for `/accounts`,
   but `/accounts` never reaches `check_rate_limit` at all in production —
   only `/auth/`, `/webhooks/` and `/logo/` do, per `auth_middleware`. This
   test targets `/logo/` specifically, the path that DOES reach this
   function in real traffic yet still falls through unmatched).
2. `auth_middleware`'s own `/logo/` branch returns whatever `call_next`
   gives back the instant `check_rate_limit` returns `None`, without ever
   reaching the generic IP/user catch-all checks (`check_catch_all_ip_limit`
   / `check_catch_all_user_limit`) further down the function — so a caller
   hammering `/logo/` is not merely missing its own dedicated rule, it is
   also exempt from the 600-requests-per-60-seconds catch-all every other
   protected route gets. Proven here by sending more than
   `CATCH_ALL_IP_LIMIT`'s threshold of requests and confirming none of them
   are ever rejected.

Same `_FakeRequest`/`_call_next`/`auth_middleware` convention as
`tests/test_auth_middleware_catch_all.py`.
"""
import asyncio
from types import SimpleNamespace

import pytest

import app.core.auth as auth_mod
from app.core import ratelimit
from app.core.ratelimit import check_rate_limit


def _run(coro):
    return asyncio.run(coro)


class _FakeURL:
    def __init__(self, path):
        self.path = path


class _FakeRequest:
    def __init__(self, path, headers=None, method="GET", ip="203.0.113.90"):
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


def test_check_rate_limit_never_matches_a_logo_path():
    """RULES has no /logo/ entry, so check_rate_limit falls through its
    loop and returns None for every /logo/ request, unlike /auth/ (which
    trips a 429 well before this many requests)."""
    req = SimpleNamespace(
        url=SimpleNamespace(path="/logo/example.com"),
        headers={"X-Real-IP": "203.0.113.91"},
        client=SimpleNamespace(host="203.0.113.91"),
    )
    for _ in range(200):
        assert _run(check_rate_limit(req)) is None


def test_logo_prefix_bypasses_the_generic_catch_all_limit_too():
    """A49/API-16 finding: hammering /logo/ through the full
    auth_middleware never returns 429, even well past
    CATCH_ALL_IP_LIMIT's threshold (600/60) that every OTHER protected
    route is bound by, because auth_middleware's /logo/ branch returns
    directly from check_next() once check_rate_limit() says None, without
    ever reaching check_catch_all_ip_limit further down the function."""
    ip_limit, _window = ratelimit.CATCH_ALL_IP_LIMIT
    ip = "203.0.113.92"
    total_requests = ip_limit + 50  # deliberately past the generic catch-all
    for _ in range(total_requests):
        resp = _run(auth_mod.auth_middleware(_FakeRequest("/logo/example.com", ip=ip), _call_next))
        assert resp.status_code == 200, "unexpected 429: /logo/ now appears to be rate-limited"


def test_accounts_path_is_bound_by_the_catch_all_for_contrast():
    """Contrast case, not the finding itself: an ordinary protected route
    (never routed through check_rate_limit at all) is still bound by the
    generic IP catch-all at the same threshold /logo/ sails past above,
    confirming the gap is specific to the /logo/ dispatch branch, not a
    sign the catch-all itself is broken."""
    ip_limit, _window = ratelimit.CATCH_ALL_IP_LIMIT
    ip = "203.0.113.93"
    for _ in range(ip_limit):
        resp = _run(auth_mod.auth_middleware(_FakeRequest("/accounts", ip=ip), _call_next))
        assert resp.status_code == 401  # no bearer token, but not yet blocked by the limiter
    resp = _run(auth_mod.auth_middleware(_FakeRequest("/accounts", ip=ip), _call_next))
    assert resp.status_code == 429
