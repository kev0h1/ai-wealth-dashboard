// G217 (folded in): pins the PRODUCTION AllocationShortfallCard.
//
// Kevin picked variant A (same anatomy as the move card, lighter, outlined
// button pair). This renders the real component through react-dom/server for
// the estimated, known and no-source states and pins what the pick promised:
// calm (no red, amber or Penny gradient), both remedies present and equal,
// Reduce alone with a reason when no account can spare the money, and the
// shipped HomeBrief tokens unchanged. It also pins that the account sheet's
// own "more needed for plans" figure still exists below the Home floor.
//
// Run: npm run -s check:g217-allocation-card
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AllocationShortfallCard, BriefBody } from "../components/HomeBrief.tsx";
import { allocationItem, paymentItem } from "../app/design/allocation-shortfall/fixtures.ts";
import { accountPlan } from "../lib/upcomingPlans.ts";

const brief = readFileSync(new URL("../components/HomeBrief.tsx", import.meta.url), "utf8");
const grab = (name) => {
  const m = brief.match(new RegExp(`const ${name} =\\s*(?:"([^"]*)"|\`([^\`]*)\`)`));
  assert.ok(m, `${name} missing`);
  return m[1] ?? m[2];
};

// 1. Shipped tokens the card is built on stay exactly what shipped.
assert.equal(grab("BRIEF_CARD"), "relative overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-800");
assert.match(grab("SECONDARY_ACTION"), /border border-slate-200 bg-white text-slate-700/);
assert.match(grab("ACTION_BASE"), /min-h-11/, "44px targets");
for (const n of ["BRIEF_CARD", "SECONDARY_ACTION", "BriefIcon", "KindLabel", "DismissChip", "MoveAccountIcon", "AllocationShortfallCard"]) {
  assert.match(brief, new RegExp(`export (const|function) ${n}\\b`), `${n} must stay exported`);
}

// 2. The production card source: calm, lighter than the move card, no Penny.
const start = brief.indexOf("export function AllocationShortfallCard");
const end = brief.indexOf("/**\n * Home-only dismissal", start);
const src = brief.slice(start, end);
assert.ok(start > 0 && end > start, "card source found");
assert.match(src, /BRIEF_CARD\} !shadow-none p-4/, "lighter: no shadow");
assert.match(src, /<BriefIcon><PiggyBank/, "neutral icon, not the Penny tone");
assert.match(src, /text-\[18px\] font-semibold/, "small ink figure");
assert.doesNotMatch(src, /(?:text|bg|border|ring|from|to|via|fill|stroke|decoration)-(?:red|rose|amber)\b/, "no red, rose or amber");
assert.doesNotMatch(src, /\b(?:red|rose|amber)-\d/, "no red, rose or amber");
assert.doesNotMatch(src, /BRAND_GRADIENT|PennyKindLabel|PennyMark|PRIMARY_ACTION|bg-indigo-600/, "no Penny gradient, no primary action");
assert.doesNotMatch(src, /\u2014/, "no em dash");
assert.doesNotMatch(src, />[^<{]*[A-Za-z]!/, "no exclamation marks in copy");
assert.match(src, /SET_ASIDE_ACTION/);
assert.equal((src.match(/className=\{SET_ASIDE_ACTION\}/g) ?? []).length, 2, "Move and Reduce share one class: equal weight");
assert.match(brief, /const SET_ASIDE_ACTION = `\$\{SECONDARY_ACTION\} text-center leading-tight`/);

// 3. Rendered states.
const noServices = { listAllocations: async () => [], accounts: async () => [], dismissTodayItem: async () => ({}), updateAllocation: async () => ({}), deleteAllocation: async () => ({}), allocationFillCandidates: async () => [], setAllocationPeriodOverride: async () => ({}) };
const render = (state) => renderToStaticMarkup(createElement(AllocationShortfallCard, { item: allocationItem(state), services: noServices }));
const buttons = (html) => [...html.matchAll(/<(?:a|button)\b[^>]*class="([^"]*)"[^>]*>([^<]*)</g)];

const estimated = render("estimated");
const known = render("known");
const none = render("no-source");

for (const [name, html] of [["estimated", estimated], ["known", known], ["no-source", none]]) {
  assert.match(html, /Your Holiday set-aside is short/, name);
  assert.match(html, /£38\.40/, name);
  assert.match(html, /short this period/, name);
  assert.match(html, /£200<\/span> set aside this period/, name);
  assert.doesNotMatch(html, /text-(?:red|rose|amber)|bg-(?:red|rose|amber)|linear-gradient/, `${name}: calm`);
  assert.doesNotMatch(html, /\u2014/, name);
}
assert.match(estimated, /Paid from Premier Current, based on recent transfers\./);
assert.match(known, /Paid from Premier Current\./);
assert.doesNotMatch(known, /based on recent transfers/);

for (const [name, html] of [["estimated", estimated], ["known", known]]) {
  const actions = buttons(html).filter(([, , label]) => /^(Move from|Reduce)/.test(label));
  assert.deepEqual(actions.map(([, , label]) => label), ["Move from Savings", "Reduce set-aside"], `${name}: both remedies, Move first`);
  assert.equal(actions[0][1], actions[1][1], `${name}: equal classes`);
  assert.match(actions[0][1], /min-h-11/);
  assert.match(html, /grid-cols-2/);
  assert.doesNotMatch(html, /No other account can safely spare/);
}

const noActions = buttons(none).filter(([, , label]) => /^(Move from|Reduce)/.test(label));
assert.deepEqual(noActions.map(([, , label]) => label), ["Reduce set-aside"], "no source: Reduce only");
assert.match(none, /No other account can safely spare <span class="money">£38\.40<\/span> right now\./);
assert.match(none, /grid-cols-1/);
assert.match(none, /aria-label="Dismiss Holiday set-aside note"/);

// 3b. Rank: BriefBody paints the set-aside card AFTER every payment move card,
// whatever order the feed arrives in.
const body = renderToStaticMarkup(createElement(BriefBody, {
  items: [allocationItem("known"), paymentItem()], router: { push() {} }, safeToSpend: null,
}));
const moveAt = body.indexOf('data-move-card');
const setAsideAt = body.indexOf('data-allocation-card="shortfall"');
assert.ok(moveAt >= 0 && setAsideAt >= 0, "both cards render in the brief");
assert.ok(moveAt < setAsideAt, "allocation card ranks after the payment move card");

// 3c. Reduce is THIS period only; the recurring edit is a separate, labelled action.
const sheet = readFileSync(new URL("../components/AllocationPeriodReduceSheet.tsx", import.meta.url), "utf8");
assert.match(sheet, /This period only\./);
assert.match(sheet, /every pay period afterwards/);
assert.match(sheet, /Reduce this period/);
assert.match(sheet, /Change every period/);
assert.match(sheet, /setAllocationPeriodOverride/);
assert.doesNotMatch(sheet, /updateAllocation|amount_per_period:/, "the reduce sheet never rewrites the recurring amount");
assert.doesNotMatch(sheet, /\u2014/);
assert.doesNotMatch(sheet, /(?:text|bg|border|ring)-(?:red|rose|amber)\b/);

// 4. The account sheet's own gap survives below the Home floor (£5): the card
// stays quiet about pennies, the sheet line does not.
const plan = (remaining) => ({ id: "p", kind: "allocation", name: "Holiday", destination: "Pot", sourceId: "cur", evidence: "chosen", periodPence: remaining, filledPence: 0, remainingPence: remaining, active: true });
const account = { id: "cur", closing: 100 };
assert.equal(accountPlan(account, [plan(10006)]).planGap, 6, "6p still shows as 'more needed for plans' on the sheet");

console.log("g217-allocation-card OK");
