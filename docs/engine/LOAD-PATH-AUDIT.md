# Load-path audit (H145)

Audit of every endpoint each screen calls on load, against the rule in `ENGINE.md`, "No live calculation on screen load" (Kevin 2026-11-02): a screen reads stored results and formats them; it does not compute money figures, forecasts, matches or candidates on request.

Read from the code at origin/main 892054d4 plus the measurements below. Citations are function names, not line numbers, because the files are moving (G363).

## 1. How to read this

**Classes.**

- **Stored**: the handler reads a stored document or rows and formats them. No compute function is reachable from it (the static gate agrees).
- **Mixed**: a stored result is served when present, but the handler computes on a miss, or derives part of the response per request on top of a stored part.
- **Live**: the handler computes from raw transactions or balances on every request; there is no store to read.

**What the cache is today.** `services/response_cache.py`: in-process memory layer plus a Mongo `response_cache` collection. An entry is served only when all four hold: the user's data version matches, the Europe/London day matches, the shape version matches, and it is under 6 hours old. Three consequences drive most of the rows below.

1. **One counter per user.** There are about a dozen direct `data_version.bump` calls plus about 65 `invalidate` callers that bump through `response_cache`, and `ainvalidate` is a full wipe. Any edit (a dismissal, a preference, a category, a set-aside) makes every Mixed endpoint below a miss on its next open, whether or not the edit touched its inputs.
2. **No day-rollover job.** Every entry carries the London day, so every entry dies at London midnight (the rollover job below runs just after it) and nothing recomputes it. `warm_user` runs only after a sync (`accounts.sync_all`, `workers/sync_worker.py` `_warm_after_sync`). The 4-hourly reconcile cron happens to warm users, so a morning open is usually warm, but that is an accident of the schedule, not a guarantee, and a user who edits anything after the warm-up is cold again.
3. **One event loop.** The API is a single uvicorn process (`services/derived_caches.py` documents a forecast recompute "blocks its event loop for over a second per user"). Requests a screen fires in parallel therefore queue behind each other's compute: a cold screen costs the sum of its Mixed and Live endpoints, not the slowest one, and it delays every other user while it runs.

Other stores: `cashflow_cache_col` (forecast patterns only, refreshed after sync, dirty-stamped by G177, 6 hour background refresh, `PATTERNS_VERSION`), `money_shape_cache_col` (6 hours, data version, `SCHEMA_VERSION`), `transfer_review_store` (G390: epoch plus fingerprint, 24 hour expiry), `behaviour_portrait_col` (Mirror, 7 days).

## 2. Latency: what exists and what was measured

**What is stored.** Per-route p50 and p95 are not persisted anywhere. `services/health/latency.py` keeps a per-process in-memory ring buffer (last hour, 10,000 samples) which `/ops/health` aggregates per route on read; it resets on every API restart and needs owner auth, so it was not read here. What is persisted (`health_samples`, every 5 minutes, 30 days) is one overall API p95 and request count, no route. Read from UAT, ms only:

| Window | Overall API p95 min | avg | max | samples |
| --- | --- | --- | --- | --- |
| 24 h | 11.5 | 1,274 | 8,922 | 177 |
| 7 d | 9.0 | 448 | 16,402 | 1,561 |

The 24 hour average sitting above the 7 day average, with a maximum near 9 seconds, is the cold-load behaviour this item is about, seen from outside.

**What was measured.** A scoped, read-only one-off (default database name, no user-data writes, no scratch database, ms and counts only; the measurement called compute functions that refresh derived cache entries (category signals, pace baseline and shape), idempotent, with no data-version bump) against the owner's data on UAT: 2,336 transactions, 16 accounts. It calls each compute function or handler directly, so it measures the cost of a cache miss (compute functions) or the whole handler (read handlers), with no response cache involved. Five calls each on a host with other services running: first call, median of the repeats, maximum. Single-user, single-caller figures: they are floors, and under load on the shared event loop the real figures are higher. Handlers that write on a miss (`/grow`, `/commitments`, `/mirror`, `/dismissed-series`, `/savings-insights`) were not called, to keep the run write-free; those rows say "not measured".

## 3. Per screen

Columns: endpoint, the function behind it, class, compute functions reached (from the gate's allowlist), the cache, measured ms (first / median / max).

### Home (`app/components/HomePage.tsx`, `BottomNav`, `HomeBrief`)

| Endpoint | Function | Class | Compute reached | Cache and invalidation | ms |
| --- | --- | --- | --- | --- | --- |
| `GET /profile`, `GET /preferences` | `get_profile`, `get_preferences` | Stored | none | none needed | 5 / 4 / 5 and 4 / 5 / 7 |
| `GET /accounts` (accountsCache) | `get_accounts` | Stored | none (a per-request eligibility predicate only) | none | 12 / 17 / 25 |
| `GET /sync/status` | `sync_status` | Stored | none | none | 3 / 3 / 4 |
| `GET /safe-to-spend` | `get_safe_to_spend` via `cached_safe_to_spend_response` | Mixed | `build_safe_to_spend_response` (pooled walk, G231 exclusions, plans, pace) on miss | `safe_to_spend`, data version, London day, shape, 6 h; wiped by any edit; filled by `warm_user` | miss 265 / 154 / 158 |
| `GET /today` | `get_today` via `build_today_payload` | Mixed | `compute_today_items` (cover plan, payday plan, move cards, account eligibility, spend-from) on miss | `today`, same rules; preview never cached; filled by `warm_user` | miss 197 / 186 / 205 |
| `GET /cashflow` (UpcomingBillsStrip) | `get_cashflow` | Mixed | `_build_cashflow_response`, live balance overlay, `current_period_facts`, income suggestion, `list_active_allocations`, `total_reserved_slices` on every request; `compute_and_cache_cashflow` when dirty or absent | patterns doc in `cashflow_cache_col`; the response is not cached | stored build 33 / 48 / 87, plus overlay and attachments, handler not measured (it writes on a miss) |
| `GET /cashflow/at-risk-count` (every screen, nav badge) | `at_risk_count` | Live | `_build_cashflow_response`, `build_window_inputs`, the per-account walk on every request; `compute_and_cache_cashflow` if dirty | none | not measured (writes when dirty); at least the 48 ms response build |
| `GET /transactions/miscategorised-count` | `get_miscategorised_count` | Mixed | `get_review_state` (inline `_build_review_state` on a store miss), then per-request period filter and grouping | `miscategorised_count:{offset}` plus the G390 store | store read 27 / 21 / 24; inline rebuild 128 / 141 / 152 |
| `GET /connections` | `list_connections` | Stored | none (one count query per connection, an N+1) | none | 167 / 99 / 147 |
| `GET /investment/accounts` | `get_investment_accounts` | Live | `_investment_display`, `account_value` per account | none | 4 / 7 / 8 |
| `GET /goals/summary` | `get_goals_summary` | Live | `goals_summary` per request | none | 19 / 6 / 7 |
| `GET /transactions/search` (recent 12) | `search_transactions` | Stored | none | none | not measured |
| `GET /savings-insights/spotlight` | `get_spotlight_insight` | Stored | none | docs written by the tips refresh | not measured |
| `GET /transactions?days=90` (only when a chart is pinned) | `all_transactions` | Live | `SpendingContext.from_docs`, `txn_flow` per row | none | see Spend |
| idle warm-ups | `router.prefetch("/spend")`, `fetchVerdictData(0)` | n/a | they call Spend's endpoints early | see Spend | n/a |

Cold Home sum of the Mixed and Live compute alone: about 154 + 186 + 48 + 141 + 7 = 536 ms before the at-risk walk, the overlay and the allocation and plan attachments, against a 300 ms p95 budget. Warm, the compute drops out and Home is a handful of reads.

### Spend (`app/components/SpendPage.tsx`, `SpendShapeCard`, `/spend/shape`)

| Endpoint | Function | Class | Compute reached | Cache and invalidation | ms |
| --- | --- | --- | --- | --- | --- |
| `GET /spend/verdict?offset=n` | `get_spend_verdict` | Mixed | `compute_spend_verdict` on miss (reading, notables, majority, unresolved, moved) | `spend_verdict:{offset}`, standard rules; offset 0 warmed by `warm_user`; closed periods are recomputed after every wipe although they cannot change | 35 / 37 / 48 |
| `GET /spend/category-signals?offset=n` | `get_category_signals` | Mixed | `compute_category_signals` on miss | `category_signals:{offset}` | 31 / 44 / 48 |
| `GET /money-shape` (idle on Spend, and `/spend/shape`) | `money_shape`, `get_money_shape_cached` | Mixed | `compute_and_cache_money_shape` on a stale or missing doc | `money_shape_cache_col`: 6 h, data version, schema version; recomputed after sync by `recompute_derived_caches` | 210 / 183 / 254 |
| `GET /transactions/miscategorised-count?offset=n` | as Home | Mixed | as Home | as Home | as Home |
| `GET /savings-insights` | `get_savings_insights` | Mixed | lazy `_find_triggered_transactions` backfill per doc without `triggered_by` (writes) | docs written by the tips refresh | not measured |
| `GET /mirror` | `get_mirror` | Mixed | `compute_portrait` on a miss or after 7 days, may call a model | `behaviour_portrait_col`, 7 days | not measured |
| `GET /transactions/oldest`, `GET /categories`, `GET /preferences`, `GET /subscription` | direct reads | Stored | none | none | 1 to 7 |
| `GET /transactions?days=365` (Patterns view, Accounts) | `all_transactions` | Live | `SpendingContext.from_docs` and `txn_flow` stamp a `spend_amount` on every row, every request | none | 200 / 130 / 169, and a year of rows in the payload |

`GET /pace/detail` has no caller on any screen today (only `lib/api.ts` and design previews reference it). It is Mixed (245 to 358 ms on a miss) and should be deleted or left off the plan.

### Upcoming (`app/planning/PlanningPage.tsx`, `/upcoming`)

| Endpoint | Function | Class | Compute reached | Cache and invalidation | ms |
| --- | --- | --- | --- | --- | --- |
| `GET /cashflow?include=forecast` | `get_cashflow` (G386) | Mixed | as Home's `/cashflow`, plus `cached_safe_to_spend_response` for the verdict, which computes on a miss | patterns doc; the verdict shares `safe_to_spend` | as Home plus 154 on a verdict miss |
| `GET /today` | as Home | Mixed | as Home | as Home | as Home |
| `GET /safe-to-spend` (fallback when `forecast` is absent) | as Home | Mixed | as Home | as Home | as Home |
| `GET /account-plans` | `list_account_plans` | Live | `_serialise` per allocation, fill source inference | none | 18 / 19 / 23 |
| `GET /allocations` | `list_allocations` via `_list_enriched` | Live | per-request enrichment and remaining | none | 6 / 4 / 6 |
| `GET /dismissed-series` | `dismissed_series` | Stored (writes a one-off migration stamp) | none | none | not measured |
| `GET /cashflow/at-risk-count` | as Home | Live | as Home | none | as Home |

The client then runs the by-account walk and cover suggestion itself (`lib/upcomingAccountWalk.ts`, `lib/coverSuggestion.ts`, `lib/cashWalk.ts`). That is computation on screen load in the browser. It is outside the endpoint gate and is the H140 known gap G363 retires.

### Planning (`app/planning/LongTermPlanningPage.tsx`, `GrowPanel.tsx`)

| Endpoint | Function | Class | Compute reached | Cache and invalidation | ms |
| --- | --- | --- | --- | --- | --- |
| `GET /grow` | `grow_view` | Mixed | `get_cached_safe_to_spend` (computes the pooled walk if `safe_to_spend` is absent), `monthly_cashflow_cached`, `get_debt_plan_cached`, `_current_savings`, `_period_gate`, `_investment_display` on miss | `grow`; also dropped by `adrop` whenever a newer Left to spend is cached; filled by `warm_user` | not measured; on a full miss it contains a Left to spend compute (154) plus debt plan (86) |
| `GET /commitments` | `list_commitments` | Mixed | `_serialise_all`, `_feasibility_ctx`, `_debt_ctx`, `_pace_note_ctx` on miss, and a write-once legacy migration | `commitments`; filled by `warm_user` | not measured |
| `GET /debt-plan/summary` | `get_debt_plan_summary` | Mixed | `get_debt_plan_cached`, `compute_debt_plan` on miss | `debt_plan` | 75 / 86 / 90 (miss) |
| `GET /savings/insights` | `savings_insights` | Live | `_cashflow`, `_current_savings` per request | none | 31 / 14 / 17 |
| `GET /accounts` | as Home | Stored | none | none | as Home |

### Accounts (`app/components/AccountsPage.tsx`)

| Endpoint | Function | Class | Compute reached | Cache and invalidation | ms |
| --- | --- | --- | --- | --- | --- |
| `GET /accounts`, `/connections`, `/sync/status`, `/preferences`, `/investment/accounts`, `/card-terms`, `/manual-accounts` | direct reads | Stored, except investments (Live, see Home) | none, except `account_value` | none | 2 to 17; `/connections` 99 median |
| `GET /kpis` | `get_kpis` | Live | `account_value` per investment account, `try_build_spending_context`, `_avg_monthly_burn` over 90 days of debits for runway | none | 134 / 81 / 94 |
| `GET /today` (account positions, available, lowest after plans) | as Home | Mixed | as Home | as Home | as Home |
| `GET /transactions?days=365` (`getAllTransactionsCached`) | `all_transactions` | Live | as Spend | none | 200 / 130 / 169 |

### Account page (the account sheet, opened from Accounts, Home or Upcoming)

| Endpoint | Function | Class | Compute reached | Cache and invalidation | ms |
| --- | --- | --- | --- | --- | --- |
| `GET /accounts/{id}/transactions` | `get_transactions` | Stored | none | none | not measured (paged read) |
| `GET /accounts/{id}/categories` | `get_account_categories` | Live | an inline per-request aggregation over 90 days of the account's debits (not a named function, so the static gate does not see it; see section 5) | none | not measured |
| `GET /today` | as Home | Mixed | the account's Available, After payments and Lowest come from `account_eligibility`, so the account page waits on the Home compute | as Home | as Home |
| `GET /investment/accounts/{id}/holdings` (investment accounts) | `account_value` path | Live | per request | none | not measured |

### Penny (`app/penny/PennyPage.tsx`, `PennyConversation`, `AimNudge`, `PennySheetProvider`)

| Endpoint | Function | Class | Compute reached | Cache and invalidation | ms |
| --- | --- | --- | --- | --- | --- |
| `GET /today` (brief, payday plan) | as Home | Mixed | as Home | as Home | as Home |
| `GET /safe-to-spend` | as Home | Mixed | as Home | as Home | as Home |
| `GET /can-i/suggestions` | `can_i_suggestions` | Mixed | `get_cached_safe_to_spend`, which computes the pooled walk on a miss; chips formatted per request | reads `safe_to_spend`, never writes it | miss 154 |
| `GET /checkpoints/nudge` | `get_checkpoint_nudge`, `get_aim_nudge` | Live | reads the Mirror portrait and the pace reading per request | none | 2 / 1 / 1 (no aim set on the owner's data, so this is the cheap branch) |
| `GET /mirror` | as Spend | Mixed | as Spend | as Spend | not measured |
| `GET /penny/conversations`, `GET /subscription` | direct reads | Stored | none | none | 1 to 7 |

### Transfers review (`MiscategorisedReviewSheet`, opened from Spend or Home)

| Endpoint | Function | Class | Compute reached | Cache and invalidation | ms |
| --- | --- | --- | --- | --- | --- |
| `GET /transactions/miscategorised` | `get_miscategorised_transactions` | Mixed (mostly Stored since G390) | `get_review_state` serves the stored candidates; `_build_review_state` runs inline only when the store is missing or its fingerprint or epoch no longer match; `_group_miscategorised` per request | `miscategorised_list` plus `transfer_review_store`: epoch bumped on every category writer, fingerprint of decisions, accounts and transaction count, 24 h expiry; rebuilt at sync by `refresh_review_state` and warmed by `warm_user` | store 27 / 21 / 24; inline rebuild 128 / 141 / 152 |

## 4. Summary

**Live (no store at all):** `GET /cashflow/at-risk-count` (on every screen), `GET /kpis`, `GET /transactions?days=n`, `GET /allocations`, `GET /account-plans`, `GET /savings/insights`, `GET /goals/summary`, `GET /investment/accounts`, `GET /accounts/{id}/categories`, `GET /checkpoints/nudge`.

**Mixed (stored when warm, compute on a miss or per request):** `GET /safe-to-spend`, `GET /today`, `GET /cashflow` (with and without `include=forecast`), `GET /spend/verdict`, `GET /spend/category-signals`, `GET /money-shape`, `GET /transactions/miscategorised` and `-count`, `GET /grow`, `GET /commitments`, `GET /debt-plan/summary`, `GET /can-i/suggestions`, `GET /mirror`, `GET /savings-insights`, `GET /pace/detail` (no caller).

**Stored:** `/profile`, `/preferences`, `/categories`, `/subscription`, `/accounts`, `/connections` (N+1 counts), `/sync/status`, `/card-terms`, `/manual-accounts`, `/accounts/{id}/transactions`, `/transactions/search`, `/savings-insights/spotlight`, `/dismissed-series`, `/penny/conversations`, `/transactions/oldest`.

**The three structural findings behind the Mixed rows:** one global data version per user wipes everything on any edit; there is no day-rollover job, so every entry expires at London midnight; and the single event loop turns a cold screen into the sum of its misses. The heaviest cold costs measured are Left to spend (154 ms), today items (186), money shape (183), the forecast build and overlay (48 plus), the transfer review rebuild (141) and the 365 day transactions list (130, with a year of rows on the wire). Home alone is about 540 ms of compute cold before the unmeasured parts.

## 5. Limits of this audit and of the gate

- Numbers are single-user floors on a shared host, not p95 under load. Per-route p50 and p95 are not stored; the first deliverable of the plan below makes them persist so the budget can be checked.
- The static gate sees functions it is told about (`COMPUTE_FUNCTIONS` in the test) reached from the handler and from same-module helpers up to three levels. It does not see inline aggregation inside a handler (`/accounts/{id}/categories`, parts of `/kpis`), computation in the browser, or compute reached through another module's non-listed helper. `KNOWN_INLINE` in the test lists the routes known to aggregate inline so an empty allowance is not read as clean, aliased calls are also invisible, and a second test requires every GET route to be in `LOAD_PATH` or `NOT_LOAD_PATH`. The audit rows say where that applies; the plan lists each as an item rather than relying on the gate.
- `GET /cashflow`, `/cashflow/at-risk-count`, `/grow`, `/commitments`, `/mirror` and `/dismissed-series` write on some paths, so their handlers were not driven; their costs are inferred from the parts that were.

## 6. Plan: move every Live and Mixed endpoint to sync-time precompute

### 6.1 Templates and the shape of a store

- **G390 `transfer_review_store`** is the template for invalidation: a per-user document, an `epoch` bumped by `mark_stale` at each writer, a `built_epoch` recorded by `save` so a bump that lands mid-compute is never overwritten, a fingerprint of the decision inputs, a shape version and a 24 hour backstop. A recompute re-reads every user decision, so it cannot drop one.
- **G386 forecast on the payload** is the template for response shape: carry the dependent figure on the one response the screen already makes (`GET /cashflow?include=forecast` returns the Left to spend verdict), so a screen needs one stored read, not a second request.
- **`response_cache.snapshot` then `aput(version=v)`** stays as the write contract: pin before computing, skip the write if something moved.

Every store document carries: `uid`, `kind`, `shape_version`, `london_day`, `computed_at`, `epoch` and `built_epoch` for its own dependency set, a small `inputs` fingerprint, and `payload`. A handler reads the document, checks nothing, and returns `payload` with `computed_at` as the as-of time.

**Fallback (all steps).** A handler never computes. If the store is missing it returns the explicit "being prepared" state the client already has for first sync (G210 `syncing`) and enqueues the recompute; if the store is stale (epoch, day or shape behind) it serves the last result with its as-of time and enqueues the recompute (stale-while-revalidate). `warm_user` becomes the safety net: it runs the same recompute function for any store a trigger missed, and the reconcile cron reports which stores it had to repair, as a signal that a trigger is missing.

**Trigger set and what each recomputes.** One orchestrator, `recompute_for(uid, trigger, scope)`, replaces the hard-coded list in `warm_user`:

| Trigger | Fired from today | Recomputes |
| --- | --- | --- |
| Bank sync, webhook | `derived_caches.recompute_derived_caches`, `sync_worker`, `finexer_sync`, `truelayer_sync` | forecast patterns, shared walk, everything below |
| User edit: plan, set-aside, allocation | `routers/allocations`, `commitments`, `planned` | shared walk, Left to spend, today items, Upcoming, Planning |
| User edit: category, confirmation, dismissal | `routers/transactions`, `analytics` dismiss routes, `mark_stale` | spend stores, review store, forecast for confirmations |
| Settings change | `PATCH /preferences`, account counted, pay period | shared walk and every date-window store |
| Day rollover | none today | every date-dependent store, per user, in the worker |

An edit recomputes only the stores that read what it changed, using an epoch per dependency (spend inputs, forecast inputs, plan inputs, settings) instead of the one global data version.

### 6.2 Coordination

- **G363 (one money engine, steps G364 to G371).** The shared per-period, per-account walk (`services/window_inputs.py`, `services/account_walk.py`, G364 to G367 are on main; G368 onward still to land) is where the precompute for the Home and Upcoming groups lives: the walk result is stored once per user per window, and Left to spend, per-account positions, cover plan, payday plan, the Upcoming by-account rows, and the at-risk count are derived views of that one stored result. Of the walks MONEY-ENGINE.md section 1.4 lists, W1 to W5 are now one module (`services/account_walk.py`, with the positions and the pooled walk derived from it), so Left to spend, per-account positions, cover plan and the at-risk count can precompute from that single walk today. The divergent ones that remain are W6 (spend impact, which reuses the shared events but walks twice), W7 and W8 (the client by-account and runway walks), W9 (notification bill shortfall) and W10 and W11 (payday plan sizing and allocation shortfall gaps); do not precompute those separately; precompute each as its G36x step retires it, so no store is built for code that is about to be deleted. Until a step lands, its figure keeps its current code and its current allowance in the gate.
- **H140 (scenario suite).** Every precompute step must leave the committed scenario snapshots byte-identical. Mechanism: each step first adds the store writer and a parity assertion in the scenario harness (store payload equals the live compute, per scenario), and only then switches the handler to read the store. The `check:scenarios` gate and the backend scenario run must pass with no snapshot diff; a step that changes a figure is a different item, not part of this one.

### 6.3 Steps, in order of work

**Step 0, foundation (do first).** (a) Persist per-route p50, p95 and count in `health_samples` so the 300 ms budget is measurable. (b) The generic store service (`services/precomputed.py`: epoch per dependency, `built_epoch` CAS, shape and day stamps, as-of time) plus `recompute_for`. (c) The day-rollover job: an arq cron just after London midnight that runs `recompute_for(uid, "day_rollover")` per user in the worker, batched so one user's compute never starves the rest. (d) The "being prepared" and stale-with-as-of response contract for handlers. Storage: `precomputed_store` collection, `_id` = `{uid}:{kind}[:{period}]`, added to the erasure manifest as `transfer_review_store` was.

**Step 1, every-screen badge and the forecast (group Upcoming/forecast).** Store the built cashflow response and the at-risk count. Today `GET /cashflow` rebuilds the response per request and `GET /cashflow/at-risk-count` runs a walk on every screen. Precompute at sync, plan or set-aside edit, settings change and rollover: period facts, payday, live balance overlay (balances only change at sync), income suggestion, allocations attach, plans reserved, the carried Left to spend verdict (G386), and the at-risk count from the same walk. Fallback as above. Gate: remove the `GET /cashflow` and `GET /cashflow/at-risk-count` allowances.

**Step 2, Home hero and plan (group Left to spend and today), after G363's walk steps land.** Store the pooled Left to spend result, `today` items, `account_eligibility` and the payday plan as derived views of the shared walk. This also removes the Account page's wait on Home compute. Edits to a plan or set-aside recompute here immediately instead of wiping. Gate: remove `GET /safe-to-spend`, `GET /today`, and `GET /can-i/suggestions` (which reads the stored figure only).

**Step 3, Spend (group Spend).** Store `spend_verdict` and `category_signals` for offset 0 and for each closed period, keyed by period: a closed period is recomputed only when a transaction dated inside it changes, not on every wipe. Store the money shape (already stored; remove the inline recompute on a stale read), and derive the miscategorised count from the stored review state with the period slice stored too. Gate: remove the Spend and money-shape allowances.

**Step 4, transactions list.** `GET /transactions?days=n` stamps `spend_amount` per row per request (130 ms and a year of rows). Stamp `spend_amount` on the transaction document when it is categorised or when kinds change, and have the list read it; trim the Accounts and Spend payloads to what the screen shows. Gate: remove `from_docs` and `txn_flow` from `GET /transactions`.

**Step 5, Planning (group Planning).** Store `grow`, `commitments` and the debt plan summary, recomputed on sync, plan edit, card terms edit, settings change and rollover; `grow` reads the stored Left to spend period gate instead of calling the walk. `GET /savings/insights` and `GET /goals/summary` read stored figures written at sync.

**Step 6, Accounts (group Accounts).** Store `kpis` (net worth, cash, runway) at sync and on account edits; denormalise the per-connection account counts in `GET /connections`; store `account_value` per investment account at price refresh and statement upload; store allocation and account-plan rows (fills, remaining) at sync and plan edit; precompute `GET /accounts/{id}/categories` per account at sync.

**Step 7, Penny (group Penny).** Store the aim nudge at sync from the stored pace reading; move the Mirror portrait to a scheduled job (no model call on a request); `GET /can-i/suggestions` reads the stored figure.

**Step 8, transfers review tidy (group Review).** G390 did the store; remove the inline `_build_review_state` fallback in favour of the shared contract, and store the period slice behind the count.

**Client-side computation** (the Upcoming by-account walk, cover suggestion, `lib/cashWalk.ts`) goes with G363's server-side runway step; it is listed there, not duplicated here.

### 6.4 Proposed board items (not added; one sentence each)

1. Persist per-route p50 and p95 latency, add a version-stamped precomputed-store service with per-dependency epochs and a nightly London day-rollover recompute job, and define the "being prepared" and stale-with-as-of response contract (H145 step 0).
2. Store the Upcoming forecast response and the at-risk count at sync, edit, settings change and rollover so `GET /cashflow` and `GET /cashflow/at-risk-count` only read (H145 step 1).
3. Store Left to spend, today items, account eligibility and the payday plan as derived views of the shared walk once G363's walk steps land, so Home, Penny suggestions and the account page read stored results (H145 step 2).
4. Store the Spend verdict, category signals, closed-period readings and the miscategorised count per period, recomputed only when a transaction in that period changes (H145 step 3).
5. Stamp `spend_amount` on transactions at categorisation and serve `GET /transactions` from storage with trimmed payloads (H145 step 4).
6. Store `grow`, `commitments`, the debt plan summary, savings insights and goals summary at sync, plan edit and rollover (H145 step 5).
7. Store `kpis`, per-connection counts, investment account values, allocation and account-plan rows and per-account category totals at sync (H145 step 6).
8. Move the aim nudge and the Mirror portrait to stored results produced at sync or by a scheduled job (H145 step 7).
9. Remove the transfers review inline rebuild fallback and store its period slice (H145 step 8).
10. Fail a build when a load-path endpoint's p95 exceeds 300 ms in the scenario run, once step 0 persists per-route timings (follow-up to the gate).

### 6.5 The gate, and how each step tightens it

`backend/tests/test_load_path_no_live_compute.py` records today's reality: each load-path route and the compute functions it may still reach (the allowances in section 3). Each step above ends by deleting its routes' entries in the same commit; the test also fails on a stale allowance, so a step cannot forget. The file's docstring is the how-to.
