"""A51 (WP4, API-10): SSRF-boundary coverage for the `/logo/{domain}` proxy.

No existing test covered this route at all before this item (confirmed by
searching `backend/tests/` for "logo" during A51's execution). This is a
behaviour-recording regression test only, added per this item's own brief
("a behaviour-recording regression test is allowed; a product fix is not");
it pins down what `app.routers.logos` currently does, it does not change it.

Two properties, matching `docs/security/PENTEST-METHODOLOGY.md`'s API-10
expected secure result:

  1. `_DOMAIN_RE` rejects the classic SSRF-shaped tricks (path traversal,
     userinfo `@` prefix, a scheme prefix, embedded whitespace/control
     characters, a colon-delimited port) with a plain 400, before any
     network call is attempted.

  2. Even for a domain STRING the regex does allow through — including one
     shaped like a private/link-local/metadata address, since the regex only
     restricts the character class, not the semantic meaning, of what it
     matches — the domain value is never used to select the outbound
     connection target. It is only ever appended as a path segment to the
     fixed host `img.logo.dev`, or passed as a query value to the fixed host
     `google.com`. This test proves that by capturing the actual URL/host
     `httpx.AsyncClient.get` is called with, for a metadata-shaped input,
     and asserting the host is always one of the two fixed upstreams, never
     the attacker-supplied value.

Local (mode L) only, per this item's own scope: SSRF controls are tested
with dependency stubs, never a live request toward an internal, loopback,
link-local or metadata address (PENTEST-METHODOLOGY.md section 3.4). No
network call is made by this test — `httpx.AsyncClient.get` is monkeypatched
throughout.
"""
import asyncio
from urllib.parse import urlsplit

import pytest

import app.routers.logos as logos


# ── property 1: the regex itself rejects SSRF-shaped tricks ────────────────

REJECTED_DOMAINS = [
    "../../etc/passwd",               # path traversal
    "evil.com@169.254.169.254",       # userinfo trick
    "http://169.254.169.254",         # scheme prefix
    "169.254.169.254:80",             # port (colon not in the allowed class)
    "evil.com/../../internal",        # embedded slash
    "evil\nX-Injected: 1",            # embedded control character
    "evil.com ",                      # trailing whitespace
    "",                               # empty (path param can't actually be
                                       # empty at the route level, but the
                                       # regex itself must not accept it)
]


@pytest.mark.parametrize("domain", REJECTED_DOMAINS)
def test_domain_regex_rejects_ssrf_shaped_input(domain):
    assert logos._DOMAIN_RE.match(domain) is None, (
        f"_DOMAIN_RE unexpectedly matched {domain!r} — this is the one gate "
        "logo_proxy relies on before any network call"
    )


@pytest.mark.parametrize("domain", [
    "example.com", "img.example.co.uk", "a.b-c.com",
    "169.254.169.254",  # allowed by the regex (digits+dots only) — see
                         # property 2 below for why this is still safe
])
def test_domain_regex_allows_ordinary_and_ip_shaped_domains(domain):
    assert logos._DOMAIN_RE.match(domain) is not None


# ── property 2: an allowed-but-dangerous-looking value never becomes the
#    actual connection target ───────────────────────────────────────────────

class _FakeResp:
    status_code = 200
    content = b"x" * 1000  # above both _fetch_logodev/_fetch_favicon's
                            # "too small = placeholder" thresholds


class _RecordingClient:
    """Stand-in for httpx.AsyncClient: records every URL `.get()` is called
    with, so the test can assert on the actual outbound host rather than
    trusting the source read alone."""

    calls: list[str] = []

    def __init__(self, *a, **kw):
        pass

    async def __aenter__(self):
        return self

    async def __aexit__(self, *a):
        return False

    async def get(self, url, follow_redirects=False):
        _RecordingClient.calls.append(url)
        return _FakeResp()


def test_metadata_shaped_domain_only_ever_reaches_fixed_upstream_hosts(monkeypatch, tmp_path):
    """`169.254.169.254` passes the regex (digits+dots only), so this proves
    the SECOND, load-bearing property instead: even for that value, the
    actual network call's host is always img.logo.dev or google.com, never
    the metadata address itself — logo_proxy has no code path that dials a
    caller-influenced host."""
    monkeypatch.setattr(logos, "_CACHE_ROOT", tmp_path)
    monkeypatch.setattr(logos, "LOGODEV_TOKEN", "fake-token-for-this-test")
    monkeypatch.setattr(logos.httpx, "AsyncClient", _RecordingClient)
    _RecordingClient.calls = []

    resp = asyncio.run(logos.logo_proxy("169.254.169.254"))

    assert resp.status_code == 200
    assert len(_RecordingClient.calls) == 1
    called_host = urlsplit(_RecordingClient.calls[0]).netloc
    assert called_host == "img.logo.dev", (
        f"logo_proxy dialed {called_host!r} instead of the fixed upstream — "
        "this would be a real SSRF primitive if it ever happened"
    )
    # The metadata string is present only as a path segment of a request
    # whose host is the fixed, non-attacker-controlled img.logo.dev.
    assert "/169.254.169.254" in _RecordingClient.calls[0]


def test_favicon_fallback_also_only_reaches_fixed_google_host(monkeypatch, tmp_path):
    monkeypatch.setattr(logos, "_CACHE_ROOT", tmp_path)
    monkeypatch.setattr(logos, "LOGODEV_TOKEN", "")  # force the Google fallback branch
    monkeypatch.setattr(logos.httpx, "AsyncClient", _RecordingClient)
    _RecordingClient.calls = []

    resp = asyncio.run(logos.logo_proxy("169.254.169.254"))

    assert resp.status_code == 200
    assert len(_RecordingClient.calls) == 1
    called_host = urlsplit(_RecordingClient.calls[0]).netloc
    assert called_host == "www.google.com"
    assert "domain=169.254.169.254" in _RecordingClient.calls[0]
