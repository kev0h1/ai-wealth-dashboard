import type { CompanionItem } from "@/lib/api";

// G128 fixtures. Kevin's real 2026-09-18 payday_plan payload (the fixture
// that surfaced the defect, given to the session verbatim, see backlog item
// G128) plus three INVENTED secondary states so the redesign proves out
// beyond one payload. Every invented number is commented as such; none of
// it is Kevin's real bank data.

/**
 * Kevin's real payload, unmodified. This is what makes the round honest:
 * it is literally the numbers he read as an arithmetic error. Do not round
 * or "clean up" any of these figures, they are the evidence.
 */
export const KEVIN_REAL_ITEM: CompanionItem = {
  id: "design-g128-kevin-real",
  type: "payday_plan",
  headline: "Payday plan: split £4,798 across 4 accounts",
  body: "A tight month: buffers trimmed so every payment is covered. £3,075 distributed.",
  action: { label: "See what's due ›", route: "/upcoming" },
  estimated: false,
  covered: false,
  total: 3075,
  trimmed: true,
  salary: {
    account_id: "salary-barclays-premier",
    name: "Premier Current Account",
    provider: "Barclays",
    amount: 4798,
    stays: 0,
  },
  dests: [
    {
      account_id: "dest-hsbc-maingi",
      name: "MAINGI K M",
      provider: "HSBC",
      balance: 12,
      bills_total: 1814,
      bill_count: 4,
      spend_typical: 0,
      buffer: 0,
      target: 1814,
      move: 1805,
      usual: 1695,
    },
    {
      account_id: "dest-natwest-numberone",
      name: "THE NUMBER ONE",
      provider: "NatWest",
      balance: 13,
      bills_total: 821,
      bill_count: 11,
      spend_typical: 20,
      buffer: 0,
      target: 841,
      move: 830,
      usual: 910,
    },
    {
      account_id: "dest-monzo-kevin",
      name: "Kevin Mbithi Maingi",
      provider: "Monzo",
      balance: 90,
      bills_total: 7,
      bill_count: 1,
      spend_typical: 420,
      buffer: 0,
      target: 427,
      move: 340,
      usual: 833,
    },
    {
      account_id: "dest-barclays-personal",
      name: "Personal GBP",
      provider: "Barclays",
      balance: 100,
      bills_total: 0,
      bill_count: 0,
      spend_typical: 0,
      buffer: 0,
      target: 0,
      move: 100,
      usual: 100,
    },
    {
      account_id: "dest-starling-personal",
      name: "Personal",
      provider: "Starling",
      balance: 3,
      bills_total: 0,
      bill_count: 0,
      spend_typical: 0,
      buffer: 0,
      target: 0,
      move: 0,
      usual: 50,
    },
    {
      account_id: "dest-revolut-kevin",
      name: "Kevin Maingi",
      provider: "Revolut",
      balance: 12,
      bills_total: 0,
      bill_count: 0,
      spend_typical: 0,
      buffer: 0,
      target: 0,
      move: 0,
      usual: 20,
    },
    {
      account_id: "dest-chase-maing",
      name: "Main G",
      provider: "Chase",
      balance: 24,
      bills_total: 0,
      bill_count: 0,
      spend_typical: 0,
      buffer: 0,
      target: 0,
      move: 0,
      usual: 50,
    },
  ],
  payday_split: {
    total: 4105,
    count: 7,
    expected_in: 4800,
    accounts: [{ account_id: "salary-barclays-premier", name: "Premier Current Account", out: 4105 }],
  },
  payday_split_risk: {
    account_id: "salary-barclays-premier",
    name: "Premier Current Account",
    shortfall: 4014,
    copy: "Your £4,105 payday split fires the morning your salary is expected. If the salary is late, Premier Current Account can't cover it.",
  },
};

/**
 * INVENTED (a): covered, not trimmed, money left in the salary account.
 * Every figure below is made up for this preview, not Kevin's data.
 */
export const COVERED_ITEM: CompanionItem = {
  id: "design-g128-invented-covered",
  type: "payday_plan",
  headline: "Payday plan: split £3,200 across 3 accounts",
  body: "£1,380 distributed, £1,820 stays in Everyday Account.",
  action: { label: "See what's due ›", route: "/upcoming" },
  estimated: false,
  covered: true,
  total: 1380,
  trimmed: false,
  salary: {
    account_id: "invented-salary-monzo",
    name: "Everyday Account",
    provider: "Monzo",
    amount: 3200,
    stays: 1820,
  },
  dests: [
    {
      account_id: "invented-dest-starling-bills",
      name: "Bills Pot",
      provider: "Starling",
      balance: 40,
      bills_total: 650,
      bill_count: 3,
      spend_typical: 0,
      buffer: 250,
      target: 900,
      move: 860,
      usual: 850,
    },
    {
      account_id: "invented-dest-monzo-everyday",
      name: "Everyday Spending",
      provider: "Monzo",
      balance: 120,
      bills_total: 0,
      bill_count: 0,
      spend_typical: 420,
      buffer: 120,
      target: 540,
      move: 420,
      usual: 430,
    },
    {
      account_id: "invented-dest-chase-holiday",
      name: "Holiday Pot",
      provider: "Chase",
      balance: 0,
      bills_total: 0,
      bill_count: 0,
      spend_typical: 0,
      buffer: 0,
      target: 0,
      move: 100,
      usual: 100,
    },
  ],
  payday_split: {
    total: 380,
    count: 2,
    expected_in: 3200,
    accounts: [{ account_id: "invented-salary-monzo", name: "Everyday Account", out: 380 }],
  },
  // No payday_split_risk: fully funded, so this state also demonstrates the
  // quiet informational line with no amber risk row underneath it.
};

/**
 * INVENTED (b): the isSet case, nothing to move at all. Every figure is
 * made up for this preview.
 */
export const SET_ITEM: CompanionItem = {
  id: "design-g128-invented-set",
  type: "payday_plan",
  headline: "Payday plan: every account is already set",
  body: "Every account already holds what it needs this period.",
  action: { label: "See what's due ›", route: "/upcoming" },
  estimated: false,
  covered: true,
  total: 0,
  trimmed: false,
  salary: {
    account_id: "invented-salary-barclays",
    name: "Premier Current Account",
    provider: "Barclays",
    amount: 2650,
    stays: 2650,
  },
  dests: [],
};

/**
 * INVENTED (c): a payload with no payday_split at all (no bills fall due on
 * payday itself this period). Every figure is made up for this preview.
 */
export const NO_SPLIT_ITEM: CompanionItem = {
  id: "design-g128-invented-nosplit",
  type: "payday_plan",
  headline: "Payday plan: split £3,000 across 3 accounts",
  body: "£900 distributed, £200 stays in Salary Account.",
  action: { label: "See what's due ›", route: "/upcoming" },
  estimated: false,
  covered: true,
  total: 900,
  trimmed: false,
  salary: {
    account_id: "invented-salary-natwest",
    name: "Salary Account",
    provider: "NatWest",
    amount: 3000,
    stays: 200,
  },
  dests: [
    {
      account_id: "invented-dest-hsbc-bills",
      name: "Bills",
      provider: "HSBC",
      balance: 20,
      bills_total: 540,
      bill_count: 2,
      spend_typical: 0,
      buffer: 0,
      target: 540,
      move: 520,
      usual: 500,
    },
    {
      account_id: "invented-dest-monzo-spend",
      name: "Spending",
      provider: "Monzo",
      balance: 60,
      bills_total: 0,
      bill_count: 0,
      spend_typical: 300,
      buffer: 80,
      target: 380,
      move: 320,
      usual: 300,
    },
    {
      account_id: "invented-dest-chase-tax",
      name: "Tax Pot",
      provider: "Chase",
      balance: 0,
      bills_total: 0,
      bill_count: 0,
      spend_typical: 0,
      buffer: 0,
      target: 0,
      move: 60,
      usual: 60,
    },
  ],
  // payday_split intentionally omitted.
};

export type FixtureState = "kevin" | "covered" | "set" | "nosplit";

export const FIXTURES: Record<FixtureState, CompanionItem> = {
  kevin: KEVIN_REAL_ITEM,
  covered: COVERED_ITEM,
  set: SET_ITEM,
  nosplit: NO_SPLIT_ITEM,
};
