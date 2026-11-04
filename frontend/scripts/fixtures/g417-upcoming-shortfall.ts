import type { UpcomingAccountSummary } from "../../lib/upcomingAccounts";
import type { Plan } from "../../lib/upcomingPlans";

const payment = (id: string, name: string, amount: number, date: string, after: number) => ({
  id, name, amount, date, after, kind: "payment" as const,
});

/** Approved G417 A values. Positions are authoritative pound inputs; views read
 * them as integer pence and never use the pooled Spend from allocation. */
export const accounts = [
  {
    id: "natwest", bank: "NatWest", name: "Bills account", opening: 40, income: 0, transfersIn: 0, outgoing: 299,
    closing: -259, shortfall: 259, status: "short", firstShortDate: "2026-11-06", hasUnassignedIncome: false,
    shortFor: { label: "Energy", date: "2026-11-06", cardRepayment: false },
    events: [payment("energy", "Energy", -299, "2026-11-06", -259)],
    position: { afterPayments: -259, lowPoint: -259, plansReserved: 0, afterPaymentsAndPlans: -259, lowPointAndPlans: -259, spendFrom: 11, uncertain: false, coveredByMove: { amount: 270, shortfall: 259, from: [{ accountId: "barclays", name: "Current account", amount: 270 }] }, shortAfterCover: 0 },
  },
  {
    id: "barclays", bank: "Barclays", name: "Current account", opening: 1132.47, income: 0, transfersIn: 0, outgoing: 528.21,
    closing: 604.26, shortfall: 0, status: "covered", firstShortDate: null, hasUnassignedIncome: false,
    events: [payment("council", "Council tax", -528.21, "2026-11-09", 604.26)],
    position: { afterPayments: 604.26, lowPoint: 604.26, plansReserved: 22.26, afterPaymentsAndPlans: 582, lowPointAndPlans: 582, spendFrom: 312, spendFromRequiresMove: true, uncertain: false, earmarkedTotal: 270, earmarksOut: [{ toAccountId: "natwest", toName: "Bills account", amount: 270 }] },
  },
  {
    id: "hsbc", bank: "HSBC", name: "Current account", opening: 80, income: 0, transfersIn: 0, outgoing: 125,
    closing: -45, shortfall: 45, status: "short", firstShortDate: "2026-11-12", hasUnassignedIncome: false,
    events: [payment("phone", "Phone", -125, "2026-11-12", -45)],
    position: { afterPayments: -45, lowPoint: -45, plansReserved: 0, afterPaymentsAndPlans: -45, lowPointAndPlans: -45, spendFrom: 0, uncertain: false },
  },
  {
    id: "monzo", bank: "Monzo", name: "Everyday account", opening: 98.25, income: 0, transfersIn: 0, outgoing: 78.25,
    closing: 20, shortfall: 0, status: "covered", firstShortDate: null, hasUnassignedIncome: false,
    events: [payment("groceries", "Groceries", -78.25, "2026-11-08", 20)],
    position: { afterPayments: 20, lowPoint: 20, plansReserved: 66.49, afterPaymentsAndPlans: -46.49, lowPointAndPlans: -46.49, spendFrom: 0, uncertain: false },
  },
  {
    id: "fine-a", bank: "Starling", name: "Spare account", opening: 50, income: 0, transfersIn: 0, outgoing: 17.97,
    closing: 32.03, shortfall: 0, status: "covered", firstShortDate: null, hasUnassignedIncome: false,
    events: [payment("membership", "Membership", -17.97, "2026-11-13", 32.03)],
    position: { afterPayments: 32.03, lowPoint: 32.03, plansReserved: 0, afterPaymentsAndPlans: 32.03, lowPointAndPlans: 32.03, spendFrom: 32.03, uncertain: false },
  },
  {
    id: "fine-b", bank: "Lloyds", name: "Household account", opening: 215.65, income: 0, transfersIn: 0, outgoing: 100,
    closing: 115.65, shortfall: 0, status: "covered", firstShortDate: null, hasUnassignedIncome: false,
    events: [payment("broadband", "Broadband", -100, "2026-11-11", 115.65)],
    position: { afterPayments: 115.65, lowPoint: 115.65, plansReserved: 0, afterPaymentsAndPlans: 115.65, lowPointAndPlans: 115.65, spendFrom: 115.65, uncertain: false },
  },
] satisfies UpcomingAccountSummary[];

export const plans = [
  { id: "barclays-plan", kind: "allocation", name: "Household reserve", destination: "Reserve", destinationIds: ["reserve"], sourceId: "barclays", evidence: "chosen", periodPence: 2226, filledPence: 0, remainingPence: 2226, active: true },
  { id: "monzo-plan", kind: "allocation", name: "Monzo reserve", destination: "Reserve", destinationIds: ["reserve"], sourceId: "monzo", evidence: "chosen", periodPence: 6649, filledPence: 0, remainingPence: 6649, active: true },
] satisfies Plan[];

export const PRE_AND_POST_MOVE_TOTAL_PENCE = 37919;
