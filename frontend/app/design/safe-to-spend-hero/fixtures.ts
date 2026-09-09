// Fixtures for the G14 cash-led Safe-to-Spend hero proposal.
// Shaped exactly like frontend/lib/api.ts's SafeToSpend "ok" variant so the
// Today and Proposed hero renderers can read the SAME underlying data per
// state — only the rendering rules differ between treatments, never the
// numbers. Figures are in Kevin's own magnitudes (see item G14): the
// bills-short fixture reproduces his own screen (£42 cash gap, £761 unpaid
// card growth, £803 net).

import type { SafeToSpend } from "@/lib/api";

export type HeroStateSlug = "bills-short" | "cards-short" | "comfortable" | "tight";

export type SafeToSpendOk = Extract<SafeToSpend, { status: "ok" }>;

function isoHoursAgo(hours: number): string {
  return new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
}

function daysFromNow(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

export const HERO_FIXTURES: Record<HeroStateSlug, SafeToSpendOk> = {
  // Kevin's own screen: cash £42 short, £761 of unpaid card growth on top,
  // net −£803. Today's hero shows the £803 net figure in red. Proposed
  // shows only the £42 cash gap in red, plus the secondary card-growth line.
  "bills-short": {
    status: "ok",
    safe_to_spend: -803,
    safe_to_spend_cash: -42,
    card_growth_reserved: 761,
    next_payday: daysFromNow(6),
    days_until_payday: 6,
    bills_total: 100,
    income_before_payday: 0,
    buffer: 242,
    state: "short",
    short_reason: "bills",
    estimated: false,
    spendable_now: 300,
    payday_income: 2400,
    lowest_projected_balance: 200,
    commitments_reserved: 0,
    allocations_reserved: 0,
    last_synced: isoHoursAgo(5),
    calculation_status: "complete",
  },
  // Cash is positive (£71 spare) but £846 of card growth has already used
  // it up. Today and Proposed both clamp the hero to £0 amber — this state
  // does not change, only the supporting line does.
  "cards-short": {
    status: "ok",
    safe_to_spend: -775,
    safe_to_spend_cash: 71,
    card_growth_reserved: 846,
    next_payday: daysFromNow(6),
    days_until_payday: 6,
    bills_total: 150,
    income_before_payday: 0,
    buffer: 299,
    state: "short",
    short_reason: "cards",
    estimated: false,
    spendable_now: 520,
    payday_income: 2400,
    lowest_projected_balance: 370,
    commitments_reserved: 0,
    allocations_reserved: 0,
    last_synced: isoHoursAgo(3),
    calculation_status: "complete",
  },
  // Healthy pay period, no unpaid card growth to report — confirms the new
  // secondary line stays silent when there is nothing to say, and that this
  // state is untouched by G14.
  comfortable: {
    status: "ok",
    safe_to_spend: 640,
    safe_to_spend_cash: 640,
    card_growth_reserved: 0,
    next_payday: daysFromNow(9),
    days_until_payday: 9,
    bills_total: 200,
    income_before_payday: 150,
    buffer: 210,
    state: "comfortable",
    short_reason: null,
    estimated: false,
    spendable_now: 900,
    payday_income: 2400,
    lowest_projected_balance: 850,
    commitments_reserved: 0,
    allocations_reserved: 0,
    last_synced: isoHoursAgo(1),
    calculation_status: "complete",
  },
  // Getting close, still net positive, and carrying some card growth — the
  // existing "leaves £X, but £Y of unpaid card growth..." sentence keeps
  // rendering exactly as it does today; G14 does not touch this state.
  tight: {
    status: "ok",
    safe_to_spend: 90,
    safe_to_spend_cash: 180,
    card_growth_reserved: 90,
    next_payday: daysFromNow(4),
    days_until_payday: 4,
    bills_total: 140,
    income_before_payday: 0,
    buffer: 60,
    state: "tight",
    short_reason: null,
    estimated: false,
    spendable_now: 380,
    payday_income: 2400,
    lowest_projected_balance: 240,
    commitments_reserved: 0,
    allocations_reserved: 0,
    last_synced: isoHoursAgo(8),
    calculation_status: "complete",
  },
};

export const HERO_STATE_ORDER: HeroStateSlug[] = ["bills-short", "cards-short", "comfortable", "tight"];

export const HERO_STATE_LABEL: Record<HeroStateSlug, string> = {
  "bills-short": "Bills short",
  "cards-short": "Cards short",
  comfortable: "Comfortable",
  tight: "Tight",
};
