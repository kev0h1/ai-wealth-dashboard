import type { SpendVerdict, Transaction } from "@/lib/api";

export type SpacingState = "current" | "completed" | "year" | "empty";
export const STATES: { key: SpacingState; label: string }[] = [
  { key: "current", label: "Current period" }, { key: "completed", label: "Completed period" },
  { key: "year", label: "Cross year" }, { key: "empty", label: "No spending" },
];

// Independent synthetic examples. No amounts or transactions from customer data.
export function spacingFixture(state: SpacingState): SpendVerdict {
  const closed = state === "completed";
  const empty = state === "empty";
  const spent = empty ? 0 : closed ? 2300.4 : 2073.5;
  const income = empty ? 0 : 4800.36;
  const usual = closed ? 2010.2 : 1405.58;
  const elapsed = closed ? 28 : state === "year" ? 6 : 24;
  return {
    state: empty ? "nothing" : "everything",
    reading: empty ? "There is no spending to compare yet." : "Spending is above your usual pace this pay period.",
    notables: empty ? [] : [{ category: "Eating Out", spent: closed ? 680.4 : 737.92, multiple: closed ? 1.74 : 10.54, excess: closed ? 290.2 : 667.92, payments_count: 8, cause: [], pace: { spent: closed ? 680.4 : 737.92, usual_by_now: closed ? 390.2 : 70 } }],
    quiet_flags: [], majority: empty ? [] : [{ category: "Bills", spent: closed ? 1620 : 1335.58, payments_count: 7, has_baseline: true, elevated: false }],
    unresolved: { total: 0, payments_count: 0, ask_worthy: false, weight: "routine", largest: null },
    moved: empty ? [] : [{ kind: "pots", label: "Moved to savings pots", amount: closed ? 800 : 5147.7, payments_count: 2 }],
    moved_total: empty ? 0 : closed ? 800 : 5147.7,
    pills: { spent, income, net: Math.round((income - spent) * 100) / 100 },
    period: {
      start: closed ? "2026-08-28" : state === "year" ? "2026-12-25" : "2026-09-25",
      end: closed ? "2026-09-24" : state === "year" ? "2027-01-28" : "2026-10-29",
      days_elapsed: elapsed, days_left: closed ? null : 35 - elapsed, offset: closed ? 1 : 0, closed,
    },
    pace_series: empty ? [] : [{ day: elapsed, actual: spent, usual }],
  };
}

export function spacingIncome(verdict: SpendVerdict): Transaction[] {
  return verdict.pills.income ? [{
    id: "g293-salary", account_id: "g293-current", date: verdict.period.start,
    amount: verdict.pills.income, currency: "GBP", description: "Example salary",
    merchant_name: "Example employer", category: "Income", transaction_type: "credit",
  }] : [];
}
