// Plain-Node test for lib/cashWalk.ts (G109) — same framework-free pattern
// as scripts/preferences-version.test.mjs et al: imports the REAL
// production module (the exact functions app/planning/PlanningPage.tsx
// imports for its runway hero and row-by-row ledger walk), not a
// hand-copied re-implementation.
//
// Run with:
//   node --no-warnings --experimental-strip-types scripts/cash-walk.test.mjs
// or:
//   npm run -s check:cash-walk
//
// Covers the G109 bug (a £180 Anthropic charge on the Amex dropped
// projected cash from £603 to £423 with no cash moving, then the separate
// Amex repayment from Barclays dropped it again) and the three-category
// pool-boundary rule it fixed:
//   - a charge on a card does NOT reduce cash (doesNotTouchCash === true)
//   - a payment TO a card DOES reduce cash (doesNotTouchCash === false)
//   - a movement between two pooled accounts does NOT reduce cash
//     (doesNotTouchCash === true, via isPooledNoOp)

import { isPooledNoOp, doesNotTouchCash } from "../lib/cashWalk.ts";

let failures = 0;

function check(label, actual, expected) {
  if (actual !== expected) {
    failures += 1;
    console.error(`FAIL: ${label} — expected ${expected}, got ${actual}`);
  } else {
    console.log(`PASS: ${label}`);
  }
}

// ── A bill sitting ON a credit card (the Anthropic-on-Amex case) ──────────
// A card charge is not itself a movement, but must still be excluded from
// the cash walk: no bank balance has changed yet, only a credit limit.
check(
  "a discretionary charge on a credit card does not touch cash",
  doesNotTouchCash({ kind: "discretionary", is_credit_card: true }),
  true,
);
check(
  "a commitment charge on a credit card does not touch cash",
  doesNotTouchCash({ kind: "commitment", is_credit_card: true }),
  true,
);

// ── A repayment TO that same card (the Barclays -> Amex standing order) ───
// The repayment bill's OWN account is the paying current account, not the
// card, so its own is_credit_card is false — it must keep reducing cash.
// Modelled as a "movement" bill whose destination is the card, which is
// never dest_account_spendable (a credit card is never spendable), so
// isPooledNoOp does not catch it either.
check(
  "a repayment to a credit card (movement, non-spendable/credit destination) still reduces cash",
  doesNotTouchCash({ kind: "movement", dest_account_spendable: null, is_credit_card: false }),
  false,
);
check(
  "a repayment to a credit card explicitly marked dest_account_spendable=false still reduces cash",
  doesNotTouchCash({ kind: "movement", dest_account_spendable: false, is_credit_card: false }),
  false,
);

// ── A movement between two pooled (spendable, non-credit) accounts ────────
// A traced standing order whose destination is inside the same spendable
// pool as its source is a pure no-op for the pooled total: one account's
// balance falls by exactly what another's rises, so the walk must not move.
check(
  "a movement to another pooled spendable account does not touch cash",
  doesNotTouchCash({ kind: "movement", dest_account_spendable: true, is_credit_card: false }),
  true,
);
check(
  "isPooledNoOp itself agrees for the same pooled movement",
  isPooledNoOp({ kind: "movement", dest_account_spendable: true }),
  true,
);

// ── Ordinary cases unaffected by G109 ──────────────────────────────────────
check(
  "an ordinary discretionary debit on a current account reduces cash",
  doesNotTouchCash({ kind: "discretionary", is_credit_card: false }),
  false,
);
check(
  "a movement to a savings pot (not pooled-spendable) still reduces cash",
  doesNotTouchCash({ kind: "movement", dest_account_spendable: false, is_credit_card: false }),
  false,
);
check(
  "an untraced movement (no destination info) still reduces cash",
  doesNotTouchCash({ kind: "movement", dest_account_spendable: undefined, is_credit_card: undefined }),
  false,
);
check(
  "income-shaped items (no kind/is_credit_card at all) do not spuriously get excluded",
  doesNotTouchCash({}),
  false,
);

if (failures > 0) {
  console.error(`\n${failures} failure(s).`);
  process.exit(1);
}
console.log("\nAll cash-walk (G109) checks passed.");
