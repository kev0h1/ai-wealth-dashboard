// G310: a Spend section with nothing to say is not rendered, timeline node
// included. Synthetic fixtures only (scripts/fixtures/g293-spend-spacing.ts).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import SpendVerdictView from "../components/SpendVerdictView.tsx";
import SpendPaceHero from "../components/SpendPaceHero.tsx";
import { spacingFixture, spacingIncome } from "./fixtures/g293-spend-spacing.ts";

const noop = () => {};
const view = (verdict) => renderToStaticMarkup(h(SpendVerdictView, {
  verdict, colours: {}, onOpenCategory: noop, onIntent: async () => {}, onResolved: noop, resolved: {},
  onNewNormalRequest: noop, expandMajoritySignal: 0, journey: true,
}));
const hero = (verdict) => renderToStaticMarkup(h(SpendPaceHero, {
  verdict, incomeTxns: spacingIncome(verdict), onTransactionClick: noop, onOutTap: noop, onMovedTap: noop,
}));

const empty = spacingFixture("empty");
const full = spacingFixture("current");

const emptyView = view(empty);
assert.doesNotMatch(emptyView, /quieter categor/, "empty: no quieter categories count");
assert.doesNotMatch(emptyView, /Nothing to show yet/, "empty: no placeholder");
assert.doesNotMatch(emptyView, /The rest of your spending/, "empty: no rest-of-spending heading");
assert.doesNotMatch(emptyView, /id="spend-majority-section"/, "empty: no rest-of-spending section");
assert.doesNotMatch(emptyView, /border-slate-300 bg-white/, "empty: no orphan timeline node");
assert.doesNotMatch(emptyView, /Money moved on a separate route/, "empty: no moved section");

const fullView = view(full);
assert.match(fullView, /The rest of your spending/, "non-empty: section present");
assert.match(fullView, /1 quieter category/, "non-empty: count present");
assert.match(fullView, /id="spend-majority-section"/);

const emptyHero = hero(empty);
assert.match(emptyHero, /£0\.00/, "empty hero keeps the £0.00 In figure");
assert.doesNotMatch(emptyHero, /Show income payments/, "empty hero: no In expand control");
assert.doesNotMatch(emptyHero, /aria-expanded/, "empty hero: nothing expandable");
assert.doesNotMatch(emptyHero, /Income this period/, "empty hero: no income panel");
assert.doesNotMatch(emptyHero, /How Out adds up/, "empty hero: no hollow Out breakdown");
assert.match(emptyHero, /There is no spending to compare yet/, "empty hero keeps its line");

const fullHero = hero(full);
assert.match(fullHero, /Show income payments/, "non-empty hero: In expands");
assert.match(fullHero, /aria-expanded="false"/);
assert.match(fullHero, /Income this period/);
assert.match(fullHero, /How Out adds up/);

const page = readFileSync(new URL("../app/components/SpendPage.tsx", import.meta.url), "utf8");
const pay = page.indexOf("payArrivedText(verdict"); // G326: the node text now comes from lib/spendPeriod.ts
assert.ok(pay > 0, "Pay arrived entry present");
const guard = page.lastIndexOf("{verdict.pills.income > 0 && (", pay);
assert.ok(guard > 0, "Pay arrived guarded on income > 0");
assert.ok(!page.slice(guard, pay).includes("</section>"), "guard wraps the same section as the node");
assert.match(page.slice(guard, pay), /WalletCards/, "node and text share the guarded section");
assert.match(page, /verdict\.majority\.some\(\(r\) => r\.spent > 0\)/, "Spending chip only when its section exists");
assert.match(page, /getElementById\("spend-majority-section"\) \? "spend-majority-section" : "spend-journey-changes"/, "Out tap falls back to Changes");
console.log("g310 spend empty ok");
