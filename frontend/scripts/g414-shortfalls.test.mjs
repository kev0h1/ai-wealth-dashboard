import assert from "node:assert/strict";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MoveCard } from "../components/HomeBrief.tsx";
import SpendFromAccountList from "../components/SpendFromAccountList.tsx";
import { bestSpendAccount, spendFromTreatmentPlan } from "../lib/spendFromAccount.ts";
import { approvedSpendFromTreatment } from "../components/SafeToSpendCard.tsx";
import { BalancesHiddenContext } from "../lib/balancesHidden.tsx";

const account = (id, provider) => ({ id, provider, name: `${provider} Current`, type: "BANK", subtype: "TRANSACTION", currency: "GBP", balance: 1000, status: "connected" });
const accounts = [account("b", "barclays"), account("m", "monzo"), account("n", "natwest"), account("s", "starling")];
const eligibility = Object.fromEntries(accounts.map((a, i) => [a.id, { headroom: 1000, short: false, spend_from_headroom: [349.25, 116.15, 32.1, 0.5][i], allocation_order: i, allocation_unassigned: 0 }]));
const result = bestSpendAccount(eligibility, accounts);
const plan = spendFromTreatmentPlan(result, () => true, 498);
assert.equal(plan.entries.length, 4, "all allocated accounts are shown, including 50p");
assert.equal(Math.round(plan.entries.reduce((sum, a) => sum + a.headroom, 0) * 100), 49800);
assert.deepEqual(plan.entries.map(a => a.accountId), ["b", "m", "n", "s"]);

const move = {
  id: "plan-monzo", type: "move", headline: "A move that would cover this", amount: 110, covered: true, sources_safe: true,
  moves: [{ amount: 110, headline: "Move £110", move_map: { from: { account_id: "b", name: "Barclays", provider: "barclays", balance: 1000 }, to: { account_id: "m", name: "Monzo", provider: "monzo", balance: 50 } } }],
  plan_dest: { account_id: "m", name: "Monzo", provider: "monzo", balance: 50, needs_total: 150, needs_by: "", bills: [] },
  plan_shortfall: { shortfall: 100, estimated: false, paying_account: { account_id: "m", name: "Monzo", provider: "monzo" }, plans: [{ id: "travel", name: "Travel", remaining: 150, period_amount: 150, kind: "allocation" }] },
};
const renderMove = (item, hidden = false) => renderToStaticMarkup(h(BalancesHiddenContext.Provider, { value: hidden }, h(MoveCard, { item, hideNetWorth: hidden, maskAmounts: text => text, previewMode: true })));
let html = renderMove(move);
assert.ok(html.includes("£110") && html.includes("For plans this pay period"));
assert.ok(html.includes('href="/upcoming?plan=allocation%3Atravel&amp;edit=1"'));
assert.ok(html.includes('aria-label="Edit plan: Travel"') && html.includes("min-h-11"));
assert.ok(!html.includes("Move ready to review"));
const goalMove = { ...move, plan_shortfall: { ...move.plan_shortfall, plans: [{ ...move.plan_shortfall.plans[0], id: "home", name: "Home deposit", kind: "goal" }] } };
assert.ok(renderMove(goalMove).includes('href="/planning?goal=home&amp;edit=1"'));
assert.ok(!/£\d/.test(renderMove(move, true)), "plan move figures are masked");
assert.ok(renderMove({ ...move, moves: [], amount: 0, covered: false }).includes("Edit plan"), "editing remains available without a safe move");

const list = renderToStaticMarkup(h(SpendFromAccountList, { entries: plan.entries, pool: 600, unallocated: 102, amount: n => `£${n.toFixed(2)}`, coverMoveVisible: false, onLogoError() {}, kind: "bank-rail" }));
assert.ok(list.includes("£102.00") && list.includes("cannot yet be safely allocated"));
assert.ok(!list.includes("These amounts add up to your Left to spend"));
const emptyPlan = spendFromTreatmentPlan(bestSpendAccount({ b: { headroom: 0, short: true, spend_from_headroom: 0, allocation_unassigned: 100 } }, accounts), () => true, 100);
const empty = approvedSpendFromTreatment(emptyPlan, n => `£${n}`, false, () => {});
assert.ok(renderToStaticMarkup(empty.body).includes("£100"), "a wholly unallocated forecast is explained too");
console.log("G414 shortfall and allocation checks passed.");
