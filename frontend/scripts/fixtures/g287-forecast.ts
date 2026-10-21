import type { Account, SafeToSpend } from "../../lib/api";
import type { SyncingInfo } from "../../components/SyncNote";
import type { SpendFromResult } from "../../lib/spendFromAccount";

export type G287Scenario = "habitual" | "comfortable" | "plans" | "tight" | "buffer" | "even" | "card-check" | "chronology" | "cards" | "move" | "one-off" | "small" | "urgent" | "loading" | "stale" | "error" | "empty" | "degraded" | "long";
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
const cashWithCards: SafeToSpendOk = {
  ...shortBase, safe_to_spend: 252, safe_to_spend_cash: 252, spendable_now: 1000,
  bills_total: 500, buffer: 100, lowest_projected_balance: 500,
  commitments_reserved: 100, allocations_reserved: 48, state: "tight", short_reason: null,
  card_debt: 2200, card_growth_total: 140, card_new_spend_total: 140,
  card_growth_reserved: 0, card_growth_wording: "carried", pooled_transfers_excluded: 50,
};

export const G287_SCENARIOS: Record<G287Scenario, { data: SafeToSpend | null; loading?: boolean; error?: boolean }> = {
  habitual: { data: shortBase },
  comfortable: { data: { ...cashWithCards, safe_to_spend: 600, safe_to_spend_cash: 600, bills_total: 152, lowest_projected_balance: 848, state: "comfortable", card_debt: 0, card_growth_total: 0, card_new_spend_total: 0, pooled_transfers_excluded: 0 } },
  plans: { data: { ...shortBase, safe_to_spend: -250, safe_to_spend_cash: -250, spendable_now: 400, bills_total: 300, buffer: 100, lowest_projected_balance: 100, commitments_reserved: 100, commitments_count: 1, allocations_reserved: 150, allocations_count: 2, plans_only_short: true } },
  tight: { data: { ...shortBase, safe_to_spend: 125, safe_to_spend_cash: 125, spendable_now: 600, bills_total: 375, buffer: 100, lowest_projected_balance: 225, state: "tight", short_reason: null } },
  buffer: { data: { ...shortBase, safe_to_spend: -50, safe_to_spend_cash: -50, spendable_now: 350, bills_total: 300, buffer: 100, lowest_projected_balance: 50 } },
  even: { data: { ...shortBase, safe_to_spend: 0, safe_to_spend_cash: 0, spendable_now: 350, bills_total: 350, lowest_projected_balance: 0, state: "tight", short_reason: null } },
  "card-check": { data: { ...cashWithCards, safe_to_spend: -73, card_growth_total: 325, card_growth_reserved: 325, state: "short", short_reason: "cards_unconfirmed" } },
  chronology: { data: { ...shortBase, income_before_payday: 1000 } },
  cards: { data: cashWithCards },
  move: { data: { ...shortBase, safe_to_spend: 185, safe_to_spend_cash: 185, spendable_now: 365, bills_total: 80, buffer: 100, lowest_projected_balance: 285, state: "tight", short_reason: null } },
  "one-off": { data: shortBase },
  small: { data: { ...shortBase, safe_to_spend: -18, safe_to_spend_cash: -18, spendable_now: 202, bills_total: 220, lowest_projected_balance: -18 } },
  urgent: { data: { ...shortBase, next_payday: payday(6), days_until_payday: 6 } },
  loading: { data: null, loading: true },
  stale: { data: { ...shortBase, last_synced: ago(30) } },
  error: { data: null, error: true },
  empty: { data: { status: "insufficient_data" } },
  degraded: { data: { ...shortBase, calculation_status: "degraded" } },
  long: { data: { ...shortBase, safe_to_spend: -12_573, safe_to_spend_cash: -12_573, spendable_now: 15_350, bills_total: 27_923, lowest_projected_balance: -12_573 } },
};

export const G287_ORDER: G287Scenario[] = ["habitual", "comfortable", "plans", "tight", "buffer", "even", "card-check", "chronology", "cards", "move", "one-off", "small", "urgent", "loading", "stale", "error", "empty", "degraded", "long"];

const account = (id: string, name: string, provider: string, balance: number): Account => ({ id: `g287-${id}`, name, provider, balance, type: "bank", subtype: "TRANSACTION", currency: "GBP", status: "AUTHORIZED", cover_source_eligible: true });
const railEntry = (bank: Account, headroom: number, capped = false) => ({ accountId: bank.id, name: bank.name, provider: bank.provider, headroom, capped, account: bank });
const rail: SpendFromResult = { kind: "account", best: railEntry(account("barclays", "Current account", "Barclays", 500), 121), alternative: railEntry(account("chase", "Everyday account", "Chase", 500), 34) };

export function g287CardProps(scenario: G287Scenario): { data: SafeToSpend | null; loading: boolean; error: boolean; spendFrom: SpendFromResult; syncing?: SyncingInfo } {
  const spendFrom: SpendFromResult = scenario === "move"
    ? { kind: "account", best: railEntry(account("monzo", "Everyday account", "Monzo", 365), 185, true), alternative: null }
    : ["cards", "comfortable"].includes(scenario) ? rail : { kind: "none" };
  const entry = G287_SCENARIOS[scenario];
  return {
    data: entry.data, loading: Boolean(entry.loading), error: Boolean(entry.error), spendFrom,
    ...(scenario === "stale" ? { syncing: { kind: "refresh" as const, bank: "Barclays", stalled: true, asOf: entry.data?.status === "ok" ? entry.data.last_synced : null } } : {}),
  };
}

export function g287UpcomingProps(data: SafeToSpendOk) {
  const spendableNow = data.spendable_now;
  if (spendableNow == null) throw new Error("G287 Upcoming fixture needs a known spendable balance");
  const runway = spendableNow + data.income_before_payday - data.bills_total - (data.allocations_reserved ?? 0) - (data.commitments_reserved ?? 0);
  return {
    isCalendarMonth: false, daysToPayday: data.days_until_payday,
    paydayLabel: new Date(data.next_payday).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" }),
    spendableNow, runwayIncomeTotal: data.income_before_payday,
    runwayBillsTotal: data.bills_total, allocationsRemainingTotal: data.allocations_reserved ?? 0,
    allocationsCount: data.allocations_count, plansReservedTotal: data.commitments_reserved ?? 0,
    plansCount: data.commitments_count, plansUnavailable: false, savingsNow: 1400,
    runway, runwayStatus: runway < 0 ? "short" as const : runway > 0 ? "left" as const : "even" as const,
    balancesHidden: false,
  };
}
