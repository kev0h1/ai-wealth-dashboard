// G228 (design round): pins the /design/plan-deferral proposals. Proposals only:
// no production component is touched, so this checks the preview's own rules.
//
// Run: npm run -s check:g228-plan-deferral
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { COPY } from "../app/design/plan-deferral/copy.ts";
import { GOAL, deferMath } from "../app/design/plan-deferral/fixtures.ts";

const dir = "../app/design/plan-deferral/";
const read = (f) => readFileSync(new URL(dir + f, import.meta.url), "utf8");
const files = ["copy.ts", "fixtures.ts", "DeferSheet.tsx", "PlanDeferral.tsx", "PlanDeferralClient.tsx", "page.tsx"];

// 1. Copy: no em dash, no exclamation mark, in every string the variants show.
const allCopy = [];
(function walk(v) {
  if (typeof v === "string") allCopy.push(v);
  else if (typeof v === "function") for (const [r, k] of [[50, "date"], [50, "amount"], [80, "date"], [5, "amount"]]) allCopy.push(v(r, k));
  else if (v && typeof v === "object") Object.values(v).forEach(walk);
})(COPY);
assert.ok(allCopy.length > 40, "copy collected");
for (const s of allCopy) {
  assert.doesNotMatch(s, /—|–/, `dash in: ${s}`);
  assert.doesNotMatch(s, /!/, `exclamation in: ${s}`);
}
for (const f of files) assert.doesNotMatch(read(f), /—/, `${f}: no em dash anywhere`);
assert.doesNotMatch(read("PlanDeferralClient.tsx") + read("PlanDeferral.tsx") + read("DeferSheet.tsx"), />[^<{]*[A-Za-z]!/, "no exclamation marks in JSX text");

// 2. The new controls stay calm: no red, rose, amber, orange, no gradient, no Penny.
for (const f of ["DeferSheet.tsx", "PlanDeferral.tsx"]) {
  const src = read(f);
  assert.doesNotMatch(src, /\b(?:red|rose|amber|orange|yellow)-\d/, `${f}: no red or amber classes`);
  assert.doesNotMatch(src, /gradient|\bfrom-|\bvia-|violet|BRAND_GRADIENT|PennyMark|PennyKindLabel|tone="penny"/, `${f}: no gradient or Penny`);
  assert.doesNotMatch(src, /shadow-(?!none)/, `${f}: no shadows`);
}

// 3. Every sheet button is 44px: each <button tag carries min-h-11 or a constant that does.
const sheet = read("DeferSheet.tsx");
const consts = Object.fromEntries([...sheet.matchAll(/const (BTN_\w+) = "([^"]*)"/g)].map((m) => [m[1], m[2]]));
const tags = [...sheet.matchAll(/<button\b[\s\S]*?className=\{[^}]*\}/g)].map((m) => m[0]);
assert.ok(tags.length >= 5, "sheet buttons found");
for (const tag of tags) {
  const used = [...tag.matchAll(/\$?\{?(BTN_\w+)\}?/g)].map((m) => consts[m[1]] ?? "").join(" ");
  assert.match(tag + used, /min-h-11/, `button not 44px: ${tag.slice(0, 80)}`);
}
for (const [k, v] of Object.entries(consts)) assert.match(v, /min-h-11/, `${k} min-h-11`);
// The new Home and Planning controls too.
const cards = read("PlanDeferral.tsx");
assert.match(cards, /const QUIET = "[^"]*min-h-11/, "quiet action 44px");
assert.match(cards, /SECONDARY_ACTION/, "card action reuses the production secondary action");

// 4. The maths example reconciles. £80 x 25 = £2,000 remaining; take £50 off this period.
assert.equal(GOAL.usual * GOAL.periodsLeft, GOAL.remaining, "£80 x 25 = £2,000");
const x = deferMath(50);
assert.equal(x.thisPeriod, 30);
assert.equal(x.after, 1970, "£2,000 - £30 contributed = £1,970 remaining");
assert.equal(x.later, 24);
assert.ok(Math.abs(x.exactPer - 82.0833) < 0.001, "£1,970 / 24 = £82.08");
assert.equal(x.keepDatePer, 83, "rounded UP to the whole pound");
assert.equal(x.keepDateFinal, 61, "last contribution takes the remainder");
assert.equal(x.keepDatePer * 23 + x.keepDateFinal, 1970, "23 x £83 + £61 = £1,970, never overfunded");
assert.ok(x.keepDateFinal <= x.keepDatePer, "final never exceeds the usual step");
assert.equal(x.keepAmountPeriods, 25, "£1,970 / £80 = 24.6, so 25 later periods");
assert.equal(x.periodsLater, 1, "lands one period later");
assert.equal(x.keepAmountFinal, 50);
assert.equal(x.keepAmountFinal + GOAL.usual * 24, 1970);
assert.equal(x.landsLabel, "Dec 2028", "Nov 2028 + 1 period");
assert.ok(x.withinCeiling, "£83 is inside the 125% catch-up ceiling (£100)");
// Boundaries: skipping the whole contribution never goes below £0 and still reconciles.
const skip = deferMath(80);
assert.equal(skip.thisPeriod, 0);
assert.equal(skip.after, 2000);
assert.equal(skip.keepDatePer, 84);
assert.equal(skip.keepDatePer * 23 + skip.keepDateFinal, 2000);
assert.equal(skip.periodsLater, 0 + (skip.keepAmountPeriods - 24));
// Copy quotes the same numbers the maths produces.
assert.match(COPY.deferredDetail, /about £83/);
assert.match(COPY.audit(50, "amount"), /Dec 2028/);
assert.match(COPY.audit(50, "date"), /about £83/);

// 5. Both previews: variants and states exist, and the index entry is registered.
const client = read("PlanDeferralClient.tsx");
for (const k of ["eligible", "capped", "deferred", "covered"]) assert.match(client, new RegExp(`"${k}"`), `state ${k}`);
for (const k of ['"a"', '"c"']) assert.ok(client.includes(k), `variant ${k}`);
assert.match(client, /from "@\/components\/HomeBrief"/, "production HomeBrief cards imported");
assert.match(client, /GoalRow.*LongTermPlanningPage/, "production GoalRow imported");
assert.match(sheet, /from "@\/components\/SheetFrame"/, "production SheetFrame");
const index = readFileSync(new URL("../app/design/page.tsx", import.meta.url), "utf8");
assert.match(index, /slug: "plan-deferral"/, "design index entry");

// Round 2 (Kevin 2026-10-07): no undo, no variant B, no set-aside coupling.
const everything = files.map(read).join("\n") + JSON.stringify(allCopy);
assert.doesNotMatch(everything, /Undo|undo/, "no undo anywhere");
assert.doesNotMatch(everything, /reversible/i, "no 'reversible'");
assert.doesNotMatch(everything, /Cover the|coverGap/, "no cover-the-gap framing");
assert.doesNotMatch(everything, /RemedyCardB|bBreaks|variant === "b"|"b"/, "no variant B");
assert.doesNotMatch(everything, /AllocationShortfallCard|allocationItem/, "no set-aside card in the preview");
assert.doesNotMatch(everything, /until the period|period ends|periodEnd/i, "no until-period-end copy");
assert.match(COPY.introBody, /never trade cash/, "intro says set-asides and plans never trade cash");
assert.match(COPY.editPlan, /Edit plan/);
assert.match(read("PlanDeferral.tsx"), /href="\/planning"/, "deferred state points to Planning");
assert.equal(COPY.deferredLine, "Japan is £30 this period.");
assert.equal(COPY.deferredDetail, "Later periods are about £83 and it should still land in Nov 2028.");
assert.match(COPY.roundingCaveat, /rounds slices up to £5/);
assert.match(sheet, /COPY\.roundingCaveat/, "caveat shown in the sheet footnote");
assert.match(sheet, /Take £5 less off/);
assert.match(sheet, /Take £5 more off/);
assert.match(sheet, /aria-valuetext/);
assert.equal(GOAL.easedUsedCapped, GOAL.maxEasedPer12Months, "capped fixture is at the limit");
assert.equal(COPY.limits(GOAL.easedUsedCapped).slice(0, 18), "Eased 2 of 2 times");
assert.match(client, /capped \? GOAL\.easedUsedCapped/, "capped state feeds the sheet");

console.log("g228 plan-deferral: ok");
