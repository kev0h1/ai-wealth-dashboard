# Environment configuration manifest

This file is the source of truth for environment **variable names** across
UAT and production. It does not hold, and must never hold, any value.
Values live only in three places: `backend/.env` and `frontend/.env.local`
on this VPS (UAT), the two Railway services (`ai-wealth-dashboard`,
`worker`, project `gleaming-miracle`), and the Vercel project
`ai-wealth-dashboard`. `scripts/env_drift.py` reads this file's tables and
diffs them against what those four places actually have, by name only.

Columns:

- **Read in**: the module that calls `os.getenv`/`os.environ` or
  `process.env` for this name.
- **UAT** / **Production**: the expected presence in that environment,
  always starting with one of `present`, `absent` or `optional` (fine
  either way) so `scripts/env_drift.py` can parse it, followed in
  parentheses by a short reason when it isn't obvious (falls back to a
  gitignored file, has a hardcoded default, etc). When the Production cell
  starts with `present`, the variable is required there, and
  `env_drift.py check` exits non-zero if it is actually missing on either
  Railway service, whether or not it is present today; that is how the six
  "currently absent, see Known drift" rows below are meant to be read, and
  how they are worked back to green once set.
- **Notes**: also opens with `required`, `optional` or `flag` as a plain-
  English label for whoever is reading the table, but it is the
  Production cell above, not this word, that `env_drift.py` actually
  parses.

Last verified against live infrastructure: 2026-09-08 (`backend/.env`
names, `railway variables --service ai-wealth-dashboard|worker --kv`,
`vercel env ls production|preview`, project `kev0h1s-projects/ai-wealth-dashboard`).

## Backend

| Variable | Read in | UAT (VPS backend/.env) | Production (Railway, both services) | Notes |
|---|---|---|---|---|
| `MONGO_URI` | `core/config.py` | present | present | Atlas SRV string, required everywhere. |
| `OPENROUTER_API_KEY` | `core/config.py` | present | present | required; Penny + categorisation + savings insights all call OpenRouter. |
| `TAVILY_API_KEY` | `core/config.py` | present | present | required for savings-insight web lookups. |
| `LOGODEV_TOKEN` | `core/config.py` | present | present | optional; merchant logos degrade to initials without it. |
| `APP_URL` | `core/config.py` | present | present | required; CORS origin + OAuth/webhook base. |
| `API_PUBLIC_URL` | `core/config.py` | present (`https://uat.wealth.auriqltd.co.uk/api`) | absent (default `https://api.wealth.auriqltd.co.uk` has no DNS record, see A18) | required on UAT (F11): the WWW-Authenticate discovery header (RFC 9728, `core/auth.py`'s `MCP_WWW_AUTHENTICATE`) is built path-aware from this value, so it must include UAT's `/api` prefix (the path nginx actually forwards to this service) rather than a bare origin. Production has no DNS record for `api.wealth.auriqltd.co.uk` yet; A18 tracks whether to provision that DNS record or repoint this default at the Vercel-proxied host. This change alone does not fix production, prod still needs A18 resolved (or its own `API_PUBLIC_URL` override) before its MCP connector works end to end. |
| `MCP_PUBLIC_URL` | `core/config.py` | present (`https://uat.wealth.auriqltd.co.uk/api/mcp`) | absent (same default, `${API_PUBLIC_URL}/mcp`) | required on UAT (F8/F11); the connector's own public URL, returned as `resource` in the protected-resource metadata document (`routers/oauth.py`). Meant for a dedicated hostname (e.g. `https://mcp.wealth.auriqltd.co.uk/mcp`) once DNS exists. Production is unaffected until A18 resolves `API_PUBLIC_URL`'s own missing DNS record; see that row. |
| `ALLOWED_EMAILS` | `core/config.py` | present | present | required; comma-separated sign-in allow-list, the seed list checked first by every sign-in. D5: day-to-day invites go through the in-app `allowed_signups` Mongo collection instead (managed from `/ops/go-live`'s Allowlist section, `app/routers/admin_allowlist.py`) — this env var stays for the owner's own account and anything else that needs to work even if Mongo is unreachable, and only changing it still needs an env edit + redeploy. |
| `DEFAULT_TIER` | `core/config.py` | absent (default `max`) | absent (default `max`) | optional; deliberately top-tier pre-launch. |
| `REDIS_URL` | `core/config.py` | present | present | required; queue + cache. |
| `GOOGLE_CLIENT_ID` | `core/config.py` | present | present | required; Google sign-in. |
| `GOOGLE_CLIENT_SECRET` | `core/config.py` | present | present | required; Google sign-in. |
| `APPLE_BUNDLE_ID` | `core/config.py` | absent (default `co.uk.auriqltd.sorted` is correct) | absent (same default) | optional. |
| `APPLE_SERVICES_ID` | `core/config.py` | absent | absent | optional; only needed once the web "Services ID" Apple flow ships. |
| `OPEN_SIGNUP` | `core/config.py` | absent (default `false`) | absent (default `false`) | flag; unset keeps registration allow-list-only, the current intended state everywhere. |
| `MCP_CONNECTOR_ENABLED` | `core/config.py` | present (`true`, UAT testing) | **absent, must stay absent** | flag; A17 doctrine: the `/mcp` connector must ship entirely absent in production until sign-off, so "absent" here is correct and intentional, not drift. |
| `MCP_ONLY` | `core/config.py`, `app/main.py` (`build_app`'s `mcp_only` param) | absent | absent | optional (F10); not read by either of today's two Railway services (`ai-wealth-dashboard`, `worker`) or UAT — it's meant for a THIRD, not-yet-deployed Railway service on a dedicated `mcp` hostname that would run this same image with only the connector (oauth + mcp routers, plus `/health`) mounted, sharing Mongo/Redis with the main services, to isolate assistant traffic once the first Connect customer or visible load arrives. `MCP_ONLY=true` implies `MCP_CONNECTOR_ENABLED=true` (coerced with a startup warning if that var isn't also set there). See DEPLOY.md's "MCP-only service mode". |
| `MCP_AUDIT_TTL_DAYS` | `core/config.py` | absent (default 90 is correct) | absent (default 90 is correct) | optional; how long `/mcp` connector audit rows (`mcp_calls` collection) are kept before the TTL index reaps them. Does not affect the monthly call allowance, which is tracked separately in `mcp_call_counters` and never expires. |
| `SESSION_SECRET` | `core/config.py` | absent (falls back to `backend/.session_secret`, gitignored) | present | optional on UAT (file fallback), present on Railway because there is no persistent filesystem between deploys. |
| `TRUELAYER_CLIENT_ID` | `core/config.py` | present | present | required; bank connect. |
| `TRUELAYER_CLIENT_SECRET` | `core/config.py` | present | present | required; bank connect. |
| `TRUELAYER_WEBHOOK_SECRET` | `core/config.py` | absent (falls back to `backend/.webhook_secret`) | present | optional on UAT (file fallback), present on Railway (no persistent filesystem). |
| `TRUELAYER_REDIRECT_URI` | `core/config.py` | present | present | required; must match the TrueLayer console redirect URI. |
| `VAPID_SUBJECT` | `core/config.py` | absent (default `mailto:admin@wealthdashboard.app`) | absent (same default) | optional; a real contact address is nicer but not required. |
| `VAPID_PRIVATE_KEY` | `core/config.py` | absent (falls back to `backend/.vapid_private_key`) | present | optional on UAT (file fallback), present on Railway (no persistent filesystem). |
| `APNS_KEY_ID` | `core/config.py` | present | present (required, currently absent, see "Known drift" below) | required for iOS push in production. |
| `APNS_TEAM_ID` | `core/config.py` | present | present (required, currently absent, see "Known drift" below) | required for iOS push in production. |
| `APNS_BUNDLE_ID` | `core/config.py` | absent (default `co.uk.auriqltd.sorted` is correct) | absent (same default) | optional. |
| `APNS_USE_SANDBOX` | `core/config.py` | absent (default `false`) | absent (default `false`) | flag; leave unset for the production APNs environment. |
| `APNS_AUTH_KEY_PATH` | `core/config.py` | absent (default file `backend/.apns_auth_key.p8` is used) | absent | optional; only needed to point at a non-default file path. |
| `APNS_AUTH_KEY` | `core/config.py` | absent (UAT uses the `.apns_auth_key.p8` file directly) | present (required, currently absent, see "Known drift" below) | required in production (no persistent filesystem to hold the `.p8` file); set the key contents as this env var, not a path. |
| `FCM_PROJECT_ID` | `core/config.py` | present | present (required, currently absent, see "Known drift" below) | required for Android push in production. |
| `FCM_SERVICE_ACCOUNT_PATH` | `core/config.py` | absent (default file `backend/.fcm_service_account.json` is used) | absent | optional; only needed to point at a non-default file path. |
| `FCM_SERVICE_ACCOUNT_JSON` | `core/config.py` | absent (UAT uses the `.fcm_service_account.json` file directly) | present (required, currently absent, see "Known drift" below) | required in production (no persistent filesystem); set the whole service-account JSON as this env var, not a path. |
| `MONO_SECRET_KEY` | `core/config.py` | present | present | required only for the Kenya (Mono) region; harmless elsewhere. |
| `MONO_PUBLIC_KEY` | `core/config.py` | present | present | required only for the Kenya region. |
| `YAPILY_APP_UUID` | `core/config.py` | present | present | optional; Yapily is dormant, pending removal per the Finexer migration. |
| `YAPILY_SECRET` | `core/config.py` | present | present | optional; see above. |
| `YAPILY_BASE_URL` | `core/config.py` | present | absent (default `https://api.yapily.com` is correct) | optional; UAT pins it explicitly, production relies on the default. |
| `FINEXER_API_KEY` | `core/config.py` | present | present | required; primary bank-connect provider. |
| `FINEXER_RETURN_URL` | `core/config.py` | present | absent (default matches production URL) | optional; UAT pins it explicitly. |
| `FINEXER_WEBHOOK_SECRET` | `core/config.py` | absent (falls back to `backend/.finexer_webhook_secret`) | absent | optional; falls back to a generated per-environment file if unset. Railway has no persistent filesystem, so a fresh secret is generated on every deploy unless set explicitly, worth pinning as an env var to keep the webhook URL stable. |
| `FINEXER_WEBHOOK_SIGNING_SECRET` | `core/config.py` | absent | absent | optional until Finexer's dashboard issues one; empty means "not registered yet", the receiver skips signature verification and logs a warning. |
| `FINEXER_PROVIDERS_TTL_HOURS` | `core/config.py` | absent (default `24`) | absent (default `24`) | optional; H19 — how long `list_providers()`'s Mongo-backed cache of GET /providers is trusted before a consent sync re-walks the full paginated list. |
| `STRIPE_SECRET_KEY` | `core/config.py` | absent | absent | optional; B5 billing, test-mode only today, no Stripe account exists yet (see DEPLOY.md's "Stripe setup checklist"). Never auto-generated, must come from Stripe's dashboard. Combined with `STRIPE_PRICE_IDS` below to derive `BILLING_ENABLED`. |
| `STRIPE_WEBHOOK_SECRET` | `core/config.py` | absent | absent | optional; the signing secret Stripe's dashboard issues once `POST /webhooks/stripe` is registered as an endpoint. Empty means the webhook route rejects every delivery with a 400 (fails closed, same shape as the missing-signature case) rather than skip verification the way `FINEXER_WEBHOOK_SIGNING_SECRET` does, since a Stripe webhook can grant real entitlements. |
| `STRIPE_PRICE_IDS` | `core/config.py` | absent | absent | optional; comma-separated `key=price_id` pairs. Each paid tier needs monthly (`lite`, `standard`, `connect`, `max`) plus `_<six_months\|annual>` recurring prices (three_months dropped 2026-09-12); packs use `penny_small`, `penny_medium`, `penny_large`, `mcp_1000`. Statements is free. `BILLING_ENABLED` only goes true once `STRIPE_SECRET_KEY` and all 16 price keys are present, so partial configuration stays "not live". |
| `RECONCILE_SPREAD_MINUTES` | `core/config.py` | absent (default `210`) | absent (default `210`) | optional; E2 — how many minutes of `task_reconcile_truelayer`'s 4-hourly run the spread is allowed to use. See DEPLOY.md's "Railway Pro and replicas (E2)" section. |
| `RECONCILE_MAX_PER_MINUTE` | `core/config.py` | absent (default `40`) | absent (default `40`) | optional; E2 — the Finexer-safe sync-job ceiling per minute. Raise only once Finexer confirms a higher real rate limit. |
| `RECONCILE_MIN_GAP_SECONDS` | `core/config.py` | absent (default `2`) | absent (default `2`) | optional; E2 — floor on the gap between any two spread-out reconcile jobs. |
| `SENTRY_DSN` | `main.py` | absent | absent | optional; error monitoring not yet wired up in either environment. |
| `SENTRY_ENV` | `main.py` | absent (default `vps`) | absent | optional; only read when `SENTRY_DSN` is set. |
| `ENABLE_API_DOCS` | `main.py`, `routers/truelayer.py` | absent | absent, must stay absent | flag; exposes `/docs`. Keep unset in production. |
| `DEV_MODE` | `main.py` | absent | absent, must stay absent | flag; dev-only behaviour. Keep unset in production. |
| `TOKEN_ENCRYPTION_KEY` | `core/crypto.py` | absent (falls back to `backend/.token_key`) | present | optional on UAT (file fallback), present on Railway (no persistent filesystem), encrypts stored bank tokens at rest. |
| `REPO_ROOT` | `routers/ops.py` | absent (defaults to this repo) | absent | optional; test/override only, not meant to be set in either real environment. |
| `BACKLOG_ROOT` | `services/backlog.py` | absent (defaults to `/root/ai-wealth-dashboard`) | absent | optional; test override only, never meant to be set outside pytest. |

### Bot/service credentials (A28, replaces `BOT_SECRET`)

Not an environment variable at all, so it doesn't appear in the table
above or get tracked by `scripts/env_drift.py`. A28 (2026-09-14) replaced
the single static `BOT_SECRET` — one shared string, no expiry, no
scoping, and (the actual defect) `core/auth.py` resolved it to Kevin's
own identity, `{"email": "kevin.maingi12@gmail.com", ...}`, so the same
string could read or write anything Kevin's own session could — with
named, scoped, individually revocable credentials stored in Mongo
(`bot_credentials` collection, see `app.core.bot_credentials`'s module
docstring for the full design).

A resolved bot credential principal is `{"name": "Bot", "email": None,
"bot_name": <name>, "scopes": {...}}` — `email` is always `None`, never a
real address, which is what stops a credential impersonating a real user:
almost every route in this app scopes its Mongo reads/writes to
`user["email"]`, and a bot credential simply cannot supply one. A bot
credential can only ever reach the small, explicit list of routes in
`app.core.bot_credentials.ROUTE_SCOPES` (today: `POST /admin/sync-all`,
`GET /admin/llm-usage`, `GET /admin/sync-stats`,
`POST /admin/finexer/providers/refresh`,
`PATCH /subscription/admin/set-tier`, `POST /subscription/admin/topup`,
`/admin/broadcast*`, `/admin/allowlist*`), each gated by one of the
scopes in `app.core.bot_credentials.SCOPES`; every other route (including
`POST /admin/fix-card-transactions`, which acts on "the caller's own
account", and `GET /mcp` / `GET /mcp/audit`, which used to be reachable
with `BOT_SECRET` and read Kevin's own MCP data) closes the door on a bot
credential entirely, however broad its scopes.

**Rotation** (no redeploy, no env var, no restart):

```bash
# mint (prints the raw token exactly once, never stored anywhere)
backend/.venv/bin/python scripts_bot_credential.py create --name usage-dashboard --scopes admin:usage
# hand the new token to whatever was calling the old one, then:
backend/.venv/bin/python scripts_bot_credential.py revoke --name usage-dashboard-old
# list every credential (name/scopes/timestamps, never the token itself)
backend/.venv/bin/python scripts_bot_credential.py list
```

Every lookup is a live Mongo read (`bot_credentials_col.find_one`, keyed
by the SHA-256 hash of the token, same doctrine as `oauth_tokens_col`), so
a `create` or `revoke` takes effect on the very next request — there is
nothing cached, nothing to restart.

**Break-glass for Kevin**: every bot-eligible route also accepts Kevin's
own real session (the normal Google/Apple sign-in flow everything else in
this app already uses, itsdangerous-signed, expiring, never a static
secret) as a fallback if every bot credential were ever revoked or the
credential store were unreachable — see `admin.py`'s `admin_sync_all`,
`subscription.py`'s `admin_set_tier`/`admin_topup`, and the existing
bot-or-owner gates in `admin_usage.py`/`broadcast.py`/`admin_allowlist.py`.
This is not "the old secret under a new name": it requires a real,
already-authenticated owner login, it only ever resolves to Kevin's own
identity (never a bot masquerading as him), and it's the exact same
break-glass every other owner-only surface in this app (`/ops/go-live`)
already relies on — nothing new was added to make this possible, A28 just
made sure it stayed available on the two routes (`admin_sync_all`,
`subscription` admin) that had previously been bot-only with no owner
fallback at all.

### Present but not read by `backend/app` (legacy / standalone scripts)

These names show up in `backend/.env` and/or Railway today but are not
read anywhere under `backend/app`, they belong to standalone collector
scripts run outside the API process, or are orphaned. Listed here so
`env_drift.py` has a complete manifest and doesn't flag them as unknown
forever.

| Variable | Read in | UAT (VPS backend/.env) | Production (Railway, both services) | Notes |
|---|---|---|---|---|
| `FUEL_FINDER_CLIENT_ID` | `backend/fuel_finder_collector.py`, `backend/spike_fuel_finder*.py` | present | present | optional; standalone fuel-price collector script, not part of the API process. |
| `FUEL_FINDER_CLIENT_SECRET` | same as above | present | present | optional; see above. |
| `MONGO_DB` | not read anywhere under `backend/` (`backend/tests/conftest.py` notes there is no such env var, the database name is hardcoded to `"wealth"`) | present | absent | vestigial; safe to remove from `backend/.env`, harmless if left. |
| `TOKEN_KEY` | not read anywhere under `backend/` (the real name is `TOKEN_ENCRYPTION_KEY`, see above) | absent | present | orphaned; likely a naming slip when `TOKEN_ENCRYPTION_KEY` was first set on Railway. Safe to remove once confirmed `TOKEN_ENCRYPTION_KEY` is the one actually in use (it is: `core/crypto.py` only ever reads `TOKEN_ENCRYPTION_KEY`). |

## Frontend

| Variable | Read in | UAT (frontend/.env.local, build-time) | Production (Vercel) | Notes |
|---|---|---|---|---|
| `BACKEND_URL` | `next.config.ts` (API rewrite target), `app/auth/*/callback/route.ts` | absent (defaults to `http://localhost:8000`, correct on this VPS) | present | required on Vercel: serverless functions can't reach `localhost`; optional on UAT because the default is already correct. |
| `NEXT_PUBLIC_API_URL` | `lib/api.ts` | absent (defaults to `/api`, proxied by the rewrite) | absent (same default) | optional; leave unset everywhere. |
| `NEXT_PUBLIC_BUILD_TAG` | `lib/buildTag.ts`, `next.config.ts` | absent (computed automatically from git SHA) | absent (computed from `VERCEL_GIT_COMMIT_SHA`) | optional; only set to override the computed build tag. |
| `NEXT_PUBLIC_TRUELAYER_PICKER` | `lib/featureFlags.ts` | present (`on`) | absent | flag; UAT keeps the legacy TrueLayer picker reachable for testing, production hides it (Finexer-only). |
| `NEXT_PUBLIC_MCP_CONNECTOR` | `lib/featureFlags.ts` | present (`on`) | **absent, must stay absent** | flag; A17 doctrine: the MCP connector UI must stay off in production until sign-off. UAT having it on is expected and fine. Mobile builds (Codemagic, local Android APK) don't read `frontend/.env.local` at all, `frontend/scripts/build-mobile.sh` sets this itself per `MOBILE_TARGET`/`MOBILE_API_BASE` (same UAT-on/prod-off split), and `codemagic.yaml`'s `ios-capacitor` workflow sets it explicitly too, `ios-capacitor-prod` never does (F17, 2026-09-10; before that the flag could never reach a mobile bundle at all). |
| `NEXT_PUBLIC_MCP_URL` | `lib/featureFlags.ts` | absent today (default `https://api.wealth.auriqltd.co.uk/mcp`); should be set to `https://uat.wealth.auriqltd.co.uk/api/mcp` alongside `NEXT_PUBLIC_MCP_CONNECTOR=on` | absent (same default) | optional (F8); the connect-instructions URL shown in Settings' "Connected assistants" empty state, mirrors the backend's `MCP_PUBLIC_URL`. Same mobile-build story as `NEXT_PUBLIC_MCP_CONNECTOR` above: `build-mobile.sh` and the `ios-capacitor` Codemagic workflow set it to `https://uat.wealth.auriqltd.co.uk/api/mcp` for UAT mobile targets, unset (falls back to the prod default, harmless since the connector is off) for prod (F17). |
| `NEXT_PUBLIC_WEB_PRODUCT` | `lib/webProduct.ts` | absent | absent today; DEPLOY.md says set `off` on Vercel production once the app-download gate is wanted | optional; not currently set anywhere. |
| `NEXT_PUBLIC_APP_STORE_URL` | `lib/webProduct.ts` | absent | absent | optional; unset until the App Store listing exists. |
| `NEXT_PUBLIC_PLAY_STORE_URL` | `lib/webProduct.ts` | absent | absent | optional; unset until the Play Store listing exists. |

Vercel carries only `BACKEND_URL` in both Production and Preview today
(confirmed 2026-09-08 via `vercel env ls production` / `vercel env ls
preview`, project `kev0h1s-projects/ai-wealth-dashboard`), every
`NEXT_PUBLIC_*` flag above is unset there, which is the intended state for
all of them right now.

## Release tooling (`scripts/release.py` only, not tracked by `env_drift.py`)

These two names live only in the shell environment of whatever runs
`scripts/release.py deploy` from the shared tree (this VPS, operator shell);
they are not part of `backend/.env`, `frontend/.env.local`, a Railway
service, or the Vercel project, so `env_drift.py` (which only diffs those
four places) does not know about them and never will. Listed here anyway so
the manifest has a complete picture of everything `deploy` reads.

| Variable | Read in | Present today | Notes |
|---|---|---|---|
| `CODEMAGIC_API_TOKEN` | `scripts/release.py` (`_codemagic_trigger_prod_build` / equivalent helper) | absent | optional; a Codemagic personal API token. When set together with `CODEMAGIC_APP_ID`, `deploy` POSTs to `https://api.codemagic.io/builds` after tagging a successful release to start the `ios-capacitor-prod` workflow on `release` (see DEPLOY.md's "Release trigger"). Missing it just means `deploy` warns and skips the trigger, it never fails the deploy. Never printed or logged by `release.py`. |
| `CODEMAGIC_APP_ID` | `scripts/release.py` | absent | optional; the Codemagic application id for this repo (Codemagic UI: App settings -> General -> App ID), paired with `CODEMAGIC_API_TOKEN` above. |

## Edge and transport hardening (A27, 2026-09-14)

Not an environment variable either — recorded here for the same reason as
the A28 section above (this file is where operational decisions like this
get written down). Closes three gaps found by probing both live hosts on
2026-09-14: production sent only `Strict-Transport-Security` (no
`includeSubDomains`/`preload`, no CSP, no frame protection, no
`X-Content-Type-Options`, no `Referrer-Policy`, no `Permissions-Policy`);
the Railway API sent no security headers at all; and `core/ratelimit.py`'s
`RULES` covered only seven auth/webhook/push prefixes, so every data
endpoint was unlimited (masked only by `ALLOWED_EMAILS` keeping sign-up
closed to ten addresses — a protection D1 will remove).

**Frontend headers** (`frontend/next.config.ts`'s `securityHeaders()`,
production builds only): HSTS with `includeSubDomains; preload`,
`X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`,
`Referrer-Policy: strict-origin-when-cross-origin`, a `Permissions-Policy`
that locks down every browser feature this app doesn't use, and a CSP.
**The CSP's `script-src` and `style-src` both need `'unsafe-inline'`** —
verified against a real build in headless Chrome, console inspected
2026-09-14. `style-src` needs it because this app sets React
`style={{...}}` on 150+ components (renders as inline `style="..."`
attributes, no practical hash/nonce mechanism for that). `script-src` needs
it because Next.js's own App Router injects `self.__next_f.push(...)`
React Server Components flight-data scripts inline on every page, with
content that differs per page/build — a hash allow-list can't cover that,
and the nonce-based fix (`middleware.ts` + `headers()` read in
`app/layout.tsx`) would force this app's ~80 currently-statically-generated
routes into per-request dynamic rendering (layout.tsx wraps every route),
which is a real performance regression this item judged not worth paying
for a header that's defence in depth, not the only thing between an
attacker and a script tag. If that tradeoff is ever revisited, the nonce
pattern is documented at
https://nextjs.org/docs/app/guides/content-security-policy. Every other CSP
directive is `'self'`-only (no external script/style/image/font/connect
targets — bank logos, API calls and everything else this app loads are
same-origin). `output: 'export'` (Capacitor/MOBILE_EXPORT) doesn't support
`headers()` at all, so the mobile shells carry whatever headers wrap the
static bundle, not these.

**Backend headers** (`backend/app/core/security_headers.py`, registered as
the OUTERMOST middleware in `app.main.build_app` — every response this
process sends carries these, including a 401 from `auth_middleware` and a
429 from the rate limiter): the same HSTS/nosniff/DENY/Referrer-Policy/
Permissions-Policy as the frontend, plus a CSP of
`default-src 'none'; frame-ancestors 'none'; base-uri 'none'` — the
strictest possible shape, since this API only ever serves JSON (to the
Next.js `/api` rewrite or the MCP connector), never HTML for a browser to
render. CSP is skipped specifically for `/docs`/`/redoc`/`/openapi.json`
(Swagger UI, `ENABLE_API_DOCS`-gated, must stay unset in production) so it
doesn't break if that flag is ever turned on locally.

**Catch-all rate limit** (`app.core.ratelimit`
`CATCH_ALL_IP_LIMIT`/`CATCH_ALL_USER_LIMIT`/`EXPENSIVE_PREFIXES`, wired into
`app.core.auth.auth_middleware`): every request reaching a protected route
not already covered by a `RULES` entry is now bounded two ways on the same
request — 600/60s keyed by IP (checked before the bearer token is even
validated, so a caller spamming garbage tokens is bounded too, not just one
who resolves to a real identity), and 300/60s keyed by the resolved
identity (a real user's email, or a bot credential's name — A28) once the
token validates, tighter to 30/60s for a named set of expensive endpoints
(`/transactions/search`, `/safe-to-spend`, `/cashflow`, `/spend/verdict`,
`/money-shape`, `/savings-insights`). Chosen against a real reading of a
Home screen load (`app/components/HomePage.tsx` alone issues 6 requests on
mount, plus its child components and the idle `/spend` prefetch — on the
order of 10-15 total): the general limit leaves roughly 20x that headroom
for a few reloads inside a minute, the expensive-endpoint limit still
covers several page loads. `/mcp` is deliberately excluded — F7 already
gave the MCP connector its own per-principal burst/daily limits, keyed by
OAuth `client_id`/`uid`, tuned for that surface; stacking an uncoordinated
second limit on the same traffic would just be confusing.

**Redis-unavailable fallback, chosen direction: degrade, not fail open or
fail closed.** When Redis is unreachable, every rule in `ratelimit.py`
(the pre-existing auth/webhook rules and this catch-all alike) falls back
to an in-process deque — this was already true before A27, and A27
deliberately keeps it rather than changing direction. Concretely: a rate
limit check NEVER raises (a Redis exception is caught and treated as "use
the local path"), and the local path still enforces the SAME limit, just
per-process rather than shared. On today's single Railway replica that is
exactly as safe as the Redis path; once E5 adds replicas, a Redis outage
would let the effective limit become (per-replica limit × replica count)
for as long as it lasts — looser than intended, but never unenforced, and
never a hard failure. The alternative (fail closed: reject every request
while Redis is down) was rejected for a financial app specifically because
this rate limiter is defence in depth behind real authentication and
authorisation, not the primary access control — turning a transient Redis
blip into a total outage for every real user trying to see their own bank
data is a worse failure mode than a temporarily looser abuse bound.

**Explicitly NOT done here, Kevin's own decisions**: Vercel Firewall rule
configuration, and whether Cloudflare goes in front of the Railway API.
Both are infrastructure/vendor decisions outside this item's scope; see the
A27 backlog note.

## Known drift (2026-09-08)

- **`FCM_PROJECT_ID`, `APNS_KEY_ID`, `APNS_TEAM_ID`, `APNS_AUTH_KEY`**:
  present on UAT (the APNs key is the `.p8` file on this VPS, not an env
  var), absent on Railway. Railway has no persistent filesystem, so the
  file-based fallback that works on UAT does nothing in production: set
  `APNS_AUTH_KEY` (the `.p8` file's contents, not a path) alongside
  `APNS_KEY_ID` and `APNS_TEAM_ID` on both Railway services.
- **`FCM_SERVICE_ACCOUNT_JSON`** same shape as above: UAT uses the
  `.fcm_service_account.json` file, production needs the whole JSON body
  set as this env var (`FCM_PROJECT_ID` is already present on UAT but
  still needs setting on Railway too).
- **`BOT_SECRET`**: retired 2026-09-14 (A28). It is no longer read anywhere
  in `backend/app` — see "Bot/service credentials" below for its
  replacement. If it is still set in `backend/.env` or on either Railway
  service, that is harmless (nothing reads it) but should be cleared out
  next time either is touched, so it doesn't get mistaken for something
  live.
- Net effect of the first two points above: **production push
  notifications are unconfigured** (`APNS_CONFIGURED` / `FCM_CONFIGURED`
  both evaluate false with these unset). Not a regression, production has
  simply never had these set, but it blocks real push delivery once
  traffic moves off UAT.
- **`MCP_CONNECTOR_ENABLED`** (Railway) and **`NEXT_PUBLIC_MCP_CONNECTOR`**
  (Vercel) being absent is *intentional*, not drift, see A17 in the
  backlog. Do not "fix" this by setting them.
- **`STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_IDS`** being
  absent everywhere is also *intentional*, not drift, B5 (2026-09-09): no
  Stripe account exists yet. `BILLING_ENABLED` correctly evaluates false
  with these unset, and GET /subscription's `billing_live` follows it, so
  the frontend keeps showing "Available soon". See DEPLOY.md's "Stripe
  setup checklist" for what to do once the account exists.
- **`TOKEN_KEY`** (Railway only) and **`MONGO_DB`** (UAT only) are
  orphaned names nothing in `backend/app` reads; see the legacy-scripts
  table above.
- Vercel was previously unverifiable from this VPS because the CLI
  wasn't linked; it now is (`vercel link --yes --project
  ai-wealth-dashboard` from a scratch directory, never `frontend/`), and
  confirms Vercel production/preview carry only `BACKEND_URL`.
