import type { Account, SafeToSpend, SpendVerdict } from "@/lib/api";
import type { CompanionItem } from "@/lib/api";
import type { SetAsideItem } from "@/components/upcoming/SetAsideList";
import type { UpcomingRowModel } from "@/components/upcoming/UpcomingRow";
import type { ProposalMsg, VerdictMsg } from "@/components/PennyConversation";
import { upcomingCategoryAppearance } from "@/components/upcoming/UpcomingCategoryIcon";
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
  { rowKey: "c22-broadband", type: "bill", name: "Broadband", amount: 38, expectedDate: "2026-11-23", accountLabel: "Everyday account", accountBalance: 705, coverage: { shortfall: 0, before: 705, after: 667 }, after: { kind: "balance", value: 667 }, category: "Bills", categoryColour: billsAppearance.colour, CategoryIcon: billsAppearance.Icon },
  { rowKey: "c22-boiler", type: "bill", name: "Boiler service", amount: 95, expectedDate: "2026-11-26", accountLabel: "Everyday account", accountBalance: 667, edited: true, isPlanned: true, coverage: { shortfall: 0, before: 667, after: 572 }, after: { kind: "balance", value: 572 }, category: "Bills", categoryColour: billsAppearance.colour, CategoryIcon: billsAppearance.Icon },
];

export const C22_COVER: CompanionItem = {
  id: "c22-cover-energy", type: "move", headline: "Move £120 to cover your bills account",
  body: "Your Bills account needs £120 for Energy on 20 November.", amount: 120, covered: true, sources_safe: true, estimated: false,
  action: { label: "Review the move", route: "/upcoming" },
  move_map: {
    from: { account_id: "c22-everyday", name: "Everyday account", provider: "Monzo", balance: 705, safe_note: "Leaves £312 after your own bills, set-aside and buffer" },
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
export const C22_EVERYDAY_ACCOUNT: Account = { id: "c22-everyday", name: "Everyday account", provider: "Monzo", type: "bank", subtype: "CURRENT", balance: 705, currency: "GBP", status: "connected" };

export const C22_GOAL_REPLY: VerdictMsg = { id: 2201, role: "assistant", kind: "verdict", headline: "£200 on each of three paydays reaches £600.", reply: "That is £200 on 30 Nov, 30 Dec and 30 Jan. It is a plan, not a bank transfer.", degraded: false };
export const C22_GOAL_PROPOSAL: ProposalMsg = { id: 2202, role: "assistant", kind: "proposal", status: "pending", proposal: { proposal_id: "c22-goal", kind: "create_commitment", summary: "Start the 'Car insurance' goal: £200, £200, £200, one a pay period from 30 Nov 2026, total £600.00", consequence: "Creates the goal and reserves this period's £0.00. Nothing moves until you move it.", before: "No goal", after: "Total £600.00, from Everyday account", entity: "Car insurance", params: { name: "Car insurance", schedule: { ...CAR_INSURANCE_GOAL_PREVIEW.schedule }, schedule_preview: CAR_INSURANCE_GOAL_PREVIEW, funding_pots: [], source_account_id: "c22-everyday", source_account_name: "Everyday account", destination_names: [] } } };
export const C22_SCHEDULE_REPLY: VerdictMsg = { id: 2203, role: "assistant", kind: "verdict", headline: "I can update this planned payment.", reply: "The Boiler service changes from £90 on 24 Nov to £95 on 26 Nov. It updates your plan only, not your bank payment.", degraded: false };
export const C22_SCHEDULE_PROPOSAL: ProposalMsg = { id: 2204, role: "assistant", kind: "proposal", status: "pending", proposal: { proposal_id: "c22-boiler", kind: "update_planned", summary: "Change the Boiler service one-off from £90 to £95 on 26 Nov", consequence: "Adjusts what's shown as spendable around that date, nothing else changes.", before: "£90 due 24 Nov", after: "£95 due 26 Nov", entity: "Boiler service", params: { planned_id: "c22-boiler", amount: 95, date: "2026-11-26" } } };
