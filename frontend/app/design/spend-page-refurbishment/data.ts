/** Owner-shaped, preview-only facts for the reopened G57 Spend revamp. */

export type SpendCategory = {
  category: string;
  spent: number;
  payments: number;
  usualByDay?: number;
  paceMultiple?: number;
  causes?: readonly { name: string; amount: number }[];
  needsLook?: boolean;
};

export const PERIOD = {
  start: "30 Aug",
  end: "26 Sep",
  day: 13,
  daysInPeriod: 28,
  out: 4976,
  income: 2650,
  usualByDay: 3390,
  aheadOfUsual: 1586,
  unresolved: 340,
  unresolvedPayments: 3,
} as const;

export const ATTENTION: readonly SpendCategory[] = [
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
    needsLook: true,
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
    needsLook: true,
  },
  {
    category: "Transport",
    spent: 448,
    payments: 22,
    usualByDay: 320,
    paceMultiple: 1.4,
    causes: [{ name: "Shell", amount: 210 }],
    needsLook: true,
  },
] as const;

export const ATTENTION_CHANGE = ATTENTION.reduce(
  (total, category) => total + category.spent - (category.usualByDay ?? category.spent),
  0,
);

export const ELSEWHERE_OFFSET = ATTENTION_CHANGE - PERIOD.aheadOfUsual;

export const QUIET: readonly SpendCategory[] = [
  { category: "Groceries", spent: 421, payments: 7 },
  { category: "Subscriptions", spent: 222, payments: 9 },
  { category: "Shopping", spent: 221, payments: 5 },
  { category: "Travel", spent: 168, payments: 4 },
  { category: "Cash", spent: 145, payments: 2 },
  { category: "Health", spent: 100, payments: 3 },
  { category: "Software", spent: 82, payments: 2 },
  { category: "Pets", spent: 60, payments: 2 },
  { category: "Entertainment", spent: 40, payments: 1 },
  { category: "Charity", spent: 37, payments: 1 },
  { category: "Education", spent: 0, payments: 0 },
] as const;

export const ALL_CATEGORIES: readonly SpendCategory[] = [...ATTENTION, ...QUIET];

export const MOVEMENT = [
  { kind: "own_accounts", label: "Between your own accounts", amount: 6075, payments: 31 },
  { kind: "pots", label: "To your pots", amount: 1200, payments: 12 },
  { kind: "credit_cards", label: "To credit cards", amount: 612, payments: 2 },
  { kind: "investments", label: "To investments", amount: 200, payments: 1 },
] as const;

export const MOVED_TOTAL = MOVEMENT.reduce((total, row) => total + row.amount, 0);

export const PERIOD_HISTORY = [
  { label: "30 Mar to 26 Apr", out: 3240, usual: 3140 },
  { label: "27 Apr to 24 May", out: 3610, usual: 3210 },
  { label: "25 May to 21 Jun", out: 3385, usual: 3270 },
  { label: "22 Jun to 19 Jul", out: 4020, usual: 3320 },
  { label: "20 Jul to 16 Aug", out: 3815, usual: 3360 },
  { label: "30 Aug to 26 Sep", out: 4976, usual: 3390, current: true },
] as const;

/** Cumulative production-shaped fixture for the real Spending pace chart. */
export const PACE_SERIES = [
  { day: 1, actual: 410, usual: 360 },
  { day: 2, actual: 820, usual: 670 },
  { day: 3, actual: 1050, usual: 930 },
  { day: 4, actual: 1280, usual: 1160 },
  { day: 5, actual: 1600, usual: 1430 },
  { day: 6, actual: 1900, usual: 1700 },
  { day: 7, actual: 2250, usual: 1950 },
  { day: 8, actual: 2600, usual: 2200 },
  { day: 9, actual: 2950, usual: 2450 },
  { day: 10, actual: 3380, usual: 2700 },
  { day: 11, actual: 3970, usual: 2940 },
  { day: 12, actual: 4510, usual: 3170 },
  { day: 13, actual: 4976, usual: 3390 },
] as const;

export const PAY_SHAPE = {
  takeHome: 2650,
  jobs: [
    { id: "fixed", label: "Fixed", share: 47, amount: 1246, colour: "#38bdf8" },
    { id: "moved", label: "Moved to savings", share: 15, amount: 398, colour: "#6366f1" },
    { id: "free", label: "Free", share: 28, amount: 742, colour: "#34d399" },
    { id: "left", label: "Left", share: 10, amount: 264, colour: "#94a3b8" },
  ],
} as const;

export const CATEGORY_COLOURS: Record<string, string> = {
  Bills: "#fb7185",
  "Eating Out": "#fb923c",
  Transport: "#60a5fa",
  Groceries: "#34d399",
  Subscriptions: "#22d3ee",
  Shopping: "#f472b6",
  Travel: "#818cf8",
  Cash: "#facc15",
  Health: "#2dd4bf",
  Software: "#a3e635",
  Pets: "#c084fc",
  Entertainment: "#c084fc",
  Charity: "#f9a8d4",
  Education: "#94a3b8",
};

function assertFacts() {
  const attention = ATTENTION.reduce((sum, row) => sum + row.spent, 0);
  const quiet = QUIET.reduce((sum, row) => sum + row.spent, 0);
  const reconciled = attention + quiet + PERIOD.unresolved;
  if (attention !== 3140 || quiet !== 1496 || reconciled !== PERIOD.out) {
    throw new Error(
      `[spend-page-refurbishment] expected 3,140 + 1,496 + 340 = 4,976; got ${attention} + ${quiet} + ${PERIOD.unresolved} = ${reconciled}`,
    );
  }
  if (ATTENTION_CHANGE !== 1730 || ELSEWHERE_OFFSET !== 144) {
    throw new Error(
      `[spend-page-refurbishment] expected 1,730 category change - 144 elsewhere = 1,586 ahead; got ${ATTENTION_CHANGE} - ${ELSEWHERE_OFFSET}`,
    );
  }
  const lastPacePoint = PACE_SERIES[PACE_SERIES.length - 1];
  if (lastPacePoint.actual !== PERIOD.out || lastPacePoint.usual !== PERIOD.usualByDay) {
    throw new Error("[spend-page-refurbishment] pace chart must end on the period Out and usual figures");
  }
  if (MOVED_TOTAL !== 8087) {
    throw new Error(`[spend-page-refurbishment] moved total is ${MOVED_TOTAL}, not 8,087`);
  }
  if (PAY_SHAPE.jobs.reduce((sum, job) => sum + job.share, 0) !== 100) {
    throw new Error("[spend-page-refurbishment] pay-shape shares must total 100");
  }
}

if (process.env.NODE_ENV !== "production") assertFacts();
