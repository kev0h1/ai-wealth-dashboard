// G221 Home clean-up, approved C and folded in. Pins the shipped behaviour:
//  1. HomeEstateSection renders exactly one /accounts route (the footer row)
//     for 1, 4 and 20 accounts, with the right label, no Manage button and no
//     "+N more" row; skeleton while loading; the empty state when zero.
//  2. HomePage.tsx's Home stack uses the one rhythm (mt-5 between sections,
//     mb-2 under labels, pt-5 at the top) with no mt-8 or mb-3 left, pinned
//     cards inside Your money, and HomeBrief's card stack is space-y-3.
//  3. lib/accountName.ts keeps brands and acronyms and tidies shouting names.
//  4. No em dash or exclamation mark in rendered text; the preview mirrors the
//     production rhythm classes.
//
// Run: npm run -s check:g221-home-cleanup

import assert from "node:assert/strict";
import React from "react";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime.js";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import HomeEstateSection from "../components/HomeEstateSection.tsx";
import FirstAccountCard from "../components/FirstAccountCard.tsx";
import SafeToSpendCard from "../components/SafeToSpendCard.tsx";
import { tidyAccountName } from "../lib/accountName.ts";
import { FIGURE_DATA } from "../app/design/safe-to-spend-figure/fixtures.ts";
import { SPEND_FROM_RAIL } from "../app/design/sts-accounts-route/fixtures.ts";
import { estateFor, topPicks } from "../app/design/home-cleanup/fixtures.ts";

const h = React.createElement;
const noop = () => {};
const router = { back: noop, forward: noop, refresh: noop, push: noop, replace: noop, prefetch: noop };
const count = (html, needle) => html.split(needle).length - 1;
const text = (html) => html.replace(/<[^>]+>/g, " ");
const read = (rel) => readFileSync(new URL(rel, import.meta.url), "utf8");

const estate = (c, extra = {}) => {
  const e = estateFor(c);
  const { top } = topPicks(e.accounts, e.pinnedIds, e.investment);
  return renderToStaticMarkup(h(HomeEstateSection, {
    className: "mt-5", loading: false, accountCount: e.accounts.length, topPickAccounts: top,
    topPickInvestment: e.investment, totalAccountCount: e.total, pinnedIds: e.pinnedIds,
    onOpenAccount: noop, onOpenInvestments: noop, onViewAll: noop, emptyState: null, ...extra,
  }));
};

// 1. One footer route, right label, nothing else routing to /accounts.
const LABEL = { 1: "See your account", 4: "All 4 accounts", 20: "All 20 accounts" };
for (const c of ["1", "4", "20"]) {
  const html = estate(c);
  assert.equal(count(html, "data-accounts-route"), 1, `${c}: exactly one accounts route`);
  assert.equal(count(html, "tutorial-manage-link"), 1, `${c}: the tutorial target sits on the footer`);
  assert.ok(text(html).includes(LABEL[c]), `${c}: footer reads "${LABEL[c]}"`);
  assert.ok(!html.includes("Manage"), `${c}: no Manage`);
  assert.ok(!/more accounts/.test(html), `${c}: no +N more row`);
  assert.equal(count(html, "<button"), 1, `${c}: the footer is the only button in the block`);
  assert.ok(html.includes("border-t border-slate-100"), `${c}: footer has a top border when rows precede it`);
  assert.ok(html.includes("min-h-11"), `${c}: footer is a 44px target`);
  assert.ok(!/text-indigo/.test(html.slice(html.indexOf("data-accounts-route"))), `${c}: footer ink is slate, not indigo`);
  const t = text(html);
  assert.ok(!/—/.test(t) && !t.includes("!"), `${c}: no em dash or exclamation mark`);
}
{
  // No rows: footer has no top border. (Investment-only, nothing picked.)
  const e = estateFor("4");
  const html = renderToStaticMarkup(h(HomeEstateSection, {
    loading: false, accountCount: 1, topPickAccounts: [], topPickInvestment: undefined, totalAccountCount: 3, pinnedIds: [],
    onOpenAccount: noop, onOpenInvestments: noop, onViewAll: noop, emptyState: null,
  }));
  assert.ok(!html.slice(html.indexOf("data-accounts-route")).includes("border-t"), "no border-top without rows");
  void e;
}
// Loading skeleton and empty state.
{
  const loading = estate("4", { loading: true });
  assert.ok(loading.includes("animate-pulse") && !loading.includes("data-accounts-route"), "loading: skeleton, no footer");
  const empty = renderToStaticMarkup(h(HomeEstateSection, {
    loading: false, accountCount: 0, topPickAccounts: [], totalAccountCount: 0, pinnedIds: [],
    onOpenAccount: noop, onOpenInvestments: noop, onViewAll: noop, emptyState: h("p", null, "empty state placeholder"),
  }));
  assert.ok(empty.includes("empty state placeholder") && !empty.includes("data-accounts-route"), "zero accounts: the empty state, no footer");
}
// Names are tidied on Home rows.
assert.ok(estate("20").includes("Premier current"), "Home rows show the tidy name");

// Hero keeps its one route; the fresh user's route stays on the connect card.
const hero = renderToStaticMarkup(
  h(AppRouterContext.Provider, { value: router },
    h(SafeToSpendCard, { loading: false, onRetry: noop, previewBalancesVisible: true, data: FIGURE_DATA["on-track"], spendFrom: SPEND_FROM_RAIL })));
assert.equal(count(hero, 'href="/accounts"'), 1, "the hero carries exactly one Your accounts route");
const fresh = renderToStaticMarkup(h(FirstAccountCard, { canConnect: true, onConnect: noop, onUploadStatement: noop, onOtherWays: noop }));
assert.equal(count(fresh, "Other ways to add accounts"), 1, "fresh: the connect card carries the one route");

// 2. HomePage rhythm, grep-based and scoped to the stack.
const home = read("../app/components/HomePage.tsx");
assert.match(home, /<HomeEstateSection\b/);
assert.ok(!home.includes("onManage"), "HomePage passes no onManage");
assert.match(home, /totalAccountCount=\{accounts\.length \+ investmentAccounts\.length\}/);
const skeletonStart = home.indexOf("function HomeSkeleton");
const stackEnd = home.indexOf("tutorial-recent-transactions");
assert.ok(skeletonStart > 0 && stackEnd > skeletonStart, "stack region located");
// Strip the load-error card (its inner paragraph margin is card content, not stack rhythm).
const region = home.slice(skeletonStart, stackEnd).replace(/\{\/\* Load error fallback \*\/\}[\s\S]*?\{\/\* ── WHERE YOU STAND/, "");
assert.ok(!/\bmt-8\b/.test(region), "no mt-8 in the Home stack");
assert.ok(!/\bmb-3\b/.test(region), "no mb-3 in the Home stack");
assert.ok(!/\bmt-6\b/.test(region) && !/\bmt-4\b/.test(region), "no mt-6 or mt-4 section boundary");
assert.ok(count(region, "pt-5") >= 2, "the top padding is pt-5");
assert.ok(count(region, "mt-5") >= 9, "section boundaries use mt-5");
assert.ok(count(region, "mb-2") >= 4, "labels use mb-2");
assert.match(home, /pb-5 lg:px-0 mt-5 lg:mt-0" data-tutorial-id="tutorial-recent-transactions"/, "Recent transactions keeps lg:mt-0");
for (const id of ["tutorial-safe-to-spend", "tutorial-recent-transactions", "tutorial-home-fresh", "tutorial-home-fresh-cta"]) {
  assert.ok(home.includes(id), `${id} kept`);
}
// Pinned cards live inside the Your money group, not a block of their own.
const moneyAt = home.indexOf("── YOUR MONEY ──");
const estateAt = home.indexOf("<HomeEstateSection");
const pinnedAt = home.indexOf("{pinnedCards.includes(\"fuel\") && <FuelSavingsCard />}");
assert.ok(moneyAt < pinnedAt && pinnedAt < estateAt, "pinned cards sit inside Your money, before the estate");
assert.ok(home.slice(moneyAt, pinnedAt).includes("<OfferCard />"), "pinned cards follow the Your money cards in the same group");
// The pinned-cards block is not gated by loadError (it rendered on a load error before G221).
assert.match(home, /const showPinnedCards =\n\s+!hasNoAccounts && !loading &&/, "showPinnedCards ignores loadError");
assert.ok(!/showPinnedCards =[^;]*loadError/.test(home), "showPinnedCards has no loadError term");
assert.match(home, /\{!hasNoAccounts && \(!loadError \|\| showPinnedCards\) && \(/, "the Your money wrapper renders for pinned cards on a load error");
assert.match(home, /\{showPinnedCards && \(\n\s+<div className="space-y-3 px-4 lg:px-0">/, "pinned cards block gated by showPinnedCards only");
// HomeBrief's card stack.
const brief = read("../components/HomeBrief.tsx");
assert.match(brief, /<div className="space-y-3">\n\s+\{celebrationItems\.map/, "HomeBrief card stack is space-y-3");
assert.match(brief, /\{\/\* Brief body \*\/\}\n\s+<div className="space-y-3">/, "HomeBrief body is space-y-3");

// The tutorial still has a target and no longer says Manage.
const tut = read("../components/TutorialContext.tsx");
assert.ok(tut.includes('target: "tutorial-manage-link"') && !/Manage opens/.test(tut), "tutorial step points at the footer and does not say Manage");

// 3. Account names: shouting names are tidied, brands and acronyms are kept.
const cases = [
  ["PREMIER CURRENT", "Premier current"],
  ["NATWEST ISA", "NatWest ISA"],
  ["NATWEST EVERYDAY", "NatWest everyday"],
  ["HSBC ADVANCE", "HSBC advance"],
  ["TSB CLUB LISA", "TSB club LISA"],
  ["RBS SELECT", "RBS select"],
  ["AMEX PLATINUM", "Amex platinum"],
  ["STOCKS AND SHARES JISA", "Stocks and shares JISA"],
  ["WORKPLACE SIPP", "Workplace SIPP"],
  ["WORLD ETF", "World ETF"],
  ["FTSE TRACKER", "FTSE tracker"],
  ["GIA", "GIA"],
  ["PAYE REFUND POT", "PAYE refund pot"],
  ["SAVE & SPEND", "Save & spend"],
  ["NS&I PREMIUM BONDS", "NS&I premium bonds"],
  ["ISA 2025", "ISA 2025"],
  ["Joint Current", "Joint Current"],
  ["Monzo Bills", "Monzo Bills"],
];
for (const [i, o] of cases) assert.equal(tidyAccountName(i), o, `tidyAccountName(${i})`);

// 4. The preview mirrors production and has no em dash.
const previewSrc = ["HomeCleanupClient.tsx", "fixtures.ts"].map((f) => read(`../app/design/home-cleanup/${f}`)).join("\n");
assert.ok(!/—/.test(previewSrc), "no em dash in the preview source");
assert.ok(!previewSrc.includes("EstateRegion"), "the preview renders only the production estate section");
assert.match(previewSrc, /top: "pt-5", brief: "space-y-3", section: "mt-5", label: "mb-2", group: "space-y-3", tail: "pb-5"/, "preview rhythm constants mirror production");

console.log("g221-home-cleanup: ok");
