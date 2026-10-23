import type { Account, SafeToSpend } from "@/lib/api";
import type { SpendFromResult } from "@/lib/spendFromAccount";
import type { SyncingInfo } from "@/components/SyncNote";

export type Forecast = Extract<SafeToSpend, { status: "ok" }>;
const account = (id: string, provider: string, balance: number): Account => ({
  id, name: "Everyday account", provider, provider_id: provider.toLowerCase(), balance,
  type: "TRANSACTION", subtype: "CURRENT", currency: "GBP", status: "AUTHORIZED", cover_source_eligible: true,
});
const natwest = account("g324-natwest", "NatWest", 500);
const starling = account("g324-starling", "Starling", 601);
export const ACCOUNTS: SpendFromResult = {
  kind: "account",
  best: { accountId: natwest.id, name: natwest.name, provider: natwest.provider, headroom: 146, account: natwest },
  alternative: { accountId: starling.id, name: starling.name, provider: starling.provider, headroom: 54, account: starling },
};
export const MOVE = { amount: 25, source: "NatWest", destination: "Barclays" };
const base: Forecast = {
  status: "ok", safe_to_spend: 261, safe_to_spend_cash: 261, spendable_now: 1101,
  next_payday: "2026-10-30T12:00:00Z", days_until_payday: 7, payday_income: 4798,
  bills_total: 660, income_before_payday: 0, lowest_projected_balance: 441,
  buffer: 100, allocations_reserved: 80, allocations_count: 1, commitments_reserved: 0,
  state: "tight", short_reason: null, estimated: true, calculation_status: "complete",
  card_growth_total: 1947, card_new_spend_total: 1947, card_debt: 2500, card_growth_wording: "carried",
};
export const FORECASTS = {
  tight: base,
  comfortable: { ...base, safe_to_spend: 600, safe_to_spend_cash: 600, spendable_now: 1440, lowest_projected_balance: 780, state: "comfortable" },
  "payments-short": { ...base, safe_to_spend: -573, safe_to_spend_cash: -573, spendable_now: 267, lowest_projected_balance: -393, state: "short", short_reason: "bills" },
  "plans-only": { ...base, safe_to_spend: -250, safe_to_spend_cash: -250, spendable_now: 880, lowest_projected_balance: 220, commitments_reserved: 300, commitments_count: 1, allocations_reserved: 70, state: "short", short_reason: "bills", plans_only_short: true },
  "card-purchases": { ...base },
  "card-monthly": { ...base, spendable_now: 3048, bills_total: 2607, card_growth_wording: "cleared_monthly", card_growth_due_date: "2026-10-28T12:00:00Z" },
  "card-reserve": { ...base, safe_to_spend: -73, safe_to_spend_cash: 252, spendable_now: 1092, lowest_projected_balance: 432, card_growth_total: 325, card_new_spend_total: 200, card_growth_reserved: 325, card_debt: 325, state: "short", short_reason: "cards_unconfirmed" },
  "no-account": { ...base, safe_to_spend: 0, safe_to_spend_cash: 0, spendable_now: 0, bills_total: 0, lowest_projected_balance: 0, buffer: 0, allocations_reserved: 0, card_growth_total: 0, card_new_spend_total: 0, card_debt: 0 },
} satisfies Record<string, Forecast>;
export type ReadyState = keyof typeof FORECASTS;
export type State = ReadyState | "loading" | "cold-sync" | "warm-sync" | "degraded" | "error" | "unsupported";
export const STATES: { id: State; label: string }[] = [
  { id: "tight", label: "Tight, with a move" }, { id: "comfortable", label: "Looks on track" },
  { id: "payments-short", label: "Payments short" }, { id: "plans-only", label: "Plans gap" },
  { id: "card-purchases", label: "Card purchases" }, { id: "card-monthly", label: "Confirmed card bill" },
  { id: "card-reserve", label: "Unconfirmed card bill" }, { id: "no-account", label: "No account headroom" },
  { id: "loading", label: "Loading" }, { id: "cold-sync", label: "First sync" },
  { id: "warm-sync", label: "Updating saved figure" }, { id: "degraded", label: "Incomplete calculation" },
  { id: "error", label: "Request failed" }, { id: "unsupported", label: "No supported forecast" },
];
export const COLD_SYNC: Forecast = { ...base, calculation_status: "syncing", sync_state: "syncing" };
export const DEGRADED: Forecast = { ...base, calculation_status: "degraded", unavailable_components: ["plans"] };
export const WARM_SYNC: SyncingInfo = { kind: "refresh", bank: "NatWest", asOf: "2026-10-23T08:45:00Z" };
export const isReady = (state: State): state is ReadyState => Object.hasOwn(FORECASTS, state);
export const money = (value: number, signed = false) => `${signed && value < 0 ? "−" : ""}£${Math.abs(value).toLocaleString("en-GB", { maximumFractionDigits: 0 })}`;
