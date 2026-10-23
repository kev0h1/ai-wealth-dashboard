import type { Account, SafeToSpend } from "@/lib/api";
import type { SpendFromAccount, SpendFromResult } from "@/lib/spendFromAccount";

// Fixed fictional snapshots. Limits already include bills, the pooled cap and
// any cover-move reserve, just like the server's spend_from_headroom field.
export type ScenarioId = "one" | "shared-two" | "shared-three" | "different" | "mixed" | "overlap" | "move" | "same-bank" | "unknown" | "cards-purchases" | "cards-monthly" | "cards-reserve" | "cards-move" | "cards-shared" | "cards-large" | "cards-none";
type CardFixture = { growth: number; purchases: number; reserve?: number; wording: "carried" | "cleared_monthly"; due?: string; debt?: number };
export type Scenario = {
  id: ScenarioId;
  label: string;
  description: string;
  pool: number;
  entries: SpendFromAccount[];
  move: { amount: number; sourceId: string; destination: Account } | null;
  cards?: CardFixture;
  cashBeforeReserve?: number;
};
const account = (id: string, provider: string, name: string): Account => ({
  id, provider, name, balance: 300, currency: "GBP", type: "transaction", subtype: "current", status: "connected", cover_source_eligible: true, include_in_safe_to_spend: true,
} as Account);
const natwest = account("natwest", "NatWest", "Current Account");
const hsbc = account("hsbc", "HSBC", "Everyday Account");
const monzo = account("monzo", "Monzo", "Personal Account");
const starling = account("starling", "Starling", "Personal Current Account");
const joint = account("natwest-joint", "NatWest", "Joint Current Account");
const unknown = account("local", "Local bank", "Current Account");
const entry = (a: Account, headroom: number, capped = false): SpendFromAccount => ({ accountId: a.id, name: a.name, provider: a.provider, headroom, capped, account: a });
export const SCENARIOS: Scenario[] = [
  { id: "cards-purchases", label: "Card purchases", description: "A fictional example shaped like your screenshot: a £242 cash estimate, separate £96 and £54 account limits, and £1,947 of purchases on cards.", pool: 242, entries: [entry(natwest, 96), entry(starling, 54)], move: null, cards: { growth: 1947, purchases: 1947, wording: "carried" } },
  { id: "cards-monthly", label: "Confirmed card bill", description: "The dated cash forecast already includes the learned card bill. Purchases remain a separate card fact, not another deduction.", pool: 242, entries: [entry(natwest, 96), entry(starling, 54)], move: null, cards: { growth: 1947, purchases: 1947, wording: "cleared_monthly", due: "2026-10-28" } },
  { id: "cards-reserve", label: "Unconfirmed card bill", description: "The £252 cash forecast is reduced by a £325 fallback reserve, leaving a £73 safety shortfall. No account is offered as available to spend.", pool: 0, cashBeforeReserve: 252, entries: [], move: null, cards: { growth: 325, purchases: 200, reserve: 325, wording: "carried", debt: 325 } },
  { id: "cards-move", label: "Cards and a pending move", description: "The £40 move is already reserved from NatWest. Its £96 limit and the £242 estimate already include that reserve; card purchases stay separate.", pool: 242, entries: [entry(natwest, 96), entry(starling, 54)], move: { amount: 40, sourceId: natwest.id, destination: monzo }, cards: { growth: 1947, purchases: 1947, wording: "carried" } },
  { id: "cards-shared", label: "Cards and three accounts", description: "Three account options share one £242 estimate. The £1,947 of card purchases is separate from that cash figure.", pool: 242, entries: [entry(natwest, 242, true), entry(starling, 242, true), entry(monzo, 242, true)], move: null, cards: { growth: 1947, purchases: 1947, wording: "carried" } },
  { id: "cards-large", label: "Larger cash figure", description: "A longer cash figure gets the full width. Account options move underneath so the number and account names stay readable on a narrow phone.", pool: 12420, entries: [entry(natwest, 7600), entry(starling, 4820)], move: null, cards: { growth: 900, purchases: 900, wording: "carried" } },
  { id: "cards-none", label: "No card activity", description: "The same £242 cash estimate and account limits without a card-activity panel, for a fair comparison of card height.", pool: 242, entries: [entry(natwest, 96), entry(starling, 54)], move: null, cards: { growth: 0, purchases: 0, wording: "carried", debt: 0 } },
  { id: "one", label: "One account", description: "One current account can cover the whole shared limit.", pool: 7, entries: [entry(natwest, 7, true)], move: null },
  { id: "shared-two", label: "Two accounts", description: "Both accounts can cover the shared limit. It is one total, not an allowance for each account.", pool: 7, entries: [entry(natwest, 7, true), entry(hsbc, 7, true)], move: null },
  { id: "shared-three", label: "Three accounts", description: "Three account options share one overall limit.", pool: 240, entries: [entry(natwest, 240, true), entry(hsbc, 240, true), entry(monzo, 240, true)], move: null },
  { id: "different", label: "Different limits", description: "Each account has a different limit. Both sit within the total above.", pool: 120, entries: [entry(natwest, 70), entry(hsbc, 50)], move: null },
  { id: "mixed", label: "One lower limit", description: "One account can cover the shared limit; the other can cover less.", pool: 120, entries: [entry(natwest, 120, true), entry(hsbc, 35)], move: null },
  { id: "overlap", label: "Overlapping limits", description: "Both account limits are lower than the total. They overlap, so they cannot be added together.", pool: 120, entries: [entry(natwest, 90), entry(hsbc, 60)], move: null },
  { id: "move", label: "Move held back", description: "NatWest is both the move source and an account with room left to spend. Its limit already excludes the move.", pool: 7, entries: [entry(natwest, 7, true), entry(hsbc, 7, true)], move: { amount: 40, sourceId: natwest.id, destination: monzo } },
  { id: "same-bank", label: "Same bank", description: "Two distinct current accounts at the same bank need clear identities.", pool: 7, entries: [entry(natwest, 7, true), entry(joint, 7, true)], move: null },
  { id: "unknown", label: "No bank logo", description: "An account without a bundled bank logo still has a readable identity.", pool: 7, entries: [entry(unknown, 7, true), entry(hsbc, 7, true)], move: null },
];
export function fixtureHero(scenario: Scenario): Extract<SafeToSpend, { status: "ok" }> {
  const cash = scenario.cashBeforeReserve ?? scenario.pool;
  const reserve = scenario.cards?.reserve ?? 0;
  const final = cash - reserve;
  const bills = scenario.cards?.wording === "cleared_monthly" ? 2247 : scenario.cards ? 640 : 100;
  const envelopes = scenario.cards && !reserve ? 80 : 0;
  const lowest = cash + 100 + envelopes;
  return {
    status: "ok", safe_to_spend: final, safe_to_spend_cash: cash,
    card_growth_reserved: reserve, next_payday: scenario.cards ? "2026-10-30T12:00:00Z" : "2026-10-26T12:00:00Z", days_until_payday: scenario.cards ? 7 : 3,
    bills_total: bills, income_before_payday: 0, buffer: 100,
    state: final < 0 ? "short" : scenario.pool > 1000 ? "comfortable" : scenario.cards || scenario.pool < 10 ? "tight" : "comfortable", short_reason: final < 0 ? "cards_unconfirmed" : null,
    estimated: true, spendable_now: lowest + bills, payday_income: scenario.cards ? 4798 : 2500,
    lowest_projected_balance: lowest, commitments_reserved: 0,
    allocations_reserved: envelopes, calculation_status: "complete",
    card_growth_total: scenario.cards?.growth ?? 0,
    card_new_spend_total: scenario.cards?.purchases ?? 0,
    card_debt: scenario.cards?.debt ?? (scenario.cards ? 3600 : 0),
    card_growth_wording: scenario.cards?.wording ?? null,
    card_growth_due_date: scenario.cards?.due ?? null,
  };
}
export function fixtureSpendFrom(scenario: Scenario): SpendFromResult {
  if (!scenario.entries.length) return { kind: "none" };
  return { kind: "account", best: scenario.entries[0], alternative: scenario.entries[1] ?? null };
}
