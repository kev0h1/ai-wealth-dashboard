# Bank sync strategy (E11)

Status: review and recommendation, 2026-10-24. Nothing here changes production
polling cadence. The build slices that ship with it keep today's behaviour as
the default (see section 6). Kevin approves the recommendation before any
production setting is changed.

## 1. How syncing works today

All line numbers are on branch `feature-E11-sync-strategy` as written (the
build slices move a few of them).

| Path | Trigger label | What it does | Where |
| --- | --- | --- | --- |
| User refresh (Home pull and button, Accounts retry) | `user` | `POST /accounts/sync` syncs the user's TrueLayer connections inline and every authorised Finexer consent through `finexer_sync_pipeline(..., trigger="user", recompute=False)`, then one recompute and cache warm-up | `backend/app/routers/accounts.py` (`sync_all`), `backend/app/services/finexer_sync.py` (`finexer_sync_pipeline`) |
| Settings "Sync all history" | none recorded (was a TrueLayer-only loop) | `POST /accounts/sync-history` re-fetched 90 days for TrueLayer connections only. It never touched Finexer, so in production (Finexer only) it recomputed caches and nothing else. Fixed by E11, see section 3 | `accounts.py` (`sync_history`) |
| Reconcile cron | `auto` | `task_reconcile_truelayer` runs at hours 0, 4, 8, 12, 16, 20 (`backend/app/workers/sync_worker.py`, `cron(task_reconcile_truelayer, ...)`). For every authorised Finexer consent it asks `finexer_poll_due` whether the consent is stale, enqueues `task_sync_finexer`, spread by `RECONCILE_MAX_PER_MINUTE` (40), `RECONCILE_MIN_GAP_SECONDS` (2) and `RECONCILE_SPREAD_MINUTES` (210). It also retries stuck or failed TrueLayer webhook events | `sync_worker.py` (`task_reconcile_truelayer`, `_refresh_window`, `_spread_offsets`) |
| Finexer re-sync rule | `auto` | Tier window: every paid tier is `4h`, which is 3 h 30 (`_DEFAULT_REFRESH_WINDOW`), Lite is `daily` 23 h 30, Statements has none. If a handled webhook arrived within `FINEXER_WEBHOOK_STALE_HOURS` (24) the consent is polled only once per `FINEXER_POLL_INTERVAL_HOURS` (24) minus half an hour. With no webhook in 24 h the consent falls back to the tier window | `backend/app/services/finexer_webhooks.py` (`finexer_poll_due`), config in `backend/app/core/config.py` |
| Webhook (A167) | `auto` | `POST /webhooks/finexer/{secret}`: path secret, HMAC signature (`fx-signature`, `t=;s=`), 5 minute replay tolerance, event id dedupe in `webhook_events`. `bank_account.created/updated/synced` and `consent.authorized` enqueue a debounced `task_sync_finexer` (Redis `SET NX EX` of `FINEXER_WEBHOOK_DEBOUNCE_SECONDS`, 30, deferred by the same window so one burst is one sync). The event stamps `last_webhook_at` on the consent | `backend/app/routers/webhooks.py` (`finexer_webhook`, `_enqueue_sync_debounced`) |
| Daily polling safety net | `auto` | Not a separate job. It is the reconcile cron applying the 24 h rule above to consents whose webhooks look healthy | `finexer_poll_due` |

What every Finexer sync costs: `sync_finexer_consent` makes one `GET /consents/{id}`,
one `GET /bank_accounts`, a provider list (cached, H19), then per account one
balance GET and a walk of every page of `/bank_accounts/{id}/transactions` with
**no query parameters** (`finexer_sync.py`, the `txn_url` loop). It has no
incremental cursor, so every sync re-reads whatever history Finexer returns.
All GETs go through `_get`, which counts requests and retries 429s up to three
times (`_MAX_429_RETRIES`).

What `/ops/health` exposes (`backend/app/routers/ops.py`, `ops_health`, via
`webhook_health` in `finexer_webhooks.py`): `signing_configured`,
`path_secret_configured`, `last_received_at` and minutes ago, `authorized_consents`,
`consents_without_webhook` (authorised with no webhook inside the stale window),
and today and yesterday's counters from `worker_runs` doc
`finexer_api_calls:YYYY-MM-DD`: `requests`, `rate_limited`, `webhook_events`,
`webhook_syncs_enqueued`, `webhook_events_coalesced`, `poll_syncs_enqueued`.
E9 adds the last 50 webhook events table. E11 adds `user_syncs` and
`history_syncs` to the same daily doc, so the three triggers can finally be
compared.

Gap found: before E11 nothing recorded the trigger of a completed sync.
`trigger` only reaches `recompute_derived_caches`. The daily counters count
syncs enqueued by poll and by webhook, not by user.

## 2. Measurements from UAT (read-only, counts only, 2026-10-24)

Source: UAT Mongo, `webhook_events`, `finexer_consents` and `worker_runs`, last
7 days. No ids, emails or consent ids were read or printed.

| Measure | UAT value |
| --- | --- |
| Finexer webhook events received, 7 days | 18 (18 Oct: 3, 19 Oct: 11, 24 Oct: 4, none other days) |
| Events per consent per day | not computable: 0 of 18 resolved to a live consent (12 `skipped / consent_not_found`, 6 `skipped / unresolved`). The tester consents they belonged to no longer exist |
| Event types seen | `consent.initiated` 4, `consent.created` 3, `consent.opened` 3, `consent.authorized` 2, `bank_account.synced` 2, `webhook.created` 2, `unknown` 2 |
| Webhook-triggered syncs enqueued | 0 (counter absent) |
| Poll syncs enqueued by the cron (`poll_syncs_enqueued`) | 4 (18 Oct), 12 (19 Oct), 12 (20 Oct), 12 (21 Oct), 10 (22 Oct), none 23 and 24 Oct |
| User-triggered syncs | not recorded before E11 |
| Finexer GETs per day (`requests`) | 54, 166, 166, 170, 114 on 18 to 22 Oct, so about 14 per sync |
| Rate limited (429) | 0 on every day |
| Authorised Finexer consents now | 0 |
| `consents_without_webhook` | 0 (no authorised consent to count) |

Reading: UAT has too little live Finexer traffic to say how reliable webhooks
are. Two things are visible. First, 12 poll syncs a day is two consents polled
at all six cron ticks, which is the no-webhook fallback (6 a day per account),
so on UAT the webhook trust rule rarely engaged. Second, Finexer sends events
beyond the eight Kevin registered (`consent.initiated`, `consent.opened`,
`webhook.created`); the receiver records them and ignores them, which is safe.

**Production numbers must come from production, not from here.** Production's
Mongo is not readable from this host. Kevin should read, on production
`/ops/health` and the E9 table, over at least 7 days:

1. `authorized_consents` and `consents_without_webhook`. If the second is close
   to the first, webhooks are not arriving and polling must not be reduced.
2. The E9 table: count of `bank_account.synced` and `bank_account.updated` per
   day, and the share with outcome `queued` against `skipped` or `failed`.
3. The daily counters for each of the last 7 days: `webhook_syncs_enqueued`,
   `poll_syncs_enqueued`, `user_syncs`, `requests` and `rate_limited`. The
   target ratio: poll syncs per consent per day at or below 2 while
   `consents_without_webhook` is 0.
4. `last_received_at`: minutes since the last webhook, at several times of day.
5. Whether the webhook shows as paused in the Finexer dashboard (ten
   consecutive non-2xx pauses it and emails the owner).

## 3. Sync history finding

Does the Finexer transactions endpoint accept a date range? **Not verified,
and the code does not use one.** Evidence: `sync_finexer_consent` requests
`/bank_accounts/{id}/transactions` with no parameters and follows `paging.next`
until exhausted; its own comment says the fetch walks the full history every
sync with no incremental cursor. Finexer's API reference
(finexer.com/docs) redirects to a login page from this host, so the parameter
list could not be read. No document in this repository records a from-date
parameter either.

Consequence applied by E11: a Finexer consent is already re-read in full by
every sync, so a separate 90-day backfill would add nothing. `POST
/accounts/sync-history` now says so, recomputes the user's figures, and
returns a message that reflects what happened. The Settings copy no longer
promises a 90-day re-fetch for Finexer banks. If Finexer confirms a from-date
parameter, a true history window is only useful to widen, not narrow, what
Finexer returns, and that is a question for them (section 7).

## 4. Finexer facts and sources

| Fact | Status | Source |
| --- | --- | --- |
| Webhook events: `bank_account.created/deleted/synced/updated`, `consent.authorized/canceled/created/expired` | Confirmed by Kevin | `docs/ops/FINEXER_WEBHOOKS.md`, "Confirmed" |
| Retry: reply 2xx; on timeout or non-2xx retried every 3 s; ten consecutive failures pause the webhook and email the owner | Confirmed by Kevin | same file |
| Signature: `fx-signature: t=...;s=...`, HMAC-SHA256 of `"{time}.{raw body}"`; Finexer does not reject replays | Confirmed by Kevin, verified on UAT 2026-10-19 | same file, "Signature format (confirmed)" |
| API rate limit | Unverified. The code treats a real 429 and `Retry-After` as the ground truth and caps its own load at 40 jobs a minute (E2) | `finexer_sync.py` `_get`; `docs/ops/ENV.md` `RECONCILE_MAX_PER_MINUTE`; UAT has seen 0 429s |
| Per-call cost model | Unverified. Nothing in the repository documents a per-call price. Our own volume is about 14 GETs per consent sync on UAT | measurement above; ask Finexer |
| Transactions date range | Unverified (section 3) | docs behind login |
| How long initial connect backfills, and how far back the history goes | Unverified. The first sync stamps `last_synced` and fetches all pages Finexer returns | `finexer_sync.py` `is_initial_sync` |
| Whether our GET makes Finexer call the bank, or reads Finexer's stored copy | Unverified, and the key question for the cap in section 5 | ask Finexer |

## 5. Regulatory

PSD2 RTS on strong customer authentication (Commission Delegated Regulation
(EU) 2018/389), Article 36(5): an account information service provider may
access the payment account data without the customer being present no more
than four times in 24 hours, unless a higher frequency is agreed between the
provider and the bank with the customer's agreement. Text:
https://eur-lex.europa.eu/eli/reg_del/2018/389/oj. **Unverified here:** the
EUR-Lex page returned no content to the fetch tool on this host, so the article
number and the figure of four are cited from memory and must be checked against
the text before anyone relies on them. The UK retained the rule in the FCA's
SCA-RTS (the FCA Handbook, SCA-RTS, Article 36), and the Payment Services
Regulations 2017 regulation 70 (legislation.gov.uk/uksi/2017/752/regulation/70,
opened and confirmed to cover AIS access obligations) is the parent provision.
The detail of the UK cap wording is unverified for the same reason.

Who is the TPP: Finexer is the authorised account information service provider
and Sorted acts as its agent (the regulated footer on the consent template
names AURIQ LTD, see the Finexer consent template notes and
`docs/compliance/finexer-agent-controls-2026-09.md`). The bank sees Finexer, so
Finexer owns the access count at the bank, and we only see calls to Finexer.

Why it matters: today a consent with no webhooks is polled six times a day
(cron hours 0, 4, 8, 12, 16, 20), which is above four if every poll reaches the
bank as an unattended access. A user-present refresh is outside the cap (the
customer is present). Open question for Finexer: does their own background
refresh, plus our polling, count against the four, and is our GET a bank call
or a read of their cache.

## 6. Options

A. **Webhook-first with an adaptive safety net (recommended).** In production
keep webhooks as the trigger and poll only consents with no webhook and no
sync in N hours (12 proposed). Worst case that is two unattended syncs a day
from us, well inside four even with Finexer's own refreshes. Cost: a silent
webhook outage delays data by up to N hours, so it needs the alert on
`consents_without_webhook` (E6/E7 style) and the paused-webhook email.
Built as `SYNC_WEBHOOK_SAFETY_NET_HOURS` (0 means off, today's behaviour).

B. **Per-environment poll interval and webhook trust as runtime settings.**
UAT keeps 4-hourly polling for test confidence, production moves to option A,
both without a redeploy and with an audit entry (E10). Built as
`SYNC_POLL_HOURS` (default 4 gives today's 3 h 30 window; raising it widens the
window for the paid tiers) and `SYNC_WEBHOOK_SAFETY_NET_HOURS`. Neither
overrides `FINEXER_POLL_INTERVAL_HOURS` and `FINEXER_WEBHOOK_STALE_HOURS`,
which stay env.

C. **User-present refresh always allowed, once a minute per user.** The cap
does not bind a customer-present request, so Home pull stays instant, but a
rapid double tap should not cost 14 Finexer GETs a time. Built: 429 with
`Retry-After`, Home shows "Refreshed less than a minute ago" in a neutral
style, and the first sync after connect is exempt.

D. **What Sync history becomes.** For Finexer banks, nothing separate: every
sync already reads everything Finexer returns. Keep the control only while
TrueLayer exists on UAT, with honest copy; once production is Finexer-only and
the date-range question is answered, remove it from Settings.

Not recommended: dropping polling entirely (no recovery from a missed or paused
webhook), and raising the 40-per-minute reconcile ceiling (needs Finexer's say).

## 7. Recommendation and rollout

Recommendation: adopt options A, B and C together and let D follow Finexer's
answer. Measure production for seven days first, reading the five things in
section 2. If `consents_without_webhook` is zero and the poll-to-webhook ratio
is healthy, set `SYNC_WEBHOOK_SAFETY_NET_HOURS` to 12 on production from
`/ops/health` and leave UAT at 0. Review one week later against the counters
and `requests` per day, and only then consider `SYNC_POLL_HOURS`. Rollback is
setting `SYNC_WEBHOOK_SAFETY_NET_HOURS` back to 0 (or clearing the override),
which restores today's cadence within the 60 second settings cache with no
deploy.

Questions to send Finexer:

1. What are the API rate limits (per key, per minute, per consent), and is
   there a per-call or per-sync charge on our plan?
2. Does `GET /bank_accounts/{id}/transactions` accept a from and to date, and
   what are the exact parameter names and paging limits?
3. How far back does the history go on first connect, how long does the initial
   backfill take, and is there an event when it completes?
4. How often does Finexer refresh a connected account on its own, and does
   each refresh emit `bank_account.synced`? Which event means new transactions?
5. Does our `GET` on balances and transactions cause a bank access, or does it
   read Finexer's stored copy? Do our calls count towards the four unattended
   accesses a day under RTS Article 36(5), together with Finexer's own
   refreshes?
6. Has Finexer agreed a higher frequency with any UK banks, and what do they
   recommend as a safe daily poll count per consent?
7. Webhook delivery guarantees: the retry window after ten failures, whether a
   paused webhook replays missed events, and why `consent.initiated`,
   `consent.opened` and `webhook.created` appear beyond the eight documented.
