// G124 — Upcoming refine, fixture data.
//
// The day-group items below (PreviewItem) are still FIXTURE-ONLY,
// disclosed as such: PlanningPage.tsx's hero figure, day-group walk and
// risk flags are computed inline inside one large authenticated page
// component with no importable boundary at the row granularity (see
// PlanningPage.tsx's own IIFE around "const groups = groupByDay
// (displayItems)"), so this preview hand-authors representative bill/
// income fixtures rather than rendering that walk.
//
// The Set-aside allocations below (ALLOCATIONS) are NOT fixture-only in
// that sense any more (G131 fold-in): they're written directly in
// SetAsideItem's shape and rendered through the SAME shared
// components/upcoming/SetAsideList.tsx component PlanningPage.tsx renders,
// so that piece of the preview is real production markup against
// representative data, not a parallel reimplementation.
//
// Every figure below is invented and self-consistent (the "Full
// calculation" rows sum to the headline), not sourced from any real
// account.
import type { SetAsideItem } from "@/components/upcoming/SetAsideList";

export type PreviewItem = {
  id: string;
  type: "bill" | "income";
  name: string;
  category: string;
  amount: number;
  // G127 ask #3: the day heading now carries the absolute date (see
  // dateLabel below) always, so this only carries the special-case word
  // for the two days close enough that a bare date reads worse than the
  // word (Kevin: "a bare date for today may be worse than the word") —
  // every other day is dateLabel alone, no "N days" count on the heading.
  dayLabel?: "Today" | "Tomorrow";
  dayOffset: number; // days from today — drives grouping and every interval rule's maths in DayGroups.tsx
  dayKeyIso: string; // stand-in for PlanningPage's `expected_date`, used as data-day-key and as the group key
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

// G131 fold-in: this fixture is now written directly in SetAsideItem's own
// shape (components/upcoming/SetAsideList.tsx) rather than a preview-only
// PreviewAllocation type with differently-named fields — the same
// production component this preview renders takes this exact prop shape,
// so there is no adapter/mapping step to drift.
export const ALLOCATIONS: SetAsideItem[] = [
  // Kevin's own example: a bare-number title, and a long shouty raw bank
  // description used as the "fed by" match string.
  {
    id: "alloc-50",
    name: "50",
    amountPerPeriod: 200,
    filledThisPeriod: 120,
    remaining: 80,
    recurrence: "every_period",
    pending: false,
    completed: false,
    feedLabel: "INTEREST PAID GROSS FOR PERIOD 3 TO 05 09 2026 ISA REWARD",
  },
  // Kevin's other example: a card-like raw descriptor with an embedded
  // masked account number.
  {
    id: "alloc-amex",
    name: "Card repayment",
    amountPerPeriod: 350,
    filledThisPeriod: 350,
    remaining: 0,
    recurrence: "every_period",
    pending: false,
    completed: false,
    feedLabel: "AMERICAN EXPRESS 3751-4360-XXXXXX PAYMENT REF 88213",
  },
  {
    id: "alloc-holiday",
    name: "Portugal trip",
    amountPerPeriod: 150,
    filledThisPeriod: 450,
    remaining: 0,
    recurrence: "every_period",
    pending: false,
    completed: false,
    feedLabel: null,
    createdViaPenny: true,
  },
  {
    id: "alloc-car",
    name: "Car insurance renewal",
    amountPerPeriod: 480,
    filledThisPeriod: 0,
    remaining: 480,
    recurrence: "once",
    pending: true,
    completed: false,
    // A real feed account, not a placeholder — the "pending" state is
    // conveyed by `statusFor`'s own "nothing reserved yet" detail line,
    // not by faking the Fed-by line with status prose.
    feedLabel: "HSBC current account",
    pendingStartsLabel: "5 Oct",
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

// ── Day groups (shared shape for both hero scenarios; only the negative
// scenario's Today group carries the flagged genuine-shortfall row that the
// hero's own attribution sentence refers to) ────────────────────────────
function items(base: PreviewItem[]): PreviewItem[] {
  return base;
}

// Extended for G127 ask #3: the original 4-day horizon (today/tomorrow/3
// days/9 days, one item each bar today) was too short to show a gap, a
// rhythm horizon or a genuine cluster doing anything different from one
// another — every group was a single bill a day or so apart, so any
// interval rule looked the same. This runs the horizon out to a month with
// a deliberately uneven shape: a quiet run near payday (day 8-11, four
// payments on nearly consecutive days — the boundary into the next pay
// period now sits at the FRONT of that run, day 8, not day 9, so it's the
// true first day of the new period), a 9-day silence, a second three-day
// run (day 20-22), then one more silence out to a one-off at day 30. See
// DayGroups.tsx for how "gap", "rhythm" and "cluster" each read this same
// shape differently.
export const BILLS_POSITIVE: PreviewItem[] = items([
  {
    id: "b-council-tax",
    type: "bill",
    name: "Council Tax",
    category: "Bills",
    amount: 145,
    dayLabel: "Today",
    dayOffset: 0,
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
    dayOffset: 0,
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
    dayOffset: 0,
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
    dayOffset: 1,
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
    dayOffset: 3,
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
    dayOffset: 3,
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
    dayOffset: 3,
    dayKeyIso: "2026-09-21",
    dateLabel: "Mon 21 Sep",
    isCreditCard: true,
    amountBasis: "balance_estimate",
    accountLabel: "Barclaycard",
    poolNote: "on your card",
  },
  {
    // First day of the next pay period — carries `nextPeriod`, not Rent
    // any more (see the comment above the array).
    id: "b-prime",
    type: "bill",
    name: "Amazon Prime",
    category: "Subscriptions",
    amount: 8.99,
    dayOffset: 8,
    dayKeyIso: "2026-09-26",
    dateLabel: "Sat 26 Sep",
    nextPeriod: true,
    accountLabel: "Monzo",
    balanceAfter: 2883,
  },
  {
    id: "b-rent",
    type: "bill",
    name: "Rent",
    category: "Bills",
    amount: 950,
    dayOffset: 9,
    dayKeyIso: "2026-09-27",
    dateLabel: "Sun 27 Sep",
    accountLabel: "Monzo",
    balanceAfter: 1933,
  },
  {
    id: "b-car-insurance",
    type: "bill",
    name: "Car insurance",
    category: "Bills",
    amount: 42,
    dayOffset: 10,
    dayKeyIso: "2026-09-28",
    dateLabel: "Mon 28 Sep",
    accountLabel: "Monzo",
    balanceAfter: 1891,
  },
  {
    id: "b-gym-2",
    type: "bill",
    name: "Gym membership",
    category: "Health",
    amount: 32,
    dayOffset: 11,
    dayKeyIso: "2026-09-29",
    dateLabel: "Tue 29 Sep",
    accountLabel: "Monzo",
    balanceAfter: 1859,
  },
  {
    id: "b-spotify-2",
    type: "bill",
    name: "Spotify",
    category: "Subscriptions",
    amount: 11.99,
    dayOffset: 11,
    dayKeyIso: "2026-09-29",
    dateLabel: "Tue 29 Sep",
    accountLabel: "Monzo",
    balanceAfter: 1847,
  },
  {
    // 9-day silence between here and the day-11 group — the "gap" rule's
    // own demonstration.
    id: "b-netflix-2",
    type: "bill",
    name: "Netflix",
    category: "Subscriptions",
    amount: 8.99,
    dayOffset: 20,
    dayKeyIso: "2026-10-08",
    dateLabel: "Thu 8 Oct",
    accountLabel: "Monzo",
    balanceAfter: 1838,
  },
  {
    id: "b-broadband",
    type: "bill",
    name: "Broadband",
    category: "Bills",
    amount: 34,
    dayOffset: 21,
    dayKeyIso: "2026-10-09",
    dateLabel: "Fri 9 Oct",
    accountLabel: "Monzo",
    balanceAfter: 1804,
  },
  {
    id: "b-council-tax-2",
    type: "bill",
    name: "Council Tax",
    category: "Bills",
    amount: 145,
    dayOffset: 22,
    dayKeyIso: "2026-10-10",
    dateLabel: "Sat 10 Oct",
    accountLabel: "Monzo",
    balanceAfter: 1659,
  },
  {
    // A month out — an isolated one-off with an 8-day silence on either
    // side, testing the far end of the "rhythm" horizon.
    id: "b-car-insurance-renewal",
    type: "bill",
    name: "Car insurance renewal",
    category: "Bills",
    amount: 480,
    dayOffset: 30,
    dayKeyIso: "2026-10-18",
    dateLabel: "Sun 18 Oct",
    accountLabel: "Monzo",
    balanceAfter: 1179,
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
    dayOffset: 0,
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
    dayOffset: 0,
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
    dayOffset: 0,
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
    dayOffset: 1,
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
    dayOffset: 10,
    dayKeyIso: "2026-09-28",
    dateLabel: "Mon 28 Sep",
    nextPeriod: true,
    accountLabel: "Monzo",
    balanceAfter: -657,
  },
]);
