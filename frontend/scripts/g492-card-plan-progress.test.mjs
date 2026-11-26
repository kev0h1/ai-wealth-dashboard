// G492: real production row contract. All figures and progress are persisted
// facts; this test intentionally uses no design fixture or client arithmetic.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import CardPlanRepaymentRow from "../components/plans/CardPlanRepaymentRow.tsx";
import { BalancesHiddenContext } from "../lib/balancesHidden.tsx";
import { cardPlanEvidenceLines, projectedMonthLine } from "../lib/cardRepaymentPlan.ts";

const h = React.createElement;
const page = readFileSync(new URL("../app/planning/LongTermPlanningPage.tsx", import.meta.url), "utf8");
const plan = {
  id: "plan-1", name: "A deliberately long card repayment plan name that must wrap", plan_kind: "card_repayment",
  card_plan: {
    status: "ready", display_period_planned: 1200, this_period_planned: 1200, paid_this_period: 75.25,
    paid_from_source_this_period: 75.25, reserved_from_source_this_period: 1124.75,
    schedule_state: "active", amount_varies: false, final_period_amount: false, would_clear_by: "Dec 2099",
    finish_estimate: { status: "ready", month: "2027-01", label: "Jan 2027", basis: "before_offer_end" },
    promo: {
      until: "2027-02-28", balance: 600, balance_is_offer: true, residual_at_end: 0, outlook: "on_track",
      progress: { status: "ready", basis: "reconciled_single_offer", target: 5691, paid: 1200, expected_by_now: 1000, paid_percent: 21.0859, expected_percent: 18 },
    },
  },
};
const render = (hidden, item = plan, hideValues = hidden) => renderToStaticMarkup(h(BalancesHiddenContext.Provider, { value: hidden }, h(CardPlanRepaymentRow, { plan: item, hideValues, onOpen() {} })));

const ready = render(false);
assert.match(ready, /data-g492-row(?:="true")?/, "the production row exposes a stable QA hook regardless of React's boolean-attribute serialisation");
assert.match(ready, /data-g492-row-content(?:="true")?/, "the rendered content exposes a stable QA hook");
assert.match(ready, /data-g492-actual(?:="true")?[^>]*role="progressbar"/, "saved ready progress renders the ring");
assert.match(ready, /stroke-dasharray="21\.0859 100"/, "the supplied percentage passes through without browser arithmetic");
assert.match(ready, /stroke-emerald-700/, "on-track persisted outlook is emerald");
assert.match(ready, /£1,200/, "whole-pound figures stay compact");
assert.doesNotMatch(ready, /£1,200\.00/, "whole-pound figures do not gain invented pence");
assert.match(ready, /class="money">£5,691<\/span>/, "the supplied target retains money semantics independently of wrapper spans");
assert.match(ready, /Offer ends 28 Feb 2027/, "offer wording makes no unsupported APR claim");
assert.match(ready, /Estimated finish Jan 2027/, "only the saved safe estimate is shown");
assert.doesNotMatch(ready, /Dec 2099/, "legacy would_clear_by cannot reach the production row");

const hidden = render(true);
assert.doesNotMatch(hidden, /£|progressbar|<svg|stroke-dasharray/, "hidden mode removes money, ring artwork and progress semantics");
assert.match(hidden, /Figures hidden/, "hidden mode keeps its plain non-money progress state");
assert.match(hidden, /Payment hidden/, "hidden mode keeps payment privacy explicit");
const contextOnlyHidden = render(true, plan, false);
assert.doesNotMatch(contextOnlyHidden, /£\d|role="progressbar"|<circle|stroke-dasharray/, "the balances-hidden context wins while local preferences are unresolved");
assert.match(contextOnlyHidden, /Figures hidden/, "context-only privacy keeps a plain progress state");

for (const status of ["pending", "stale", "unavailable"]) {
  const unresolved = render(false, { ...plan, card_plan: { status, would_clear_by: "Dec 2099", promo: { until: "2099-12-31", progress: { status: "ready", target: 1, paid: 1, paid_percent: 100 } } } });
  assert.doesNotMatch(unresolved, /£|progressbar|<svg|Dec 2099|2099/, `${status} facts cannot borrow stale money, deadlines or rings`);
}

const future = render(false, { ...plan, card_plan: {
  status: "ready", schedule_state: "not_started", starts_on: "2026-12-04", display_period_planned: 62.7, this_period_planned: 0,
  finish_estimate: { status: "unavailable", reason: "future_plan" },
  promo: { until: "2027-02-28", balance: 600, balance_is_offer: true, outlook: "short", progress: { status: "not_started", target: 600, paid: 0, paid_percent: 0 } },
} });
assert.match(future, /stroke-slate-500/, "a supplied zero future progress uses neutral, not a guessed semantic tone");
assert.match(future, /stroke-dasharray="0 100"/, "a supplied zero percentage is preserved without inventing it");
assert.match(future, /£62\.70/, "genuine pence remain exact");
assert.match(future, /Each pay period from 4 Dec 2026/, "future cadence and start date remain together");
assert.match(future, /Target and outlook are provisional until the plan starts on 4 Dec 2026\./, "future target/outlook qualifier remains explicit");
assert.match(future, /Finish date not available yet/, "future schedules do not receive a guessed finish date");
assert.ok(cardPlanEvidenceLines({ ...plan.card_plan, schedule_state: "not_started", this_period_planned: 0, display_period_planned: 62.7 }).includes("Planned this pay period £0"), "sheet evidence uses the actual current-period fact, never the future display amount");

const behind = render(false, { ...plan, card_plan: { ...plan.card_plan, promo: { ...plan.card_plan.promo, outlook: "behind" } } });
assert.match(behind, /stroke-amber-700/, "behind persisted outlook is amber");
const finalPayment = render(false, { ...plan, card_plan: { status: "ready", schedule_state: "active", display_period_planned: 14.2, final_period_amount: true, finish_estimate: { status: "unavailable", reason: "offer_progress_unavailable" } } });
assert.match(finalPayment, /planned this pay period/i, "final_period_amount is not misrepresented as a promise that payments stop");
assert.doesNotMatch(finalPayment, /Final payment/, "no unsupported final-payment claim");
const varyingPayment = render(false, { ...plan, card_plan: { status: "ready", schedule_state: "active", display_period_planned: 87.6, amount_varies: true, finish_estimate: { status: "unavailable", reason: "forecast_unavailable" } } });
assert.match(varyingPayment, /this pay period, amount varies/i, "the saved varying-payment qualifier survives the compact row");

assert.equal(projectedMonthLine({ status: "ready", finish_estimate: { status: "ready", month: "2027-01", label: "Jan 2027", basis: "before_offer_end" } }), "Estimated finish Jan 2027", "the exact safe basis is required");
assert.equal(projectedMonthLine({ status: "ready", finish_estimate: { status: "ready", month: "2027-01", label: "Jan 2027", basis: "wrong" }, would_clear_by: "Dec 2099" }), "Finish date unavailable", "an invalid basis cannot fall back to legacy data");
assert.match(page, /hasPlans \? "Each card can have one repayment plan, set here\." : CARD_PLAN_COPY\.debtFootnote/, "plan mode removes the false additive row claim while the no-plan summary remains unchanged");
assert.match(page, /Refresh plan figures/, "an unresolved stored snapshot has a quiet explicit refresh action after bounded retries");

console.log("G492: production card-plan row preserves saved facts, safe finish provenance, states and privacy");
