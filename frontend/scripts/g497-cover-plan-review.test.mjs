import assert from "node:assert/strict";
import React, { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { BalancesHiddenContext } from "../lib/balancesHidden.tsx";
import { firstLastResortReview, lastResortReviewHref, lastResortReviewText } from "../lib/coverNarrative.ts";
import { positionsFromToday } from "../lib/upcomingAccounts.ts";
import { MoveCard } from "../components/HomeBrief.tsx";
import UpcomingAccountDetails from "../components/upcoming/UpcomingAccountDetails.tsx";

const text = (markup) => markup.replace(/<[^>]+>/g, "").replace(/&amp;/g, "&");

const suggestion = {
  gap: 80,
  total_frees: 25,
  covers_gap: false,
  sentence: "If you still need it, reviewing your Home repairs goal could free up to £25.",
  options: [{
    plan_id: "goal:goal-1",
    record_id: "goal-1",
    kind: "goal",
    name: "Home repairs",
    remaining: 25,
    frees: 25,
    covers_gap: false,
  }],
};

const review = firstLastResortReview(suggestion);
assert.deepEqual(review, { planId: "goal:goal-1", recordId: "goal-1", kind: "goal", name: "Home repairs", frees: 25 });
assert.equal(lastResortReviewHref(review), "/planning?goal=goal-1");
assert.equal(lastResortReviewText(review), "Home repairs goal could free up to £25.");
assert.equal(firstLastResortReview({ ...suggestion, options: [{ ...suggestion.options[0], plan_id: "allocation:goal-1" }] }), null, "an inconsistent plan id keeps the old fallback");
assert.equal(firstLastResortReview({ ...suggestion, options: [{ ...suggestion.options[0], frees: 0 }] }), null, "a non-positive release is not a recommendation");
assert.equal(firstLastResortReview({ ...suggestion, options: [{ ...suggestion.options[0], frees: 26 }] }), null, "a release larger than the server option is not shown");

const accountEntry = {
  short: true,
  headroom: -80,
  after_payments: -80,
  low_point: -80,
  plans_reserved: 25,
  after_payments_and_plans: -105,
  low_point_and_plans: -105,
  uncertain: false,
  last_resort: suggestion,
};
const [position] = Object.values(positionsFromToday({ account: accountEntry }, [{ id: "account", type: "BANK", subtype: "TRANSACTION" }]));
assert.deepEqual(position.lastResort, suggestion, "the account sheet receives the server payload unchanged");

const noSourceMove = {
  id: "move:no-source",
  type: "move",
  headline: "Payments need more money",
  body: "No covering move is available.",
  action: { label: "See in Upcoming", route: "/upcoming" },
  estimated: false,
  plan_dest: { account_id: "account", name: "Bills", provider: "Monzo", balance: 20, needs_total: 100, needs_by: "14 Dec", bills: [], is_overdraft: false },
  last_resort: suggestion,
};
const home = renderToStaticMarkup(h(MoveCard, { item: noSourceMove, hideNetWorth: false, maskAmounts: text => text }));
assert.match(home, /data-last-resort-plan="goal:goal-1"/);
assert.match(text(home), /Home repairs goal could free up to £25\./);
assert.match(home, /href="\/planning\?goal=goal-1"/);
const homeFallback = renderToStaticMarkup(h(MoveCard, { item: { ...noSourceMove, last_resort: { ...suggestion, options: [{ ...suggestion.options[0], record_id: "" }] } }, hideNetWorth: false, maskAmounts: text => text }));
assert.doesNotMatch(homeFallback, /data-last-resort/);
const malformedMixedSource = renderToStaticMarkup(h(MoveCard, { item: { ...noSourceMove, plan_dest: undefined, move_map: { from: { provider: "Monzo", name: "Everyday", source_kind: "current" } }, amount: 25 }, hideNetWorth: false, maskAmounts: text => text }));
assert.doesNotMatch(malformedMixedSource, /data-last-resort/, "a source leg without a destination cannot present a plan-release suggestion");

const plan = {
  id: "goal:goal-1", recordId: "goal-1", kind: "goal", name: "Home repairs", destination: "Savings", destinationIds: [], sourceId: "account", evidence: "chosen",
  periodPence: 2500, filledPence: 0, remainingPence: 2500, active: true,
};
const account = {
  id: "account", bank: "Monzo", name: "Bills", opening: 20, income: 0, transfersIn: 0, outgoing: 100,
  closing: -80, shortfall: 80, status: "short", firstShortDate: null, hasUnassignedIncome: false, events: [], position,
};
const sheet = (hidden) => renderToStaticMarkup(h(BalancesHiddenContext.Provider, { value: hidden }, h(UpcomingAccountDetails, {
  account, periodLabel: "Payments through Sun 14 Dec", plans: [plan], plansStatus: "ready", onPlan() {},
})));
assert.match(sheet(false), /data-last-resort-plan="goal:goal-1"/);
assert.match(text(sheet(false)), /Home repairs goal could free up to £25\./);
assert.doesNotMatch(sheet(false), /data-uncovered-options/, "structured evidence replaces the generic fallback");
assert.match(text(sheet(true)), /£••••/, "the last-resort amount respects balance masking");

console.log("G497 cover-plan review links passed.");
