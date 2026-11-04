import assert from "node:assert/strict";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MoveCard } from "../components/HomeBrief.tsx";
import SpendFromAccountList from "../components/SpendFromAccountList.tsx";
import { bestSpendAccount, spendFromTreatmentPlan } from "../lib/spendFromAccount.ts";
import { approvedSpendFromTreatment } from "../components/SafeToSpendCard.tsx";
import { BalancesHiddenContext } from "../lib/balancesHidden.tsx";

const account = (id, provider) => ({ id, provider, name: `${provider} Current`, type: "BANK", subtype: "TRANSACTION", currency: "GBP", balance: 1000, status: "connected" });
const accounts = [
  account("m", "monzo"), account("b", "barclays"), account("n", "natwest"),
  account("h", "hsbc"), account("r", "revolut"), account("s", "starling"),
];
// Allocation order deliberately follows the account/pinned display order, not
// the amounts. Presentation may be trimmed, but the engine allocation remains
// all six amounts and must still reconcile exactly.
const amounts = [14.10, 312.29, 11.10, 115.65, 32.03, 9.04];
const eligibility = Object.fromEntries(accounts.map((a, i) => [a.id, { headroom: 1000, short: false, spend_from_headroom: amounts[i], allocation_order: i, allocation_unassigned: 0 }]));
const result = bestSpendAccount(eligibility, accounts);
const plan = spendFromTreatmentPlan(result, () => true, 494.21);
assert.equal(plan.entries.length, 6, "all underlying allocations remain available to the engine");
assert.equal(Math.round(plan.entries.reduce((sum, a) => sum + a.headroom, 0) * 100), 49421);
assert.deepEqual(plan.entries.map(a => a.accountId), ["b", "h", "r", "m", "n", "s"], "engine ranking is by allocation amount, not account display order");

const move = {
  id: "plan-monzo", type: "move", headline: "A move that would cover this", amount: 110, covered: true, sources_safe: true,
  moves: [{ amount: 110, headline: "Move £110", move_map: { from: { account_id: "b", name: "Barclays", provider: "barclays", balance: 1000 }, to: { account_id: "m", name: "Monzo", provider: "monzo", balance: 50 } } }],
  plan_dest: { account_id: "m", name: "Monzo", provider: "monzo", balance: 50, needs_total: 150, needs_by: "", bills: [] },
  plan_shortfall: { shortfall: 100, estimated: false, paying_account: { account_id: "m", name: "Monzo", provider: "monzo" }, plans: [{ id: "travel", name: "Travel", remaining: 150, period_amount: 150, kind: "allocation" }] },
};
const renderMove = (item, hidden = false) => renderToStaticMarkup(h(BalancesHiddenContext.Provider, { value: hidden }, h(MoveCard, { item, hideNetWorth: hidden, maskAmounts: text => text, previewMode: true })));
let html = renderMove(move);
assert.ok(html.includes("£110") && html.includes("For plans this pay period"));
assert.ok(html.includes('href="/upcoming?plan=allocation%3Atravel"') && !html.includes("edit=1"));
assert.ok(html.includes('aria-label="View plan: Travel"') && html.includes("min-h-11"));
assert.ok(html.includes(">View plan<"));
const viewPlanTag = html.match(/<a[^>]+aria-label="View plan: Travel"[^>]*>/)?.[0] ?? "";
assert.ok(!/\bpx-\d/.test(viewPlanTag), "the cover-card View plan link has no horizontal inset before its text");
assert.ok(!html.includes("Move ready to review"));
const goalMove = { ...move, plan_shortfall: { ...move.plan_shortfall, plans: [{ ...move.plan_shortfall.plans[0], id: "home", name: "Home deposit", kind: "goal" }] } };
assert.ok(renderMove(goalMove).includes('href="/planning?goal=home"') && !renderMove(goalMove).includes("edit=1"));
assert.ok(!/£\d/.test(renderMove(move, true)), "plan move figures are masked");
assert.ok(renderMove({ ...move, moves: [], amount: 0, covered: false }).includes("View plan"), "plan details remain available without a safe move");

const list = renderToStaticMarkup(h(SpendFromAccountList, { entries: plan.entries, pool: 600, unallocated: 102, amount: n => `£${n.toFixed(2)}`, coverMoveVisible: false, onLogoError() {}, kind: "bank-rail" }));
const renderedIds = [...list.matchAll(/data-spend-from-account="([^"]+)"/g)].map(match => match[1]);
assert.deepEqual(renderedIds, ["b", "h"], "Spend from presents the two largest allocations, not pinned/display order");
assert.equal(Math.round(plan.entries.filter(entry => renderedIds.includes(entry.accountId)).reduce((sum, entry) => sum + entry.headroom, 0) * 100), 42794, "the rendered Barclays and HSBC pair is £427.94, not the first displayed Monzo and Barclays pair");
assert.ok(list.includes("£312.29") && list.includes("£115.65") && !list.includes("£14.10"));
assert.ok(list.includes("Showing your top 2. See them all in Your accounts.") && !list.includes("make up the rest"), "a partial or unallocated forecast does not claim omitted accounts reconcile");
assert.ok(!list.includes("after suggested move"));
assert.ok(list.includes("£102.00") && list.includes("cannot yet be safely allocated"));
assert.ok(!list.includes("These amounts add up to your Left to spend"));
const completeList = renderToStaticMarkup(h(SpendFromAccountList, { entries: plan.entries, pool: 494.21, unallocated: 0, amount: n => `£${n.toFixed(2)}`, coverMoveVisible: false, onLogoError() {}, kind: "bank-rail" }));
assert.ok(completeList.includes("Showing your top 2. Your other accounts make up the rest. See them all in Your accounts."));
const twoAccountList = renderToStaticMarkup(h(SpendFromAccountList, { entries: plan.entries.slice(0, 2), pool: 427.94, unallocated: 0, amount: n => `£${n.toFixed(2)}`, coverMoveVisible: false, onLogoError() {}, kind: "bank-rail" }));
assert.ok(twoAccountList.includes("Showing your top 2. See them all in Your accounts.") && !twoAccountList.includes("make up the rest"));
const singleAccountList = renderToStaticMarkup(h(SpendFromAccountList, { entries: plan.entries.slice(0, 1), pool: 312.29, unallocated: 0, amount: n => `£${n.toFixed(2)}`, coverMoveVisible: false, onLogoError() {}, kind: "bank-rail" }));
assert.ok(singleAccountList.includes("Showing your top account. See it in Your accounts.") && !singleAccountList.includes("top 2"));
const emptyPlan = spendFromTreatmentPlan(bestSpendAccount({ b: { headroom: 0, short: true, spend_from_headroom: 0, allocation_unassigned: 100 } }, accounts), () => true, 100);
const empty = approvedSpendFromTreatment(emptyPlan, n => `£${n}`, false, () => {});
assert.ok(renderToStaticMarkup(empty.body).includes("£100"), "a wholly unallocated forecast is explained too");
console.log("G414 shortfall and allocation checks passed.");
