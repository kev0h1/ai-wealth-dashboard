export type MoveAccount = {
  name: string;
  provider: string;
  amount?: number;
};

export type MovePayment = {
  name: string;
  amount: number;
  due: string;
};

export type MoveScenario = {
  id: "one-source" | "three-sources" | "five-sources" | "three-payments";
  status: "Move overdue" | "Cover plan";
  overdue: boolean;
  destination: MoveAccount & {
    held: number;
    needed: number;
    buffer: number;
    due: string;
  };
  payments: readonly MovePayment[];
  sources: readonly (MoveAccount & { amount: number })[];
  moving: number;
  assurance: string;
  primaryAction: string;
  secondaryAction?: string;
};

const DESTINATION = {
  name: "Premier Current",
  provider: "Barclays",
  held: 40,
  needed: 100,
  buffer: 10,
  due: "9 Sept",
} as const;

const PAYMENT = {
  name: "American Express",
  amount: 100,
  due: "9 Sept",
} as const;

export const MOVE_SCENARIOS: readonly MoveScenario[] = [
  {
    id: "one-source",
    status: "Move overdue",
    overdue: true,
    destination: DESTINATION,
    payments: [PAYMENT],
    sources: [{ name: "HSBC Current", provider: "HSBC", amount: 70 }],
    moving: 70,
    assurance: "The source account still covers its own bills.",
    primaryAction: "See it in Upcoming",
    secondaryAction: "Skip this month",
  },
  {
    id: "three-sources",
    status: "Cover plan",
    overdue: false,
    destination: DESTINATION,
    payments: [PAYMENT],
    sources: [
      { name: "HSBC Current", provider: "HSBC", amount: 25 },
      { name: "Monzo", provider: "Monzo", amount: 25 },
      { name: "Savings", provider: "Nationwide", amount: 20 },
    ],
    moving: 70,
    assurance: "Every source still covers its own bills.",
    primaryAction: "See what’s due",
  },
  {
    id: "three-payments",
    status: "Cover plan",
    overdue: false,
    destination: {
      ...DESTINATION,
      needed: 170,
      buffer: 10,
      due: "12 Sept",
    },
    payments: [
      PAYMENT,
      { name: "British Gas", amount: 42, due: "10 Sept" },
      { name: "EE", amount: 28, due: "12 Sept" },
    ],
    sources: [
      { name: "HSBC Current", provider: "HSBC", amount: 55 },
      { name: "Monzo", provider: "Monzo", amount: 45 },
      { name: "Savings", provider: "Nationwide", amount: 40 },
    ],
    moving: 140,
    assurance: "All three payments are covered; every source still covers its own bills.",
    primaryAction: "See what’s due",
  },
  {
    id: "five-sources",
    status: "Cover plan",
    overdue: false,
    destination: DESTINATION,
    payments: [PAYMENT],
    sources: [
      { name: "HSBC Current", provider: "HSBC", amount: 20 },
      { name: "Monzo", provider: "Monzo", amount: 15 },
      { name: "Savings", provider: "Nationwide", amount: 15 },
      { name: "Everyday", provider: "Santander", amount: 10 },
      { name: "Reserve", provider: "Halifax", amount: 10 },
    ],
    moving: 70,
    assurance: "Every source still covers its own bills.",
    primaryAction: "See what’s due",
  },
] as const;
