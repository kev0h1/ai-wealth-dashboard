import type { SubscriptionInfo, SubscriptionBillingPeriodDetail, SubscriptionLimits, SubscriptionTier } from "@wealth/shared";
import { trialCancelLine, trialDisclosureLine } from "@/lib/billingCopy";

export type TierId = SubscriptionTier;
export type PeriodId = "monthly" | "six_months" | "annual";
export type Platform = "web" | "ios" | "android";
export type Provider = "stripe" | "apple" | "google";
export type Scenario = "free" | "trialling" | "paid" | "cancelled" | "past-due" | "eligibility-unknown" | "trial-ineligible" | "store-unavailable" | "price-unavailable" | "legacy-connect" | "loading" | "error" | "long-copy";
export const SCENARIOS: { id: Scenario; label: string }[] = [
  { id: "free", label: "Free account" }, { id: "trialling", label: "In a trial" },
  { id: "paid", label: "Paid account" }, { id: "cancelled", label: "Cancelled renewal" },
  { id: "past-due", label: "Payment retry" }, { id: "eligibility-unknown", label: "Eligibility unknown" },
  { id: "trial-ineligible", label: "No trial available" }, { id: "store-unavailable", label: "Store unavailable" },
  { id: "price-unavailable", label: "Price unavailable" }, { id: "legacy-connect", label: "Existing Connect plan" },
  { id: "loading", label: "Loading" }, { id: "error", label: "Load error" }, { id: "long-copy", label: "Long descriptions" },
];
export const PERIODS: { id: PeriodId; label: string; months: number; renewal: string }[] = [
  { id: "monthly", label: "Monthly", months: 1, renewal: "every month" },
  { id: "six_months", label: "6 months", months: 6, renewal: "every 6 months" },
  { id: "annual", label: "Yearly", months: 12, renewal: "every year" },
];
// Mirror the current literal catalogue, not hypothetical marketing prices.
// The regression check compares these pence against the backend source.
export const PRICE_PENCE: Record<TierId, Record<PeriodId, number>> = {
  statements: { monthly: 0, six_months: 0, annual: 0 },
  lite: { monthly: 599, six_months: 3199, annual: 5999 },
  standard: { monthly: 999, six_months: 5399, annual: 9999 },
  connect: { monthly: 1299, six_months: 6999, annual: 12999 },
  max: { monthly: 1699, six_months: 9199, annual: 16999 },
};
export const LIMITS: Record<TierId, SubscriptionLimits> = {
  statements: { open_banking: false, max_banks: 0, max_accounts: 0, refresh: "on_upload", penny_messages_per_month: 10, mcp_tool_calls_per_month: 0, history_days: 90, statement_uploads_per_month: 3 },
  lite: { open_banking: true, max_banks: null, max_accounts: 10, refresh: "daily", penny_messages_per_month: 40, mcp_tool_calls_per_month: 0, history_days: 180, statement_uploads_per_month: null },
  standard: { open_banking: true, max_banks: null, max_accounts: 20, refresh: "4h", penny_messages_per_month: 150, mcp_tool_calls_per_month: 0, history_days: null, statement_uploads_per_month: null },
  connect: { open_banking: true, max_banks: null, max_accounts: 20, refresh: "4h", penny_messages_per_month: 150, mcp_tool_calls_per_month: 2000, history_days: null, statement_uploads_per_month: null },
  max: { open_banking: true, max_banks: null, max_accounts: null, refresh: "priority", penny_messages_per_month: 400, mcp_tool_calls_per_month: 5000, history_days: null, statement_uploads_per_month: null },
};
export type Plan = { id: TierId; name: string; lead: string; includes: string[]; banks: string; history: string; updates: string; messages: number };
export const PLANS: Plan[] = [
  { id: "statements", name: "Statements", lead: "A clear money view from uploaded statements.", includes: ["3 statement uploads a month", "90 days of history", "10 Penny messages a month"], banks: "Statement uploads only", history: "90 days", updates: "When you upload", messages: 10 },
  { id: "lite", name: "Lite", lead: "Keep up with day-to-day money across your main banks.", includes: ["Up to 10 connected accounts", "Daily bank updates", "6 months of history", "40 Penny messages a month"], banks: "Up to 10 accounts", history: "6 months", updates: "Daily", messages: 40 },
  { id: "standard", name: "Standard", lead: "Your full money picture, kept up to date through the day.", includes: ["Up to 20 connected accounts", "Updates every 4 hours", "Full history", "150 Penny messages a month"], banks: "Up to 20 accounts", history: "Full history", updates: "Every 4 hours", messages: 150 },
  { id: "connect", name: "Connect", lead: "Use your Sorted figures in an assistant you connect.", includes: ["Everything in Standard", "2,000 connected-assistant calls a month", "Read-only sharing you can revoke"], banks: "Up to 20 accounts", history: "Full history", updates: "Every 4 hours", messages: 150 },
  { id: "max", name: "Max", lead: "The highest limits and fastest updates.", includes: ["All your bank accounts", "Priority bank updates", "400 Penny messages a month"], banks: "All your bank accounts", history: "Full history", updates: "Priority", messages: 400 },
];
export const SNAPSHOT_LABEL = "17 October 2026";
export const CHARGE_DATE = "31 October 2026";
export const PROVIDER_NAMES: Record<Provider, string> = { stripe: "Stripe", apple: "the App Store", google: "Google Play" };
export const PLATFORM_NAMES: Record<Platform, string> = { web: "Web", ios: "iOS", android: "Android" };
export const providerFor = (platform: Platform): Provider => platform === "ios" ? "apple" : platform === "android" ? "google" : "stripe";
export const gbp = (value: number) => new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);
export const planFor = (id: TierId) => PLANS.find(plan => plan.id === id)!;
export const plansFor = (platform: Platform, connectEnabled: boolean) => PLANS.filter(plan => plan.id !== "connect" || (platform === "web" && connectEnabled));

export function periodFor(tier: TierId, period: PeriodId): SubscriptionBillingPeriodDetail {
  const meta = PERIODS.find(item => item.id === period)!;
  const pence = PRICE_PENCE[tier][period];
  return { id: period, label: meta.label, months: meta.months, total: pence / 100, saving_gbp: Math.max(0, PRICE_PENCE[tier].monthly * meta.months - pence) / 100, per_month_gbp: Math.round(pence / meta.months) / 100 };
}

export type Fixture = { scenario: Scenario; info: SubscriptionInfo; provider: Provider; phase: "ready" | "loading" | "error"; priceReady: boolean; eligible: boolean | null };
export function fixtureFor(scenario: Scenario, platform: Platform, source?: Provider): Fixture {
  const managed = ["trialling", "paid", "cancelled", "past-due", "legacy-connect"].includes(scenario);
  const tier: TierId = scenario === "legacy-connect" ? "connect" : managed ? "standard" : "statements";
  const eligible = scenario === "eligibility-unknown" || scenario === "store-unavailable" ? null : !managed && scenario !== "trial-ineligible";
  const info: SubscriptionInfo = {
    tier, status: scenario === "trialling" ? "trialing" : scenario === "past-due" ? "past_due" : "active",
    prices_gbp: Object.fromEntries(PLANS.map(plan => [plan.id, PRICE_PENCE[plan.id].monthly / 100])),
    billing_periods: Object.fromEntries(PLANS.map(plan => [plan.id, PERIODS.map(period => periodFor(plan.id, period.id))])),
    billing_period: "monthly", trial_periods: PERIODS.map(period => period.id), trial_days: 14,
    trial_charge_on: "2026-10-31", trial_ends_at: scenario === "trialling" ? "2026-10-31T00:00:00Z" : null,
    renews_at: managed ? "2026-10-31T00:00:00Z" : null, cancel_at_period_end: scenario === "cancelled",
    has_paid_subscription: managed, trial_eligible: eligible,
    billing_live: scenario !== "store-unavailable", past_due: scenario === "past-due", grace_days: 7, grace_until: scenario === "past-due" ? "2026-10-24T00:00:00Z" : null,
    topup: { messages: 100, price_gbp: 2.99 }, topups: [],
    limits: { ...LIMITS[tier] },
    usage: { year_month: "2026-10", penny_messages: 0, cost_usd: 0 },
  };
  return { scenario, info, provider: scenario === "legacy-connect" ? "stripe" : source ?? providerFor(platform), phase: scenario === "loading" ? "loading" : scenario === "error" ? "error" : "ready", priceReady: !["price-unavailable", "store-unavailable"].includes(scenario), eligible };
}

export function isManaged(fixture: Fixture) {
  return fixture.info.has_paid_subscription === true && ["active", "trialing", "past_due"].includes(fixture.info.status);
}

export function accountReading(fixture: Fixture): { title: string; detail: string; attention: boolean } {
  const name = planFor(fixture.info.tier).name;
  const provider = PROVIDER_NAMES[fixture.provider];
  if (fixture.scenario === "trialling") return { title: `${name} trial`, detail: `Free until ${CHARGE_DATE}, then £9.99 every month through ${provider}.`, attention: false };
  if (fixture.scenario === "cancelled") return { title: `${name} · renewal cancelled`, detail: `Access ends on ${CHARGE_DATE}. It will not renew. Managed through ${provider}.`, attention: false };
  if (fixture.scenario === "past-due") return { title: `${name} · payment needs a look`, detail: `Your payment is being retried. Access is kept until 24 October 2026 in this example. Review it with ${provider}.`, attention: true };
  if (fixture.scenario === "legacy-connect") return { title: "Your existing Connect plan", detail: "Not offered for new subscriptions here. Your current subscription is unchanged; review any change with Stripe.", attention: false };
  if (isManaged(fixture)) return { title: `Your current plan · ${name}`, detail: `£9.99 renews on ${CHARGE_DATE}, then every month. Managed through ${provider}.`, attention: false };
  return { title: "Your current plan · Statements", detail: "Free, with no automatic renewal. Choosing below only changes this preview.", attention: false };
}

export type Offer = { kind: "free" | "trial" | "purchase" | "review" | "manage" | "unavailable"; label: string; details: string[]; disabled: boolean; provider: Provider; localNotice: string };
export function offerFor(fixture: Fixture, platform: Platform, selected: TierId, period: PeriodId, context: "settings" | "onboarding"): Offer {
  const owner = isManaged(fixture) ? fixture.provider : providerFor(platform);
  const provider = PROVIDER_NAMES[owner];
  const base = { provider: owner, disabled: false, localNotice: `Preview only. ${provider} would review this next. No subscription, payment or account has changed.` };
  if (isManaged(fixture)) return { ...base, kind: "manage", label: fixture.scenario === "past-due" ? "Review payment" : selected === fixture.info.tier ? "Manage plan and renewal" : "Review plan change", details: [`Your existing subscription stays with ${provider}. Review any change and final charge there; this does not start a second subscription.`] };
  if (selected === "statements") return { ...base, kind: "free", label: context === "onboarding" ? "Continue with Statements" : "Current plan", details: ["Free. No card and no automatic renewal."], disabled: context === "settings", localNotice: "Preview only. In onboarding this would continue with Statements. No plan has changed." };
  if (!fixture.priceReady || fixture.phase !== "ready" || (selected === "connect" && platform !== "web")) return { ...base, kind: "unavailable", label: "Price unavailable", details: ["We cannot confirm a price or offer for this example. You can compare the plans, but not continue to a purchase."], disabled: true };
  const price = periodFor(selected, period);
  const renewal = PERIODS.find(item => item.id === period)!.renewal;
  const eligible = fixture.eligible === true && (fixture.info.trial_periods ?? []).includes(period);
  if (eligible) {
    const cancel = platform === "web" ? trialCancelLine(`before ${CHARGE_DATE}`) : platform === "ios" ? "Cancel in your Apple Account subscriptions at least 24 hours before the trial ends. The App Store confirms the final terms." : "Cancel in Google Play before the trial ends. Google Play confirms the final terms.";
    return { ...base, kind: "trial", label: `Start ${fixture.info.trial_days}-day free trial`, details: [trialDisclosureLine(fixture.info.trial_days ?? 14, price.total, `on ${CHARGE_DATE}`, renewal), platform === "web" ? "Card required." : `Billed through ${provider}.`, cancel] };
  }
  return { ...base, kind: fixture.eligible === null ? "review" : "purchase", label: fixture.eligible === null ? `Review ${planFor(selected).name}` : `Choose ${planFor(selected).name}`, details: [`${gbp(price.total)} when you subscribe, then ${gbp(price.total)} ${renewal} unless you cancel.`, fixture.eligible === null ? `Trial eligibility is not confirmed. Any offer and final terms must be confirmed by ${provider} before payment.` : `No free trial in this example. Review the final terms with ${provider} before payment.`] };
}
