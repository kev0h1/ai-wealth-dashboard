import type { CashflowData, UpcomingBill } from "./api";
import { upcomingPaymentKey } from "./upcomingAttention";

export type AccountCoverage = { before: number; after: number; shortfall: number };
type Movement = { name: string; amount: number; expected_date: string };
type RiskBill = UpcomingBill & { movementCulprit?: Movement };

// The existing PlanningPage account walk, extracted for fixture tests while
// exposing its before/after values to G176. Its risk semantics are unchanged:
// same-day credits first, movements debit their source but never enter atRisk,
// deficits cascade, card charges are excluded, and unknown-destination income
// retains the legacy risk behaviour. That last case cannot verify a specific
// account for a new "Covered" label, so it intentionally has no coverage entry.
export function walkUpcomingAccounts(cashflow: Pick<CashflowData, "upcoming_bills" | "upcoming_income" | "internal_inflows">, simEndMs: number) {
  const scopedBills = cashflow.upcoming_bills.filter((bill) =>
    new Date(bill.expected_date).getTime() <= simEndMs &&
    bill.account_balance != null && bill.account_balance >= 0 && !bill.is_credit_card,
  );
  const running: Record<string, number> = {};
  for (const bill of scopedBills) {
    const key = bill.account_id ?? "__null__";
    if (!(key in running)) running[key] = bill.account_balance!;
  }
  type Event =
    | { kind: "income" | "inflow"; days_away: number; amount: number; account_id?: string | null }
    | { kind: "bill"; days_away: number; amount: number; account_id?: string | null; bill: UpcomingBill };
  const events: Event[] = [
    ...scopedBills.map((bill) => ({ kind: "bill" as const, days_away: bill.days_away, amount: bill.amount, account_id: bill.account_id, bill })),
    ...cashflow.upcoming_income.filter((income) => new Date(income.expected_date).getTime() <= simEndMs)
      .map((income) => ({ kind: "income" as const, days_away: income.days_away, amount: income.amount, account_id: income.account_id })),
    ...(cashflow.internal_inflows ?? []).filter((inflow) => new Date(inflow.expected_date).getTime() <= simEndMs)
      .map((inflow) => ({ kind: "inflow" as const, days_away: inflow.days_away, amount: inflow.amount, account_id: inflow.account_id })),
  ];
  events.sort((a, b) => a.days_away - b.days_away || (a.kind === "bill" ? 1 : 0) - (b.kind === "bill" ? 1 : 0));
  const movementsSince: Record<string, Movement[]> = {};
  const unverifiable = new Set<string>();
  const atRisk: RiskBill[] = [];
  const coverage = new Map<string, AccountCoverage>();
  const rounded = (value: number) => Math.round(value * 100) / 100;
  for (const event of events) {
    if (event.kind !== "bill") {
      if (event.account_id) {
        if (event.account_id in running) {
          running[event.account_id] += event.amount;
          movementsSince[event.account_id] = [];
        }
      } else {
        for (const key of Object.keys(running)) {
          running[key] += event.amount;
          movementsSince[key] = [];
          unverifiable.add(key);
        }
      }
      continue;
    }
    const key = event.account_id ?? "__null__";
    if (!(key in running)) continue;
    const before = running[key];
    running[key] = before - event.amount;
    const isMovement = event.bill.kind === "movement";
    if (isMovement) (movementsSince[key] ??= []).push({ name: event.bill.name, amount: event.bill.amount, expected_date: event.bill.expected_date });
    if (before < event.amount && !isMovement) {
      const culprit = [...(movementsSince[key] ?? [])].sort((a, b) => b.amount - a.amount)[0];
      atRisk.push(culprit ? { ...event.bill, movementCulprit: culprit } : event.bill);
    }
    if (event.account_id && !unverifiable.has(key)) {
      coverage.set(upcomingPaymentKey(event.bill), {
        before: rounded(before), after: rounded(running[key]), shortfall: Math.max(0, rounded(-running[key])),
      });
    }
  }
  return { atRisk, coverage };
}
