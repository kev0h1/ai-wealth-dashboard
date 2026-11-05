import type { Account, CompanionItem, InvestmentAccount, SafeToSpend } from "@/lib/api";
import type { UpcomingAccountSummary } from "@/lib/upcomingAccounts";
import type { Bank } from "@/components/BankPickerSheet";
import type { ConsentMsg, ProposalMsg } from "@/components/PennyConversation";

/** Fictional, internally consistent product examples for the marketing kit. */
export const PROOF_PERIOD = "8–30 October 2026";
export const PROOF_PERSON = "Alex Taylor";

export const PROOF_BANKS: Bank[] = [
  { id: "monzo", name: "Monzo", logo: "" },
  { id: "barclays", name: "Barclays", logo: "" },
  { id: "nationwide", name: "Nationwide", logo: "" },
];

/**
 * Alex's 8–30 October current-state arithmetic:
 * Everyday £542 + Bills £68 = £610; £188 of bills leaves £422 pooled;
 * the £110 buffer leaves £312 estimated left to spend. The £120 recommendation moves
 * £120 from Everyday to Bills, exactly covering that account's £120 gap.
 * The £2,400 payday plan is a separate, explicitly future preview for 30 Oct.
 */
export const SAFE_TO_SPEND: SafeToSpend = {
  status: "ok",
  safe_to_spend: 312,
  next_payday: "2026-10-30",
  days_until_payday: 22,
  bills_total: 188,
  income_before_payday: 0,
  buffer: 110,
  state: "comfortable",
  estimated: true,
  spendable_now: 610,
  // The next pay is known for the future payday; it is deliberately not
  // income before payday, so the £610 − £188 − £110 calculation stays exact.
  payday_income: 2400,
  pace: {
    state: "comfortable",
    sustainable: 14.18,
    actual: 0,
    discretionary_so_far: 0,
    days_left: 22,
    days_elapsed: 0,
    period_start: "2026-10-08",
  },
  safe_to_spend_cash: 312,
  lowest_projected_balance: 422,
  calculation_status: "complete",
  last_synced: null,
};

export const UPCOMING_HERO = {
  isCalendarMonth: false,
  daysToPayday: 22,
  paydayLabel: "Fri 30 Oct",
  spendableNow: 610,
  runwayIncomeTotal: 0,
  runwayBillsTotal: 188,
  allocationsRemainingTotal: 0,
  savingsNow: 500,
  runway: 422,
  runwayStatus: "left" as const,
};

export const UPCOMING_ACCOUNTS: UpcomingAccountSummary[] = [
  {
    id: "alex-everyday",
    bank: "Monzo",
    name: "Everyday account",
    opening: 542,
    income: 0,
    transfersIn: 0,
    outgoing: 0,
    closing: 542,
    shortfall: 0,
    status: "covered",
    firstShortDate: null,
    hasUnassignedIncome: false,
    events: [],
  },
  {
    id: "alex-bills",
    bank: "Barclays",
    name: "Bills account",
    opening: 68,
    income: 0,
    transfersIn: 0,
    outgoing: 188,
    closing: -120,
    shortfall: 120,
    status: "short",
    firstShortDate: "2026-10-18",
    hasUnassignedIncome: false,
    events: [],
  },
];

export const PROOF_ACCOUNTS: Account[] = [
  { id: "alex-everyday", name: "Everyday account", provider: "Monzo", type: "bank", subtype: "CURRENT", balance: 542, currency: "GBP", status: "connected" },
  { id: "alex-bills", name: "Bills account", provider: "Barclays", type: "bank", subtype: "CURRENT", balance: 68, currency: "GBP", status: "connected" },
  { id: "alex-saver", name: "Rainy day saver", provider: "Nationwide", type: "bank", subtype: "SAVINGS", balance: 500, currency: "GBP", status: "connected" },
];

export const MOVE_SUGGESTION: CompanionItem = {
  id: "alex-cover-move",
  type: "move",
  headline: "Move £120 to cover your bills account",
  body: "Your bills account needs £120 for payments before 30 October.",
  action: { label: "Review the move", route: "/upcoming" },
  estimated: false,
  amount: 120,
  covered: true,
  sources_safe: true,
  move_map: {
    from: { account_id: "alex-everyday", name: "Everyday account", provider: "Monzo", balance: 542, safe_note: "Covers Alex's planned spending" },
    to: { account_id: "alex-bills", name: "Bills account", provider: "Barclays", balance: 68, incoming: "£120 due" },
  },
  plan_dest: { account_id: "alex-bills", name: "Bills account", provider: "Barclays", balance: 68, needs_total: 188, needs_by: "18 Oct", needs_by_date: "2026-10-18", bills: [{ label: "Energy", amount: 188, expected_date: "2026-10-18" }] },
};

export const PAYDAY_PLAN: CompanionItem = {
  id: "alex-payday-plan",
  type: "payday_plan",
  headline: "Payday plan: cover the £950 due from Bills account",
  body: "£882 is distributed and £1,518 stays in Everyday account.",
  action: { label: "See what is due", route: "/upcoming" },
  estimated: false,
  total: 882,
  preview: true,
  next_pay: "2026-10-30",
  // G402: a payday row exists only where a payment or declared need leaves
  // the account. Everyday spending and a saver with no stated need are not
  // padded into this plan; the existing Bills balance simply reduces its move.
  salary: { account_id: "alex-everyday", name: "Everyday account", provider: "Monzo", amount: 2400, stays: 1518 },
  dests: [
    { account_id: "alex-bills", name: "Bills account", provider: "Barclays", balance: 68, bills_total: 950, bill_count: 3, spend_typical: 0, buffer: 0, target: 950, move: 882, usual: null },
  ],
  habitual_note: true,
};

export const INVESTMENT: InvestmentAccount = {
  id: "alex-isa",
  provider: "Vanguard",
  account_type: "Stocks & Shares ISA",
  account_reference: "alex-isa-ref",
  currency: "GBP",
  total_value: 12480,
  display_value: 12480,
  statement_date: "2026-10-08",
  last_refreshed: "2026-10-08T08:30:00Z",
  updated_at: "2026-10-08T08:30:00Z",
  added_since: 0,
  notes_since: 0,
};

export const PENNY_PROPOSAL: ProposalMsg = {
  id: 1,
  role: "assistant",
  kind: "proposal",
  status: "pending",
  proposal: {
    proposal_id: "fictional-alex-proposal",
    kind: "allocation",
    summary: "Set aside £200 for Alex's annual costs",
    consequence: "This plan reserves £200 every pay period. It does not move money.",
    params: {
      name: "Annual costs",
      amount_per_period: 200,
      source_account_id: "alex-everyday",
      tracking_mode: "manual",
      recurrence: "every_period",
    },
  },
};

export const PENNY_CONSENT: ConsentMsg = { id: 2, role: "assistant", kind: "consent", status: "pending" };
