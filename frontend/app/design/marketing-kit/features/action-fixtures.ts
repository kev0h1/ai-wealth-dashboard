import type { Account, Allocation, CompanionItem } from "@/lib/api";
import type { ProposalMsg } from "@/components/PennyConversation";
import type { SetAsideItem } from "@/components/upcoming/SetAsideList";

/**
 * Frozen, fictional marketing data for the action proof plates. Alex's
 * current cash is £610: £542 in Everyday and £68 in Bills. Energy is £188
 * on 18 October, leaving Bills £120 short. The suggested move is therefore
 * £120, made by Alex in their bank, never by Sorted.
 */
export const ACTION_PERIOD = new Date("2026-10-08T12:00:00Z");

export const ACTION_ACCOUNTS: Account[] = [
  { id: "alex-everyday", name: "Everyday account", provider: "Monzo", type: "bank", subtype: "CURRENT", balance: 542, currency: "GBP", status: "connected" },
  { id: "alex-bills", name: "Bills account", provider: "Barclays", type: "bank", subtype: "CURRENT", balance: 68, currency: "GBP", status: "connected" },
  { id: "alex-saver", name: "Rainy day saver", provider: "Nationwide", type: "bank", subtype: "SAVINGS", balance: 500, currency: "GBP", status: "connected" },
];

export const MOVEMENT_SUGGESTION: CompanionItem = {
  id: "alex-cover-energy",
  type: "move",
  headline: "Move £120 to cover your bills account",
  body: "Your bills account needs £120 for Energy on 18 October.",
  action: { label: "Review the move", route: "/upcoming" },
  estimated: false,
  amount: 120,
  covered: true,
  sources_safe: true,
  move_map: {
    from: { account_id: "alex-everyday", name: "Everyday account", provider: "Monzo", balance: 542, safe_note: "Still covers Alex's own payments" },
    to: { account_id: "alex-bills", name: "Bills account", provider: "Barclays", balance: 68, incoming: "£120 to add" },
  },
  plan_dest: {
    account_id: "alex-bills", name: "Bills account", provider: "Barclays", balance: 68,
    needs_total: 188, needs_by: "18 Oct", needs_by_date: "2026-10-18",
    bills: [{ label: "Energy", amount: 188, expected_date: "2026-10-18" }],
  },
};

/** Penny only proposes this local planning action. The displayed consequence
 * explicitly preserves the product boundary: a set-aside does not move cash. */
export const PENNY_SET_ASIDE_PROPOSAL: ProposalMsg = {
  id: 22,
  role: "assistant",
  kind: "proposal",
  status: "pending",
  proposal: {
    proposal_id: "fictional-alex-annual-costs",
    kind: "allocation",
    summary: "Your £200 annual costs envelope",
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

/** The exact Allocation-shaped record returned by the fixture-only save.
 * It represents a plan, not a payment or a transfer. */
export const ANNUAL_COSTS_ALLOCATION: Allocation = {
  id: "alex-annual-costs",
  name: "Annual costs",
  amount_per_period: 200,
  period_amount: 200,
  filled_this_period: 0,
  remaining: 200,
  source_account_id: "alex-everyday",
  fill_account_id: "",
  match_type: "description_contains",
  match_value: "",
  fill_display_name: "",
  tracking_mode: "manual",
  recurrence: "every_period",
  active: true,
  period_start: "2026-10-08",
  period_end: "2026-10-30",
  effective_from: "2026-10-08",
  pending: false,
  completed: false,
};

export const ANNUAL_COSTS_SET_ASIDE: SetAsideItem = {
  id: ANNUAL_COSTS_ALLOCATION.id,
  name: "Annual costs",
  feedLabel: null,
  amountPerPeriod: 200,
  filledThisPeriod: 0,
  remaining: 200,
  recurrence: "every_period",
  pending: false,
  completed: false,
  createdViaPenny: false,
};
