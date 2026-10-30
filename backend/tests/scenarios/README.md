# Scenario regression suite (H140)

One JSON file per scenario in this directory. Each is a synthetic situation,
shaped like a real user's data but never copied from it, seeded into the
disposable `wealth_test_*` database and run through the real functions (no
fakes for the builders): `analytics._build_cashflow_response`,
`analytics.compute_safe_to_spend`, `analytics.at_risk_count` and
`companion.compute_today_items`. Only "today" is patched. The same computed
snapshot is then replayed by the frontend (`npm run check:scenarios`), so the
client walks must agree with the server for every account.

Run: `backend/.venv/bin/python -m pytest -q tests/test_scenarios.py` (from
`backend/`) and `npm run -s check:scenarios` (from `frontend/`).

## The hand-computation rule

Every figure under `expected` is derived BY HAND, step by step, in
`expected.notes`, from the fixture's own figures (balances, bill amounts,
dates and the documented rules). Never paste a number from a program run: a
scenario that merely records what the code printed protects nothing. If the
program disagrees with the hand computation, one of them is wrong; find out
which before touching either.

## Fixture format

```
{
  "name": "...",
  "today": "2026-10-29",                       // patched as the user's today (09:00 London)
  "pay_period_config": {"type": "last_friday"},
  "confirmed_income_streams": [],              // preferences.income_streams shape
  "accounts": [                                // accounts_col docs (user_id added)
    {"_id": "acc-x", "name": "...", "provider": "...", "type": "BANK",
     "subtype": "TRANSACTION", "balance": 350.0, "currency": "GBP",
     "status": "connected", "include_in_safe_to_spend": true}
  ],
  "manual_accounts": [],                       // manual_accounts_col docs
  "cashflow_cache": {                          // cashflow_cache_col doc minus _id
    "recurring_spend": [...], "recurring_income": [...],
    "bnpl_commitments": [], "avg_daily_spend": 0
  },                                           // patterns_version is stamped by the harness
  "transactions": [                            // transactions_col docs; date is ISO
    {"account_id": "acc-x", "date": "2026-10-01", "amount": 1000.0,
     "transaction_type": "debit", "description": "...", "category": "Mortgage"}
  ],
  "commitments": [], "allocations": [], "card_terms": [],
  "expected": {
    "left_to_spend": 300.0,
    "accounts": {"<id>": {"spend_from": n, "after_payments": n, "low_point": n,
                          "verdict": "covered" | "short"}},
    "cover_plan": {"moves_total": 0, "moves": [{"from": "<id>", "to": "<id>", "amount": n}]},
    "payday_plan": {"total": n} | null,
    "at_risk_count": 0,
    "notes": "hand computation, step by step"
  }
}
```

`spend_from` is the figure Home shows (`spend_from_headroom` after the pool
cap, as the router applies it); `available` is accepted as an alias for older
wording. `verdict` is "short" exactly when `after_payments < 0` or
`low_point < 0`, otherwise "covered".

## Snapshots (`out/<slug>.json`)

The harness writes each scenario's computed snapshot (cashflow lists, account
eligibility, accounts, plans) to `out/<slug>.json` and asserts it equals the
committed file. The frontend gate reads these files. When a code change moves
a figure on purpose, regenerate with `SCENARIO_WRITE=1` and review the diff:
a changed figure must be explained by the change, never accepted blindly.

## Invariants asserted for every scenario

- every shown Spend from is no more than the pooled Left to spend;
- an account verdict is "short" if and only if `after_payments < 0` or `low_point < 0`;
- each cover-plan card's headline total equals the sum of its moves;
- the payday plan's total equals the sum of its destination moves when present;
- every bill in the period appears in exactly one account walk;
- (frontend) the client walk, positions and availability agree with the server.

## Coverage

Step 1 (this directory): eve of payday with own-account standing orders (G359),
monthly bills on the 1st with month-end pay (G354), a reconnected account with
two salary sightings and its one-sighting variant (G359), the unconfirmed card
bill hold and its release.

Not yet written, to be added once their fixes merge (G360, G362, A175): payday
itself with the salary landed but not yet posted (G362), the HSBC incoming
transfer then mortgage case (G360), a goal funded from the salary account and a
scheduled goal drawn daily (G350/G357), a set-aside in a pot, Hide balances, a
Monzo pot with no transactions (A175). Add a scenario whenever a money bug is
fixed.
