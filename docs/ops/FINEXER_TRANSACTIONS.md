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

This matches production exactly: Finexer lists the pot with its balance and
returns no history, while TrueLayer asks for pots as accounts.

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

An account whose subtype contains "saving" is always in the savings pool and is
never spendable, whatever `include_in_safe_to_spend` says
(`analytics._account_pool_kind`). The flag only changes whether the account's
bills, income and inbound mirrored transfers are dropped, and inbound transfers
feed set-aside and goal source detection. Switching it off for a pot would
therefore quietly break plan source detection while changing nothing about
spendable cash. So the stored flag is never changed for pots, and the account
sheet shows the line "Savings are not counted in Left to spend." in place of the
switch.

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

1. Are Monzo pots read through the Pots endpoint, or as accounts with the
   `X-Open-Banking-Pots-As-Accounts` header?
2. Are pot transactions supported today, and from 23 November 2026?
3. Is transaction data fetched live from the bank on each request, or cached,
   and at what refresh cadence?
4. Can we request a refresh on demand?
5. Are pending transactions returned?
6. Is any extra consent scope needed for pot transactions?
