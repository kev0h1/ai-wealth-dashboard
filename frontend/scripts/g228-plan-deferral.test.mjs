// G228 (folded in): pins the PRODUCTION PlanEasingCard and PlanEasingSheet and
// the /design/plan-deferral page that renders them through real props.
//
// Kevin picked variant A on 2026-10-07: its own "Goal plan" card below the
// set-aside card, one action, no undo, never red, amber or a gradient. Set-asides
// and plans never trade cash. Every figure the sheet shows comes from the
// server's ease-preview; the fixture here works them the way the engine does.
//
// Run: npm run -s check:g228-plan-deferral
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { PlanEasingCard } from "../components/HomeBrief.tsx";
import { isActionableCompanionItem } from "../lib/companionItems.ts";
import { PLAN, enginePreview, planEasingItem, previewServices } from "../app/design/plan-deferral/fixtures.ts";

const read = (rel) => readFileSync(new URL(rel, import.meta.url), "utf8");
const brief = read("../components/HomeBrief.tsx");
const sheet = read("../components/PlanEasingSheet.tsx");
const client = read("../app/design/plan-deferral/PlanDeferralClient.tsx");
const fixtures = read("../app/design/plan-deferral/fixtures.ts");

// 1. The preview is the shipped look: it imports the production components and
//    no hand-authored copies remain.
assert.match(client, /import \{ MoveCard, PlanEasingCard \} from "@\/components\/HomeBrief"/, "production card imported");
for (const gone of ["DeferSheet.tsx", "PlanDeferral.tsx", "copy.ts"]) {
  assert.ok(!existsSync(new URL(`../app/design/plan-deferral/${gone}`, import.meta.url)), `${gone} removed`);
}
assert.doesNotMatch(client + fixtures, /SheetFrame|<button|deferMath/, "no reimplemented sheet or markup in the preview");
assert.match(read("../app/design/page.tsx"), /slug: "plan-deferral"/, "design index entry");

// 2. The production card source: lighter than the payment card, calm, one action.
const start = brief.indexOf("export function PlanEasingCard");
const end = brief.indexOf("// ── G217: set-aside (allocation) shortfall card", start);
const src = brief.slice(start, end);
assert.ok(start > 0 && end > start, "card source found");
assert.match(src, /BRIEF_CARD\} !shadow-none p-4/, "lighter: no shadow");
assert.match(src, /<BriefIcon><CalendarClock/, "neutral icon, not the Penny tone");
assert.match(src, /<KindLabel>Goal plan<\/KindLabel>/, "Goal plan kind label");
assert.match(src, /Cash looks short this period/, "approved headline");
for (const text of [src, sheet]) {
  assert.doesNotMatch(text, /\b(?:text|bg|border|ring|from|to|via|fill|stroke|decoration)-(?:red|rose|amber|orange|yellow)\b/, "no red or amber classes");
  assert.doesNotMatch(text, /\b(?:red|rose|amber|orange|yellow)-\d/, "no red or amber classes");
  assert.doesNotMatch(text, /BRAND_GRADIENT|PennyKindLabel|PennyMark|gradient|violet|\bvia-|\bfrom-/, "no gradient, no Penny");
  assert.doesNotMatch(text, /—|–/, "no dash characters");
  assert.doesNotMatch(text, />[^<{]*[A-Za-z]!/, "no exclamation marks in JSX text");
  assert.doesNotMatch(text, /Undo|undo|reversible/, "no undo");
  assert.doesNotMatch(text, /shadow-(?!none)/, "no shadows");
}
assert.equal((src.match(/className=\{PLAN_EASING_ACTION\}/g) ?? []).length, 1, "one action only: Ease <plan> this period");
assert.match(src, /Ease \{name\} this period/);
assert.doesNotMatch(src, /item\.action|router\.push/, "no route action: the card never moves money");
assert.match(brief, /const PLAN_EASING_ACTION = `\$\{SECONDARY_ACTION\} text-center leading-tight`/);
assert.match(brief, /const PLAN_EASING_LINK = "[^"]*min-h-11/, "Edit plan link is 44px");

// 3. Rendered states.
const noop = previewServices("eligible", () => {});
const render = (state) => renderToStaticMarkup(createElement(PlanEasingCard, { item: planEasingItem(state), services: noop }));
const eligible = render("eligible");
const capped = render("capped");
const deferred = render("deferred");
const buttonLabels = (html) => [...html.matchAll(/<button\b[^>]*class="([^"]*)"[^>]*>([^<]*)</g)].map((m) => [m[1], m[2]]);

assert.match(eligible, /Cash looks short this period/);
assert.match(eligible, /Easing Japan by up to <span class="money">£80<\/span> for this pay period could help/);
assert.match(eligible, /No other account looks able to spare it\. This changes the plan\. No money is moved\./);
const actions = buttonLabels(eligible).filter(([, label]) => /^Ease/.test(label));
assert.deepEqual(actions.map(([, l]) => l), ["Ease Japan this period"], "one action");
assert.match(actions[0][0], /min-h-11/, "44px");
assert.doesNotMatch(eligible, /<a\b/, "no Move link");

assert.match(capped, /Easing is held back for Japan/);
assert.match(capped, /A plan can only be eased in two periods a year\./, "shows the server's reason");
assert.equal(buttonLabels(capped).filter(([, l]) => /^Ease/.test(l)).length, 0, "capped: no action");

assert.match(deferred, /Japan is <span class="money">£30<\/span> this period\./);
assert.match(deferred, /Later periods are about £85 and it should still land in Nov 2028\./);
assert.match(deferred, /href="\/planning"[^>]*>Edit plan</, "deferred: quiet Edit plan link");
assert.equal(buttonLabels(deferred).filter(([, l]) => /^Ease/.test(l)).length, 0, "deferred: no action");
for (const html of [eligible, capped, deferred]) {
  assert.doesNotMatch(html, /text-(?:red|rose|amber)|bg-(?:red|rose|amber)|linear-gradient/, "calm");
  assert.doesNotMatch(html, /—/, "no em dash");
  assert.doesNotMatch(html, /Undo|undo/);
}

// Only the live offer is a decision for the Penny hub.
assert.equal(isActionableCompanionItem(planEasingItem("eligible")), true);
assert.equal(isActionableCompanionItem(planEasingItem("capped")), false);
assert.equal(isActionableCompanionItem(planEasingItem("deferred")), false);

// 4. The sheet: production SheetFrame, 44px targets, accessible stepper and radiogroup, caveat gone.
assert.match(sheet, /from "@\/components\/SheetFrame"/, "production SheetFrame");
assert.match(sheet, /Take £5 less off/);
assert.match(sheet, /Take £5 more off/);
assert.match(sheet, /aria-valuetext/);
assert.match(sheet, /Skip this period/);
assert.match(sheet, /Keep \$\{keptDate\}/, "keep the date");
assert.match(sheet, /Keep \$\{gbp\(usualSlice\)\} each period/, "keep the amount");
assert.doesNotMatch(sheet, /Production rounds slices up/, "the rounding caveat is replaced by the engine's figure");
assert.match(sheet, /services\.previewPlanEase/, "figures come from the server preview");
assert.doesNotMatch(sheet, /Math\.ceil\(.*\/.*later/i, "no client-side slice maths");
const consts = Object.fromEntries([...sheet.matchAll(/const (BTN_\w+) = "([^"]*)"/g)].map((m) => [m[1], m[2]]));
for (const [k, v] of Object.entries(consts)) assert.match(v, /min-h-11/, `${k} min-h-11`);
const tags = [...sheet.matchAll(/<button\b[\s\S]*?className=\{[^}]*\}/g)].map((m) => m[0]);
assert.ok(tags.length >= 5, "sheet buttons found");
for (const tag of tags) {
  const used = [...tag.matchAll(/(BTN_\w+)/g)].map((m) => consts[m[1]] ?? "").join(" ");
  assert.match(tag + used, /min-h-11/, `button not 44px: ${tag.slice(0, 80)}`);
}
assert.match(sheet, /border-t border-slate-300/, "ledger: exactly one rule, above the total");

// 5. The engine figures behind the fixture: £80 a period, £2,000 left, 24 later periods.
assert.equal(PLAN.usual * (PLAN.laterPeriods + 1), PLAN.remaining, "£80 x 25 = £2,000");
const p30 = enginePreview(30, 1);
assert.equal(p30.keep_date.later_slice, 85, "£1,970 / 24 = £82.08, rounded up to £5 by the engine");
assert.equal(p30.keep_date.refused, null);
assert.equal(p30.keep_amount.date_moves_periods, 1, "£1,970 at £80 needs 25 later periods");
assert.equal(p30.keep_amount.target_date, "2028-12-01");
assert.equal(p30.keep_amount.later_slice, 80, "£1,970 / 25 = £78.8, rounded up to £5");
const skip = enginePreview(0, 1);
assert.equal(skip.keep_date.later_slice, 85, "skip: £2,000 / 24 = £83.33, rounded up to £5");
assert.ok(skip.keep_date.later_slice * 4 <= PLAN.usual * 5, "inside 125% of the usual slice");
assert.equal(enginePreview(30, 2).blocked_reason, "A plan can only be eased in two periods a year.");

console.log("g228 plan-deferral: ok");
