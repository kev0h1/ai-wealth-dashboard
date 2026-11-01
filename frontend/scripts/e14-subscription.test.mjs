// E14: pins the People page Subscription section: collapsed by default, the
// four actions with a reason and the typed confirmations (plan name, pack
// name, RESET), the live-provider guard copy, neutral confirms (no red), the
// audit labels, and the Your plan "Set by Sorted" line. Copy rules apply.
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { createElement as h } from "react";
import { renderToStaticMarkup as render } from "react-dom/server";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime.js";
import YourPlanCard from "../components/YourPlanCard.tsx";
import SubscriptionSection from "../app/ops/people/SubscriptionSection.tsx";
import { planFixture } from "./fixtures/g296-settings.ts";
import {
  SUB_WORDING, TIERS, PACKS, providerGuard, providerLabel, statusLabel, sourceLabel, periodLabel, grantLabel,
  pennyLabel, packLabel, mcpLabel, trialLabel, renewalLabel, expectedConfirm, confirmOk, canSubmit,
} from "../app/ops/people/subscription.ts";
import { ACTION_LABELS } from "../app/ops/people/people.ts";

const read = (p) => readFileSync(new URL(p, import.meta.url), "utf8");
const section = read("../app/ops/people/SubscriptionSection.tsx");
const page = read("../app/ops/people/page.tsx");
const helpers = read("../app/ops/people/subscription.ts");
const apiSrc = read("../lib/api.ts");

// Backend routes the section calls.
for (const route of ["/subscription`", "/subscription/set-tier`", "/subscription/topup`", "/subscription/reset-trial`", "/subscription/cancel-grant`"]) {
  assert.ok(apiSrc.includes(route), `api.ts has ${route}`);
}

// Collapsed by default: nothing but the toggle renders, and it says so to assistive tech.
const html = render(h(SubscriptionSection, { personId: "abc123abc123abc123" }));
assert.match(html, /aria-expanded="false"/);
assert.match(html, />Subscription</);
assert.ok(!/Set plan|Reset trial|Grant Penny pack/.test(html), "no actions until opened");
assert.match(section, /useState\(false\)/);
assert.match(section, /if \(next\) void fetchSub\(\)/, "refetches on every open");

// Both layouts carry the section, signed-up rows only.
assert.match(page, /\{person\.signed_up && <SubscriptionSection personId=\{person\.id\} \/>\}/, "card");
assert.match(page, /<SubscriptionSection personId=\{p\.id\} \/>/, "table");

// The three typed confirmations, and the neutral one.
const ctx = { tier: "lite", pack: "medium" };
assert.equal(expectedConfirm("set-tier", ctx), "lite");
assert.equal(expectedConfirm("topup", ctx), "medium");
assert.equal(expectedConfirm("reset-trial", ctx), "RESET");
assert.equal(expectedConfirm("cancel-grant", ctx), null);
assert.equal(confirmOk("set-tier", " Lite ", ctx), true);
assert.equal(confirmOk("set-tier", "plus", ctx), false);
assert.equal(confirmOk("topup", "medium", ctx), true);
assert.equal(confirmOk("topup", "small", ctx), false);
assert.equal(confirmOk("reset-trial", "RESET", ctx), true);
assert.equal(confirmOk("reset-trial", "reset", ctx), false);
assert.equal(confirmOk("cancel-grant", "", ctx), true);
assert.equal(canSubmit("set-tier", "lite", "  ", ctx), false, "a reason is required");
assert.equal(canSubmit("set-tier", "lite", "Comped", ctx), true);
assert.equal(canSubmit("reset-trial", "", "Support", ctx), false);
assert.match(section, /disabled=\{!ok \|\| busy\}/);
assert.match(section, /canSubmit\(action, typed, reason, ctx\)/);
assert.deepEqual([...TIERS], ["statements", "lite", "standard", "plus"]);
assert.deepEqual([...PACKS], ["small", "medium", "large"]);
assert.equal(SUB_WORDING.typeReset, "Type RESET to confirm");

// Provider guard copy.
assert.equal(providerGuard("stripe"), "Live Stripe subscription. Manage it in Stripe, not here.");
assert.match(providerGuard("apple"), /Manage it in the store/);
assert.match(providerGuard("google"), /Manage it in the store/);
assert.equal(providerGuard(null), null);
assert.match(section, /\{!guard && \(/, "Set plan is hidden while a provider subscription is live");
assert.match(section, /data-provider-guard/);

// Labels.
const sub = {
  tier: "lite", billing_period: null, provider: "none", provider_live: false, live_provider: null, status: "default",
  trial_started_at: null, trial_ends_at: null, renews_at: null, cancels_at: null, has_paid_subscription: false,
  tier_source: "manual", manual_grant: { tier: "lite", expires_at: "2026-12-01T23:59:59+00:00", lapsed: false },
  can_reset_trial: false,
  penny: { monthly_allowance: 300, used: 7, remaining: 293, topup_messages: 20, packs: [{ messages: 20, remaining: 20, source: "admin", expires_at: "2027-01-01T00:00:00+00:00" }] },
  mcp: { allowance: 5000, used: 3, remaining: 4997 }, pack_ids: ["small", "medium", "large"],
};
assert.equal(providerLabel(sub), "None");
assert.equal(providerLabel({ ...sub, provider: "stripe", provider_live: true }), "Stripe, live");
assert.equal(statusLabel("default"), "Default plan");
assert.equal(statusLabel("past_due"), "Payment overdue");
assert.equal(sourceLabel("manual"), "Set by Sorted");
assert.equal(periodLabel(null), "None");
assert.equal(grantLabel(sub), "Lite, until 1 Dec 2026");
assert.equal(grantLabel({ ...sub, manual_grant: { tier: "lite", expires_at: null, lapsed: false } }), "Lite, no end date");
assert.equal(grantLabel({ ...sub, manual_grant: null }), "None");
assert.equal(pennyLabel(sub), "7 used of 300 a month, plus 20 from packs");
assert.match(packLabel(sub.penny.packs[0]), /^Granted, 20 of 20 left, expires 1 Jan 2027$/);
assert.equal(mcpLabel(sub), "3 used of 5000");
assert.equal(trialLabel(sub), "No trial on record");
assert.equal(renewalLabel(sub), "None");
assert.equal(renewalLabel({ ...sub, cancels_at: "2026-12-01T00:00:00+00:00" }), "Cancels 1 Dec 2026");

// Audit entries have readable labels in the existing Activity list.
for (const k of ["set_tier", "grant_topup", "reset_trial", "cancel_grant"]) assert.ok(ACTION_LABELS[k], `label for ${k}`);

// No red anywhere in the section: nothing here deletes data.
assert.ok(!/(text|bg|border)-red/.test(section + helpers), "no red");
assert.match(section, /bg-indigo-600/, "neutral confirm");

// Your plan card: Set by Sorted, with and without an end date.
const noop = () => {};
const router = { bfcacheId: "e14", push: noop, replace: noop, refresh: noop, back: noop, forward: noop, prefetch: async () => {} };
const plan = (overrides) => render(h(AppRouterContext.Provider, { value: router }, h(YourPlanCard, { info: { ...planFixture("paid", "web"), has_paid_subscription: false, status: "active", cancel_at_period_end: false, ...overrides } })));
assert.match(plan({ tier_source: "manual", is_default_tier: false, tier_expires_at: "2026-12-01T23:59:59+00:00" }), /Set by Sorted until 1 Dec 2026\./);
assert.match(plan({ tier_source: "manual", is_default_tier: false, tier_expires_at: null }), /Set by Sorted\./);
assert.ok(!/Set by Sorted/.test(plan({ tier_source: "default", is_default_tier: true })));

// Copy rules: no em dashes, no exclamation marks.
const copy = [section, helpers, ...Object.values(SUB_WORDING), ...Object.values(ACTION_LABELS)].join("\n");
assert.ok(!/—/.test(copy), "no em dashes");
assert.ok(!/!(?!=)/.test([...Object.values(SUB_WORDING), providerGuard("stripe"), providerGuard("apple")].join("")), "no exclamation marks");
console.log("check:e14-subscription OK");
