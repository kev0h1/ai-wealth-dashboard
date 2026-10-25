# Production reset for testers (H133)

`backend/scripts/reset_all_users.py` erases every user from the production
database so the testers can start again from a clean slate. It is destructive
and one-way. **Kevin runs it, by hand. Agents never run `--apply` anywhere**
(not on UAT, not against any real database, not as a dry run either): tests
use in-memory fakes only (H96, "verify identity before destructive").

## Prerequisites

- An on-demand Atlas snapshot has been taken and named (note its name and
  time). `--backup-confirmed` is Kevin's statement that this is done; the
  script refuses without it.
- The Railway `MONGO_URI` and `MONGO_DB` values sit in a local env file that
  is never committed (for example `~/h133-prod.env`, mode 600). The script
  copies only those two names from it, never prints them, and loads them
  before anything else reads the config. It prints the database name and the
  credential-free host only.
- The production API can be restarted afterwards, and no live PAID
  subscription exists (the script refuses to apply while one does, and says
  how many per provider).

## 1. Dry run

From `backend/`:

```bash
.venv/bin/python scripts/reset_all_users.py --env-file ~/h133-prod.env
```

Read, in order: the database name and host (are they production?), the user
count, the per-collection counts of what would be deleted (an upper bound: a
document matched by two sweeps counts twice), the Finexer consents to revoke,
the allow-list entries kept, the live PAID subscription count (must be 0), and
the `orphaned_revocations` marker count. The output holds counts only: no
email and no raw id. Nothing is changed.

## 2. Apply

From `backend/`, in a shell with nothing else running against production:

```bash
ALLOW_DROP_PROD_DB=1 .venv/bin/python scripts/reset_all_users.py \
  --env-file ~/h133-prod.env --apply --yes \
  --expect-host <host printed by the dry run> \
  --confirm-db <database name printed by the dry run> \
  --confirm "RESET PRODUCTION" --backup-confirmed
```

Every flag and the environment variable are required; a missing or wrong one
exits 2 before any change. Nothing is dropped: it only deletes documents.
Optional: `--exclude-owner` keeps the owner's own data (the default erases
everyone, as decided), and `--max-users N` caps how many users one run
touches.

For each user it revokes the sessions, then runs the shared erasure path
(`erase_user`: Finexer and TrueLayer consents are revoked first, then every
collection in the erasure manifest, the uid-keyed collections, the id-prefixed
collections, and the user's id is pulled from broadcast recipient lists).
Exit codes: 0 done, 1 finished with Finexer revokes that failed or a shared
collection that changed, 2 refused. It is safe to re-run: erasure is
idempotent, and a re-run finishes any user that failed.

## 3. Verify

1. If the output reports failed Finexer revokes, re-run the apply command, or
   wait for the nightly `retry_orphaned_revocations`.
2. Open the Finexer dashboard and confirm no consents remain active.
3. Re-run the dry run: every count should be zero and the user count 0.
4. Restart the production API. `_seed_subscriptions` recreates the manual
   subscription docs for the owner and the invited allow-list entries on
   start; that is expected.
5. Testers sign in again through the allow list.

## What is kept, and why

- `allowed_signups` (the allow list): so the same people can sign in again.
- `vendors`, `vendor_claims`, `tip_research`, `instrument_prices`,
  `card_product_rates`, `finexer_providers`, `provider_logos`: shared
  reference data that holds no user data.
- `settings` and `settings_audit`: runtime configuration and its audit trail.
- `bot_credentials` (and its use counters), `oauth_clients`: not owned by any
  tester.
- Ops logs and metrics (`worker_runs`, `health_samples`, `alert_state`,
  `error_types_seen`, `locks`, `billing_events`, `llm_global_usage`).
- `orphaned_revocations`: markers are kept by design so a failed Finexer
  revoke is retried; the script only reports new ones, and treats a removed
  one as an error.
- `session_tombstones`: expire by TTL, and keep the erased users' old session
  tokens dead.

## Not covered

`webhook_events` payloads and the `actor` field in `settings_audit` are ops
logs; they are not scrubbed by this reset.

## Rollback

Restore the Atlas snapshot taken in the prerequisites. The script itself has
no undo, and Finexer consents revoked remotely cannot be revived: those
testers would need to reconnect their banks.
