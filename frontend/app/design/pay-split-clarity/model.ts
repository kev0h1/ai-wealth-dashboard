import { restoredFixture, type RestoredExample } from "@/scripts/fixtures/g343-restored-pay-split";
import { money, signedMoney, type ComparisonRow, type GuideId } from "@/lib/paySplitReference";
export const EXAMPLES = ["kevin", "outside", "zero", "large", "no-income", "loading", "save-error", "refund", "missing-evidence"] as const;
export type Example = typeof EXAMPLES[number];
export const NAMES: Record<GuideId, string> = {
  "50-30-20": "50/30/20 example", conscious: "Example ranges", first: "Saving before spending",
};
export const DESCRIPTIONS: Record<GuideId, string> = {
  "50-30-20": "Compare your amounts with example percentages of your income.",
  conscious: "Compare each amount with an example range of your income.",
  first: "Understand the idea of putting savings aside before other spending.",
};
export function fixture(example: Example) {
  const shape = restoredFixture((example === "zero" ? "kevin" : example) as RestoredExample);
  if (example === "zero") {
    shape.jobs!.forEach(job => { job.amount = 0; job.drivers = []; });
    shape.total_out = shape.beyond = shape.overspent = 0;
  }
  return shape;
}
export function percent(row: ComparisonRow) {
  return row.guideShare !== null ? `${row.guideShare}%` : `${row.guideShareMin} to ${row.guideShareMax}%`;
}
export function reading(row: ComparisonRow) {
  if (row.delta === null) return "";
  if (row.guide === null) return `${row.delta === 0 ? "within" : row.delta > 0 ? "above" : "below"} ${percent(row)} range`;
  return `${row.delta === 0 ? "matches" : row.delta > 0 ? "above" : "below"} ${percent(row)} example`;
}
export function compactAmount(row: ComparisonRow) { return row.guide !== null ? signedMoney(row.delta ?? 0) : money(row.actual); }
