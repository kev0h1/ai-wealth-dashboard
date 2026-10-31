# Finexer transactions: missing pot history and balance-only movements (A175)

Status as of 2026-10-29. Code and public documentation only. Nothing here was
read from production: Railway logs and Atlas are Kevin's to check.

## What was reported

The same Monzo pot (Saving Challenge 2026, balance £1,656.98) shows its daily
transfers in on UAT, which uses TrueLayer, and shows "No transactions" in
production, which uses Finexer. Kevin also saw balances on other production
accounts drop with no matching transactions.

## Findings and sources

Monzo Open Banking documentation, https://docs.monzo.com/open-banking, read
2026-10-29:

- Pots are returned as accounts, with their transactions on the pot itself, for
  UK accounts only when the AISP sends the header
  `X-Open-Banking-Pots-As-Accounts: true`, and for all requests from
  23 November 2026.
- Otherwise pots come from the separate `/aisp/pots` endpoint, which carries
  name, balance, goal and lock status but no transactions.

This is consistent with production: Finexer lists the pot with its balance and
returns no history. UAT via TrueLayer shows the pot's daily history, so
TrueLayer reads pots as accounts by whichever means; how it does so is not
sourced.

Finexer's own API documentation sits behind the dashboard login, so it was not
read. Anything about their refresh cadence, on-demand refresh, pending support
or consent scopes is unconfirmed.

## Hypothesis

Finexer most likely reads Monzo's Pots endpoint today. If so, pot transaction
history should arrive by itself from 23 November 2026, or earlier if Finexer
starts sending the header. This is a hypothesis until Finexer confirms it.

## Our sync behaviour

`backend/app/services/finexer_sync.py`, per account:

1. Upserts the account document (name, type, subtype, balance, updated_at).
2. Walks `GET /bank_accounts/{id}/transactions` following `paging.next`, with no
   date filter, so it always reads the full history the provider will give.
3. A non-200 sets `fetch_failed` and logs a warning ("Finexer transactions
   failed for ..."). A 200 with an empty `data` list used to log nothing.
4. `_upsert_finexer_walk` skips only rows without an id and routes `pending`
   rows to the pending collection. Nothing else is dropped, so a pot with no
   history is the provider returning no rows, not our sync discarding them.

## Diagnostics added by A175

Written on the account document after each walk:

- `transactions_synced_at`: UTC time of the last successful walk.
- `transactions_last_count`: rows the bank returned in that walk, pending
  included.
- `transactions_fetch_failed_at`: set only when the walk failed. A failure
  leaves the two success fields as they were.

A successful walk that returns zero rows for an account with a non-zero balance
also logs one info line naming the account class (for example `savings`),
never the holder.

Where they show:

- `GET /accounts` returns `transactions_synced_at` (ISO) and
  `transactions_last_count` (integer or null) on connected account rows.
- The account sheet, for a connected account with `transactions_last_count`
  equal to 0 and no transactions, says "No transactions have arrived from this
  bank connection yet. The balance still updates." with a second line such as
  "Bank data updated 2 hours ago" (or "Bank data updated 29 Oct" once a week
  old). Older rows without the fields keep the plain "No transactions".
- TrueLayer is left alone: its sync is incremental with a date window, so a
  zero-row pull is normal there and would not mean the same thing.

## Savings pots and Left to spend

An account whose subtype contains "saving" is in the savings pool and is never
spendable (`analytics._account_pool_kind`). The flag does still matter for a
savings account: `_account_pool_kind` returns None when
`include_in_safe_to_spend` is false, so the account then drops out of the
savings pool and out of transfer and source detection, which set-aside and goal
source detection rely on. That is exactly why the build never changes the flag
for pots. The account sheet shows "Savings are not counted in Left to spend."
in place of the switch, unless the flag is already false, in which case the
switch stays so it can be turned back on.

## Checks for Kevin in production

1. Does the Monzo current account show the daily pot transfers out? If so,
   challenge tracking (G357) can follow those outgoing transfers from there.
2. Railway logs for `Finexer transactions failed for` lines, and, after this
   ships, the info line `Finexer returned no transactions for a savings
   account`.
3. For the other accounts whose balance dropped: do the matching transactions
   appear later (lag) or never (dropped)? The "Bank data updated" time on a
   fresh sync tells you how old the walk was.

## Questions to send Finexer

1. Yes or no: do you send `X-Open-Banking-Pots-As-Accounts: true` to Monzo
   today?
2. Yes or no: will pot transactions be returned from 23 November 2026 without
   any change on our side?
3. Yes or no: is transaction data served from a cache? If yes, what is the
   refresh interval?
4. Yes or no: can a client request a refresh for a consent?
5. Yes or no: are pending transactions returned?
6. Yes or no: is an extra consent scope needed for pots?
