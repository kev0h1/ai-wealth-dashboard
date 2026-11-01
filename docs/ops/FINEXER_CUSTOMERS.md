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
