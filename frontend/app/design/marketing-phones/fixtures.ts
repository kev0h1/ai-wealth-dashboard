import type { Account, AccountEligibility, SafeToSpend, SpendVerdict } from "@/lib/api";
import type { CompanionItem } from "@/lib/api";
import type { SetAsideItem } from "@/components/upcoming/SetAsideList";
import type { UpcomingRowModel } from "@/components/upcoming/UpcomingRow";
import type { ProposalMsg, VerdictMsg } from "@/components/PennyConversation";
import { upcomingCategoryAppearance } from "@/components/upcoming/UpcomingCategoryIcon";
import { accountAvailability } from "@/lib/accountAvailability";
import { bestSpendAccount } from "@/lib/spendFromAccount";
import type { UpcomingAccountSummary } from "@/lib/upcomingAccounts";
import type { Plan } from "@/lib/upcomingPlans";
import { CAR_INSURANCE_GOAL_PREVIEW } from "@/app/design/marketing-kit/capabilities/penny-fixtures";
import { SCENARIO } from "./catalog";

const billsAppearance = upcomingCategoryAppearance("Bills", "bill", {}, {});

export const C22_SAFE_TO_SPEND: SafeToSpend = {
  status: "ok", safe_to_spend: 312, next_payday: SCENARIO.nextPayday, days_until_payday: SCENARIO.daysUntilPayday,
  bills_total: 321, income_before_payday: 0, buffer: 110, state: "comfortable", estimated: true,
  spendable_now: 773, payday_income: 1800, safe_to_spend_cash: 312, lowest_projected_balance: 452,
  calculation_status: "complete", last_synced: "2026-11-17T09:00:00Z",
  allocations_reserved: 30, allocations_count: 1, commitments_reserved: 0, commitments_count: 0,
  left_to_spend_lines: { accounts_total: 452, plans_total: 30, buffer: 110 },
};

export const C22_UPCOMING: UpcomingRowModel[] = [
  { rowKey: "c22-energy", type: "bill", name: "Energy", amount: 188, expectedDate: "2026-11-20", accountLabel: "Bills account", accountBalance: 68, accountShort: true, coverage: { shortfall: 120, before: 68, after: -120 }, after: { kind: "balance", value: -120 }, category: "Bills", categoryColour: billsAppearance.colour, CategoryIcon: billsAppearance.Icon },
  { rowKey: "c22-broadband", type: "bill", name: "Broadband", amount: 38, expectedDate: "2026-11-23", accountLabel: "Monzo current account", accountBalance: 555, coverage: { shortfall: 0, before: 555, after: 517 }, after: { kind: "balance", value: 517 }, category: "Bills", categoryColour: billsAppearance.colour, CategoryIcon: billsAppearance.Icon },
  { rowKey: "c22-boiler", type: "bill", name: "Boiler service", amount: 95, expectedDate: "2026-11-26", accountLabel: "Monzo current account", accountBalance: 517, edited: true, isPlanned: true, coverage: { shortfall: 0, before: 517, after: 422 }, after: { kind: "balance", value: 422 }, category: "Bills", categoryColour: billsAppearance.colour, CategoryIcon: billsAppearance.Icon },
];

export const C22_COVER: CompanionItem = {
  id: "c22-cover-energy", type: "move", headline: "Move £120 to cover your bills account",
  body: "Your Bills account needs £120 for Energy on 20 November.", amount: 120, covered: true, sources_safe: true, estimated: false,
  action: { label: "Review the move", route: "/upcoming" },
  move_map: {
    from: { account_id: "c22-everyday", name: "Monzo current account", provider: "Monzo", balance: 555, safe_note: "Leaves £272 after your own bills and set-aside" },
    to: { account_id: "c22-bills", name: "Bills account", provider: "Barclays", balance: 68, incoming: "£120 suggested" },
  },
  plan_dest: { account_id: "c22-bills", name: "Bills account", provider: "Barclays", balance: 68, needs_total: 188, needs_by: "20 Nov", needs_by_date: "2026-11-20", bills: [{ label: "Energy", amount: 188, expected_date: "2026-11-20" }] },
};

export const C22_SPEND: SpendVerdict = {
  state: "normal", reading: "You spent £120 more than usual by day 19, mostly on Eating Out.",
  notables: [{ category: "Eating Out", spent: 240, multiple: 2, excess: 120, payments_count: 4, cause: [{ name: "Brixton Kitchen", amount: 92 }, { name: "Canal Café", amount: 58 }, { name: "Market Lunch", amount: 48 }], pace: { spent: 240, usual_by_now: 120 } }],
  quiet_flags: [], majority: [{ category: "Groceries", spent: 220, payments_count: 5, has_baseline: true, elevated: false }, { category: "Bills", spent: 180, payments_count: 2, has_baseline: true, elevated: false }, { category: "Transport", spent: 120, payments_count: 6, has_baseline: true, elevated: false }, { category: "Shopping", spent: 100, payments_count: 2, has_baseline: true, elevated: false }],
  unresolved: { total: 0, payments_count: 0, ask_worthy: false, weight: "routine", largest: null }, moved: [{ kind: "pots", label: "Moved to savings", amount: 400, payments_count: 1, categories: ["Savings"] }],
  pills: { spent: 860, income: 1800, net: 940 }, period: { start: SCENARIO.periodStart, end: SCENARIO.periodEnd, days_elapsed: SCENARIO.elapsedDays, days_left: SCENARIO.daysLeft, offset: 0, closed: false },
  pace_series: [{ day: 1, actual: 74, usual: 74 }, { day: 3, actual: 146, usual: 148 }, { day: 5, actual: 228, usual: 222 }, { day: 7, actual: 312, usual: 296 }, { day: 9, actual: 398, usual: 370 }, { day: 11, actual: 480, usual: 444 }, { day: 13, actual: 574, usual: 518 }, { day: 15, actual: 670, usual: 592 }, { day: 17, actual: 768, usual: 666 }, { day: 19, actual: 860, usual: 740 }],
  moved_total: 400, unresolved_total: 0, unresolved_material: false, impact: null,
};

export const C22_ASIDE: SetAsideItem = { id: "c22-groceries", name: "Groceries", feedLabel: "Groceries", amountPerPeriod: 250, filledThisPeriod: 220, remaining: 30, recurrence: "every_period", pending: false, completed: false };
export const C22_EVERYDAY_ACCOUNT: Account = { id: "c22-everyday", name: "Monzo current account", provider: "Monzo", type: "bank", subtype: "CURRENT", balance: 555, currency: "GBP", status: "connected" };
export const C22_SECOND_ACCOUNT: Account = { id: "c22-spending", name: "Spending account", provider: "Starling", type: "bank", subtype: "CURRENT", balance: 150, currency: "GBP", status: "connected" };
export const C22_BILLS_ACCOUNT: Account = { id: "c22-bills", name: "Bills account", provider: "Barclays", type: "bank", subtype: "CURRENT", balance: 68, currency: "GBP", status: "connected" };
export const C22_CURRENT_ACCOUNTS = [C22_EVERYDAY_ACCOUNT, C22_SECOND_ACCOUNT, C22_BILLS_ACCOUNT];

/** Account figures follow the production Available contract. The £110 buffer
 * belongs to the pooled estimate, never to an invented share on an account. */
export const C22_ACCOUNT_ELIGIBILITY: Record<string, AccountEligibility> = {
  "c22-everyday": {
    short: false, headroom: 382, is_current_account: true, uncertain: false, estimated: false,
    after_payments: 422, low_point: 422, after_payments_and_money_in: 422,
    plans_reserved: 30, after_payments_and_plans: 392, low_point_and_plans: 392,
    spend_from_headroom: 272, earmarked_total: 120,
    earmarks_out: [{ to_account_id: "c22-bills", to_name: "Bills account", amount: 120 }],
  },
  "c22-spending": {
    short: false, headroom: 140, is_current_account: true, uncertain: false, estimated: false,
    after_payments: 150, low_point: 150, after_payments_and_money_in: 150,
    plans_reserved: 0, after_payments_and_plans: 150, low_point_and_plans: 150, spend_from_headroom: 150,
  },
  "c22-bills": {
    short: true, headroom: -130, is_current_account: true, uncertain: false, estimated: false,
    after_payments: -120, low_point: -120, after_payments_and_money_in: -120,
    plans_reserved: 0, after_payments_and_plans: -120, low_point_and_plans: -120,
    spend_from_headroom: 0, moves_in_total: 120, short_after_cover: 0,
    covered_by_move: { amount: 120, shortfall: 120, current_amount: 120, from: [{ account_id: "c22-everyday", name: "Monzo current account", amount: 120 }] },
  },
};

export const C22_SPEND_FROM = bestSpendAccount(C22_ACCOUNT_ELIGIBILITY, C22_CURRENT_ACCOUNTS);
export const C22_PLANS: Plan[] = [{
  id: C22_ASIDE.id, kind: "allocation", name: C22_ASIDE.name, destination: "Monzo current account", sourceId: C22_EVERYDAY_ACCOUNT.id,
  evidence: "chosen", periodPence: 25000, filledPence: 22000, remainingPence: 3000, active: true,
}];

/** One payment list supplies every account event. A suggested cover remains
 * separate from those events, because it has not happened in a bank. */
export const C22_UPCOMING_ACCOUNTS: UpcomingAccountSummary[] = C22_CURRENT_ACCOUNTS.map((account) => {
  const entry = C22_ACCOUNT_ELIGIBILITY[account.id];
  const rows = C22_UPCOMING.filter(row => row.accountLabel === account.name);
  const availability = accountAvailability(account, { status: "ready", positions: C22_ACCOUNT_ELIGIBILITY });
  if (availability?.kind !== "ready") throw new Error("C22 requires an available account fixture");
  const afterPayments = entry.after_payments!;
  const low = entry.low_point!;
  const gap = Math.max(0, -low);
  const moves = account.id === C22_EVERYDAY_ACCOUNT.id
    ? [{ id: "c22-cover-out", counterpartId: C22_BILLS_ACCOUNT.id, counterpartName: C22_BILLS_ACCOUNT.name, amount: -120, byDate: "2026-11-20" }]
    : account.id === C22_BILLS_ACCOUNT.id
    ? [{ id: "c22-cover-in", counterpartId: C22_EVERYDAY_ACCOUNT.id, counterpartName: C22_EVERYDAY_ACCOUNT.name, amount: 120, byDate: "2026-11-20" }]
    : [];
  return {
    id: account.id, bank: account.provider, name: account.name, opening: account.balance!, income: 0, transfersIn: 0,
    outgoing: rows.reduce((total, row) => total + row.amount, 0), closing: afterPayments, shortfall: gap,
    status: gap > 0 ? "short" : "covered", firstShortDate: gap > 0 ? rows[0].expectedDate : null,
    ...(gap > 0 ? { shortFor: { label: rows[0].name, date: rows[0].expectedDate, cardRepayment: false } } : {}),
    hasUnassignedIncome: false,
    events: rows.map(row => ({ id: row.rowKey, name: row.name, date: row.expectedDate, kind: "payment", amount: -row.amount, after: row.after.kind === "balance" ? row.after.value : null, category: row.category })),
    suggestedMoves: moves,
    position: {
      afterPayments, lowPoint: low, plansReserved: entry.plans_reserved!, afterPaymentsAndPlans: entry.after_payments_and_plans!,
      lowPointAndPlans: entry.low_point_and_plans!, spendFrom: entry.spend_from_headroom!, uncertain: false,
      availability, eligibility: entry,
      earmarkedTotal: entry.earmarked_total, earmarksOut: entry.earmarks_out?.map(move => ({ toAccountId: move.to_account_id, toName: move.to_name, amount: move.amount })),
      coveredByMove: entry.covered_by_move ? { amount: 120, shortfall: 120, from: [{ accountId: C22_EVERYDAY_ACCOUNT.id, name: C22_EVERYDAY_ACCOUNT.name, amount: 120 }] } : null,
      shortAfterCover: entry.short_after_cover,
    },
  };
});

export const C22_GOAL_REPLY: VerdictMsg = { id: 2201, role: "assistant", kind: "verdict", headline: "£200 on each of three paydays reaches £600.", reply: "That is £200 on 30 Nov, 30 Dec and 30 Jan. It is a plan, not a bank transfer.", degraded: false };
export const C22_GOAL_PROPOSAL: ProposalMsg = { id: 2202, role: "assistant", kind: "proposal", status: "pending", proposal: { proposal_id: "c22-goal", kind: "create_commitment", summary: "Start the 'Car insurance' goal: £200, £200, £200, one a pay period from 30 Nov 2026, total £600.00", consequence: "Creates the goal and reserves this period's £0.00. Nothing moves until you move it.", before: "No goal", after: "Total £600.00, from Monzo current account", entity: "Car insurance", params: { name: "Car insurance", schedule: { ...CAR_INSURANCE_GOAL_PREVIEW.schedule }, schedule_preview: CAR_INSURANCE_GOAL_PREVIEW, funding_pots: [], source_account_id: "c22-everyday", source_account_name: "Monzo current account", destination_names: [] } } };
export const C22_SCHEDULE_REPLY: VerdictMsg = { id: 2203, role: "assistant", kind: "verdict", headline: "I can update this planned payment.", reply: "The Boiler service changes from £90 on 24 Nov to £95 on 26 Nov. It updates your plan only, not your bank payment.", degraded: false };
export const C22_SCHEDULE_PROPOSAL: ProposalMsg = { id: 2204, role: "assistant", kind: "proposal", status: "pending", proposal: { proposal_id: "c22-boiler", kind: "update_planned", summary: "Change the Boiler service one-off from £90 to £95 on 26 Nov", consequence: "Adjusts what's shown as spendable around that date, nothing else changes.", before: "£90 due 24 Nov", after: "£95 due 26 Nov", entity: "Boiler service", params: { planned_id: "c22-boiler", amount: 95, date: "2026-11-26" } } };

/** Pending future one-off, using Penny's actual add_planned parameter contract.
 * It is not in November's payments or reserves until the owner confirms it. */
export const C22_PURPOSE_PROPOSAL: ProposalMsg = {
  id: 2210, role: "assistant", kind: "proposal", status: "pending",
  proposal: {
    proposal_id: "c22-car-service-one-off", kind: "add_planned", entity: "Car service",
    summary: "Plan a £120 one-off payment for Car service on 12 December",
    consequence: "Reduces what's shown as spendable from that date onward.",
    before: "No Car service payment planned", after: "£120 due 12 Dec · Monzo current account",
    params: { name: "Car service", amount: 120, date: "2026-12-12", account_id: "c22-everyday" },
  },
};
export const C22_PURPOSE_REPLY: VerdictMsg = {
  id: 2209, role: "assistant", kind: "verdict", headline: "I can add your Car service payment to the plan.",
  reply: "It is due on 12 December in your next pay period, from your Monzo current account. No bank payment is made, and this pay period stays unchanged.", degraded: false,
};
