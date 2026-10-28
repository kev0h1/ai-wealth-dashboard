// C37: onboarding and the plan picker follow the client's own purchase channel.
//
// Run: npm run -s check:c37-billing-channels
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import PlanPicker from "../components/PlanPicker.tsx";

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const ob = read("components/Onboarding.tsx");

// Channel mapping and the jump rule.
assert.match(ob, /purchaseChannel === "stripe_web" \? "stripe_web"/);
assert.match(ob, /purchaseChannel === "storekit" \? "apple"/);
assert.match(ob, /purchaseChannel === "play" \? "google"/);
assert.match(ob, /const channelOff = !!planInfo && channelKnown && !channelLive;/, "jump only for a known, non-live channel");
assert.ok(!/billing_live !== true/.test(ob), "onboarding no longer reads the Stripe-only flag");
assert.match(ob, /billing_live_any === true[\s\S]{0,80}api\.selectFreePlan\(\)/, "skip lands on Statements only when a channel is live");

// Bank step copy.
assert.match(ob, /Sorted can only read your data, it can never move your money\./);
assert.ok(!/Wealth|Bank-grade|Revoke anytime/.test(ob), "old bank-step copy is gone");
assert.match(ob, /Revoke any time/);
assert.match(ob, /SOURCE_LINE/);

// Types carry the new fields.
const types = read("../shared/src/types.ts");
for (const field of ["billing_channels", "billing_live_any", "tier_source", "is_default_tier"]) {
  assert.match(types, new RegExp(`${field}\\?:`), `SubscriptionInfo.${field}`);
}

// Render the plan step's picker for an Android client with Google live and
// Stripe off: it must not be reported as unavailable.
const prices = { statements: 0, lite: 5.99, standard: 9.99, plus: 12.99 };
const per = (t) => [{ id: "monthly", label: "Monthly", months: 1, total: t, saving_gbp: 0, per_month_gbp: t }];
const info = {
  tier: "plus", status: "active", prices_gbp: prices, billing_prices_gbp: {},
  billing_periods: Object.fromEntries(Object.entries(prices).map(([k, v]) => [k, per(v)])),
  billing_period: "monthly", trial_periods: ["monthly"], trial_days: 14, trial_eligible: true,
  has_paid_subscription: false, cancel_at_period_end: false,
  billing_live: false, billing_channels: { stripe_web: false, apple: false, google: true },
  billing_live_any: true, tier_source: "default", is_default_tier: true,
  topup: { messages: 0, price_gbp: 0 }, topups: [],
  limits: { open_banking: true, max_banks: 0, max_accounts: 0, refresh: "never", penny_messages_per_month: 0, mcp_tool_calls_per_month: 0, history_days: 0, statement_uploads_per_month: 0 },
  usage: { year_month: "2026-10", penny_messages: 0, cost_usd: 0 },
};
const html = renderToStaticMarkup(React.createElement(PlanPicker, { info, context: "onboarding", previewOnly: true, channelOverride: "play" }));
assert.doesNotMatch(html, /Paid plans are not available yet|Paid checkout will open when billing is live/);
assert.match(html, /Continue with Statements \(free\)/, "onboarding offers the free plan by name");
assert.doesNotMatch(html, /Current plan/, "the default plan is not labelled Current plan");
console.log("ok  c37-billing-channels");
