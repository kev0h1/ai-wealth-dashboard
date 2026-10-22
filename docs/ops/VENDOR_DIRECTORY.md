# Vendor directory scripts (G316)

Background: ENGINE.md, "The Vendor Directory". Code: `backend/app/services/vendor_directory.py`.

All commands run from `backend/`. Pass `--env-file .env` (or the shared tree's `backend/.env`) so the script reaches the same database the app uses. The scripts print counts only: never a user id, email, amount or account number.

## `scripts/backfill_vendor_categories.py`

One-off pass of the sync ladder over existing transactions.

```bash
.venv/bin/python scripts/backfill_vendor_categories.py --env-file .env          # dry run (default)
.venv/bin/python scripts/backfill_vendor_categories.py --env-file .env --apply  # writes
```

- **Dry run** reads only. No lookups, no model calls, no writes. It reports, across users who have custom categories: merchants and rows seen, merchants skipped because the user corrected them or a rule covers them, merchants never sent anywhere (privacy exclusions by reason), merchants already decided, merchants that would need a lookup or a match, rows stored decisions would move, and duplicate user rules.
- **Never touches** a row the user corrected (source user or `custom_category` set), a merchant the user has corrected anywhere, or a merchant covered by a user rule.
- **Duplicate user rules** (same user, pattern and category, for example the MIDLANDS GOLF Meriden rule stored twice): the dry run counts them. `--apply` keeps the oldest of each set and deletes the extras.
- `--apply` uses the real caps (`VENDOR_LOOKUP_CAP_PER_SYNC`, `VENDOR_LOOKUP_CAP_PER_DAY`) and honours the Tavily quota backoff, so a large backlog needs the script re-run until `deferred` reads zero. On UAT only the dry run has been run; `--apply` waits for Kevin's sign-off on the report.

## `scripts/vendor_directory_report.py`

Read-only before and after of the account owner's categories (`PRIMARY_EMAIL`, never printed), written to `docs/engine/vendor-directory-report.md`.

```bash
.venv/bin/python scripts/vendor_directory_report.py --env-file .env                 # live: at most 20 lookups
.venv/bin/python scripts/vendor_directory_report.py --env-file .env --simulate      # no Tavily, no model
.venv/bin/python scripts/vendor_directory_report.py --env-file .env --no-live       # no calls at all
```

Every collection the lookup path writes (directory, claims, lookup state, usage metering) is an in-memory fake, and the ladder runs with `dry_run=True`, so the real database is only read. `--simulate` is a plumbing check with a fixed word list standing in for the directory and the matcher, and says nothing about model quality; use live mode when Tavily and OpenRouter are healthy.

## Health

Lookup state is the `vendor_lookups` block of the `llm_tavily` collector on `/ops/health` (see OBSERVABILITY.md). Config keys are in ENV.md.
