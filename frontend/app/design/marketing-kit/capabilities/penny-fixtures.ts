import type { ProposalMsg, VerdictMsg } from "@/components/PennyConversation";
import type { Account, GoalSchedulePreview } from "@/lib/api";
import type { PennyChartSpec } from "@/lib/pennyChart";
import goalPreviewJson from "./goal-preview.json";

/**
 * Frozen, fictional data for Penny capability proof plates. These objects
 * deliberately resemble the typed payloads Penny's production chat receives,
 * but no proof calls the API or operates on an account.
 */
export const PENNY_DEPENDENCY_PATHS = [
  "@/components/PennyConversation",
  "@/components/PennyChart",
  "@/lib/pennyChart",
] as const;

export const CAR_INSURANCE_PAYDAYS = ["30 Nov", "30 Dec", "30 Jan"] as const;

/** Pure-engine preview, generated from the fictional 30th-of-month rhythm. */
export const CAR_INSURANCE_GOAL_PREVIEW = goalPreviewJson as GoalSchedulePreview;

/** Only supplied to the isolated proof host if a source picker is opened. */
export const PENNY_FIXTURE_ACCOUNTS: Account[] = [
  { id: "fictional-everyday", name: "Everyday account", provider: "Monzo", type: "bank", subtype: "CURRENT", balance: 1200, currency: "GBP", status: "connected" },
];

/** Actual production chart shape: the app, not a hand-drawn mock-up, plots it. */
export const EATING_OUT_CHART: PennyChartSpec = {
  type: "bar",
  title: "Spend against usual, day 10",
  summary: "By day 10 of 8 to 30 November, spending is £860 against a usual £740.",
  x: { label: "Category", kind: "category" },
  y: { label: "Spend", unit: "money", currency: "GBP" },
  series: [
    { name: "This pay period", points: [
      { x: "Eating Out", y: 240 }, { x: "Groceries", y: 220 }, { x: "Bills", y: 180 },
      { x: "Transport", y: 120 }, { x: "Shopping", y: 100 },
    ] },
    { name: "Usual by day 10", points: [
      { x: "Eating Out", y: 120 }, { x: "Groceries", y: 220 }, { x: "Bills", y: 180 },
      { x: "Transport", y: 120 }, { x: "Shopping", y: 100 },
    ] },
  ],
  note: "Comparison: day 10 of the 8 to 30 November pay period, not a full-month forecast.",
};

export const EATING_OUT_REPLY: VerdictMsg = {
  id: 101,
  role: "assistant",
  kind: "verdict",
  headline: "Eating Out is £120 above your usual by day 10.",
  reply: "Across the same 10 days of this pay period, spending is £860 against a usual £740. Groceries, Bills, Transport and Shopping are at their usual pace.",
  chart: EATING_OUT_CHART,
  degraded: false,
};

export const CAR_INSURANCE_PLAN_REPLY: VerdictMsg = {
  id: 104,
  role: "assistant",
  kind: "verdict",
  headline: "£200 on each of three paydays reaches £600.",
  reply: "That is £200 on 30 Nov, 30 Dec and 30 Jan. It is a plan, not a bank transfer.",
  degraded: false,
};

export const BOILER_SERVICE_UPDATE_REPLY: VerdictMsg = {
  id: 105,
  role: "assistant",
  kind: "verdict",
  headline: "I can update this planned payment.",
  reply: "The Boiler service changes from £90 on 24 Nov to £95 on 26 Nov. It updates your plan only, not your bank payment.",
  degraded: false,
};

/**
 * A scheduled goal is a Planning record, not a standing order. The fixed
 * schedule matches the real server contract: pence amounts, a start date and
 * one amount per pay period. Penny only creates it after confirmation.
 */
export const CAR_INSURANCE_PROPOSAL: ProposalMsg = {
  id: 102,
  role: "assistant",
  kind: "proposal",
  status: "pending",
  proposal: {
    proposal_id: "fictional-car-insurance-600",
    kind: "create_commitment",
    summary: "Start the 'Car insurance' goal: £200, £200, £200, one a pay period from 30 Nov 2026, total £600.00",
    consequence: "Creates the goal and reserves this period's £0.00. Nothing moves until you move it.",
    before: "No goal",
    after: "Total £600.00, from Everyday account",
    entity: "Car insurance",
    params: {
      name: "Car insurance",
      schedule: {
        ...CAR_INSURANCE_GOAL_PREVIEW.schedule,
      },
      schedule_preview: CAR_INSURANCE_GOAL_PREVIEW,
      funding_pots: [],
      source_account_id: "fictional-everyday",
      source_account_name: "Everyday account",
      destination_names: [],
    },
  },
};

/** A genuine supported Penny action: update a dated one-off planned expense. */
export const BOILER_SERVICE_UPDATE_PROPOSAL: ProposalMsg = {
  id: 103,
  role: "assistant",
  kind: "proposal",
  status: "pending",
  proposal: {
    proposal_id: "fictional-boiler-service-update",
    kind: "update_planned",
    summary: "Change the Boiler service one-off from £90 to £95 on 26 Nov",
    consequence: "Adjusts what's shown as spendable around that date, nothing else changes.",
    before: "£90 due 24 Nov",
    after: "£95 due 26 Nov",
    entity: "Boiler service",
    params: {
      planned_id: "fictional-boiler-service",
      amount: 95,
      date: "2026-11-26",
    },
  },
};
