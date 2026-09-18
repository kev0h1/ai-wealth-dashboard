// G124 — Upcoming refine, fixture data.
//
// This preview is FIXTURE-ONLY, deliberately. PlanningPage.tsx's own
// rendering (the hero figure, the day-group walk, the risk flags, the
// AllocationCards block) all live inline inside one large authenticated
// page component — none of it is exported as an importable piece, and the
// figures depend on a same-page running-balance simulation across every
// connected account (see PlanningPage.tsx's own IIFE around "const groups =
// groupByDay(displayItems)"). Reproducing that walk here to fetch and
// recompute live data would mean duplicating a large, carefully-commented
// piece of business logic in a second place it can silently drift from, or
// refactoring production to expose it — both out of scope for a styling
// round. See the G124 report for the full disclosure: this preview
// hand-authors markup against representative fixtures, it does not render
// PlanningPage.tsx or prove its live behaviour.
//
// Every figure below is invented and self-consistent (the "Full
// calculation" rows sum to the headline), not sourced from any real
// account.

export type PreviewItem = {
  id: string;
  type: "bill" | "income";
  name: string;
  category: string;
  amount: number;
  dayLabel: string; // "Today" | "Tomorrow" | "N days" — matches PlanningPage's own groupByDay label
  dayKeyIso: string; // stand-in for PlanningPage's `expected_date`, used as data-day-key
  dateLabel: string; // "Thu 18 Sep"
  nextPeriod?: boolean;
  flagged?: boolean; // genuine risk — red icon, red amount
  timingRisk?: boolean; // same-day timing risk — amber icon
  isSettling?: boolean; // bank-side pending debit already observed
  isCreditCard?: boolean;
  amountBasis?: "balance_estimate"; // renders the "~" estimate marker
  accountLabel?: string | null; // raw bank/account descriptor, as open banking hands it back
  poolNote?: "settling" | "stays in your accounts" | "on your card" | null; // else falls back to "After: £X left/short"
  balanceAfter?: number;
  edited?: boolean;
  planned?: boolean;
};

export type PreviewAllocation = {
  id: string;
  rawName: string; // as typed by the user when the envelope was created — can be a bare number
  amountPerPeriod: number;
  filledThisPeriod: number;
  remaining: number;
  recurrence: "every_period" | "once";
  pending?: boolean;
  completed?: boolean;
  feedRaw: string; // raw matched-transaction description, exactly as the bank/backend hands it back
  createdViaPenny?: boolean;
};

export const ALLOCATIONS: PreviewAllocation[] = [
  // Kevin's own example: a bare-number title, and a long shouty raw bank
  // description used as the "fed by" match string.
  {
    id: "alloc-50",
    rawName: "50",
    amountPerPeriod: 200,
    filledThisPeriod: 120,
    remaining: 80,
    recurrence: "every_period",
    feedRaw: "INTEREST PAID GROSS FOR PERIOD 3 TO 05 09 2026 ISA REWARD",
  },
  // Kevin's other example: a card-like raw descriptor with an embedded
  // masked account number.
  {
    id: "alloc-amex",
    rawName: "Card repayment",
    amountPerPeriod: 350,
    filledThisPeriod: 350,
    remaining: 0,
    recurrence: "every_period",
    feedRaw: "AMERICAN EXPRESS 3751-4360-XXXXXX PAYMENT REF 88213",
  },
  {
    id: "alloc-holiday",
    rawName: "Portugal trip",
    amountPerPeriod: 150,
    filledThisPeriod: 450,
    remaining: 0,
    recurrence: "every_period",
    completed: false,
    feedRaw: "Manual set aside",
    createdViaPenny: true,
  },
  {
    id: "alloc-car",
    rawName: "Car insurance renewal",
    amountPerPeriod: 480,
    filledThisPeriod: 0,
    remaining: 480,
    recurrence: "once",
    pending: true,
    // A real feed account, not a placeholder — the "pending" state is
    // conveyed by `statusFor`'s own "nothing reserved yet" detail line,
    // not by faking the Fed-by line with status prose.
    feedRaw: "HSBC current account",
  },
];

// ── Positive hero scenario ──────────────────────────────────────────────
export const HERO_POSITIVE = {
  isCalendarMonth: false,
  daysToPayday: 4,
  paydayLabel: "Fri 25 Sep",
  spendableNow: 1240,
  runwayIncomeTotal: 1850,
  runwayBillsTotal: 612,
  allocationsRemainingTotal: 165,
  savingsNow: 3400,
  genuineShortfalls: [] as { accountId: string; bank: string; shortfall: number }[],
  timingShortfalls: [] as { accountId: string; bank: string; dueDate?: string }[],
};
export const RUNWAY_POSITIVE =
  HERO_POSITIVE.spendableNow + HERO_POSITIVE.runwayIncomeTotal - HERO_POSITIVE.runwayBillsTotal - HERO_POSITIVE.allocationsRemainingTotal;

// ── Negative hero scenario ──────────────────────────────────────────────
export const HERO_NEGATIVE = {
  isCalendarMonth: false,
  daysToPayday: 6,
  paydayLabel: "Fri 25 Sep",
  spendableNow: 340,
  runwayIncomeTotal: 0,
  runwayBillsTotal: 524,
  allocationsRemainingTotal: 0,
  savingsNow: 220,
  genuineShortfalls: [{ accountId: "acc-monzo", bank: "Monzo", shortfall: 184 }],
  timingShortfalls: [] as { accountId: string; bank: string; dueDate?: string }[],
};
export const RUNWAY_NEGATIVE =
  HERO_NEGATIVE.spendableNow + HERO_NEGATIVE.runwayIncomeTotal - HERO_NEGATIVE.runwayBillsTotal - HERO_NEGATIVE.allocationsRemainingTotal;

// ── Divergent hero scenario (redRule comparison only) ───────────────────
// A negative pooled projection with NO single account flagged genuinely
// short — plausible when a shortfall is spread thin across several
// accounts rather than concentrated in one. This is the one scenario where
// the two red-panel rules actually disagree: "unified" (runway<0) reddens
// the panel, "live" (genuineShortfalls) does not. HERO_NEGATIVE above
// deliberately keeps a genuine shortfall too (both rules agree there),
// because that scenario also needs to demonstrate the attribution
// sentence/badge content — this one exists purely so the ?redRule=unified
// vs ?redRule=live comparison has something real to show.
export const HERO_DIVERGENT = {
  isCalendarMonth: false,
  daysToPayday: 5,
  paydayLabel: "Fri 25 Sep",
  spendableNow: 260,
  runwayIncomeTotal: 0,
  runwayBillsTotal: 340,
  allocationsRemainingTotal: 0,
  savingsNow: 180,
  genuineShortfalls: [] as { accountId: string; bank: string; shortfall: number }[],
  timingShortfalls: [] as { accountId: string; bank: string; dueDate?: string }[],
};
export const RUNWAY_DIVERGENT =
  HERO_DIVERGENT.spendableNow + HERO_DIVERGENT.runwayIncomeTotal - HERO_DIVERGENT.runwayBillsTotal - HERO_DIVERGENT.allocationsRemainingTotal;

// ── Day groups (shared shape for both hero scenarios; only the negative
// scenario's Today group carries the flagged genuine-shortfall row that the
// hero's own attribution sentence refers to) ────────────────────────────
function items(base: PreviewItem[]): PreviewItem[] {
  return base;
}

export const BILLS_POSITIVE: PreviewItem[] = items([
  {
    id: "b-council-tax",
    type: "bill",
    name: "Council Tax",
    category: "Bills",
    amount: 145,
    dayLabel: "Today",
    dayKeyIso: "2026-09-18",
    dateLabel: "Fri 18 Sep",
    accountLabel: "Monzo",
    balanceAfter: 1095,
  },
  {
    id: "b-netflix",
    type: "bill",
    name: "Netflix",
    category: "Subscriptions",
    amount: 8.99,
    dayLabel: "Today",
    dayKeyIso: "2026-09-18",
    dateLabel: "Fri 18 Sep",
    accountLabel: "Monzo",
    balanceAfter: 1086,
  },
  {
    id: "b-amex-pending",
    type: "bill",
    name: "Amex card repayment",
    category: "Debt",
    amount: 99.8,
    dayLabel: "Today",
    dayKeyIso: "2026-09-18",
    dateLabel: "Fri 18 Sep",
    isSettling: true,
    accountLabel: "American Express 3751-4360-XXXXXX",
    poolNote: "settling",
  },
  {
    id: "i-salary",
    type: "income",
    name: "Salary",
    category: "Income",
    amount: 1850,
    dayLabel: "Tomorrow",
    dayKeyIso: "2026-09-19",
    dateLabel: "Sat 19 Sep",
    balanceAfter: 2936,
  },
  {
    id: "b-spotify",
    type: "bill",
    name: "Spotify",
    category: "Subscriptions",
    amount: 11.99,
    dayLabel: "3 days",
    dayKeyIso: "2026-09-21",
    dateLabel: "Mon 21 Sep",
    accountLabel: "Monzo",
    balanceAfter: 2924,
  },
  {
    id: "b-gym",
    type: "bill",
    name: "Gym membership",
    category: "Health",
    amount: 32,
    dayLabel: "3 days",
    dayKeyIso: "2026-09-21",
    dateLabel: "Mon 21 Sep",
    accountLabel: "Monzo",
    balanceAfter: 2892,
  },
  {
    id: "b-card-estimate",
    type: "bill",
    name: "Barclaycard repayment",
    category: "Debt",
    amount: 99.8,
    dayLabel: "3 days",
    dayKeyIso: "2026-09-21",
    dateLabel: "Mon 21 Sep",
    isCreditCard: true,
    amountBasis: "balance_estimate",
    accountLabel: "Barclaycard",
    poolNote: "on your card",
  },
  {
    id: "b-rent",
    type: "bill",
    name: "Rent",
    category: "Bills",
    amount: 950,
    dayLabel: "9 days",
    dayKeyIso: "2026-09-27",
    dateLabel: "Sun 27 Sep",
    nextPeriod: true,
    accountLabel: "Monzo",
    balanceAfter: 1942,
  },
]);

export const BILLS_NEGATIVE: PreviewItem[] = items([
  {
    id: "b-council-tax-neg",
    type: "bill",
    name: "Council Tax",
    category: "Bills",
    amount: 145,
    dayLabel: "Today",
    dayKeyIso: "2026-09-18",
    dateLabel: "Fri 18 Sep",
    flagged: true,
    accountLabel: "Monzo",
    balanceAfter: -49,
  },
  {
    id: "b-netflix-neg",
    type: "bill",
    name: "Netflix",
    category: "Subscriptions",
    amount: 8.99,
    dayLabel: "Today",
    dayKeyIso: "2026-09-18",
    dateLabel: "Fri 18 Sep",
    accountLabel: "Monzo",
    balanceAfter: 331,
  },
  {
    id: "b-amex-pending-neg",
    type: "bill",
    name: "Amex card repayment",
    category: "Debt",
    amount: 99.8,
    dayLabel: "Today",
    dayKeyIso: "2026-09-18",
    dateLabel: "Fri 18 Sep",
    isSettling: true,
    accountLabel: "American Express 3751-4360-XXXXXX",
    poolNote: "settling",
  },
  {
    id: "b-phone-neg",
    type: "bill",
    name: "Phone contract",
    category: "Bills",
    amount: 38,
    dayLabel: "Tomorrow",
    dayKeyIso: "2026-09-19",
    dateLabel: "Sat 19 Sep",
    timingRisk: true,
    accountLabel: "Monzo",
    balanceAfter: 293,
  },
  {
    id: "b-rent-neg",
    type: "bill",
    name: "Rent",
    category: "Bills",
    amount: 950,
    dayLabel: "10 days",
    dayKeyIso: "2026-09-28",
    dateLabel: "Mon 28 Sep",
    nextPeriod: true,
    accountLabel: "Monzo",
    balanceAfter: -657,
  },
]);
