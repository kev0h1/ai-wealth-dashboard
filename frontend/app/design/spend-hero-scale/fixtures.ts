import { fixture, incomeFor, type PreviewState } from "../spend-hero/fixtures";
import type { SpendVerdict } from "@/lib/api";

export type ScaleState = PreviewState | "phone";

export function scaleIncomeFor(verdict: SpendVerdict) {
  return incomeFor(verdict).map(transaction => ({ ...transaction, date: verdict.period.start }));
}

export function scaleFixture(state: ScaleState): SpendVerdict | null {
  if (state !== "phone") return fixture(state);
  const base = fixture("normal")!;
  return {
    ...base,
    reading: "Spending is £667.92 above usual pace by day 6.",
    pills: { spent: 2073.5, income: 4800.36, net: 2726.86 },
    period: { start: "2026-09-25", end: "2026-10-30", days_elapsed: 6, days_left: 29, offset: 0, closed: false },
    notables: [
      { ...base.notables[0], spent: 785, excess: 435, multiple: 785 / 350, pace: { spent: 785, usual_by_now: 350 } },
      { ...base.notables[1], spent: 410, excess: 150, multiple: 410 / 260, pace: { spent: 410, usual_by_now: 260 } },
    ],
    majority: [{ ...base.majority[0], spent: 878.5 }],
    moved: [{ ...base.moved[0], amount: 5147.7 }],
    moved_total: 5147.7,
    pace_series: [{ day: 6, actual: 2073.5, usual: 1405.58 }],
  };
}
