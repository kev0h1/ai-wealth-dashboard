// G416 approved A: exact penny figures for the source, receiver, plans gap
// and two fine accounts. Suggested moves remain separate from payment events.
export const PERIOD = "Payments through Sun 29 Nov";

const payment = (id: string, name: string, amount: number, date: string, after?: number) => ({ id, name, amount, kind: "payment" as const, date, ...(after === undefined ? {} : { after }) });

export const accounts = [
  {
    id: "source", bank: "Barclays", name: "Current account", opening: 1250.5, income: 0, transfersIn: 0, outgoing: 528.21,
    closing: 722.29, shortfall: 0, status: "covered", firstShortDate: null, hasUnassignedIncome: false,
    events: [payment("broadband", "Broadband", -35.99, "2026-11-06", 1214.51), payment("council", "Council tax", -168.22, "2026-11-09", 1046.29), payment("car", "Car payment", -324, "2026-11-10", 722.29)],
    position: { afterPayments: 722.29, lowPoint: 722.29, plansReserved: 22.26, afterPaymentsAndPlans: 700.03, lowPointAndPlans: 700.03, spendFrom: 425.03, spendFromRequiresMove: true, uncertain: false, earmarkedTotal: 275, earmarksOut: [{ toAccountId: "destination", toName: "Bills account", amount: 275 }] },
  },
  {
    id: "destination", bank: "NatWest", name: "Bills account", opening: 40, income: 0, transfersIn: 0, outgoing: 315,
    closing: -275, shortfall: 275, status: "short", firstShortDate: "2026-11-06", hasUnassignedIncome: false,
    events: [payment("energy", "Energy", -150, "2026-11-06", -110), payment("insurance", "Insurance", -165, "2026-11-12", -275)],
    position: { afterPayments: -275, lowPoint: -275, plansReserved: 0, afterPaymentsAndPlans: -275, lowPointAndPlans: -275, spendFrom: 0, spendFromRequiresMove: true, uncertain: false, coveredByMove: { amount: 275, shortfall: 275, from: [{ accountId: "source", name: "Current account", amount: 275 }] }, shortAfterCover: 0 },
  },
  {
    id: "monzo", bank: "Monzo", name: "Everyday account", opening: 150.25, income: 0, transfersIn: 0, outgoing: 50,
    closing: 100.25, shortfall: 0, status: "covered", firstShortDate: null, hasUnassignedIncome: false, events: [payment("groceries", "Groceries", -50, "2026-11-08", 100.25)],
    position: { afterPayments: 100.25, lowPoint: 100.25, plansReserved: 175.5, afterPaymentsAndPlans: -75.25, lowPointAndPlans: -75.25, spendFrom: 0, uncertain: false },
  },
  {
    id: "fine-a", bank: "HSBC", name: "Current account", opening: 215.65, income: 0, transfersIn: 0, outgoing: 100,
    closing: 115.65, shortfall: 0, status: "covered", firstShortDate: null, hasUnassignedIncome: false, events: [payment("phone", "Phone", -100, "2026-11-11", 115.65)],
    position: { afterPayments: 115.65, lowPoint: 115.65, plansReserved: 0, afterPaymentsAndPlans: 115.65, lowPointAndPlans: 115.65, spendFrom: 40.4, uncertain: false },
  },
  {
    id: "fine-b", bank: "Starling", name: "Spare account", opening: 50, income: 0, transfersIn: 0, outgoing: 17.97,
    closing: 32.03, shortfall: 0, status: "covered", firstShortDate: null, hasUnassignedIncome: false, events: [payment("membership", "Membership", -17.97, "2026-11-13", 32.03)],
    position: { afterPayments: 32.03, lowPoint: 32.03, plansReserved: 0, afterPaymentsAndPlans: 32.03, lowPointAndPlans: 32.03, spendFrom: 32.03, uncertain: false },
  },
] as const;

export const plans = [{
  id: "source-plan", kind: "allocation", name: "Household reserve", destination: "Reserve", destinationIds: ["reserve"], sourceId: "source", evidence: "chosen", periodPence: 2226, filledPence: 0, remainingPence: 2226, active: true,
}, {
  id: "monzo-plan", kind: "allocation", name: "Monzo reserve", destination: "Reserve", destinationIds: ["reserve"], sourceId: "monzo", evidence: "chosen", periodPence: 17550, filledPence: 0, remainingPence: 17550, active: true,
}] as const;

// £425.03 + £0 + £0 + £40.40 + £32.03.
export const allocationTotal = 497.46;
