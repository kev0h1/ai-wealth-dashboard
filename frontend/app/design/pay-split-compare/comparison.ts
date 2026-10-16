import type { MoneyShape } from "@/lib/api";

export type SectionId = "fixed" | "free" | "moved";
export type GuideId = "50-30-20" | "conscious" | "first";
export type Guide = {
  id: GuideId;
  name: string;
  shortName: string;
  description: string;
  shares: Record<SectionId, number> | null;
};

export const GUIDES: Guide[] = [
  { id: "50-30-20", name: "50/30/20 · adapted", shortName: "50/30/20", shares: { fixed: 50, free: 30, moved: 20 }, description: "A common income guide: 50% needs, 30% wants, 20% savings and debt payments. Here it is roughly mapped to Fixed, Free and Moved, not a needs-and-wants assessment." },
  { id: "conscious", name: "Conscious Spending Plan · example", shortName: "60/20/20 example", shares: { fixed: 60, free: 20, moved: 20 }, description: "One illustrative mix: 60% Fixed, 20% Free and 20% Moved (10% investment plus 10% savings). The wider framework uses ranges: Fixed 50–60%, discretionary 20–35%, investment 10%, savings 5–10%. A difference from this example is not a breach of those ranges." },
  { id: "first", name: "Pay yourself first · principle", shortName: "Pay yourself first", shares: null, description: "Set money aside before deciding what remains for other spending. This principle does not prescribe a universal percentage, so it has no numeric comparison here." },
];

export const SECTION_LABEL: Record<SectionId, string> = { fixed: "Fixed", free: "Free", moved: "Moved" };
export const SECTION_ORDER: SectionId[] = ["fixed", "moved", "free"];
export const PREVIEW_REFERENCE_KEY = "sorted.design.g279.reference.v1";
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
  /** Only a cost group above this reference receives the amber signifier. */
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
    const delta = guideAmounts ? (amounts[index] - guideAmounts[id]) / 100 : null;
    return { id, label: SECTION_LABEL[id], actual, guide: reference, delta, incomeShare: actual / income * 100, guideShare: guide.shares?.[id] ?? null, aboveCost: id !== "moved" && delta !== null && delta > 0.004 };
  });
  const largestOver = rows.filter(row => row.aboveCost).sort((a, b) => (b.delta ?? 0) - (a.delta ?? 0))[0] ?? null;
  const netPence = totalPence - pennies(income);
  return { available: true, income, totalOut: totalPence / 100, beyond: Math.max(0, netPence) / 100, left: Math.max(0, -netPence) / 100, rows, largestOver, netDifference: guideAmounts ? netPence / 100 : null };
}

export function differenceLabel(row: ComparisonRow): string {
  if (row.delta === null) return "No fixed percentage";
  if (Math.abs(row.delta) < 0.005) return "Matches this reference";
  if (row.id === "moved") return row.delta > 0 ? "More moved than this reference" : "Less moved than this reference";
  return row.delta > 0 ? "Above this reference" : "Below this reference";
}
