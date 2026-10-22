"""E10: owner-editable runtime settings (app/services/runtime_settings.py and
the /ops/settings routes). Fake in-memory collections and an injected clock,
no database and no network."""
import asyncio

import pytest
from fastapi import HTTPException

import app.routers.ops as ops
from app.services import runtime_settings as rs

OWNER = "kevin.maingi12@gmail.com"


class FakeCursor:
    def __init__(self, docs):
        self._docs = docs

    async def to_list(self, _n):
        return [dict(d) for d in self._docs]


class FakeCol:
    """The few Motor calls the service uses, keyed by _id (append for inserts)."""

    def __init__(self, fail=False):
        self.docs: dict = {}
        self.inserted: list = []
        self.fail = fail
        self.find_calls = 0

    def _check(self):
        if self.fail:
            raise RuntimeError("mongo down")

    def find(self, _q):
        self._check()
        self.find_calls += 1
        return FakeCursor(list(self.docs.values()))

    async def find_one(self, q):
        self._check()
        d = self.docs.get(q["_id"])
        return dict(d) if d else None

    async def update_one(self, q, upd, upsert=False):
        self._check()
        d = self.docs.setdefault(q["_id"], {"_id": q["_id"]})
        d.update(upd["$set"])

    async def delete_one(self, q):
        self._check()
        self.docs.pop(q["_id"], None)

    async def replace_one(self, q, doc, upsert=False):
        self._check()
        self.docs[q["_id"]] = dict(doc)

    async def insert_one(self, doc):
        self._check()
        self.inserted.append(dict(doc))


class Clock:
    def __init__(self):
        self.t = 1000.0

    def __call__(self):
        return self.t


@pytest.fixture(autouse=True)
def _fresh(monkeypatch):
    rs.reset_cache()
    clock = Clock()
    rs.set_clock(clock)
    for name in list(rs.REGISTRY):
        monkeypatch.delenv(name, raising=False)
    monkeypatch.setattr(ops, "PRIMARY_EMAIL", OWNER)
    yield clock
    rs.set_clock(None)
    rs.reset_cache()


def run(coro):
    return asyncio.run(coro)


def _wire(monkeypatch, col, audit):
    monkeypatch.setattr(rs, "_settings_col", lambda: col)
    monkeypatch.setattr(rs, "_audit_col", lambda: audit)


# ── registry ────────────────────────────────────────────────────────────────

def test_registry_never_overlaps_denylist():
    for key in rs.REGISTRY:
        assert not rs.is_denylisted(key)
    for key in ["PLAY_ALLOW_TEST_PURCHASES", "APPLE_ALLOWED_ENVIRONMENTS", "TRUSTED_PROXY_HOPS",
                "TRUSTED_PROXY_HOPS_WEB", "APP_URL", "PLAY_RTDN_OIDC_AUDIENCE", "PLAY_RTDN_OIDC_EMAIL",
                "MCP_CONNECTOR_ENABLED", "DEFAULT_TIER", "ENABLE_API_DOCS", "DEV_MODE",
                "STRIPE_SECRET_KEY", "OPENROUTER_API_KEY", "MONGO_URI", "SESSION_SECRET"]:
        assert rs.is_denylisted(key), key


def test_env_drift_names_match_registry():
    import importlib.util
    import sys
    from pathlib import Path

    path = Path(__file__).resolve().parents[2] / "scripts" / "env_drift.py"
    spec = importlib.util.spec_from_file_location("env_drift_e10", path)
    mod = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = mod
    spec.loader.exec_module(mod)
    assert mod.RUNTIME_SETTING_NAMES == frozenset(rs.REGISTRY)


# ── precedence ──────────────────────────────────────────────────────────────

def test_precedence_database_over_env_over_default(monkeypatch):
    col, audit = FakeCol(), FakeCol()
    _wire(monkeypatch, col, audit)
    assert rs.setting("ALERT_HOURLY_CAP") == 5                       # default
    monkeypatch.setenv("ALERT_HOURLY_CAP", "9")
    assert rs.setting("ALERT_HOURLY_CAP") == 9                       # env
    col.docs["ALERT_HOURLY_CAP"] = {"_id": "ALERT_HOURLY_CAP", "key": "ALERT_HOURLY_CAP", "value": 12}
    run(rs.ensure_fresh())
    assert rs.setting("ALERT_HOURLY_CAP") == 12                      # database
    assert rs.resolve("ALERT_HOURLY_CAP") == (12, "database")
    del col.docs["ALERT_HOURLY_CAP"]
    run(rs.ensure_fresh(force=True))
    assert rs.resolve("ALERT_HOURLY_CAP") == (9, "env")
    monkeypatch.delenv("ALERT_HOURLY_CAP")
    assert rs.resolve("ALERT_HOURLY_CAP") == (5, "default")


def test_caller_env_constant_is_the_env_layer(monkeypatch):
    assert rs.setting("OPEN_SIGNUP", env=True) is True
    rs._state["values"]["OPEN_SIGNUP"] = False
    assert rs.setting("OPEN_SIGNUP", env=True) is False


def test_bad_env_falls_to_default(monkeypatch):
    monkeypatch.setenv("ALERT_HOURLY_CAP", "nonsense")
    assert rs.setting("ALERT_HOURLY_CAP") == 5
    monkeypatch.setenv("ALERT_ERROR_RATE", "0")
    assert rs.setting("ALERT_ERROR_RATE") == 0.10
    monkeypatch.setenv("LLM_GLOBAL_MONTHLY_CALL_CEILING", "0")
    assert rs.setting("LLM_GLOBAL_MONTHLY_CALL_CEILING") == 0        # env may keep it disabled


# ── validation ──────────────────────────────────────────────────────────────

@pytest.mark.parametrize("key,value", [
    ("LLM_GLOBAL_MONTHLY_CALL_CEILING", 0),
    ("LLM_GLOBAL_MONTHLY_CALL_CEILING", -5),
    ("LLM_GLOBAL_MONTHLY_CALL_CEILING", 1.5),
    ("RECONCILE_MAX_PER_MINUTE", 41),
    ("RECONCILE_MAX_PER_MINUTE", 0),
    ("RECONCILE_SPREAD_MINUTES", 211),
    ("RECONCILE_MIN_GAP_SECONDS", 0),
    ("ALERT_ERROR_RATE", 1.5),
    ("ALERT_WARN_STREAK", 13),
    ("OPEN_SIGNUP", "true"),
    ("OPEN_SIGNUP", 1),
    ("ALERT_HOURLY_CAP", True),
    ("ALERT_HOURLY_CAP", "5"),
    ("ALERT_COOLDOWN_HOURS", float("nan")),
    ("FINEXER_TEMPLATE_DARK", "short"),
    ("FINEXER_TEMPLATE_DARK", "a" * 2001),
    ("FINEXER_TEMPLATE_DARK", 12),
])
def test_validation_rejects(key, value):
    with pytest.raises(rs.SettingError):
        rs.validate(key, value)


def test_validation_accepts_edges():
    assert rs.validate("RECONCILE_MAX_PER_MINUTE", 40) == 40
    assert rs.validate("ALERT_HOURLY_CAP", 7.0) == 7
    assert rs.validate("ALERT_ERROR_RATE", 1) == 1.0
    assert rs.validate("FINEXER_TEMPLATE_DARK", "") == ""
    assert rs.validate("FINEXER_TEMPLATE_DARK", " abcDEF123456 ") == "abcDEF123456"
    assert rs.validate("OPEN_SIGNUP", True) is True


def test_invalid_stored_value_is_ignored(monkeypatch):
    col = FakeCol()
    col.docs["RECONCILE_MAX_PER_MINUTE"] = {"_id": "RECONCILE_MAX_PER_MINUTE", "value": 9999}
    _wire(monkeypatch, col, FakeCol())
    run(rs.ensure_fresh())
    assert rs.setting("RECONCILE_MAX_PER_MINUTE") == 40


# ── writes and audit ────────────────────────────────────────────────────────

def test_set_value_writes_row_and_audit_with_old_and_new(monkeypatch):
    col, audit = FakeCol(), FakeCol()
    _wire(monkeypatch, col, audit)
    monkeypatch.setenv("ALERT_HOURLY_CAP", "8")
    row = run(rs.set_value("ALERT_HOURLY_CAP", 3, OWNER))
    assert row["value"] == 3 and row["source"] == "database"
    doc = col.docs["ALERT_HOURLY_CAP"]
    assert doc["value"] == 3 and doc["type"] == "int" and doc["updated_by"] == OWNER and doc["updated_at"]
    assert len(audit.inserted) == 1
    entry = audit.inserted[0]
    assert (entry["key"], entry["old"], entry["new"], entry["actor"]) == ("ALERT_HOURLY_CAP", 8, 3, OWNER)
    assert entry["at"]
    assert rs.setting("ALERT_HOURLY_CAP") == 3                       # applies in this process at once
    run(rs.set_value("ALERT_HOURLY_CAP", 4, OWNER))
    assert [(e["old"], e["new"]) for e in audit.inserted] == [(8, 3), (3, 4)]


def test_clear_value_audits_and_falls_back(monkeypatch):
    col, audit = FakeCol(), FakeCol()
    _wire(monkeypatch, col, audit)
    monkeypatch.setenv("ALERT_HOURLY_CAP", "8")
    run(rs.set_value("ALERT_HOURLY_CAP", 3, OWNER))
    row = run(rs.clear_value("ALERT_HOURLY_CAP", OWNER))
    assert row["source"] == "env" and row["value"] == 8
    assert "ALERT_HOURLY_CAP" not in col.docs
    assert audit.inserted[-1]["old"] == 3 and audit.inserted[-1]["new"] == 8


def test_audit_failure_rolls_the_write_back(monkeypatch):
    col, audit = FakeCol(), FakeCol(fail=True)
    _wire(monkeypatch, col, audit)
    with pytest.raises(rs.SettingsUnavailable):
        run(rs.set_value("ALERT_HOURLY_CAP", 3, OWNER))
    assert "ALERT_HOURLY_CAP" not in col.docs
    assert rs.setting("ALERT_HOURLY_CAP") == 5


def test_purchase_switches_need_confirm_to_turn_on_only(monkeypatch):
    col, audit = FakeCol(), FakeCol()
    _wire(monkeypatch, col, audit)
    for key in ("APPLE_IAP_ENABLED", "PLAY_IAP_ENABLED"):
        before = len(audit.inserted)
        with pytest.raises(rs.ConfirmRequired):
            run(rs.set_value(key, True, OWNER))
        with pytest.raises(rs.ConfirmRequired):
            run(rs.set_value(key, True, OWNER, confirm=False))
        assert key not in col.docs and len(audit.inserted) == before
        assert run(rs.set_value(key, True, OWNER, confirm=True))["value"] is True
        assert run(rs.set_value(key, False, OWNER))["value"] is False   # off never needs confirm
    # other switches never need it
    assert run(rs.set_value("ALERTS_ENABLED", True, OWNER))["value"] is True


# ── cache and database down ─────────────────────────────────────────────────

def test_cache_expiry_uses_the_injected_clock(monkeypatch, _fresh):
    clock = _fresh
    col = FakeCol()
    _wire(monkeypatch, col, FakeCol())
    run(rs.ensure_fresh())
    assert col.find_calls == 1
    col.docs["ALERT_HOURLY_CAP"] = {"_id": "ALERT_HOURLY_CAP", "value": 11}
    clock.t += 59
    run(rs.ensure_fresh())
    assert col.find_calls == 1 and rs.setting("ALERT_HOURLY_CAP") == 5   # still cached
    clock.t += 2
    run(rs.ensure_fresh())
    assert col.find_calls == 2 and rs.setting("ALERT_HOURLY_CAP") == 11  # expired, reloaded


def test_database_down_falls_back_without_raising_and_logs_once(monkeypatch, _fresh, caplog):
    clock = _fresh
    col = FakeCol(fail=True)
    _wire(monkeypatch, col, FakeCol())
    monkeypatch.setenv("ALERT_HOURLY_CAP", "8")
    with caplog.at_level("WARNING", logger="app.runtime_settings"):
        run(rs.ensure_fresh())
        clock.t += 61
        run(rs.ensure_fresh())
    assert rs.setting("ALERT_HOURLY_CAP") == 8                          # env, never raised
    assert len([r for r in caplog.records if "unreachable" in r.getMessage()]) == 1


def test_database_blip_keeps_last_known_then_gives_up(monkeypatch, _fresh):
    clock = _fresh
    col = FakeCol()
    col.docs["APPLE_IAP_ENABLED"] = {"_id": "APPLE_IAP_ENABLED", "value": False}
    _wire(monkeypatch, col, FakeCol())
    monkeypatch.setenv("APPLE_IAP_ENABLED", "true")
    run(rs.ensure_fresh())
    assert rs.setting("APPLE_IAP_ENABLED") is False
    col.fail = True
    clock.t += 120
    run(rs.ensure_fresh())
    assert rs.setting("APPLE_IAP_ENABLED") is False                     # the off switch holds in a blip
    clock.t += rs.STALE_GRACE_S + 1
    run(rs.ensure_fresh())
    assert rs.setting("APPLE_IAP_ENABLED") is True                      # env again after the grace


# ── denylist ────────────────────────────────────────────────────────────────

DENIED = ["PLAY_ALLOW_TEST_PURCHASES", "APPLE_ALLOWED_ENVIRONMENTS", "TRUSTED_PROXY_HOPS",
          "TRUSTED_PROXY_HOPS_WEB", "APP_URL", "PLAY_RTDN_OIDC_AUDIENCE", "MCP_CONNECTOR_ENABLED",
          "DEFAULT_TIER", "ENABLE_API_DOCS", "DEV_MODE", "STRIPE_SECRET_KEY"]


def test_denylisted_keys_are_never_read_from_the_database(monkeypatch):
    col = FakeCol()
    for k in DENIED:
        col.docs[k] = {"_id": k, "key": k, "value": True}
    col.docs["ALERT_HOURLY_CAP"] = {"_id": "ALERT_HOURLY_CAP", "value": 2}
    _wire(monkeypatch, col, FakeCol())
    run(rs.ensure_fresh())
    assert set(rs._state["values"]) == {"ALERT_HOURLY_CAP"}
    for k in DENIED:
        with pytest.raises(rs.UnknownSetting):
            rs.setting(k)
        with pytest.raises(rs.UnknownSetting):
            rs.resolve(k)
        with pytest.raises(rs.UnknownSetting):
            rs.validate(k, True)
        with pytest.raises(rs.UnknownSetting):
            run(rs.set_value(k, True, OWNER, confirm=True))
    assert len(col.docs) == len(DENIED) + 1                              # nothing was written


def test_snapshot_never_lists_denylisted_keys(monkeypatch):
    col = FakeCol()
    for k in DENIED:
        col.docs[k] = {"_id": k, "value": "LEAKED-VALUE"}
    _wire(monkeypatch, col, FakeCol())
    rows = run(rs.snapshot())
    keys = {r["key"] for r in rows}
    assert keys == set(rs.REGISTRY)
    assert not keys & set(DENIED)
    assert "LEAKED-VALUE" not in repr(rows)


# ── routes: owner only, bot refused ─────────────────────────────────────────

def test_routes_owner_only(monkeypatch):
    col, audit = FakeCol(), FakeCol()
    _wire(monkeypatch, col, audit)
    other = {"email": "someone@example.com"}
    bot = {"name": "Bot", "email": None, "bot_name": "ci", "scopes": ["admin:sync"]}
    sneaky_bot = {"name": "Bot", "email": OWNER, "bot_name": "ci", "scopes": ["admin:sync"]}
    body = ops.SettingWrite(value=3)
    for user in (other, bot, sneaky_bot, {}):
        with pytest.raises(HTTPException) as e:
            run(ops.ops_settings(user=user))
        assert e.value.status_code == 403
        with pytest.raises(HTTPException) as e:
            run(ops.ops_settings_put("ALERT_HOURLY_CAP", body, user=user))
        assert e.value.status_code == 403
        with pytest.raises(HTTPException) as e:
            run(ops.ops_settings_delete("ALERT_HOURLY_CAP", user=user))
        assert e.value.status_code == 403
    assert not col.docs and not audit.inserted


def test_routes_owner_flow_and_errors(monkeypatch):
    col, audit = FakeCol(), FakeCol()
    _wire(monkeypatch, col, audit)
    owner = {"email": "Kevin.Maingi12@Gmail.com"}
    listing = run(ops.ops_settings(user=owner))["settings"]
    assert {r["key"] for r in listing} == set(rs.REGISTRY)
    row = run(ops.ops_settings_put("ALERT_HOURLY_CAP", ops.SettingWrite(value=3), user=owner))
    assert row["value"] == 3 and row["source"] == "database"
    assert audit.inserted[-1]["actor"] == OWNER
    with pytest.raises(HTTPException) as e:
        run(ops.ops_settings_put("ALERT_HOURLY_CAP", ops.SettingWrite(value=0), user=owner))
    assert e.value.status_code == 422
    with pytest.raises(HTTPException) as e:
        run(ops.ops_settings_put("APPLE_IAP_ENABLED", ops.SettingWrite(value=True), user=owner))
    assert e.value.status_code == 409 and e.value.detail["code"] == "confirm_required"
    ok = run(ops.ops_settings_put("APPLE_IAP_ENABLED", ops.SettingWrite(value=True, confirm=True), user=owner))
    assert ok["value"] is True
    for k in DENIED:
        with pytest.raises(HTTPException) as e:
            run(ops.ops_settings_put(k, ops.SettingWrite(value=True, confirm=True), user=owner))
        assert e.value.status_code == 404
        with pytest.raises(HTTPException) as e:
            run(ops.ops_settings_delete(k, user=owner))
        assert e.value.status_code == 404
    cleared = run(ops.ops_settings_delete("ALERT_HOURLY_CAP", user=owner))
    assert cleared["source"] == "default"


def test_route_store_down_is_503(monkeypatch):
    _wire(monkeypatch, FakeCol(fail=True), FakeCol())
    with pytest.raises(HTTPException) as e:
        run(ops.ops_settings_put("ALERT_HOURLY_CAP", ops.SettingWrite(value=3), user={"email": OWNER}))
    assert e.value.status_code == 503


# ── readers go through the accessor ─────────────────────────────────────────

def test_alerts_config_reads_through_the_accessor(monkeypatch):
    from app.services.health import alerts

    rs._state["values"].update({"ALERTS_ENABLED": True, "ALERT_HOURLY_CAP": 2, "ALERT_WARN_STREAK": 9})
    monkeypatch.setenv("ALERT_HOURLY_CAP", "50")
    cfg = alerts.load_config()
    assert cfg.enabled is True and cfg.hourly_cap == 2 and cfg.warn_streak == 9


def test_llm_ceiling_reads_database_value_at_call_time(monkeypatch):
    from app.core import llm

    calls = []

    class Col:
        async def find_one_and_update(self, *a, **k):
            calls.append(1)
            return {"count": 3}

        async def update_one(self, *a, **k):
            return type("R", (), {"modified_count": 0})()

    async def no_refresh(*a, **k):
        return None

    monkeypatch.setattr(rs, "ensure_fresh", no_refresh)
    monkeypatch.setattr(llm, "llm_global_usage_col", Col())
    monkeypatch.setattr(llm, "LLM_GLOBAL_MONTHLY_CALL_CEILING", 0)       # env says disabled
    run(llm._check_global_ceiling())
    assert not calls                                                      # disabled: no counter write
    rs._state["values"]["LLM_GLOBAL_MONTHLY_CALL_CEILING"] = 2           # owner sets 2, count is 3
    with pytest.raises(llm.LLMCeilingReached) as e:
        run(llm._check_global_ceiling())
    assert e.value.detail["ceiling"] == 2 and calls


def test_signup_gate_reads_database_value():
    from app.core import config

    assert config.is_signup_open() is config.OPEN_SIGNUP
    rs._state["values"]["OPEN_SIGNUP"] = True
    assert config.is_signup_open() is True
    rs._state["values"]["OPEN_SIGNUP"] = False
    assert config.is_signup_open() is False


def test_play_and_apple_switches_read_database_value(monkeypatch):
    from app.core import config, play_config
    from app.services import apple_billing

    async def no_refresh(*a, **k):
        return None

    monkeypatch.setattr(rs, "ensure_fresh", no_refresh)
    monkeypatch.setattr(config, "APPLE_IAP_ENABLED", True)
    rs._state["values"]["APPLE_IAP_ENABLED"] = False                      # the emergency off switch wins
    with pytest.raises(apple_billing.AppleNotConfigured):
        run(apple_billing.verify_signed_transaction("uid", "jws"))
    with pytest.raises(apple_billing.AppleNotConfigured):
        run(apple_billing.handle_notification("jws"))
    from app.services import play_billing
    monkeypatch.setattr(play_config, "PLAY_IAP_ENABLED", True)
    rs._state["values"]["PLAY_IAP_ENABLED"] = False
    assert play_billing.play_enabled() is False


def test_finexer_template_reads_database_value(monkeypatch):
    from app.routers import finexer as fx

    async def no_refresh(*a, **k):
        return None

    monkeypatch.setattr(rs, "ensure_fresh", no_refresh)
    monkeypatch.setattr(fx, "FINEXER_TEMPLATE_DARK", "")
    assert run(fx._template_setting()) == ""
    rs._state["values"]["FINEXER_TEMPLATE_DARK"] = "abcDEF123456"
    assert run(fx._template_setting()) == "abcDEF123456"


def test_health_collectors_read_budget_and_limit_through_the_accessor():
    rs._state["values"]["LLM_MONTHLY_BUDGET_USD"] = 12.5
    rs._state["values"]["MONGO_STORAGE_LIMIT_MB"] = 512.0
    assert rs.setting("LLM_MONTHLY_BUDGET_USD") == 12.5
    assert rs.setting("MONGO_STORAGE_LIMIT_MB") == 512.0
    import inspect
    from app.services.health import llm as health_llm, mongo as health_mongo
    assert 'asetting("LLM_MONTHLY_BUDGET_USD")' in inspect.getsource(health_llm)
    assert 'asetting("MONGO_STORAGE_LIMIT_MB")' in inspect.getsource(health_mongo)


@pytest.mark.parametrize("key,truthy", [
    ("OPEN_SIGNUP", {"1", "true", "yes"}),
    ("APPLE_IAP_ENABLED", {"1", "true", "on"}),
    ("PLAY_IAP_ENABLED", {"1", "true", "on"}),
    ("ALERTS_ENABLED", {"1", "true", "yes", "on"}),
])
def test_env_layer_uses_the_real_constants_truthy_set(monkeypatch, key, truthy):
    """resolve() must agree with the real constant's parser, never show On for a feature that is off."""
    from app.core import config

    for word in ("1", "true", "yes", "on", "off", "no", "0"):
        monkeypatch.setenv(key, word)
        shown, _ = rs.resolve(key)
        assert shown is (word in truthy), (key, word)
    if key in ("APPLE_IAP_ENABLED", "PLAY_IAP_ENABLED"):
        for word in ("yes", "on", "true", "1", "off"):
            assert config._parse_flag(word) is (word in truthy)
