import asyncio
from types import SimpleNamespace

import pytest

from app.core import config, ratelimit
from app.core.ratelimit import check_rate_limit, client_ip, client_ip_diagnostics, _hits


def _req(path: str, ip: str = "1.2.3.4"):
    return SimpleNamespace(
        url=SimpleNamespace(path=path),
        headers={"X-Real-IP": ip},
        client=SimpleNamespace(host=ip),
    )


def _ip_req(headers: dict, peer: str = "9.9.9.9"):
    """A fake request for client_ip() tests only: a distinct, recognisable
    peer address (not a value any header could plausibly produce) so a test
    can assert the peer was used purely by checking for this exact value."""
    return SimpleNamespace(
        headers=headers,
        client=SimpleNamespace(host=peer),
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


# A92: client_ip() must derive the caller's address from TRUSTED_PROXY_HOPS
# trusted proxy hops, never from a header value the caller itself can set.

def test_hops_zero_ignores_spoofed_headers(monkeypatch):
    monkeypatch.setattr(config, "TRUSTED_PROXY_HOPS", 0)
    req = _ip_req(
        {"X-Real-IP": "6.6.6.6", "X-Forwarded-For": "6.6.6.6, 7.7.7.7"},
        peer="9.9.9.9",
    )
    assert client_ip(req) == "9.9.9.9"


def test_hops_one_takes_rightmost_entry(monkeypatch):
    monkeypatch.setattr(config, "TRUSTED_PROXY_HOPS", 1)
    # A client can prepend whatever it likes; only the entry appended by the
    # one trusted hop (the rightmost) should be trusted.
    req = _ip_req({"X-Forwarded-For": "6.6.6.6, 203.0.113.9"}, peer="9.9.9.9")
    assert client_ip(req) == "203.0.113.9"


def test_hops_two_takes_second_from_right(monkeypatch):
    monkeypatch.setattr(config, "TRUSTED_PROXY_HOPS", 2)
    # Leftmost is caller-supplied; the two rightmost were appended by the
    # two trusted hops, in order, so the real client is second from the
    # right (the nearer trusted hop appended last, i.e. rightmost).
    req = _ip_req(
        {"X-Forwarded-For": "6.6.6.6, 203.0.113.9, 198.51.100.4"},
        peer="9.9.9.9",
    )
    assert client_ip(req) == "203.0.113.9"


def test_too_short_list_falls_back_to_peer(monkeypatch):
    monkeypatch.setattr(config, "TRUSTED_PROXY_HOPS", 2)
    req = _ip_req({"X-Forwarded-For": "203.0.113.9"}, peer="9.9.9.9")
    assert client_ip(req) == "9.9.9.9"


def test_garbage_value_falls_back_to_peer(monkeypatch):
    monkeypatch.setattr(config, "TRUSTED_PROXY_HOPS", 1)
    req = _ip_req({"X-Forwarded-For": "not-an-ip"}, peer="9.9.9.9")
    assert client_ip(req) == "9.9.9.9"


# A110: production has two ingress paths with different real hop counts
# (web, through Vercel's /api rewrite, and mobile, straight to Railway), so
# a single TRUSTED_PROXY_HOPS can't serve both. TRUSTED_PROXY_SECRET +
# TRUSTED_PROXY_HOPS_WEB let a request that genuinely came through the web
# rewrite (proved by a shared-secret header the rewrite adds) use a
# different, higher hop count, while everything else, including the
# mobile apps and UAT, keeps using plain TRUSTED_PROXY_HOPS unchanged.

def test_secret_unset_falls_back_to_hops(monkeypatch):
    # TRUSTED_PROXY_SECRET absent entirely: the header is ignored even if a
    # caller sends one, and behaviour is identical to pre-A110.
    monkeypatch.setattr(config, "TRUSTED_PROXY_SECRET", "")
    monkeypatch.setattr(config, "TRUSTED_PROXY_HOPS_WEB", 2)
    monkeypatch.setattr(config, "TRUSTED_PROXY_HOPS", 1)
    req = _ip_req(
        {
            "X-Forwarded-For": "6.6.6.6, 203.0.113.9",
            "X-Sorted-Proxy-Auth": "whatever-a-caller-likes",
        },
        peer="9.9.9.9",
    )
    assert client_ip(req) == "203.0.113.9"  # TRUSTED_PROXY_HOPS=1, rightmost


def test_secret_set_header_matches_uses_hops_web(monkeypatch):
    monkeypatch.setattr(config, "TRUSTED_PROXY_SECRET", "sekrit")
    monkeypatch.setattr(config, "TRUSTED_PROXY_HOPS_WEB", 2)
    monkeypatch.setattr(config, "TRUSTED_PROXY_HOPS", 1)
    req = _ip_req(
        {
            "X-Forwarded-For": "6.6.6.6, 203.0.113.9, 198.51.100.4",
            "X-Sorted-Proxy-Auth": "sekrit",
        },
        peer="9.9.9.9",
    )
    # hops_web=2 -> second-from-right, not TRUSTED_PROXY_HOPS=1's rightmost.
    assert client_ip(req) == "203.0.113.9"


def test_secret_set_header_wrong_falls_back_to_hops(monkeypatch):
    monkeypatch.setattr(config, "TRUSTED_PROXY_SECRET", "sekrit")
    monkeypatch.setattr(config, "TRUSTED_PROXY_HOPS_WEB", 2)
    monkeypatch.setattr(config, "TRUSTED_PROXY_HOPS", 1)
    req = _ip_req(
        {
            "X-Forwarded-For": "6.6.6.6, 203.0.113.9, 198.51.100.4",
            "X-Sorted-Proxy-Auth": "not-the-secret",
        },
        peer="9.9.9.9",
    )
    # Falls back to TRUSTED_PROXY_HOPS=1: rightmost entry.
    assert client_ip(req) == "198.51.100.4"


def test_header_present_but_secret_unset_ignored(monkeypatch):
    # Same as test_secret_unset_falls_back_to_hops but phrased from the
    # angle the item asks for explicitly: a caller sending the header
    # cannot widen its own trust just because it guesses the header name,
    # if the server was never given a secret to compare against.
    monkeypatch.setattr(config, "TRUSTED_PROXY_SECRET", "")
    monkeypatch.setattr(config, "TRUSTED_PROXY_HOPS_WEB", 2)
    monkeypatch.setattr(config, "TRUSTED_PROXY_HOPS", 0)
    req = _ip_req(
        {
            "X-Forwarded-For": "6.6.6.6, 203.0.113.9",
            "X-Sorted-Proxy-Auth": "anything",
        },
        peer="9.9.9.9",
    )
    assert client_ip(req) == "9.9.9.9"  # TRUSTED_PROXY_HOPS=0 -> raw peer


def test_hops_web_zero_ignored_even_with_matching_secret(monkeypatch):
    # A wrong or absent configuration never widens trust: hops_web=0 means
    # "not configured", so even a correct header falls back to the plain
    # TRUSTED_PROXY_HOPS behaviour rather than trusting zero hops (which
    # would otherwise be ambiguous with "trust nothing").
    monkeypatch.setattr(config, "TRUSTED_PROXY_SECRET", "sekrit")
    monkeypatch.setattr(config, "TRUSTED_PROXY_HOPS_WEB", 0)
    monkeypatch.setattr(config, "TRUSTED_PROXY_HOPS", 1)
    req = _ip_req(
        {
            "X-Forwarded-For": "6.6.6.6, 203.0.113.9",
            "X-Sorted-Proxy-Auth": "sekrit",
        },
        peer="9.9.9.9",
    )
    assert client_ip(req) == "203.0.113.9"


def test_diagnostics_never_includes_secret_or_raw_headers(monkeypatch):
    monkeypatch.setattr(config, "TRUSTED_PROXY_SECRET", "sekrit")
    monkeypatch.setattr(config, "TRUSTED_PROXY_HOPS_WEB", 2)
    monkeypatch.setattr(config, "TRUSTED_PROXY_HOPS", 1)
    req = _ip_req(
        {
            "X-Forwarded-For": "6.6.6.6, 203.0.113.9, 198.51.100.4",
            "X-Sorted-Proxy-Auth": "sekrit",
        },
        peer="9.9.9.9",
    )
    result = client_ip_diagnostics(req)
    assert result == {
        "resolved_client_ip": "203.0.113.9",
        "forwarded_entries": 3,
        "via_web_proxy": True,
        "hops_applied": 2,
    }
    dumped = repr(result)
    # Never leaks the secret, the raw header value, or the full forwarded
    # chain, only the derived, aggregate facts above.
    assert "sekrit" not in dumped
    assert "6.6.6.6" not in dumped
    assert "198.51.100.4" not in dumped


def test_diagnostics_matches_client_ip_when_not_via_web_proxy(monkeypatch):
    monkeypatch.setattr(config, "TRUSTED_PROXY_SECRET", "")
    monkeypatch.setattr(config, "TRUSTED_PROXY_HOPS_WEB", 0)
    monkeypatch.setattr(config, "TRUSTED_PROXY_HOPS", 1)
    req = _ip_req({"X-Forwarded-For": "203.0.113.9"}, peer="9.9.9.9")
    result = client_ip_diagnostics(req)
    assert result == {
        "resolved_client_ip": "203.0.113.9",
        "forwarded_entries": 1,
        "via_web_proxy": False,
        "hops_applied": 1,
    }
