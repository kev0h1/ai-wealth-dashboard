import type { Account, SafeToSpend } from "@/lib/api";
import type { SpendFromAccount, SpendFromResult } from "@/lib/spendFromAccount";

// Fixed fictional snapshots. Limits already include bills, the pooled cap and
// any cover-move reserve, just like the server's spend_from_headroom field.
export type ScenarioId = "one" | "shared-two" | "shared-three" | "different" | "mixed" | "overlap" | "move" | "same-bank" | "unknown";
export type Scenario = {
  id: ScenarioId;
  label: string;
  description: string;
  pool: number;
  entries: SpendFromAccount[];
  move: { amount: number; sourceId: string; destination: Account } | null;
};
const account = (id: string, provider: string, name: string): Account => ({
  id, provider, name, balance: 300, currency: "GBP", type: "transaction", subtype: "current", status: "connected", cover_source_eligible: true, include_in_safe_to_spend: true,
} as Account);
const natwest = account("natwest", "NatWest", "Current Account");
const hsbc = account("hsbc", "HSBC", "Everyday Account");
const monzo = account("monzo", "Monzo", "Personal Account");
const joint = account("natwest-joint", "NatWest", "Joint Current Account");
const unknown = account("local", "Local bank", "Current Account");
const entry = (a: Account, headroom: number, capped = false): SpendFromAccount => ({ accountId: a.id, name: a.name, provider: a.provider, headroom, capped, account: a });
export const SCENARIOS: Scenario[] = [
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
  return {
    status: "ok", safe_to_spend: scenario.pool, safe_to_spend_cash: scenario.pool,
    card_growth_reserved: 0, next_payday: "2026-10-26T00:00:00Z", days_until_payday: 3,
    bills_total: 100, income_before_payday: 0, buffer: 100,
    state: scenario.pool < 10 ? "tight" : "comfortable", short_reason: null,
    estimated: true, spendable_now: scenario.pool + 200, payday_income: 2500,
    lowest_projected_balance: scenario.pool + 100, commitments_reserved: 0,
    allocations_reserved: 0, calculation_status: "complete",
  };
}
export function fixtureSpendFrom(scenario: Scenario): SpendFromResult {
  return { kind: "account", best: scenario.entries[0], alternative: scenario.entries[1] ?? null };
}
