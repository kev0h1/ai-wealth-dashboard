import type { Account, Allocation, CompanionItem, MoveMap, PlanMove } from "@/lib/api";
import type { AllocationShortfallServices } from "@/components/HomeBrief";

// G217 fixtures. No user data. Both items match the real CompanionItem payloads
// the production MoveCard and AllocationShortfallCard render
// (backend/app/services/companion.py: section 6 and section 6b).

export type ShortfallState = "estimated" | "known" | "no-source";

const PREMIER = { account_id: "premier-current", name: "Premier Current", provider: "Barclays", balance: 44.68 };
const HSBC = { account_id: "hsbc-current", name: "HSBC Current", provider: "HSBC", balance: 1280 };

export function paymentItem(): CompanionItem {
  const moves: PlanMove[] = [
    {
      headline: "Move £56 from HSBC Current",
      amount: 56,
      move_map: { from: { ...HSBC, safe_note: "Covers its own bills" }, to: { ...PREMIER, incoming: "£100 due" } },
    } as unknown as PlanMove,
  ];
  return {
    id: "plan:2026-10-05:preview",
    type: "move",
    headline: "Move £56 to Premier Current",
    body: "£56 keeps the payment clearing at Premier Current.",
    action: { label: "See what's due", route: "#" },
    estimated: false,
    brief_lead: { value: "£56", companion: "to Premier Current" },
    plan_dest: {
      ...PREMIER,
      needs_total: 100,
      needs_by: "9 Oct",
      bills: [{ label: "British Gas", amount: 100, expected_date: "2026-10-09" }],
    },
    moves,
    covered: true,
    sources_safe: true,
    amount: 56,
  } as CompanionItem;
}

const SAVINGS = { account_id: "nationwide-savings", name: "Savings", provider: "Nationwide", balance: 2400 };

const allocationRecord: Allocation = {
  id: "alloc-holiday",
  name: "Holiday",
  amount_per_period: 200,
  fill_account_id: "holiday-pot",
  match_type: "description_contains",
  match_value: "Holiday pot",
  fill_display_name: "Holiday pot",
  effective_from: "2026-10-01",
  recurrence: "every_period",
  completed: false,
  pending: false,
  active: true,
  filled_this_period: 50,
  remaining: 150,
  period_start: "2026-10-01",
  period_end: "2026-10-31",
  source_account_id: null,
};

export function allocationItem(state: ShortfallState): CompanionItem {
  const hasSource = state !== "no-source";
  const moveMap: MoveMap = {
    from: { ...SAVINGS, safe_note: "Nothing due from this account right now", reserved_for_allocations: 0 } as MoveMap["from"],
    to: { ...PREMIER, incoming: "Holiday set-aside" },
  };
  return {
    id: `allocation_shortfall:premier-current:2026-10-31:${state}`,
    type: "allocation_shortfall",
    headline: "Your Holiday set-aside is short",
    body: "£38.40 short this period.",
    action: hasSource ? { label: "Move from Savings", route: "#" } : null,
    estimated: state === "estimated",
    amount: 38.4,
    allocation_shortfall: {
      shortfall: 38.4,
      estimated: state === "estimated",
      paying_account: { account_id: PREMIER.account_id, name: PREMIER.name, provider: PREMIER.provider },
      allocation: { id: allocationRecord.id, name: "Holiday", period_amount: 200, suggested_amount: 161.6 },
      other_allocation_count: 0,
      moves: hasSource ? [{ amount: 40, move_map: moveMap }] : [],
    },
  } as CompanionItem;
}

const ACCOUNT_FIXTURE: Account[] = [
  { id: PREMIER.account_id, name: PREMIER.name, type: "BANK", subtype: "TRANSACTION", balance: PREMIER.balance, currency: "GBP", provider: PREMIER.provider, status: "active" },
  { id: SAVINGS.account_id, name: SAVINGS.name, type: "BANK", subtype: "SAVINGS", balance: SAVINGS.balance, currency: "GBP", provider: SAVINGS.provider, status: "active" },
];

/** Fixture services: nothing is fetched or saved. */
export const previewServices: AllocationShortfallServices = {
  listAllocations: async () => [allocationRecord],
  accounts: async () => ACCOUNT_FIXTURE,
  dismissTodayItem: async () => ({ ok: true }) as never,
  updateAllocation: async () => allocationRecord,
  deleteAllocation: async () => ({ ok: true }) as never,
  allocationFillCandidates: async () => [],
};
