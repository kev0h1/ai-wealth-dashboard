# Runtime settings (E10)

Non-secret operational settings the account owner can change from
`/ops/health` (section "Runtime settings") without a redeploy. Code:
`backend/app/services/runtime_settings.py`. Routes: `GET /ops/settings`,
`PUT /ops/settings/{key}` (body `{"value": ..., "confirm": false}`),
`DELETE /ops/settings/{key}` (drop the override, fall back to env then default).
All owner session only; a bot credential gets 403.

## How a value is chosen

database value, then environment value, then code default. Nothing changes
until a database row exists. The API and the worker both read through one
accessor with a cache of about 60 seconds, so a change applies to both within
about a minute. Delete a variable from Railway only once its value has been set in /ops/health, or when the default is the value you want. Deleting an env var that has no database value returns the key to its code default. If the database cannot be reached the last known values are
kept for 15 minutes (so an emergency off switch does not flip back on during a
blip), then readers fall back to env or default. The first failure is logged.

Collections: `settings` (one document per key, `_id` is the key: `key`, `value`,
`type`, `updated_at`, `updated_by`) and `settings_audit` (append only: `key`,
`old`, `new`, `actor`, `at`).

## Registry

| Key | Type | Bounds | Default |
|---|---|---|---|
| `OPEN_SIGNUP` | bool | | off |
| `LLM_GLOBAL_MONTHLY_CALL_CEILING` | int | 1 to 10,000,000 (never zero here) | 0 (disabled) via env |
| `LLM_MONTHLY_BUDGET_USD` | float | 0.01 to 1,000,000 | unset |
| `MONGO_STORAGE_LIMIT_MB` | float | 1 to 10,000,000 | unset |
| `FINEXER_TEMPLATE_DARK` | text | empty or the 12-character template id | empty |
| `APPLE_IAP_ENABLED` | bool | turning on needs `confirm: true` | off |
| `PLAY_IAP_ENABLED` | bool | turning on needs `confirm: true` | off |
| `ALERTS_ENABLED` | bool | | off |
| `ALERT_COOLDOWN_HOURS` | float | 0 to 168 | 6 |
| `ALERT_WARN_STREAK` | int | 1 to 12 | 3 |
| `ALERT_HOURLY_CAP` | int | 1 to 100 | 5 |
| `ALERT_ERROR_RATE` | float | 0.001 to 1 | 0.10 |
| `ALERT_SYNC_FAILURES` | int | 1 to 10,000 | 5 |
| `RECONCILE_SPREAD_MINUTES` | int | 1 to 210 (the 3 h 30 staleness window) | 210 |
| `RECONCILE_MAX_PER_MINUTE` | int | 1 to 40 (the Finexer-safe ceiling) | 40 |
| `RECONCILE_MIN_GAP_SECONDS` | int | 1 to 60 | 2 |
| `SYNC_POLL_HOURS` | int | 1 to 24 | 4 (the current 3 h 30 window; the cron ticks every 4 hours, so lower values behave as 4) |
| `SYNC_WEBHOOK_SAFETY_NET_HOURS` | int | 0 to 48 | 0 (off). Above 0, Finexer polling only syncs a consent with no webhook and no sync in that many hours (E11, see SYNC-STRATEGY.md) |

Going above 40 reconcile jobs a minute, or a zero LLM ceiling, stays a code or
env decision on purpose.

## Never readable from the database

The accessor refuses these even if a row exists, and the settings routes treat
them as unknown keys: every secret (any name ending `_SECRET`, `_KEY`,
`_TOKEN`, `_PASSWORD`, `_SALT`, `_URI`, `_JSON`), `PLAY_ALLOW_TEST_PURCHASES`,
`APPLE_ALLOWED_ENVIRONMENTS`, `TRUSTED_PROXY_HOPS`, `TRUSTED_PROXY_HOPS_WEB`,
`APP_URL`, `PLAY_RTDN_OIDC_*`, `MCP_CONNECTOR_ENABLED`, `DEFAULT_TIER`,
`ENABLE_API_DOCS`, `DEV_MODE`. The registry is asserted against this list at
import time.

## Adding a key

Add a `Spec` to `REGISTRY` with a type and bounds, read it through
`runtime_settings.setting(key)` (await `ensure_fresh()` first in async code, or
use `asetting`), list it in `scripts/env_drift.py`'s `RUNTIME_SETTING_NAMES`,
and mark its `docs/ops/ENV.md` row. Never add a key that is on the denylist.
