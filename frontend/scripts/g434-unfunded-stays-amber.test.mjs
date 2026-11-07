// G434: an own-account move that goes short with no payment bouncing is the
// amber "unfunded" reading, never a red payment shortfall, even when the
// server's payment figures are negative and it knows no savings fact (the
// destination was never learned). A deeper server deficit than the moves
// explain, or a real bill bouncing, is still short. A series carrying the
// built-in Savings category is a savings order with no learned destination.
import assert from "node:assert/strict";
import { accountPaymentGap, positionsFromToday, reconcileWithServerPosition } from "../lib/upcomingAccounts.ts";
import { statusFor } from "../lib/upcomingAccountStatus.ts";
import { isSavingsOrder } from "../lib/cardRepayment.ts";

const eligibility = (extra) => ({
  "acc-a": { short: true, headroom: -160, spend_from_headroom: 10, uncertain: false, plans_reserved: 0, after_payments: -150, low_point: -150, after_payments_and_plans: -150, low_point_and_plans: -150, ...extra },
});
const meta = [{ id: "acc-a", type: "BANK", subtype: "TRANSACTION" }];
const walk = {
  id: "acc-a", bank: "chase", name: "Current A", opening: 150, income: 0, transfersIn: 0, outgoing: 300, closing: -150, shortfall: 150,
  status: "unfunded", firstShortDate: "2026-11-26", hasUnassignedIncome: false,
  events: [{ id: "sto", name: "Regular Saver", date: "2026-11-26", kind: "movement", amount: -300, after: -150 }],
};
const position = (extra) => positionsFromToday(eligibility(extra), meta)["acc-a"];

// 1. Server negative, no savings fact, walk saw only a move: amber, no payment gap.
const kept = reconcileWithServerPosition(walk, position({}));
assert.equal(kept.status, "unfunded", "a move-only deficit is never promoted to short");
assert.equal(kept.shortfall, 150);
assert.equal(accountPaymentGap(kept), null, "a move-only deficit is not a payment gap");
assert.equal(statusFor(kept, []).signal, "move");
assert.notEqual(statusFor(kept, []).signal, "risk", "never red");

// 2. The server sees a deeper deficit than the moves explain: short, red stays earned.
const deeper = reconcileWithServerPosition(walk, position({ after_payments: -260, low_point: -260, after_payments_and_plans: -260, low_point_and_plans: -260 }));
assert.equal(deeper.status, "short");
assert.equal(accountPaymentGap(deeper), 260);

// 3. A real bill bouncing on the client walk is short.
const bill = reconcileWithServerPosition({ ...walk, status: "short", shortfall: 150 }, position({}));
assert.equal(bill.status, "short");

// 4. Covered stays covered.
const covered = reconcileWithServerPosition(walk, position({ after_payments: 20, low_point: 20, after_payments_and_plans: 20, low_point_and_plans: 20 }));
assert.equal(covered.status, "covered");

// 5. Recognition mirrors the backend.
const base = { kind: "movement", dest_account_id: null, dest_account_spendable: null, category: "Savings" };
assert.equal(isSavingsOrder(base), true, "Savings category with no learned destination");
assert.equal(isSavingsOrder({ ...base, category: "Transfer" }), false);
assert.equal(isSavingsOrder({ ...base, category: "Investment" }), false);
assert.equal(isSavingsOrder({ ...base, is_card_repayment: true }), false);
assert.equal(isSavingsOrder({ ...base, kind: "commitment" }), false);
assert.equal(isSavingsOrder({ ...base, category: "Transfer", dest_account_id: "sav", dest_account_spendable: false }), true);
assert.equal(isSavingsOrder({ ...base, dest_account_id: "cur", dest_account_spendable: true }), false);

console.log("g434 unfunded stays amber ok");
