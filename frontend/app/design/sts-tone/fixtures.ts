import type { Account, SafeToSpend } from "@/lib/api";
import type { SpendFromResult } from "@/lib/spendFromAccount";
import type { SyncingInfo } from "@/components/SyncNote";

export type Scenario = "one-off" | "habitual" | "plans" | "move" | "small" | "urgent" | "cards" | "card-check" | "comfortable" | "chronology" | "loading" | "stale" | "error" | "empty" | "degraded" | "long";
export type SafeToSpendOk = Extract<SafeToSpend, { status: "ok" }>;
export type Variant = "a" | "b" | "current";

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
const cashWithCards: SafeToSpendOk = {
  ...shortBase, safe_to_spend: 252, safe_to_spend_cash: 252, spendable_now: 1000,
  bills_total: 500, buffer: 100, lowest_projected_balance: 500,
  commitments_reserved: 100, allocations_reserved: 48, state: "tight", short_reason: null,
  card_debt: 2200, card_growth_total: 140, card_new_spend_total: 140,
  card_growth_reserved: 0, card_growth_wording: "carried", pooled_transfers_excluded: 50,
};

export const SCENARIOS: Record<Scenario, { label: string; data: SafeToSpend | null; note: string }> = {
  "one-off": { label: "One-off shortfall", data: shortBase, note: "A cash shortfall keeps the existing Short status, payment route and exact calculation. Only its visual treatment is proposed." },
  habitual: { label: "Repeated shortfall", data: shortBase, note: "The same genuine cash gap remains Short. No historical count is shown: that history is not available from the current API." },
  plans: { label: "Plans only", data: { ...shortBase, safe_to_spend: -250, safe_to_spend_cash: -250, spendable_now: 400, bills_total: 300, buffer: 100, lowest_projected_balance: 100, commitments_reserved: 100, commitments_count: 1, allocations_reserved: 150, allocations_count: 2, plans_only_short: true }, note: "The existing plans-only wording and amber treatment remain. Optional reserves are not recast as a payment at risk." },
  move: { label: "Account gap", data: { ...shortBase, safe_to_spend: 185, safe_to_spend_cash: 185, spendable_now: 365, bills_total: 80, buffer: 100, lowest_projected_balance: 285, state: "tight", short_reason: null }, note: "The pooled forecast is positive. A separate Home payment card may flag a short paying account; this hero does not claim a transfer has happened or increases the pool." },
  small: { label: "Small cash gap", data: { ...shortBase, safe_to_spend: -18, safe_to_spend_cash: -18, spendable_now: 202, bills_total: 220, lowest_projected_balance: -18 }, note: "A small genuine cash gap still keeps the Short status and See what’s due action." },
  urgent: { label: "Payment due soon", data: { ...shortBase, next_payday: payday(6), days_until_payday: 6 }, note: "The existing payment route is retained. The hero does not invent a more specific due date than its payload provides." },
  cards: { label: "See your cards", data: cashWithCards, note: "Tight with card debt: the production card shows See your cards beside Your accounts. Card purchases remain separate from cash." },
  "card-check": { label: "Review card bill", data: { ...cashWithCards, safe_to_spend: -73, card_growth_total: 325, card_growth_reserved: 325, state: "short", short_reason: "cards_unconfirmed" }, note: "The existing Check card bill state shows £0 available, not a negative cash balance. The separate card safety calculation preserves the signed £73 gap." },
  comfortable: { label: "On track", data: { ...cashWithCards, safe_to_spend: 600, safe_to_spend_cash: 600, bills_total: 152, lowest_projected_balance: 848, state: "comfortable", card_debt: 0, card_growth_total: 0, card_new_spend_total: 0, pooled_transfers_excluded: 0 }, note: "The existing emerald On track state is unchanged. Your accounts remains even when no primary recovery action is needed." },
  chronology: { label: "Income arrives later", data: { ...shortBase, income_before_payday: 1000 }, note: "Income arrives after the low point. The real production calculation withholds a misleading simple bills/income sum and explains the date-ordered forecast." },
  loading: { label: "Loading", data: null, note: "The real production skeleton, with no invented amount or action." },
  stale: { label: "Update delayed", data: { ...shortBase, last_synced: ago(30) }, note: "The production delayed-sync treatment keeps a neutral last-known amount and Retry. No current risk verdict is claimed." },
  error: { label: "Unavailable", data: null, note: "The real production unavailable state and local Retry demonstration, not an empty card." },
  empty: { label: "Not enough history", data: { status: "insufficient_data" }, note: "The production first-history state does not claim a balance yet." },
  degraded: { label: "Incomplete calculation", data: { ...shortBase, calculation_status: "degraded" }, note: "The production card withholds the figure when every set-aside cannot be verified." },
  long: { label: "Long figures", data: { ...shortBase, safe_to_spend: -12_573, safe_to_spend_cash: -12_573, spendable_now: 15_350, bills_total: 27_923, lowest_projected_balance: -12_573 }, note: "Long grouped amounts use the same signed production ledger. No alternate financial calculation is introduced." },
};

export const SCENARIO_ORDER: Scenario[] = ["habitual", "one-off", "plans", "cards", "card-check", "comfortable", "move", "small", "urgent", "chronology", "loading", "stale", "error", "empty", "degraded", "long"];

const account = (id: string, name: string, provider: string, balance: number): Account => ({ id: `g287-${id}`, name, provider, balance, type: "bank", subtype: "TRANSACTION", currency: "GBP", status: "AUTHORIZED", cover_source_eligible: true });
const railEntry = (bank: Account, headroom: number, capped = false) => ({ accountId: bank.id, name: bank.name, provider: bank.provider, headroom, capped, account: bank });
const rail: SpendFromResult = { kind: "account", best: railEntry(account("barclays", "Current account", "Barclays", 500), 121), alternative: railEntry(account("chase", "Everyday account", "Chase", 500), 34) };

export function cardPropsFor(scenario: Scenario): { data: SafeToSpend | null; loading: boolean; error: boolean; spendFrom: SpendFromResult; syncing?: SyncingInfo } {
  const spendFrom: SpendFromResult = scenario === "move"
    ? { kind: "account", best: railEntry(account("monzo", "Everyday account", "Monzo", 365), 185, true), alternative: null }
    : ["cards", "comfortable"].includes(scenario) ? rail : { kind: "none" };
  return {
    data: SCENARIOS[scenario].data, loading: scenario === "loading", error: scenario === "error", spendFrom,
    ...(scenario === "stale" ? { syncing: { kind: "refresh" as const, bank: "Barclays", stalled: true, asOf: SCENARIOS.stale.data?.status === "ok" ? SCENARIOS.stale.data.last_synced : null } } : {}),
  };
}

export function previewRouteFor(label: string): "/cards" | "/upcoming" | null {
  if (label === "See your cards" || label === "Review card bill") return "/cards";
  if (label === "See what’s due") return "/upcoming";
  return null;
}
