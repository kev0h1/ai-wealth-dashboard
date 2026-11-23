// G489: the approved Upcoming plans fold keeps raw allocations and native
// plans together, while preserving the two real PlanningPage entry points.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import UpcomingPlansCard from "../components/upcoming/UpcomingPlansCard.tsx";
import { BalancesHiddenContext } from "../lib/balancesHidden.tsx";

const account = { id: "current", provider: "Monzo", name: "Everyday", balance: 100, type: "bank", subtype: "current", currency: "GBP", manual: false };
const allocation = (extra = {}) => ({ id: "a1", name: "Holiday", amount_per_period: 50, period_amount: 50, period_start: "2026-11-01", period_end: "2026-11-26", fill_account_id: "legacy", source_account_id: "current", match_type: "description_contains", match_value: "holiday", fill_display_name: "Holiday", effective_from: "2026-11-01", recurrence: "every_period", completed: false, pending: false, active: true, filled_this_period: 12, remaining: 38, ...extra });
const plan = (extra = {}) => ({ id: "g1", kind: "goal", name: "Emergency fund", destination: "Savings", sourceId: "current", evidence: "chosen", periodPence: 2000, filledPence: 0, remainingPence: 2000, active: true, ...extra });
const render = (allocations, plans, hidden = false) => renderToStaticMarkup(h(BalancesHiddenContext.Provider, { value: hidden }, h(UpcomingPlansCard, {
  allocations, allocationsError: false, plans, plansStatus: "ready", accounts: [account], onAdd() {}, onEditAllocation() {}, onPlan() {}, onRetryAllocations() {}, onRetryPlans() {},
})));
const text = (html) => html.replace(/<[^>]+>/g, "").replace(/&amp;/g, "&");

// Both populated groups are closed by default, but headers retain truthful counts and payer prompts.
const populated = render([allocation()], [plan({ sourceId: null, evidence: "unknown" })]);
assert.match(populated, /Set-asides/);
assert.match(populated, /1 set-aside/);
assert.match(populated, /Goals/);
assert.match(populated, /1 goal · 1 needs a paying account/);
assert.doesNotMatch(populated, /2 needs/);
assert.match(populated, /aria-expanded="false"/);
assert.match(populated, /hidden=""/);
assert.match(populated, /Choose paying account/);
assert.match(populated, /From Monzo · Everyday/);

// Empty ready groups are static, while a pending and a completed allocation remain in the hidden panel.
const mixed = render([allocation({ id: "pending", pending: true, remaining: 0 }), allocation({ id: "done", completed: true, remaining: 0, filled_this_period: 0 })], []);
assert.match(mixed, /Starts 1 Nov/);
assert.match(mixed, /Not reserved/);
assert.match(mixed, /Period ended/);
assert.match(mixed, /None yet/);
assert.match(mixed, /2 set-asides/);
assert.doesNotMatch(mixed, /needs a paying account/);
const empty = render([], []);
assert.match(empty, /No set-asides or goal contributions this period/);
assert.doesNotMatch(empty, /data-balanced-row="plans-/);

// Native goals, including linked/paid and partial fulfilment, are not dropped from the fold.
const paid = plan({ id: "paid", name: "Paid goal", sourceId: "current", fulfilment: { state: "fulfilled", expected_pence: 2000, matched_pence: 2000, unmet_pence: 0, seen_in_sink: true, matched: [{ date: "2026-11-10", amount: 20, label: "Goal transfer" }] } });
const partial = plan({ id: "partial", name: "Partial goal", sourceId: "current", fulfilment: { state: "partial", expected_pence: 2000, matched_pence: 700, unmet_pence: 1300, seen_in_sink: false, matched: [] } });
const goalHtml = render([], [paid, partial]);
assert.match(text(goalHtml), /Paid goal/);
assert.match(text(goalHtml), /Paid/);
assert.match(text(goalHtml), /Partial goal/);
assert.match(text(goalHtml), /£7 of £20 paid/);

// A native overlay wins over legacy allocation fields, and only the paying source
// is shown: a receiving/fill account must never become the payer identity.
const inferred = render([allocation({ source_account_id: null })], [plan({ id: "allocation:a1", kind: "allocation", evidence: "recent-transfers", sourceId: "current", destination: "Receiving pot" })]);
assert.match(text(inferred), /From Monzo · Everyday · estimated from recent transfers/);
assert.doesNotMatch(text(inferred), /Choose paying account/);
const card = render([], [plan({ id: "card", name: "Card reserve", planKind: "card_repayment", sourceId: "current", amountUnavailable: true })]);
assert.match(text(card), /Repayment plan · From Monzo · Everyday/);
assert.match(text(card), /Unavailable/);

// Privacy applies to row copy and accessible text, not just the visible figure.
const maskedHtml = render([allocation({ filled_this_period: 12, remaining: 38 })], [plan()], true);
assert.doesNotMatch(maskedHtml, /£(?:12|38|50|20)/);
assert.match(maskedHtml, /Amount hidden/);

// The fold is present in both PlanningPage branches and uses live callbacks, while the existing sheet remains.
const page = readFileSync(new URL("../app/planning/PlanningPage.tsx", import.meta.url), "utf8");
assert.equal((page.match(/<UpcomingPlansCard\b/g) ?? []).length, 2, "card is wired in both branches");
assert.equal((page.match(/onEditAllocation=\{openAllocation\}/g) ?? []).length, 2, "allocation editor callback is live in both branches");
assert.equal((page.match(/onPlan=\{\(id\) => setFlowView\(\{ kind: \"plan\", id \}\)\}/g) ?? []).length, 2, "goal callback opens the existing flow in both branches");
assert.match(page, /setSetAsideSheetOpen\(true\)/, "existing set-aside sheet remains available");
console.log("g489 approved Upcoming fold: ok");
