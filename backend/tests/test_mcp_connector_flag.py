"""A17: the MCP connector (F2's OAuth 2.1 authorisation server,
app/routers/oauth.py, and F3's `/mcp` Streamable HTTP connector,
app/routers/mcp.py) must be entirely absent from the deployed app unless
`MCP_CONNECTOR_ENABLED` is explicitly turned on. Production ships with it
off by default (Finexer compliance answers say "planned", not live), so
these tests exercise the actual off-by-default app object (`app.main.app`,
built once at import time with no env override, the same object uvicorn
serves) via `starlette.testclient.TestClient`, plus a throwaway app built
with the flag forced on to prove the wiring in app/main.py's `_routers()`
factory is not simply always-on or always-off.

This is the one test file in this suite that goes through TestClient rather
than calling router functions directly (see tests/test_oauth_server.py and
tests/test_mcp_endpoint.py for that convention), because the behaviour
under test (whether a route exists at all, what status code an unmatched
path returns) is a property of the whole ASGI app, not of any one
function. TestClient()
is used without a `with` block, so FastAPI's startup lifespan (Mongo index
creation) never runs and no real database is needed.
"""
from starlette.testclient import TestClient

import app.main as main_module
from app.core.config import serializer
from app.main import app


def _session_bearer() -> str:
    token = serializer.dumps({"email": "kevin.maingi12@gmail.com", "name": "Kevin"})
    return f"Bearer {token}"


# ── flag off (the module-level `app`, built with the default false) ────────

def test_flag_defaults_false():
    from app.core.config import MCP_CONNECTOR_ENABLED
    assert MCP_CONNECTOR_ENABLED is False


def test_route_table_has_no_mcp_or_oauth_paths_when_flag_off():
    paths = {r.path for r in app.routes}
    assert "/mcp" not in paths
    assert not any(p.startswith("/mcp") for p in paths)
    assert not any(p.startswith("/auth/oauth") for p in paths)
    assert not any(p.startswith("/.well-known/oauth") for p in paths)
    assert not any(p.startswith("/oauth/") for p in paths)


def test_well_known_oauth_authorization_server_not_served_when_flag_off():
    client = TestClient(app)
    resp = client.post("/mcp")  # unauthenticated, exercised separately below
    assert resp.status_code != 200
    resp = client.get("/.well-known/oauth-authorization-server")
    assert resp.status_code != 200
    assert resp.status_code == 401  # falls through to the plain bearer check


def test_well_known_oauth_protected_resource_not_served_when_flag_off():
    client = TestClient(app)
    resp = client.get("/.well-known/oauth-protected-resource")
    assert resp.status_code != 200
    assert resp.status_code == 401


def test_mcp_post_with_valid_session_bearer_is_404_when_flag_off():
    """A session token that would pass the middleware everywhere else still
    404s here: the middleware lets it through (it's a valid session
    token), but there is no /mcp route registered at all for it to land
    on."""
    client = TestClient(app)
    resp = client.post("/mcp", headers={"Authorization": _session_bearer()})
    assert resp.status_code == 404


def test_mcp_post_unauthenticated_is_401_not_a_discovery_401():
    """With the connector off, an unauthenticated /mcp request gets the
    same plain 401 as any other unknown protected path, with no
    WWW-Authenticate discovery header (that header only makes sense once a
    connector actually exists to discover)."""
    client = TestClient(app)
    resp = client.post("/mcp")
    assert resp.status_code == 401
    assert "www-authenticate" not in {k.lower() for k in resp.headers.keys()}


def test_openapi_route_table_excludes_mcp_and_oauth_when_flag_off():
    schema_paths = set(app.openapi()["paths"].keys())
    assert not any(p.startswith("/mcp") for p in schema_paths)
    assert not any(p.startswith("/auth/oauth") for p in schema_paths)
    assert not any(p.startswith("/.well-known/oauth") for p in schema_paths)


# ── flag on: prove _routers() actually adds them back ──────────────────────

def test_routers_factory_omits_mcp_and_oauth_when_disabled():
    routers = main_module._routers(False)
    assert main_module.mcp_router.router not in routers
    assert main_module.oauth_router.router not in routers


def test_routers_factory_includes_mcp_and_oauth_when_enabled():
    routers = main_module._routers(True)
    assert main_module.mcp_router.router in routers
    assert main_module.oauth_router.router in routers


def test_fresh_app_with_flag_on_serves_the_discovery_document():
    from fastapi import FastAPI

    fresh = FastAPI()
    for router in main_module._routers(True):
        fresh.include_router(router)
    paths = {r.path for r in fresh.routes}
    assert "/mcp" in paths
    assert "/.well-known/oauth-authorization-server" in paths
    assert "/auth/oauth/register" in paths

    client = TestClient(fresh)
    resp = client.get("/.well-known/oauth-authorization-server")
    assert resp.status_code == 200
    assert resp.json()["registration_endpoint"].endswith("/auth/oauth/register")
