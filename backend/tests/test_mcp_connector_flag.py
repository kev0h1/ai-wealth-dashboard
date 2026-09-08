"""A17: the MCP connector (F2's OAuth 2.1 authorisation server,
app/routers/oauth.py, and F3's `/mcp` Streamable HTTP connector,
app/routers/mcp.py) must be entirely absent from the deployed app unless
`MCP_CONNECTOR_ENABLED` is explicitly turned on. Production ships with it
off by default (Finexer compliance answers say "planned", not live).

Every test here forces the flag it cares about rather than reading
`app.core.config.MCP_CONNECTOR_ENABLED` (fixed at import time from whatever
`os.getenv("MCP_CONNECTOR_ENABLED")` held then) or the module-level
`app.main.app` singleton built from it. That constant genuinely depends on
the process environment: UAT's `backend/.env` sets it, the shared tree
loads that file, and a session worktree has no `.env` of its own, so the
same test reading the constant directly passes or fails depending on which
tree and which shell it happens to run in (see the 2026-09-08 integrate
failure this file was rewritten to fix). Instead:
  - the parsing rule itself (`config._parse_flag`) is tested as a pure
    function against an explicit, monkeypatched-absent env var;
  - the route-table/middleware tests build a throwaway app via
    `app.main.build_app(enabled)` and separately force
    `app.core.auth.MCP_CONNECTOR_ENABLED` to the same value (the
    middleware is one shared function object that reads that name at call
    time, not something `build_app` can parameterize per instance).

This is the one test file in this suite that goes through
`starlette.testclient.TestClient` rather than calling router functions
directly (see tests/test_oauth_server.py and tests/test_mcp_endpoint.py for
that convention), because the behaviour under test (whether a route exists
at all, what status code an unmatched path returns) is a property of the
whole ASGI app, not of any one function. TestClient() is used without a
`with` block, so FastAPI's startup lifespan (Mongo index creation) never
runs and no real database is needed.
"""
import os

import app.core.auth as auth_mod
import app.core.config as config
import app.main as main_module
from starlette.testclient import TestClient


def _session_bearer() -> str:
    token = config.serializer.dumps({"email": "kevin.maingi12@gmail.com", "name": "Kevin"})
    return f"Bearer {token}"


def _build(monkeypatch, enabled: bool):
    """A fresh app with the connector flag forced to `enabled`, for both
    the route table (`app.main.build_app`) and the middleware's own view of
    the flag (`app.core.auth.MCP_CONNECTOR_ENABLED`), independent of
    whatever `app.core.config.MCP_CONNECTOR_ENABLED` happens to be."""
    monkeypatch.setattr(auth_mod, "MCP_CONNECTOR_ENABLED", enabled)
    return main_module.build_app(enabled)


# ── the parsing rule on its own, no process env involved ────────────────────

def test_parse_flag_defaults_false_when_env_var_is_unset(monkeypatch):
    monkeypatch.delenv("MCP_CONNECTOR_ENABLED", raising=False)
    assert config._parse_flag(os.getenv("MCP_CONNECTOR_ENABLED")) is False


def test_parse_flag_true_for_1_true_on_case_insensitive():
    for value in ("1", "true", "True", "TRUE", "on", "On", "ON"):
        assert config._parse_flag(value) is True, value


def test_parse_flag_false_for_none_empty_or_anything_else():
    for value in (None, "", "0", "false", "off", "yes"):
        assert config._parse_flag(value) is False, value


# ── flag forced off ──────────────────────────────────────────────────────

def test_route_table_has_no_mcp_or_oauth_paths_when_flag_off(monkeypatch):
    built = _build(monkeypatch, False)
    paths = {r.path for r in built.routes}
    assert "/mcp" not in paths
    assert not any(p.startswith("/mcp") for p in paths)
    assert not any(p.startswith("/auth/oauth") for p in paths)
    assert not any(p.startswith("/.well-known/oauth") for p in paths)
    assert not any(p.startswith("/oauth/") for p in paths)


def test_well_known_oauth_authorization_server_not_served_when_flag_off(monkeypatch):
    client = TestClient(_build(monkeypatch, False))
    resp = client.get("/.well-known/oauth-authorization-server")
    assert resp.status_code != 200
    assert resp.status_code == 401  # falls through to the plain bearer check


def test_well_known_oauth_protected_resource_not_served_when_flag_off(monkeypatch):
    client = TestClient(_build(monkeypatch, False))
    resp = client.get("/.well-known/oauth-protected-resource")
    assert resp.status_code != 200
    assert resp.status_code == 401


def test_mcp_post_with_valid_session_bearer_is_404_when_flag_off(monkeypatch):
    """A session token that would pass the middleware everywhere else still
    404s here: the middleware lets it through (it's a valid session
    token), but there is no /mcp route registered at all for it to land
    on."""
    client = TestClient(_build(monkeypatch, False))
    resp = client.post("/mcp", headers={"Authorization": _session_bearer()})
    assert resp.status_code == 404


def test_mcp_post_unauthenticated_is_401_not_a_discovery_401_when_flag_off(monkeypatch):
    """With the connector off, an unauthenticated /mcp request gets the
    same plain 401 as any other unknown protected path, with no
    WWW-Authenticate discovery header (that header only makes sense once a
    connector actually exists to discover)."""
    client = TestClient(_build(monkeypatch, False))
    resp = client.post("/mcp")
    assert resp.status_code == 401
    assert "www-authenticate" not in {k.lower() for k in resp.headers.keys()}


def test_openapi_route_table_excludes_mcp_and_oauth_when_flag_off(monkeypatch):
    built = _build(monkeypatch, False)
    schema_paths = set(built.openapi()["paths"].keys())
    assert not any(p.startswith("/mcp") for p in schema_paths)
    assert not any(p.startswith("/auth/oauth") for p in schema_paths)
    assert not any(p.startswith("/.well-known/oauth") for p in schema_paths)


# ── flag forced on: proves the wiring is not simply always-on/always-off ───

def test_routers_factory_omits_mcp_and_oauth_when_disabled():
    routers = main_module._routers(False)
    assert main_module.mcp_router.router not in routers
    assert main_module.oauth_router.router not in routers


def test_routers_factory_includes_mcp_and_oauth_when_enabled():
    routers = main_module._routers(True)
    assert main_module.mcp_router.router in routers
    assert main_module.oauth_router.router in routers


def test_app_with_flag_on_serves_the_discovery_document(monkeypatch):
    built = _build(monkeypatch, True)
    paths = {r.path for r in built.routes}
    assert "/mcp" in paths
    assert "/.well-known/oauth-authorization-server" in paths
    assert "/auth/oauth/register" in paths

    client = TestClient(built)
    resp = client.get("/.well-known/oauth-authorization-server")
    assert resp.status_code == 200
    assert resp.json()["registration_endpoint"].endswith("/auth/oauth/register")


def test_mcp_post_unauthenticated_carries_discovery_header_when_flag_on(monkeypatch):
    """The counterpart of the flag-off 401 test above: once the connector
    is actually on, the same unauthenticated request does carry the
    WWW-Authenticate discovery header."""
    client = TestClient(_build(monkeypatch, True))
    resp = client.post("/mcp")
    assert resp.status_code == 401
    assert "www-authenticate" in {k.lower() for k in resp.headers.keys()}
