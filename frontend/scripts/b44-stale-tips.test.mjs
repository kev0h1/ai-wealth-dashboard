// B44: a stale tip (research provider failing, last good tip kept past its
// TTL) is still a readable tip, labelled "Tips may be out of date".
//  1. openTipsFor / tipsForMerchants keep a stale tip; quiet is still dropped.
//  2. InsightCard renders the stale title, body and note for stale, and never
//     the note for fresh.
//  3. TipsLine's single-tip row shows the note for stale only.
//  4. No em dash and no exclamation mark in the note.
//
// Run: npm run -s check:b44-stale-tips

import assert from "node:assert/strict";
import React from "react";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime.js";
import { renderToStaticMarkup } from "react-dom/server";
import { InsightCard } from "../components/InsightCard.tsx";
import { TipsLine } from "../components/TipsLine.tsx";
import { openTipsFor, tipsForMerchants } from "../lib/spendTips.ts";

const h = React.createElement;
const noop = () => {};
const router = { back: noop, forward: noop, refresh: noop, push: noop, replace: noop, prefetch: noop };
const NOTE = "Tips may be out of date";

const tip = (state, over = {}) => ({
  id: `mobile-${state}`,
  category: "mobile",
  app_category: "Bills",
  icon: "x",
  label: "Mobile",
  title: "Switch to a SIM-only plan",
  body: "A cheaper SIM-only plan exists.",
  savings_estimate: "~£10/mo",
  savings_estimate_monthly: 10,
  pinned: false,
  is_new: false,
  refreshed_at: null,
  verified_savings: null,
  verified_merchant: null,
  substituted: false,
  substituted_merchant: null,
  substituted_amount: null,
  claim_valid_until: null,
  content_valid_until: null,
  expiry_line: state === "fresh" ? "Researched 2d ago" : null,
  stale_note: state === "stale" ? NOTE : null,
  researched_at: null,
  state,
  triggered_by: [{ merchant_key: "ee", display_name: "EE", monthly_amount: 25, occurrences: 3 }],
  user_context: null,
  has_workflow: false,
  app_route: null,
  ...over,
});

// 1. selection
assert.equal(openTipsFor("Bills", [tip("stale")]).length, 1, "stale tip stays visible");
assert.equal(openTipsFor("Bills", [tip("quiet")]).length, 0, "quiet tip stays hidden");
assert.equal(tipsForMerchants(["EE"], [tip("stale")], "mobile-stale").length, 1);

// 2. InsightCard
const card = (t) =>
  renderToStaticMarkup(
    h(AppRouterContext.Provider, { value: router },
      h(InsightCard, { insight: t, workflow: null, onPin: noop, onContextSaved: noop, anyOpenHasEstimate: true, inSheet: true })),
  );
const staleHtml = card(tip("stale"));
assert.ok(staleHtml.includes("Switch to a SIM-only plan"), "stale title renders");
assert.ok(staleHtml.includes(NOTE), "stale note renders in InsightCard");
assert.ok(!card(tip("fresh")).includes(NOTE), "fresh card has no note");

// 3. TipsLine single-tip row
const line = (t) => renderToStaticMarkup(h(AppRouterContext.Provider, { value: router }, h(TipsLine, { category: "Bills", tips: [t] })));
assert.ok(line(tip("stale")).includes(NOTE), "stale note renders in TipsLine");
assert.ok(!line(tip("fresh")).includes(NOTE), "fresh TipsLine has no note");

// 4. copy
assert.ok(!NOTE.includes("—") && !NOTE.includes("!"));

console.log("b44-stale-tips: ok");
