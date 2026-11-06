import type { UpcomingAccountSummary, UpcomingAccountPosition } from "@/lib/upcomingAccounts";
import { withCoverSuggestions } from "@/lib/coverSuggestion";

export const PERIOD = "Payments through Sun 29 Nov";
export type ExampleState = "moves" | "uncovered" | "long" | "pending" | "error" | "empty";
export const EXAMPLE_STATES: { value: ExampleState; label: string }[] = [
  { value: "moves", label: "Suggested moves" },
  { value: "uncovered", label: "Still uncovered" },
  { value: "long", label: "Long names" },
  { value: "pending", label: "Checking plans" },
  { value: "error", label: "Plans unavailable" },
  { value: "empty", label: "No accounts" },
];

// Fictional account names. Values exercise the row shapes Kevin described.
function account(id: string, bank: string, name: string, after: number, extra: Partial<UpcomingAccountPosition> = {}): UpcomingAccountSummary {
  return {
    id, bank, name, opening: 1000, income: 0, transfersIn: 0, outgoing: 1000 - after,
    closing: after, shortfall: after < 0 ? -after : 0, status: after < 0 ? "short" : "covered",
    firstShortDate: after < 0 ? "2026-11-18" : null, hasUnassignedIncome: false,
    events: [{ id: `${id}-payment`, name: "Example payment", amount: -(1000 - after), date: "2026-11-18", kind: "payment", after }],
    position: { afterPayments: after, lowPoint: after, plansReserved: 0, afterPaymentsAndPlans: after, lowPointAndPlans: after, spendFrom: Math.max(0, after), uncertain: false, ...extra },
  };
}

/** Bank metadata is presentation-only, including the savings source absent from the list. */
export const SOURCE_BANKS: Record<string, string> = { monzo: "Monzo", hsbc: "HSBC", savings: "Barclays" };

export function exampleAccounts(state: ExampleState): UpcomingAccountSummary[] {
  if (state === "empty") return [];
  const long = state === "long";
  const monzoName = long ? "Monzo Alexandra Taylor Morgan household current account" : "Monzo Alexandra Taylor Morgan";
  const savingsName = long ? "BARCLAYS PERSONAL GBP RAINY DAY SAVINGS" : "Barclays Personal GBP";
  const savingsAmount = state === "uncovered" ? 700 : 1100;
  return withCoverSuggestions([
    account("natwest", "NatWest", long ? "Household bills and regular commitments" : "Bills account", -126, {
      coveredByMove: { amount: 140, shortfall: 126, from: [{ accountId: "monzo", name: monzoName, label: monzoName, amount: 140 }] }, shortAfterCover: 0,
    }),
    account("barclays", "Barclays", "Personal GBP", -1229, {
      coveredByMove: { amount: 140 + savingsAmount, shortfall: 1229, from: [
        { accountId: "hsbc", name: "Your HSBC account", label: "your HSBC account", amount: 105 },
        { accountId: "monzo", name: monzoName, label: monzoName, amount: 35 },
        { accountId: "savings", name: savingsName, label: savingsName, amount: savingsAmount, savings: true },
      ] }, shortAfterCover: Math.max(0, 1229 - 140 - savingsAmount),
    }),
    account("hsbc", "HSBC", "Current account", 116, { earmarkedTotal: 105, earmarksOut: [{ toAccountId: "barclays", toName: "Barclays", amount: 105 }] }),
    account("monzo", "Monzo", long ? "Alexandra Taylor Morgan household current account" : "Alexandra Taylor Morgan", -149, { earmarkedTotal: 175, earmarksOut: [
      { toAccountId: "natwest", toName: "NatWest", amount: 140 }, { toAccountId: "barclays", toName: "Barclays", amount: 35 },
    ] }),
    account("starling", "Starling", "Household account", 22.61),
  ], []);
}

export function examplePlansStatus(state: ExampleState): "loading" | "error" | "ready" {
  return state === "pending" ? "loading" : state === "error" ? "error" : "ready";
}
