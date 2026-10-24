"""E10: owner-editable runtime settings.

A small set of non-secret operational settings that used to be environment
variables (so a change meant a redeploy) can now be changed by the account
owner from /ops/health. One accessor, `setting(key)`, resolves

    database value  ->  environment value  ->  code default

so nothing changes until a database row exists: the environment stays the
fallback and can be deleted from Railway after release.

What this module guarantees:

* Only keys in `REGISTRY` are ever read from the database. Everything on the
  `DENYLIST` (secrets, the switches that decide whether test purchases unlock
  paid plans, proxy trust, URLs, the MCP connector, the default tier, API
  docs, dev mode) is refused by the accessor even if a row exists. Import
  fails if a registry key is, or looks like, a denylisted one.
* Reads never touch the database per call. `ensure_fresh()` (awaited by the
  async readers) reloads every row at most once per `CACHE_TTL_S`; `setting()`
  itself is synchronous and only reads the in-process snapshot.
* The database being unreachable never raises. The last known good snapshot
  is kept for `STALE_GRACE_S` (so an emergency switch that was turned off does
  not silently turn back on during a blip), after which readers fall back to
  environment/default. The first failure is logged, not every one.
* Every write is validated against the key's type and bounds and appends an
  entry to the append-only `settings_audit` collection.
"""
from __future__ import annotations

import asyncio
import logging
import math
import os
import re
import time
from datetime import datetime, timezone
from dataclasses import dataclass
from typing import Any, Callable, Optional


log = logging.getLogger("app.runtime_settings")

CACHE_TTL_S = 60.0
STALE_GRACE_S = 900.0
LOAD_TIMEOUT_S = 3.0

_MISSING: Any = object()


def naive_utc_now() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)  # naive-ok: UTC wall time stored as a naive Mongo datetime, like the rest of the store


class SettingError(ValueError):
    """A value failed validation (type or bounds)."""


class UnknownSetting(KeyError):
    """Not a runtime setting (including every denylisted key)."""


class ConfirmRequired(Exception):
    """Turning this switch on needs an explicit confirm."""


class SettingsUnavailable(Exception):
    """The database could not take the write."""


# Keys that must never be readable from the database. Exact names, prefixes
# and secret-shaped suffixes: the registry is checked against all three.
DENYLIST: frozenset[str] = frozenset({
    "PLAY_ALLOW_TEST_PURCHASES", "APPLE_ALLOWED_ENVIRONMENTS",
    "TRUSTED_PROXY_HOPS", "TRUSTED_PROXY_HOPS_WEB",
    "APP_URL", "MCP_CONNECTOR_ENABLED", "DEFAULT_TIER",
    "ENABLE_API_DOCS", "DEV_MODE",
})
DENY_PREFIXES: tuple[str, ...] = ("PLAY_RTDN_OIDC_", "TRUSTED_PROXY_HOPS")
DENY_SUFFIXES: tuple[str, ...] = (
    "_SECRET", "_KEY", "_TOKEN", "_PASSWORD", "_PRIVATE_KEY", "_SALT", "_URI", "_JSON",
)


def is_denylisted(key: str) -> bool:
    k = (key or "").strip().upper()
    return k in DENYLIST or k.startswith(DENY_PREFIXES) or k.endswith(DENY_SUFFIXES)


_TEMPLATE_ID_RE = re.compile(r"^[A-Za-z0-9]{12}$")


def _validate_template_id(v: str) -> str:
    v = v.strip()
    if v and not _TEMPLATE_ID_RE.match(v):
        raise SettingError("Must be empty (off) or the 12-character Finexer template id.")
    return v


@dataclass(frozen=True)
class Spec:
    key: str
    type: str                      # "bool" | "int" | "float" | "str"
    default: Any
    label: str
    group: str
    min: Optional[float] = None
    max: Optional[float] = None
    confirm_on: bool = False       # turning a bool ON needs confirm
    env_off: Any = _MISSING        # an env value that is legitimate but outside the bounds
    validator: Optional[Callable[[Any], Any]] = None
    # Bool keys only: the exact env strings the real constant treats as true
    # (core/config.py), so the settings page never shows On for a value the
    # feature itself reads as off.
    env_truthy: tuple = ("1", "true", "yes", "on")
    help: str = ""


REGISTRY: dict[str, Spec] = {s.key: s for s in [
    Spec("OPEN_SIGNUP", "bool", False, "Open sign-up", "Access", env_truthy=("1", "true", "yes"),
         help="Any verified Google or Apple identity can create an account. Off keeps registration allow-list only."),
    Spec("LLM_GLOBAL_MONTHLY_CALL_CEILING", "int", 0, "LLM monthly call ceiling", "Cost controls",
         min=1, max=10_000_000, env_off=0,
         help="Service-wide monthly OpenRouter call ceiling. Cannot be set to zero here; remove the override to fall back."),
    Spec("LLM_MONTHLY_BUDGET_USD", "float", None, "LLM monthly budget (USD)", "Cost controls",
         min=0.01, max=1_000_000, help="Turns model spend into a status on the health page."),
    Spec("MONGO_STORAGE_LIMIT_MB", "float", None, "Database storage limit (MB)", "Cost controls",
         min=1, max=10_000_000, help="Turns database size into a status on the health page."),
    Spec("FINEXER_TEMPLATE_DARK", "str", "", "Finexer dark consent template id", "Bank connection",
         validator=_validate_template_id,
         help="The 12-character id of the dark consent template, or empty for the default template."),
    Spec("APPLE_IAP_ENABLED", "bool", False, "Apple in-app purchase", "Purchases", confirm_on=True, env_truthy=("1", "true", "on"),
         help="Master switch for iOS purchases. Turning it off is the emergency stop."),
    Spec("PLAY_IAP_ENABLED", "bool", False, "Google Play purchase", "Purchases", confirm_on=True, env_truthy=("1", "true", "on"),
         help="Master switch for Android purchases. Turning it off is the emergency stop."),
    Spec("ALERTS_ENABLED", "bool", False, "Push alerts", "Alerts",
         help="Master switch for health alerts to the owner."),
    Spec("ALERT_COOLDOWN_HOURS", "float", 6.0, "Alert cooldown (hours)", "Alerts", min=0, max=168),
    Spec("ALERT_WARN_STREAK", "int", 3, "Warn samples before alerting", "Alerts", min=1, max=12),
    Spec("ALERT_HOURLY_CAP", "int", 5, "Alert pushes per hour", "Alerts", min=1, max=100),
    Spec("ALERT_ERROR_RATE", "float", 0.10, "Alert on API error share", "Alerts", min=0.001, max=1),
    Spec("ALERT_SYNC_FAILURES", "int", 5, "Alert on failed syncs (24 h)", "Alerts", min=1, max=10_000),
    # Finexer-safe limits from app/core/config.py and workers/sync_worker.py:
    # the reconcile run is every 4 h with a 3 h 30 staleness window (210 min),
    # and 40 jobs a minute is the documented ceiling (about 42 a minute is the
    # 10,000-connection arithmetic). Raising past 40 needs Finexer's say-so, so
    # it stays a code change.
    Spec("RECONCILE_SPREAD_MINUTES", "int", 210, "Reconcile spread (minutes)", "Bank sync", min=1, max=210),
    Spec("RECONCILE_MAX_PER_MINUTE", "int", 40, "Reconcile jobs per minute", "Bank sync", min=1, max=40),
    Spec("RECONCILE_MIN_GAP_SECONDS", "int", 2, "Reconcile minimum gap (seconds)", "Bank sync", min=1, max=60),
    # E11: Finexer polling cadence. Defaults reproduce today's behaviour.
    Spec("SYNC_POLL_HOURS", "int", 4, "Bank poll interval (hours)", "Bank sync", min=1, max=24,
         help="How often the reconcile cron re-syncs a Finexer consent that is not covered by a healthy webhook. 4 is the current 3 h 30 window; the cron itself ticks every 4 hours, so lower values behave as 4."),
    Spec("SYNC_WEBHOOK_SAFETY_NET_HOURS", "int", 0, "Webhook safety-net window (hours)", "Bank sync", min=0, max=48,
         help="0 is off. Above 0, polling only syncs a consent with no webhook and no sync in this many hours (12 is proposed). Keeps unattended access well inside four a day."),
]}

for _k in REGISTRY:
    assert not is_denylisted(_k), f"{_k} is denylisted and must not be a runtime setting"


# ── Typing and validation ────────────────────────────────────────────────────

def validate(key: str, raw: Any) -> Any:
    """Return the cleaned value or raise SettingError. Unknown or denylisted
    keys raise UnknownSetting."""
    spec = _spec(key)
    t = spec.type
    if t == "bool":
        if not isinstance(raw, bool):
            raise SettingError("Must be true or false.")
        return raw
    if t == "str":
        if not isinstance(raw, str):
            raise SettingError("Must be text.")
        v = spec.validator(raw) if spec.validator else raw.strip()
        return v
    if isinstance(raw, bool) or not isinstance(raw, (int, float)):
        raise SettingError("Must be a number.")
    if t == "int":
        if isinstance(raw, float):
            if not raw.is_integer():
                raise SettingError("Must be a whole number.")
            raw = int(raw)
        v: Any = raw
    else:
        if isinstance(raw, float) and not math.isfinite(raw):
            raise SettingError("Must be a finite number.")
        v = float(raw)
    if spec.min is not None and v < spec.min:
        raise SettingError(f"Must be at least {spec.min:g}.")
    if spec.max is not None and v > spec.max:
        raise SettingError(f"Must be at most {spec.max:g}.")
    return v


def _spec(key: str) -> Spec:
    if is_denylisted(key) or key not in REGISTRY:
        raise UnknownSetting(key)
    return REGISTRY[key]


def _env_value(spec: Spec) -> Any:
    """The environment layer: _MISSING when unset or unusable."""
    raw = os.environ.get(spec.key)
    if raw is None:
        return _MISSING
    raw = raw.strip()
    if spec.type == "str":
        return raw if raw else _MISSING
    if not raw:
        return _MISSING
    try:
        if spec.type == "bool":
            return raw.lower() in spec.env_truthy
        num = float(raw)
        if spec.env_off is not _MISSING and num == spec.env_off:
            return spec.env_off
        return validate(spec.key, int(num) if spec.type == "int" and num.is_integer() else num)
    except (ValueError, SettingError):
        return _MISSING


# ── Cache and accessor ───────────────────────────────────────────────────────

_clock: Callable[[], float] = time.monotonic
_state: dict[str, Any] = {"values": {}, "attempted_at": None, "ok_at": None, "down_logged": False}


def set_clock(fn: Optional[Callable[[], float]]) -> None:
    """Tests only: inject the monotonic clock. None restores the real one."""
    global _clock
    _clock = fn or time.monotonic


def reset_cache() -> None:
    _state.update({"values": {}, "attempted_at": None, "ok_at": None, "down_logged": False})


def _settings_col():
    from app.db.collections import settings_col
    return settings_col


def _audit_col():
    from app.db.collections import settings_audit_col
    return settings_audit_col


async def ensure_fresh(col=None, force: bool = False) -> None:
    """Reload the snapshot if it is older than CACHE_TTL_S. Never raises."""
    now = _clock()
    at = _state["attempted_at"]
    if not force and at is not None and now - at < CACHE_TTL_S:
        return
    _state["attempted_at"] = now
    try:
        docs = await asyncio.wait_for(
            (col if col is not None else _settings_col()).find({}).to_list(None), LOAD_TIMEOUT_S)
    except Exception as exc:
        if not _state["down_logged"]:
            _state["down_logged"] = True
            log.warning("runtime settings: database unreachable (%s), using last known or env/default", type(exc).__name__)
        ok_at = _state["ok_at"]
        if ok_at is not None and now - ok_at > STALE_GRACE_S:
            _state["values"] = {}
        return
    values: dict[str, Any] = {}
    for d in docs:
        k = d.get("key") or d.get("_id")
        if not isinstance(k, str) or is_denylisted(k) or k not in REGISTRY:
            continue
        try:
            values[k] = validate(k, d.get("value"))
        except SettingError:
            log.warning("runtime settings: ignoring invalid stored value for %s", k)
    _state.update({"values": values, "ok_at": now, "down_logged": False})


def setting(key: str, env: Any = _MISSING) -> Any:
    """Database value, then environment value, then code default.

    Synchronous and I/O free: it reads the snapshot that `ensure_fresh()`
    keeps current. `env`, when given, is the caller's already-parsed
    environment value (readers that keep a module constant for it pass that,
    so existing tests that patch the constant still work); otherwise the
    process environment is read at call time. Denylisted and unknown keys
    raise UnknownSetting and are never looked up."""
    spec = _spec(key)
    v = _state["values"].get(key, _MISSING)
    if v is not _MISSING:
        return v
    if env is not _MISSING:
        return env
    e = _env_value(spec)
    return spec.default if e is _MISSING else e


async def asetting(key: str, env: Any = _MISSING) -> Any:
    await ensure_fresh()
    return setting(key, env)


def resolve(key: str) -> tuple[Any, str]:
    """(value, source) for the settings page: source is database, env or default."""
    spec = _spec(key)
    v = _state["values"].get(key, _MISSING)
    if v is not _MISSING:
        return v, "database"
    e = _env_value(spec)
    if e is not _MISSING:
        return e, "env"
    return spec.default, "default"


def _public_row(spec: Spec) -> dict:
    value, source = resolve(spec.key)
    return {
        "key": spec.key, "label": spec.label, "group": spec.group, "type": spec.type,
        "value": value, "source": source, "default": spec.default,
        "min": spec.min, "max": spec.max, "confirm_on": spec.confirm_on, "help": spec.help,
    }


async def snapshot(col=None) -> list[dict]:
    await ensure_fresh(col, force=True)
    return [_public_row(s) for s in REGISTRY.values()]


# ── Writes ───────────────────────────────────────────────────────────────────

async def set_value(key: str, raw: Any, actor: str, confirm: bool = False, col=None, audit_col=None) -> dict:
    spec = _spec(key)
    value = validate(key, raw)
    if spec.confirm_on and value is True and confirm is not True:
        raise ConfirmRequired(key)
    col = col if col is not None else _settings_col()
    audit_col = audit_col if audit_col is not None else _audit_col()
    await ensure_fresh(col, force=True)
    old, _src = resolve(key)
    now = naive_utc_now()
    try:
        prev = await col.find_one({"_id": key})
        await col.update_one(
            {"_id": key},
            {"$set": {"key": key, "value": value, "type": spec.type, "updated_at": now, "updated_by": actor}},
            upsert=True)
    except Exception as exc:
        raise SettingsUnavailable("settings store unavailable") from exc
    try:
        await audit_col.insert_one({"key": key, "old": old, "new": value, "actor": actor, "at": now})
    except Exception as exc:
        # An unaudited change must not stand: put the previous row back.
        try:
            if prev is None:
                await col.delete_one({"_id": key})
            else:
                await col.replace_one({"_id": key}, prev, upsert=True)
        except Exception:
            log.error("runtime settings: audit failed and rollback failed for %s", key)
        raise SettingsUnavailable("audit log unavailable") from exc
    _state["values"][key] = value
    return _public_row(spec)


async def clear_value(key: str, actor: str, col=None, audit_col=None) -> dict:
    """Remove the database override so the key falls back to env/default."""
    spec = _spec(key)
    col = col if col is not None else _settings_col()
    audit_col = audit_col if audit_col is not None else _audit_col()
    await ensure_fresh(col, force=True)
    old, source = resolve(key)
    now = naive_utc_now()
    try:
        prev = await col.find_one({"_id": key})
        await col.delete_one({"_id": key})
    except Exception as exc:
        raise SettingsUnavailable("settings store unavailable") from exc
    _state["values"].pop(key, None)
    new, _ = resolve(key)
    try:
        await audit_col.insert_one({"key": key, "old": old, "new": new, "actor": actor, "at": now, "cleared": True})
    except Exception as exc:
        if prev is not None:
            try:
                await col.replace_one({"_id": key}, prev, upsert=True)
            except Exception:
                log.error("runtime settings: audit failed and rollback failed for %s", key)
            _state["values"][key] = prev.get("value")
        raise SettingsUnavailable("audit log unavailable") from exc
    return _public_row(spec)


async def ensure_indexes(col=None, audit_col=None) -> None:
    col = col if col is not None else _settings_col()
    audit_col = audit_col if audit_col is not None else _audit_col()
    await audit_col.create_index([("key", 1), ("at", -1)], name="settings_audit_key_at")
