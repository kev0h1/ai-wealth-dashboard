import type { MoneyShape } from "@/lib/api";
import { type Comparison, type ComparisonRow, signedMoney } from "@/lib/paySplitReference";
import { restoredFixture, type RestoredExample } from "@/scripts/fixtures/g343-restored-pay-split";

export const EXAMPLES = [
  { id: "kevin", label: "All within range" },
  { id: "outside", label: "Above and below" },
  { id: "left", label: "One below range" },
  { id: "boundary", label: "Exactly on the edges" },
  { id: "zero", label: "A true zero amount" },
  { id: "large", label: "Large figures" },
  { id: "refund", label: "Refund in the detail" },
  { id: "missing-evidence", label: "Category detail missing" },
  { id: "no-income", label: "No income" },
  { id: "loading", label: "Loading" },
  { id: "save-error", label: "Choice not saved" },
] as const;
export type Example = typeof EXAMPLES[number]["id"];
export function fixture(example: Example): MoneyShape {
  const shape = restoredFixture(example === "boundary" || example === "zero" ? "kevin" : example as RestoredExample);
  if (example === "boundary" || example === "zero") {
    const values = example === "boundary" ? { fixed: 2421.84, moved: 968.74, free: 968.74 } : { fixed: 0, moved: 0, free: 0 };
    shape.total_out = Math.round((values.fixed + values.moved + values.free) * 100) / 100;
    shape.beyond = shape.overspent = 0;
    for (const job of shape.jobs ?? []) {
      job.amount = job.id === "left" ? Math.round((shape.take_home - shape.total_out) * 100) / 100 : values[job.id];
      if (job.id !== "left") job.drivers = job.amount === 0 ? [] : [{ category: job.label, amount: job.amount }];
    }
  }
  return shape;
}
export const guidePercent = (row: ComparisonRow) => row.guideShareMin + " to " + row.guideShareMax + "%";
export function status(row: ComparisonRow): string {
  return row.delta === null ? "No fixed range" : row.delta === 0 ? "Within range" : signedMoney(row.delta) + (row.delta > 0 ? " above range" : " below range");
}
export function summary(comparison: Comparison): string {
  if (!comparison.available || !comparison.rows.length) return "No comparison yet.";
  const within = comparison.rows.filter(row => row.delta === 0).length;
  const above = comparison.rows.filter(row => row.delta !== null && row.delta > 0).length;
  const below = comparison.rows.filter(row => row.delta !== null && row.delta < 0).length;
  if (within === comparison.rows.length) return "All three amounts are within their ranges.";
  return [within && within + " within range", above && above + " above", below && below + " below"].filter(Boolean).join(" · ") + ".";
}
export function evidence(shape: MoneyShape, row: ComparisonRow) {
  const drivers = shape.jobs?.find(job => job.id === row.id)?.drivers;
  return drivers && drivers.every(item => Number.isFinite(item.amount)) && Math.round(drivers.reduce((sum, item) => sum + item.amount, 0) * 100) === Math.round(row.actual * 100) ? drivers : null;
}
