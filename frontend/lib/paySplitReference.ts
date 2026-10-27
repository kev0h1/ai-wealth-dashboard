import type { MoneyShape } from "@/lib/api";

export type SectionId = "fixed" | "free" | "moved";
export type GuideId = "50-30-20" | "conscious" | "first";
export type Guide = {
  id: GuideId;
  name: string;
  shortName: string;
  description: string;
  shares: Record<SectionId, number> | null;
  ranges?: Record<SectionId, readonly [number, number]>;
};

export const GUIDES: Guide[] = [
  { id: "50-30-20", name: "50/30/20 example", shortName: "50/30/20", shares: { fixed: 50, free: 30, moved: 20 }, description: "Compare your amounts with example percentages of your income." },
  { id: "conscious", name: "Example ranges", shortName: "Example ranges", shares: null, ranges: { fixed: [50, 60], moved: [10, 20], free: [20, 35] }, description: "Compare each amount with an example range of your income." },
  { id: "first", name: "Saving before spending", shortName: "Saving before spending", shares: null, description: "Understand the idea of putting savings aside before other spending." },
];

export const SECTION_LABEL: Record<SectionId, string> = { fixed: "Fixed", free: "Free", moved: "Moved" };
export const SECTION_ORDER: SectionId[] = ["fixed", "moved", "free"];
export function guideFor(value: string | null | undefined): Guide {
  return GUIDES.find(guide => guide.id === value) ?? GUIDES[0];
}

export function money(amount: number): string {
  const rounded = Math.round(Math.abs(amount) * 100) / 100;
  return new Intl.NumberFormat("en-GB", {
    style: "currency", currency: "GBP", minimumFractionDigits: Number.isInteger(rounded) ? 0 : 2, maximumFractionDigits: 2,
  }).format(rounded);
}
export function signedMoney(amount: number): string {
  const hasPence = Math.round(Math.abs(amount) * 100) > 0;
  return `${hasPence ? amount < 0 ? "−" : "+" : ""}${money(amount)}`;
}
const pennies = (amount: number) => Math.round(amount * 100);

export type ComparisonRow = {
  id: SectionId;
  label: string;
  actual: number;
  guide: number | null;
  delta: number | null;
  incomeShare: number;
  guideShare: number | null;
  guideMin: number | null;
  guideMax: number | null;
  guideShareMin: number | null;
  guideShareMax: number | null;
  position: "below" | "within" | "above" | null;
  /** Numerical classification only, never a warning or coaching signal. */
  aboveCost: boolean;
};
export type Comparison = {
  available: boolean;
  income: number;
  totalOut: number;
  beyond: number;
  left: number;
  rows: ComparisonRow[];
  largestOver: ComparisonRow | null;
  netDifference: number | null;
};

export function compareShape(shape: MoneyShape, guide: Guide): Comparison {
  const income = shape.take_home;
  const empty: Comparison = { available: false, income, totalOut: 0, beyond: 0, left: 0, rows: [], largestOver: null, netDifference: null };
  if (shape.status !== "ok" || !Number.isFinite(income) || income <= 0) return empty;
  const jobs = SECTION_ORDER.map(id => shape.jobs?.find(job => job.id === id));
  if (jobs.some(job => !job || !Number.isFinite(job.amount) || job.amount < 0)) return empty;
  const amounts = jobs.map(job => pennies(job!.amount));
  const totalPence = amounts.reduce((sum, amount) => sum + amount, 0);
  if (shape.total_out !== undefined && (!Number.isFinite(shape.total_out) || Math.abs(pennies(shape.total_out) - totalPence) > 2)) return empty;
  // Keep a complete reference split exact to the penny; the last cost group
  // receives the rounding remainder rather than inventing or losing a penny.
  const guideAmounts: Record<SectionId, number> | null = guide.shares ? {
    fixed: Math.round(pennies(income) * guide.shares.fixed / 100),
    moved: Math.round(pennies(income) * guide.shares.moved / 100),
    free: 0,
  } : null;
  if (guideAmounts) guideAmounts.free = pennies(income) - guideAmounts.fixed - guideAmounts.moved;
  const rows = SECTION_ORDER.map((id, index): ComparisonRow => {
    const actual = amounts[index] / 100;
    const reference = guideAmounts ? guideAmounts[id] / 100 : null;
    const range = guide.ranges?.[id];
    const min = range ? Math.round(pennies(income) * range[0] / 100) : guideAmounts?.[id] ?? null;
    const max = range ? Math.round(pennies(income) * range[1] / 100) : guideAmounts?.[id] ?? null;
    const delta = min === null || max === null ? null : (amounts[index] < min ? amounts[index] - min : amounts[index] > max ? amounts[index] - max : 0) / 100;
    return { id, label: SECTION_LABEL[id], actual, guide: reference, delta, incomeShare: actual / income * 100, guideShare: guide.shares?.[id] ?? null,
      guideMin: min === null ? null : min / 100, guideMax: max === null ? null : max / 100,
      guideShareMin: range?.[0] ?? guide.shares?.[id] ?? null, guideShareMax: range?.[1] ?? guide.shares?.[id] ?? null,
      position: delta === null ? null : delta < 0 ? "below" : delta > 0 ? "above" : "within",
      aboveCost: id !== "moved" && delta !== null && delta > 0.004 };
  });
  const largestOver = rows.filter(row => row.aboveCost).sort((a, b) => (b.delta ?? 0) - (a.delta ?? 0))[0] ?? null;
  const netPence = totalPence - pennies(income);
  return { available: true, income, totalOut: totalPence / 100, beyond: Math.max(0, netPence) / 100, left: Math.max(0, -netPence) / 100, rows, largestOver, netDifference: guideAmounts ? netPence / 100 : null };
}

export function differenceLabel(row: ComparisonRow): string {
  if (row.delta === null) return "No fixed percentage";
  const ranged = row.guide === null;
  if (Math.abs(row.delta) < 0.005) return ranged ? "Within the range" : "Matches this reference";
  return row.delta > 0
    ? `${money(row.delta)} more than ${ranged ? "the top of the range" : "this reference"}`
    : `${money(row.delta)} below ${ranged ? "the bottom of the range" : "this reference"}`;
}

export function referenceAmount(row: ComparisonRow): string {
  return row.guide !== null ? money(row.guide) : row.guideMin !== null && row.guideMax !== null ? `${money(row.guideMin)} to ${money(row.guideMax)}` : "No fixed percentage";
}

export function referenceShare(row: ComparisonRow): string {
  return row.guideShare !== null ? `${row.guideShare}% guide` : `${row.guideShareMin} to ${row.guideShareMax}% range`;
}
