// G218 fixtures. Shaped exactly like lib/api.ts's SafeToSpend, reusing the
// G14 hero fixtures where one already fits. Static, no live data.

import type { SafeToSpend } from "@/lib/api";
import { HERO_FIXTURES } from "../safe-to-spend-hero/fixtures";

export type FigureState =
  | "on-track"
  | "tight"
  | "card"
  | "short-cash"
  | "short-plans"
  | "error"
  | "degraded"
  | "syncing"
  | "excluded";

export const FIGURE_STATES: { id: FigureState; label: string }[] = [
  { id: "on-track", label: "On track" },
  { id: "tight", label: "Tight" },
  { id: "card", label: "Check card bill" },
  { id: "short-cash", label: "Short (cash)" },
  { id: "short-plans", label: "Short (plans only)" },
  { id: "error", label: "Error" },
  { id: "degraded", label: "Degraded" },
  { id: "syncing", label: "Syncing" },
  { id: "excluded", label: "Not counting 2 accounts" },
];

type Ok = Extract<SafeToSpend, { status: "ok" }>;

const base: Ok = { ...HERO_FIXTURES.comfortable, last_synced: new Date().toISOString() };

export const FIGURE_DATA: Record<FigureState, Ok | null> = {
  // £105 on track, as in Kevin's light screenshot.
  "on-track": { ...base, safe_to_spend: 105, safe_to_spend_cash: 105, state: "comfortable", short_reason: null, spendable_now: 520, bills_total: 200, income_before_payday: 0, buffer: 100, lowest_projected_balance: 320, commitments_reserved: 70, allocations_reserved: 45 },
  tight: { ...HERO_FIXTURES.tight, last_synced: base.last_synced, safe_to_spend: 60, safe_to_spend_cash: 60, card_growth_reserved: 0 },
  // Cash is fine, a card repayment is unconfirmed: hero floors at £0.
  card: { ...HERO_FIXTURES["cards-short"], last_synced: base.last_synced, short_reason: "cards_unconfirmed", safe_to_spend: -300, safe_to_spend_cash: 120, card_growth_reserved: 420, card_growth_total: 420, card_new_spend_total: 420, card_debt: 1800 },
  // Bills push cash itself below zero: a genuine cash shortfall.
  "short-cash": { ...HERO_FIXTURES["bills-short"], last_synced: base.last_synced, safe_to_spend: -86, safe_to_spend_cash: -86, card_growth_reserved: 0, spendable_now: 240, bills_total: 326, income_before_payday: 0, buffer: 0, lowest_projected_balance: -86, commitments_reserved: 0, allocations_reserved: 0 },
  // Kevin's screenshot: cash £0.00, £50 of plans and £200 of envelopes make
  // a "£250 short". Cash after bills and buffer is not negative.
  "short-plans": { ...HERO_FIXTURES["bills-short"], plans_only_short: true, last_synced: base.last_synced, safe_to_spend: -250, safe_to_spend_cash: -250, card_growth_reserved: 0, spendable_now: 0, bills_total: 0, income_before_payday: 0, buffer: 0, lowest_projected_balance: 0, commitments_reserved: 50, commitments_count: 1, allocations_reserved: 200, allocations_count: 2 },
  error: null,
  degraded: { ...base, calculation_status: "degraded", unavailable_components: ["allocations"] },
  syncing: { ...base, calculation_status: "syncing", sync_state: "syncing" },
  // G231: the on-track hero with two accounts the user does not count.
  excluded: { ...base, safe_to_spend: 105, safe_to_spend_cash: 105, state: "comfortable", short_reason: null, spendable_now: 520, bills_total: 200, income_before_payday: 0, buffer: 100, lowest_projected_balance: 320, commitments_reserved: 70, allocations_reserved: 45, excluded_accounts_count: 2, excluded_accounts: [{ id: "joint-bills", name: "Joint bills" }, { id: "partner", name: "Partner current" }] },
};
