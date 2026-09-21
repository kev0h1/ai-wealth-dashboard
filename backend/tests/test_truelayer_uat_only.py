"""A67: TrueLayer is a UAT-only provider; Finexer is the only provider
production ever talks to.

Kevin's governing constraint on this item was that "behind a flag is not
enough if the flag could be switched on in production, so enforce absence
rather than rely on configuration". So there is no `TRUELAYER_ENABLED` env
var to set: `app.core.config.TRUELAYER_ENABLED` is DERIVED from APP_URL,
the public host this process actually serves, and production's APP_URL
(https://wealth.auriqltd.co.uk) is not on the non-production allow-list.

Conventions follow tests/test_mcp_connector_flag.py, for the same reason
that file gives at length: a test that read the module-level constant
would pass or fail depending on which tree it ran in (the shared tree
loads `backend/.env`, which sets APP_URL to the UAT host; a session
worktree has no `.env` of its own and falls back to the production
default). So:
  - the derivation rule itself (`config._is_non_production`) is tested as
    a pure function against explicit URLs;
  - the route-table tests build a throwaway app via
    `app.main.build_app(..., truelayer_enabled=...)` with the value forced
    either way, never inherited.

TestClient() is used without a `with` block, so FastAPI's startup lifespan
(Mongo index creation) never runs and no real database is needed.
"""
import app.core.config as config
import app.main as main_module
import app.routers.webhooks as webhooks_module
from starlette.testclient import TestClient


def _build(truelayer_enabled: bool):
    """A fresh app with the TrueLayer mount forced either way, and the MCP
    connector pinned off so this file never depends on A17's flag."""
    return main_module.build_app(False, truelayer_enabled=truelayer_enabled)


def _paths(app) -> set[str]:
    return {r.path for r in app.routes}


# ── the derivation rule on its own, no process env involved ────────────────

def test_production_app_url_is_not_non_production():
    assert config._is_non_production("https://wealth.auriqltd.co.uk") is False


def test_uat_app_url_is_non_production():
    assert config._is_non_production("https://uat.wealth.auriqltd.co.uk") is True


def test_localhost_app_urls_are_non_production():
    for url in ("http://localhost:3000", "http://127.0.0.1:8000", "http://localhost"):
        assert config._is_non_production(url) is True, url


def test_derivation_fails_closed_on_unknown_or_malformed_hosts():
    """An allow-list of non-production hosts, not a deny-list of the
    production one: a typo'd, empty or attacker-supplied APP_URL mounts
    nothing rather than quietly enabling TrueLayer."""
    for url in ("", "not-a-url", "https://", "https://wealth.auriqltd.co.uk.evil.com",
                "https://uat.wealth.auriqltd.co.uk.evil.com", "https://staging.example.com"):
        assert config._is_non_production(url) is False, url


def test_host_match_is_case_insensitive():
    assert config._is_non_production("https://UAT.Wealth.AuriqLtd.co.uk") is True


def test_truelayer_enabled_constant_tracks_the_rule_for_this_process():
    """Whatever APP_URL this tree happens to carry, the constant and the
    rule must agree — the constant is only ever the rule applied to
    APP_URL, never an independent switch."""
    assert config.TRUELAYER_ENABLED == config._is_non_production(config.APP_URL)


# ── production: absent, not merely unauthenticated ─────────────────────────

def test_route_table_has_no_truelayer_paths_in_production():
    paths = _paths(_build(False))
    assert not any(p.startswith("/auth/truelayer") for p in paths)
    assert not any("truelayer" in p for p in paths)


def test_truelayer_webhook_is_absent_in_production():
    paths = _paths(_build(False))
    assert "/webhooks/truelayer/{secret}" not in paths


def test_finexer_webhook_is_still_mounted_in_production():
    """Turning TrueLayer off must cost production nothing: the Finexer
    receiver lives on the unconditionally-mounted `webhooks.router`."""
    assert "/webhooks/finexer/{secret}" in _paths(_build(False))


def test_finexer_connect_routes_are_still_mounted_in_production():
    paths = _paths(_build(False))
    assert "/auth/finexer/link" in paths


def test_routers_factory_omits_truelayer_when_disabled():
    routers = main_module._routers(False, truelayer_enabled=False)
    assert main_module.truelayer.router not in routers
    assert webhooks_module.truelayer_router not in routers
    assert webhooks_module.router in routers


def test_truelayer_link_is_404_not_402_in_production():
    """A signed-in user hitting the old connect endpoint gets "no such
    route", not a tier/auth error that would imply the provider exists."""
    client = TestClient(_build(False))
    token = config.serializer.dumps({"email": "kevin.maingi12@gmail.com", "name": "Kevin"})
    resp = client.get("/auth/truelayer/link", headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 404


def test_truelayer_webhook_post_is_404_in_production():
    client = TestClient(_build(False))
    resp = client.post("/webhooks/truelayer/anything", json={})
    assert resp.status_code == 404


def test_openapi_route_table_excludes_truelayer_in_production():
    schema_paths = set(_build(False).openapi()["paths"].keys())
    assert not any("truelayer" in p for p in schema_paths)


def test_health_does_not_claim_truelayer_is_configured_in_production():
    client = TestClient(_build(False))
    body = client.get("/health").json()
    assert body["truelayer_configured"] is False


# ── UAT: present, proving the wiring is not simply always-off ──────────────

def test_route_table_has_truelayer_paths_on_uat():
    paths = _paths(_build(True))
    assert "/auth/truelayer/providers" in paths
    assert "/auth/truelayer/link" in paths
    assert "/auth/truelayer/callback" in paths


def test_truelayer_webhook_is_mounted_on_uat():
    assert "/webhooks/truelayer/{secret}" in _paths(_build(True))


def test_routers_factory_includes_truelayer_when_enabled():
    routers = main_module._routers(False, truelayer_enabled=True)
    assert main_module.truelayer.router in routers
    assert webhooks_module.truelayer_router in routers


def test_truelayer_webhook_rejects_a_wrong_secret_on_uat_rather_than_404():
    """The counterpart of the production 404: on UAT the route exists, so
    a bad secret is a 401 from the route's own check (the behaviour
    tests/test_truelayer_webhook.py covers in detail)."""
    client = TestClient(_build(True))
    resp = client.post("/webhooks/truelayer/definitely-not-the-secret", json={})
    assert resp.status_code == 401
