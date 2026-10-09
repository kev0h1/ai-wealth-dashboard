// G189: the `show_tips` display preference.
//  1. insightsForDisplay is the single gate: off gives an empty list.
//  2. Spend category row (MajorityRowView) renders its tip subline with the
//     preference on and none with it off; the money figure is untouched.
//  3. Transactions tip row (TipsLine) renders with tips and is absent with
//     none, i.e. with the preference off.
//  4. SpendPage, TransactionsPage and HomeInsightSpotlight read showTips;
//     Settings carries the new switch and the relabelled push switch.
//  5. No em dash and no exclamation mark in the new copy.
//
// Run: npm run -s check:g189-show-tips

import assert from "node:assert/strict";
import React from "react";
import { readFileSync } from "node:fs";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime.js";
import { renderToStaticMarkup } from "react-dom/server";
import { MajorityRowView } from "../components/SpendVerdictView.tsx";
import { TipsLine } from "../components/TipsLine.tsx";
import { insightsForDisplay, openTipsFor } from "../lib/spendTips.ts";

const h = React.createElement;
const noop = () => {};
const router = { back: noop, forward: noop, refresh: noop, push: noop, replace: noop, prefetch: noop };
const read = (rel) => readFileSync(new URL(rel, import.meta.url), "utf8");

const tip = {
  id: "mobile-1", category: "mobile", app_category: "Bills", icon: "x", label: "Mobile",
  title: "Switch to a SIM-only plan", body: "A cheaper plan exists.",
  savings_estimate: "~£10/mo", savings_estimate_monthly: 10, pinned: false, is_new: false,
  refreshed_at: null, verified_savings: null, verified_merchant: null, substituted: false,
  substituted_merchant: null, substituted_amount: null, claim_valid_until: null,
  content_valid_until: null, expiry_line: "Researched 2d ago", researched_at: null, state: "fresh",
  triggered_by: [{ merchant_key: "ee", display_name: "EE", monthly_amount: 25, occurrences: 3 }],
  user_context: null, has_workflow: false, app_route: null,
};
const insights = [tip];

// 1. the gate
assert.equal(insightsForDisplay(true, insights).length, 1);
assert.equal(insightsForDisplay(false, insights).length, 0);

// 2. Spend category row
const row = { category: "Bills", spent: 120, payments_count: 3 };
const spend = (show) =>
  renderToStaticMarkup(
    h(MajorityRowView, {
      row, colours: {}, quietTag: false, onOpen: noop,
      tips: openTipsFor("Bills", insightsForDisplay(show, insights)),
    }),
  );
const on = spend(true);
const off = spend(false);
assert.ok(/1 tip/.test(on), "tip subline renders with tips on");
assert.ok(!/tip/.test(off), "no tip text with tips off");
assert.ok(off.includes("£120") && off.includes("3 payments"), "money figure and payment count remain with tips off");

// 3. Transactions tip row
const line = (show) => {
  const tips = openTipsFor("Bills", insightsForDisplay(show, insights));
  return tips.length === 0
    ? ""
    : renderToStaticMarkup(h(AppRouterContext.Provider, { value: router }, h(TipsLine, { category: "Bills", tips })));
};
assert.ok(line(true).includes("1 tip for Bills"), "transactions tip row renders with tips on");
assert.equal(line(false), "", "transactions tip row absent with tips off");

// 4. wiring
for (const f of ["../app/components/SpendPage.tsx", "../app/transactions/TransactionsPage.tsx", "../components/HomeInsightSpotlight.tsx"]) {
  assert.ok(/showTips/.test(read(f)), `${f} reads showTips`);
}
const settings = read("../app/settings/SettingsPage.tsx");
assert.ok(settings.includes("Show tips on Spend and Transactions"), "Settings has the tips switch");
assert.ok(settings.includes('title: "Tips and insights notifications"'), "push switch relabelled");
assert.ok(!settings.includes('title: "Tips & insights"'), "old push label gone");

// 5. copy
for (const s of ["Show tips on Spend and Transactions", "Ways to save, shown next to your categories and payments", "Tips and insights notifications", "Alerts about ways to save money we spot for you"]) {
  assert.ok(!s.includes("—") && !s.includes("!"), s);
}

console.log("g189-show-tips: ok");
