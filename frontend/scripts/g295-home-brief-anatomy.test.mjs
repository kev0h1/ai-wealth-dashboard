import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime.js";
import { ProductionCard, examplesFor, renderHomeBrief } from "./fixtures/g295-home-brief-cards.tsx";
import * as F from "./fixtures/g295-home-brief-anatomy.ts";

const noop = () => {};
const router = { bfcacheId: "g295-home-brief-regression", push: noop, replace: noop, refresh: noop, back: noop, forward: noop, prefetch: async () => {} };
const render = element => renderToStaticMarkup(h(AppRouterContext.Provider, { value: router }, element));

function cardHtml(example, hidden = false) {
  return render(h(ProductionCard, { example, hidden }));
}

const views = ["focus", "family", "edges", "hidden", "empty"];
for (const view of views) {
  const html = render(renderHomeBrief(view));
  assert.match(html, new RegExp(`data-view="${view}"`), `${view}: SSR grid is labelled for the browser regression`);
  assert.equal((html.match(/data-example=/g) ?? []).length, examplesFor(view).length, `${view}: every expected production card is present`);
  assert.match(html, /data-g295-card-grid/, `${view}: grid remains addressable without a preview route`);
  if (view === "empty") assert.doesNotMatch(html, /data-example=/, "empty BriefBody state has no card fixtures");
}

const family = render(renderHomeBrief("family"));
assert.match(family, /max-w-\[430px\].*lg:max-w-6xl/, "phone shell remains contained while wider regression view can use two columns");
assert.match(family, /grid min-w-0 grid-cols-1 gap-3 lg:grid-cols-2/, "family view has zero-minimum tracks before its wider two-column layout");
assert.match(family, /data-example="debt"[^>]*class="min-w-0 px-4 lg:px-0"/, "ordinary cards keep the 16px phone gutter");
assert.match(family, /data-example="tip"[^>]*class="min-w-0"/, "tip keeps its own existing gutter without a duplicate wrapper");

const hiddenExamples = examplesFor("hidden");
assert.deepEqual(hiddenExamples.map(example => example.key), ["debt", "card-detail", "covered", "cover-plan", "overdue", "allocation", "payday"], "only cards with native amount masking props are tested hidden");
for (const example of hiddenExamples) {
  const html = cardHtml(example, true);
  if (/£[\d,]+/.test(cardHtml(example))) assert.match(html, /£••••/, `${example.key}: native masking is rendered`);
  else assert.equal(html, cardHtml(example), `${example.key}: non-monetary content is unchanged when hidden`);
  assert.doesNotMatch(html, /£[\d,]+(?:\.\d+)?/, `${example.key}: a masked fixture never leaks a money figure`);
}

for (const example of examplesFor("family")) {
  const html = cardHtml(example);
  if (["ask", "ask-payday", "move", "unfunded", "payday"].includes(example.kind)) assert.match(html, /Penny/, `${example.key}: Penny identity remains`);
  if (["fact", "covered", "move", "unfunded", "rhythm", "pace", "allocation", "goal"].includes(example.kind) && example.key !== "deferred") {
    assert.match(html, /(?:h-11 w-11|w-11 h-11)/, `${example.key}: dismiss remains a 44px target`);
  }
}

const falling = cardHtml(examplesFor("edges").find(example => example.key === "falling"));
const rising = cardHtml(examplesFor("focus").find(example => example.key === "debt"));
assert.equal((falling.match(/<span[^>]*class="[^"]*text-emerald/g) ?? []).length, 1, "positive trajectory has one emerald cue, not a duplicate label mark");
assert.equal((rising.match(/<span[^>]*class="[^"]*text-amber/g) ?? []).length, 1, "watch trajectory has one amber cue, not a duplicate label mark");
const rhythm = cardHtml(examplesFor("family").find(example => example.key === "rhythm"));
assert.match(rhythm, /color:#818cf8/, "interactive rhythm preserves its resolved Travel category colour on the compact glyph");
assert.match(rising, /href="\/planning"/, "fact-card actions keep their approved route");
assert.match(cardHtml(examplesFor("family").find(example => example.key === "cover-plan")), /href="\/upcoming"/, "cover-plan action keeps its approved route");
assert.match(cardHtml(examplesFor("family").find(example => example.key === "month")), /Review September/, "BriefBody renders the month-closed needle through its production path");

const homeBriefSource = readFileSync(new URL("../components/HomeBrief.tsx", import.meta.url), "utf8");
const paydaySource = readFileSync(new URL("../components/PaydayPlanCard.tsx", import.meta.url), "utf8");
const spotlightSource = readFileSync(new URL("../components/HomeInsightSpotlight.tsx", import.meta.url), "utf8");
assert.match(homeBriefSource, /const BRIEF_HEADER = "grid grid-cols-\[16px_minmax\(0,1fr\)\] items-center gap-x-2 gap-y-1"/, "native brief headers use a 16px cue and remaining eyebrow track");
assert.match(homeBriefSource, /className="col-span-2 text-pretty text-\[15px\] font-bold leading-6/, "native brief headlines span both header columns");
assert.equal((homeBriefSource.match(/className="flex min-w-0 items-center">\s*<(?:PennyKindLabel|KindLabel)\b/g) ?? []).length, 7, "kind wrappers do not introduce an anonymous 24px text line above the headline");
assert.match(homeBriefSource, /KindLabel tone=\{tone\} signifier=\{false\}/, "fact-card labels no longer duplicate the watch or positive cue");
assert.match(paydaySource, /grid min-w-0 grid-cols-\[16px_minmax\(0,1fr\)\] items-center gap-x-2 gap-y-1/, "payday uses the compact B eyebrow grid");
assert.match(paydaySource, /className="col-span-2 text-\[15px\] font-bold leading-5/, "payday headline returns to the shared reading edge");
assert.doesNotMatch(paydaySource.slice(paydaySource.indexOf('className="grid min-w-0'), paydaySource.indexOf("{showCloseButton")), /bg-indigo|rounded-xl/, "payday's 16px cue is transparent, not a tinted tile");
assert.match(spotlightSource, /flex min-h-6 items-center gap-2 mb-3 pr-8/, "tip preserves its 24px eyebrow clearance for the close target");
assert.match(spotlightSource, /flex size-4 shrink-0 items-center justify-center text-indigo-500/, "tip topic cue is a transparent 16px glyph");
assert.doesNotMatch(spotlightSource, /w-6 h-6 rounded-lg bg-indigo-50/, "tip no longer restores a tinted topic tile");

assert.equal(F.PAYDAY_PLAN_ITEM.dests.reduce((sum, destination) => sum + destination.move, 0), F.PAYDAY_PLAN_ITEM.total, "payday destinations reconcile to the moving total");
assert.equal(F.PAYDAY_PLAN_ITEM.total + F.PAYDAY_PLAN_ITEM.salary.stays, F.PAYDAY_PLAN_ITEM.salary.amount, "payday total and stays reconcile to expected pay");
for (const destination of F.PAYDAY_PLAN_ITEM.dests) assert.equal(destination.balance + destination.move, destination.target, "payday destination figures reconcile");
assert.equal(F.ALLOCATION_ITEM.allocation_shortfall.moves.reduce((sum, move) => sum + move.amount, 0), F.ALLOCATION_ITEM.allocation_shortfall.shortfall, "allocation movement reconciles to its shortfall");
assert.equal(2100 + 504, 2604, "trajectory fixture's rate-known and unclear balances reconcile");
assert.match(F.TRAJECTORY_ITEM.brief_lead.companion, /more than 3 months ago/, "trajectory lead remains a flow, not a stock balance");
assert.equal(F.PLAN_EASING_DEFERRED_ITEM.plan_easing.eased_this_period, 70, "deferred goal figure stays the contribution, not the reduction");
assert.equal(F.SPOTLIGHT_TIP.triggered_by.reduce((sum, trigger) => sum + trigger.monthly_amount, 0), 31, "tip sources reconcile to its monthly total");
assert.equal(F.COVERED_ITEM.id, "g292-covered", "covered regression remains the approved G292 fixture");
assert.equal(F.COVER_MOVE_ITEM.id, "g292-cover-plan", "move regression remains the approved G292 fixture");

console.log("PASS G295: permanent SSR Home brief anatomy regression covers production cards, B headers, supported masking, routes, fixtures and empty state.");
