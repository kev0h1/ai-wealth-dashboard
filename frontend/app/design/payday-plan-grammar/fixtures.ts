import type { PaydayPlanDest, PaydayPlanSalary } from "@/lib/api";

export type PaydayScenario = {
  id: "five" | "ten";
  payday: string;
  salary: PaydayPlanSalary;
  destinations: readonly PaydayPlanDest[];
};

function destination(
  account_id: string,
  name: string,
  provider: string,
  move: number,
  parts: Pick<PaydayPlanDest, "bills_total" | "spend_typical" | "buffer" | "commitment_names">,
): PaydayPlanDest {
  return {
    account_id,
    name,
    provider,
    balance: 0,
    target: move,
    usual: null,
    bill_count: parts.bills_total > 0 ? 2 : 0,
    bills_total: parts.bills_total,
    spend_typical: parts.spend_typical,
    buffer: parts.buffer,
    move,
    commitment_names: parts.commitment_names,
  };
}

const SALARY_FIVE: PaydayPlanSalary = {
  account_id: "salary-barclays",
  name: "Premier Current",
  provider: "Barclays",
  amount: 3450,
  stays: 1090,
};

const SALARY_TEN: PaydayPlanSalary = {
  account_id: "salary-barclays",
  name: "Premier Current",
  provider: "Barclays",
  amount: 3450,
  stays: 630,
};

export const PAYDAY_SCENARIOS: readonly PaydayScenario[] = [
  {
    id: "five",
    payday: "Fri 27 Sept",
    salary: SALARY_FIVE,
    destinations: [
      destination("bills-hsbc", "Bills Current", "HSBC", 900, { bills_total: 650, spend_typical: 0, buffer: 250 }),
      destination("everyday-monzo", "Everyday", "Monzo", 520, { bills_total: 0, spend_typical: 400, buffer: 120 }),
      destination("joint-natwest", "Joint Current", "NatWest", 460, { bills_total: 420, spend_typical: 0, buffer: 40 }),
      destination("saver-nationwide", "Savings", "Nationwide", 300, { bills_total: 0, spend_typical: 0, buffer: 0, commitment_names: ["House deposit"] }),
      destination("travel-starling", "Travel pot", "Starling", 180, { bills_total: 0, spend_typical: 0, buffer: 0, commitment_names: ["Summer holiday"] }),
    ],
  },
  {
    id: "ten",
    payday: "Fri 27 Sept",
    salary: SALARY_TEN,
    destinations: [
      destination("bills-hsbc", "Bills Current", "HSBC", 900, { bills_total: 650, spend_typical: 0, buffer: 250 }),
      destination("everyday-monzo", "Everyday", "Monzo", 520, { bills_total: 0, spend_typical: 400, buffer: 120 }),
      destination("joint-natwest", "Joint Current", "NatWest", 460, { bills_total: 420, spend_typical: 0, buffer: 40 }),
      destination("saver-nationwide", "Savings", "Nationwide", 300, { bills_total: 0, spend_typical: 0, buffer: 0, commitment_names: ["House deposit"] }),
      destination("travel-starling", "Travel pot", "Starling", 180, { bills_total: 0, spend_typical: 0, buffer: 0, commitment_names: ["Summer holiday"] }),
      destination("isa-vanguard", "Stocks & Shares ISA", "Vanguard", 160, { bills_total: 0, spend_typical: 0, buffer: 0, commitment_names: ["Long-term investing"] }),
      destination("car-monza", "Car fund", "Monzo", 110, { bills_total: 0, spend_typical: 0, buffer: 110 }),
      destination("gifts-starling", "Gifts pot", "Starling", 80, { bills_total: 0, spend_typical: 0, buffer: 80 }),
      destination("tax-hsbc", "Tax reserve", "HSBC", 70, { bills_total: 0, spend_typical: 0, buffer: 70 }),
      destination("giving-natwest", "Giving", "NatWest", 40, { bills_total: 0, spend_typical: 0, buffer: 0, commitment_names: ["Monthly giving"] }),
    ],
  },
] as const;

export function totalMoving(scenario: PaydayScenario) {
  return scenario.destinations.reduce((total, destination) => total + destination.move, 0);
}
