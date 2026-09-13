/** Preview-only, owner-shaped data for the Spend refurbishment round. */

export type CategoryFixture = {
  category: string;
  spent: number;
  payments: number;
  usualByDay: number;
  paceMultiple: number;
  causes: { name: string; amount: number }[];
};

export type QuietCategoryFixture = {
  category: string;
  spent: number;
  payments: number;
};

export type TrendPoint = {
  periodEnd: string;
  current?: boolean;
  out: number;
  usual: number;
};

export const SPEND_PERIOD = {
  start: "2026-08-30",
  end: "2026-09-26",
  day: 13,
  daysInPeriod: 28,
  out: 4976,
  in: 2650,
  usualByDay: 3390,
  aheadOfUsual: 1586,
  unresolved: 340,
} as const;

export const ATTENTION_CATEGORIES: readonly CategoryFixture[] = [
  {
    category: "Bills",
    spent: 2080,
    payments: 14,
    usualByDay: 800,
    paceMultiple: 2.6,
    causes: [
      { name: "British Gas", amount: 340 },
      { name: "EDF", amount: 180 },
      { name: "Council Tax", amount: 167 },
    ],
  },
  {
    category: "Eating Out",
    spent: 612,
    payments: 16,
    usualByDay: 290,
    paceMultiple: 2.1,
    causes: [
      { name: "Deliveroo", amount: 154 },
      { name: "Dishoom", amount: 82 },
    ],
  },
  {
    category: "Transport",
    spent: 448,
    payments: 22,
    usualByDay: 320,
    paceMultiple: 1.4,
    causes: [{ name: "Shell", amount: 210 }],
  },
];

export const QUIET_CATEGORIES: readonly QuietCategoryFixture[] = [
  { category: "Groceries", spent: 421, payments: 7 },
  { category: "Subscriptions", spent: 222, payments: 9 },
  { category: "Travel", spent: 168, payments: 4 },
  { category: "Cash", spent: 145, payments: 2 },
  { category: "Shopping", spent: 221, payments: 5 },
  { category: "Software", spent: 82, payments: 2 },
  { category: "Charity", spent: 37, payments: 1 },
  { category: "Health", spent: 100, payments: 3 },
  { category: "Pets", spent: 60, payments: 2 },
  { category: "Entertainment", spent: 40, payments: 1 },
  { category: "Education", spent: 0, payments: 0 },
];

/**
 * Header Moved is a separate flow, excluded from Out. It includes own-account
 * transfers, so it must remain neutral rather than implying money was saved.
 */
export const MOVEMENT_ROWS = [
  { kind: "own_accounts", label: "Between your own accounts", amount: 6075, payments: 31 },
  { kind: "pots", label: "To your pots", amount: 1200, payments: 12 },
  { kind: "credit_cards", label: "To credit cards", amount: 612, payments: 2 },
  { kind: "investments", label: "To investments", amount: 200, payments: 1 },
] as const;

export const MOVED_TOTAL = MOVEMENT_ROWS.reduce((total, row) => total + row.amount, 0);

export const TREND_POINTS: readonly TrendPoint[] = [
  { periodEnd: "2026-04-26", out: 3240, usual: 3140 },
  { periodEnd: "2026-05-24", out: 3610, usual: 3210 },
  { periodEnd: "2026-06-21", out: 3385, usual: 3270 },
  { periodEnd: "2026-07-19", out: 4020, usual: 3320 },
  { periodEnd: "2026-08-16", out: 3815, usual: 3360 },
  { periodEnd: SPEND_PERIOD.end, current: true, out: 4976, usual: 3390 },
];

export const PATTERN_CHANGES = {
  largestIncrease: { category: "Bills", change: 1280, comparedWith: "your usual pace" },
  largestPayment: { merchant: "British Gas", amount: 340, category: "Bills" },
  unresolved: { amount: 340, payments: 3, prompt: "Review 3 payments" },
} as const;

/**
 * Shape-card Moved is a job in take-home allocation, not the header's whole
 * transfer-flow total above. The two meanings deliberately do not reconcile.
 */
export const PAY_SHAPE = {
  takeHome: 2650,
  jobs: [
    { id: "fixed", label: "Fixed", share: 47, amount: 1246 },
    { id: "moved", label: "Moved to savings", share: 15, amount: 398 },
    { id: "free", label: "Free", share: 28, amount: 742 },
    { id: "left", label: "Left", share: 10, amount: 264 },
  ],
  verdict: "Of every £100 you take home, £47 was spoken for before you chose anything.",
} as const;

function assertFixtureInvariants() {
  const attentionTotal = ATTENTION_CATEGORIES.reduce((total, row) => total + row.spent, 0);
  const quietTotal = QUIET_CATEGORIES.reduce((total, row) => total + row.spent, 0);
  const reconciled = attentionTotal + quietTotal + SPEND_PERIOD.unresolved;
  if (attentionTotal !== 3140 || quietTotal !== 1496 || reconciled !== SPEND_PERIOD.out) {
    throw new Error(`[spend-page-refurbishment] expected 3,140 + 1,496 + 340 = 4,976; got ${attentionTotal} + ${quietTotal} + ${SPEND_PERIOD.unresolved} = ${reconciled}`);
  }
  if (MOVED_TOTAL !== 8087) throw new Error(`[spend-page-refurbishment] moved total is ${MOVED_TOTAL}, not 8,087`);
  const shareTotal = PAY_SHAPE.jobs.reduce((total, job) => total + job.share, 0);
  if (shareTotal !== 100) throw new Error(`[spend-page-refurbishment] pay-shape shares total ${shareTotal}, not 100`);
}

if (process.env.NODE_ENV !== "production") assertFixtureInvariants();
