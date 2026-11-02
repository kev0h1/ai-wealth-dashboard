# Finexer customers: deleting them in the dashboard (A178)

Sorted caches one Finexer customer id per user (`finexer_customers`). If a
customer is deleted in the Finexer dashboard, the cached id is dead: creating a
consent with it fails with HTTP 400 on every attempt.

## What the app does by itself

On the next connect, `create_consent` (`services/finexer_sync.py`) sees a 400 or
404 from `POST /consents` whose error envelope (`{error: {type, code, message,
param}}`) names the customer (in `param` or `code`, or a missing or invalid
customer in `message`). It drops the cached record, creates a fresh customer,
and retries the consent once. If that also fails, the route
(`GET /auth/finexer/link`) answers 502 `BANK_LINK_UNAVAILABLE`, or 422
`BANK_PROVIDER_REJECTED` when Finexer rejected that bank outright. It is never a
500. The picker shows the plain message and hides a rejected bank for the
session.

## What you must do after deleting customers

Run the reconciliation from `backend/` (dry run first, counts only):

    MONGO_DB=<db> .venv/bin/python scripts/finexer_reconcile_customers.py
    MONGO_DB=<db> .venv/bin/python scripts/finexer_reconcile_customers.py --apply

It refuses without `MONGO_DB` set. It checks each cached customer with
`GET /customers/{id}`. With `--apply` it deletes the cached record of each
missing customer and, for every consent under it, sets that consent's accounts
to `expired` (the "needs reconnecting" banner) and stamps `last_sync_error` as
`consent_revoked`. Users then reconnect, which creates a fresh customer.
Output fields: checked, ok, missing, errors (not treated as missing), cleared,
consents_flagged, accounts_expired, requests.

## Reading the log

Every consent failure logs one WARNING with the bank id, HTTP status and a
scrubbed reason (emails masked, keys and long tokens removed, truncated):

    Finexer POST /consents failed: provider=<id> status=400 reason=<text>

A customer recreate logs first: `customer rejected as unknown ... dropping the
cached customer and retrying once`.

## Deleting customers and bank accounts is now done by the app (A179)

You no longer need to delete customers in the Finexer dashboard.

- **Erasing a user** (`retention.erase_user`, used by the user's own account
  deletion, the owner's remove-user action on /ops/people and the dormant-user
  sweep) revokes every consent first, then sends `DELETE /customers/{id}` for
  each customer on record for that user (the cached customer plus any
  `customer_id` a consent carries), then clears the cached record.
- **Deleting one account** (`DELETE /accounts/{id}`) deletes it locally, then
  sends `DELETE /bank_accounts/{id}` for a Finexer account. Finexer makes its
  transactions unavailable at once. The user's delete never waits on Finexer
  and never fails because of it.
- A failed delete (any status other than 2xx or 404, or a transport error)
  leaves a retry marker in `orphaned_revocations` (`_id` `customer:<id>` or
  `bank_account:<id>`, with `kind`, `resource_id`, a hash of the user, attempts
  and a static error code, no user id or email). The nightly retention sweep
  (`retry_orphaned_deletions`) retries up to 50 a pass, oldest attempt first,
  clears a marker on 2xx or 404, warns from the seventh attempt and drops a
  marker still failing after 90 days with an error log. The existing consent
  revoke retry ignores these markers.
- Counters: `bank_account_deletes` and `customer_deletes` (plus `requests`) on
  the day's `finexer_api_calls:<date>` doc, and `account_refreshes` for the
  per-account refresh.

If you do still delete a customer in the dashboard, the reconciliation above
remains the way to clear the stale cached id.

## Revoked consents and the account status sweep (A189)

A consent.canceled or consent.expired webhook can arrive while a sync of that
consent is still writing its accounts. Before A189 the sync's end-of-run reset
then set the accounts back to connected, so a revoked connection kept showing
as live with a frozen balance and no reconnect banner.

- The end-of-run reset in `finexer_sync.sync_finexer_consent` now re-reads the
  consent and only marks accounts connected while it is still authorized, and
  only accounts carrying that consent's `connection_id`. If the consent is no
  longer authorized it logs one INFO line (consent id only) and marks the
  accounts expired.
- `finexer_sync.expire_accounts_on_dead_consents()` is an idempotent repair
  sweep: for every consent whose status is not authorized it sets any account
  not already expired to expired. It runs at the end of every 4-hourly
  `task_reconcile_truelayer` pass and logs counts only (`consents_scanned`,
  `accounts_flipped`), so production self-heals within four hours of release
  with no manual step. The worker also runs it once at startup
  (`_dead_consent_sweep_on_startup`), so the release restart heals it at once.
- The payday plan skips a destination whose account status is expired. The
  amount stays unallocated, as it does for an account the user excluded.
