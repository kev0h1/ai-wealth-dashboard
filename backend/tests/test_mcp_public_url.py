"""F8: MCP_PUBLIC_URL / MCP_ORIGIN — the connector's own public URL, kept
separate from API_PUBLIC_URL so a dedicated hostname (e.g.
https://mcp.wealth.auriqltd.co.uk) can be pointed at the same backend
without touching the API host. Covers:

  - `config._origin_of`, the pure scheme+host parsing helper, on its own
    (same convention as `config._parse_flag` in test_mcp_connector_flag.py);
  - that MCP_PUBLIC_URL/MCP_ORIGIN default to today's behaviour (derived
    from API_PUBLIC_URL) when MCP_PUBLIC_URL is unset;
  - that app.core.auth.MCP_WWW_AUTHENTICATE and
    app.routers.oauth.oauth_protected_resource_metadata() are actually
    built from those config values, including the case where MCP_PUBLIC_URL
    points at a dedicated host different from API_PUBLIC_URL.

Per tests/test_allowed_email_resolution.py's established convention, this
does NOT reload app.core.config via env vars + importlib.reload (that would
re-run its side-effecting secret/key generation). Live-override behaviour
is instead exercised by monkeypatching the already-imported names on the
consuming modules (app.routers.oauth reads MCP_PUBLIC_URL/API_PUBLIC_URL at
call time, so this works there); app.core.auth's WWW-Authenticate value is
a module-level string fixed at import time, so its test instead asserts it
was built from config.API_PUBLIC_URL, not from a live override.

F11: MCP_WWW_AUTHENTICATE used to be built from MCP_ORIGIN (scheme+host
only, path stripped), which 404s on UAT and prod because both sit behind a
reverse proxy that only forwards paths under /api to this service, so the
well-known document is only reachable under API_PUBLIC_URL's own path. It
is now built from API_PUBLIC_URL (path-preserving). See
test_www_authenticate_is_built_from_api_public_url_not_mcp_origin below.
"""
import asyncio

import app.core.auth as auth_mod
import app.core.config as config
import app.routers.oauth as oauth


def _run(coro):
    return asyncio.run(coro)


# ── _origin_of, the pure parsing helper ──────────────────────────────────

def test_origin_of_strips_path_and_query():
    assert config._origin_of("https://api.wealth.auriqltd.co.uk/mcp") == "https://api.wealth.auriqltd.co.uk"
    assert config._origin_of("https://mcp.wealth.auriqltd.co.uk/mcp?x=1") == "https://mcp.wealth.auriqltd.co.uk"


def test_origin_of_keeps_explicit_port():
    assert config._origin_of("http://localhost:8000/mcp") == "http://localhost:8000"


# ── defaults (today's behaviour, unchanged) ──────────────────────────────

def test_mcp_public_url_defaults_to_api_public_url_slash_mcp():
    assert config.MCP_PUBLIC_URL == f"{config.API_PUBLIC_URL}/mcp"


def test_mcp_origin_defaults_to_the_same_origin_as_api_public_url():
    assert config.MCP_ORIGIN == config._origin_of(config.API_PUBLIC_URL)


# ── wiring: auth.py's discovery header is built from API_PUBLIC_URL ─────

def test_www_authenticate_is_built_from_api_public_url_not_mcp_origin():
    expected = f'Bearer resource_metadata="{config.API_PUBLIC_URL}/.well-known/oauth-protected-resource"'
    assert auth_mod.MCP_WWW_AUTHENTICATE == expected


def test_www_authenticate_is_path_aware_not_origin_only():
    """F11 regression guard: the header must resolve under API_PUBLIC_URL's
    own path (e.g. .../api/.well-known/...), not just its bare origin, so
    it still resolves behind a reverse proxy that only forwards /api to
    this service. MCP_WWW_AUTHENTICATE is fixed at import time from the
    live env (see module docstring), so this asserts the structural
    property directly rather than simulating a live override.
    """
    assert auth_mod.MCP_WWW_AUTHENTICATE.startswith(
        f'Bearer resource_metadata="{config.API_PUBLIC_URL}/.well-known/'
    )
    if config.MCP_ORIGIN != config.API_PUBLIC_URL:
        assert not auth_mod.MCP_WWW_AUTHENTICATE.startswith(
            f'Bearer resource_metadata="{config.MCP_ORIGIN}/.well-known/'
        )


# ── wiring: oauth.py's protected-resource metadata reflects a dedicated host ──

def test_protected_resource_metadata_uses_mcp_public_url(monkeypatch):
    monkeypatch.setattr(oauth, "MCP_PUBLIC_URL", "https://mcp.wealth.auriqltd.co.uk/mcp")
    meta = _run(oauth.oauth_protected_resource_metadata())
    assert meta["resource"] == "https://mcp.wealth.auriqltd.co.uk/mcp"


def test_protected_resource_metadata_keeps_authorization_servers_on_api_host(monkeypatch):
    """The OAuth endpoints (authorize/token/register/revoke) never move to
    the dedicated connector host — only `resource` does."""
    monkeypatch.setattr(oauth, "MCP_PUBLIC_URL", "https://mcp.wealth.auriqltd.co.uk/mcp")
    monkeypatch.setattr(oauth, "API_PUBLIC_URL", "https://api.wealth.auriqltd.co.uk")
    meta = _run(oauth.oauth_protected_resource_metadata())
    assert meta["authorization_servers"] == ["https://api.wealth.auriqltd.co.uk"]
    assert meta["resource"] != meta["authorization_servers"][0]
