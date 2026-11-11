// G455: tips sit behind the backend's TIPS_ENABLED flag, exposed to clients as
// `tips_enabled` on GET /preferences. With it false (or absent) every tip
// surface and the Show tips setting is hidden, with no app rebuild.
//  1. applyWholeDocument hands the capability to the context: true only for an
//     explicit true, false for false and for an older backend's absent field.
//  2. PreferencesContext exposes the EFFECTIVE showTips (capability AND stored
//     preference) and the raw capability, defaulting to off until known.
//  3. Every tip surface reads that gate: Spend (fetch and cards),
//     Transactions (fetch and the "N tips for X" line), the Home spotlight
//     (no fetch when off, still releases Home's readiness), and the category
//     sheet sublines, all through insightsForDisplay(showTips, ...).
//  4. Settings drops the Show tips row, its error line, the Tips and insights
//     notification row and the "tips" search keyword when the capability is off.
//  5. Rendered check: with the effective gate off the Spend row has no tip
//     text and the Transactions tips line is absent.
//
// Run: npm run -s check:g455-tips-flag

import assert from "node:assert/strict";
import React from "react";
import { readFileSync } from "node:fs";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime.js";
import { renderToStaticMarkup } from "react-dom/server";
import { applyWholeDocument } from "../lib/preferencesSnapshot.ts";
import { buildSettingsGroups } from "../components/settings/SettingsDirectory.tsx";
import { MajorityRowView } from "../components/SpendVerdictView.tsx";
import { TipsLine } from "../components/TipsLine.tsx";
import { insightsForDisplay, openTipsFor } from "../lib/spendTips.ts";

const h = React.createElement;
const noop = () => {};
const read = (rel) => readFileSync(new URL(rel, import.meta.url), "utf8");

// 1. capability reaches the context
function capabilityFor(doc) {
  let seen = "never called";
  const cb = new Proxy({ applyTipsEnabled: (v) => { seen = v; } }, {
    get: (t, k) => (k in t ? t[k] : noop),
  });
  applyWholeDocument({ hide_net_worth: false, ...doc }, cb, {});
  return seen;
}
assert.equal(capabilityFor({ tips_enabled: true }), true, "explicit true shows tips");
assert.equal(capabilityFor({ tips_enabled: false }), false, "false hides tips");
assert.equal(capabilityFor({}), false, "an older backend with no field hides tips");
assert.equal(capabilityFor({ tips_enabled: "yes" }), false, "only a real boolean true counts");

// 2. context
const ctx = read("../components/PreferencesContext.tsx");
assert.ok(/showTips: tipsEnabled && showTips/.test(ctx), "effective showTips is capability AND preference");
assert.ok(/useState\(false\);\s*\n\s*const \[payPeriodConfig/.test(ctx), "capability starts false");
assert.ok(/tipsEnabled,\s*payPeriodConfig/.test(ctx), "tipsEnabled is exposed on the context value");
assert.ok(/wd_tips_enabled/.test(ctx), "last answer cached for the next visit");

// 3. surfaces
for (const f of ["../app/components/SpendPage.tsx", "../app/transactions/TransactionsPage.tsx", "../components/HomeInsightSpotlight.tsx"]) {
  assert.ok(/showTips/.test(read(f)), `${f} reads the effective gate`);
}
assert.ok(/insightsForDisplay\(showTips, categoryInsights\)/.test(read("../app/components/SpendPage.tsx")), "Spend category cards and sublines");
assert.ok(/insightsForDisplay\(showTips, insights\)/.test(read("../app/transactions/TransactionsPage.tsx")), "Transactions tips line");
const spotlight = read("../components/HomeInsightSpotlight.tsx");
assert.ok(/if \(previewInsight \|\| tipsEnabled\)/.test(spotlight), "spotlight fetches only when tips are enabled");
assert.ok(/preferencesReady/.test(spotlight) && /onReadyRef\.current\?\.\(\)/.test(spotlight), "Home readiness still released when off");

// 4. settings
const settings = read("../app/settings/SettingsPage.tsx");
assert.ok(/\{tipsEnabled && \(<>/.test(settings), "Show tips row gated");
assert.ok(/row\.key !== "insights" \|\| tipsEnabled/.test(settings), "tip notification row gated");
const status = { accountSummary: "", financialSummary: "", notificationSummary: "", planSummary: "", coverSummary: "", payPeriodSummary: "", assistantsVisible: false };
const display = (tipsEnabled) =>
  buildSettingsGroups({ ...status, tipsEnabled }).flatMap((g) => g.tasks).find((t) => t.section === "display");
assert.ok(!/\btips\b/.test(display(false).keywords), "no tips keyword when off");
assert.ok(/\btips\b/.test(display(true).keywords), "tips keyword when on");

// 5. rendered
const tip = {
  id: "mobile-1", category: "mobile", app_category: "Bills", icon: "x", label: "Mobile",
  title: "You pay EE £57 a month", body: "Checked 1 Sep.", pinned: false, is_new: false,
  refreshed_at: null, substituted: false, substituted_merchant: null, claim_valid_until: null,
  content_valid_until: null, expiry_line: "Researched 2d ago", researched_at: null, state: "fresh",
  triggered_by: [{ merchant_key: "ee", display_name: "EE", monthly_amount: 25, occurrences: 3 }],
  user_context: null, has_workflow: false, app_route: null,
};
const effective = (tipsEnabled, stored) => tipsEnabled && stored; // the context's rule
const row = { category: "Bills", spent: 120, payments_count: 3 };
const spendHtml = (show) =>
  renderToStaticMarkup(h(MajorityRowView, {
    row, colours: {}, quietTag: false, onOpen: noop,
    tips: openTipsFor("Bills", insightsForDisplay(show, [tip])),
  }));
assert.ok(/1 tip/.test(spendHtml(effective(true, true))), "tip subline with capability on");
assert.ok(!/tip/.test(spendHtml(effective(false, true))), "no tip text when capability is off, whatever the stored preference");
const router = { back: noop, forward: noop, refresh: noop, push: noop, replace: noop, prefetch: noop };
const line = (show) => {
  const tips = openTipsFor("Bills", insightsForDisplay(show, [tip]));
  return tips.length === 0 ? "" : renderToStaticMarkup(h(AppRouterContext.Provider, { value: router }, h(TipsLine, { category: "Bills", tips })));
};
assert.ok(line(effective(true, true)).includes("1 tip for Bills"));
assert.equal(line(effective(false, true)), "", "Transactions tips line absent when off");

console.log("g455-tips-flag: ok");
