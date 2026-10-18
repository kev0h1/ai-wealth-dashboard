# Finexer webhooks (A167)

Status: receiver built and hardened against Finexer's documentation. The
signature format is confirmed (see "Signature format (confirmed)").

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
| Every delivery is HMAC-SHA256 signed in the `fx-signature` header with the webhook's own `secret` (see "Signature format (confirmed)") | that key is `FINEXER_WEBHOOK_SIGNING_SECRET` |
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

## Signature format (confirmed)

Source: Finexer docs, Webhook signatures page, supplied by Kevin 2026-10-18.

- Every delivery carries an `fx-signature` header in the form
  `t={time};s={hash}`. `{time}` is a UTC ISO 8601 timestamp (for example
  `2020-05-12T14:45:00Z`), generated fresh for every attempt, retries included.
- `{hash}` is the hex-encoded HMAC-SHA256 of the string `"{time}.{raw body}"`,
  using the exact raw request bytes (never re-serialised), keyed with the
  webhook object's `secret` field. Find it in the Dashboard (Modify webhook,
  bottom of the popup) or via the webhook GET endpoint. It is not the webhook
  id.
- Finexer does not reject replays. The receiver enforces its own tolerance
  (`FINEXER_WEBHOOK_TOLERANCE_SECONDS`, default 300).
- This is the default scheme `t_s_hmac_sha256`, so no
  `FINEXER_WEBHOOK_SIGNATURE_SCHEME` override is needed. `raw_hmac_sha256`
  stays as a fallback only and must be paired with a timestamp header,
  otherwise replay is bounded only by the event-id dedupe.
- Delivery and retries: a non-2xx response or a timeout is retried every 3 s;
  10 consecutive failures pause the webhook and email the account owner.
  Delivery attempts and status codes are visible under the event's Webhook
  Details on the Dashboard Events page.

The Finexer dashboard validates a webhook URL with an unsigned reachability
probe: a `{}` body and no `fx-signature` header. The receiver answers that
exact shape with a 2xx and processes nothing (A169), so a signed webhook can be
saved; any other unsigned or wrongly signed request is still rejected with 401.

## Redirect callback signatures (not the webhook)

Consent and payment redirect callbacks carry a separate `fx_signature` query
parameter, plus `fx_timestamp`, and only on successful authorisations. It is the
HMAC-SHA256 hex of the full redirect URL minus that parameter, keyed with the
account's primary API secret key. The app does not currently verify it (a grep of
the backend finds no use of `fx_signature`); it is unrelated to the webhook
signature above.

## Kevin: dashboard steps

1. Finexer dashboard, Settings, Webhooks, add a webhook per environment:
   - UAT: `https://uat.wealth.auriqltd.co.uk/api/webhooks/finexer/<path-secret>`
   - Production: `https://wealth.auriqltd.co.uk/api/webhooks/finexer/<path-secret>`
   where `<path-secret>` is that environment's `FINEXER_WEBHOOK_SECRET`.
2. Select the eight events: bank_account.created, bank_account.deleted,
   bank_account.synced, bank_account.updated, consent.authorized,
   consent.canceled, consent.created, consent.expired.
3. Copy the webhook's `secret` field (Modify webhook, bottom of the popup) into
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
