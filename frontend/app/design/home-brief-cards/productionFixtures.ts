import type { CompanionItem, UnfundedMoveEntry } from "@/lib/api";

export type ProductionCardKind =
  | "ask_payday"
  | "ask_generic"
  | "celebration"
  | "cliff"
  | "unfunded_move"
  | "intent_pace"
  | "cover_plan"
  | "rhythm";

export type ProductionCardFixture = {
  kind: ProductionCardKind;
  item: CompanionItem;
};

const PREMIER_ACCOUNT = {
  account_id: "premier-current",
  name: "Premier Current",
  provider: "Barclays",
  balance: 44.68,
};

const HSBC_ACCOUNT = {
  account_id: "hsbc-current",
  name: "HSBC Current",
  provider: "HSBC",
  balance: 1280,
};

const MONZO_ACCOUNT = {
  account_id: "monzo-current",
  name: "Monzo",
  provider: "Monzo",
  balance: 640,
};

const SAVINGS_ACCOUNT = {
  account_id: "savings",
  name: "Savings",
  provider: "Nationwide",
  balance: 2100,
};

const unfundedMove: UnfundedMoveEntry = {
  key: "AMERICAN EXPRESS",
  label: "American Express",
  amount: 100,
  expected_date: "2026-09-09",
  days_past_due: 3,
  source_account_id: PREMIER_ACCOUNT.account_id,
  source_name: PREMIER_ACCOUNT.name,
  source_bank: PREMIER_ACCOUNT.provider,
  suggested_amount: 70,
  suggested_from_name: HSBC_ACCOUNT.name,
  suggested_from_count: 1,
  suggested_covers_all: true,
  suggested_sources: [{ ...HSBC_ACCOUNT, amount: 70 }],
};

export const PRODUCTION_CARD_FIXTURES: readonly ProductionCardFixture[] = [
  {
    kind: "ask_payday",
    item: {
      id: "ask:payday",
      type: "ask",
      headline: "Is this your payday?",
      body: "Looks like £2,450 from Auriq Ltd is expected on 12 Sept.",
      action: { label: "Yes, that's it", route: "#", kind: "confirm_payday" },
      secondary_action: { label: "No, set it myself", route: "#", kind: "set_payday" },
      estimated: false,
      brief_lead: { value: "12 Sept", companion: "expected payday · £2,450 expected" },
      proposal: {
        key: "salary",
        merchant: "Auriq Ltd",
        amount: 2450,
        occurrences: 4,
        schedule: { type: "monthly" },
        schedule_label: "Monthly",
        payday_phrase: "12 Sept",
        pay_period_config: {},
        next_date: "2026-09-12",
        last_seen: "2026-08-12",
        account_id: HSBC_ACCOUNT.account_id,
      },
    },
  },
  {
    kind: "ask_generic",
    item: {
      id: "ask:card_terms",
      type: "ask",
      headline: "Want your card picture sharp?",
      body: "Tell me the rate on your card and I can plan around it. Takes a minute.",
      action: { label: "Add my rates", route: "#", kind: "card_terms" },
      estimated: false,
      brief_lead: { value: "Card details", companion: "one answer keeps the debt plan accurate" },
    },
  },
  {
    kind: "celebration",
    item: {
      id: "celebrate:rent",
      type: "celebration",
      headline: "Sorted: your rent is covered",
      body: "The money is already held aside for 28 Sept.",
      action: null,
      estimated: false,
      brief_lead: { value: "£925", companion: "held aside" },
    },
  },
  {
    kind: "cliff",
    item: {
      id: "cliff:american-express:2026-09-30",
      type: "cliff",
      headline: "Your American Express offer ends soon",
      body: "Its rate changes after 30 Sept. You can review the next payment before then.",
      action: { label: "Review card", route: "#" },
      estimated: false,
      brief_lead: { value: "30 Sept", companion: "rate changes from 0% to 24.9%" },
    },
  },
  {
    kind: "unfunded_move",
    item: {
      id: "unfunded_move:2026-09-12:preview",
      type: "unfunded_move",
      headline: "A planned move may not have the funds.",
      body: "£100 to American Express from Premier Current was due Wed 9 Sept. Moving £70 from HSBC Current covers it.",
      action: { label: "See it in Upcoming", route: "#" },
      estimated: false,
      brief_lead: { value: "£70", companion: "suggested from HSBC Current" },
      moves: [unfundedMove] as unknown as CompanionItem["moves"],
    },
  },
  {
    kind: "intent_pace",
    item: {
      id: "intent_pace:2026-08-28:Groceries",
      type: "intent_pace",
      headline: "Groceries: £138 so far vs £150 usual by now",
      body: "Tracking the change you asked for, no action needed.",
      action: null,
      estimated: false,
      brief_lead: { value: "£138", companion: "of £150 usual by now" },
    },
  },
  {
    kind: "cover_plan",
    item: {
      id: "plan:2026-09-28:preview",
      type: "move",
      headline: "Move £70 to Premier Current",
      body: "£70 across 3 moves keeps everything clearing at Premier Current.",
      action: { label: "See what's due", route: "#" },
      estimated: false,
      brief_lead: { value: "£70", companion: "to Premier Current" },
      plan_dest: {
        ...PREMIER_ACCOUNT,
        needs_total: 100,
        needs_by: "9 Sept",
        bills: [{ label: "American Express", amount: 100 }],
      },
      moves: [
        { headline: "Move £25 from HSBC Current", amount: 25, move_map: { from: { ...HSBC_ACCOUNT, safe_note: "Covers its own bills" }, to: { ...PREMIER_ACCOUNT, incoming: "£100 due" } } },
        { headline: "Move £25 from Monzo", amount: 25, move_map: { from: { ...MONZO_ACCOUNT, safe_note: "Covers its own bills" }, to: { ...PREMIER_ACCOUNT, incoming: "£100 due" } } },
        { headline: "Move £20 from Savings", amount: 20, move_map: { from: { ...SAVINGS_ACCOUNT, safe_note: "Nothing due from this account" }, to: { ...PREMIER_ACCOUNT, incoming: "£100 due" } } },
      ],
      covered: true,
      sources_safe: true,
      amount: 70,
    },
  },
  {
    kind: "rhythm",
    item: {
      id: "rhythm:checkpoint:2026-08-28:Eating out",
      type: "rhythm",
      headline: "Eating out is running 1.8× your usual",
      body: "£62.50 so far this period.",
      action: null,
      estimated: false,
      brief_lead: { value: "£46.50", companion: "at Dishoom · 6 Sept" },
      payload: {
        category: "Eating out",
        multiple: 1.8,
        spent: 62.5,
        period_end: "2026-09-27",
        dominant: { name: "Dishoom", amount: 46.5, date: "2026-09-06" },
      },
    },
  },
];

export const PRODUCTION_STACK_IDS = [
  "unfunded_move:2026-09-12:preview",
  "plan:2026-09-28:preview",
  "intent_pace:2026-08-28:Groceries",
] as const;
