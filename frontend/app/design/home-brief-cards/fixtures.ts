/**
 * Local, preview-only content for the Home brief card-family round.
 * These fixtures describe what is known to the card. They deliberately do
 * not model any resolver or make claims about how a recommendation was made.
 */

export type StatusTone = "penny" | "positive" | "watch" | "neutral";

export type CardAction = {
  label: string;
  kind: "primary" | "secondary" | "quiet";
};

export type CardSource = {
  account: string;
  provider?: string;
  detail?: string;
};

export type CardEvidence = {
  label: string;
  value: string;
};

export type AccountContribution = CardSource & {
  amount: number;
};

type CardFixtureBase = {
  id: string;
  tone: StatusTone;
  headline: string;
  body?: string;
  source?: CardSource;
  evidence?: CardEvidence[];
  actions?: CardAction[];
  dismissible?: boolean;
};

export type AskPaydayFixture = CardFixtureBase & {
  kind: "ask_payday";
  payday: string;
  expectedIncome: number;
};

export type AskGenericFixture = CardFixtureBase & {
  kind: "ask_generic";
  question: string;
};

export type CelebrationFixture = CardFixtureBase & {
  kind: "celebration";
  coveredAmount: number;
};

export type CliffFixture = CardFixtureBase & {
  kind: "cliff";
  date: string;
  rateFrom: number;
  rateTo: number;
};

export type UnfundedMoveFixture = CardFixtureBase & {
  kind: "unfunded_move";
  move: {
    label: string;
    amount: number;
    due: string;
    destination: CardSource;
    holding: number;
    suggestedSource: CardSource & { amount: number };
  };
};

export type IntentPaceFixture = CardFixtureBase & {
  kind: "intent_pace";
  category: string;
  spent: number;
  usual: number;
};

export type CoverPlanFixture = CardFixtureBase & {
  kind: "cover_plan";
  destination: CardSource & { held: number; needed: number; due: string };
  contributions: AccountContribution[];
  moving: number;
};

export type RhythmFixture = CardFixtureBase & {
  kind: "rhythm";
  category: string;
  transaction: CardEvidence;
};

export type CardFixture =
  | AskPaydayFixture
  | AskGenericFixture
  | CelebrationFixture
  | CliffFixture
  | UnfundedMoveFixture
  | IntentPaceFixture
  | CoverPlanFixture
  | RhythmFixture;

export const FAMILY_FIXTURES: readonly CardFixture[] = [
  {
    id: "ask-payday",
    kind: "ask_payday",
    tone: "penny",
    headline: "Is today payday?",
    body: "I can set up this pay period once your income has arrived.",
    payday: "12 Sept",
    expectedIncome: 2450,
    evidence: [{ label: "Expected pay", value: "£2,450 today" }],
    actions: [
      { label: "Yes, it has arrived", kind: "primary" },
      { label: "Not yet", kind: "secondary" },
    ],
  },
  {
    id: "ask-card-bill",
    kind: "ask_generic",
    tone: "penny",
    headline: "Help me recognise this card payment",
    body: "Knowing whether you clear this card each month keeps the cash view accurate.",
    question: "Do you usually clear your AMERICAN EXPRESS balance in full?",
    source: { account: "AMERICAN EXPRESS" },
    actions: [
      { label: "Review card details", kind: "primary" },
      { label: "Not now", kind: "quiet" },
    ],
    dismissible: true,
  },
  {
    id: "celebration-covered",
    kind: "celebration",
    tone: "positive",
    headline: "Sorted: your rent is covered",
    body: "The money is already held aside for 28 Sept.",
    coveredAmount: 925,
    source: { account: "Premier Current", detail: "held for rent" },
    evidence: [{ label: "Held", value: "£925" }],
    actions: [{ label: "See upcoming", kind: "quiet" }],
    dismissible: true,
  },
  {
    id: "cliff-card-season",
    kind: "cliff",
    tone: "watch",
    headline: "Your AMERICAN EXPRESS offer ends soon",
    body: "Its rate changes after 30 Sept. You can review the next payment before then.",
    date: "30 Sept",
    rateFrom: 0,
    rateTo: 24.9,
    source: { account: "AMERICAN EXPRESS" },
    evidence: [{ label: "Rate", value: "0% to 24.9%" }],
    actions: [{ label: "Review card", kind: "primary" }],
    dismissible: true,
  },
  {
    id: "unfunded-american-express",
    kind: "unfunded_move",
    tone: "watch",
    headline: "A card payment still needs a home",
    body: "AMERICAN EXPRESS is due 9 Sept. Premier Current is holding £44.68.",
    move: {
      label: "AMERICAN EXPRESS",
      amount: 100,
      due: "9 Sept",
      destination: { account: "Premier Current", detail: "holding £44.68" },
      holding: 44.68,
      suggestedSource: { account: "HSBC Current", amount: 70 },
    },
    evidence: [
      { label: "Due", value: "£100 on 9 Sept" },
      { label: "Suggested move", value: "£70 from HSBC Current" },
    ],
    actions: [
      { label: "See it in Upcoming", kind: "primary" },
      { label: "Skip this month", kind: "quiet" },
    ],
    dismissible: true,
  },
  {
    id: "intent-groceries-pace",
    kind: "intent_pace",
    tone: "neutral",
    headline: "Groceries are close to your usual pace",
    body: "You said you wanted to spend less here. There is still time in this pay period.",
    category: "Groceries",
    spent: 138,
    usual: 150,
    evidence: [{ label: "So far", value: "£138 of £150 usual" }],
    dismissible: true,
  },
  {
    id: "cover-plan-premier",
    kind: "cover_plan",
    tone: "penny",
    headline: "Move £70 to Premier Current",
    body: "This tops up the account for the AMERICAN EXPRESS payment due 9 Sept.",
    destination: {
      account: "Premier Current",
      held: 44.68,
      needed: 100,
      due: "9 Sept",
    },
    contributions: [
      { account: "HSBC Current", amount: 25 },
      { account: "Monzo", amount: 25 },
      { account: "Savings", amount: 20 },
    ],
    moving: 70,
    evidence: [{ label: "Moving", value: "£70 total" }],
    actions: [{ label: "Review plan", kind: "primary" }],
    dismissible: true,
  },
  {
    id: "rhythm-eating-out",
    kind: "rhythm",
    tone: "neutral",
    headline: "Eating out is running above your usual",
    body: "One recent payment accounts for most of the change.",
    category: "Eating out",
    transaction: { label: "Recent payment", value: "£46.50 at Dishoom, 6 Sept" },
    actions: [
      { label: "One-off", kind: "secondary" },
      { label: "New normal", kind: "secondary" },
      { label: "See payments", kind: "quiet" },
    ],
    dismissible: true,
  },
];

export const STACK_FIXTURE_IDS = [
  "unfunded-american-express",
  "cover-plan-premier",
  "intent-groceries-pace",
] as const;
