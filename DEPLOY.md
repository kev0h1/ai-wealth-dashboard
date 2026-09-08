# Deployment runbook: Vercel (frontend) + Railway (backend) + Atlas M0

Target architecture:

```
Vercel  ──/api/* rewrite──▶  Railway "web"   (FastAPI, uvicorn, $PORT)
(Next.js frontend)          Railway "worker" (arq: sync + crons)
                            Railway "Redis"  (arq queue)
                                   │
                            MongoDB Atlas M0 (mongodb+srv://)
GitHub Actions (nightly) ──▶ Cloudflare R2   (mongodump backups)
```

The repo is already prepared: backend `Dockerfile` (+ `.dockerignore`), Mongo
pool capped at 20/process (`app/db/collections.py`), Next.js `output` gated for
Vercel, and the `/api/*` → backend rewrite in `frontend/next.config.ts`.

This file is the one-time setup: standing the infrastructure up the first
time. Once it exists, every later production deploy (promoting `main` to
the `release` branch Vercel and Railway actually run) goes through
`docs/ops/RELEASE.md` and `scripts/release.py`, never a manual `git push`
or CLI deploy command; see that runbook for the repeatable procedure.

---

## ⚠️ The one that will ruin your day: read first

`TOKEN_KEY` is the Fernet key that **encrypts every stored bank token**. The
migrated data contains those tokens as encrypted blobs. They decrypt at runtime
**only if the Railway backend's `TOKEN_KEY` env var equals the current key**.

If `TOKEN_KEY` is wrong/absent, the backend regenerates a new one and **every
bank connection becomes permanently undecryptable**, every user must reconnect
every bank. The same "regenerates on each deploy" trap applies to
`SESSION_SECRET`, `TRUELAYER_WEBHOOK_SECRET`, and `VAPID_PRIVATE_KEY`.

**Set all four from the current values before the first deploy.**

Retrieve the current values from this server (copy each directly into Railway,
do not paste them into chat/tickets):

```bash
cat backend/.token_key            # → TOKEN_KEY
cat backend/.session_secret       # → SESSION_SECRET
cat backend/.webhook_secret       # → TRUELAYER_WEBHOOK_SECRET
cat backend/.vapid_private_key     # → VAPID_PRIVATE_KEY (PEM; see note in env table)
grep -v '^#' backend/.env          # → all the API keys / client secrets below
```

---

## Step 1: Atlas M0

1. In the M0 cluster: **Network Access** → allow `0.0.0.0/0` (Railway egress IPs
   aren't static on the hobby plan), M0 access is still gated by the DB user
   credentials, so this is acceptable for M0.
2. **Database Access** → create a user with read/write on the `wealth` DB.
3. Copy the `mongodb+srv://…` connection string → this is `MONGO_URI`.

## Step 2: Migrate the data

A dump of the current DB is at `/root/wealth-migration/wealth-*.gz` (153 KB).
Restore it into M0 (run from this server; `<M0_SRV_URI>` is the string from Step 1):

```bash
mongorestore --uri="<M0_SRV_URI>" --gzip \
  --archive=/root/wealth-migration/wealth-20260718-195635.gz \
  --nsFrom='wealth.*' --nsTo='wealth.*'
```

Verify the counts match (should be ~1,896 transactions, 30 accounts, etc.):

```bash
mongosh "<M0_SRV_URI>" --quiet --eval \
  'db.getSiblingDB("wealth").transactions.countDocuments()'
```

## Step 3: Railway: Redis

Add the **Redis** plugin to the project. Railway exposes it as a reference
variable (e.g. `${{Redis.REDIS_URL}}`), use that for `REDIS_URL` on both
services below.

The API's rate limiter and the mobile login "pending" hand-off store are
both backed by this Redis (`REDIS_URL`), not in-process memory, so they work
correctly across multiple `web` replicas: a rate-limit hit and a mobile poll
can land on different instances and still see the same state. If Redis is
unreachable, the API degrades rather than failing: rate limits fall back to
a per-process count and the pending-login store falls back to a per-process
dict, both with the same limits and TTLs as the Redis-backed path. That
degraded mode is only correct with a single replica, so treat sustained
Redis unavailability as a page, not a shrug. With this in place, E2
(Railway Pro and replicas) can proceed.

## Step 4: Railway: web service

- **New service** → deploy from this GitHub repo.
- **Root directory:** `backend`  · **Builder:** Dockerfile (auto-detected).
- Railway sets `$PORT`; the Dockerfile already binds it. Health check path: `/health`.
- Set the env vars from the **Backend env vars** table below.

## Step 5: Railway: worker service

- **New service** → same repo, **root directory `backend`**, same Dockerfile.
- **Override the start command:**
  `arq app.workers.sync_worker.WorkerSettings`
- Give it the **same env vars** as the web service (it needs Mongo, Redis,
  TOKEN_KEY, TrueLayer creds, OpenRouter, etc.). No `$PORT` needed.
- The 4-hourly reconcile and daily digest are in-process arq crons; the worker
  just needs to stay running. No external scheduler.

## Step 6: Vercel: frontend

- Import the repo, **root directory `frontend`**.
- Env var: `BACKEND_URL` = the Railway **web** service public URL
  (e.g. `https://wealth-web-production.up.railway.app`). The `/api/*` rewrite
  proxies to it, so the app stays same-origin (no CORS, cookie-ready).
- Deploy → note the Vercel URL (or attach your domain). This URL is `APP_URL`.

## Step 7: Point APP_URL + OAuth/webhook back

1. Set `APP_URL` on **both** Railway services to the Vercel URL, then redeploy them.
2. **Google Cloud Console** → OAuth client → Authorized redirect URIs → add
   `https://<APP_URL>/api/auth/google/callback` and
   `https://<APP_URL>/api/auth/google/mobile-callback`.
3. **TrueLayer console** → redirect URIs → add
   `https://<APP_URL>/api/auth/truelayer/callback` (this is also
   `TRUELAYER_REDIRECT_URI`). Webhook URI is
   `https://<APP_URL>/api/webhooks/truelayer/<TRUELAYER_WEBHOOK_SECRET>`.

## Step 8: Backups (Cloudflare R2)

- Create an R2 bucket + an API token (Access Key ID / Secret).
- Add these **repo secrets** (Settings → Secrets → Actions):
  `BACKUP_MONGO_URI` (the M0 SRV string), `R2_ACCESS_KEY_ID`,
  `R2_SECRET_ACCESS_KEY`, `R2_ENDPOINT`
  (`https://<account>.r2.cloudflarestorage.com`), `R2_BUCKET`.
- `.github/workflows/backup.yml` runs nightly (03:00 UTC) and on demand
  (Actions → run workflow). It dumps M0 → R2 and prunes >30-day-old archives.

## Step 9: Verify

```bash
curl -s https://<railway-web-url>/health          # {"status":"ok",...}
curl -s https://<APP_URL>/api/health              # same, via the Vercel proxy
```

Then in the app: sign in with Google, open a bank account detail (confirms the
migrated **encrypted tokens decrypt**, the TOKEN_KEY proof), trigger a sync
(confirms the worker + Redis), and check the worker logs show the reconcile cron.

---

## Railway Pro and replicas (E2)

Scaling the worker/web services past a single Railway instance each — the
item's own framing: "Railway Pro and replicas, once D4 is done". D4 is
done (Step 3 above): the rate limiter and the mobile login "pending"
hand-off store both live in Redis (`REDIS_URL`), not in-process memory, so
multiple `web` replicas already see consistent state. That's the blocker
E2 was waiting on; it's clear.

**What's Kevin's to do** (account actions, not code):

1. Upgrade the Railway project to the **Pro** plan (Hobby caps replicas
   and concurrent resources).
2. Turn on **replicas** for the `web` service in Railway's service
   settings (worker stays single-replica — see "why the worker stays
   single-replica" below).
3. Confirm both `web` replicas and the `worker` service still point at
   the **same** `REDIS_URL` and `MONGO_URI` (Railway reference variables
   already guarantee this if unchanged since Step 3/4/5 — nothing to
   re-enter, just worth eyeballing after the plan upgrade).

**Why the worker stays single-replica.** arq's cron jobs (including
`task_reconcile_truelayer`) run on every worker process that boots with
that `WorkerSettings`. Two worker replicas would double-fire the 4-hourly
reconcile (and every other cron), each building its own candidate list and
racing to enqueue the same jobs — the `_job_id` dedupe
(`reconcile:<id>`/`fx_reconcile:<id>`) stops the *sync* jobs from running
twice, but not the redundant Mongo scan/candidate-building work itself.
Scaling sync throughput is `max_jobs` (currently 5, in `WorkerSettings`)
and the spread below, not worker replica count. If reconcile ever needs to
run across multiple worker processes, that needs a leader-election step
first — out of scope for E2.

**What the code already does** (this item's own half, shipped): before E2,
`task_reconcile_truelayer` enqueued every stale connection's sync job in
one burst, every 4 hours. At today's connection counts that's harmless,
but the item's own arithmetic makes the risk concrete once the user base
(and therefore connection count) grows: **10,000 connections fired in one
burst is about 42 syncs a minute** if the worker could somehow process
them all inside one minute — an unknown but real risk against whatever
Finexer's actual (undocumented) rate limit turns out to be. So the burst
is now spread across a window instead:

| Env var | Default | What it controls |
|---|---|---|
| `RECONCILE_SPREAD_MINUTES` | `210` | How much of the window each job's `_defer_by` is allowed to use. Deliberately a little inside the connection's own 3h30 staleness window (`_DEFAULT_REFRESH_WINDOW` in `app/workers/sync_worker.py`), so a connection spread to the very end of one run is still safely re-evaluated as "due" by the next 4-hourly tick. |
| `RECONCILE_MAX_PER_MINUTE` | `40` | The Finexer-safe ceiling — 10,000 / 240 minutes ≈ 42/min; 40 leaves headroom. |
| `RECONCILE_MIN_GAP_SECONDS` | `2` | Floor on the gap between any two jobs, independent of the per-minute ceiling (matters if the ceiling above is ever raised a lot). |

The math to re-run if the connection count keeps growing: at the default
40/min ceiling, 10,000 connections takes 10,000 / 40 = **250 minutes** to
fully spread — already past the 210-minute default window. That's the
overflow path: nothing is dropped (every job still gets enqueued, just
later than the window), but `task_reconcile_truelayer`'s summary logs a
WARNING with the overflow count, and it's a sign either
`RECONCILE_MAX_PER_MINUTE` needs raising (once Finexer confirms a higher
real limit) or the cron's own 4-hourly interval needs widening so the
window has more room. `GET /admin/sync-stats` (bot or owner, same gate as
`/admin/llm-usage`) surfaces the last reconcile's summary (including
`overflow`) and the observed distribution of Finexer requests per sync
across all consents, so this can be watched rather than guessed at.

Finexer's own documented rate limit is unknown as of this writing — there's
nothing about it in their API docs available to this codebase. The 40/min
default is derived entirely from the item's own back-of-envelope sum, not
a number Finexer confirmed. `app/services/finexer_sync.py` now also
retries a real HTTP 429 (honouring `Retry-After`, capped at 30s, up to 3
retries before giving up on that one consent) and records
`last_sync_requests`/`last_sync_429s` on every consent it syncs, so the
first real 429 — or the `/admin/sync-stats` distribution creeping up — is
the signal to tighten `RECONCILE_MAX_PER_MINUTE` down from 40, not a
guess.

## MCP connector

F3 (2026-09-08): `/mcp` is a read-only Streamable HTTP MCP endpoint exposing
Penny's own read tools (never the propose/write tools) to a user's own AI
assistant. Included in the Connect and Max tiers only. See
`PENNY_TOOLS.md`'s "Not-MCP decision" section for the tool/scope/masking
rules and `app/routers/mcp.py` for the implementation.

F2 (2026-09-08): the OAuth 2.1 authorisation server shipped:
`app/routers/oauth.py`. `/mcp` now discovers OAuth automatically via RFC
9728 (`GET /.well-known/oauth-protected-resource`), so connecting Claude's
or ChatGPT's custom connector is just:

1. Add a custom connector pointing at `https://api.wealth.auriqltd.co.uk/mcp`
   (UAT: use the UAT host instead).
2. The client discovers `/.well-known/oauth-authorization-server`, registers
   itself dynamically (RFC 7591, no manual client setup), and opens the
   sign-in/consent flow in a browser: sign in with Google (or Apple), see
   the three scopes in plain language, approve. No pasting a token by hand.
3. `search_transactions` and every `propose_*` tool are still not offered
   at all; the 18 read tools that are offered never return raw transaction
   rows (see `app/services/mcp_mask.py`), only aggregates, verdicts and
   figures, and now the token itself is scoped to only what the user
   approved (`accounts:read` / `plans:read` / `insights:read`).

Tokens: access tokens last 1 hour, refresh tokens 30 days with rotation
(the old refresh token is revoked the instant a new one is issued); PKCE
(S256) is mandatory since every connector is a public client (no client
secret is ever issued, `token_endpoint_auth_method: "none"`). Revoke a
connection with `POST /auth/oauth/revoke` (RFC 7009) or, once F4 ships, from
Settings' "Connected assistants" list (`GET /oauth/connections`,
`DELETE /oauth/connections/{client_id}`, both session-authenticated today).

**Allowance and audit:** the connector shares the tier's own monthly call
allowance (`TIER_LIMITS[...]["mcp_tool_calls_per_month"]`: 2,000 on Connect,
5,000 on Max, 0 (not included) below that). Every `tools/call` writes one
audit doc to `mcp_calls_col` (tool, client, ok, timestamp, latency, count of
keys masked, never the values); a user can read their own rows back via
`GET /mcp/audit?month=` (F4's "Connected assistants" settings surface,
`components/ConnectedAssistantsCard.tsx`, renders it). F9 (2026-09-08)
surfaces the allowance itself on that same card ("N of 2,000 calls this
month, resets 1 Oct") from `app.core.subscription.mcp_allowance`, and adds
one MCP call pack (`MCP_CALL_PACKS`, 1,000 calls for £2.99, same 90-day
pack mechanics as the Penny top-up packs above, shared implementation via
`_settle_packs`). There is no purchase flow yet (billing is item B5);
until then the only way to grant a pack is `POST /subscription/admin/topup`
with `{"kind": "mcp", "pack_id": "mcp_1000"}` (bot-only, same auth as the
existing Penny grant path, `kind` defaults to `"penny"` when omitted).

**Rate limits (F7, 2026-09-08):** the connector used to key its rate limit
by IP, but Claude's and ChatGPT's connectors call from shared egress ranges,
so every user of the same assistant would have shared one bucket. `/mcp` is
authenticated on every call, so the old per-IP rule in `app/core/ratelimit.py`
is gone; instead `app/routers/mcp.py` applies two limits per *principal*
(OAuth `client_id` when the call came through F2's OAuth flow, else the
session/token uid), after `resolve_mcp_principal` runs and before the tool
allowance check:

- **Burst**: `MCP_BURST_PER_MINUTE` (default 60) `tools/call`s per minute.
- **Daily soft cap**: `MCP_DAILY_SOFT_CAP` (default 500) `tools/call`s per
  calendar day (UTC), a coarser backstop so a runaway agent loop can't burn
  a whole month's allowance in an hour even while staying under the burst
  limit. Stored as a `mcp:day:<key>:<YYYY-MM-DD>` Redis counter with a 48h
  TTL (in-process fallback if Redis is down).
- `initialize`/`ping`/`tools/list` are cheap and not billed against either
  limit above, but still get their own generous per-principal ceiling,
  `MCP_CHEAP_METHOD_PER_MINUTE` (default 240), so a broken client's
  reconnect loop can't hammer them unbounded.

Either of the first two tripping returns HTTP 429 with a `Retry-After`
header (seconds to the next minute for burst, seconds to midnight UTC for
the daily cap) and a JSON-RPC error body (code `-32003`, `data.kind` is
`"burst"` or `"daily"`). A rate-limited call writes no audit doc and is
never counted against the monthly allowance. The old `/auth/oauth/register`
per-IP rule (unauthenticated by design, that's the point of dynamic client
registration) is unchanged, and `/auth/oauth/token` / `/auth/oauth/authorize`
now have their own explicit per-IP entries too (30/minute, same as the
generic `/auth/` rule they used to fall through to).

### MCP connector flag

A17 (2026-09-08): everything above is built, but not part of the Finexer
compliance answers yet (they say "planned", not live), so it must ship
absent from production, not merely unauthenticated. Two env vars gate it
and must be turned on together, or both left off:

| Var | UAT (this VPS) | Production (Railway / Vercel) |
|-----|-----------------|--------------------------------|
| `MCP_CONNECTOR_ENABLED` (backend `.env`, `app/core/config.py`) | `true` | unset |
| `NEXT_PUBLIC_MCP_CONNECTOR` (frontend `.env.local`, `lib/featureFlags.ts`) | `on` | unset |

With `MCP_CONNECTOR_ENABLED` unset (default false), `app/main.py` never
registers `app/routers/oauth.py` or `app/routers/mcp.py` at all, so no
`/mcp`, `/auth/oauth/*` or `/.well-known/oauth-*` routes exist, and
`app/core/auth.py`'s `/mcp`-specific `WWW-Authenticate` discovery header and
its `sorted_at_` bearer pass-through are both no-ops. With
`NEXT_PUBLIC_MCP_CONNECTOR` unset, Settings never renders "Connected
assistants" (or fetches connections/audit), `/oauth/consent` shows a calm
"not available yet" screen instead of running the consent flow, and the
Privacy/Terms "AI assistants" sections are stripped out of the rendered
legal pages (`lib/legalContent.ts`'s `stripMcpSections`, driven by the
`<!-- mcp-connector:start/end -->` markers in `content/privacy.md` and
`content/terms.md`). See `tests/test_mcp_connector_flag.py` for the
route-table and middleware assertions. The design previews
(`/design/connected-assistants`, `/design/oauth-consent`) render regardless
of the flag, since they use fixtures, not the gated surfaces.

**Before the connector actually launches on production:** turn both vars on
in Railway and Vercel, then regenerate `frontend/public/TERMS.pdf` and
`PRIVACY.pdf` with the flag on (see the Verify step above, plus the PDF
recipe used for the current, flag-off PDFs: `npx next build --webpack`,
then `npx next start -p <free-port>`, then `google-chrome --headless=new
--no-sandbox --disable-gpu --print-to-pdf=... --no-pdf-header-footer
<url>`, then stop the server and delete `.next`/`out`/any stray
`ai-wealth-dashboard/` dir that `next build --webpack` can leave behind).

### MCP connector URL

F8 (2026-09-08): the connector's own public URL is a separate setting from
`API_PUBLIC_URL`, so it can be pointed at a dedicated hostname (e.g.
`https://mcp.wealth.auriqltd.co.uk/mcp`) without moving the API's own
domain, once that host is DNS-provisioned — that's a Kevin task, alongside
`API_PUBLIC_URL`'s own missing DNS record (see backlog A18: production is
currently only reachable via the Vercel `/api` rewrite, `api.wealth.auriqltd.co.uk`
has no DNS record at all yet). This backend answers on any hostname routed
to it, so pointing the connector at a new host needs no code change, only
the env var below plus the DNS/reverse-proxy record.

| Var | Default | Purpose |
|-----|---------|---------|
| `MCP_PUBLIC_URL` (backend `.env`, `app/core/config.py`) | `${API_PUBLIC_URL}/mcp` | the connector's full URL: `resource` in the RFC 9728 protected-resource metadata. `authorization_servers` (and every OAuth endpoint, authorize/token/register/revoke) stays on `API_PUBLIC_URL`; only `resource` moves. |
| `NEXT_PUBLIC_MCP_URL` (frontend `.env.local`, `lib/featureFlags.ts`) | `https://api.wealth.auriqltd.co.uk/mcp` | copy only, the address Settings' "Connected assistants" empty state (`components/ConnectedAssistantsCard.tsx`) tells a user to point Claude/ChatGPT at. Must be kept in sync with the backend's `MCP_PUBLIC_URL` by hand; the frontend never calls `/mcp` itself. |

Until the dedicated hostname exists, set **UAT**'s `frontend/.env.local` to
`NEXT_PUBLIC_MCP_URL=https://uat.wealth.auriqltd.co.uk/api/mcp` (UAT's
nginx only exposes one public host, `uat.wealth.auriqltd.co.uk`, proxying
`/api/` to the backend on `:8000`, there is no separate UAT API
subdomain), and leave the backend's `MCP_PUBLIC_URL` matching (same value,
in `backend/.env`) so the metadata `resource` a connector discovers agrees
with the URL the card tells the user to add. Leave both unset in
production until A18 gives `api.wealth.auriqltd.co.uk` (or a dedicated
`mcp.` host) a real DNS record.

**WWW-Authenticate header (F11, 2026-09-08):** the `WWW-Authenticate`
header an unauthenticated `/mcp` 401 carries (`app/core/auth.py`'s
`MCP_WWW_AUTHENTICATE`, RFC 9728) is built from `API_PUBLIC_URL`, not
`MCP_PUBLIC_URL`, and it preserves that value's path (for example
`.../api/.well-known/oauth-protected-resource`, not just the bare origin).
This is required precisely so discovery still works behind a reverse proxy
that only exposes `/.well-known/*` under a path prefix like `/api` (nginx
on UAT, Vercel's `/api` rewrite in production once A18 lands): a header
built from the bare origin would 404 against such a proxy, since it never
routes `/.well-known/*` at the site root.

`API_PUBLIC_URL` and `MCP_PUBLIC_URL` are both required on UAT for this
reason, see `docs/ops/ENV.md`.

For full RFC 9728 compliance, an MCP client is technically entitled to try
unauthenticated discovery at the resource's own root (`/.well-known/...`
with no `/api` prefix at all), not just under `/api`. Claude's connector
already works today hitting `/api/.well-known/...` directly, so this is
optional spec-polish, not required for the fix in this section. If Kevin
wants that root-level path to also resolve, the following nginx snippet
(applied on the actual nginx host, outside this repo, not part of any
deploy script here) proxies the root-level well-known paths through to the
backend's existing `/api`-prefixed handlers:

```
location = /.well-known/oauth-authorization-server/api { proxy_pass http://127.0.0.1:8000/.well-known/oauth-authorization-server; }
location = /.well-known/oauth-protected-resource/api/mcp { proxy_pass http://127.0.0.1:8000/.well-known/oauth-protected-resource; }
location = /.well-known/oauth-protected-resource { proxy_pass http://127.0.0.1:8000/.well-known/oauth-protected-resource; }
```

### MCP-only service mode

F10 (2026-09-08): the same backend image (`backend/Dockerfile`, unchanged)
can run as a second service that mounts ONLY the connector (`app/routers/
mcp.py` and `app/routers/oauth.py`, which between them also cover the
`/.well-known/oauth-*` discovery paths) plus `/health` — none of the app API
(`/accounts`, `/profile`, `/can-i`, everything else `app/main.py`'s
`_routers()` normally builds). This exists so a second Railway service on a
dedicated `mcp` hostname can isolate assistant traffic (Claude/ChatGPT
connector calls) from the main app API once the first Connect customer or
any meaningful load arrives, without a second image, a second codebase, or
a second deploy pipeline — it's the same container, one env var different.
**Not deployed anywhere yet** as of this writing; this section documents
how the second service would be configured when it is.

Set `MCP_ONLY=true` (`app/core/config.py`'s `_parse_flag`, same truthy set
as `MCP_CONNECTOR_ENABLED`: `1`/`true`/`on`, case-insensitive) on that
service only, never on the main `ai-wealth-dashboard` or `worker` services.
`MCP_ONLY=true` implies the connector itself must be on: if
`MCP_CONNECTOR_ENABLED` isn't also explicitly truthy there, `config.py`
logs a startup warning and treats it as enabled anyway (a connector-only
service with the connector disabled would boot with almost no routes at
all, so this fails soft, not fast — see `app/core/config.py`'s comment by
`MCP_ONLY`). In practice set both on the new service:

| Var | Second (`mcp`) service | Main `ai-wealth-dashboard` / `worker` services |
|-----|--------------------------|--------------------------------------------------|
| `MCP_ONLY` | `true` | unset (or `false`) |
| `MCP_CONNECTOR_ENABLED` | `true` | per the "MCP connector flag" table above (unset in production until launch) |
| `MCP_PUBLIC_URL` | the service's own public URL, e.g. `https://mcp.wealth.auriqltd.co.uk/mcp` (F8, see "MCP connector URL" above; needs its own DNS record, same open item as `API_PUBLIC_URL`/A18) | unchanged |
| `MONGO_URI`, `REDIS_URL` | same values as the main services — one Mongo, one Redis, shared | unchanged |
| every other backend var (`APP_URL`, `TOKEN_KEY`, `GOOGLE_CLIENT_ID`/`_SECRET`, etc.) | same values as the main services, the connector's OAuth flow and session/bearer auth need them too | unchanged |

What an `MCP_ONLY` instance skips at startup: the one-time migrations and
cache seeds in `app/main.py`'s `_migrate` handler (user_id backfill,
category-kind migration, subscription seeding, stale-connection/Yapily
cleanup, cashflow cache warm-up, penny top-up pack migration) — the main
app service already runs these on every boot against the same shared
Mongo, so an MCP-only instance skipping them is not a missed migration.
Index creation (`_create_indexes`) still runs unconditionally: it's
idempotent, cheap, and the connector reads the same collections the
indexes cover. `GET /health` on an `MCP_ONLY` instance reports
`{"status": "ok", "mode": "mcp-only"}` (no `truelayer_configured` /
`finexer_configured` fields, since those only mean something for the app
API) — useful for telling the two services apart from a health check alone.
See `backend/tests/test_mcp_only_mode.py` for the route-table, `/health`,
and startup-skip assertions, extending `tests/test_mcp_connector_flag.py`'s
A17 coverage.

---

## Backend env vars (Railway: web AND worker)

`docs/ops/ENV.md` is the canonical, exhaustive list of every backend
variable name (with the expected presence per environment); the table
below is the deploy-time quick reference, run `backend/.venv/bin/python
scripts/env_drift.py` to check the two against what Railway actually has.

| Var | Source | Notes |
|-----|--------|-------|
| `MONGO_URI` | Atlas M0 SRV string | Step 1 |
| `REDIS_URL` | Railway Redis reference | `${{Redis.REDIS_URL}}` |
| `TOKEN_KEY` | `cat backend/.token_key` | 🔴 must match, see top |
| `SESSION_SECRET` | `cat backend/.session_secret` | 🔴 or everyone re-logs-in |
| `TRUELAYER_WEBHOOK_SECRET` | `cat backend/.webhook_secret` | 🔴 in the webhook URL |
| `VAPID_PRIVATE_KEY` | `cat backend/.vapid_private_key` | PEM. Paste multiline, or replace newlines with `\n` (config.py un-escapes `\n`) |
| `VAPID_SUBJECT` | `mailto:you@domain` | |
| `APP_URL` | Vercel URL | Step 6/7 |
| `TRUELAYER_REDIRECT_URI` | `https://<APP_URL>/api/auth/truelayer/callback` | |
| `TRUELAYER_CLIENT_ID` / `_SECRET` | from `backend/.env` | |
| `GOOGLE_CLIENT_ID` / `_SECRET` | from `backend/.env` | |
| `OPENROUTER_API_KEY` | from `backend/.env` | Penny + categorisation |
| `TAVILY_API_KEY` | from `backend/.env` | savings insights |
| `LOGODEV_TOKEN` | from `backend/.env` | merchant logos |
| `ALLOWED_EMAILS` | from `backend/.env` | comma-separated allowlist, the seed list; see "Sign-up mode" below for day-to-day invites |
| `OPEN_SIGNUP` | unset (defaults false) | see "Sign-up mode" below |
| `FUEL_FINDER_CLIENT_ID` / `_SECRET` | from `backend/.env` | fuel prices |
| `MONO_*`, `YAPILY_*` | from `backend/.env` | only if using the Kenya region |
| `SENTRY_DSN` | optional | error monitoring |
| `API_PUBLIC_URL` | optional, defaults to `https://api.wealth.auriqltd.co.uk` | the API's own domain, reached directly by Capacitor mobile builds (`build:mobile:prod`); added to CORS alongside `APP_URL` |

**Do NOT set** `PORT` (Railway injects it). Do not set the secret *file* paths,
env vars take precedence and the files are excluded from the image.

### Sign-up mode

`OPEN_SIGNUP` controls whether new accounts can be created at all. Default
`false` (unset) keeps registration restricted to `ALLOWED_EMAILS` plus the
in-app allow list (see below), unchanged behaviour, the safe default until
public launch. Set `true` to let any
verified Google or Apple identity create an account. Either way, sign-in
resolves through one identity path (`app/core/identity.py`): a verified
email's first-seen spelling is remembered (Gmail dot-insensitive) so later
sign-ins with a different dot spelling land on the same account, and an
Apple Hide My Email relay sign-in auto-links to the account it created so a
later explicit link (Settings → linked identities) can claim/re-point it.
New accounts and auto-links created this way are recorded as alias/link
documents in the `linked_identities` Mongo collection, same collection
Phase 1's explicit Apple linking already used.

Day-to-day invites (adding or removing a tester) don't need an
`ALLOWED_EMAILS` edit and a redeploy: the `/ops/go-live` page's Allowlist
section (bot-or-owner-only `GET`/`POST`/`DELETE /admin/allowlist`,
`app/routers/admin_allowlist.py`) manages an `allowed_signups` Mongo
collection that `app/core/allowlist.py` consults after `ALLOWED_EMAILS` on
every sign-in, same Gmail dot-insensitive matching. `ALLOWED_EMAILS` itself
is still only ever changed by editing the env var and redeploying.

## Frontend env vars (Vercel)

`docs/ops/ENV.md` is the canonical, exhaustive list of every frontend
variable name, including all the `NEXT_PUBLIC_*` flags below; the table
here is the deploy-time quick reference.

| Var | Value |
|-----|-------|
| `BACKEND_URL` | Railway **web** public URL (no trailing slash) |

Leave `NEXT_PUBLIC_API_URL` unset, it defaults to `/api`, which the rewrite proxies.

### Web product flag

`NEXT_PUBLIC_WEB_PRODUCT=off` turns the deployed web build into an
app-download page: every product route renders "Sorted is an app" with
store badges instead of the real dashboard, for any visitor who isn't
signed in as the owner (`PRIMARY_EMAIL`, see `backend/app/core/config.py`).
The owner can still sign in and use the full product on the web.

Set this on the **Vercel production project** only. Leave it unset on UAT
(this VPS) so the whole team keeps testing the real app there, and never set
it for a mobile build; `frontend/scripts/build-mobile.sh` already forces
`NEXT_PUBLIC_WEB_PRODUCT=on` on its own `next build`, so a Capacitor export
can never ship locked regardless of what's in the environment that invokes
it.

`/terms`, `/privacy`, the design previews (`/design/*`), and the
OAuth/webhook return routes (`app/auth/*/callback/route.ts`) stay reachable
either way, they don't go through the product gate at all.

Optional companion vars, read by `components/StoreBadges.tsx`
(`frontend/lib/webProduct.ts`): `NEXT_PUBLIC_APP_STORE_URL` and
`NEXT_PUBLIC_PLAY_STORE_URL`. Leave unset until the store listings exist;
the badge renders a "coming soon" placeholder instead of a dead link.

### TrueLayer picker flag

`NEXT_PUBLIC_TRUELAYER_PICKER=on` (`frontend/lib/featureFlags.ts`) shows the
legacy "Add Bank via TrueLayer" entry in the Accounts "Add" menu, alongside
the primary "Add Bank" (Finexer) entry. Set it on the **UAT frontend
service** (this VPS's `wealth-frontend` systemd unit) so the old flow stays
reachable for testing. Leave it unset on the **Vercel production project**,
where "Add Bank" (Finexer) is the only connect path.

Mobile builds derive it automatically in `frontend/scripts/build-mobile.sh`:
"on" by default (day-to-day Android APKs and the `ios-capacitor` TestFlight
workflow), explicitly `off` when the build targets prod (`MOBILE_TARGET=prod`,
set by the `ios-capacitor-prod` Codemagic workflow, or `npm run
build:mobile:prod`'s `MOBILE_API_BASE`). No `codemagic.yaml` changes were
needed for this. The script's scratch-dir rsync also excludes `.env.local`,
so a prod mobile build built on this VPS can't pick up the UAT frontend's
gitignored `.env.local` (which carries `NEXT_PUBLIC_TRUELAYER_PICKER=on`)
either.

`build-mobile.sh` also refuses to run at all unless its own resolved
directory contains `package.json`, `next.config.ts` and `app/`, and refuses
to let its scratch directory resolve outside that directory, a guard added
after a copy of the script run from `/tmp` on 2026-09-08 `cd`'d to `/` and
started mirroring the root filesystem into `/.mobile-build` before being
killed (`npm run check:build-mobile-guard` tests the guard in isolation).

## Android release signing

C2 (2026-09-09): `capacitor-spike/android/app/build.gradle` reads a release
`signingConfig` from `capacitor-spike/android/keystore.properties`, a file
generated per-machine and never committed. The whole `capacitor-spike/android/`
tree is gitignored (line 65 of the root `.gitignore`), so this covers the
keystore and properties file automatically, no extra `.gitignore` entry was
needed.

- **Keystore path:** `capacitor-spike/android/keys/upload-keystore.jks`
  (PKCS12, alias `upload`, 2048-bit RSA, 10,000-day validity,
  `CN=AURIQ LTD, O=AURIQ LTD, L=London, C=GB`).
- **Properties file:** `capacitor-spike/android/keystore.properties`
  (`storeFile`, `storePassword`, `keyAlias`, `keyPassword`). PKCS12 keystores
  require the store and key password to match, both are set to the same
  randomly generated value (`openssl rand -base64 24`).
- Both files are `chmod 600` and gitignored. The durable copy lives on this
  VPS at `/root/ai-wealth-dashboard/capacitor-spike/android/keys/` and
  `/root/ai-wealth-dashboard/capacitor-spike/android/keystore.properties`
  (worktrees under `/root/worktrees/` are deleted after each item merges, so
  the keystore must live in the shared tree to survive, not in a worktree).
  Kevin should also keep his own offline copy (password manager or an
  encrypted archive), since a lost upload key means falling back to Play's
  key-reset process via Play App Signing support.
- **Play App Signing:** this is the **upload key**, not the app signing key.
  Google holds the app signing key once Play App Signing is enabled on the
  listing (tracked as compliance item A9); every AAB uploaded to Play must be
  signed with this upload key, Google then re-signs it with the app signing
  key before distributing to devices.
- `build.gradle` fails soft when `keystore.properties` is absent: it logs
  `logger.warn(...)` and builds an unsigned release artifact instead of
  breaking the build (`bundleRelease`/`assembleRelease` for anyone without
  the keystore locally). Debug builds are unaffected either way.
- C11 (open): Kevin adds this keystore to Codemagic as a code-signing asset
  once an Android Codemagic workflow exists (there is currently no Android
  CI, see `capacitor-spike/ANDROID_PUSH.md`).

Build the signed AAB (from `capacitor-spike/android`, keystore.properties
must be present):

```bash
cd capacitor-spike/android
./gradlew bundleRelease
# output: app/build/outputs/bundle/release/app-release.aab
```

Rebuild the debug APK and publish it to the UAT download link (unsigned
debug build, separate from the Play upload key above):

```bash
cd capacitor-spike/android
./gradlew assembleDebug
cp app/build/outputs/apk/debug/app-debug.apk /var/www/wealth-downloads/wealth.apk
```

## Mobile: Codemagic TestFlight builds

`codemagic.yaml` (repo root) defines two iOS workflows, both producing a
Capacitor TestFlight build from the same pipeline (Capacitor sync,
entitlements, signing, IPA, App Store Connect publish); they differ in which
backend the static export bakes in, which branch triggers them, and which
TestFlight beta group they publish to:

| Workflow | API baked in | Triggers on push to | TestFlight beta group | When to use |
|----------|--------------|----------------------|------------------------|-------------|
| `ios-capacitor` | `https://uat.wealth.auriqltd.co.uk/api` (`npm run build:mobile`) | `main` | "UAT testers" | day-to-day TestFlight builds while testing |
| `ios-capacitor-prod` | `https://wealth.auriqltd.co.uk/api` (`npm run build:mobile:prod`; the Vercel-proxied base, until A18 gives `api.wealth.auriqltd.co.uk` its own DNS record) | `release` | "Production" | the production TestFlight build used as Q5 compliance evidence, and for the real App Store release |

Both workflows fire automatically on a push to their branch (`triggering:` in
`codemagic.yaml`, with `cancel_previous_builds: true`), and also stay
manually startable: start a Codemagic build and pick the workflow (Codemagic
UI's "Start new build" workflow dropdown, or `--workflow ios-capacitor-prod`
via the Codemagic API/CLI) to run either one on demand regardless of which
branch triggered the last automatic build. Both TestFlight beta groups ("UAT
testers" and "Production") must already exist in App Store Connect (TestFlight
tab -> group name -> +) before the corresponding workflow's publish step
runs; if a group doesn't exist, Codemagic fails that build step with a "beta
group not found" error rather than silently publishing to internal testing or
the other group.

`scripts/release.py deploy` triggers `ios-capacitor-prod` via the Codemagic
API after tagging a successful release (see "Release trigger" below); it does
not push directly to `release` itself for mobile purposes, that's a side
effect of the fast-forward `main` -> `release` push the deploy already does,
which is what the workflow's `triggering:` block reacts to.

Both workflows build the app iPhone-only (`TARGETED_DEVICE_FAMILY = 1`), because Capacitor's iOS template targets iPhone and iPad by default and that would require iPad screenshots at App Store review for an app that is not adapted for iPad.

### Build tag

The small whisper on the login and biometric-lock screens (for example
`build 2026-09-07 9763f81`, or `uat build 2026-09-07 9763f81 #42` /
`prod build 2026-09-07 9763f81 #7` on a Codemagic build) is derived
automatically at build time, not hand-edited. It is the UTC build date plus
the git short SHA, with the CI build number appended when one exists, and an
environment prefix (`uat ` / `prod `) prepended when `BUILD_TAG_ENV` is set.
On Vercel and UAT, `frontend/next.config.ts` computes it from
`VERCEL_GIT_COMMIT_SHA` or a local `git rev-parse --short HEAD` (no
`BUILD_TAG_ENV`, so no prefix). On Codemagic and local Android APK builds,
`frontend/scripts/build-mobile.sh`'s `compute_build_tag` function computes it
before its rsync step (the mobile build runs from a scratch copy with no
`.git`), preferring `git rev-parse` when available and falling back to
Codemagic's `CM_COMMIT`; `codemagic.yaml` sets `BUILD_TAG_ENV: "uat"` on
`ios-capacitor` and `BUILD_TAG_ENV: "prod"` on `ios-capacitor-prod`, so the
two TestFlight builds are visibly told apart on device (this was previously
the only way to tell a UAT TestFlight build from a production one, since both
published to the same beta group; see the table above for how that's now
also separated by group and branch). Any environment can override the whole
thing by setting `NEXT_PUBLIC_BUILD_TAG` explicitly before the build runs.

### Release trigger

`scripts/release.py deploy` (see `docs/ops/RELEASE.md`) fast-forwards
`main` -> `release` as its one deliberate production act. After tagging a
successful deploy, if both `CODEMAGIC_API_TOKEN` and `CODEMAGIC_APP_ID` are
set in the shared tree's environment, it also POSTs to the Codemagic API
(`https://api.codemagic.io/builds`) to start an `ios-capacitor-prod` build on
`release`, so a production release also produces a fresh production
TestFlight build without a manual step. This is best-effort: if the token or
app id isn't set, or the API call fails, `deploy` logs a warning and still
exits 0 for that part (the trigger failing never fails the deploy itself,
which has already fully landed by that point) — start `ios-capacitor-prod`
by hand from the Codemagic UI in that case. `--dry-run` prints the request it
would make instead of sending it. Neither `CODEMAGIC_API_TOKEN` nor
`CODEMAGIC_APP_ID` is committed anywhere; see `docs/ops/ENV.md`.

## GitHub Actions secrets (backups)

`BACKUP_MONGO_URI`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_ENDPOINT`, `R2_BUCKET`.

---

## Cutover & rollback

This section is the one-time VPS-to-cloud migration cutover. For rolling
back a normal production *release* once the infrastructure above exists,
use `docs/ops/RELEASE.md`'s rollback section and `scripts/release.py
rollback <tag-or-sha>`, not the steps below.

- The old VPS keeps running until you flip DNS / update the OAuth+TrueLayer URLs.
  Do the migration + Railway/Vercel deploy first, verify on the temporary URLs,
  then switch OAuth/TrueLayer redirect URIs and DNS last.
- **Rollback:** the VPS + its Mongo are untouched by the migration (dump is a
  copy). If anything fails, revert the OAuth/TrueLayer URIs and DNS to the VPS.
- Capacity headroom on M0: data is ~3.6 MB of 512 MB. You'll hit M0's throttled
  throughput or the 500-connection cap long before storage, move to M2/M10 then.
```
