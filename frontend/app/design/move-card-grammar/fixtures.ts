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
  id: "one-source" | "three-sources";
  status: "Move overdue" | "Cover plan";
  overdue: boolean;
  destination: MoveAccount & {
    held: number;
    needed: number;
    due: string;
  };
  payment: MovePayment;
  sources: readonly (MoveAccount & { amount: number })[];
  moving: number;
  assurance: string;
  primaryAction: string;
  secondaryAction?: string;
};

const DESTINATION = {
  name: "Premier Current",
  provider: "Barclays",
  held: 44.68,
  needed: 100,
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
    payment: PAYMENT,
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
    payment: PAYMENT,
    sources: [
      { name: "HSBC Current", provider: "HSBC", amount: 25 },
      { name: "Monzo", provider: "Monzo", amount: 25 },
      { name: "Savings", provider: "Nationwide", amount: 20 },
    ],
    moving: 70,
    assurance: "Every source still covers its own bills.",
    primaryAction: "See what’s due",
  },
] as const;
