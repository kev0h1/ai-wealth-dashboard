import type { SubscriptionInfo, SubscriptionLimits, SubscriptionTier } from "@wealth/shared";

export type Platform = "web" | "ios" | "android";
export type PlanState = "paid" | "free" | "trial" | "cancelled" | "past-due" | "checkout-closed" | "loading" | "error";

const LIMITS: Record<SubscriptionTier, SubscriptionLimits> = {
  statements: { open_banking: false, max_banks: 0, max_accounts: 0, refresh: "on_upload", penny_messages_per_month: 10, mcp_tool_calls_per_month: 0, history_days: 90, statement_uploads_per_month: 3 },
  lite: { open_banking: true, max_banks: null, max_accounts: 10, refresh: "4h", penny_messages_per_month: 40, mcp_tool_calls_per_month: 5000, history_days: null, statement_uploads_per_month: null },
  standard: { open_banking: true, max_banks: null, max_accounts: 25, refresh: "4h", penny_messages_per_month: 150, mcp_tool_calls_per_month: 5000, history_days: null, statement_uploads_per_month: null },
  plus: { open_banking: true, max_banks: null, max_accounts: null, refresh: "4h", penny_messages_per_month: 300, mcp_tool_calls_per_month: 5000, history_days: null, statement_uploads_per_month: null },
};

const MONTHLY_PRICES: Record<SubscriptionTier, number> = {
  statements: 0,
  lite: 5.99,
  standard: 9.99,
  plus: 12.99,
};

export const paidPlus: SubscriptionInfo = planFixture("paid", "web")!;
export default paidPlus;

export function billingProviderFor(platform: Platform): "stripe" | "apple" | "google" {
  return platform === "ios" ? "apple" : platform === "android" ? "google" : "stripe";
}

/** Synthetic subscription states for the production Settings regression. */
export function planFixture(state: PlanState, platform: Platform): SubscriptionInfo | null {
  if (state === "loading" || state === "error") return null;

  const provider = billingProviderFor(platform);
  const paid = state === "paid" || state === "trial" || state === "cancelled" || state === "past-due";
  // With billing closed, the live default tier remains Plus access without a
  // paid subscription. A deliberate free-plan choice is Statements instead.
  const tier: SubscriptionTier = state === "free" ? "statements" : "plus";
  const limit = LIMITS[tier].penny_messages_per_month;
  const used = paid ? 34 : 2;
  const cancelled = state === "cancelled";
  const pastDue = state === "past-due";

  return {
    tier,
    status: state === "trial" ? "trialing" : pastDue ? "past_due" : "active",
    prices_gbp: MONTHLY_PRICES,
    billing_prices_gbp: {
      statements: { monthly: 0, three_months: 0, six_months: 0, annual: 0 },
      lite: { monthly: 5.99, three_months: 16.99, six_months: 31.99, annual: 59.99 },
      standard: { monthly: 9.99, three_months: 28.99, six_months: 53.99, annual: 99.99 },
      plus: { monthly: 12.99, three_months: 36.99, six_months: 69.99, annual: 129.99 },
    },
    billing_period: "monthly",
    trial_periods: ["monthly"],
    trial_days: 14,
    trial_charge_on: "2026-11-03",
    trial_ends_at: state === "trial" ? "2026-11-03T00:00:00Z" : null,
    renews_at: paid && state !== "trial" ? "2026-11-03T00:00:00Z" : null,
    cancel_at_period_end: cancelled,
    has_paid_subscription: paid,
    billing_provider: paid ? provider : null,
    trial_eligible: !paid,
    past_due: pastDue,
    grace_days: pastDue ? 7 : undefined,
    grace_until: pastDue ? "2026-10-27T00:00:00Z" : null,
    topup: { messages: 100, price_gbp: 2.99 },
    topups: [],
    limits: LIMITS[tier],
    usage: {
      year_month: "2026-10",
      penny_messages: used,
      cost_usd: 0,
      penny_limit: limit,
      penny_remaining: limit === null ? null : Math.max(0, limit - used),
      penny_resets_on: "2026-11-01",
    },
    // `checkout-closed` is deliberately a free-access fixture: it records
    // that paid checkout is unavailable without claiming an existing plan
    // will charge or renew.
    billing_live: state !== "checkout-closed",
  };
}
