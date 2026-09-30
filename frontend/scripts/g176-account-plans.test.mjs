import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import UpcomingHeroCard from "../components/upcoming/UpcomingHeroCard.tsx";
import UpcomingAccountDetails from "../components/upcoming/UpcomingAccountDetails.tsx";
import UpcomingAccountsCard from "../components/upcoming/UpcomingAccountsCard.tsx";
import UpcomingPlanDetails from "../components/upcoming/UpcomingPlanDetails.tsx";
import { AllocationEditForm } from "../components/AllocationEditForm.tsx";
import { accountPlan, assessPlanOverlap, hasChosenPlanSource, plansFromApi, remaining } from "../lib/upcomingPlans.ts";
import { walkUpcomingAccounts } from "../lib/upcomingAccountWalk.ts";
import { cashflowFor, forecastFor, heroFor, plansFor } from "../app/design/g176-account-plans/fixtures.ts";

const end = Date.parse("2026-10-29T23:59:59Z");
const previewSource = readFileSync(new URL("../app/design/g176-account-plans/PreviewClient.tsx", import.meta.url), "utf8");
const flowSource = readFileSync(new URL("../components/upcoming/UpcomingDetailFlow.tsx", import.meta.url), "utf8");
assert.match(previewSource, /import UpcomingDetailFlow from "@\/components\/upcoming\/UpcomingDetailFlow"/);
assert.doesNotMatch(previewSource, /function (?:AccountContent|PaymentEditor|PlanEditor|PaymentContent)/, "The approved preview must not fork the shipped detail or edit UI");
for (const component of ["UpcomingAccountDetails", "UpcomingPlanDetails", "UpcomingRowDetails", "UpcomingEditForm", "AllocationEditForm", "PlannedEditForm", "GoalSourceForm"]) assert.match(flowSource, new RegExp("<" + component + "[ >]"));
const plans = plansFor("gap");
const gap = forecastFor("gap").accounts[0];
const renderDetails = (account, input = plans, status = "ready") => renderToStaticMarkup(React.createElement(UpcomingAccountDetails, { account, plans: input, plansStatus: status, periodLabel: "Through Thu 29 Oct", onPlan() {} }));

assert.deepEqual(accountPlan(gap, plans), { assigned: plans, unassigned: [], uncertain: false, allocationPence: 30000, goalPence: 6500, scheduledPence: 0, reservedPence: 36500, afterPayments: 33600, afterPlans: -2900, planGap: 2900 });
assert.equal(remaining(plans[0]), 30000, "Server remainder wins over display target and filled amount");
assert.equal(remaining({ ...plans[0], filledPence: 40000 }), 30000);
assert.equal(remaining({ ...plans[0], active: false }), 0);
assert.equal(accountPlan(gap, plans.map((plan) => ({ ...plan, active: false }))).reservedPence, 0);
const paused = renderToStaticMarkup(React.createElement(UpcomingPlanDetails, { plan: { ...plans[0], active: false } }));
assert.match(paused, /Not reserved in this period/);
assert.doesNotMatch(paused, /Still to set aside/);
const overfilled = renderToStaticMarkup(React.createElement(UpcomingPlanDetails, { plan: { ...plans[0], filledPence: 40000, remainingPence: 0 } }));
assert.match(overfilled, /£40.*above the target/);
const details = renderDetails(gap);
for (const text of ["−£29", "£336", "−£300", "−£65", "more needed for plans", "Payments are covered"]) assert.match(details, new RegExp(text));
assert.doesNotMatch(details, /needed for payments|bg-rose-500/);

const moved = plans.map((plan) => ({ ...plan, sourceId: plan.id === "round-ups" ? "barclays" : null, evidence: plan.id === "round-ups" ? "chosen" : "unknown" }));
assert.deepEqual(accountPlan(gap, moved).assigned, []);
assert.deepEqual(accountPlan(forecastFor("gap").accounts[1], moved).assigned.map((plan) => plan.id), ["round-ups"]);
assert.equal(accountPlan(gap, plans.map((plan) => ({ ...plan, sourceId: null, evidence: "unknown" }))).reservedPence, 0);
const sameDestination = plans.map((plan) => ({ ...plan, destinationIds: ["shared"] }));
assert.equal(accountPlan(gap, sameDestination).reservedPence, 36500);
assert.equal(accountPlan(gap, assessPlanOverlap(sameDestination, cashflowFor("gap"), end)).uncertain, true, "Shared destination plans are not collapsed");

const overlap = assessPlanOverlap(plansFor("overlap"), cashflowFor("overlap"), end);
assert.ok(overlap.some((plan) => plan.overlapUncertain));
assert.equal(accountPlan(gap, overlap).afterPlans, null, "Possible scheduled transfer overlap makes total unknown");
assert.match(renderDetails(gap, overlap), /Calculation needs checking/);

const suggested = plansFor("suggested");
assert.ok(suggested.every((plan) => !hasChosenPlanSource(plan)), "Recent transfers are suggestions, not chosen sources");
assert.equal(accountPlan(gap, suggested).reservedPence, 0, "Suggested sources do not change account arithmetic");
assert.equal(accountPlan(gap, suggested).afterPlans, accountPlan(gap, []).afterPlans);
assert.deepEqual(accountPlan(gap, suggested).unassigned.map((plan) => plan.id), ["round-ups", "holiday"]);
const suggestedDetails = renderDetails(gap, suggested);
const suggestedCard = renderToStaticMarkup(React.createElement(UpcomingAccountsCard, { accounts: forecastFor("suggested").accounts, plans: suggested, periodLabel: "Through Thu 29 Oct", onOpen() {} }));
assert.doesNotMatch(suggestedDetails, /−£300|After payments and plans/, "Suggested allocation never leaks into the account ledger");
assert.match(suggestedDetails, /Suggested/);
assert.match(suggestedCard, /By account/);
assert.doesNotMatch(suggestedCard, /after plans|−£300/i, "Suggested allocation never leaks into the account card");
const confirmedSuggested = suggested.map((plan) => plan.id === "round-ups" ? { ...plan, evidence: "chosen" } : plan);
assert.equal(accountPlan(gap, confirmedSuggested).reservedPence, 30000, "Saving a selected suggestion changes that allocation to chosen account working");
assert.equal(accountPlan(gap, confirmedSuggested).afterPlans, 3600);
assert.deepEqual(accountPlan(gap, confirmedSuggested).unassigned.map((plan) => plan.id), ["holiday"]);
const suggestedOverlap = assessPlanOverlap([{ ...suggested[0], destinationIds: ["shared"] }, { ...plansFor("gap")[1], destinationIds: ["shared"] }], cashflowFor("gap"), end);
assert.equal(suggestedOverlap[1].overlapUncertain, false, "A suggestion cannot poison overlap checks for a chosen goal");
const clearedSuggested = confirmedSuggested.map((plan) => plan.id === "round-ups" ? { ...plan, sourceId: null, evidence: "unknown" } : plan);
assert.equal(accountPlan(gap, clearedSuggested).reservedPence, 0, "Clearing a source remains unknown rather than retaining prior account arithmetic");

const roundedAmountForm = renderToStaticMarkup(React.createElement(AllocationEditForm, {
  allocation: { id: "rounded", name: "Rounded allocation", amount_per_period: 33.333, fill_account_id: "challenge", source_account_id: null, match_type: "description_contains", match_value: "ROUND", fill_display_name: "Rounded allocation", effective_from: "2026-10-01", recurrence: "every_period", completed: false, pending: false, active: true, filled_this_period: 0, remaining: 33.333, period_start: "2026-10-01", period_end: "2026-10-29" },
  accounts: [{ id: "challenge", provider: "Monzo", name: "Challenge pot", type: "saving", subtype: "saving", currency: "GBP", balance: 60, status: "active", manual: false }], periodStart: new Date("2026-10-01T12:00:00Z"), onCancel() {}, onSaved() {}, onDeleted() {},
}));
assert.match(roundedAmountForm, /value="33\.33"/, "The initial amount honours the input's two-decimal step");

const missing = forecastFor("missing").accounts[0];
assert.equal(accountPlan(missing, plans).afterPayments, null);
assert.equal(accountPlan(missing, plans).afterPlans, null);
assert.match(renderDetails(missing), /Balance needs checking/);
assert.match(renderDetails(gap, [], "ready"), /After payments/);
assert.doesNotMatch(renderDetails(gap, [], "ready"), /After payments and plans/);

const apiPlans = plansFromApi([{ id: "server", record_id: "r", kind: "allocation", name: "Server allocation", destination: "Pot", destination_account_ids: ["pot"], source_account_id: "monzo", source_basis: "chosen", period_amount: 360, filled_amount: 60, remaining: 299.99, active: true }]);
assert.equal(remaining(apiPlans[0]), 29999, "API remaining is rounded to exact pennies");
const emptyCashflow = { upcoming_bills: [], upcoming_income: [], internal_inflows: [] };
const planOnly = walkUpcomingAccounts(emptyCashflow, end, [{ id: "monzo", bank: "Monzo", name: "Everyday", balance: 348 }]);
assert.equal(planOnly.accounts[0].closing, 348);
const namedCredit = { name: "Salary", amount: 100, account_id: "monzo", expected_date: "2026-10-02", days_away: 1 };
const withCredit = walkUpcomingAccounts({ ...emptyCashflow, upcoming_income: [namedCredit] }, end, [{ id: "monzo", bank: "Monzo", name: "Everyday", balance: 348 }]);
assert.equal(withCredit.accounts[0].closing, 448);
assert.equal(forecastFor("gap").coverage.size, 2, "Plan-source enrichment does not alter original bill coverage maps");

const heroWithoutGoal = heroFor("gap", plans.filter((plan) => plan.kind === "allocation"));
assert.deepEqual(heroFor("gap", plans), heroWithoutGoal, "Goal changes do not change the existing hero equation");
const hero = renderToStaticMarkup(React.createElement(UpcomingHeroCard, { isCalendarMonth: false, daysToPayday: 30, paydayLabel: "Fri 30 Oct", spendableNow: heroWithoutGoal.cash / 100, runwayIncomeTotal: 0, runwayBillsTotal: heroWithoutGoal.bills / 100, allocationsRemainingTotal: heroWithoutGoal.allocations / 100, savingsNow: 1250, runway: heroWithoutGoal.runway / 100, runwayStatus: "left" }));
assert.match(hero, /Projected balance/);
console.log("G176 approved account plan semantics passed");
