import assert from "node:assert/strict";
import { accountPlan, assessPlanOverlap, PLAN_OVERLAP_TOLERANCE } from "../lib/upcomingPlans.ts";
import { cashflowFor, forecastFor, plansFor } from "../app/design/g176-account-plans/fixtures.ts";

const end = Date.parse("2026-10-29T23:59:59Z");
const goal = { id: "japan", kind: "goal", name: "Japan", destination: "Japan pot", destinationIds: ["japan-pot"], sourceId: "barclays", evidence: "recent-transfers", periodPence: 8000, filledPence: 0, remainingPence: 8000, active: true };
const mv = (extra) => ({ name: "Move", amount: 80, expected_date: "2026-10-16", days_away: 8, kind: "movement", account_id: "barclays", dest_account_id: null, category: "Transfer", ...extra });
const flow = (...bills) => ({ upcoming_bills: bills });
const flagged = (bills, accounts = []) => assessPlanOverlap([goal], flow(...bills), end, accounts)[0].overlapUncertain;
assert.equal(PLAN_OVERLAP_TOLERANCE, 0.15);

// Kevin's case: Barclays card repayments, category Debt, no destination.
const plans = assessPlanOverlap(plansFor("cardrepay"), cashflowFor("cardrepay"), end);
assert.equal(plans[0].overlapUncertain, false);
const barclays = forecastFor("cardrepay").accounts.find((account) => account.id === "barclays");
const result = accountPlan(barclays, plans);
assert.equal(result.uncertain, false);
assert.notEqual(result.afterPlans, null, "The After payments and plans figure computes");
assert.equal(result.reservedPence, 8000);

assert.equal(flagged([mv({ dest_account_id: "japan-pot", amount: 500 })]), true, "Transfer to the plan pot");
assert.equal(flagged([mv({ amount: 80 })]), true, "Unknown destination, slice amount");
assert.equal(flagged([mv({ amount: 90 })]), true, "Within 15%");
assert.equal(flagged([mv({ amount: 423.62 })]), false, "Unknown destination, unrelated amount");
assert.equal(flagged([mv({ amount: 80, category: "Debt" })]), false, "Category Debt");
assert.equal(flagged([mv({ amount: 80, kind: "card_repayment" })]), false, "kind card_repayment");
assert.equal(flagged([mv({ amount: 80, dest_account_id: "amex" })], [{ id: "amex", type: "credit", subtype: "credit_card" }]), false, "Destination is a credit card");
assert.equal(flagged([mv({ amount: 80, dest_account_id: "other" })]), false, "Known destination that is not the plan's");
console.log("g235-plan-overlap ok");
