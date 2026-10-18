# Finexer webhooks (A167)

Status: receiver built and hardened against Finexer's documentation. One fact
is still pending: the exact signature FORMAT (see "Pending").

## Confirmed

Source for the next table: "Finexer docs, Set up webhooks, read 2026-10-18"
(finexer.com/docs/settings/webhooks and dashboard.finexer.com/settings,
screenshots supplied by Kevin).

| Fact | How the code uses it |
| --- | --- |
| Dashboard events: `bank_account.created`, `.deleted`, `.synced`, `.updated`; `consent.authorized` (US spelling), `consent.canceled` (US spelling), `consent.created`, `consent.expired`. Payment events may exist and are not consumed | `finexer_webhooks.DEFAULT_EVENT_ACTIONS` |
| Envelope `{"id": "evt_...", "object": "event", "created_at", "type", "data": {"object": {...}}}` | event id = top-level `id`, type = top-level `type` (config defaults) |
| For `consent.*`, `data.object` is the consent (`id` cst_..., `customer`, `provider`, `expiry_date`, `failure_code`, `failure_message`, `status`, `metadata`) | consent id = `data.object.id` |
| For `bank_account.*`, `data.object` is the bank account (shape not shown) | consent from `data.object.consent` if present, else our stored map `accounts.connection_id` (Finexer accounts), else the event is recorded as `skipped / unresolved` |
| One POST per event; reply 2xx (200 or 204); on timeout or non-2xx Finexer retries every 3 s; after 10 consecutive failures the webhook is PAUSED and the owner is emailed | every authentic delivery gets 200. The only non-2xx after authentication is 503 on a genuine enqueue failure, which releases the event id and debounce key so the retry is processed |
| Every delivery is HMAC-SHA256 signed in the `fx-signature` header with a per-webhook key shown in the dashboard after creation | that key is `FINEXER_WEBHOOK_SIGNING_SECRET` |
| A static token in the URL query is allowed as auth | our path secret (`/webhooks/finexer/{secret}`) is the equivalent and stays |

Event actions (`FINEXER_WEBHOOK_EVENT_ACTIONS` can override any type):

| Event | Action | Effect |
| --- | --- | --- |
| `bank_account.created/updated/synced` | `sync_consent` | debounced `task_sync_finexer` for that consent |
| `bank_account.deleted` | `account_deleted` | stamps `closed_at` on the tracked account (status untouched, no UI state exists for closed); no sync |
| `consent.authorized` | `consent_authorised` | maps `status: authorized` and `expiry_date` onto the stored consent, then debounced sync |
| `consent.canceled` | `consent_revoked` | local status `revoked` plus accounts flagged expired. Local only: the remote consent is already cancelled, A106's pending-revocation path is not involved |
| `consent.expired` | `consent_expired` | local status `expired` (NOT revoked), accounts flagged expired, `last_connection_nag` cleared so `task_consent_watch` sends the reconsent prompt (A6.2A) at its next run |
| `consent.created` | `record_only` | recorded in `webhook_events`, nothing else |
| anything else | `unknown` | recorded and ignored, type string only logged |

Other actions exist for config use: `consent_expiring` (stamps
`webhook_expiring_at`; no Finexer event is known to map to it).

## Pending

- The signature FORMAT ("Webhook signatures" docs page was not captured). The
  header name `fx-signature` and HMAC-SHA256 are confirmed. The value layout is
  an assumption: default scheme `t_s_hmac_sha256` (`t=<ISO8601>;s=<hex>`, HMAC
  over `"<t>.<raw body>"`, inherited from A89). `raw_hmac_sha256` (hex or
  `sha256=` prefixed HMAC of the raw body) is available. Set with
  `FINEXER_WEBHOOK_SIGNATURE_SCHEME`, `FINEXER_WEBHOOK_SIGNATURE_HEADER`,
  `FINEXER_WEBHOOK_TIMESTAMP_HEADER`, `FINEXER_WEBHOOK_TOLERANCE_SECONDS`.
  `raw_hmac_sha256` MUST be paired with a timestamp header, otherwise replay is
  bounded only by the event-id dedupe. Until the page is checked, do not set
  `FINEXER_WEBHOOK_SIGNING_SECRET` on an environment where real deliveries
  would be rejected: a wrong scheme fails closed and pauses the webhook after 10
  failures.

## Kevin: dashboard steps

1. Finexer dashboard, Settings, Webhooks, add a webhook per environment:
   - UAT: `https://uat.wealth.auriqltd.co.uk/api/webhooks/finexer/<path-secret>`
   - Production: `https://wealth.auriqltd.co.uk/api/webhooks/finexer/<path-secret>`
   where `<path-secret>` is that environment's `FINEXER_WEBHOOK_SECRET`.
2. Select the eight events: bank_account.created, bank_account.deleted,
   bank_account.synced, bank_account.updated, consent.authorized,
   consent.canceled, consent.created, consent.expired.
3. Copy the signature key Finexer shows after creation into
   `FINEXER_WEBHOOK_SIGNING_SECRET` on each environment (never paste it into
   chat or the repo).
4. Confirm on `/ops/health` that "webhooks: last received N min ago" moves.

## Config keys (env, defaults in `app/core/config.py`)

- `FINEXER_WEBHOOK_SIGNING_SECRET`: when set, the signature is mandatory and
  fails closed (generic 401, same text as a bad path secret). Unset: the path
  secret is the only gate and startup logs that once. Never printed.
- `FINEXER_WEBHOOK_SIGNATURE_HEADER` (`fx-signature`),
  `FINEXER_WEBHOOK_SIGNATURE_SCHEME`, `FINEXER_WEBHOOK_TIMESTAMP_HEADER`,
  `FINEXER_WEBHOOK_TOLERANCE_SECONDS` (300).
- `FINEXER_WEBHOOK_EVENT_ID_FIELD` (`id`), `FINEXER_WEBHOOK_EVENT_TYPE_FIELDS`
  (`type,event`), `FINEXER_WEBHOOK_EVENT_ACTIONS` (JSON, merged over defaults).
- `FINEXER_WEBHOOK_DEBOUNCE_SECONDS` (30): a burst for one consent becomes one
  sync, deferred by the window. 0 disables.
- `FINEXER_WEBHOOK_MAX_BODY_BYTES` (65536): checked before the body is read (413).
- `FINEXER_POLL_INTERVAL_HOURS` (24): with webhooks healthy a consent is polled
  once per this many hours; 0 restores the old per-tier cadence.
- `FINEXER_WEBHOOK_STALE_HOURS` (24): a consent with no webhook this long falls
  back to its tier's polling cadence and is counted on `/ops/health`.

## Measuring before and after

`worker_runs` holds one doc per UTC day, `_id` `finexer_api_calls:YYYY-MM-DD`,
with `requests` (every Finexer GET including 429 retries), `rate_limited`,
`webhook_events`, `webhook_syncs_enqueued`, `webhook_events_coalesced`,
`poll_syncs_enqueued`. `/ops/health` shows today and yesterday.
