# Secrets and PII in logs / error responses — sweep (A26, 2026-09)

## The incident this follows up on

On 2026-09-08, while building `scripts/env_drift.py` (H16, the environment
config manifest and drift checker), an early version of the Railway
variable-name parser leaked a fragment of a PEM/base64 secret. The bug
class, not the specific leaked value (never committed, never reached this
document): a multi-line secret stored with real embedded newlines (a PEM
private key, or a base64-encoded JSON service-account file) was being
parsed line-by-line to extract `KEY=value` pairs (`railway variables --kv`
output). A naive `[A-Za-z_][A-Za-z0-9_]*=` match treats any continuation
line of the secret that happens to look like `SomeMixedCase=` — which
base64 padding and PEM body lines routinely do — as if it were itself a
`NAME=value` assignment, and the "name" half of that false match is a
fragment of the secret.

The fix (already in place by the time `scripts/env_drift.py` was
committed, see `parse_railway_kv_names`'s own docstring) is to require the
"name" to be `UPPER_SNAKE_CASE` end to end: every real variable name in
this codebase is `UPPER_SNAKE_CASE` (documented in `docs/ops/ENV.md`), and
PEM/base64 body lines are mixed-case, so requiring the whole match to be
uppercase reliably tells the two apart. This is a real, working defence,
not a stopgap — confirmed by reading the parser and its accompanying tests
(`backend/tests/` doesn't cover this script directly since it's a
standalone `scripts/` tool, not part of `backend/app`; the reasoning is
documented inline in the function itself).

## The general class of bug

Generalised: **any code that treats a secret's raw text as structured data
to be scanned/parsed, without first establishing a strict shape for what a
"real" field looks like, risks a false match landing inside the secret's
own bytes.** `env_drift.py` was one instance; this pass looked for
siblings across the rest of the codebase.

## What was checked

- **Every other collector in `scripts/env_drift.py`** (the `.env` file
  parser, the Vercel `env ls` table parser): all three enforce the same
  `UPPER_SNAKE_CASE`-only match, so they share the fix, not just the one
  function whose docstring explains it.
- **Whether any API key is ever put in a URL or query string** (rather than
  a header) anywhere backend calls out to a third party. This matters
  because an HTTP client's own exception message routinely includes the
  request URL (e.g. `httpx.HTTPStatusError`'s default `str()`), so a
  key-in-URL plus an unhandled exception is a realistic leak path even
  without any custom logging. Checked every outbound `httpx`/`requests`
  call site across `backend/app/`: OpenRouter (`core/llm.py`), Finexer,
  TrueLayer, Mono, Yapily and Stripe(SDK) all authenticate via headers
  (`Authorization: Bearer ...`, `mono-sec-key`, HTTP Basic for Yapily,
  Stripe's own SDK). No API key found in a URL or query string anywhere in
  the app process. `routers/mono.py`'s `GET /auth/mono/public-key` does
  return `MONO_PUBLIC_KEY` in a response body, which is correct and
  intentional (a publishable/public key, meant for the client-side Mono
  Connect widget, the same shape as a Stripe publishable key).
- **Whether the app logs full request/response bodies anywhere.** The one
  slow-request logging middleware in `main.py`
  (`_log_slow_requests`) logs only method, path, status code and elapsed
  time — never headers, query strings, or bodies. No other
  request-logging middleware exists.
- **Whether webhook payloads are logged in full.** `routers/webhooks.py`
  stores every inbound TrueLayer/Finexer webhook payload verbatim in
  `webhook_events_col` (by design — it's the operational audit trail for
  "did we get this delivery and what did we do with it") and additionally
  `logger.warning("Unhandled webhook type: %s payload: %s", event_type,
  event)` for any TrueLayer event type the route doesn't specifically
  handle. Provider webhook payloads for these two integrations carry
  transaction/account identifiers and metadata, not raw bank credentials
  or card numbers (confirmed by reading `truelayer_webhook`'s and
  `finexer_webhook`'s own payload handling — neither ever reads or stores
  a token, sort code, or account number out of the webhook body itself,
  only ids used to look up the corresponding stored, encrypted connection).
  This is a real PII-adjacent design choice (transaction metadata is
  personal data under UK GDPR) rather than a bug: it's already covered by
  the existing 30-day TTL on `webhook_events_col` (`SECURITY.md` §6's
  retention table) and by Mongo access controls, the same protection every
  other stored transaction gets. Not changed by this pass; flagged here so
  it's a documented, deliberate position rather than an unreviewed one.
- **Whether an exception's raw text ever reaches an HTTP response body.**
  This is the closest sibling class found. `f"...{e}"` (or `str(e)`)
  embedded directly in an `HTTPException` detail, or returned as a Penny
  tool's error string (which an LLM can then relay to the user in prose),
  appears in roughly 30 call sites, concentrated in
  `backend/app/services/penny_tools.py` (each Penny tool's own
  try/except), plus a handful of routers
  (`routers/transactions.py:785`, `routers/can_i.py:1260`,
  `routers/spend_verdict.py:79,95`, `routers/broadcast.py:92,106`,
  `routers/checkpoints.py:36,74`, `services/pdf.py` four call sites,
  `routers/mono.py:39` — `f"Mono exchange failed: {r.text[:200]}"`, which
  passes through up to 200 characters of Mono's own raw error response
  body). None of these were found to leak an actual secret in practice
  during this review (every outbound call authenticates via headers, per
  the point above, and Python's own exception messages for the errors
  these blocks actually catch — validation errors, timeouts, Mongo
  errors, malformed provider responses — don't typically embed
  credentials). But the *pattern* is the same shape as the PEM-leak class:
  unstructured internal text reaching an external-facing surface with no
  filter in between, so a future exception type (a new library, a changed
  provider error format, a misconfigured client that DOES put a key in a
  URL) could turn any one of these into a real leak with no code change at
  the call site itself, only a change in what the wrapped call happens to
  raise.

## What this pass did

- Fixed nothing here directly — thirty-odd call sites across a single
  services module is not a "small and safe" fix to make silently inside a
  pentest-readiness item, and none of them demonstrated an actual leak
  today. Documented instead, per this item's own instruction to report a
  weakness clearly rather than quietly patch it.
- Confirmed the original incident's fix (the `UPPER_SNAKE_CASE`-only
  match in `scripts/env_drift.py`) is real, in place, and covers all three
  of that script's collectors, not just the one that leaked.
- Confirmed no API key or bank credential is ever placed somewhere an
  exception's default `str()` would echo it (URLs/query strings), which is
  the main way the `f"...{e}"` pattern above could turn into an actual
  secret leak rather than an internal-detail leak.

## Recommended follow-up (not done here, too large for this item)

A small shared helper — e.g. `_safe_error(e) -> str` that returns a fixed,
generic message for exception types not explicitly allow-listed to have
their `str()` shown to a user, and audits/allow-lists the ones (like a
`ValueError` raised deliberately with a user-safe message a few lines above
it) that are fine — would close this whole class in one place rather than
30 call sites individually, and is the kind of change worth its own item
given the number of touch points and the value of getting the review
right rather than fast. `services/penny_tools.py`'s concentration of the
pattern makes it the natural first target if this is picked up.
