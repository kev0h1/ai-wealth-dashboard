import type { UpcomingAccountSummary, UpcomingAccountEvent } from "@/lib/upcomingAccounts";
import type { Plan } from "@/lib/upcomingPlans";
import type { PlanCaseId } from "./PlanPreview.types";
import { planFixtures, type PlanFixture } from "./plan-fixtures";
import { accountLabel, bankLabel } from "./ui";

// Additional fixed positions for the same fictional plan records. Keep these
// separate from Available: that stored reading can include suggested moves.
const linkedPlanPositions: Partial<Record<PlanCaseId, Record<string, number>>> = {
  populated: { natwest: 1500 },
  several: { natwest: 4000, joint: -10640 },
  checking: { "annual-costs": -4000 },
  error: { "annual-costs": -4000 },
  long: { "barclays-reserve": 19500 },
};

const pounds = (pence: number | null) => pence === null ? null : pence / 100;

function detailPlans(fixture: PlanFixture): Plan[] {
  return fixture.plans.map(item => ({
    id: item.id,
    kind: item.kind === "set-aside" ? "allocation" : "goal",
    name: item.name,
    destination: item.name,
    sourceId: item.sourceId,
    evidence: item.sourceBasis,
    periodPence: item.periodPence ?? 0,
    filledPence: item.filledPence ?? 0,
    remainingPence: item.remainingPence ?? 0,
    active: item.state === "active",
    amountUnavailable: item.remainingPence === null,
  }));
}

function detailAccounts(fixture: PlanFixture): UpcomingAccountSummary[] {
  const { scenario } = fixture;
  const identity = (id: string) => {
    const account = scenario.accounts.find(candidate => candidate.id === id)!;
    return `${bankLabel(account)} · ${accountLabel(account)}`;
  };
  return scenario.accounts.filter(account => account.purpose !== "card").map(account => {
    const events: UpcomingAccountEvent[] = scenario.payments
      .filter(payment => payment.accountId === account.id && payment.kind !== "card-charge" && payment.kind !== "settling")
      .map(payment => ({ id: payment.id, name: payment.name, date: payment.date, category: payment.category,
        kind: payment.kind === "income" ? "income" : payment.kind === "transfer" ? payment.amountPence > 0 ? "inflow" : "movement" : "payment",
        amount: payment.amountPence / 100, after: pounds(payment.afterPence), ...(payment.credited === false ? { credited: false as const } : {}),
      }));
    const incoming = scenario.moves.filter(move => move.toId === account.id);
    const outgoing = scenario.moves.filter(move => move.fromId === account.id);
    const reserve = fixture.planWorking[account.id] ?? 0;
    const afterPlans = reserve ? linkedPlanPositions[fixture.id]?.[account.id] ?? null : account.afterPaymentsPence;
    const lowAfterPlans = reserve ? linkedPlanPositions[fixture.id]?.[account.id] ?? null : account.paymentLowPence;
    const paymentGap = account.paymentLowPence === null ? null : Math.max(0, -account.paymentLowPence) / 100;
    // These totals describe only the fixed dated fixture events, never a new
    // forecast. The supplied positions below remain authoritative.
    const total = (matches: (event: UpcomingAccountEvent) => boolean) => events.filter(event => event.credited !== false && matches(event)).reduce((sum, event) => sum + Math.round(event.amount * 100), 0) / 100;
    return {
      id: account.id, bank: bankLabel(account), name: accountLabel(account), opening: pounds(account.cashNowPence),
      income: total(event => event.kind === "income"), transfersIn: total(event => event.kind === "inflow"), outgoing: -total(event => event.amount < 0),
      closing: pounds(account.afterPaymentsPence), shortfall: paymentGap,
      status: account.status === "checking" ? "unknown" : paymentGap !== null && paymentGap > 0 ? "short" : "covered",
      firstShortDate: account.firstNeedDate, hasUnassignedIncome: false, events,
      position: {
        afterPayments: pounds(account.afterPaymentsPence), lowPoint: pounds(account.paymentLowPence), plansReserved: reserve / 100,
        afterPaymentsAndPlans: pounds(afterPlans), lowPointAndPlans: pounds(lowAfterPlans), spendFrom: pounds(account.availabilityPence),
        spendFromRequiresMove: account.requiresMove, uncertain: account.status === "checking",
        ...(account.availabilityPence !== null ? { availability: { kind: "ready" as const, value: account.availabilityPence / 100, requiresMove: account.requiresMove, working: null } } : {}),
        ...(account.status === "checking" ? { availabilityPending: "checking" as const } : {}),
        earmarkedTotal: pounds(account.earmarkedPence ?? 0),
        earmarksOut: outgoing.map(move => ({ toAccountId: move.toId, toName: identity(move.toId), amount: move.amountPence / 100 })),
        ...(incoming.length ? { coveredByMove: {
          amount: incoming.reduce((sum, move) => sum + move.amountPence, 0) / 100,
          shortfall: paymentGap ?? 0,
          from: incoming.map(move => ({ accountId: move.fromId, name: identity(move.fromId), amount: move.amountPence / 100, savings: move.savings })),
        }, shortAfterCover: incoming[0].remainingGapPence / 100 } : {}),
      },
      suggestedMoves: [...incoming.map(move => ({ id: `suggested:${move.fromId}:${move.toId}`, counterpartId: move.fromId, counterpartName: identity(move.fromId), amount: move.amountPence / 100, byDate: move.byDate, savings: move.savings, labelled: true })),
        ...outgoing.map(move => ({ id: `suggested:${move.fromId}:${move.toId}`, counterpartId: move.toId, counterpartName: identity(move.toId), amount: -move.amountPence / 100, byDate: move.byDate, labelled: true }))],
    };
  });
}

export const accountDetailFixtures = Object.fromEntries(Object.values(planFixtures).map(fixture => [fixture.id, {
  accounts: detailAccounts(fixture), plans: detailPlans(fixture), periodLabel: fixture.scenario.periodLabel,
}])) as Record<PlanCaseId, { accounts: UpcomingAccountSummary[]; plans: Plan[]; periodLabel: string }>;
