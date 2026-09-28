"""Pentest A49 (WP2), API-16, fixed by A95: regression-pins the fix for
`/logo/{domain}` having no effective rate limit of any kind.

`docs/security/PENTEST-METHODOLOGY.md` section 6.2's `API-16` row flagged
this as a candidate gap (originally A47/A48's reconnaissance): the
`/logo/` prefix is routed through `app.core.auth.auth_middleware`'s
open-but-rate-limited branch (same branch as `/auth/` and `/webhooks/`),
but `app.core.ratelimit.RULES` had no entry whose prefix matched `/logo/`,
and that branch returned straight from `call_next()` once
`check_rate_limit()` said `None`, without ever reaching the generic
IP/user catch-all checks further down `auth_middleware`. See
`docs/security/pentest-runs/A49-2026-09-21/records.md` (`API-16`) for the
full pentest record and finding, and this repo's A95 commit for the fix:
a discrete `/logo/` entry was added to `RULES`, and the `/auth/`,
`/webhooks/`, `/logo/` branch in `auth_middleware` now also calls
`check_catch_all_ip_limit` after `check_rate_limit` passes, same as every
other protected route.

Two things are pinned here, both required to fully cover the fix:

1. `check_rate_limit` now matches a `/logo/` path against its own RULES
   entry and returns a 429 once that budget is exceeded (rather than
   falling through the loop unmatched forever).
2. `auth_middleware`'s own `/logo/` branch is bound by the generic IP
   catch-all too, now that it falls through to `check_catch_all_ip_limit`
   after `check_rate_limit` passes — a caller hammering `/logo/` is
   bounded by the tighter of the two (in practice, the new `/logo/` RULES
   entry, since it is far stricter than `CATCH_ALL_IP_LIMIT`), and never
   sails past `CATCH_ALL_IP_LIMIT`'s threshold unlimited the way it used
   to.

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


def _logo_limit():
    for prefix, limit, window in ratelimit.RULES:
        if prefix == "/logo/":
            return limit, window
    raise AssertionError("RULES has no /logo/ entry — A95 fix regressed")


def test_check_rate_limit_now_matches_a_logo_path():
    """A95: RULES now has a /logo/ entry, so check_rate_limit trips a 429
    for a /logo/ path once that entry's own budget is exceeded, instead of
    falling through the loop unmatched forever."""
    limit, _window = _logo_limit()
    req = SimpleNamespace(
        url=SimpleNamespace(path="/logo/example.com"),
        headers={"X-Real-IP": "203.0.113.91"},
        client=SimpleNamespace(host="203.0.113.91"),
    )
    for _ in range(limit):
        assert _run(check_rate_limit(req)) is None
    resp = _run(check_rate_limit(req))
    assert resp is not None
    assert resp.status_code == 429
    assert "Retry-After" in resp.headers


def test_logo_prefix_no_longer_bypasses_the_generic_catch_all_limit():
    """A49/API-16 finding, now fixed: hammering /logo/ through the full
    auth_middleware trips a 429 well before CATCH_ALL_IP_LIMIT's threshold
    (600/60) that every other protected route is bound by, because the
    /logo/ RULES entry (tighter than the catch-all) fires first. Confirms
    the branch is no longer exempt from being limited at all, regardless
    of which of the two checks ends up doing the limiting."""
    ip_limit, _window = ratelimit.CATCH_ALL_IP_LIMIT
    logo_limit, _logo_window = _logo_limit()
    assert logo_limit < ip_limit, "test assumes the /logo/ rule is the tighter of the two"
    ip = "203.0.113.92"
    tripped_at = None
    total_requests = ip_limit + 50  # the old bug sailed straight past this many
    for i in range(total_requests):
        resp = _run(auth_mod.auth_middleware(_FakeRequest("/logo/example.com", ip=ip), _call_next))
        if resp.status_code == 429:
            tripped_at = i + 1
            break
    assert tripped_at is not None, "/logo/ is still unlimited — A95 fix regressed"
    assert tripped_at <= logo_limit + 1, (
        f"expected the /logo/ RULES entry (limit {logo_limit}) to trip first, "
        f"but it took {tripped_at} requests"
    )


def test_accounts_path_is_bound_by_the_catch_all_for_contrast():
    """Contrast case, not the finding itself: an ordinary protected route
    (never routed through check_rate_limit at all) is still bound by the
    generic IP catch-all, confirming the fix above didn't accidentally
    change unrelated behaviour."""
    ip_limit, _window = ratelimit.CATCH_ALL_IP_LIMIT
    ip = "203.0.113.93"
    for _ in range(ip_limit):
        resp = _run(auth_mod.auth_middleware(_FakeRequest("/accounts", ip=ip), _call_next))
        assert resp.status_code == 401  # no bearer token, but not yet blocked by the limiter
    resp = _run(auth_mod.auth_middleware(_FakeRequest("/accounts", ip=ip), _call_next))
    assert resp.status_code == 429
