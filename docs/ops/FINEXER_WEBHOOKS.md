# Finexer webhooks (A167)

Status: receiver hardened, provider-shape facts NOT confirmed. Finexer's own
webhook documentation is not in this repo. Nothing below marked "assumed" may
be treated as fact until Kevin supplies Finexer's docs page (a screenshot is
enough) and the config keys are checked against it.

## Confirmed from repo evidence

Searched: `docs/compliance/*`, `docs/ops/*`, `TODO.md` (A89, A167, A57 notes),
`backend/app/data`, `backend/app/routers/webhooks.py`, `backend/tests`. No
Finexer webhook documentation page, screenshot or pasted catalogue exists.

| Fact | Evidence |
| --- | --- |
| UAT/production receiver is `POST /webhooks/finexer/{secret}`, secret is `FINEXER_WEBHOOK_SECRET` (env, else `backend/.finexer_webhook_secret`) | `routers/webhooks.py`, `docs/ops/ENV.md` lines 85 and 409 |
| Production URL form `https://wealth.auriqltd.co.uk/api/webhooks/finexer/<secret>` is what the Finexer questionnaire states | `docs/compliance/finexer-agent-controls-2026-09.md` Q4 |
| Consent withdrawal is meant to arrive by webhook and mark the connection revoked | same doc, lines 74 and 158 |
| `FINEXER_WEBHOOK_SIGNING_SECRET` is "optional until Finexer's dashboard issues one" and is unset on UAT and production | `docs/ops/ENV.md` lines 86 and 410 |
| A89 (done 2026-09-22) made the path-secret compare constant time | `TODO.md` A89 |
| A57 live run observed that replays caused no duplicate side effect | `TODO.md` A57 note 2026-09-20 |

## Assumed, pending Finexer's documentation

These come only from code comments and tests written on 2026-09-02 (commit
`94f3f715`) that call the format "documented" but cite no page. Treat as
unverified.

| Assumption | Where it lives | Config key to correct it |
| --- | --- | --- |
| Signature header is `fx-signature` | `FINEXER_WEBHOOK_SIGNATURE_HEADER` default | `FINEXER_WEBHOOK_SIGNATURE_HEADER` |
| Header value is `t=<ISO8601>;s=<hex>` and the hex is HMAC-SHA256 over `"<t>.<raw body>"` | scheme `t_s_hmac_sha256` | `FINEXER_WEBHOOK_SIGNATURE_SCHEME` (`t_s_hmac_sha256` or `raw_hmac_sha256`), `FINEXER_WEBHOOK_TIMESTAMP_HEADER` for raw scheme with a separate timestamp header |
| Replay tolerance 5 minutes | default | `FINEXER_WEBHOOK_TOLERANCE_SECONDS` |
| Envelope is Stripe-like: `{id, object: "event", type, data: {object: {...}}}` | `_resolve_finexer_consent_id`, `finexer_webhooks.extract_event_*` | `FINEXER_WEBHOOK_EVENT_ID_FIELD` (dotted path, default `id`), `FINEXER_WEBHOOK_EVENT_TYPE_FIELDS` (comma list of dotted paths, default `type,event`). The consent id resolver is code, not config; change it in `_resolve_finexer_consent_id` if the shape differs |
| Event type names: `consent.authorised/authorized`, `consent.revoked/declined/expired/cancelled/canceled`, `account.disconnected`, `transaction.created/updated` | `finexer_webhooks.DEFAULT_EVENT_ACTIONS` | `FINEXER_WEBHOOK_EVENT_ACTIONS` (JSON object, type to action, merged over the defaults) |
| No expiring-consent event name is known, so none is mapped | n/a | add e.g. `{"consent.expiring": "consent_expiring"}` once known |
| Retry policy: retries every 3 s, pauses the webhook after 10 consecutive non-2xx | comment in `finexer_webhook()` | none (informational). The handler returns 200 for every authentic delivery except a real enqueue failure (503) |
| Whether Finexer sends an event id, and where | assumed top-level `id` | `FINEXER_WEBHOOK_EVENT_ID_FIELD`. Events without an id are not deduplicated, only debounced |

Actions available in the table: `sync_consent`, `consent_authorised`,
`consent_expiring`, `consent_revoked`, `unknown`. Any type not in the table is
`unknown`: recorded in `webhook_events` (30 day TTL) and ignored, with only the
type string logged.

## Other config keys (all env, defaults in `app/core/config.py`)

- `FINEXER_WEBHOOK_SIGNING_SECRET`: when set, the signature is mandatory and
  fails closed (generic 401, same text as a bad path secret). When unset the path
  secret is the only gate and startup logs that once. Never printed.
- `FINEXER_WEBHOOK_DEBOUNCE_SECONDS` (30): a burst for one consent coalesces
  into one `task_sync_finexer`, deferred by the window. 0 disables.
- `FINEXER_WEBHOOK_MAX_BODY_BYTES` (65536): checked against Content-Length and
  while streaming, before the body is buffered (413).
- `FINEXER_POLL_INTERVAL_HOURS` (24): with webhooks healthy a consent is polled
  once per this many hours; 0 restores the old per-tier cadence.
- `FINEXER_WEBHOOK_STALE_HOURS` (24): a consent with no webhook for this long
  falls back to its tier's own polling cadence and is counted on `/ops/health`.

## What Kevin must supply to finish A167

1. Finexer's webhook documentation: event type names, payload shape including
   the event id field and where the consent id sits, signature header and
   algorithm, retry policy.
2. The webhook URL registered in the Finexer dashboard for UAT and production,
   and `FINEXER_WEBHOOK_SIGNING_SECRET` set on both.
3. Then set the keys above (no code change expected unless the consent id path
   differs), and confirm on `/ops/health` that "webhooks: last received N min
   ago" moves.

## Measuring before and after

`worker_runs` holds one doc per UTC day, `_id` `finexer_api_calls:YYYY-MM-DD`,
with `requests` (every Finexer GET including 429 retries), `rate_limited`,
`webhook_events`, `webhook_syncs_enqueued`, `webhook_events_coalesced`,
`poll_syncs_enqueued`. `/ops/health` shows today and yesterday.
