// G306: Hide balances on Spend and on Home below the Safe to Spend card.
// (a) Raw-prop server renders of each changed component under the shared
//     BalancesHiddenContext (the B55 helper): hidden shows no "£" followed by a
//     digit anywhere, attributes included; visible shows the figures.
// (b) Source-level: every component in the fixed list reads the shared helper
//     or receives a hidden prop, and both pages provide the context from
//     hideNetWorth || !preferencesReady.
// Transaction amounts, bill amounts and fixed thresholds are deliberately
// visible (Home's policy) and are not asserted here.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import React from "react";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime.js";
import { renderToStaticMarkup } from "react-dom/server";
import { BalancesHiddenContext, maskMoneyText } from "../lib/balancesHidden.tsx";
import MoneyText from "../components/MoneyText.tsx";
import SpendPaceHero from "../components/SpendPaceHero.tsx";
import { SpendJourneySummary } from "../components/SpendHeader.tsx";
import SpendVerdictView from "../components/SpendVerdictView.tsx";
import SpendPaceEvidence from "../components/SpendPaceEvidence.tsx";
import { PaceCurveWidget } from "../components/SpendTrends.tsx";
import CategorySheet from "../components/CategorySheet.tsx";
import { CompactInsightRow } from "../components/InsightCard.tsx";
import HomeEstateSection from "../components/HomeEstateSection.tsx";
import { AimRing } from "../components/AimProgress.tsx";
import { DropSentence } from "../lib/comingUp.tsx";
import { fixture } from "../app/design/spend-hero/fixtures.ts";
import { estateFor, topPicks } from "../app/design/home-cleanup/fixtures.ts";

const h = React.createElement;
const noop = () => {};
const router = { back: noop, forward: noop, refresh: noop, push: noop, replace: noop, prefetch: noop };
const RAW = /£\d/;
const read = (rel) => readFileSync(new URL(rel, import.meta.url), "utf8");
const wrap = (hidden, el) => renderToStaticMarkup(h(AppRouterContext.Provider, { value: router }, h(BalancesHiddenContext.Provider, { value: hidden }, el)));
let renders = 0;
function both(label, build, { visible = RAW } = {}) {
  const hid = wrap(true, build());
  assert.doesNotMatch(hid, RAW, `${label}: no raw amount in text or attributes when hidden`);
  assert.match(hid, /£••••/, `${label}: mask shown when hidden`);
  const shown = wrap(false, build());
  assert.match(shown, visible, `${label}: figures visible when balances are shown`);
  assert.doesNotMatch(shown, /£••••/, `${label}: nothing masked when shown`);
  renders += 2;
}

// Shared helper and MoneyText.
assert.equal(maskMoneyText("−£1,020.50 and ~£340k, £1.2m", true), "−£•••• and ~£••••, £••••");
both("MoneyText", () => h(MoneyText, { text: "You pay David Lloyd £117 a month" }), { visible: /£117/ });

// Spend hero, summary, pace evidence, verdict view.
for (const state of ["normal", "unplaced", "long"]) {
  const verdict = fixture(state);
  both(`SpendPaceHero ${state}`, () => h(SpendPaceHero, { verdict, incomeTxns: [], onTransactionClick: noop, onOutTap: noop, onMovedTap: noop }));
  both(`SpendJourneySummary ${state}`, () => h(SpendJourneySummary, { verdict, incomeTxns: [], onTransactionClick: noop, onOutTap: noop, onMovedTap: noop, periodLabel: "x", isCurrentPeriod: true, canGoPrev: false, onPrev: noop, onNext: noop, swipeHandlers: {}, onOpenSettings: noop, onOpenRules: noop, onIncomeOpen: noop, recentPeriods: [], onSelectOffset: noop }));
  both(`SpendVerdictView ${state}`, () => h(SpendVerdictView, {
    verdict, colours: {}, onOpenCategory: noop, onIntent: async () => {}, onResolved: noop, resolved: {}, onNewNormalRequest: noop,
    expandMajoritySignal: 1, initialMovedOpen: true, journey: true,
  }));
}
both("SpendPaceEvidence", () => h(SpendPaceEvidence, {
  daysElapsed: 20, spent: 3509, state: "everything", unresolvedTotal: 125,
  paceSeries: [{ day: 1, actual: 186, usual: 210 }, { day: 20, actual: 3509, usual: 4010 }],
  notables: [{ category: "Eating Out", spent: 600, excess: 111, multiple: 2.1 }],
}));
both("PaceCurveWidget", () => h(PaceCurveWidget, { data: {
  periodTxns: [], allTxns: [], periodStart: new Date("2026-10-01"), periodEnd: new Date("2026-10-31"), payPeriodConfig: { type: "calendar_month" }, colours: {},
  paceSeries: [{ day: 1, actual: 186, usual: 210 }, { day: 10, actual: 1705, usual: 2005 }, { day: 20, actual: 3509, usual: 4010 }],
} }));
// CategorySheet renders nothing server-side (mounted sheet), so it is covered by the source checks below.
both("AimRing aria-label", () => h(AimRing, { periodDays: 28, aim: { id: "a", aim_amount: 100, spent_so_far: 82, days_left: 6, on_track: true, pace: { state: "on", phrase: "on pace", period_days: 28, elapsed_fraction: 0.78, pace_today: 78, projected: 104, spent_fraction: 0.82 } } }));

// Tip cards.
const insight = {
  id: "t1", category: "gym", app_category: "Gym", icon: "x", label: "Gym", title: "You pay David Lloyd £117 a month", body: "Based on 6 payments.",
  pinned: false, is_new: false, refreshed_at: null, substituted: false, substituted_merchant: null, claim_valid_until: null, content_valid_until: null,
  expiry_line: "", researched_at: null, state: "fresh", user_context: null, has_workflow: false, app_route: null,
  triggered_by: [{ merchant_key: "dl", display_name: "David Lloyd", monthly_amount: 117, occurrences: 6 }],
};
both("CompactInsightRow", () => h(CompactInsightRow, { insight, onExpand: noop }), { visible: /~£117\/mo/ });

// Home estate balances.
for (const c of ["4", "20"]) {
  const e = estateFor(c);
  const { top } = topPicks(e.accounts, e.pinnedIds, e.investment);
  both(`HomeEstateSection ${c}`, () => h(HomeEstateSection, {
    loading: false, accountCount: e.accounts.length, topPickAccounts: top, topPickInvestment: e.investment, totalAccountCount: e.total,
    pinnedIds: e.pinnedIds, onOpenAccount: noop, onOpenInvestments: noop, onViewAll: noop, emptyState: null,
  }));
}

// Home "Coming up" fortnight sums.
{
  const bill = (amount, daysAway, date, name) => ({ name, amount, daysAway, date, kind: "commitment" });
  const bills = [bill(800, 3, "Mon 26 Oct", "Rent"), bill(60, 5, "Wed 28 Oct", "Phone")];
  both("DropSentence", () => h("p", null, h(DropSentence, { bills })), { visible: /£\d/ });
}

// (b) Source-level coverage of every fixed site.
const FIXED = {
  "components/MoneyText.tsx": /useBalancesHidden/,
  "components/SpendPaceHero.tsx": /useMaskedFormatter/,
  "components/SpendHeader.tsx": /useMaskedFormatter/,
  "components/SpendVerdictView.tsx": /useMaskedFormatter/,
  "components/SpendPaceEvidence.tsx": /useMaskedFormatter/,
  "components/SpendTrends.tsx": /useMaskedFormatter/,
  "components/CategorySheet.tsx": /useBalancesHidden/,
  "components/InsightCard.tsx": /useBalancesHidden/,
  "components/AimProgress.tsx": /useBalancesHidden/,
  "components/HomeEstateSection.tsx": /useBalancesHidden/,
  "components/UpcomingBillsStrip.tsx": /useBalancesHidden/,
  "components/HomeInsightSpotlight.tsx": /MoneyText/,
  "lib/comingUp.tsx": /useBalancesHidden/,
  "components/HomeBrief.tsx": /maskMoneyText/,
};
for (const [file, re] of Object.entries(FIXED)) {
  const src = read(`../${file}`);
  assert.match(src, /balancesHidden|MoneyText/, `${file}: reads the shared helper`);
  assert.match(src, re, `${file}: uses ${re}`);
}
assert.doesNotMatch(read("../components/SpendVerdictView.tsx"), /\bconst fmt = \(n: number\)/, "SpendVerdictView: module-level fmt is the raw one only");
for (const page of ["app/components/SpendPage.tsx", "app/components/HomePage.tsx"]) {
  const src = read(`../${page}`);
  assert.match(src, /BalancesHiddenContext\.Provider value=\{[^}]*(hideNetWorth \|\| !preferencesReady|balancesHidden)/, `${page}: provides the context`);
  assert.match(src, /hideNetWorth \|\| !preferencesReady/, `${page}: hidden until preferences resolve`);
}
assert.match(read("../app/components/SpendPage.tsx"), /maskMoneyText\(`\$\{value < 0/, "SpendPage: chips and Pay arrived use the masked formatter");
assert.match(read("../components/HomeEstateSection.tsx"), /hideAmount=\{hideAmount\}/g, "estate rows pass hideAmount");

console.log(`g306-masking: ${renders} renders, ${Object.keys(FIXED).length} source checks ok`);
