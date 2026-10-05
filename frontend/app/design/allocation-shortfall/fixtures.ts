import type { Allocation, CompanionItem, PlanMove } from "@/lib/api";

// G217 fixtures. No user data. The payment card fixture matches the real
// CompanionItem "move" payload the production MoveCard renders; the
// allocation fixture uses the real Allocation field names, with the
// shortfall attribution the engine fold-in will add as preview-only fields.

export type ShortfallState = "estimated" | "known" | "no-source";

export type AllocationShortfall = {
  allocation: Pick<Allocation, "id" | "name" | "amount_per_period" | "source_account_id">;
  /** Pounds still needed for this set-aside after payments and plans. */
  shortfall: number;
  payingAccount: { name: string; provider: string };
  /** True when the paying account is inferred from recent transfers. */
  estimated: boolean;
  /** An account that can safely spare the money, or null when none can. */
  source: { name: string; provider: string } | null;
};

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

export function allocationShortfall(state: ShortfallState): AllocationShortfall {
  return {
    allocation: {
      id: "alloc-holiday",
      name: "Holiday",
      amount_per_period: 200,
      source_account_id: state === "estimated" ? null : "premier-current",
    },
    shortfall: 38.4,
    payingAccount: { name: "Premier Current", provider: "Barclays" },
    estimated: state === "estimated",
    source: state === "no-source" ? null : { name: "Savings", provider: "Nationwide" },
  };
}

const GBP = new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP", minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const gbp = (value: number) => GBP.format(value);
export const gbpWhole = (value: number) => (Number.isInteger(value) ? `£${value.toLocaleString("en-GB")}` : gbp(value));
