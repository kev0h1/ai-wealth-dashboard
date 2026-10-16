# Observability: error collection and platform health (E6)

Status: slice 1 built on branch `feature-E6-observability` (error capture on all three surfaces, scrubbing, a first `/ops/health`). Slices 2 and 3 are separate board items (see "Slices").

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
- **Static export.** `next.config.ts` skips `withSentryConfig` for the Capacitor static export (`MOBILE_EXPORT`); `instrumentation-client.ts` needs no wrapper.
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
3. **User.** The SDK user is replaced by `{id: <16 hex characters>}` only: `sha256(salt + lower-cased email)[:16]`, computed on the server. The backend sets it in `current_user` (`set_sentry_user`), and `/auth/session/validate` returns the same value as `uid_hash` so the web and the apps tag events with it without ever hashing on the client. A client-side user whose id is not a 16-hex hash is dropped, not forwarded. The optional `SENTRY_USER_HASH_SALT` (backend only) makes the hash non-reversible by dictionary; set it before production.
4. **Keys.** Any key that names personal or financial data has its value replaced with `[Filtered]` wherever it appears (`extra`, `tags`, `contexts`, breadcrumb data): exact names such as `name`, `email`, `merchant`, `payee`, `description`, `reference`, `address`, `phone`, `ip`, `pin`, and any key containing `password`, `secret`, `token`, `authorization`, `cookie`, `api_key`, `amount`, `balance`, `iban`, `sort_code`, `account_number`, `card`, `session`, `csrf`, `dsn`, `credential`, `signature`, `merchant`, `email`, `bearer`. SDK structural keys (`release`, `event_id`, `trace_id`, `environment`, `transaction`, stack-frame names and numbers) pass through.
5. **Strings.** Everything left is pattern-scrubbed: emails, `Bearer` tokens, JWTs, `sk-` keys, 43+ character opaque strings (a 40-character git SHA and 32-character trace ids are deliberately untouched), IBANs, sort codes, 13 to 19 digit card numbers, 8 digit account numbers, and currency amounts (`£`, `$`, `€`, `GBP`, the `−` currency minus, and bare two-decimal figures). Strings are truncated to 400 characters.
6. **Breadcrumbs.** Database and query breadcrumbs are dropped (backend: `query`, `redis`, `mongo`, `db`, `sql`); the web also drops `console` and `ui.input`. Others keep type, category, level and timestamp, with message and data scrubbed and any `body`, `query` or `fragment` data removed.
7. **Spans (traces).** Timing and operation names are kept; span descriptions, data and tags are dropped, since they carry SQL, URLs and statements.
8. **Not reported.** Expected 4xx `HTTPException`s, cancelled requests and client disconnects (backend); 4xx API errors, aborted fetches, "Failed to fetch" and "Load failed" network blips and the ResizeObserver loop notice (web and apps).
9. **No raw exception to users** (A31) is unchanged: error boundaries never show the thrown error, they only report it after scrubbing.

Residual risk, stated plainly. Exception messages are scrubbed by pattern only. A merchant name or free text interpolated into an exception message cannot be detected by regex. Rule for contributors: never interpolate transaction text, merchant names, balances or user input into an exception message; the privacy review greps for this. Messages are also capped at 400 characters.

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
5. Set `SENTRY_USER_HASH_SALT` on the backend (any long random string) before production.
6. Add inbound filters in Sentry for known-noisy browser extensions if they appear; set alert rules in Sentry's own UI only for "new issue" if wanted, our own alerts are slice 3.
7. Approve or amend the PRIVACY.md wording below.

## Native steps for the apps (`npx cap sync`)

The JavaScript half is in the web bundle. The native half comes from `@sentry/capacitor`, which `capacitor-spike/package.json` now depends on (with its `@sentry/react` peer), so the existing `npx cap sync` links it.

1. In `capacitor-spike/`, `npm ci` (picks up `@sentry/capacitor`), build the web export (`npm run build:mobile` in `frontend/`), then `npx cap sync ios` / `npx cap sync android` as the existing Codemagic and Android steps already do. The iOS project uses SPM, so the Sentry Cocoa package is resolved by Xcode during the build; the Android Gradle build pulls `io.sentry:sentry-android`.
2. No DSN is written to any native file. The DSN is baked into the JS bundle from `NEXT_PUBLIC_SENTRY_DSN` at build time; native crash capture then starts from that same init call.
3. Native symbolication needs debug symbols and ProGuard mappings uploaded with the Sentry CLI and `SENTRY_AUTH_TOKEN`. That is not wired in slice 1; native crashes arrive unsymbolicated until it is (follow-up on the Kevin setup list once the account exists).
4. Verify on a UAT build: with a UAT DSN set, trigger a handled test error from a debug screen and confirm one scrubbed event with `environment=uat` and the build's SHA. Do this only after the DSN exists; slice 1 is verified without one.

## `/ops/health`

Owner-only (`GET /ops/health` returns 403 for anyone else; the page reuses the `/ops/go-live` pattern and is in `lib/navExemptRoutes.ts` with a reason).

Slice 1 shows what existing data supports:

- API reachable, database ping (ms), environment, release (7 characters), uptime.
- This server: memory used and free, disk used and free, load against CPU count (`/proc`, `shutil.disk_usage`, `os.getloadavg`; no `psutil`, no secrets).
- Model usage this month per pipeline (from `/admin/llm-usage`: calls, average latency, cost).
- Bank sync (from `/admin/sync-stats`): last reconcile, Finexer request volume, pending revocations (A106), tips research status.
- A "Sentry issues" link per project, built from `SENTRY_ORG` and `SENTRY_PROJECTS`. The DSN is never read by this endpoint or sent to the browser; the page only learns whether a DSN is set.

Colour is information: slate for figures, green for healthy, amber from 75 percent, red only for a genuinely failing state (database not responding, memory, disk or load at 90 percent or more).

Slice 2 adds (collectors writing small time-bucketed documents, never a new service): API p50 and p95 latency and error rate per route; Finexer sync success and failure and pending revocations over time; worker queue depth and job failures; LLM spend against a budget and Tavily quota (B44, B48); Mongo size and slow queries; Railway and Vercel usage (deployment counts, since the Vercel billing API returns "Plan not found" for this team) and build minutes (H115); push delivery rates; and the **upgrade signals**: p95 creeping up, worker backlog, Railway plan limits, Mongo tier.

Slice 3 adds alerts (below).

## Alerts (slice 3, for the record)

Push to Kevin through the existing FCM and APNs path on: a new error type (first seen in Sentry), an error-rate spike, a sync failure surge, Tavily or OpenRouter quota hits, disk or memory thresholds. Throttling so there is never a flood: one alert per key per cool-down window (suggested 6 hours, 1 hour for disk and memory while still breaching), a daily cap, and a single summary push when more than three keys fire in a window. Alert state lives in one Mongo document per key (`last_sent_at`, `count_suppressed`), so a restart does not re-fire.

## PRIVACY.md wording (PROPOSED, for Kevin's approval)

PRIVACY.md already lists "Sentry | Error monitoring (only if enabled)". Proposed replacement row for the sub-processor table, once the DPA is signed and a DSN is live:

> | Sentry | Error monitoring: receives crash and error reports from the app and our servers, with names, email addresses, amounts, merchant names, account numbers and request contents removed before sending, and an irreversible pseudonymous identifier in place of your identity (EU region) |

Proposed row for the retention table:

> | Error reports (Sentry) | 90 days, then deleted automatically |

Sentry's retention is plan-dependent (the free tier keeps 30 days); set the project's data retention in Sentry to match whatever is published. Also proposed, in the "what we collect" section: "We do not record your screen or sessions."

## Slices

1. **Slice 1 (this item, E6):** the spec, error capture with scrubbing on all three surfaces, and the first `/ops/health`.
2. **Slice 2 (follow-up item):** `/ops/health` metrics collectors (list above).
3. **Slice 3 (follow-up item):** alerts, throttled.

Before E6 finishes, an independent reviewer audits the diff and a privacy review audits the scrubbing; neither is skipped for slice 1.
