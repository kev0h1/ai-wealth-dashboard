# H87: Yapily removal inventory

Yapily was the dormant open-banking provider that the Finexer migration always
planned to remove. This file records every reference found at the start of H87
and what was done with it. Finexer is the primary provider; the TrueLayer path
is unchanged. Safe to Spend, the account pool and every other surface now read
`accounts_col` / `transactions_col` (plus statement and manual sources) only.

Decision key: delete, replace, keep (with why).

## Backend app (35 modified files, 2 deleted)

| Area | Files | Decision |
|---|---|---|
| Router | `routers/yapily.py` | delete, and its `main.py` registration |
| Sync service | `services/yapily_sync.py` | delete |
| Worker | `workers/sync_worker.py` (`task_sync_yapily`, the `functions` entry) | delete (no cron entry existed) |
| Startup | `main.py`: legacy-consent encryption task, stale-data cleanup task, two `yapily_transactions` indexes, collection imports | delete |
| Collection handles | `db/collections.py` (`yapily_consents_col`, `yapily_accounts_col`, `yapily_transactions_col`) | delete; names move to `ERASE_ONLY_COLLECTIONS` (below) |
| Safe to Spend pool | `routers/analytics.py` `_safe_to_spend_accounts` (the AUTHORIZED consent filter), `get_kpis`, three account/transaction unions | replace with `accounts_col` only |
| Account pool and listing | `routers/accounts.py` (listing, both sync fan-outs, delete cascade), `services/companion.py`, `services/account_plan_sources.py`, `services/counted_accounts.py`, `routers/commitments.py`, `routers/planned.py`, `routers/allocations.py`, `routers/manual_accounts.py`, `services/manual_account_rules.py` | replace with the remaining providers |
| Transaction unions | `routers/transactions.py`, `income.py`, `transport.py`, `challenges.py`, `savings.py`, `savings_insights.py`; `services/cashflow.py`, `income.py`, `needle.py`, `notifications.py`, `pace.py`, `planned.py`, `spend_verdict.py`, `penny_tools.py` | replace |
| Limits | `core/subscription.py` `check_connection_limit` (Yapily consent count) | replace (TrueLayer plus Finexer only) |
| Config | `core/config.py` `YAPILY_APP_UUID`, `YAPILY_SECRET`, `YAPILY_BASE_URL` | delete |
| Comments only | `core/crypto.py`, `services/account_kinds.py`, `net_position.py`, `cycle_story.py`, `broadcast.py`, `retention.py` | reword |
| Erasure | `db/collections.py` `ERASURE_MANIFEST`, `services/retention.py` `_ACCOUNT_DATA_COLLECTIONS` | drop the three bindings; erase_user and account_has_data keep covering the names through `ERASE_ONLY_COLLECTIONS` (raw `db[name]`), until the drop script runs |

`BANK_META` in `frontend/components/AccountMiniCard.tsx` held no Yapily entry
(it is keyed by bank, not provider), so there was nothing to remove and no
bank logo asset was Yapily-only; `check:bank-logos` is unaffected.

## Frontend

| File | Decision |
|---|---|
| `lib/api.ts` (`yapilyInstitutions`, `yapilyRequisition`, `yapilySync`, `deleteYapilyConnection`, one comment) | delete |
| `app/auth/yapily/callback/route.ts` | delete, with its entries in `scripts/build-mobile.sh` and the `check-no-raw-fetch.mjs` allowlist |
| `scripts/app-lock.test.mjs` | replace the hand-rolled call-site probe with `deleteManualAccountRule` (same shape) |

Capacitor, `.github/workflows`, `codemagic.yaml`, `nginx`, `shared`: no references.

## Scripts and tests

- `scripts/check_naive_dates.py`: delete the two allowlist entries for the deleted files.
- `backend/scripts_baseline_capture.py`, `scripts_merchant_key_backfill.py`: drop the collection.
- Tests: `test_yapily_consent_encryption.py` deleted (Yapily-only). About 48 mixed-provider tests lose their no-op `yapily_*_col` stubs. `test_needle.py`, `test_account_cover_source_eligibility.py`, `test_safe_to_spend_hardening.py`, `test_trial_lifecycle_b45.py`, `test_penny_proposals_accounts.py`, `test_tiers.py`, `test_notifications.py` were rewritten to the remaining providers.
- New: `test_retire_yapily_accounts.py`, and a manifest test in `test_collections_manifest.py`.

## Docs

| File | Decision |
|---|---|
| `docs/ops/ENV.md`, `DEPLOY.md` | delete the Yapily rows; ENV.md gains a retired-variable note |
| `CLAUDE.md`, `PENNY_TOOLS.md`, `docs/penny/action-inventory.md`, `docs/ux/undesigned-ui-inventory.md` | update |
| `docs/compliance/*` (the Finexer answers) | no mention of Yapily; nothing to change |
| `ADR.md` ADR-005 | keep as history, with a pointer to H87 |
| `SECURITY.md` changelog 1.10, `docs/security/*` pentest scope, methodology, run records, log sweep | keep: dated records of what was true at the time (Yapily consent token finding included) |
| `TODO.md` | board history, untouched |

## Data

`backend/scripts/retire_yapily_accounts.py`: count only by default; `--apply --yes`
deletes the documents and drops the three empty collections through
`app.db.guard.guarded_drop_collection`, refusing up front on a non-test
database without `ALLOW_DROP_PROD_DB=1`. Nothing in H87 deletes data.
`ERASE_ONLY_COLLECTIONS` is the pre-existing erase-only set (A101); A128 calls
its equivalent `RETIRED_COLLECTIONS` on its own branch, so fold these three
names into whichever set survives when the branches meet.
