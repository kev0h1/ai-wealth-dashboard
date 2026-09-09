// Fixtures for the G16 "Safe-to-Spend goes cash-led in the engine" proposal.
// Public-safe, invented figures — NOT Kevin's real account balances. £38 and
// £761 are reused here because they are the exact example figures Kevin
// wrote into the backlog item's own text (TODO.md, item G16) to describe the
// wording he wants; they are not read from any live data source.
//
// Each case models ONE card with period growth, differing only in what the
// engine can see about it:
//   - "carried":  the repayment series IS learned (has_forecast_series),
//                 and the card's declared usage (card_terms_col.usage) is
//                 "carry" — the user does not clear it in full.
//   - "cleared":  same learned series, usage "clear_monthly" — the wording
//                 differs (a due date, not a flat "added" sentence) even
//                 though the underlying safety maths is identical to
//                 "carried" (usage decides WORDING only, never the reserve
//                 fallback — see docs/design/g16-cash-led-engine.md §3).
//   - "fallback": NO learned repayment series at all — this is the one case
//                 where the proposed engine still reserves the growth, the
//                 same way today's engine reserves every card's growth
//                 unconditionally.

export type CaseSlug = "carried" | "cleared" | "fallback";

export type CaseFixture = {
  slug: CaseSlug;
  label: string;
  // Cash position after bills and set-asides — the pre-card figure, and
  // (under the proposal) usually the hero figure too.
  safeToSpendCash: number;
  spendableNow: number;
  billsTotal: number;
  incomeBeforePayday: number;
  buffer: number;
  lowestProjectedBalance: number;
  paydayIncome: number;
  daysUntilPayday: number;
  nextPaydayLabel: string;       // fixed display string, e.g. "Wed 21 Oct"
  lastSyncedLabel: string;
  // Card growth this period, and what the engine can see about it.
  cardGrowth: number;
  hasForecastSeries: boolean;
  usage: "clear_monthly" | "carry" | null;
  forecastBillDateLabel: string | null; // only meaningful when usage is clear_monthly
  // Threshold inputs mirroring compute_safe_to_spend's own "tight" rule:
  // tight_threshold = max(100, monthly_spend * 0.10).
  monthlySpend: number;
};

export const CASES: Record<CaseSlug, CaseFixture> = {
  carried: {
    slug: "carried",
    label: "Carried balance",
    safeToSpendCash: 38,
    spendableNow: 640,
    billsTotal: 380,
    incomeBeforePayday: 0,
    buffer: 150,
    lowestProjectedBalance: 260,
    paydayIncome: 2100,
    daysUntilPayday: 6,
    nextPaydayLabel: "Wed 21 Oct",
    lastSyncedLabel: "Synced 2 hours ago",
    cardGrowth: 761,
    hasForecastSeries: true,
    usage: "carry",
    forecastBillDateLabel: null,
    monthlySpend: 1900,
  },
  cleared: {
    slug: "cleared",
    label: "Cleared monthly",
    safeToSpendCash: 38,
    spendableNow: 640,
    billsTotal: 380,
    incomeBeforePayday: 0,
    buffer: 150,
    lowestProjectedBalance: 260,
    paydayIncome: 2100,
    daysUntilPayday: 6,
    nextPaydayLabel: "Wed 21 Oct",
    lastSyncedLabel: "Synced 2 hours ago",
    cardGrowth: 761,
    hasForecastSeries: true,
    usage: "clear_monthly",
    forecastBillDateLabel: "14 Oct",
    monthlySpend: 1900,
  },
  fallback: {
    slug: "fallback",
    label: "No bill learned yet",
    safeToSpendCash: 45,
    spendableNow: 420,
    billsTotal: 210,
    incomeBeforePayday: 0,
    buffer: 90,
    lowestProjectedBalance: 160,
    paydayIncome: 1850,
    daysUntilPayday: 5,
    nextPaydayLabel: "Tue 20 Oct",
    lastSyncedLabel: "Synced 40 minutes ago",
    cardGrowth: 190,
    hasForecastSeries: false,
    usage: null,
    forecastBillDateLabel: null,
    monthlySpend: 1500,
  },
};

export const CASE_ORDER: CaseSlug[] = ["carried", "cleared", "fallback"];

export const CASE_LABEL: Record<CaseSlug, string> = {
  carried: "Carried",
  cleared: "Cleared monthly",
  fallback: "Fallback (no bill learned)",
};
