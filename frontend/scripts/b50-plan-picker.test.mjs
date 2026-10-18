// B50: production plan-picker regression coverage. This renders the real
// component through the TSX loader, but stays inert: previewOnly prevents any
// plan or billing mutation and nativeOverride makes the platform gate explicit.
//
// Run: npm run -s check:b50-plan-picker
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import PlanPicker from "../components/PlanPicker.tsx";

const sharedTypes = readFileSync(new URL("../../shared/src/types.ts", import.meta.url), "utf8");
const pickerSource = readFileSync(new URL("../components/PlanPicker.tsx", import.meta.url), "utf8");
const tierMatch = sharedTypes.match(/export type SubscriptionTier = ([^;]+);/);
assert.ok(tierMatch, "SubscriptionTier remains discoverable from the shared catalogue type");
const tiers = [...tierMatch[1].matchAll(/"([^"]+)"/g)].map((match) => match[1]);
const freeTier = "statements";
const paidTier = tiers.find((tier) => tier !== freeTier);
assert.ok(paidTier, "the shared catalogue supplies at least one paid plan");
const supportsAvailableTiers = /\bavailable_tiers\??\s*:/.test(sharedTypes);
// When B51's server-authoritative allow-list exists, exercise a deliberately
// smaller offer set. Before then, the broad shared union is all the picker can
// truthfully derive from.
const defaultOfferedTiers = supportsAvailableTiers ? [freeTier, paidTier] : tiers;

const periods = (total = 80) => [
  { id: "monthly", label: "Monthly", months: 1, total: 8, saving_gbp: 0, per_month_gbp: 8 },
  { id: "annual", label: "Yearly", months: 12, total, saving_gbp: 16, per_month_gbp: total / 12 },
];

function infoFor(overrides = {}) {
  const prices = Object.fromEntries(tiers.map((tier) => [tier, tier === freeTier ? 0 : 8]));
  const billingPeriods = Object.fromEntries(tiers.map((tier) => [tier, tier === freeTier ? periods(0).map((item) => ({ ...item, total: 0, saving_gbp: 0, per_month_gbp: 0 })) : periods()]));
  return {
    tier: paidTier,
    status: "active",
    prices_gbp: prices,
    billing_periods: billingPeriods,
    billing_period: "annual",
    trial_periods: ["annual"],
    trial_days: 21,
    trial_charge_on: "2026-12-01",
    has_paid_subscription: false,
    trial_eligible: true,
    cancel_at_period_end: false,
    billing_live: true,
    topup: { messages: 0, price_gbp: 0 },
    topups: [],
    limits: { open_banking: false, max_banks: 0, max_accounts: 0, refresh: "never", penny_messages_per_month: 0, mcp_tool_calls_per_month: 0, history_days: 0, statement_uploads_per_month: 0 },
    usage: { year_month: "2026-10", penny_messages: 0, cost_usd: 0 },
    ...(supportsAvailableTiers ? { available_tiers: defaultOfferedTiers } : {}),
    ...overrides,
  };
}

const render = (info, nativeOverride = false) => renderToStaticMarkup(React.createElement(PlanPicker, {
  info, context: "settings", previewOnly: true, nativeOverride,
}));
const unavailablePurchaseButton = (html) => /<button(?=[^>]*\bdisabled="")[^>]*>Price unavailable<\/button>/.test(html);

// The compact selector follows the server-authoritative offer list once it is
// available, otherwise the shared tier type. Do not freeze the historical
// Max/Connect count: a new catalogue member must be selectable and show one
// focused offer card, not duplicate detail under every radio choice.
const standard = render(infoFor());
const planControls = standard.slice(standard.indexOf('aria-label="Choose a plan"'), standard.indexOf('aria-label="Selected plan and offer"'));
const planRadios = planControls.match(/role="radio"/g) ?? [];
assert.equal(planRadios.length, defaultOfferedTiers.length, "each offered plan renders as a compact radio choice");
assert.match(standard, /aria-label="Choose a plan"/, "plan choices retain a labelled radio group");
assert.match(standard, /aria-label="Selected plan and offer"/, "exactly one selected-plan detail card is rendered");
assert.equal((standard.match(/aria-label="Selected plan and offer"/g) ?? []).length, 1, "only the chosen plan gets the primary detail card");
const selectedOffer = standard.slice(standard.indexOf('aria-label="Selected plan and offer"'), standard.indexOf("data-plan-comparison"));
assert.match(selectedOffer, /<ul/, "the chosen plan keeps its full included-feature description");
assert.match(standard, /Compare all plans/, "the complete catalogue remains available behind a comparison disclosure");
assert.match(standard, /data-plan-comparison/, "comparison uses a native disclosure rather than expanding every plan by default");

// An annual selection must be the effective offer everywhere the user reads it:
// amount, renewal words and trial terms are all taken from the selected period.
assert.match(standard, /£80\.00/, "the selected annual total is shown");
assert.match(standard, /every year/, "the selected annual renewal wording is shown");
assert.match(standard, /Start 21-day free trial/, "the selected annual period offers its eligible trial");
assert.match(standard, /Then <span[^>]*>£80\.00<\/span> every year/, "trial terms use the selected period total and renewal");

// If an older saved period is no longer enabled, the first enabled detail is
// the effective period. Its amount, words and trial eligibility must travel
// together rather than mixing the stale request with the visible offer.
const fallbackPeriods = Object.fromEntries(tiers.map((tier) => [tier, tier === paidTier ? [periods()[0]] : periods()]));
const fallback = render(infoFor({ billing_periods: fallbackPeriods, billing_period: "annual", trial_periods: ["monthly"] }));
assert.match(fallback, /£8\.00/, "fallback uses the first enabled period's amount");
assert.match(fallback, /every month/, "fallback uses the first enabled period's renewal words");
assert.match(fallback, /Start 21-day free trial/, "fallback uses the first enabled period's trial eligibility");

// A native paid account is comparison-only: no checkout or portal button is
// rendered, while a web managed paid account keeps its portal action.
const managed = infoFor({ has_paid_subscription: true, status: "active", trial_eligible: false });
const nativeManaged = render(managed, true);
assert.doesNotMatch(nativeManaged, /<button[^>]*>(?:Manage plan and renewal|Fix payment in billing|Choose|Start)/, "native paid subscriptions expose no Stripe action");
assert.match(nativeManaged, /update your payment method, change your plan, or cancel from a browser/i, "native paid subscriptions explain the browser-management route");
const webManaged = render(managed, false);
assert.match(webManaged, />Manage plan and renewal<\/button>/, "web managed subscriptions retain the billing-portal action");
assert.match(webManaged, /managed securely in billing/, "the managed-paid disclosure is preserved");

// A fresh purchase requires a finite, positive selected price. None of these
// cases may promise a trial, even when the account would otherwise be eligible.
for (const [label, annual] of [["missing", undefined], ["zero", 0], ["non-finite", Number.NaN]]) {
  const billingPeriods = Object.fromEntries(tiers.map((tier) => [tier, tier === paidTier ? [{ ...periods()[1], total: annual }] : periods()]));
  const html = render(infoFor({ billing_periods: billingPeriods }));
  assert.match(html, /Price unavailable/, `${label} price is honest in the selected offer`);
  assert.ok(unavailablePurchaseButton(html), `${label} price renders a disabled unavailable purchase button`);
  assert.doesNotMatch(html, /Start 21-day free trial|21 days free/, `${label} price never promises a trial`);
}

const unknownEligibility = render(infoFor({ trial_eligible: null }));
assert.doesNotMatch(unknownEligibility, /Start 21-day free trial|21 days free/, "unknown trial eligibility makes no trial promise");
assert.match(unknownEligibility, />Choose [^<]+<\/button>/, "unknown eligibility leaves the paid purchase label honest");

// SSR cannot invoke a client click handler. Pin only the hard-to-observe
// checkout arguments, while all display behaviour above is actual rendering.
assert.match(pickerSource, /billing_period:\s*effectivePeriod/, "checkout receives the effective selected period");
assert.match(pickerSource, /trial:\s*trialActive/, "checkout receives the same trial decision the offer displays");

console.log("B50 production picker: compact selection, selected offer, periods, native gate and purchase safety passed");
