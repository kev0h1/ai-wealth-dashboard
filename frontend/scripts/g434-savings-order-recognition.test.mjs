// G434: recognition of an own-savings standing order mirrors the backend
// `is_savings_order`: a learned own destination that is not spendable; with none
// learned, a Savings or Investment category (the user's "Savings or investments"
// choice, or the engine's) or the engine's own-savings-held-elsewhere stamp.
// Once recognised, the server's savings_at_risk fact keeps the gap amber and out
// of the payment shortfall (reconcileWithServerPosition, accountPaymentGap).
import assert from "node:assert/strict";
import { accountPaymentGap, positionsFromToday, reconcileWithServerPosition } from "../lib/upcomingAccounts.ts";
import { statusFor } from "../lib/upcomingAccountStatus.ts";
import { isSavingsOrder } from "../lib/cardRepayment.ts";

const base = { kind: "movement", dest_account_id: null, dest_account_spendable: null, category: "Savings" };
assert.equal(isSavingsOrder(base), true, "Savings category with no learned destination");
assert.equal(isSavingsOrder({ ...base, category: "Investment" }), true, "Investment filed by the user or the engine");
assert.equal(isSavingsOrder({ ...base, category: "Transfer" }), false);
assert.equal(isSavingsOrder({ ...base, category: "Transfer", own_savings_elsewhere: true }), true, "recognised from wording plus own-money evidence");
assert.equal(isSavingsOrder({ ...base, category: "Transfer", own_savings_elsewhere: false }), false);
assert.equal(isSavingsOrder({ ...base, is_card_repayment: true }), false);
assert.equal(isSavingsOrder({ ...base, kind: "commitment" }), false);
assert.equal(isSavingsOrder({ ...base, category: "Transfer", dest_account_id: "sav", dest_account_spendable: false }), true);
assert.equal(isSavingsOrder({ ...base, dest_account_id: "cur", dest_account_spendable: true }), false);

// The production shape: a saver the bank never shares. The server recognised it, so the 150 gap is savings at risk.
const walk = {
  id: "acc-a", bank: "chase", name: "Current A", opening: 150, income: 0, transfersIn: 0, outgoing: 300, closing: -150, shortfall: 150,
  status: "unfunded", firstShortDate: "2026-11-26", hasUnassignedIncome: false,
  events: [{ id: "sto", name: "Regular Saver", date: "2026-11-26", kind: "movement", amount: -300, after: -150 }],
};
const entry = { short: true, headroom: -160, spend_from_headroom: 10, uncertain: false, plans_reserved: 0, after_payments: -150, low_point: -150, after_payments_and_plans: -150, low_point_and_plans: -150,
  savings_at_risk: { amount: 150, covered: 160, no_cover: false, note: "Savings at risk. A suggested move from Current B would cover it. Nothing has been moved.", orders: [{ name: "STO", label: "Regular Saver", amount: 300, expected_date: "2026-11-26", to_name: "Savings" }] } };
const position = positionsFromToday({ "acc-a": entry }, [{ id: "acc-a", type: "BANK", subtype: "TRANSACTION" }])["acc-a"];
const shown = reconcileWithServerPosition(walk, position);
assert.equal(shown.status, "unfunded");
assert.equal(accountPaymentGap(shown), null, "no payment gap");
assert.equal(statusFor(shown, []).signal, "move", "amber, never red");

console.log("g434 savings order recognition ok");
