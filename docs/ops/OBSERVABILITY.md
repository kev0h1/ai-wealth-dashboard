# Observability: error collection and platform health (E6)

Status: slice 1 is on main (error capture on all three surfaces, scrubbing, a first `/ops/health`). Slice 2 (E7, the metrics collectors) is built on `feature-E7-e6-slice-2-ops`; slice 3 (alerts) is a separate board item (see "Slices").

## Decision (Kevin, 2026-10-16, as recorded on E6)

- Use **Sentry** for error collection on all three surfaces: the backend (`sentry_sdk`, already a dependency), the web app (`@sentry/nextjs`) and the iOS and Android apps (`@sentry/capacitor`).
- **Platform metrics and alerts stay on our own `/ops/health`**, not in Sentry.
- Strict scrubbing before anything leaves. `sendDefaultPii` off. **Session replay off** (financial screens). **Traces sampled at 0.1 or lower.**
- **Separate environments** for `uat` and `production`, and every event tagged with a **release equal to the git SHA** so an error maps to a commit.
- Sentry is added to PRIVACY.md's sub-processor list and retention table, for Kevin's approval (proposed wording below; PRIVACY.md is not edited by this item).
- Agents never print DSNs, keys or tokens.

## Surfaces and SDKs

| Surface | SDK | Entry point | DSN variable |
|---|---|---|---|
| Backend (FastAPI, UAT VPS and Railway) | `sentry-sdk` 2.64.0 (already pinned) | `backend/app/main.py` calls `init_sentry()` from `backend/app/core/observability.py` | `SENTRY_DSN` |
| Web (Next.js, UAT VPS and Vercel), browser and server | `@sentry/nextjs` 10.69.0 | `frontend/instrumentation-client.ts` (browser), `frontend/instrumentation.ts` + `sentry.server.config.ts` + `sentry.edge.config.ts` (server) | `NEXT_PUBLIC_SENTRY_DSN` |
| iOS and Android apps (Capacitor shell over the static export) | `@sentry/capacitor` 4.4.0 with `@sentry/react` 10.69.0 | the same `instrumentation-client.ts`, which branches on `Capacitor.isNativePlatform()` | `NEXT_PUBLIC_SENTRY_DSN` (CI environment, baked at build) |

Notes on the choices:

- **Version alignment.** `@sentry/capacitor` 4.4.0 peer-pins `@sentry/react` to exactly 10.69.0, and the web SDK must share one `@sentry/core`, so `@sentry/nextjs` is pinned to 10.69.0 as well rather than the newer 11.x line. Revisit when the Capacitor SDK moves.
- **`instrumentation-client.ts`, not `sentry.client.config.ts`.** Next 16 builds with Turbopack, which loads `instrumentation-client.ts` and ignores the older `sentry.client.config.ts` file name. Same content, current name.
- **No DSN, no Sentry.** Every init is gated on the DSN. Without it nothing is initialised, nothing is loaded beyond a skipped branch, and nothing is sent. This is the state of every build, test run and CI job until Kevin sets a DSN.
- **No tunnel.** Events go directly to Sentry's ingest host (EU region) over the SDK's own transport. We do not proxy them through our API, so Sentry traffic can never load the API or the Vercel function quota.
- **Static export.** `next.config.ts` applies `withSentryConfig` only when `NEXT_PUBLIC_SENTRY_DSN` is set at build time (a DSN-less build was compared against origin/main and the wrapper changed `serverExternalPackages`, added `clientTraceMetadata` and registered loaders, so it is gated), and never for the Capacitor static export (`MOBILE_EXPORT`); `instrumentation-client.ts` needs no wrapper.
- **Source maps.** Uploaded only when `SENTRY_AUTH_TOKEN` is present in the build environment (Vercel production, later), and deleted from the build output after upload. UAT and local builds never have the token, so they upload nothing.

## Environments and release tagging

- Environment values are exactly `uat` and `production`.
  - Backend: `APP_ENV` (`uat` or `production`; `SENTRY_ENV` is still honoured for the old name, `vps` maps to `uat`), else derived from `APP_URL` (the same non-production host rule as `TRUELAYER_ENABLED`).
  - Web: `NEXT_PUBLIC_APP_ENV`, else `production` only when Vercel reports `VERCEL_ENV=production`, else `uat`.
  - Apps: `build-mobile.sh` exports `NEXT_PUBLIC_APP_ENV=production` for the prod target (`MOBILE_TARGET=prod` or a production `MOBILE_API_BASE`), else `uat`; `codemagic.yaml` also sets it explicitly per workflow.
- Release is the **full git SHA**.
  - Backend: `RELEASE_SHA`, else Railway's `RAILWAY_GIT_COMMIT_SHA`, else `git rev-parse HEAD` (one call at start-up, 2 s timeout, never raises). Set `RELEASE_SHA` in the UAT unit file or let integrate export it; Railway needs nothing.
  - Web: `next.config.ts` inlines `NEXT_PUBLIC_RELEASE_SHA` from, in order, the variable itself, `VERCEL_GIT_COMMIT_SHA`, `CM_COMMIT`, `git rev-parse HEAD`.
  - Apps: `frontend/scripts/build-mobile.sh` computes it before the rsync (which drops `.git`) and exports `NEXT_PUBLIC_RELEASE_SHA`.
- `/ops/health` shows the running backend's release (first 7 characters) and environment.

## Scrubbing rules

Implemented twice, with the same rules and tests on each side: `backend/app/core/observability.py` (`before_send`, `before_send_transaction`, `before_breadcrumb`) and `frontend/lib/observability.ts` (`beforeSend`, `beforeSendTransaction`, `beforeBreadcrumb`). The frontend module has no Sentry import so it is unit tested in plain Node.

1. `sendDefaultPii` is off. `include_local_variables` is off and any `vars`, `context_line`, `pre_context` and `post_context` on stack frames are stripped again in the hook. Profiles are off.
2. **Requests.** Request bodies, cookies, query strings and `env` are dropped. Of the headers only `content-type`, `content-length`, `accept`, `accept-language` and `host` survive. URLs lose their query string and fragment (also inside free text, breadcrumb URLs and navigation `from`/`to`). Fetch and XHR bodies are never kept.
3. **User.** The SDK user is replaced by `{id: <16 hex characters>}` only: `sha256(salt + lower-cased email)[:16]`, computed on the server. The salt (`SENTRY_USER_HASH_SALT`, backend) is **required wherever a DSN is set**: without it `hash_user_id` returns nothing, no user is tagged on backend events, `/auth/session/validate` omits `uid_hash` (the web and apps then set no user), and the backend logs one warning at start-up. An unsalted hash of an email would be dictionary-reversible, so there is deliberately no unsalted fallback. The backend tags the user in `current_user` (`set_sentry_user`); `_scrub_user` keeps an id that already looks like that hash and drops anything else, never re-hashing it, so backend and web ids for one user match. The result is pseudonymous, not anonymous: it is still personal data. A client-side user whose id is not a 16-hex hash is dropped.
4. **Keys.** Any key that names personal or financial data has its value replaced with `[Filtered]` wherever it appears (`extra`, `tags`, `contexts`, breadcrumb data): exact names such as `name`, `email`, `merchant`, `payee`, `counterparty`, `narrative`, `description`, `reference`, `note`, `notes`, `title`, `text`, `body`, `content`, `prompt`, `address`, `phone`, `ip`, `pin`, and any key containing `password`, `secret`, `token`, `authorization`, `cookie`, `api_key`, `amount`, `balance`, `iban`, `sort_code`, `account_number`, `card`, `session`, `csrf`, `dsn`, `credential`, `signature`, `merchant`, `email`, `bearer`. SDK structural keys (`release`, `event_id`, `trace_id`, `environment`, `transaction`, stack-frame names and numbers) pass through.
5. **Strings.** Everything left is pattern-scrubbed: emails, `Bearer` tokens, JWTs, `sk-` keys, 43+ character opaque strings (a 40-character git SHA and 32-character trace ids are deliberately untouched), IBANs, sort codes, 13 to 19 digit card numbers, 8 digit account numbers, and currency amounts (`£`, `$`, `€`, `GBP`, the `−` currency minus, and bare two-decimal figures). Strings are truncated to 400 characters.
6. **Breadcrumbs.** Database and query breadcrumbs are dropped (backend: `query`, `redis`, `mongo`, `db`, `sql`); the web also drops `console` and `ui.input`. Others keep type, category, level and timestamp, with message and data scrubbed and any `body`, `query` or `fragment` data removed.
7. **Spans (traces).** Timing and operation names are kept; span descriptions, data and tags are dropped, since they carry SQL, URLs and statements.
8. **Not reported.** Expected 4xx `HTTPException`s, cancelled requests and client disconnects (backend); 4xx API errors, aborted fetches, "Failed to fetch" and "Load failed" network blips and the ResizeObserver loop notice (web and apps).
9. **No raw exception to users** (A31) is unchanged: error boundaries never show the thrown error, they only report it after scrubbing.

Residual risk, stated plainly. Exception messages are scrubbed by pattern only. A merchant name or free text interpolated into an exception message cannot be detected by regex. Rule for contributors: never interpolate transaction text, merchant names, balances, upstream response bodies or user input into an exception message or an error-level log line (the logging integration turns those into events). Messages are capped at 400 characters.

Known sites where upstream or free text can still reach an error message (review 2026-10-16), documented rather than changed in slice 1:

- `backend/app/services/pdf.py` lines 80, 155 and 207: OpenRouter error bodies. **Fixed in E6**: the exception now carries the status code only; the body goes to a debug log.
- `backend/app/services/finexer_sync.py` lines 179, 244, 275 and 552: `r.text`. **Fixed in E6**: the error and warning logs carry the status and a fixed reason; the truncated body is a debug-level log only.
- `backend/app/routers/push.py` lines 176 and 294: `resp.text`.
- `backend/app/services/penny_agent.py` line 294: a `%r` of a value.
- `backend/app/services/companion.py` lines 4036, 4454 and 5166.
- `backend/app/services/spend_impact.py` line 880: a category name.
- `backend/app/routers/yapily.py` lines 29 and 64.

The unfixed sites are the follow-up list for a hardening pass; the keyed and regex scrubbing still applies to them.

Tests: `backend/tests/test_observability.py` (each PII class against a sample event and breadcrumb, 4xx drop, init is a no-op without `SENTRY_DSN`, strict options passed with one, no network) and `frontend/scripts/observability-scrub.test.mjs` run as `npm run check:observability-scrub` (the same classes plus wiring invariants: init gated on the DSN, replay not present, no tunnel, source maps only with a token).

## Sampling and performance rules

- Never block a request or a render. The SDKs send asynchronously, batched, from a background transport; `shutdown_timeout` is 2 s. The web SDK is loaded by a dynamic import after the page starts, and only when a DSN is set.
- Traces at 0.1 at most, enforced in code: `SENTRY_TRACES_SAMPLE_RATE` and `NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE` can lower it but are clamped to 0.1. Profiling off. Replay off (not imported at all).
- Breadcrumbs capped at 50 per event.
- Drop under load: Sentry's transport drops events when its queue is full or Sentry rate-limits us, and never retries into the request path. If an error storm fills the free-tier quota, set the sample rate lower and add an inbound filter in Sentry rather than adding code.
- Reporting must never break the app: every init and report call is wrapped, a failed init logs a warning and carries on.

## Kevin's setup list

1. Create (or confirm) the Sentry **organisation**, choosing the **EU data region** when offered.
2. Sign Sentry's **DPA**.
3. Create projects: either three (`sorted-backend`, `sorted-web`, `sorted-mobile`) or one with environment tags; the code works with both because events carry `environment` and `release`. Note the org slug and project slugs.
4. Provide the DSNs through environment settings, never in a file in the repo:
   - **Railway** (production API): `SENTRY_DSN`, `APP_ENV=production`. `RELEASE_SHA` is optional there (Railway's commit variable is used).
   - **Vercel** (production web): `NEXT_PUBLIC_SENTRY_DSN`, `NEXT_PUBLIC_APP_ENV=production`; later `SENTRY_AUTH_TOKEN`, `SENTRY_ORG`, `SENTRY_PROJECT_WEB` for source maps.
   - **UAT VPS** (`backend/.env` and `frontend/.env.local`): `SENTRY_DSN`, `NEXT_PUBLIC_SENTRY_DSN` (use a UAT project or the same project, the `uat` environment tag separates them), `APP_ENV=uat`, `RELEASE_SHA`.
   - **Codemagic**: a variable group holding `NEXT_PUBLIC_SENTRY_DSN`, imported with `environment: groups:` (the workflows set `NEXT_PUBLIC_APP_ENV` themselves).
   - `/ops/health` links: `SENTRY_ORG` and `SENTRY_PROJECTS` (comma-separated slugs) on the server that serves `/ops/health`. These are not secrets.
5. Set `SENTRY_USER_HASH_SALT` on the backend (any long random string) **wherever a DSN is set**, UAT included. Without it events carry no user id at all.
6. Add inbound filters in Sentry for known-noisy browser extensions if they appear; set alert rules in Sentry's own UI only for "new issue" if wanted, our own alerts are slice 3.
7. Approve or amend the PRIVACY.md wording below.

## Native steps for the apps (`npx cap sync`)

The JavaScript half is in the web bundle. The native half comes from `@sentry/capacitor`, which `capacitor-spike/package.json` now depends on (with its `@sentry/react` peer), so the existing `npx cap sync` links it.

1. In `capacitor-spike/`, `npm ci` (picks up `@sentry/capacitor`), build the web export (`npm run build:mobile` in `frontend/`), then `npx cap sync ios` / `npx cap sync android` as the existing Codemagic and Android steps already do. The iOS project uses SPM, so the Sentry Cocoa package is resolved by Xcode during the build; the Android Gradle build pulls `io.sentry:sentry-android`.
2. No DSN is written to any native file. The DSN is baked into the JS bundle from `NEXT_PUBLIC_SENTRY_DSN` at build time; native crash capture then starts from that same init call.
3. Native symbolication needs debug symbols and ProGuard mappings uploaded with the Sentry CLI and `SENTRY_AUTH_TOKEN`. That is not wired in slice 1; native crashes arrive unsymbolicated until it is (follow-up on the Kevin setup list once the account exists).
4. Verify on a UAT build: with a UAT DSN set, trigger a handled test error from a debug screen and confirm one scrubbed event with `environment=uat` and the build's SHA. Do this only after the DSN exists; slice 1 is verified without one.

## What the native layer can still send

Native crash reports are captured and sent by the Sentry Cocoa and Android SDKs themselves, so they do **not** pass through the JavaScript `beforeSend` and `beforeBreadcrumb`. What bounds them is the option set in the Capacitor init (`instrumentation-client.ts`, pinned by `check:observability-scrub`): native crash handling on; native-scope sync (`enableNdkScopeSync`), automatic session tracking, failed-request capture, automatic performance tracing, app-hang tracking, thread attachment and screenshots all off; `sendDefaultPii` off.

A native crash event can therefore carry: the crash stack trace (symbolicated only once debug symbols are uploaded), the device model and OS version, the app version and release SHA, the environment tag, and the native SDK's own lifecycle breadcrumbs (app foreground and background, connectivity changes). It carries no request bodies and no JS scope (so no tags, user or JS breadcrumbs, because scope sync is off), and it does not carry the signed-in user.

Honest limit: `@sentry/capacitor` 4.4.0 exposes no option to switch off the native SDKs' own network breadcrumbs (checked in the installed package's types and native sources). The app's own requests are made by the WebView's `fetch`, which the native HTTP instrumentation does not see, so native network breadcrumbs only cover requests made by native plugins (push registration, Apple sign-in, secure storage), and carry the URL and status but no bodies. If that ever matters, the next step is a native `beforeBreadcrumb` in the iOS and Android projects, tracked with the native symbol-upload follow-up.

## `/ops/health`

Owner-only (`GET /ops/health` returns 403 for anyone else; the page reuses the `/ops/go-live` pattern and is in `lib/navExemptRoutes.ts` with a reason).

Slice 1 shows what existing data supports:

- API reachable, database ping (ms), environment, release (7 characters), uptime.
- This server: memory used and free, disk used and free, load against CPU count (`/proc`, `shutil.disk_usage`, `os.getloadavg`; no `psutil`, no secrets).
- Model usage this month per pipeline (from `/admin/llm-usage`: calls, average latency, cost).
- Bank sync (from `/admin/sync-stats`): last reconcile, Finexer request volume, pending revocations (A106), tips research status.
- A "Sentry issues" link per project, built from `SENTRY_ORG` and `SENTRY_PROJECTS`. The DSN is never read by this endpoint or sent to the browser; the page only learns whether a DSN is set.

Colour is information: slate for figures, green for healthy, amber from 75 percent, red only for a genuinely failing state (database not responding, memory, disk or load at 90 percent or more).

### Slice 2 (E7): metrics collectors

Code: `backend/app/services/health/` (one small module per collector, shared interface in `base.py`), endpoints in `routers/ops.py`, page `frontend/app/ops/health/page.tsx` with the section list in `sections.ts` (pinned by `npm run check:e7-health-page`).

**Interface and budget.** Every collector has `name`, `title`, `budget_s` (2 s) and `async collect()` returning `{name, state, status, values, as_of, note}`. `state` is how collection went: `ok`, `timed_out`, `not_configured`, `omitted` (source does not exist here, feature-detected) or `error` (class name only, never upstream text). `status` is what the values mean: `ok`, `warn`, `crit`, or `unknown` whenever `state` is not `ok`. `run_collector` wraps each in `asyncio.wait_for(budget)` and never raises; `run_all` runs them with `asyncio.gather`, so one hanging source costs at most its own budget and blocks nothing. Endpoints (all owner-only, 403 otherwise): `GET /ops/health/collectors` (all, concurrent), `GET /ops/health/collectors/{name}` (one; the page calls this per section so each block loads, times out or shows "Not configured" independently), `GET /ops/health/trends`. `GET /ops/health` itself is unchanged and stays fast.

| Collector | Source | warn / crit |
|---|---|---|
| `api_latency` | in-process ring buffer (10 000 samples, route template, method, status, ms; no ids, bodies or query strings), fed by a pure ASGI middleware registered outermost; per process, resets on restart, last hour | p95 1500 / 3000 ms; 5xx rate 2% / 10% (only with 20+ requests) |
| `finexer_sync` | `worker_runs` reconcile summary, `finexer_consents.last_synced` and `last_sync_error_at` (24 h success and failure counts), `orphaned_revocations` (A106); no-webhook-in-24 h is feature-detected on `last_webhook_at` (A167) and omitted, with a note, until any consent carries it | reconcile age 8 / 12 h; pending revocations 1 / 5; failure share 20% / 50% (5+ attempts); any consent without a webhook warns |
| `worker` | arq Redis keys, read-only: `arq:queue` depth and oldest age, `arq:in-progress:*`, `arq:result:*` (failures decoded with arq's own decoder), heartbeat | depth 50 / 200; oldest waiting 10 / 60 min; failed 1 / 10. Arq keeps results for about an hour, so failures cover what Redis retains, not 24 h |
| `llm_tavily` | `llm_usage` aggregates (same grouping as `/admin/llm-usage`) for this month and last 7 days per pipeline; Tavily calls (model `tavily`, B48) and B44's backoff record | spend vs `LLM_MONTHLY_BUDGET_USD` 75% / 100% (no budget means shown only); Tavily failing warns, failing with backoff active is crit |
| `mongo` | `dbStats` and `profile: -1` (reads the level, never enables the profiler); slow-query count only when the profiler is already on | stored vs `MONGO_STORAGE_LIMIT_MB` 75% / 90% (unset means shown only); slow queries (100 ms+, 24 h) 20 / 200 |
| `vps` | `host_metrics` memory, disk, load per CPU, CPU count, uptime | memory, disk, load 75% / 90%; available memory under 1500 / 700 MB (H95) |
| `railway` | GraphQL with a project token (`Project-Access-Token`): service list and each service's latest deployment status and age | latest deployment FAILED or CRASHED is crit |
| `vercel` | `GET /v6/deployments` with a bearer token: latest state and age, deployments created this month (billing API not called: "Plan not found") | latest state ERROR is crit |
| `push` | `push_log` {ts, status} if it exists; none exists on main, so omitted with a note | failure share 10% / 30% (10+ sends) |

Railway and Vercel are off (`not_configured`) unless their tokens are set and `HEALTH_EXTERNAL_CALLS` is not 0; tokens go only into a request header, never into a result, a log line or an error, and they are never sampled. Without a token no network call is made.

**Trend store.** `health_samples` is a capped collection (created idempotently by `samples.ensure_collection`; max documents = 7 sampled collectors x 288 five-minute buckets x 30 days + slack, 64 MB ceiling). `_id` is `<collector>:<5 minute bucket>`, so replicas and retries cannot double-write. The arq cron `task_health_samples` (every 5 minutes) writes samples for every collector that lives with the worker (`finexer_sync`, `worker`, `llm_tavily`, `mongo`, `vps`, `push`); `api_latency` is sampled by a small loop in the API process (`HEALTH_API_SAMPLER=0` disables it) because its ring buffer exists only there. Tracked metrics: API p95, worker backlog, database size, memory used. The page shows 24 h and 7 d min, avg and max per metric as plain lines (tokens only, red only for a `crit` status elsewhere on the page).

**For E8 (alerts).** Consume `status` per collector (`ok`, `warn`, `crit`; `unknown` means the source could not be read and is not itself an alert) from `run_all(default_collectors())`, and the thresholds above live in the collector modules as module constants. E8 owns throttling and state; collectors hold none. A hung or erroring source yields `state` `timed_out` or `error`, which E8 may count across consecutive runs before alerting.

Slice 3 adds alerts (below).

## Alerts (slice 3, for the record)

Push to Kevin through the existing FCM and APNs path on: a new error type (first seen in Sentry), an error-rate spike, a sync failure surge, Tavily or OpenRouter quota hits, disk or memory thresholds. Throttling so there is never a flood: one alert per key per cool-down window (suggested 6 hours, 1 hour for disk and memory while still breaching), a daily cap, and a single summary push when more than three keys fire in a window. Alert state lives in one Mongo document per key (`last_sent_at`, `count_suppressed`), so a restart does not re-fire.

## PRIVACY.md wording (PROPOSED, for Kevin's approval)

PRIVACY.md already lists "Sentry | Error monitoring (only if enabled)". Proposed replacement row for the sub-processor table, once the DPA is signed and a DSN is live:

> | Sentry | Error monitoring: receives crash and error reports from the app and our servers, including technical details such as browser or device type, app version and the page path. Names, email addresses, amounts, merchant names, account numbers and request contents are removed before sending, and a pseudonymous identifier replaces your identity. This is still personal data under UK GDPR. (EU region) |

Proposed row for the retention table:

> | Error reports (Sentry) | Up to 90 days, then deleted automatically |

Sentry's free tier keeps 30 days and longer retention is plan-dependent, so Kevin confirms the plan and sets the project's retention to match whatever is published. Also proposed, in the "what we collect" section: "We do not record your screen or sessions."

## Slices

1. **Slice 1 (this item, E6):** the spec, error capture with scrubbing on all three surfaces, and the first `/ops/health`.
2. **Slice 2 (follow-up item):** `/ops/health` metrics collectors (list above).
3. **Slice 3 (follow-up item):** alerts, throttled.

Before E6 finishes, an independent reviewer audits the diff and a privacy review audits the scrubbing; neither is skipped for slice 1.
