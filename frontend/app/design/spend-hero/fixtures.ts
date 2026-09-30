import type { SpendVerdict, SpendVerdictState, Transaction } from "@/lib/api";

export type PreviewState = SpendVerdictState | "closed" | "unplaced" | "nomoved" | "empty" | "loading" | "error" | "long";

const base: SpendVerdict = {
  state: "normal",
  reading: "Two categories are running above your usual pace, while you are £501 below your usual pace overall.",
  notables: [{ category: "Eating Out", spent: 611, multiple: 1.13, excess: 71, payments_count: 12, cause: [], pace: { spent: 611, usual_by_now: 540 } }, { category: "Entertainment", spent: 300, multiple: 1.15, excess: 40, payments_count: 5, cause: [], pace: { spent: 300, usual_by_now: 260 } }],
  quiet_flags: [], majority: [{ category: "Bills", spent: 1598, payments_count: 8, has_baseline: true, elevated: false }],
  unresolved: { total: 0, payments_count: 0, ask_worthy: false, weight: "routine", largest: null },
  moved: [{ kind: "pots", label: "Moved to savings pots", amount: 500, payments_count: 2 }],
  moved_total: 500, pills: { spent: 3509, income: 4800, net: 1291 },
  period: { start: "2026-09-01", end: "2026-09-30", days_elapsed: 20, days_left: 10, offset: 0, closed: false },
  pace_series: [{ day: 1, actual: 186, usual: 210 }, { day: 10, actual: 1705, usual: 2005 }, { day: 20, actual: 3509, usual: 4010 }],
};

export function incomeFor(verdict: SpendVerdict): Transaction[] {
  if (verdict.pills.income === 0) return [];
  return [{ id: `income-${verdict.pills.income}`, account_id: "barclays", date: "2026-09-01", amount: verdict.pills.income, currency: "GBP", description: "Salary", merchant_name: "Acme", category: "Income", transaction_type: "credit" }];
}

export function fixture(state: PreviewState): SpendVerdict | null {
  if (state === "loading" || state === "error") return null;
  if (state === "everything") return { ...base, state: "everything", reading: "You are £301 above your usual pace overall this pay period.", notables: [{ ...base.notables[0], spent: 1413, multiple: 2.62, excess: 873, pace: { spent: 1413, usual_by_now: 540 } }], majority: [{ ...base.majority[0], spent: 2598 }], pills: { ...base.pills, spent: 4311, net: 489 }, pace_series: [{ day: 1, actual: 220, usual: 210 }, { day: 10, actual: 2150, usual: 2005 }, { day: 20, actual: 4311, usual: 4010 }] };
  if (state === "nothing") return { ...base, state: "nothing", reading: "No spending recorded yet. You are £4,010 below your usual pace so far.", notables: [], majority: [], moved: [], moved_total: 0, pills: { spent: 0, income: 4800, net: 4800 }, pace_series: [{ day: 20, actual: 0, usual: 4010 }] };
  if (state === "empty") return { ...base, state: "nothing", reading: "There is no spending to compare yet this period.", notables: [], majority: [], moved: [], moved_total: 0, pills: { spent: 0, income: 0, net: 0 }, pace_series: [] };
  if (state === "nobaseline") return { ...base, state: "nobaseline", reading: "Keep spending normally while we learn your usual pace.", notables: [], majority: [], moved: [], moved_total: 0, pace_series: [{ day: 20, actual: 3509, usual: null }] };
  if (state === "early") return { ...base, state: "early", reading: "It is too early in this period for a reliable usual-pace comparison.", notables: [], majority: [], moved: [], moved_total: 0, pills: { spent: 186, income: 4800, net: 4614 }, pace_series: [{ day: 1, actual: 186, usual: null }], period: { ...base.period, days_elapsed: 1, days_left: 29 } };
  if (state === "closed") return { ...base, reading: "This pay period closed £501 below your usual pace.", period: { ...base.period, days_elapsed: 30, days_left: 0, closed: true }, pace_series: [{ day: 30, actual: 3509, usual: 4010 }] };
  if (state === "unplaced") return { ...base, reading: "Two categories are running above your usual pace. £125 still needs categorising, and you are £376 below your usual pace overall.", unresolved: { total: 125, payments_count: 2, ask_worthy: true, weight: "material", largest: { id: "unplaced", display_name: "Unknown payment", raw_description: "CARD PAYMENT", amount: 90, date: "2026-09-18" } }, pills: { ...base.pills, spent: 3634, net: 1166 }, pace_series: [{ day: 20, actual: 3634, usual: 4010 }] };
  if (state === "nomoved") return { ...base, moved: [], moved_total: 0 };
  if (state === "long") return { ...base, reading: "Overall spending is £12,345.67 below usual pace, with one category running above usual.", notables: [{ ...base.notables[0], category: "Restaurants, takeaways and celebrations", spent: 123456.78, multiple: 1.1, excess: 11111.11, pace: { spent: 123456.78, usual_by_now: 112345.67 } }], majority: [{ ...base.majority[0], spent: 1111111.11 }], pills: { spent: 1234567.89, income: 1500000, net: 265432.11 }, pace_series: [{ day: 20, actual: 1234567.89, usual: 1246913.56 }] };
  return base;
}

export const STATES: { id: PreviewState; label: string }[] = [
  { id: "normal", label: "Under usual" }, { id: "everything", label: "Over usual" }, { id: "nothing", label: "Zero spend" }, { id: "nobaseline", label: "No baseline" }, { id: "early", label: "Early" }, { id: "closed", label: "Closed" }, { id: "unplaced", label: "To categorise" }, { id: "nomoved", label: "No moved money" }, { id: "empty", label: "Empty" }, { id: "loading", label: "Loading" }, { id: "error", label: "Error" }, { id: "long", label: "Long figures" },
];
