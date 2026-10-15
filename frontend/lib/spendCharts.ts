// G268: the pure rules behind Spend's "Your charts", kept free of React so a
// node test can drive them. One definition of spending (backend
// app/services/spending.py, ENGINE.md "What counts as spending"): the server
// stamps every transaction with `spend_amount`, and every chart reads that, so
// the donut, the daily bars, the period comparison and the size bands add up
// to the same Out figure the Spend page leads with.

export type SpendChartTxn = {
  amount: number;
  category?: string;
  transaction_type: "debit" | "credit";
  spend_amount?: number | null;
};

/** The ids the chart collection can hold. Mirrors WidgetId in SpendTrends. */
export type SpendWidgetId =
  | "category_pie" | "daily_bars" | "period_compare" | "size_distribution"
  | "transport_modes" | "pace_curve" | "debt_burndown";

/** What a user with no saved chart preferences sees, in order: Category
 *  breakdown first, the rest below it. Nothing here pins a chart to Home. */
export const DEFAULT_SPEND_WIDGETS: SpendWidgetId[] = ["category_pie", "daily_bars", "pace_curve", "period_compare"];

/** Saved preferences win untouched (an empty saved list means the person
 *  removed every chart, so it is kept empty). Only a user with nothing saved
 *  gets the default, and the donut is always first in it. */
export function resolveSpendWidgets(saved: string[] | null | undefined, isValid: (id: string) => boolean): SpendWidgetId[] {
  if (Array.isArray(saved)) return saved.filter(isValid) as SpendWidgetId[];
  return [...DEFAULT_SPEND_WIDGETS];
}

/** Signed contribution to spending: +payment, -refund, 0 for anything that is
 *  not spending. Falls back to the old category rule only for a payload from
 *  before the server stamped the field. */
export function spendAmountOf(t: SpendChartTxn): number {
  if (typeof t.spend_amount === "number") return t.spend_amount;
  const cat = t.category || "Other";
  if (cat === "Transfer" || cat === "Income") return 0;
  const amt = Math.abs(t.amount);
  return t.transaction_type === "credit" ? -amt : amt;
}

/** Rows that are payments that count (refunds net off elsewhere). */
export function spendPayments<T extends SpendChartTxn>(txns: T[]): T[] {
  return txns.filter(t => spendAmountOf(t) > 0);
}

/** Net spending across rows: payments less refunds. */
export function spendTotal(txns: SpendChartTxn[]): number {
  return txns.reduce((sum, t) => sum + spendAmountOf(t), 0);
}

export type DonutSlice = { name: string; value: number };

/** Most segments a donut shows before the long tail is folded into "Other". */
export const MAX_DONUT_SEGMENTS = 6;

/** Per-category net spending, largest first, at most `max` segments plus one
 *  "Other" that carries the rest (merged with a real "Other" category, which
 *  is the same unplaced money). Non-positive categories are dropped. */
export function donutSlices(txns: SpendChartTxn[], max: number = MAX_DONUT_SEGMENTS): DonutSlice[] {
  const map: Record<string, number> = {};
  for (const t of txns) {
    const amt = spendAmountOf(t);
    if (amt === 0) continue;
    const cat = t.category || "Other";
    map[cat] = (map[cat] ?? 0) + amt;
  }
  const ranked = Object.entries(map)
    .map(([name, value]) => ({ name, value }))
    .filter(s => s.value > 0)
    .sort((a, b) => b.value - a.value);
  const named = ranked.filter(s => s.name !== "Other");
  const head = named.slice(0, max);
  const tail = named.slice(max);
  const otherValue =
    tail.reduce((sum, s) => sum + s.value, 0) + (ranked.find(s => s.name === "Other")?.value ?? 0);
  const out = [...head];
  if (otherValue > 0) out.push({ name: "Other", value: otherValue });
  return out.sort((a, b) => (a.name === "Other" ? 1 : b.name === "Other" ? -1 : b.value - a.value));
}
