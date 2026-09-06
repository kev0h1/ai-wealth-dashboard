# Deployment runbook — Vercel (frontend) + Railway (backend) + Atlas M0

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

---

## ⚠️ The one that will ruin your day — read first

`TOKEN_KEY` is the Fernet key that **encrypts every stored bank token**. The
migrated data contains those tokens as encrypted blobs. They decrypt at runtime
**only if the Railway backend's `TOKEN_KEY` env var equals the current key**.

If `TOKEN_KEY` is wrong/absent, the backend regenerates a new one and **every
bank connection becomes permanently undecryptable** — every user must reconnect
every bank. The same "regenerates on each deploy" trap applies to
`SESSION_SECRET`, `TRUELAYER_WEBHOOK_SECRET`, and `VAPID_PRIVATE_KEY`.

**Set all four from the current values before the first deploy.**

Retrieve the current values from this server (copy each directly into Railway —
do not paste them into chat/tickets):

```bash
cat backend/.token_key            # → TOKEN_KEY
cat backend/.session_secret       # → SESSION_SECRET
cat backend/.webhook_secret       # → TRUELAYER_WEBHOOK_SECRET
cat backend/.vapid_private_key     # → VAPID_PRIVATE_KEY (PEM; see note in env table)
grep -v '^#' backend/.env          # → all the API keys / client secrets below
```

---

## Step 1 — Atlas M0

1. In the M0 cluster: **Network Access** → allow `0.0.0.0/0` (Railway egress IPs
   aren't static on the hobby plan) — M0 access is still gated by the DB user
   credentials, so this is acceptable for M0.
2. **Database Access** → create a user with read/write on the `wealth` DB.
3. Copy the `mongodb+srv://…` connection string → this is `MONGO_URI`.

## Step 2 — Migrate the data

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

## Step 3 — Railway: Redis

Add the **Redis** plugin to the project. Railway exposes it as a reference
variable (e.g. `${{Redis.REDIS_URL}}`) — use that for `REDIS_URL` on both
services below.

## Step 4 — Railway: web service

- **New service** → deploy from this GitHub repo.
- **Root directory:** `backend`  · **Builder:** Dockerfile (auto-detected).
- Railway sets `$PORT`; the Dockerfile already binds it. Health check path: `/health`.
- Set the env vars from the **Backend env vars** table below.

## Step 5 — Railway: worker service

- **New service** → same repo, **root directory `backend`**, same Dockerfile.
- **Override the start command:**
  `arq app.workers.sync_worker.WorkerSettings`
- Give it the **same env vars** as the web service (it needs Mongo, Redis,
  TOKEN_KEY, TrueLayer creds, OpenRouter, etc.). No `$PORT` needed.
- The 4-hourly reconcile and daily digest are in-process arq crons — the worker
  just needs to stay running. No external scheduler.

## Step 6 — Vercel: frontend

- Import the repo, **root directory `frontend`**.
- Env var: `BACKEND_URL` = the Railway **web** service public URL
  (e.g. `https://wealth-web-production.up.railway.app`). The `/api/*` rewrite
  proxies to it, so the app stays same-origin (no CORS, cookie-ready).
- Deploy → note the Vercel URL (or attach your domain). This URL is `APP_URL`.

## Step 7 — Point APP_URL + OAuth/webhook back

1. Set `APP_URL` on **both** Railway services to the Vercel URL, then redeploy them.
2. **Google Cloud Console** → OAuth client → Authorized redirect URIs → add
   `https://<APP_URL>/api/auth/google/callback` and
   `https://<APP_URL>/api/auth/google/mobile-callback`.
3. **TrueLayer console** → redirect URIs → add
   `https://<APP_URL>/api/auth/truelayer/callback` (this is also
   `TRUELAYER_REDIRECT_URI`). Webhook URI is
   `https://<APP_URL>/api/webhooks/truelayer/<TRUELAYER_WEBHOOK_SECRET>`.

## Step 8 — Backups (Cloudflare R2)

- Create an R2 bucket + an API token (Access Key ID / Secret).
- Add these **repo secrets** (Settings → Secrets → Actions):
  `BACKUP_MONGO_URI` (the M0 SRV string), `R2_ACCESS_KEY_ID`,
  `R2_SECRET_ACCESS_KEY`, `R2_ENDPOINT`
  (`https://<account>.r2.cloudflarestorage.com`), `R2_BUCKET`.
- `.github/workflows/backup.yml` runs nightly (03:00 UTC) and on demand
  (Actions → run workflow). It dumps M0 → R2 and prunes >30-day-old archives.

## Step 9 — Verify

```bash
curl -s https://<railway-web-url>/health          # {"status":"ok",...}
curl -s https://<APP_URL>/api/health              # same, via the Vercel proxy
```

Then in the app: sign in with Google, open a bank account detail (confirms the
migrated **encrypted tokens decrypt** — the TOKEN_KEY proof), trigger a sync
(confirms the worker + Redis), and check the worker logs show the reconcile cron.

---

## Backend env vars (Railway — web AND worker)

| Var | Source | Notes |
|-----|--------|-------|
| `MONGO_URI` | Atlas M0 SRV string | Step 1 |
| `REDIS_URL` | Railway Redis reference | `${{Redis.REDIS_URL}}` |
| `TOKEN_KEY` | `cat backend/.token_key` | 🔴 must match — see top |
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
| `ALLOWED_EMAILS` | from `backend/.env` | comma-separated allowlist |
| `OPEN_SIGNUP` | unset (defaults false) | see "Sign-up mode" below |
| `FUEL_FINDER_CLIENT_ID` / `_SECRET` | from `backend/.env` | fuel prices |
| `MONO_*`, `YAPILY_*` | from `backend/.env` | only if using the Kenya region |
| `SENTRY_DSN` | optional | error monitoring |
| `API_PUBLIC_URL` | optional, defaults to `https://api.wealth.auriqltd.co.uk` | the API's own domain, reached directly by Capacitor mobile builds (`build:mobile:prod`); added to CORS alongside `APP_URL` |

**Do NOT set** `PORT` (Railway injects it). Do not set the secret *file* paths —
env vars take precedence and the files are excluded from the image.

### Sign-up mode

`OPEN_SIGNUP` controls whether new accounts can be created at all. Default
`false` (unset) keeps registration restricted to `ALLOWED_EMAILS` — unchanged
behaviour, the safe default until public launch. Set `true` to let any
verified Google or Apple identity create an account. Either way, sign-in
resolves through one identity path (`app/core/identity.py`): a verified
email's first-seen spelling is remembered (Gmail dot-insensitive) so later
sign-ins with a different dot spelling land on the same account, and an
Apple Hide My Email relay sign-in auto-links to the account it created so a
later explicit link (Settings → linked identities) can claim/re-point it.
New accounts and auto-links created this way are recorded as alias/link
documents in the `linked_identities` Mongo collection, same collection
Phase 1's explicit Apple linking already used.

## Frontend env vars (Vercel)

| Var | Value |
|-----|-------|
| `BACKEND_URL` | Railway **web** public URL (no trailing slash) |

Leave `NEXT_PUBLIC_API_URL` unset — it defaults to `/api`, which the rewrite proxies.

## Mobile — Codemagic TestFlight builds

`codemagic.yaml` (repo root) defines two iOS workflows, both producing a
Capacitor TestFlight build from the same pipeline (Capacitor sync,
entitlements, signing, IPA, App Store Connect publish) — they differ only in
which backend the static export bakes in:

| Workflow | API baked in | When to use |
|----------|--------------|-------------|
| `ios-capacitor` | `https://uat.wealth.auriqltd.co.uk/api` (`npm run build:mobile`) | day-to-day TestFlight builds while testing |
| `ios-capacitor-prod` | `https://api.wealth.auriqltd.co.uk` (`npm run build:mobile:prod`) | the production TestFlight build used as Q5 compliance evidence, and for the real App Store release |

To run the production variant, start a Codemagic build and pick
`ios-capacitor-prod` as the workflow (Codemagic UI's "Start new build"
workflow dropdown, or `--workflow ios-capacitor-prod` via the Codemagic
API/CLI) instead of the default `ios-capacitor`.

## GitHub Actions secrets (backups)

`BACKUP_MONGO_URI`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_ENDPOINT`, `R2_BUCKET`.

---

## Cutover & rollback

- The old VPS keeps running until you flip DNS / update the OAuth+TrueLayer URLs.
  Do the migration + Railway/Vercel deploy first, verify on the temporary URLs,
  then switch OAuth/TrueLayer redirect URIs and DNS last.
- **Rollback:** the VPS + its Mongo are untouched by the migration (dump is a
  copy). If anything fails, revert the OAuth/TrueLayer URIs and DNS to the VPS.
- Capacity headroom on M0: data is ~3.6 MB of 512 MB. You'll hit M0's throttled
  throughput or the 500-connection cap long before storage — move to M2/M10 then.
```
