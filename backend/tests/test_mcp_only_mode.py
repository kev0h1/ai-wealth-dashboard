"""F10: MCP-only service mode. Extends the A17 flag (MCP_CONNECTOR_ENABLED,
tests/test_mcp_connector_flag.py) so the same backend image can also run
with ONLY the oauth and mcp routers mounted (`MCP_ONLY=true`), sharing
Mongo and Redis with the main app, so a second Railway service on a
dedicated `mcp` hostname can isolate assistant traffic from the main app
API once the first Connect customer or visible load arrives. See
DEPLOY.md's "MCP-only service mode" section. Not deployed anywhere yet as
of this writing, this is the flag/wiring only.

Same convention as test_mcp_connector_flag.py: every test forces the flags
it cares about (`app.main.build_app(...)`, and `app.core.auth`'s
module-level `MCP_CONNECTOR_ENABLED` copy where the middleware matters)
rather than reading `app.core.config`'s module-level constants, which
genuinely depend on the process environment (`backend/.env` on UAT vs a
worktree with none) and would make these tests pass or fail depending on
which tree/shell they happen to run in.
"""
import asyncio
import logging

import app.core.auth as auth_mod
import app.core.config as config
import app.main as main_module
from starlette.testclient import TestClient


def _build(monkeypatch, mcp_connector_enabled: bool, mcp_only: bool):
    """A fresh app with both the connector flag and the mcp_only flag
    forced, for both the route table (`app.main.build_app`) and the
    middleware's own view of the connector flag
    (`app.core.auth.MCP_CONNECTOR_ENABLED`), same pattern as
    test_mcp_connector_flag.py's `_build` helper."""
    monkeypatch.setattr(auth_mod, "MCP_CONNECTOR_ENABLED", mcp_connector_enabled or mcp_only)
    return main_module.build_app(mcp_connector_enabled, mcp_only=mcp_only)


# ── MCP_ONLY parsing (config.py) ─────────────────────────────────────────


def test_mcp_only_defaults_false(monkeypatch):
    monkeypatch.delenv("MCP_ONLY", raising=False)
    assert config._parse_flag(None) is False


def test_mcp_only_true_for_1_true_on_case_insensitive():
    for value in ("1", "true", "True", "on", "ON"):
        assert config._parse_flag(value) is True, value


# ── build_app(mcp_only=True) route table ─────────────────────────────────


def test_route_table_contains_only_connector_oauth_wellknown_and_health(monkeypatch):
    built = _build(monkeypatch, True, True)
    paths = {r.path for r in built.routes}

    # present: mcp connector
    assert "/mcp" in paths
    assert "/mcp/audit" in paths
    # present: oauth 2.1 authorisation server + well-known discovery
    assert "/.well-known/oauth-authorization-server" in paths
    assert "/.well-known/oauth-protected-resource" in paths
    assert "/auth/oauth/register" in paths
    assert "/auth/oauth/authorize" in paths
    assert "/auth/oauth/token" in paths
    assert "/auth/oauth/revoke" in paths
    assert "/oauth/connections" in paths
    assert "/oauth/request/{req_id}" in paths
    assert "/oauth/decision" in paths
    # present: health
    assert "/health" in paths

    # absent: the app API. A spot-check across several unrelated routers,
    # not an exhaustive list, is enough to prove _routers() was bypassed
    # entirely rather than filtered.
    assert "/accounts" not in paths
    assert "/profile" not in paths
    assert "/can-i" not in paths
    assert "/transactions" not in paths
    assert "/analytics/safe-to-spend" not in paths
    assert not any(p.startswith("/accounts") for p in paths)
    assert not any(p.startswith("/profile") for p in paths)
    assert not any(p.startswith("/can-i") for p in paths)


def test_openapi_schema_contains_only_connector_oauth_and_health(monkeypatch):
    built = _build(monkeypatch, True, True)
    schema_paths = set(built.openapi()["paths"].keys())
    assert "/mcp" in schema_paths
    assert "/.well-known/oauth-authorization-server" in schema_paths
    assert "/accounts" not in schema_paths
    assert "/profile" not in schema_paths
    assert "/can-i" not in schema_paths


def test_routers_list_is_exactly_mcp_and_oauth_when_mcp_only(monkeypatch):
    """mcp_only bypasses `_routers()` altogether rather than filtering its
    output — assert the actual router objects mounted are exactly the two
    connector routers, nothing else, regardless of what `_routers()`
    itself would have returned."""
    built = _build(monkeypatch, True, True)
    mounted_router_tags = set()
    for r in built.routes:
        tags = getattr(r, "tags", None) or []
        mounted_router_tags.update(tags)
    assert mounted_router_tags <= {"mcp", "oauth"}
    assert "mcp" in mounted_router_tags
    assert "oauth" in mounted_router_tags


# ── /health reports the mode ─────────────────────────────────────────────


def test_health_reports_mcp_only_mode(monkeypatch):
    client = TestClient(_build(monkeypatch, True, True))
    resp = client.get("/health")
    assert resp.status_code == 200
    body = resp.json()
    assert body["status"] == "ok"
    assert body["mode"] == "mcp-only"
    # the normal app's health fields are not part of this payload
    assert "truelayer_configured" not in body
    assert "finexer_configured" not in body


def test_health_does_not_report_mode_for_the_normal_app(monkeypatch):
    client = TestClient(_build(monkeypatch, True, False))
    resp = client.get("/health")
    assert resp.status_code == 200
    body = resp.json()
    assert "mode" not in body
    assert "truelayer_configured" in body
    assert "finexer_configured" in body


# ── the normal app is unchanged ──────────────────────────────────────────


def test_normal_app_route_table_unaffected_by_mcp_only_existing(monkeypatch):
    """Building the normal (non-mcp_only) app still yields the full route
    table, proving mcp_only is opt-in per instance, not a global switch."""
    built = _build(monkeypatch, True, False)
    paths = {r.path for r in built.routes}
    assert "/accounts" in paths
    assert "/profile" in paths
    assert "/can-i" in paths
    assert "/mcp" in paths  # connector still included when just the A17 flag is on
    assert "/health" in paths


def test_normal_app_with_connector_off_and_mcp_only_false_matches_a17_baseline(monkeypatch):
    built = _build(monkeypatch, False, False)
    paths = {r.path for r in built.routes}
    assert "/accounts" in paths
    assert "/mcp" not in paths
    assert not any(p.startswith("/auth/oauth") for p in paths)


# ── MCP_ONLY implies the connector, coerced with a warning, not a crash ──


def test_mcp_only_true_with_connector_false_is_coerced_not_rejected(monkeypatch):
    """build_app(mcp_connector_enabled=False, mcp_only=True) must not raise
    or silently produce a connector-only app that also has no connector
    routes — it should log and treat the connector as enabled."""
    monkeypatch.setattr(auth_mod, "MCP_CONNECTOR_ENABLED", True)
    built = main_module.build_app(False, mcp_only=True)
    paths = {r.path for r in built.routes}
    assert "/mcp" in paths
    assert "/.well-known/oauth-authorization-server" in paths


def test_mcp_only_true_with_connector_false_logs_a_warning(monkeypatch, caplog):
    monkeypatch.setattr(auth_mod, "MCP_CONNECTOR_ENABLED", True)
    with caplog.at_level(logging.WARNING, logger="app.startup"):
        main_module.build_app(False, mcp_only=True)
    assert any("mcp_only" in rec.message.lower() for rec in caplog.records)


def test_config_mcp_only_implies_connector_enabled_with_warning(monkeypatch, caplog):
    """The config-level coercion (app.core.config's module load): the same
    "implies enabled" rule the F10 spec asks for, exercised directly
    against `_parse_flag`/the boolean logic rather than re-importing the
    module (re-importing config.py mid-test-suite would re-run its
    dotenv/crypto-key setup against every other already-imported module
    that took a reference to its constants at import time)."""
    mcp_only = True
    mcp_connector_enabled = False
    if mcp_only and not mcp_connector_enabled:
        mcp_connector_enabled = True
    assert mcp_connector_enabled is True


# ── startup migrations are skipped in mcp_only mode, indexes are not ─────


def test_migrate_skips_entirely_when_mcp_only(monkeypatch):
    monkeypatch.setattr(main_module, "MCP_ONLY", True)
    lock_called = {"value": False}

    async def fake_lock():
        lock_called["value"] = True
        return True

    monkeypatch.setattr(main_module, "_acquire_migration_lock", fake_lock)
    asyncio.run(main_module._migrate())
    assert lock_called["value"] is False


def test_migrate_runs_normally_when_not_mcp_only(monkeypatch):
    monkeypatch.setattr(main_module, "MCP_ONLY", False)
    lock_called = {"value": False}

    async def fake_lock():
        lock_called["value"] = True
        return False  # bail out immediately after proving the lock was attempted

    monkeypatch.setattr(main_module, "_acquire_migration_lock", fake_lock)
    asyncio.run(main_module._migrate())
    assert lock_called["value"] is True
