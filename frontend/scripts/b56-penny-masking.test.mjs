// B56: Penny honours Hide balances. Raw props, server-rendered, with the
// BalancesHiddenContext provider set to hidden=true and hidden=false (the
// app-level AppBalancesHidden provides the real preference). Fixed prices and
// thresholds stay visible through the `unmasked` opt-out.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime.js";
import { BalancesHiddenContext } from "../lib/balancesHidden.tsx";
import { VerdictBubble, ProposalConfirmCard, SuggestionChip } from "../components/PennyConversation.tsx";
import PennyReplyText, { PennyMarkdownBlock } from "../components/PennyMarkdown.tsx";
import PennyTable from "../components/PennyTable.tsx";
import PennyChart from "../components/PennyChart.tsx";
import PaydayPlanCard from "../components/PaydayPlanCard.tsx";
import { BriefBody } from "../components/HomeBrief.tsx";
import * as F from "./fixtures/g295-home-brief-anatomy.ts";

const noop = () => {};
const router = { bfcacheId: "b56", push: noop, replace: noop, refresh: noop, back: noop, forward: noop, prefetch: async () => {} };
const wrap = (hidden, el) => renderToStaticMarkup(h(AppRouterContext.Provider, { value: router }, h(BalancesHiddenContext.Provider, { value: hidden }, el)));
const text = (html) => html.replace(/<[^>]+>/g, " ");
const RAW = /£\d/;
const TIER = "Penny Plus is £5.99 a month.";
let renders = 0;

const table = {
  title: "Where it went", columns: [{ key: "shop", label: "Shop", kind: "text" }, { key: "spent", label: "Spent", kind: "money" }],
  rows: [{ shop: "Barclays", spent: { amount: 1234.56, currency: "GBP" } }, { shop: "Tesco", spent: { amount: 48, currency: "GBP" } }],
  note: "Total £1,282.56 this month.",
};
const verdict = (extra = {}) => ({ id: 1, role: "assistant", kind: "verdict", headline: "Yes, you can. That leaves £61 free until Friday.", reply: "You have £1,234.56 in Barclays.", facts: [], offer: null, table: null, chart: null, degraded: false, ...extra });
const bubble = (hidden, extra) => wrap(hidden, h(VerdictBubble, { msg: verdict(extra), onOfferTap: noop }));

// 1. Chat answer with a streamed £ figure and a table.
{
  const hiddenHtml = bubble(true, { table });
  assert.doesNotMatch(hiddenHtml, RAW, "answer + table: no raw amount anywhere in the markup");
  assert.match(hiddenHtml, /£••••/, "mask shown");
  assert.match(hiddenHtml, /Amount hidden/, "screen readers hear 'Amount hidden'");
  assert.match(hiddenHtml, /role="img" aria-label="Amount hidden" class="money">£••••<\/span>/, "mask glyphs are replaced by an accessible name");
  assert.match(hiddenHtml, /Barclays/, "non-money text remains");
  const shown = bubble(false, { table });
  assert.match(shown, /£1,234\.56/, "visible: reply figure");
  assert.match(shown, /£61/, "visible: headline figure");
  assert.match(shown, /£1,282\.56/, "visible: table note figure");
  assert.doesNotMatch(shown, /£••••|Amount hidden/, "visible: nothing masked");
  renders += 2;
}

// 2. Markdown replies, including pipe tables, and the unmasked tier price.
{
  const md = "You have **£1,234.56** in Barclays.\n\n| Shop | Spent |\n| --- | --- |\n| Tesco | £48.00 |\n";
  const hiddenHtml = wrap(true, h(PennyReplyText, { text: md }));
  assert.doesNotMatch(hiddenHtml, RAW, "markdown + pipe table masked");
  assert.match(hiddenHtml, /Amount hidden/);
  assert.match(wrap(false, h(PennyReplyText, { text: md })), /£1,234\.56[\s\S]*£48\.00/, "markdown visible when not hidden");
  const tier = wrap(true, h(PennyMarkdownBlock, { text: TIER, unmasked: true }));
  assert.match(text(tier), /£5\.99/, "tier price stays visible under Hide balances via unmasked");
  const plain = wrap(true, h(PennyReplyText, { text: TIER, unmasked: true }));
  assert.match(text(plain), /£5\.99/, "plain-text tier price stays visible");
  const mixed = wrap(true, h(PennyMarkdownBlock, { text: `${TIER} You have £1,234.56 left.` }));
  assert.doesNotMatch(mixed, RAW, "a streamed answer mixing a tier price and a balance masks both (accepted)");
  const tierDefault = wrap(true, h(PennyReplyText, { text: TIER }));
  assert.doesNotMatch(tierDefault, RAW, "without the opt-out even a tier price masks");
  renders += 6;
}

// 3. Standalone table and chart (tooltips and ticks are hidden with the figures).
{
  assert.doesNotMatch(wrap(true, h(PennyTable, { table })), RAW, "table masked");
  assert.match(wrap(false, h(PennyTable, { table })), /£1,234\.56/, "table visible");
  const chart = {
    type: "bar", title: "Eating Out by month", x: { label: "Month", kind: "category" }, y: { label: "Spent", unit: "money", currency: "GBP" },
    series: [{ name: "Eating Out", points: [{ x: "Jul 2026", y: { amount: 176, currency: "GBP" } }, { x: "Aug 2026", y: { amount: 312, currency: "GBP" } }] }],
    summary: "Eating Out by month: highest in Aug 2026 at £312, lowest in Jul 2026 at £176.",
  };
  const hiddenChart = wrap(true, h(PennyChart, { chart }));
  assert.doesNotMatch(hiddenChart, RAW, "chart summary, aria-label and legend masked");
  assert.match(wrap(false, h(PennyChart, { chart })), /£312/, "chart summary visible");
  const src = readFileSync(new URL("../components/PennyChart.tsx", import.meta.url), "utf8");
  assert.match(src, /<YAxis hide=\{hideY\}/, "money Y-axis ticks are hidden when masked");
  assert.match(src, /hidden \? <MaskedAmount/, "tooltip and legend values are masked");
  renders += 4;
}

// 4. Payday Plan card and the live brief entry.
{
  const props = (hidden) => ({ item: F.PAYDAY_PLAN_ITEM, router, hideNetWorth: false, maskAmounts: (t) => t, dismissible: false });
  const hiddenHtml = wrap(true, h(PaydayPlanCard, props()));
  assert.doesNotMatch(hiddenHtml, RAW, "Payday Plan: provider alone masks every figure, even with hideNetWorth=false");
  assert.match(hiddenHtml, /Amount hidden/);
  assert.match(wrap(false, h(PaydayPlanCard, props())), /£\d/, "Payday Plan visible when balances shown");
  const body = (hidden) => wrap(hidden, h(BriefBody, { items: [F.PAYDAY_PLAN_ITEM], safeToSpend: null, router, onRefresh: noop }));
  assert.doesNotMatch(body(true), RAW, "BriefBody (Penny's brief) masks with the provider and no prop");
  renders += 3;
}

// 5. Proposal card, suggestion chip (Can I chip).
{
  const proposal = { proposal_id: "p1", kind: "envelope", summary: "Set aside £120 a month for Holiday", consequence: "That leaves £61 free until Friday.", params: {} };
  const card = (hidden, status = "pending") => wrap(hidden, h(ProposalConfirmCard, { msg: { id: 2, role: "assistant", kind: "proposal", proposal, status }, onConfirm: noop, onCancel: noop, onOpenDone: noop }));
  for (const status of ["pending", "done"]) {
    assert.doesNotMatch(card(true, status), RAW, `proposal ${status}: masked`);
    assert.match(card(false, status), /£120/, `proposal ${status}: visible`);
  }
  assert.doesNotMatch(card(true, "error"), RAW);
  assert.doesNotMatch(wrap(true, h(SuggestionChip, { label: "Can I spend £45 this weekend?", onTap: noop })), RAW, "Can I chip masked");
  assert.match(wrap(false, h(SuggestionChip, { label: "Can I spend £45 this weekend?", onTap: noop })), /£45/, "Can I chip visible");
  renders += 8;
}

// 6. Source checks: one app-level provider, no per-page copies, /design stays visible.
{
  const read = (p) => readFileSync(new URL(p, import.meta.url), "utf8");
  const providers = read("../app/Providers.tsx");
  assert.match(providers, /<PreferencesProvider>\s*<AppBalancesHidden>/, "provider sits just inside PreferencesProvider");
  const app = read("../components/AppBalancesHidden.tsx");
  assert.match(app, /BalancesHiddenContext\.Provider value=\{hidden\}/);
  assert.match(app, /hideNetWorth \|\| !preferencesReady/, "hidden until preferences resolve");
  assert.match(app, /!isDesignPreviewPath\(pathname\)/, "/design previews are exempt");
  const { isDesignPreviewPath } = await import("../components/AppBalancesHidden.tsx");
  assert.equal(isDesignPreviewPath("/design/foo"), true);
  assert.equal(isDesignPreviewPath("/design"), true);
  assert.equal(isDesignPreviewPath("/designer"), false);
  assert.equal(isDesignPreviewPath("/penny"), false);
  for (const page of ["../app/components/HomePage.tsx", "../app/components/SpendPage.tsx", "../app/planning/PlanningPage.tsx"]) {
    assert.doesNotMatch(read(page), /BalancesHiddenContext/, `${page}: per-page provider removed`);
  }
  const layout = read("../app/layout.tsx");
  assert.match(layout, /<Providers>[\s\S]*<PennySheetProvider>/, "layout-level Penny sheet is inside Providers");
}

console.log(`b56 penny masking ok (${renders} renders)`);
