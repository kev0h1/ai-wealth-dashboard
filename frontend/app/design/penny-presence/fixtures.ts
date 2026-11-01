import type { CompanionItem, PaydayPlanDest, PaydayPlanSalary } from "@/lib/api";

/** Public knobs consumed by the local G388 design shell. */
export type PresenceVariant = "current" | "a" | "b" | "c" | "d" | "e" | "f";
export type PresenceState = "stack" | "card-detail" | "cover-plan" | "payday-plan" | "covered";

const EVERYDAY = {
  account_id: "g388-everyday",
  name: "Everyday account",
  provider: "Barclays",
  balance: 1260,
};

const BILLS = {
  account_id: "g388-bills",
  name: "Bills account",
  provider: "Monzo",
  balance: 88,
};

const SAVER = {
  account_id: "g388-saver",
  name: "Easy access saver",
  provider: "Nationwide",
  balance: 840,
};

const JAPAN_POT = {
  account_id: "g388-japan-pot",
  name: "Japan trip pot",
  provider: "Nationwide",
  balance: 0,
};

const SALARY: PaydayPlanSalary = {
  account_id: EVERYDAY.account_id,
  name: EVERYDAY.name,
  provider: EVERYDAY.provider,
  amount: 2450,
  stays: 1418,
};

const PAYDAY_DESTINATIONS: PaydayPlanDest[] = [
  {
    ...BILLS,
    bills_total: 790,
    bill_count: 3,
    spend_typical: 0,
    buffer: 90,
    target: 880,
    move: 792,
    usual: null,
  },
  {
    ...JAPAN_POT,
    bills_total: 0,
    bill_count: 0,
    spend_typical: 0,
    buffer: 0,
    target: 240,
    move: 240,
    usual: null,
    commitment_names: ["Japan trip"],
  },
];

/** Synthetic only. The dates are deliberately current or upcoming in this preview. */
export const PRESENCE_FIXTURES = {
  cardDetail: {
    id: "g388:card-detail",
    type: "ask",
    headline: "Want your card picture sharp?",
    body: "Tell me the rate on your card and I can plan around it. Takes a minute.",
    action: { label: "Add my rates", route: "/cards", kind: "card_terms" },
    estimated: false,
    brief_lead: { value: "Card details", companion: "one answer keeps the debt plan accurate" },
  } satisfies CompanionItem,
  coverPlan: {
    id: "g388:cover-plan",
    type: "move",
    headline: "Move £72 to Bills account",
    body: "£72 across two moves keeps everything clearing in the Bills account.",
    action: { label: "See what’s due", route: "/upcoming" },
    estimated: false,
    brief_lead: { value: "£72", companion: "to Bills account" },
    plan_dest: {
      ...BILLS,
      needs_total: 160,
      needs_by: "8 Nov",
      bills: [{ label: "Mobile", amount: 160, expected_date: "2026-11-08" }],
    },
    moves: [
      {
        headline: "Move £42 from Everyday account",
        amount: 42,
        move_map: {
          from: { ...EVERYDAY, safe_note: "Covers its own bills" },
          to: { ...BILLS, incoming: "£160 due" },
        },
      },
      {
        headline: "Move £30 from Easy access saver",
        amount: 30,
        move_map: {
          from: { ...SAVER, safe_note: "Nothing due from this account" },
          to: { ...BILLS, incoming: "£160 due" },
        },
      },
    ],
    covered: true,
    sources_safe: true,
    amount: 72,
  } satisfies CompanionItem,
  paydayPlan: {
    id: "g388:payday-plan",
    type: "payday_plan",
    headline: "Payday plan: split £1,032 across 2 accounts",
    body: "£1,032 distributed, £1,418 stays in Everyday account.",
    action: { label: "See the full plan", route: "/upcoming" },
    estimated: false,
    total: 1032,
    preview: true,
    next_pay: "2026-11-25",
    dests: PAYDAY_DESTINATIONS,
    salary: SALARY,
  } satisfies CompanionItem,
  covered: {
    id: "g388:covered",
    type: "celebration",
    headline: "Household account has enough for what’s due",
    body: "This account has enough, so the £160 council tax payment should go through.",
    action: null,
    estimated: false,
    brief_lead: { value: "£160", companion: "council tax due 8 Nov" },
  } satisfies CompanionItem,
} as const;

export const PRESENCE_STACK_ORDER = ["cardDetail", "coverPlan", "paydayPlan", "covered"] as const;

export const PRESENCE_ACTION_ROUTES: Record<string, string> = {
  "Add my rates": "/cards",
  "See what’s due": "/upcoming",
  "See the full plan": "/upcoming",
  "View in Upcoming": "/upcoming",
  "Home": "/",
  "Spend": "/spend",
  "Upcoming": "/upcoming",
  "Planning": "/planning",
};
