import type { UpcomingAccountSummary, UpcomingAccountPosition } from "@/lib/upcomingAccounts";
import type { Plan } from "@/lib/upcomingPlans";
import { withCoverSuggestions } from "@/lib/coverSuggestion";
import type { Example } from "./previewParams";

export const PERIOD = "Payments through Sun 29 Nov";
export const SOURCE_BANKS = { monzo: "Monzo", hsbc: "HSBC", savings: "Barclays" };

function account(id: string, bank: string, name: string, after: number, extra: Partial<UpcomingAccountPosition> = {}): UpcomingAccountSummary {
  return {
    id, bank, name, opening: 1000, income: 0, transfersIn: 0, outgoing: 1000 - after,
    closing: after, shortfall: after < 0 ? -after : 0, status: after < 0 ? "short" : "covered",
    firstShortDate: after < 0 ? "2026-11-09" : null, hasUnassignedIncome: false,
    events: [{ id: `${id}-payment`, name: "Example payment", amount: -(1000 - after), date: "2026-11-09", kind: "payment", after }],
    position: { afterPayments: after, lowPoint: after, plansReserved: 0, afterPaymentsAndPlans: after, lowPointAndPlans: after, spendFrom: Math.max(0, after), uncertain: false, ...extra },
  };
}

/** Fictional names; authoritative positions exercise the existing G417/G428 shapes. */
export function exampleAccounts(state: Example): UpcomingAccountSummary[] {
  if (state === "empty") return [];
  if (state === "unknown") return [{ ...account("unknown", "NatWest", "Bills account", 0), opening: null, closing: null, shortfall: null, status: "unknown", firstShortDate: null, outgoing: 0, events: [], position: undefined }, account("starling", "Starling", "Household account", 22.61)];
  if (state === "fine") return [account("hsbc", "HSBC", "Current account", 116), account("starling", "Starling", "Household account", 22.61)];
  const long = state === "long", covered = state !== "uncovered";
  const monzoName = long ? "Monzo Alexandra Taylor Morgan household current account" : "Monzo Alexandra Taylor Morgan";
  const savingsName = long ? "BARCLAYS PERSONAL GBP RAINY DAY SAVINGS" : "Barclays Personal GBP";
  const savingsAmount = state === "partial" ? 700 : 1100;
  const natwestGap = state === "pennies" ? 126.29 : 126;
  const natwestMove = state === "pennies" ? 140.29 : 140;
  let accounts = withCoverSuggestions([
    account("natwest", "NatWest", long ? "Household bills and regular commitments" : "Bills account", -natwestGap, covered ? {
      coveredByMove: { amount: natwestMove, shortfall: natwestGap, from: [{ accountId: "monzo", name: monzoName, label: monzoName, amount: natwestMove }] }, shortAfterCover: 0,
    } : {}),
    account("barclays", "Barclays", "Personal GBP", -1229, covered ? {
      coveredByMove: { amount: 140 + savingsAmount, shortfall: 1229, from: [
        { accountId: "hsbc", name: "Your HSBC account", label: "your HSBC account", amount: 105 },
        { accountId: "monzo", name: monzoName, label: monzoName, amount: 35 },
        { accountId: "savings", name: savingsName, label: savingsName, amount: savingsAmount, savings: true },
      ] }, shortAfterCover: Math.max(0, 1229 - 140 - savingsAmount),
    } : {}),
    account("hsbc", "HSBC", "Current account", 116, {
      ...(covered ? { earmarkedTotal: 105, earmarksOut: [{ toAccountId: "barclays", toName: "Barclays", amount: 105 }] } : {}),
      ...(state === "estimated" ? { plansReserved: 10, afterPaymentsAndPlans: 106, lowPointAndPlans: 106 } : {}),
    }),
    account("monzo", "Monzo", long ? "Alexandra Taylor Morgan household current account" : "Alexandra Taylor Morgan", -149, covered ? { earmarkedTotal: natwestMove + 35, earmarksOut: [
      { toAccountId: "natwest", toName: "NatWest", amount: natwestMove }, { toAccountId: "barclays", toName: "Barclays", amount: 35 },
    ] } : {}),
    account("starling", "Starling", "Household account", 22.61),
  ], []);
  if (state === "no-date" || state === "mixed-dates") accounts = accounts.map(item => ({ ...item, firstShortDate: null, suggestedMoves: item.suggestedMoves?.map((move, index) => ({ ...move, byDate: state === "mixed-dates" ? index % 2 ? "2026-11-11" : "2026-11-09" : null })) }));
  if (state === "uncertain") accounts = accounts.map(item => item.id !== "barclays" ? item : { ...item, position: { ...item.position!, uncertain: true, afterPaymentsAndPlans: null, lowPointAndPlans: null, spendFrom: null } });
  return accounts;
}

export function examplePlans(state: Example): Plan[] {
  return state === "estimated" ? [{ id: "reserve", kind: "allocation", name: "Household reserve", destination: "Reserve", destinationIds: ["reserve"], sourceId: "hsbc", evidence: "recent-transfers", periodPence: 1000, filledPence: 0, remainingPence: 1000, active: true }] : [];
}
export const examplePlansStatus = (state: Example): "loading" | "error" | "ready" => state === "pending" ? "loading" : state === "error" ? "error" : "ready";
