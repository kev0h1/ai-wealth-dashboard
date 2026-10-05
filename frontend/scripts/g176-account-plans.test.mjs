import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import UpcomingHeroCard from "../components/upcoming/UpcomingHeroCard.tsx";
import UpcomingAccountDetails from "../components/upcoming/UpcomingAccountDetails.tsx";
import UpcomingAccountsCard from "../components/upcoming/UpcomingAccountsCard.tsx";
import UpcomingPlanDetails from "../components/upcoming/UpcomingPlanDetails.tsx";
import UnlinkedGoalPlans from "../components/upcoming/UnlinkedGoalPlans.tsx";
import { AllocationEditForm } from "../components/AllocationEditForm.tsx";
import { UpcomingEditForm } from "../components/UpcomingEditForm.tsx";
import { accountPlan, assessPlanOverlap, hasChosenPlanSource, hasPlanSource, plansFromApi, remaining } from "../lib/upcomingPlans.ts";
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

assert.deepEqual(accountPlan(gap, plans), { assigned: plans, unassigned: [], estimated: false, uncertain: false, allocationPence: 30000, goalPence: 6500, scheduledPence: 0, reservedPence: 36500, afterPayments: 33600, afterPlans: -2900, planGap: 2900 });
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
assert.ok(suggested.every((plan) => !hasChosenPlanSource(plan)), "Historical evidence is never promoted to a manual choice");
assert.ok(hasPlanSource(suggested[0]));
assert.equal(accountPlan(gap, suggested).reservedPence, 30000, "Kevin's correction: include the remaining set-aside from a validated transfer-derived payer, visibly estimated");
assert.equal(accountPlan(gap, suggested).afterPlans, 3600);
assert.equal(accountPlan(gap, suggested).estimated, true);
assert.deepEqual(accountPlan(gap, suggested).unassigned.map((plan) => plan.id), ["holiday"]);
const suggestedDetails = renderDetails(gap, suggested);
const suggestedCard = renderToStaticMarkup(React.createElement(UpcomingAccountsCard, { accounts: forecastFor("suggested").accounts, plans: suggested, periodLabel: "Through Thu 29 Oct", onOpen() {} }));
assert.match(suggestedDetails, /−£300/);
assert.match(suggestedDetails, /After payments and plans · estimated/);
assert.match(suggestedDetails, /Allocations still to set aside · estimated/);
assert.match(suggestedDetails, /Paying account based on recent transfers/);
assert.doesNotMatch(suggestedDetails, /Paying accounts need linking/);
assert.match(suggestedCard, /By account/);
assert.match(suggestedCard, /£36\.00, left after plans, estimated/);
assert.match(suggestedCard, />Estimated</);
assert.doesNotMatch(suggestedCard, /Savings challenge|Summer break|paying account|<details/, "By account contains account rows only, not duplicate plans");
assert.equal((suggestedCard.match(/<button/g) ?? []).length, 2);
const unknownGoals = renderToStaticMarkup(React.createElement(UnlinkedGoalPlans, { plans: suggested, onPlan() {} }));
assert.match(unknownGoals, /Goals needing a paying account/);
assert.match(unknownGoals, /Summer break/);
assert.doesNotMatch(unknownGoals, /Savings challenge/);
assert.equal(renderToStaticMarkup(React.createElement(UnlinkedGoalPlans, { plans, onPlan() {} })), "", "Known goal payers do not produce a duplicate action list");
const pageSource = readFileSync(new URL("../app/planning/PlanningPage.tsx", import.meta.url), "utf8");
assert.equal((pageSource.match(/<UnlinkedGoalPlans /g) ?? []).length, 2, "Unknown goals stay reachable in both the empty and populated Upcoming page paths");
assert.match(previewSource, /<UnlinkedGoalPlans /, "The preview uses the same goal linking affordance");
assert.equal(accountPlan(forecastFor("gap").accounts[1], suggested).reservedPence, 0, "Do not deduct Monzo's allocation from another account");
const confirmedSuggested = suggested.map((plan) => plan.id === "round-ups" ? { ...plan, evidence: "chosen" } : plan);
assert.equal(accountPlan(gap, confirmedSuggested).reservedPence, 30000, "Explicit choice changes certainty, not the already included remainder");
assert.equal(accountPlan(gap, confirmedSuggested).afterPlans, 3600);
assert.equal(accountPlan(gap, confirmedSuggested).estimated, false);
assert.deepEqual(accountPlan(gap, confirmedSuggested).unassigned.map((plan) => plan.id), ["holiday"]);
const suggestedOverlap = assessPlanOverlap([{ ...suggested[0], destinationIds: ["shared"] }, { ...plansFor("gap")[1], destinationIds: ["shared"] }], cashflowFor("gap"), end);
assert.ok(suggestedOverlap.every((plan) => plan.overlapUncertain), "Any included derived source must participate in shared-pot overlap protection");
assert.equal(accountPlan(gap, suggestedOverlap).afterPlans, null);
assert.equal(accountPlan(gap, assessPlanOverlap(suggested, cashflowFor("overlap"), end)).afterPlans, null, "A scheduled transfer may already fund this inferred allocation, so do not deduct twice");
const clearedSuggested = confirmedSuggested.map((plan) => plan.id === "round-ups" ? { ...plan, sourceId: null, evidence: "unknown" } : plan);
assert.equal(accountPlan(gap, clearedSuggested).reservedPence, 0, "Clearing a source remains unknown rather than retaining prior account arithmetic");
assert.equal(accountPlan(gap, clearedSuggested).estimated, false);
assert.equal(accountPlan(gap, [{ ...suggested[0], sourceId: null }]).reservedPence, 0);
assert.equal(accountPlan(gap, [{ ...suggested[0], kind: "goal" }]).reservedPence, 0, "There is no goal-source inference contract");
assert.equal(accountPlan(gap, [{ ...suggested[0], active: false }]).reservedPence, 0);
assert.equal(accountPlan(gap, [{ ...suggested[0], remainingPence: 0 }]).estimated, false, "A fully filled allocation does not make the account figure estimated");
const unavailableDerived = accountPlan(gap, [{ ...suggested[0], amountUnavailable: true }]);
assert.equal(unavailableDerived.afterPlans, null);
assert.equal(unavailableDerived.uncertain, true);
const screenshotExample = { ...suggested[0], periodPence: 37660, filledPence: 6108, remainingPence: 31552 };
const screenshotAccount = { ...gap, opening: 312.46, outgoing: 7, closing: 305.46 };
assert.equal(accountPlan(screenshotAccount, [screenshotExample]).afterPlans, -1006, "£305.46 less £315.52 remaining equals −£10.06; the £61.08 already saved is not deducted again");
assert.match(renderDetails(screenshotAccount, [screenshotExample]), /£10\.06 more needed for plans · estimated/);
assert.doesNotMatch(renderDetails(screenshotAccount, [screenshotExample]), /Not assigned to an account|Paying accounts need linking/);
const inferredPlan = renderToStaticMarkup(React.createElement(UpcomingPlanDetails, { plan: suggested[0], accountName: "Monzo · Everyday account" }));
assert.match(inferredPlan, /Based on recent transfers/);
assert.match(inferredPlan, /included in this account’s estimate/);
assert.doesNotMatch(inferredPlan, /Suggested|Select it and save/);

for (const type of ["bill", "income"]) {
  const editor = renderToStaticMarkup(React.createElement(UpcomingEditForm, { item: { name: "Example", amount: 19.99, expected_date: "2026-10-01", type, edited: true }, onCancel() {}, onSaved() {}, onDismiss() {} }));
  assert.doesNotMatch(editor, /More options/);
  const disclosures = editor.match(/<details[\s\S]*?<\/details>/g) ?? [];
  assert.ok(disclosures.every((markup) => !/Skip this month|Not a bill|Not income|Reset to prediction/.test(markup)), "Prediction actions are not in any disclosure");
  assert.match(editor, new RegExp(type === "bill" ? "Skip this month" : "Not income"));
  if (type === "income") assert.doesNotMatch(editor, /Skip this month/);
  else assert.match(editor, /Not a bill/);
  assert.match(editor, /Reset to prediction/);
}

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

// G216: payment and income rows in the account sheet open the payment detail.
{
  const editable = renderToStaticMarkup(React.createElement(UpcomingAccountDetails, { account: gap, plans: [], plansStatus: "ready", periodLabel: "Through Thu 29 Oct", onEvent() {}, editableEventIds: new Set([gap.events[0].id]) }));
  const buttons = editable.match(/<button[^>]*data-flow-focus="event-[^"]*"[^>]*>/g) ?? [];
  assert.equal(buttons.length, 1, "Only editable events become buttons");
  assert.match(buttons[0], new RegExp('data-flow-focus="event-' + gap.events[0].id + '"'));
  assert.match(buttons[0], /min-h-11/, "44px target");
  assert.match(editable, /lucide-chevron-right/, "Chevron on the editable row");
  const staticOnly = renderToStaticMarkup(React.createElement(UpcomingAccountDetails, { account: gap, plans: [], plansStatus: "ready", periodLabel: "Through Thu 29 Oct" }));
  assert.doesNotMatch(staticOnly, /data-flow-focus="event-/, "No onEvent keeps events static");
  const everyEvent = renderToStaticMarkup(React.createElement(UpcomingAccountDetails, { account: gap, plans: [], plansStatus: "ready", periodLabel: "Through Thu 29 Oct", onEvent() {} }));
  assert.equal((everyEvent.match(/data-flow-focus="event-/g) ?? []).length, gap.events.length, "Without an allow-list every event is a button");
  assert.match(flowSource, /goTo\(\{ kind: "payment", id \}\)/, "Account view pushes a payment view onto the Back stack");
  assert.match(flowSource, /item\.source === event\.source/, "Events map to payments by their source cashflow item");
  assert.match(flowSource, /navigation\.returnTo\(isAccountView\)/, "A change from an account-opened payment returns straight to the account");
  assert.match(flowSource, /onDone=\{leavePayment\(navigation, navigation\.back\)\}/, "List-opened edits keep the one-step pop as the fallback");
  assert.match(flowSource, /request\.run\(payment\.skip, leavePayment\(navigation, navigation\.close\)/, "Skip returns to the account, or closes when opened from the list");
  assert.match(flowSource, /<ReturnToAccount navigation=\{navigation\} \/>/, "A dismissed payment's absent state steps back to the account");
  const sheetSource = readFileSync(new URL("../components/UpcomingFlowSheet.tsx", import.meta.url), "utf8");
  assert.match(sheetSource, /returnTo\(match: \(view: View\) => boolean\): boolean/);
  assert.match(readFileSync(new URL("../components/UpcomingEditForm.tsx", import.meta.url), "utf8"), /request\.run\(operation, onDone \?\? onCancel/, "UpcomingEditForm defaults to onCancel, so the list path is unchanged");
}
console.log("G176 approved account plan semantics passed");
