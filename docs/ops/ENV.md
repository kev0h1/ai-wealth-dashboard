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
| `BOT_SECRET` | `core/config.py` | present | present (required, currently absent, see "Known drift" below) | required in production for the admin/MCP-audit bot routes to be callable. Use a different value from UAT's (`sync-vars --generate BOT_SECRET`), never copy UAT's. |
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
- **`BOT_SECRET`**: present on UAT, absent on Railway.
- Net effect of the four points above: **production push notifications
  are unconfigured** (`APNS_CONFIGURED` / `FCM_CONFIGURED` both evaluate
  false with these unset) and **admin/MCP-audit bot routes are
  uncallable in production** until `BOT_SECRET` is set there. Neither is
  a regression, production has simply never had these set, but they
  block real push delivery and bot-driven audits once traffic moves off
  UAT.
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

## Secret rotation (A26)

Names only below, as everywhere else in this file — never a value.

**Mechanics common to every row in the table:** a secret lives in up to
three places (UAT's `backend/.env`/`frontend/.env.local` on this VPS, the
two Railway services, the Vercel project); rotating it means generating a
new value, writing it to every place that variable is `present` per the
tables above, and restarting/redeploying so the new value is actually
picked up: `systemctl restart wealth-api`/`wealth-worker`/`wealth-frontend`
on the VPS (per CLAUDE.md, only after the corresponding code change, but a
plain env-value rotation with no code change still needs the restart to
pick up the new value), `railway variables set --service <name> KEY=...`
(or the Railway dashboard) followed by a redeploy of that service, and
`vercel env rm`/`vercel env add` (or the dashboard) followed by a Vercel
redeploy. **Who can do it, for every row below:** today, only Kevin — he is
the sole operator with VPS root, Railway project, Vercel project and every
third-party dashboard access; there is no delegated ops role yet, and
`BOT_SECRET`'s replacement (A28) doesn't change who administers secrets,
only how the bot-route credential itself works.

| Variable | How to rotate | What breaks while rotating |
|---|---|---|
| `MONGO_URI` | Atlas dashboard: create a new database user (or rotate the existing user's password), update the connection string everywhere it's `present`, then remove the old user once every place is confirmed on the new one. | Every DB-touching request fails until every process (API, worker) has the new URI and has restarted; do not remove the old Atlas user until all processes are confirmed rotated, or you can lock yourself out mid-rotation. |
| `OPENROUTER_API_KEY` | OpenRouter dashboard: generate a new key, update everywhere, revoke the old key once confirmed. | Penny chat, categorisation, savings insights and every other LLM call fail (each has its own try/except, so this degrades those features rather than crashing the whole app, but it's a real feature outage while unrotated). |
| `TAVILY_API_KEY` | Tavily dashboard: generate a new key, update, revoke old. | Savings-insight web lookups fail; the rest of the app is unaffected. |
| `LOGODEV_TOKEN` | Logo.dev dashboard: generate a new token, update, revoke old. | Merchant logos silently degrade to initials (this is the documented no-token fallback, so a rotation gap here is low-severity by design). |
| `REDIS_URL` | Provisioned by Railway for both services (and points at whatever Redis the VPS runs for UAT); rotating means recreating/repointing the Redis instance and updating this URI everywhere. | Rate limiting falls back to the in-process, per-replica approximation (A27's territory); the OAuth pending-request store and any other Redis-backed cache fall back to their own in-process equivalents; background job queueing (arq) has no in-process fallback and stops working entirely until every worker has the new URL. |
| `BOT_SECRET` | Today: generate a new random value, update `backend/.env` (UAT) and both Railway services, restart. A28 is replacing this whole credential with scoped, rotatable, individually revocable ones — once that lands, rotation is per-credential (revoke one, issue another) rather than this single shared value. | Every call authenticating as the bot (admin/MCP-audit routes) fails until rotated everywhere it's used; nothing else. |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Google Cloud Console (the OAuth 2.0 client under this project): rotate the client secret (the client ID itself rarely needs to change), update everywhere. | New Google sign-ins fail until rotated; existing signed-in sessions are unaffected (this is only used at the sign-in exchange, not on every request). |
| `SESSION_SECRET` | Generate a new random value (`sync-vars --generate SESSION_SECRET` or equivalent), update. On UAT this falls back to `backend/.session_secret` (a gitignored file) if the env var is unset — rotating there means regenerating that file instead. | **Every existing session token everywhere becomes invalid the instant this changes** (session tokens are signed with this key) — every signed-in user, on every surface (web, both Capacitor shells), is logged out and must sign in again. There is no graceful dual-key rotation window today; treat this as a "everyone gets logged out" event, not a silent rotation. |
| `TRUELAYER_CLIENT_ID` / `TRUELAYER_CLIENT_SECRET` | TrueLayer console: rotate the client secret, update everywhere, and confirm the redirect URI registration still matches `TRUELAYER_REDIRECT_URI`. | New bank connections via TrueLayer fail (invalid_client) until rotated; existing connections' stored, encrypted access/refresh tokens are unaffected (they were issued under the old credential but TrueLayer doesn't invalidate already-issued user tokens when the *app's own* client secret rotates). |
| `TRUELAYER_WEBHOOK_SECRET` | Generate a new random value, update the URL-embedded secret in TrueLayer's webhook configuration (console) and here at the same time — they must change together, since the value IS the URL path segment. On UAT this falls back to `backend/.webhook_secret` if unset. | TrueLayer webhook deliveries 401 and are dropped until both sides (TrueLayer's console and our env var) agree on the new value; syncs still happen on the next scheduled reconcile job, so this degrades freshness, it doesn't lose data. |
| `VAPID_PRIVATE_KEY` | Generate a fresh VAPID keypair (`py_vapid` or any standard tool), update. On UAT this falls back to `backend/.vapid_private_key` if unset. | Every existing web-push subscription becomes invalid (VAPID keys are what browsers use to verify the push sender) — users need to be re-subscribed; there is no seamless rotation for web push, this is an expected one-time break. |
| `APNS_KEY_ID` / `APNS_TEAM_ID` / `APNS_AUTH_KEY` (the `.p8` key, held as a file on UAT and as this env var's contents on Railway) | Apple Developer portal: revoke the old key, create a new APNs Auth Key, update `APNS_KEY_ID` and the key contents everywhere (`backend/.apns_auth_key.p8` on UAT, `APNS_AUTH_KEY` on Railway). `APNS_TEAM_ID` itself never needs rotating (it's the Apple team id, not a secret). | iOS push notifications fail until rotated; nothing else. |
| `FCM_SERVICE_ACCOUNT_JSON` (and the file-fallback `.fcm_service_account.json` on UAT) | Firebase console: create a new service account key for the project, update everywhere, then revoke the old key. | Android push notifications fail until rotated; nothing else. |
| `MONO_SECRET_KEY` / `MONO_PUBLIC_KEY` | Mono dashboard: rotate the API key pair, update everywhere. | New Kenya-region bank connections and syncs fail (Mono calls use this key on every request, unlike TrueLayer/Finexer's per-user consent model); harmless everywhere else since Mono is region-scoped. |
| `YAPILY_APP_UUID` / `YAPILY_SECRET` | Yapily dashboard: rotate, update. Yapily is dormant pending removal (Finexer migration) — a live gap found during this pass (see `docs/security/pentest-scope-2026-09.md` and the A26 completion report) is that Yapily consent tokens are stored in plaintext (`yapily_accounts_col.consent`), unlike TrueLayer's Fernet-encrypted tokens; there are currently zero live rows in that collection on UAT, but this is worth resolving before Yapily is fully retired rather than after. | New Yapily connections/syncs fail until rotated; Finexer (the primary provider) is unaffected. |
| `FINEXER_API_KEY` | Finexer dashboard: rotate, update. | Every Finexer call fails — new consents, syncs, and webhook-triggered resyncs all stop working until rotated. This is the primary bank-connect provider, so this is a full open-banking outage while unrotated. |
| `FINEXER_WEBHOOK_SECRET` (falls back to a generated `backend/.finexer_webhook_secret` file if unset) | Same shape as `TRUELAYER_WEBHOOK_SECRET`: generate a new value, update it in Finexer's webhook URL configuration and here together. | Finexer webhook deliveries 401 and are dropped until both sides agree; Finexer retries and eventually pauses the webhook after 10 consecutive non-2xx responses (per `routers/webhooks.py`'s own docstring), so a slow rotation risks the webhook being disabled Finexer-side, needing manual re-registration. |
| `FINEXER_WEBHOOK_SIGNING_SECRET` | Finexer dashboard issues this once the webhook endpoint is registered; rotate by regenerating it there and updating here. Currently unset everywhere (Finexer hasn't issued one yet), which means signature verification is skipped with a logged warning — see the "what no log line or error response can carry" findings in the A26 completion report for why this specific gap is already flagged. | While unset: no signature check at all on Finexer webhooks (only the URL secret above gates them). While mid-rotation with a mismatched value on either side: every delivery 401s the same way as the URL-secret case above. |
| `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` | Stripe dashboard: roll the secret key, and re-register/re-fetch the webhook signing secret if the webhook endpoint itself is ever recreated. Not yet set anywhere (no live Stripe account), so this is forward-looking. | Once billing is live: `STRIPE_SECRET_KEY` rotation breaks checkout/portal session creation; `STRIPE_WEBHOOK_SECRET` rotation makes every webhook delivery fail closed (400, per `services/billing.py`'s own doctrine that a Stripe webhook can grant real entitlements, so it never skips verification the way the Finexer signing secret does pre-registration). |
| `SENTRY_DSN` | Sentry project settings: regenerate the DSN if it's ever suspected leaked (a DSN isn't a high-value secret — it can only be used to submit fake error events, not read data — but Sentry supports rotating it). Not currently set in either environment. | Error monitoring stops receiving events; no user-facing impact. |
| `TOKEN_ENCRYPTION_KEY` (falls back to `backend/.token_key` on UAT) | **This is the highest-severity row in this table.** There is no re-encryption migration path today: `core/crypto.py` decrypts with whichever single key is currently configured, so replacing the key without first decrypting-and-re-encrypting every stored token under the new key makes every existing bank connection's stored token undecryptable (`decrypt_token` returns `None` on an `InvalidToken` error, i.e. "unusable," not a crash). Proper rotation therefore needs a one-time migration script (decrypt all under the old key, re-encrypt under the new key, in one pass, before removing the old key from every environment) — no such script exists yet. Losing the key entirely (not rotating, just losing it) is explicitly called out in `core/crypto.py`'s own docstring as "users must reconnect their banks; nothing else is lost." | Without a migration: every user with a connected bank has to disconnect and reconnect it. With a proper migration script (not yet built): ideally nothing, if the migration completes before any process restarts onto the new key. |
| `CODEMAGIC_API_TOKEN` / `CODEMAGIC_APP_ID` | Codemagic account settings: regenerate the personal API token, update the shared tree's operator shell environment (not part of any `.env` file, see the table above). | `scripts/release.py deploy`'s post-release TestFlight trigger silently skips (logs a warning, never fails the deploy) until rotated; start `ios-capacitor-prod` by hand meanwhile. |
| `FUEL_FINDER_CLIENT_ID` / `FUEL_FINDER_CLIENT_SECRET` | Fuel Finder open data portal: rotate, update `backend/.env` (these aren't read by the API process, only by the standalone collector scripts). | The standalone fuel-price collector scripts fail; no impact on the API, worker, or any user-facing feature. |

**Not secrets, no rotation procedure needed:** every other name in the
tables above is either a non-sensitive config value (`APP_URL`,
`API_PUBLIC_URL`, `MCP_PUBLIC_URL`, `ALLOWED_EMAILS`, `DEFAULT_TIER`,
`APPLE_BUNDLE_ID`, `APPLE_SERVICES_ID`, `YAPILY_BASE_URL`,
`FINEXER_RETURN_URL`, `FINEXER_PROVIDERS_TTL_HOURS`,
`RECONCILE_SPREAD_MINUTES`, `RECONCILE_MAX_PER_MINUTE`,
`RECONCILE_MIN_GAP_SECONDS`, `SENTRY_ENV`, `APNS_BUNDLE_ID`,
`APNS_AUTH_KEY_PATH`, `APNS_USE_SANDBOX`, `FCM_PROJECT_ID`,
`FCM_SERVICE_ACCOUNT_PATH`, `VAPID_SUBJECT`, `REPO_ROOT`, `BACKLOG_ROOT`,
`STRIPE_PRICE_IDS`), a boolean/flag switching behaviour on or off rather
than authenticating anything (`OPEN_SIGNUP`, `MCP_CONNECTOR_ENABLED`,
`MCP_ONLY`, `ENABLE_API_DOCS`, `DEV_MODE`, and every `NEXT_PUBLIC_*` flag —
these ship to the browser by definition, so they were never secret), or
already documented above as orphaned/vestigial (`MONGO_DB`, the stray
`TOKEN_KEY` name on Railway). `BACKEND_URL` and `NEXT_PUBLIC_API_URL` are
routing configuration, not credentials, changing them is a redeploy, not a
rotation.
