import type { SafeToSpend } from "@/lib/api";

export type Scenario = "one-off" | "habitual" | "plans" | "move" | "small" | "urgent" | "loading" | "stale" | "error" | "long";
export type SafeToSpendOk = Extract<SafeToSpend, { status: "ok" }>;

const payday = (days: number) => {
  const date = new Date();
  date.setDate(date.getDate() + days);
  date.setHours(0, 0, 0, 0);
  return date.toISOString();
};

const ago = (hours: number) => new Date(Date.now() - hours * 3_600_000).toISOString();

const shortBase: SafeToSpendOk = {
  status: "ok", safe_to_spend: -573, safe_to_spend_cash: -573,
  next_payday: payday(5), days_until_payday: 5, bills_total: 923,
  income_before_payday: 0, buffer: 0, state: "short", estimated: true,
  spendable_now: 350, lowest_projected_balance: -573, commitments_reserved: 0,
  allocations_reserved: 0, short_reason: "bills", last_synced: ago(1), calculation_status: "complete",
};

export const SCENARIOS: Record<Scenario, { label: string; data: SafeToSpendOk | null; note: string; history: "shown" | "withheld"; action: string }> = {
  "one-off": { label: "One-off", data: shortBase, note: "An unexpected boiler repair is due before payday.", history: "withheld", action: "Review the payment" },
  habitual: { label: "Habitual", data: shortBase, note: "The same cash gap needs attention before payday.", history: "shown", action: "Review the payment" },
  plans: { label: "Plans", data: { ...shortBase, safe_to_spend: -250, safe_to_spend_cash: -250, spendable_now: 400, bills_total: 300, buffer: 100, lowest_projected_balance: 100, commitments_reserved: 100, commitments_count: 1, allocations_reserved: 150, allocations_count: 2, plans_only_short: true, short_reason: "bills" }, note: "Bills are covered. Planned reserves leave a gap, not a payment at risk.", history: "withheld", action: "Review planned reserves" },
  move: { label: "Move", data: { ...shortBase, safe_to_spend: 185, safe_to_spend_cash: 185, spendable_now: 365, bills_total: 80, buffer: 100, lowest_projected_balance: 285, state: "tight", short_reason: null }, note: "Pooled cash is positive, but Barclays is short for its bill.", history: "withheld", action: "Review account move" },
  small: { label: "Small", data: { ...shortBase, safe_to_spend: -18, safe_to_spend_cash: -18, spendable_now: 202, bills_total: 220, buffer: 0, lowest_projected_balance: -18 }, note: "A small gap still leaves a payment due before payday uncovered.", history: "withheld", action: "Review the payment" },
  urgent: { label: "Urgent", data: { ...shortBase, next_payday: payday(6), days_until_payday: 6 }, note: "A £573 payment is due tomorrow, before your next payday.", history: "withheld", action: "Review payment due tomorrow" },
  loading: { label: "Loading", data: null, note: "Calculating from your bank data.", history: "withheld", action: "" },
  stale: { label: "Stale", data: { ...shortBase, last_synced: ago(30) }, note: "This estimate uses older bank data. Refresh before relying on it.", history: "withheld", action: "Refresh estimate locally" },
  error: { label: "Error", data: null, note: "The estimate could not be refreshed.", history: "withheld", action: "Try again" },
  long: { label: "Long figures", data: { ...shortBase, safe_to_spend: -12_573, safe_to_spend_cash: -12_573, spendable_now: 15_350, bills_total: 27_923, buffer: 0, lowest_projected_balance: -12_573 }, note: "A longer amount keeps the same signed working and payment risk.", history: "shown", action: "Review the payment" },
};

export const SCENARIO_ORDER: Scenario[] = ["one-off", "habitual", "plans", "move", "small", "urgent", "loading", "stale", "error", "long"];
