// G475: card repayment plans are set from the Debt section, reusing the goal sheet.
// Pins: the "Set a plan" control mirrors "Set a goal" and opens the existing
// CommitmentSheet; a card replaces the savings pot; the sheet prefills from the
// server and saves through the one-plan-per-card endpoint; the Debt row speaks
// in hedged words; the old "Repayment plans are under Details" line is gone;
// and the copy follows the rules (British English, no em dashes, no exclamation
// marks, no advice to pay a particular card).
// Run: npm run -s check:g475-card-plans
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  CARD_PLAN_COPY, projectedMonthLine, isCardAccount, isCardPlan, offerLine, paidLine, planAmountLine, prefillBasisLine,
} from "../lib/cardRepaymentPlan.ts";

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const page = read("app/planning/LongTermPlanningPage.tsx");
const sheet = read("components/CommitmentSheet.tsx");
const api = read("lib/api.ts");
const flow = read("components/plans/PlanEditorFlow.tsx");

// ── the control is "Set a goal"'s twin and opens the goal sheet ──────────────
const buttonClass = "inline-flex min-h-11 items-center gap-1 px-2 text-xs font-semibold text-indigo-600 focus-visible:rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:text-indigo-400";
assert.ok(page.includes(`className="${buttonClass}"><Plus size={14} aria-hidden="true" /> Set a goal</button>`), "Set a goal keeps its own style");
assert.ok(page.includes(`className="${buttonClass}"><Plus size={14} aria-hidden="true" /> {CARD_PLAN_COPY.setPlan}</button>`), "Set a plan uses exactly the Set a goal button style and plus icon");
assert.equal(CARD_PLAN_COPY.setPlan, "Set a plan");
assert.match(page, /onSetPlan=\{\(\) => setEditingPlan\(null\)\}/, "Set a plan opens a new plan");
assert.match(page, /<CommitmentSheet accounts=\{accounts\} commitment=\{editingPlan\} cardPlan=\{editingPlan === null\}/, "the plan opens the existing CommitmentSheet, not a new screen");
assert.equal((page.match(/const CommitmentSheet = dynamic\(/g) ?? []).length, 1, "one sheet component, shared by goals and plans");
assert.doesNotMatch(page, /Repayment plans are under Details/, "the old line is gone");
assert.match(CARD_PLAN_COPY.debtFootnote, /Each card can have one repayment plan, set here\./);
assert.match(page, /setGoals\(active\.filter\(\(item\) => !isCardPlan\(item\)\)\)/, "plans are not listed as long-term goals");
assert.match(page, /plans=\{cardPlans\}/, "plans are shown in the Debt section");

// ── the sheet: a card in place of the savings pot, prefilled, one plan per card ─
assert.match(sheet, /isCardPlan = cardPlan \|\| isCardPlanRecord\(commitment\)/, "card mode is the same sheet");
assert.match(sheet, /PLAN_EDITOR_STEPS\.filter\(step => step !== "destination"\)/, "no savings pot step for a card plan");
assert.match(sheet, /<AccountRadioPicker accounts=\{cardOptions\}/, "a card picker takes the savings pot's place");
assert.match(sheet, /readCardPrefill\(id\)/, "choosing a card reads the prefill");
assert.match(sheet, /setSourceId\(found\.source_account_id\)/, "pay from is prefilled");
assert.match(sheet, /setPerPeriod\(found\.amount != null \? String\(found\.amount\) : ""\)/, "the amount is prefilled, or left empty so the sheet asks");
assert.match(sheet, /setRule\(\{ \.\.\.found\.fill_rule/, "the payment to track is prefilled");
assert.match(sheet, /createCardPlan\(\{[\s\S]{0,200}card_account_id: cardId/, "saving sends the card");
assert.match(sheet, /hideCategory=\{isCardPlan\}/, "a card plan is tracked by its payment");
assert.match(sheet, /isCardPlan \|\| !amountValid \|\| !monthValid/, "no goal feasibility preview for a plan");
assert.match(sheet, /!commitment && !isCardPlan && activePreview\?\.consent/, "the goal debt consent never gates a plan");
assert.match(sheet, /\{!paused && !isCardPlan && commitment\.status === "active"/, "no per-period contribution change on a plan");
assert.match(sheet, /Edit schedule|GoalScheduleDetails/, "any schedule type is edited through the existing schedule editor");
assert.match(flow, /steps\.indexOf\(actions\.step\) \+ 1\} of \{steps\.length\}/, "the step counter follows the steps the flow has");
assert.match(api, /cardPlanPrefill: \(cardAccountId: string\)/);
assert.match(api, /createCardPlan: \(body: \{[\s\S]{0,200}card_account_id: string;/);

// ── Upcoming rows: a repayment plan travels as a goal but is worded as a repayment ─
const upcoming = read("lib/upcomingPlans.ts");
const detail = read("components/upcoming/UpcomingDetailFlow.tsx");
const unlinked = read("components/upcoming/UnlinkedGoalPlans.tsx");
const icons = read("components/upcoming/detailPrimitives.tsx");
assert.match(upcoming, /planKind: item\.plan_kind \?\? null/, "the plan flag reaches the row");
assert.match(icons, /cardPlan \? CreditCard : kind === "goal" \? Target : Wallet/, "a repayment plan gets the card icon, not the goal target");
assert.match(detail, /Your card repayment plan/, "the sheet subtitle says repayment plan");
assert.match(detail, /<PlanIcon kind="goal" cardPlan=\{Boolean\(plan\.planKind\)\} \/>/);
assert.match(unlinked, /Repayment plans needing a paying account/);
assert.match(read("components/PaydayPlanCard.tsx"), /"repayment plan"/, "the payday plan names it a repayment plan, not a goal");
assert.match(page, /setEditingPlan\(repayment\)/, "a plan deep link opens the plan, not a missing goal");

// ── the words ────────────────────────────────────────────────────────────────
const facts = {
  card_name: "Example Amex", balance_owed: 600, this_period_planned: 150, paid_this_period: 60,
  would_clear_by: "Feb 2027", would_clear_by_month: "2027-02",
  promo: { until: "2027-01-31", balance: 450, balance_is_offer: true, planned_by_end: 600, clears_before_end: true },
};
assert.equal(planAmountLine(facts, "monthly"), "£150 each pay period (monthly)");
assert.equal(planAmountLine(facts, null), "£150 a pay period");
assert.equal(planAmountLine(null, null), "Amount unavailable");
assert.equal(paidLine(facts), "£60.00 paid this pay period");
assert.equal(paidLine({ ...facts, paid_this_period: 0 }), "Nothing paid yet this pay period");
assert.equal(projectedMonthLine(facts), "At this pace it would clear by about Feb 2027", "the clear-by month is hedged");
assert.equal(projectedMonthLine({ ...facts, would_clear_by: null }), null, "no month, no claim");
assert.match(offerLine(facts), /ends 31 Jan 2027\. The plan would pay about £600 by 31 Jan 2027, which would cover the offer balance of about £450\./, "the offer is a fact with a date");
const short = { ...facts, promo: { ...facts.promo, planned_by_end: 400, clears_before_end: false } };
assert.match(offerLine(short), /would leave about £50 of the offer balance when it ends\./, "a shortfall is stated as a fact");
assert.equal(offerLine({ ...facts, promo: null }), null);
assert.equal(prefillBasisLine("direct_debit", true), "About, from your usual direct debit. Change it if you like.");
assert.equal(prefillBasisLine("fixed_payment", false), "From the fixed payment on this card. Change it if you like.");
assert.equal(prefillBasisLine(null, false), null);

const spoken = [CARD_PLAN_COPY.setPlan, CARD_PLAN_COPY.debtFootnote, CARD_PLAN_COPY.emptyHint, CARD_PLAN_COPY.deleteConfirm, CARD_PLAN_COPY.purpose, CARD_PLAN_COPY.noCards, CARD_PLAN_COPY.allCardsHavePlans, CARD_PLAN_COPY.moneyNote,
  planAmountLine(facts, "monthly"), paidLine(facts), projectedMonthLine(facts), offerLine(facts), offerLine(short), prefillBasisLine("direct_debit", true)];
for (const text of spoken) {
  assert.doesNotMatch(text, /[—–!]/, `no em dash, en dash or exclamation mark: ${text}`);
  assert.doesNotMatch(text, /\b(?:should|must|best|better|recommend|you need to)\b/i, `a fact, never advice: ${text}`);
  assert.doesNotMatch(text, /\b(?:color|center|organize|payoff)\b/i, `British English: ${text}`);
}
assert.doesNotMatch(read("lib/cardRepaymentPlan.ts"), /text-red|rose-|red-\d/, "no red in the plan words");

// ── helpers ──────────────────────────────────────────────────────────────────
assert.equal(isCardPlan({ plan_kind: "card_repayment" }), true);
assert.equal(isCardPlan({ plan_kind: null }), false);
assert.equal(isCardPlan(undefined), false);
assert.equal(isCardAccount({ type: "credit_card", subtype: "CREDIT_CARD" }), true);
assert.equal(isCardAccount({ type: "bank", subtype: "CURRENT_ACCOUNT" }), false);
assert.equal(isCardAccount({ type: "credit", subtype: undefined }), true);

console.log("G475: Set a plan control, shared goal sheet, card prefill, hedged Debt row copy and copy rules passed");
