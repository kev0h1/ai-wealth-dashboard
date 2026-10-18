import type { SpendVerdict } from "@/lib/api";
import { formatPeriod } from "@/lib/payPeriod";

export type Variant = "a" | "b" | "c";
export type Scenario = "monthly" | "year" | "weekly";
export type PreviewState = "ready" | "loading" | "error" | "empty";
export type Period = { start: string; end: string; elapsed: number; spent: number; usual: number; income: number; moved: number };

export const VARIANTS = [
  { id: "a", name: "A · Full range", description: "Keep the familiar inline arrows. Give the date its natural width, with no ellipsis. At 320px the title deliberately sits above the complete control row." },
  { id: "b", name: "B · Date under Spend", description: "Put the full range under the title. Previous, next and Search stay together to the right, even at 320px. Tap the dates for the period list." },
  { id: "c", name: "C · One period chooser", description: "A quieter header with a direct date button and Search. Previous and next move inside the chooser, so stepping between periods takes an extra tap." },
] as const;

export const SCENARIOS: Record<Scenario, { label: string; periods: Period[] }> = {
  monthly: { label: "September to October", periods: [
    { start: "2026-09-25", end: "2026-10-29", elapsed: 6, spent: 2073.5, usual: 1405.58, income: 4800.36, moved: 5147.7 },
    { start: "2026-08-28", end: "2026-09-24", elapsed: 28, spent: 3200, usual: 3500, income: 4800, moved: 500 },
    { start: "2026-07-31", end: "2026-08-27", elapsed: 28, spent: 2800, usual: 3100, income: 4600, moved: 450 },
  ] },
  year: { label: "Across a year boundary", periods: [
    { start: "2026-12-25", end: "2027-01-28", elapsed: 6, spent: 2073.5, usual: 1405.58, income: 4800.36, moved: 5147.7 },
    { start: "2026-11-27", end: "2026-12-24", elapsed: 28, spent: 3200, usual: 3500, income: 4800, moved: 500 },
    { start: "2026-10-30", end: "2026-11-26", elapsed: 28, spent: 2800, usual: 3100, income: 4600, moved: 450 },
  ] },
  weekly: { label: "Weekly", periods: [
    { start: "2026-09-21", end: "2026-09-27", elapsed: 3, spent: 250, usual: 280, income: 900, moved: 100 },
    { start: "2026-09-14", end: "2026-09-20", elapsed: 7, spent: 620, usual: 650, income: 900, moved: 100 },
    { start: "2026-09-07", end: "2026-09-13", elapsed: 7, spent: 550, usual: 620, income: 900, moved: 150 },
  ] },
};

const utc = (iso: string) => new Date(`${iso}T00:00:00Z`);
export const periodDays = (period: Period) => Math.round((utc(period.end).getTime() - utc(period.start).getTime()) / 86400000) + 1;
export const shortRange = (period: Period) => formatPeriod(utc(period.start), utc(period.end)).replace(" → ", " to ");
export const yearContext = (period: Period) => period.start.slice(0, 4) === period.end.slice(0, 4) ? null : `${period.start.slice(0, 4)} to ${period.end.slice(0, 4)}`;
export function fullRange(period: Period): string {
  const format = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
  return `${format.format(utc(period.start))} to ${format.format(utc(period.end))}`;
}

export function verdictFor(period: Period, index: number): SpendVerdict {
  return {
    state: "normal", reading: "Synthetic preview data.", notables: [], quiet_flags: [],
    majority: [{ category: "Everyday spending", spent: period.spent, payments_count: 12, has_baseline: true, elevated: false }],
    unresolved: { total: 0, payments_count: 0, ask_worthy: false, weight: "routine", largest: null },
    moved: [{ kind: "pots", label: "Moved to savings pots", amount: period.moved, payments_count: 2 }],
    moved_total: period.moved,
    pills: { spent: period.spent, income: period.income, net: period.income - period.spent },
    period: { start: period.start, end: period.end, days_elapsed: period.elapsed, days_left: periodDays(period) - period.elapsed, offset: -index, closed: index > 0 },
    pace_series: [{ day: period.elapsed, actual: period.spent, usual: period.usual }],
  };
}
