// TEMPORARY PREVIEW — delete after design review.
//
// Fixture data for /design/planning — 3 art-direction variants of the
// Planning page ("What's coming", frontend/app/planning/PlanningPage.tsx),
// built off the real states from the owner's own data:
//
//  - "short": a genuine account shortfall (Barclays, -£231.30 before
//    payday, caused by a traced £400.00 move on Tue 1 Sept), TO LAST THIS
//    PAY PERIOD negative (-£159), two bills on the Barclays account
//    genuinely at risk (so the repeated-culprit case is exercised: both
//    rows would, on the live page, repeat the same "£400.00 move" sentence
//    verbatim), plus one timing-risk account (HSBC, money due in same day),
//    a pending own-transfer, an insight hint, and a next-period row.
//  - "healthy": no shortfall, TO LAST positive (+£715), everything calm,
//    still carrying a goal in progress so Commitments/goal-card capability
//    stays visible in both states.
//
// Every row shape mirrors PlanningPage.tsx's real item fields closely
// enough for each variant to render its own take, but this is a static
// mock — no api.ts types imported, no live computation.

export type ShortfallAccount = {
  bank: string;
  shortfall: number;
  culprit: { amount: number; dateLabel: string } | null;
};

export type PlanRow = {
  id: string;
  name: string;
  bank: string;
  category: string;
  type: "bill" | "income";
  amount: number;
  dateLabel: string;
  dayGroup: string; // "Today" | "Tomorrow" | "3 days" | ...
  nextPeriod?: boolean;
  balanceAfter: number;
  risk?: "genuine" | "timing";
  riskAccount?: string;
  culprit?: { amount: number; dateLabel: string };
  isMovement?: boolean;
  pooledNoOp?: boolean;
  pending?: { dateLabel: string; daysPastDue: number };
  insightHint?: { est: string };
  edited?: boolean;
  /**
   * Mirrors PlanningPage.tsx's `isSettling` (built off the live
   * `item.observed_pending` flag): a bank-side PENDING debit already fired,
   * the money has left the account per the bank, the settled feed just
   * hasn't caught up. Deliberately set on a "Debt" category row here (brand
   * colour #f87171, a red hue) to demonstrate the fix this state exists
   * for — without isSettling's own icon-chip override, a settled credit-
   * card repayment would render with a reddish-tinted chip despite being
   * fully resolved, the owner's literal "red receipt/card icon chips on
   * rows that already left" complaint.
   */
  isSettling?: boolean;
};

export type Goal = {
  name: string;
  monthLabel: string;
  progress: number;
  amount: number;
  perPeriod: number;
  periodsLeft: number;
  onTrack: boolean;
  feasibilityNote?: string;
};

export type PlanningFixture = {
  runway: number;
  spendableNow: number;
  billsTotal: number;
  savingsNow: number;
  daysToPayday: number;
  paydayLabel: string;
  shortfalls: ShortfallAccount[];
  timingAccounts: { bank: string; dueDateLabel: string }[];
  cardPlan: { text: string; soon: boolean };
  growLink: { text: string };
  goals: Goal[];
  rows: PlanRow[];
  nextPeriodFromLabel: string;
};

export const FIXTURES: Record<"short" | "healthy", PlanningFixture> = {
  short: {
    runway: -159,
    spendableNow: 612,
    billsTotal: 771,
    savingsNow: 1107,
    daysToPayday: 5,
    paydayLabel: "Tue 8 Sept",
    shortfalls: [
      {
        bank: "Barclays",
        shortfall: 231.3,
        culprit: { amount: 400, dateLabel: "Tue 1 Sept" },
      },
    ],
    timingAccounts: [{ bank: "HSBC", dueDateLabel: "Thu 4 Sept" }],
    cardPlan: { text: "Next 0% ends Sept 2026", soon: true },
    growLink: { text: "£39/mo spare" },
    goals: [
      {
        name: "Summer holiday",
        monthLabel: "Oct 2026",
        progress: 0,
        amount: 500,
        perPeriod: 62,
        periodsLeft: 8,
        onTrack: false,
        feasibilityNote: "A stretch at this pace, worth a smaller monthly slice.",
      },
    ],
    nextPeriodFromLabel: "Fri 25 Sept",
    rows: [
      {
        id: "b1",
        name: "Council Tax",
        bank: "Barclays",
        category: "Bills",
        type: "bill",
        amount: 142.0,
        dateLabel: "Wed 3 Sept",
        dayGroup: "Today",
        balanceAfter: 470,
      },
      {
        id: "b2",
        name: "Car Insurance",
        bank: "Barclays",
        category: "Transport",
        type: "bill",
        amount: 64.5,
        dateLabel: "Wed 3 Sept",
        dayGroup: "Today",
        balanceAfter: -231.3,
        risk: "genuine",
        riskAccount: "Barclays",
        culprit: { amount: 400, dateLabel: "Tue 1 Sept" },
      },
      {
        id: "b3",
        name: "Gym Membership",
        bank: "Barclays",
        category: "Health",
        type: "bill",
        amount: 34.99,
        dateLabel: "Thu 4 Sept",
        dayGroup: "Tomorrow",
        balanceAfter: -266.29,
        risk: "genuine",
        riskAccount: "Barclays",
        culprit: { amount: 400, dateLabel: "Tue 1 Sept" },
      },
      {
        id: "i1",
        name: "Standing order to Vanguard",
        bank: "Barclays",
        category: "Savings",
        type: "bill",
        amount: 400.0,
        dateLabel: "Tue 1 Sept",
        dayGroup: "Today",
        balanceAfter: -231.3,
        isMovement: true,
      },
      {
        id: "settle1",
        name: "Barclaycard Repayment",
        bank: "Barclays",
        category: "Debt",
        type: "bill",
        amount: 89.0,
        dateLabel: "Wed 3 Sept",
        dayGroup: "Today",
        balanceAfter: 612,
        isSettling: true,
      },
      {
        id: "b4",
        name: "Broadband",
        bank: "HSBC",
        category: "Bills",
        type: "bill",
        amount: 32.0,
        dateLabel: "Thu 4 Sept",
        dayGroup: "Tomorrow",
        balanceAfter: 210,
        risk: "timing",
        riskAccount: "HSBC",
      },
      {
        id: "b5",
        name: "Electricity",
        bank: "Octopus",
        category: "Bills",
        type: "bill",
        amount: 55.0,
        dateLabel: "Sat 6 Sept",
        dayGroup: "3 days",
        balanceAfter: 155,
        insightHint: { est: "32" },
      },
      {
        id: "own1",
        name: "Transfer to Savings pot",
        bank: "Barclays",
        category: "Transfer",
        type: "bill",
        amount: 50.0,
        dateLabel: "Sat 6 Sept",
        dayGroup: "3 days",
        balanceAfter: 155,
        isMovement: true,
        pooledNoOp: true,
      },
      {
        id: "b6",
        name: "Phone Contract",
        bank: "Monzo",
        category: "Bills",
        type: "bill",
        amount: 42.0,
        dateLabel: "Mon 8 Sept",
        dayGroup: "5 days",
        balanceAfter: 113,
        pending: { dateLabel: "Fri 5 Sept", daysPastDue: 3 },
      },
      {
        id: "n1",
        name: "Salary",
        bank: "Barclays",
        category: "Income",
        type: "income",
        amount: 2450.0,
        dateLabel: "Tue 8 Sept",
        dayGroup: "5 days",
        nextPeriod: true,
        balanceAfter: 2563,
      },
      {
        id: "n2",
        name: "Rent",
        bank: "Barclays",
        category: "Bills",
        type: "bill",
        amount: 950.0,
        dateLabel: "Fri 11 Sept",
        dayGroup: "8 days",
        nextPeriod: true,
        balanceAfter: 1613,
      },
    ],
  },
  healthy: {
    runway: 715,
    spendableNow: 1486,
    billsTotal: 771,
    savingsNow: 1107,
    daysToPayday: 5,
    paydayLabel: "Tue 8 Sept",
    shortfalls: [],
    timingAccounts: [],
    cardPlan: { text: "Next 0% ends Sept 2026", soon: true },
    growLink: { text: "£39/mo spare" },
    goals: [
      {
        name: "Summer holiday",
        monthLabel: "Oct 2026",
        progress: 260,
        amount: 500,
        perPeriod: 62,
        periodsLeft: 4,
        onTrack: true,
      },
    ],
    nextPeriodFromLabel: "Fri 25 Sept",
    rows: [
      {
        id: "b1",
        name: "Council Tax",
        bank: "Barclays",
        category: "Bills",
        type: "bill",
        amount: 142.0,
        dateLabel: "Wed 3 Sept",
        dayGroup: "Today",
        balanceAfter: 1344,
      },
      {
        id: "b2",
        name: "Car Insurance",
        bank: "Barclays",
        category: "Transport",
        type: "bill",
        amount: 64.5,
        dateLabel: "Wed 3 Sept",
        dayGroup: "Today",
        balanceAfter: 1279.5,
      },
      {
        id: "settle1",
        name: "Barclaycard Repayment",
        bank: "Barclays",
        category: "Debt",
        type: "bill",
        amount: 89.0,
        dateLabel: "Wed 3 Sept",
        dayGroup: "Today",
        balanceAfter: 1486,
        isSettling: true,
      },
      {
        id: "b4",
        name: "Broadband",
        bank: "HSBC",
        category: "Bills",
        type: "bill",
        amount: 32.0,
        dateLabel: "Thu 4 Sept",
        dayGroup: "Tomorrow",
        balanceAfter: 1247.5,
      },
      {
        id: "b5",
        name: "Electricity",
        bank: "Octopus",
        category: "Bills",
        type: "bill",
        amount: 55.0,
        dateLabel: "Sat 6 Sept",
        dayGroup: "3 days",
        balanceAfter: 1192.5,
        insightHint: { est: "32" },
      },
      {
        id: "own1",
        name: "Transfer to Savings pot",
        bank: "Barclays",
        category: "Transfer",
        type: "bill",
        amount: 50.0,
        dateLabel: "Sat 6 Sept",
        dayGroup: "3 days",
        balanceAfter: 1192.5,
        isMovement: true,
        pooledNoOp: true,
      },
      {
        id: "b6",
        name: "Phone Contract",
        bank: "Monzo",
        category: "Bills",
        type: "bill",
        amount: 42.0,
        dateLabel: "Mon 8 Sept",
        dayGroup: "5 days",
        balanceAfter: 1150.5,
        pending: { dateLabel: "Fri 5 Sept", daysPastDue: 3 },
      },
      {
        id: "n1",
        name: "Salary",
        bank: "Barclays",
        category: "Income",
        type: "income",
        amount: 2450.0,
        dateLabel: "Tue 8 Sept",
        dayGroup: "5 days",
        nextPeriod: true,
        balanceAfter: 3600.5,
      },
      {
        id: "n2",
        name: "Rent",
        bank: "Barclays",
        category: "Bills",
        type: "bill",
        amount: 950.0,
        dateLabel: "Fri 11 Sept",
        dayGroup: "8 days",
        nextPeriod: true,
        balanceAfter: 2650.5,
      },
    ],
  },
};

export function fmtC(n: number): string {
  const sign = n < 0 ? "−" : "";
  return `${sign}£${Math.abs(Math.round(n)).toLocaleString("en-GB")}`;
}

export function fmtC2(n: number): string {
  const sign = n < 0 ? "−" : "";
  return `${sign}£${Math.abs(n).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
