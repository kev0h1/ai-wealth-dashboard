// G407: invented account and activity, never a live account or forecast.
import type { Account, AccountEligibility, Transaction } from "@/lib/api";
import type { AccountAvailabilityReading } from "@/lib/accountAvailability";

export type Variant = "a" | "b";
export type ScenarioId = "plans" | "payments" | "available" | "checking" | "unavailable" | "empty" | "long";
export type Scenario = {
  id: ScenarioId;
  label: string;
  account: Account;
  reading: AccountAvailabilityReading;
  position?: AccountEligibility;
  shortfall?: { amount: number; kind: "plans" | "payments" };
  transactions: Transaction[];
};

const account: Account = {
  id: "g407-monzo", name: "Everyday account", provider: "Monzo", provider_id: "monzo",
  type: "bank", subtype: "CURRENT", currency: "GBP", status: "connected", balance: 233.98,
  connection_id: "g407-fixture", bank_synced_to: "2026-11-02T18:00:00Z", include_in_safe_to_spend: true,
};
const tx = (id: string, description: string, date: string, amount: number, category: string): Transaction => ({
  id, account_id: account.id, description, merchant_name: description, date, amount, category,
  currency: "GBP", transaction_type: "debit",
});
export const TRANSACTIONS: Transaction[] = [
  tx("g407-save-1", "Saving Challenge (2026)", "2026-11-02", 11.60, "Savings"),
  tx("g407-save-2", "Saving Challenge (2026)", "2026-11-01", 11.56, "Savings"),
  tx("g407-family", "Alex Morgan", "2026-10-31", 100, "Family"),
  tx("g407-save-3", "Saving Challenge (2026)", "2026-10-31", 11.52, "Savings"),
  tx("g407-shop", "Local food shop", "2026-10-30", 24.30, "Groceries"),
];
const position = (afterPayments: number, plans: number, afterPlans: number, available: number): AccountEligibility => ({
  short: afterPlans < 0, headroom: available, spend_from_headroom: available,
  after_payments: afterPayments, plans_reserved: plans, after_payments_and_plans: afterPlans,
  low_point: afterPayments, low_point_and_plans: afterPlans,
});

export const SCENARIOS: Record<ScenarioId, Scenario> = {
  plans: { id: "plans", label: "Short after plans", account, reading: { kind: "ready", value: 0, warning: "plans" }, position: position(233.98, 336.56, -102.58, 0), shortfall: { amount: 102.58, kind: "plans" }, transactions: TRANSACTIONS },
  payments: { id: "payments", label: "Payments short", account, reading: { kind: "ready", value: 0, warning: "payments" }, position: position(-76.50, 0, -76.50, 0), shortfall: { amount: 76.50, kind: "payments" }, transactions: TRANSACTIONS },
  available: { id: "available", label: "Money available", account, reading: { kind: "ready", value: 103.98 }, position: position(183.98, 80, 103.98, 103.98), transactions: TRANSACTIONS },
  checking: { id: "checking", label: "Checking forecast", account, reading: { kind: "checking" }, transactions: TRANSACTIONS },
  unavailable: { id: "unavailable", label: "Forecast unavailable", account: { ...account, bank_synced_to: null }, reading: { kind: "unavailable" }, transactions: TRANSACTIONS },
  empty: { id: "empty", label: "No transactions", account, reading: { kind: "ready", value: 103.98 }, position: position(183.98, 80, 103.98, 103.98), transactions: [] },
  long: { id: "long", label: "Long account name", account: { ...account, name: "Joint household bills and everyday spending account" }, reading: { kind: "ready", value: 103.98 }, position: position(183.98, 80, 103.98, 103.98), transactions: TRANSACTIONS },
};
export const SCENARIO_IDS = Object.keys(SCENARIOS) as ScenarioId[];
export function formatMoney(value: number, hidden = false): string {
  const sign = value < 0 ? "−" : "";
  return hidden ? `${sign}£••••` : `${sign}£${Math.abs(value).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
