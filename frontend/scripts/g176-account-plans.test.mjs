import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import UpcomingHeroCard from "../components/upcoming/UpcomingHeroCard.tsx";
import AccountContent, { PlanContent } from "../app/design/g176-account-plans/AccountContent.tsx";
import { accountPlan, forecastFor, heroFor, plansFor, remaining } from "../app/design/g176-account-plans/fixtures.ts";

const renderAccount = (scenario, variant, account = forecastFor(scenario).accounts[0], plans = plansFor(scenario)) =>
  renderToStaticMarkup(React.createElement(AccountContent, { account, plans, variant, onPlan() {} }));

// The gap fixture is cash £348 - bills £12 = £336. The allocation has £300
// left and the goal contribution is £65, so the separate plan view is −£29.
const gap = forecastFor("gap").accounts[0];
const plans = plansFor("gap");
assert.deepEqual(accountPlan(gap, plans), {
  assigned: plans,
  unassigned: [],
  allocationPence: 30000,
  goalPence: 6500,
  reservedPence: 36500,
  afterPayments: 33600,
  afterPlans: -2900,
  planGap: 2900,
});
for (const variant of ["a", "b"]) {
  const html = renderAccount("gap", variant);
  assert.match(html, /−£29/);
  assert.match(html, /£336/);
  assert.match(html, /−£300/);
  assert.match(html, /−£65/);
  assert.match(html, /more needed for plans/);
  assert.match(html, /Payments are covered/);
  assert.doesNotMatch(html, /needed for payments/);
  assert.match(html, /bg-amber-500/);
  assert.doesNotMatch(html, /bg-rose-500/);
}

// Account payment coverage remains independent from voluntary plan funding.
const covered = forecastFor("covered").accounts[0];
assert.equal(covered.closing, 608);
assert.equal(accountPlan(covered, plans).afterPayments, 60800);
assert.equal(forecastFor("covered").accounts[0].opening, 620);
assert.match(renderAccount("covered", "a"), /£243/);

// Unknown sources do not deduct from either account, and no destination or
// provider inference assigns a plan. Independent plans remain independent.
const unassigned = plansFor("unassigned");
assert.equal(accountPlan(gap, unassigned).assigned.length, 0);
assert.equal(accountPlan(gap, unassigned).reservedPence, 0);
assert.match(renderAccount("unassigned", "b"), /Paying accounts need linking/);
const moved = unassigned.map((plan) => ({ ...plan, sourceId: plan.id === "round-ups" ? "barclays" : null, evidence: plan.id === "round-ups" ? "chosen" : "unknown" }));
assert.deepEqual(accountPlan(gap, moved).assigned.map((plan) => plan.id), []);
assert.deepEqual(accountPlan(forecastFor("gap").accounts[1], moved).assigned.map((plan) => plan.id), ["round-ups"]);
assert.equal(accountPlan(forecastFor("gap").accounts[1], moved).afterPlans, 58400);
const sameDestination = plans.map((plan) => ({ ...plan, destination: "Shared pot" }));
assert.equal(accountPlan(gap, sameDestination).assigned.length, 2);
assert.equal(accountPlan(gap, sameDestination).reservedPence, 36500, "Sharing a destination cannot prove two independent reserves duplicate one another");
assert.equal(remaining({ ...plans[0], filledPence: 40000 }), 0);
assert.equal(remaining({ ...plans[0], active: false }), 0);
assert.equal(accountPlan(gap, plans.map((plan) => ({ ...plan, active: false }))).reservedPence, 0);
assert.equal(accountPlan(gap, [{ ...plans[0], evidence: "unknown" }]).reservedPence, 0, "An unproven source id is not enough");
const billGap = forecastFor("billgap").accounts[0];
assert.equal(billGap.shortfall, 6);
assert.equal(accountPlan(billGap, plans).planGap, 36500, "Bill gap stays separate from the unfunded plans");
assert.match(renderAccount("billgap", "a"), /bg-rose-500/);

// Missing balances and empty plans stay honest.
assert.equal(accountPlan(forecastFor("missing").accounts[0], plans).afterPayments, null);
assert.match(renderAccount("missing", "a"), /Balance needs checking/);
assert.equal(accountPlan(gap, plansFor("empty")).reservedPence, 0);
assert.match(renderAccount("empty", "b"), /After payments/);
assert.doesNotMatch(renderAccount("empty", "b"), /After payments and plans/);

// The hero keeps its existing allocation-only equation. Adding a goal does
// not alter the hero's reserve, while the account view includes the goal.
const heroWithoutGoal = heroFor("gap", plans.filter((plan) => plan.kind === "allocation"));
const heroWithGoal = heroFor("gap", plans);
assert.deepEqual(heroWithGoal, heroWithoutGoal);
assert.deepEqual(heroWithGoal, { cash: 126800, bills: 4800, allocations: 30000, runway: 92000 });
assert.equal(heroFor("missing", plans), null);
const hero = renderToStaticMarkup(React.createElement(UpcomingHeroCard, {
  isCalendarMonth: false, daysToPayday: 30, paydayLabel: "Fri 30 Oct",
  spendableNow: heroWithGoal.cash / 100, runwayIncomeTotal: 0,
  runwayBillsTotal: heroWithGoal.bills / 100, allocationsRemainingTotal: heroWithGoal.allocations / 100,
  savingsNow: 1250, runway: heroWithGoal.runway / 100, runwayStatus: "left",
}));
assert.match(hero, /Available now/);
assert.match(hero, /Still to set aside/);
assert.match(hero, /Projected balance/);

const goal = plans.find((plan) => plan.kind === "goal");
const allocation = plans.find((plan) => plan.kind === "allocation");
const goalHtml = renderToStaticMarkup(React.createElement(PlanContent, { plan: goal, accountName: "Everyday account" }));
assert.match(goalHtml, /This period only/);
assert.match(goalHtml, /not your whole goal target/);
assert.doesNotMatch(goalHtml, /£65 target/);
const allocationHtml = renderToStaticMarkup(React.createElement(PlanContent, { plan: allocation, accountName: "Everyday account" }));
assert.match(allocationHtml, /Already set aside/);
assert.match(allocationHtml, /Still to set aside/);
assert.equal(remaining(allocation), 30000);
console.log("G176 account plans, account-only funding, variants and hero invariants passed");
