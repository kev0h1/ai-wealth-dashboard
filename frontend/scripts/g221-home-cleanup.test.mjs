// G221 Home clean-up. Pins three things:
//  1. HomePage's estate block was extracted UNCHANGED into
//     components/HomeEstateSection: its markup equals the pre-extraction inline
//     JSX (BASELINE below, copied once from origin/main) for 4 and 20 accounts.
//  2. Each preview variant leaves the stated number of routes to the full
//     accounts list (A and B one, the hero link; C two, hero plus footer, said
//     plainly), and a fresh user's estate region is empty because the connect
//     card owns the route.
//  3. No em dash or exclamation mark in rendered text.
//
// Run: npm run -s check:g221-home-cleanup

import assert from "node:assert/strict";
import React from "react";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime.js";
import { renderToStaticMarkup } from "react-dom/server";
import { ChevronRight } from "lucide-react";
import HomeEstateSection from "../components/HomeEstateSection.tsx";
import FirstAccountCard from "../components/FirstAccountCard.tsx";
import AccountLedgerRow from "../components/AccountLedgerRow.tsx";
import SafeToSpendCard from "../components/SafeToSpendCard.tsx";
import { bankToRow, investmentToRow } from "../lib/accountsEstate.ts";
import { FIGURE_DATA } from "../app/design/safe-to-spend-figure/fixtures.ts";
import { SPEND_FROM_RAIL } from "../app/design/sts-accounts-route/fixtures.ts";
import { estateFor, topPicks } from "../app/design/home-cleanup/fixtures.ts";
import { EstateRegion } from "../app/design/home-cleanup/EstateVariants.tsx";
import { tidyAccountName } from "../app/design/home-cleanup/accountName.ts";
import { readFileSync } from "node:fs";

const h = React.createElement;
const noop = () => {};
const router = { back: noop, forward: noop, refresh: noop, push: noop, replace: noop, prefetch: noop };
const count = (html, needle) => html.split(needle).length - 1;
const text = (html) => html.replace(/<[^>]+>/g, " ");

// ── BASELINE: the inline JSX that lived in HomePage.tsx before G221, copied
// ONCE from origin/main (lines 1235-1298) and transcribed to createElement.
// Do not edit to follow the component: if the component's markup changes, this
// failing is the point.
function baselineEstate({ loading, accounts, topPickAccounts, topPickInvestment, investmentAccounts, hiddenAccountCount, pinnedIds }) {
  const hair = "border-t border-slate-100 dark:border-white/5";
  return h("div", { className: "rise-in px-4 lg:px-0 mt-8", style: { "--rise-index": 3 } },
    h("div", { className: "flex items-center justify-between mb-3" },
      h("p", { className: "text-[11px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500" }, "Your estate"),
      h("div", { className: "flex items-center gap-2" },
        h("button", {
          "data-tutorial-id": "tutorial-manage-link",
          onClick: noop,
          className: "min-h-[44px] text-xs font-semibold text-indigo-500 dark:text-indigo-400 flex items-center gap-1 hover:opacity-80 active:opacity-70 transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 rounded",
        }, "Manage ", h(ChevronRight, { size: 13, "aria-hidden": "true" })))),
    loading ? null : accounts.length === 0 ? null :
      h("div", { className: "glass-card rounded-2xl overflow-hidden" },
        topPickAccounts.map((acc, i) =>
          h("div", { key: acc.id, className: i > 0 ? hair : "" },
            h(AccountLedgerRow, { row: bankToRow(acc, pinnedIds), onClick: noop }))),
        topPickInvestment && h("div", { key: topPickInvestment.id, className: topPickAccounts.length > 0 ? hair : "" },
          h(AccountLedgerRow, { row: investmentToRow(topPickInvestment, pinnedIds), onClick: noop })),
        hiddenAccountCount > 0 && h("button", {
          onClick: noop,
          className: `w-full min-h-[52px] flex items-center justify-center gap-1 px-4 py-2.5 text-sm font-medium text-slate-400 dark:text-slate-500 active:bg-slate-50 dark:active:bg-white/5 transition-colors ${
            topPickAccounts.length + Math.min(investmentAccounts.length, 1) > 0 ? hair : ""
          }`,
        }, "+", hiddenAccountCount, " more accounts ", h(ChevronRight, { size: 13, "aria-hidden": "true" }))));
}

// 1. Extraction is markup-identical for 4 and 20 accounts (and 1).
for (const c of ["1", "4", "20"]) {
  const e = estateFor(c);
  const { top, hidden } = topPicks(e.accounts, e.pinnedIds, e.investment);
  const investmentAccounts = e.investment ? [e.investment] : [];
  const baseline = renderToStaticMarkup(baselineEstate({
    loading: false, accounts: e.accounts, topPickAccounts: top, topPickInvestment: e.investment,
    investmentAccounts, hiddenAccountCount: hidden, pinnedIds: e.pinnedIds,
  }));
  const actual = renderToStaticMarkup(h(HomeEstateSection, {
    className: "rise-in px-4 lg:px-0 mt-8", style: { "--rise-index": 3 },
    loading: false, accountCount: e.accounts.length, topPickAccounts: top, topPickInvestment: e.investment,
    investmentCount: investmentAccounts.length, hiddenAccountCount: hidden, pinnedIds: e.pinnedIds,
    onManage: noop, onOpenAccount: noop, onOpenInvestments: noop, onViewAll: noop, emptyState: null,
  }));
  assert.equal(actual, baseline, `${c} accounts: HomeEstateSection markup equals the pre-extraction inline JSX`);
}

// HomePage still renders the estate through the component, and FirstAccountCard too.
const homeSrc = readFileSync(new URL("../app/components/HomePage.tsx", import.meta.url), "utf8");
assert.match(homeSrc, /<HomeEstateSection\b/, "HomePage renders HomeEstateSection");
assert.match(homeSrc, /import HomeEstateSection from "@\/components\/HomeEstateSection"/);
assert.match(homeSrc, /import FirstAccountCard from "@\/components\/FirstAccountCard"/);
assert.ok(!homeSrc.includes("+{hiddenAccountCount} more accounts"), "the inline estate markup is gone from HomePage");

// 2. Routes to the full accounts list per variant and case.
const hero = renderToStaticMarkup(
  h(AppRouterContext.Provider, { value: router },
    h(SafeToSpendCard, { loading: false, onRetry: noop, previewBalancesVisible: true, data: FIGURE_DATA["on-track"], spendFrom: SPEND_FROM_RAIL })));
const heroRoutes = count(hero, 'href="/accounts"');
assert.equal(heroRoutes, 1, "the hero carries exactly one Your accounts route");

const estateRoutes = (variant, c) => {
  const html = renderToStaticMarkup(h(EstateRegion, { variant, estate: estateFor(c), labelGap: "mb-2" }));
  // Today is the production component: its routes are the Manage button and the +N more row.
  const today = variant === "today" ? count(html, "tutorial-manage-link") + count(html, "more accounts") : 0;
  return { html, routes: count(html, "data-accounts-route") + today };
};
const EXPECT = {
  today: { 1: 1, 4: 1, 20: 2 }, // Manage always, plus +N more once accounts overflow
  a: { 1: 0, 4: 0, 20: 0 },
  b: { 1: 0, 4: 0, 20: 0 },
  c: { 1: 1, 4: 1, 20: 1 },
};
for (const [variant, byCase] of Object.entries(EXPECT)) {
  for (const [c, n] of Object.entries(byCase)) {
    const { routes } = estateRoutes(variant, c);
    assert.equal(routes, n, `${variant}/${c}: estate region routes`);
  }
}
// Whole-page totals the intro promises: A and B one door, C two, today two or three.
for (const c of ["1", "4", "20"]) {
  assert.equal(heroRoutes + estateRoutes("a", c).routes, 1, `a/${c}: one route in total`);
  assert.equal(heroRoutes + estateRoutes("b", c).routes, 1, `b/${c}: one route in total`);
  assert.equal(heroRoutes + estateRoutes("c", c).routes, 2, `c/${c}: two routes in total (hero plus footer)`);
}
// B shows rows only for pinned accounts and never more than four.
for (const c of ["1", "4", "20"]) {
  const html = estateRoutes("b", c).html;
  assert.ok(!html.includes("Manage") && !html.includes("more accounts") && !html.includes("All "), `b/${c}: no Manage, more row or footer`);
}
// C's footer copy.
assert.ok(estateRoutes("c", "20").html.includes("All 20 accounts"));
assert.ok(estateRoutes("c", "4").html.includes("All 4 accounts"));
assert.ok(estateRoutes("c", "1").html.includes("See your account"));

// Fresh user: every variant's estate region is empty, the connect card owns the route.
for (const v of ["today", "a", "b", "c"]) {
  assert.equal(renderToStaticMarkup(h(EstateRegion, { variant: v, estate: estateFor("fresh"), labelGap: "mb-2" })), "", `${v}/fresh: no estate region`);
}
const fresh = renderToStaticMarkup(h(FirstAccountCard, { canConnect: true, onConnect: noop, onUploadStatement: noop, onOtherWays: noop }));
assert.equal(count(fresh, "Other ways to add accounts"), 1, "fresh: the connect card carries the one route");

// Account names: shouting names are tidied, mixed case and acronyms are kept.
assert.equal(tidyAccountName("PREMIER CURRENT"), "Premier current");
assert.equal(tidyAccountName("HSBC ADVANCE"), "HSBC advance");
assert.equal(tidyAccountName("Joint Current"), "Joint Current");
assert.equal(tidyAccountName("ISA 2025"), "ISA 2025");

// 3. Copy: no em dash, no exclamation mark in anything the variants render.
for (const v of ["a", "b", "c"]) {
  for (const c of ["1", "4", "20"]) {
    const t = text(estateRoutes(v, c).html);
    assert.ok(!/—/.test(t) && !t.includes("!"), `${v}/${c}: no em dash or exclamation mark`);
  }
}
const previewSrc = ["HomeCleanupClient.tsx", "EstateVariants.tsx"].map((f) => readFileSync(new URL(`../app/design/home-cleanup/${f}`, import.meta.url), "utf8")).join("\n");
assert.ok(!/—/.test(previewSrc), "no em dash in the preview source");

console.log("g221-home-cleanup: ok");
