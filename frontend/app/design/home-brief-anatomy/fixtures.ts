// Synthetic fixtures for G295's Home brief anatomy round. They exercise the
// exported production cards without copying any account, merchant or amount
// from a customer session.
import type { CompanionItem, MoveMap, PaydayPlanDest, SavingsInsight } from "@/lib/api";
import {
  COVERED_ITEM,
  LONG_COVERED_ITEM,
  MISSING_BODY_COVERED_ITEM,
  COVER_MOVE_ITEM,
  UNFUNDED_MOVE_ITEM,
  TIP,
} from "@/scripts/fixtures/g292-home-anatomy";

export {
  COVERED_ITEM,
  LONG_COVERED_ITEM,
  MISSING_BODY_COVERED_ITEM,
  COVER_MOVE_ITEM,
  UNFUNDED_MOVE_ITEM,
  TIP,
};

const PAYING_ACCOUNT = {
  account_id: "g295-main",
  name: "Main account",
  provider: "Starling",
  balance: 390,
};

const SPARE_ACCOUNT = {
  account_id: "g295-spare",
  name: "Rainy day saver",
  provider: "Nationwide",
  balance: 1240,
};

const DESTINATION_ACCOUNT = {
  account_id: "g295-bills",
  name: "Household bills",
  provider: "Barclays",
  balance: 180,
};

const SAFE_MOVE: MoveMap = {
  from: { ...SPARE_ACCOUNT, safe_note: "Keeps its own bills covered" },
  to: { ...DESTINATION_ACCOUNT, incoming: "£45 due this week" },
};

export const TRAJECTORY_ITEM: CompanionItem = {
  id: "g295-trajectory-rising",
  type: "trajectory",
  headline: "Your cards are going up, not down, and it isn't clear whether part of the balance is charging interest.",
  body: "£2,100 of the balance is on 0% deals. No interest has shown up on the other £504, though that could mean it's cleared each statement, or on a deal that isn't on file. £2,604 is carried across 3 cards in total. 2 cards have no rate on file, so interest there isn't counted.",
  action: { label: "See the route", route: "/planning" },
  estimated: false,
  tone: "watch",
  trend: "rising",
  brief_lead: { value: "£186", companion: "more owed than three months ago" },
};

export const TRAJECTORY_FALLING_ITEM: CompanionItem = {
  id: "g295-trajectory-falling",
  type: "trajectory",
  headline: "Your cards are coming down.",
  body: "The whole balance is on 0% deals, so no interest is being charged right now. £1,740 is carried across 3 cards in total.",
  action: null,
  estimated: false,
  tone: "positive",
  trend: "falling",
  brief_lead: { value: "£240", companion: "less owed than three months ago" },
};

export const TRAJECTORY_FLAT_ITEM: CompanionItem = {
  id: "g295-trajectory-flat",
  type: "trajectory",
  headline: "Your cards are holding steady, not coming down.",
  body: "The whole balance is on 0% deals, so no interest is being charged right now. £840 is carried across 3 cards in total.",
  action: null,
  estimated: false,
  tone: "neutral",
  trend: "flat",
  brief_lead: { value: "£0", companion: "change over the last three months" },
};

export const TRAJECTORY_UNKNOWN_ITEM: CompanionItem = {
  id: "g295-trajectory-unknown",
  type: "trajectory",
  headline: "There isn't enough card history yet to say which way the cards are going.",
  body: "The whole balance is on 0% deals, so no interest is being charged right now. £840 is carried across 3 cards in total. The direction needs at least one completed month of card history behind it.",
  action: null,
  estimated: true,
  tone: "neutral",
  trend: "unknown",
};

export const ASK_CARD_ITEM: CompanionItem = {
  id: "ask:g295-card-terms",
  type: "ask",
  headline: "Want your card picture sharp?",
  body: "Tell me the rates on your 2 cards and I can plan around them. Takes a minute.",
  action: { label: "Add my rates", route: "/accounts?cardTerms=1", kind: "card_terms" },
  estimated: false,
  kind_label: "Card detail",
  brief_lead: { value: "Card details", companion: "one answer keeps the debt plan accurate" },
};

export const ASK_PAYDAY_ITEM: CompanionItem = {
  id: "ask:payday",
  type: "ask",
  headline: "Is the 28th still your usual payday?",
  body: "We spotted a regular credit of £2,960 arriving around the 28th. Confirm it to line up your pay period.",
  action: { label: "Yes, that is my payday", route: "/upcoming" },
  secondary_action: { label: "No, set it myself", route: "/upcoming" },
  estimated: true,
  brief_lead: { value: "£2,960", companion: "regular credit spotted" },
};

export const RATE_CHANGE_ITEM: CompanionItem = {
  id: "g295-rate-change",
  type: "cliff",
  headline: "A promotional rate ends in 46 days",
  body: "Everyday Card has £1,280 on its current rate. Checking the terms now gives you time to decide what to do next.",
  action: { label: "Review card details", route: "/planning" },
  estimated: false,
  brief_lead: { value: "£1,280", companion: "on the current rate" },
};

export const RHYTHM_INFO_ITEM: CompanionItem = {
  id: "g295-rhythm-info",
  type: "rhythm",
  headline: "Your grocery spending usually arrives in the first half of the month",
  body: "This is a pattern we noticed, not a warning. It can help explain the rhythm of your cash between paydays.",
  action: null,
  estimated: true,
};

export const RHYTHM_ITEM: CompanionItem = {
  id: "g295-rhythm-interactive",
  type: "rhythm",
  headline: "Travel is running above your usual",
  body: "Tell us whether this was a one-off or your new normal.",
  action: null,
  estimated: false,
  payload: {
    category: "Travel",
    multiple: 2.4,
    spent: 216,
    period_end: "2026-11-27",
    dominant: { name: "Northline Rail", amount: 96, date: "2026-10-16" },
  },
};

export const INTENT_PACE_ITEM: CompanionItem = {
  id: "g295-intent-pace",
  type: "intent_pace",
  headline: "Eating out is £38 below the pace you chose",
  body: "You set a lower usual amount for this category. This is a quiet progress note, not money moved or saved.",
  action: null,
  estimated: false,
  brief_lead: { value: "£38", companion: "below your chosen pace" },
};

export const ALLOCATION_ITEM: CompanionItem = {
  id: "g295-allocation-shortfall",
  type: "allocation_shortfall",
  headline: "Your Holiday pot leaves Main account short this period",
  body: "",
  action: null,
  estimated: true,
  allocation_shortfall: {
    shortfall: 45,
    estimated: true,
    paying_account: PAYING_ACCOUNT,
    allocation: { id: "g295-holiday-allocation", name: "Holiday pot", period_amount: 120, suggested_amount: 75 },
    other_allocation_count: 0,
    moves: [{ amount: 45, move_map: SAFE_MOVE }],
  },
};

const PLAN_EASING_BASE = {
  plan: { id: "g295-kitchen-plan", name: "Kitchen fund" },
  usual_slice: 160,
  max_easing: 90,
  periods_left: 6,
  target_date: "2027-04-30",
  eased_count_12m: 0,
  paying_account_name: PAYING_ACCOUNT.name,
} as const;

export const PLAN_EASING_ITEM: CompanionItem = {
  id: "g295-plan-easing-eligible",
  type: "plan_easing",
  headline: "Cash is tight for Kitchen fund this period",
  body: "",
  action: null,
  estimated: false,
  plan_easing: { ...PLAN_EASING_BASE, state: "eligible", gap: 90, later_slice: 160, eased_this_period: null, eased_mode: null, cap_reason: null },
};

export const PLAN_EASING_CAPPED_ITEM: CompanionItem = {
  id: "g295-plan-easing-capped",
  type: "plan_easing",
  headline: "Easing is held back for Kitchen fund",
  body: "",
  action: null,
  estimated: false,
  plan_easing: { ...PLAN_EASING_BASE, state: "capped", gap: 90, later_slice: null, eased_this_period: null, eased_mode: null, cap_reason: "This plan has already been eased recently." },
};

export const PLAN_EASING_DEFERRED_ITEM: CompanionItem = {
  id: "g295-plan-easing-deferred",
  type: "plan_easing",
  headline: "Kitchen fund has already been eased this period",
  body: "",
  action: null,
  estimated: false,
  plan_easing: { ...PLAN_EASING_BASE, state: "deferred", gap: 0, later_slice: 180, eased_this_period: 70, eased_mode: "keep_date", eased_count_12m: 1, cap_reason: null },
};

const PAYDAY_DESTINATIONS: PaydayPlanDest[] = [
  {
    account_id: "g295-monthly-bills", name: "Monthly bills", provider: "Barclays", balance: 180,
    bills_total: 760, bill_count: 3, spend_typical: 340, buffer: 120, target: 1220, move: 1040, usual: 1040,
    destination_kind: "spend",
  },
  {
    account_id: "g295-holiday-pot", name: "Holiday pot", provider: "Monzo", balance: 90,
    bills_total: 0, bill_count: 0, spend_typical: 0, buffer: 0, target: 560, move: 470, usual: 470,
    destination_kind: "savings", habitual_top_up: true, commitment_names: ["Summer break"],
  },
];

export const PAYDAY_PLAN_ITEM: CompanionItem = {
  id: "g295-payday-plan",
  type: "payday_plan",
  headline: "Move £1,510 from your next pay",
  body: "",
  action: null,
  estimated: true,
  total: 1510,
  salary: { account_id: "g295-salary", name: "Salary account", provider: "Starling", amount: 2960, stays: 1450 },
  dests: PAYDAY_DESTINATIONS,
  next_pay: "2026-10-28",
};

export const PAYDAY_PLAN_SETTLED_ITEM: CompanionItem = {
  id: "g295-payday-plan-settled",
  type: "payday_plan",
  headline: "Your accounts are already set for the month",
  body: "No extra money needs moving between your accounts right now.",
  action: null,
  estimated: false,
  total: 0,
  dests: [],
};

export const MONTH_CLOSED_ITEM: CompanionItem = {
  id: "g295-month-closed",
  type: "needle",
  headline: "Your September spending is ready to review",
  body: "",
  action: { label: "Review September", route: "/spend" },
  estimated: false,
};

export const FALLBACK_MOVE_ITEM: CompanionItem = {
  id: "g295-fallback-move",
  type: "move",
  headline: "Move £60 to Household bills",
  body: "Moving £60 from Rainy day saver keeps the planned transfer on track.",
  action: { label: "See the plan", route: "/upcoming" },
  estimated: false,
  amount: 60,
  moves: [{ headline: "Move £60 from Rainy day saver", amount: 60, move_map: { ...SAFE_MOVE, to: { ...DESTINATION_ACCOUNT, incoming: "£60 due this week" } } }],
};

export const FALLBACK_UNFUNDED_ITEM: CompanionItem = {
  id: "g295-fallback-unfunded",
  type: "unfunded_move",
  headline: "A planned transfer is waiting for £75",
  body: "£75 is due from Main account, but no safe source is available right now.",
  action: { label: "See it in Upcoming", route: "/upcoming" },
  estimated: false,
  brief_lead: { value: "£75", companion: "planned transfer" },
  moves: [{
    key: "g295-fallback-transfer", label: "Household reserve", amount: 75, expected_date: "2026-10-20", days_past_due: 0,
    source_account_id: PAYING_ACCOUNT.account_id, source_name: PAYING_ACCOUNT.name, source_bank: PAYING_ACCOUNT.provider,
    suggested_amount: null, suggested_from_name: null, suggested_from_count: 0, suggested_covers_all: false, suggested_sources: [],
  }] as unknown as CompanionItem["moves"],
};

/** A dedicated spotlight fixture remains a SavingsInsight, not a CompanionItem. */
export const SPOTLIGHT_TIP: SavingsInsight = {
  ...TIP,
  id: "g295-spotlight-tip",
  label: "Subscriptions",
  title: "Your streaming renewals total £31 a month",
  body: "Two services renewed this month. You can review the payments before the next renewal.",
  triggered_by: [
    { merchant_key: "g295-stream-a", display_name: "Screenroom", monthly_amount: 18, occurrences: 4, is_recurring: true },
    { merchant_key: "g295-stream-b", display_name: "Picturebox", monthly_amount: 13, occurrences: 3, is_recurring: true },
  ],
};

export const G295_FIXTURE_INVENTORY = [
  "covered", "covered-long", "covered-no-body", "cover-move", "unfunded-move", "tip",
  "trajectory-rising", "trajectory-falling", "trajectory-flat", "trajectory-unknown",
  "ask-card", "ask-payday", "rate-change", "rhythm-info", "rhythm-interactive", "intent-pace",
  "allocation-shortfall", "plan-easing-eligible", "plan-easing-capped", "plan-easing-deferred",
  "payday-plan", "payday-plan-settled", "month-closed", "fallback-move", "fallback-unfunded", "spotlight-tip",
] as const;
