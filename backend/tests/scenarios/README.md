# Scenario regression suite (H140)

One JSON file per scenario in this directory. Each is a synthetic situation,
shaped like a real user's data but never copied from it, seeded into the
disposable `wealth_test_*` database and run through the real functions (no
fakes for the builders): `analytics.get_cashflow` (which runs
`_build_cashflow_response` plus the live-balance overlay and period facts),
`analytics.compute_safe_to_spend`, `analytics.at_risk_count` and
`companion.compute_today_items`. Only the clock is patched: `timeutil` and the `datetime`/`date` names in every app module are frozen to the scenario day (09:00 London) for the run. The same computed
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

`expected.frontend_known_gaps` (optional): `{"<assertion key>": "<reason>"}` for a
divergence that is a tracked defect. The frontend gate prints the reason on every
run and skips that check for that scenario only; delete the entry when the defect
is fixed. Assertion keys are of the form `<check name>: <account id>` (for example
`walk agrees with server positions: acc-bc`), as passed to `assertKey(...)` in
`frontend/scripts/scenarios.test.mjs`. A gap whose assertion now passes FAILS the
run (stale gap). Currently used by
`reconnected-account-one-salary-sighting` (the client walk credits an income the
server refuses to credit).

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

## What is real and what is not

The harness opens its own client on the disposable `wealth_test_*` database,
rebinds every collection handle for the run and restores it afterwards. Nothing
the builders read is faked. The clock is frozen, including the 90-day wall-clock reads, so snapshots do not
drift with the real date. The `state` word is still left out of the snapshot. Not driven: `spend_impact` (it needs a
verdict context), Penny and any LLM call.

## Invariants asserted for every scenario

- every shown Spend from is no more than the pooled Left to spend;
- an account verdict is "short" if and only if `after_payments < 0` or `low_point < 0`;
- each cover-plan card's headline total equals the sum of its moves;
- the payday plan's total equals the sum of its destination moves when present;
- every bill in the period appears in exactly one account walk;
- (frontend) the client walk, positions and availability agree with the server.

## Coverage

Step 1 (H140): eve of payday, where everything dated on payday belongs to the next period (G359, G360), the same standing orders funded by a steady salary mid-period (G359, G360 funded-inflow rule),
monthly bills on the 1st with month-end pay (G354), a reconnected account with
two salary sightings and its one-sighting variant, with the salary mid-period (G359), the unconfirmed card
bill hold and its release.

Step 2 (H142), numbers are the board's scenario numbers:

- 2a `payday-itself-salary-landed-and-posted` (G362): the salary is in the balance and posted today, so the
  occurrence is closed and every real bill in the new period is deducted once (Left to spend 2,865). Known
  backend gap `payday_plan present`: with the occurrence closed the plan has no salary candidate, so the
  G172 landed-salary gate never runs and the plan stays up with a salary of 0.
- 2b `payday-itself-salary-landed-not-posted` (G362, money engine map D7): the salary is in the balance but no
  credit has posted, so the occurrence stays open and is credited twice. The overstated figures are pinned
  exactly (Left to spend 4,280 against a correct 2,865, Barclays after payments 5,005 against 2,005) and listed
  as backend known gaps.
- 5 `hsbc-incoming-transfer-then-mortgage-payday-eve` and `...-mid-window` (G360): the incoming payday transfer then
  the mortgage. On the eve both belong to the next period (after payments equals low point, 10); mid-window the
  transfer is credited because Barclays is funded, so the mortgage is covered (after payments 360, low point 10).
- 7 `goals-reserved-at-their-source-japan-and-4p-challenge` (G350, G351, G352): a goal funded from the salary account
  (stored source, kept there by the payday plan) and a scheduled daily goal (4p a day step) drawn from another
  current account (stored source). Slices reserved at their source in the positions and the payday plan's source
  needs, no goal pot is a plan destination. Headroom and the payday plan read the schedule through
  `_goal_source_slices` (G375), so the daily goal is 354.48 on every surface.
- 8 `set-aside-in-a-pot-reserved-at-its-source`: an allocation filling a savings pot, its source learned from a
  same-day paired transfer; the unfilled 150 is reserved at the source in Left to spend, headroom and positions,
  the pot is never spendable.
- 9 Hide balances: a client preference (`PreferencesContext`, `wd_hide_balances`) with no server figure, so it is
  asserted in the frontend gate only. Scenarios with `expected.hide_balances: true` (scenario 7) have the gate
  render the Upcoming hero, the By account card and every account sheet from the snapshot, hidden and shown: hidden
  leaves no pound figure in text or aria labels, shown has them (payment lines are payment amounts and stay visible
  by the B55 policy).
- 10 `monzo-pot-with-no-transactions` (A175): a savings pot with a balance, last transaction count 0 and a sync stamp.
  Savings pool only, never spendable, the account sheet shows the empty-state copy with the bank data time line,
  and the switch is replaced by the static Savings are not counted line (frontend gate, rendered from the snapshot's
  account rows; backend asserts the serialised diagnostics and the pool).

Add a scenario whenever a money bug is fixed.

## Extra fixture keys (H142)

- `commitments` (goals) and `allocations` (set-asides) need an explicit `_id` (a generated id would change every
  run; the harness refuses a snapshot that contains one). Date fields (`created_at`, `effective_from`,
  `created_period_start`, `created_period_end`) are ISO strings, converted on seeding.
- `expected.pinned_wrong` (backend, required with known_gaps): the list of assertion keys pinned to a known-wrong value. It must name exactly the keys in `known_gaps`: a gap deleted without removing its pin, or a pin with no gap, fails the run, so deleting a gap can never silently turn the wrong figure into the plain expectation.
- `expected.known_gaps` (backend): `{"<assertion key>": {"correct": <value>, "reason": "..."}}`. The fixture's own
  expected value pins the CURRENT wrong behaviour exactly; `correct` is the hand-computed right value. Every run
  prints each gap (to stderr and as a `ScenarioKnownGap` warning, so `-p no:warnings` cannot hide it, and the frontend gate prints them too); the run FAILS when the
  actual figure equals `correct` (stale gap: delete it and set the expectation to the correct figure), when the
  pinned behaviour changes, or when a gap key matches no assertion. Keys: `left_to_spend`, `spendable_balance`,
  `<account id> spend_from | after_payments | low_point | headroom | plans_reserved | after_payments_and_plans | verdict`,
  `<account id> row <field>`, `cover moves_total`, `cover moves`, `payday_plan present | total | salary amount | dests | keeps | reasons`.
- `expected.spendable_balance`, `plans_reserved` (goals, from `/cashflow`), `allocations_reserved`, per account
  `headroom`, `plans_reserved`, `after_payments_and_plans`.
- `expected.payday_plan`: `total`, `salary_amount`, `dests` ({account: move}), `keeps` ({name: amount kept at the
  salary account}), `reasons` ({account: [[name, kind, amount]]}).
- `expected.not_spendable`: account ids that are in no pool (backend) and show no availability and no Spend from
  (frontend).
- `expected.account_rows`: per account `pool`, `cover_source_eligible` and the serialised transaction diagnostics.
- `expected.hide_balances`: run the masking check in the frontend gate (scenario 9).
- Invariants added for every scenario: a goal or set-aside pot is never a payday-plan destination, and the pooled
  spendable balance is exactly the counted current accounts.
