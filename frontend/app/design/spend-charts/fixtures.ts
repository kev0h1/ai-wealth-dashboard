// Fixture data for the spend-charts design preview. No live data, no
// network calls, nothing derived from a real user, just the shapes
// PaceCurveWidget and DebtBurndownWidget (components/SpendTrends.tsx)
// actually consume, hand-built to exercise every state that matters.

import type { SpendVerdictPaceEntry, DebtPlanSummary } from "@/lib/api";

/* ── Pace curve fixtures ──────────────────────────────────────────────
   Shape: { day: number, actual: number, usual: number | null }, day
   1-indexed, actual/usual cumulative-to-date totals (see
   backend/app/services/spend_verdict.py build_pace_series). */

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// A smooth front-loaded ramp (bills-heavy early, tapering later), the same
// shape build_pace_series' learned S-curve produces, rather than a flat
// linear ramp that would misrepresent what a "usual" line actually looks
// like in production.
function sCurveRamp(day: number, totalDays: number, totalAtEnd: number): number {
  const f = day / totalDays;
  const shaped = 1 - Math.pow(1 - f, 1.6); // front-loaded, concave
  return round2(totalAtEnd * shaped);
}

// State 1 — healthy, actual running BELOW a real usual line.
const PACE_BELOW_USUAL: SpendVerdictPaceEntry[] = Array.from({ length: 20 }, (_, i) => {
  const day = i + 1;
  const usual = sCurveRamp(day, 28, 950);
  const actual = round2(usual * 0.78 - (day % 5 === 0 ? 6 : 0));
  return { day, actual, usual };
});

// State 2 — healthy, actual running ABOVE usual. Must stay neutral, not
// red (DESIGN.md: colour is information, red means genuine risk only).
const PACE_ABOVE_USUAL: SpendVerdictPaceEntry[] = Array.from({ length: 20 }, (_, i) => {
  const day = i + 1;
  const usual = sCurveRamp(day, 28, 780);
  const actual = round2(usual * 1.22 + (day % 4 === 0 ? 9 : 0));
  return { day, actual, usual };
});

// State 3 — thin history, usual null on EVERY day. No comparison line, no
// comparative claim, actual alone.
const PACE_THIN_HISTORY: SpendVerdictPaceEntry[] = Array.from({ length: 15 }, (_, i) => {
  const day = i + 1;
  const actual = round2(day * 31.4 + (day % 3 === 0 ? 18 : 0));
  return { day, actual, usual: null };
});

// State 4 — partially-null usual: known for days 1-4, a null gap for days
// 5-7, known again for days 8-12. Exercises whatever recharts does at a
// null boundary inside a `connectNulls` line (see SpendTrends.tsx's
// explicit `connectNulls` on the usual Line).
// Usual deliberately kept well clear of actual (roughly 45-55% higher)
// so the two lines are visually distinct in a screenshot, the point is to
// see what recharts draws across the days 5-7 null gap in the usual line,
// not to have it blend into the actual line.
const PACE_PARTIAL_NULL: SpendVerdictPaceEntry[] = [
  { day: 1, actual: 40,  usual: 60 },
  { day: 2, actual: 88,  usual: 130 },
  { day: 3, actual: 121, usual: 180 },
  { day: 4, actual: 170, usual: 250 },
  { day: 5, actual: 210, usual: null },
  { day: 6, actual: 244, usual: null },
  { day: 7, actual: 268, usual: null },
  { day: 8, actual: 305, usual: 460 },
  { day: 9, actual: 340, usual: 500 },
  { day: 10, actual: 372, usual: 540 },
  { day: 11, actual: 398, usual: 580 },
  { day: 12, actual: 430, usual: 620 },
];

// State 5 — a very short series, 1-2 days elapsed (start of a new pay
// period, the day after payday).
const PACE_VERY_SHORT: SpendVerdictPaceEntry[] = [
  { day: 1, actual: 62, usual: 58 },
  { day: 2, actual: 94, usual: 101 },
];

export const PACE_FIXTURES: Record<string, { label: string; series: SpendVerdictPaceEntry[] }> = {
  "below-usual":  { label: "Healthy, below usual",       series: PACE_BELOW_USUAL },
  "above-usual":  { label: "Healthy, above usual",        series: PACE_ABOVE_USUAL },
  "thin-history": { label: "Thin history, no usual",      series: PACE_THIN_HISTORY },
  "partial-null": { label: "Partially-null usual",        series: PACE_PARTIAL_NULL },
  "very-short":   { label: "Very short, 1-2 days",        series: PACE_VERY_SHORT },
};

export const PACE_STATE_ORDER = ["below-usual", "above-usual", "thin-history", "partial-null", "very-short"];

/* ── Debt burn-down fixtures ──────────────────────────────────────────
   Shape: { month: "YYYY-MM", total: number }[], see DebtPlanSummary in
   lib/api.ts and DebtBurndownWidget's previewState seam in
   components/SpendTrends.tsx. */

// State 6 — a series that DOES reach zero, short enough that
// clipProjection draws the whole array untouched (no clip caption).
const DEBT_REACHES_ZERO: DebtPlanSummary["projection"] = [
  { month: "2026-09", total: 3184.20 },
  { month: "2026-10", total: 2690.55 },
  { month: "2026-11", total: 2197.90 },
  { month: "2026-12", total: 1705.25 },
  { month: "2027-01", total: 1212.60 },
  { month: "2027-02", total: 719.95 },
  { month: "2027-03", total: 227.30 },
  { month: "2027-04", total: 0 },
];

// State 7 — never reaches zero and rises: 121 points, month 0 = 2026-09 at
// £24,654.87, month 120 = 2036-09 at £78,946.91, a smooth compounding
// climb (interest outpacing the demonstrated payment). Generated rather
// than hand-typed so the endpoints match exactly and the shape is
// monotonic; clipProjection must cut this to the first 24 months.
function buildRisingProjection(): DebtPlanSummary["projection"] {
  const START_TOTAL = 24654.87;
  const END_TOTAL = 78946.91;
  const POINTS = 121;
  const points: { month: string; total: number }[] = [];
  let year = 2026;
  let month = 9; // September
  for (let i = 0; i < POINTS; i++) {
    const f = i / (POINTS - 1);
    const total = round2(START_TOTAL * Math.pow(END_TOTAL / START_TOTAL, f));
    points.push({ month: `${year}-${String(month).padStart(2, "0")}`, total });
    month += 1;
    if (month > 12) { month = 1; year += 1; }
  }
  // Pin the exact endpoints the brief specified (rounding above can drift
  // the last few cents off Math.pow's floating point).
  points[0].total = START_TOTAL;
  points[points.length - 1].total = END_TOTAL;
  return points;
}
const DEBT_RISES_NEVER_CLEARS: DebtPlanSummary["projection"] = buildRisingProjection();

export const DEBT_FIXTURES: Record<
  string,
  { label: string; state: { status: "loading" | "error" | "ok"; projection?: DebtPlanSummary["projection"] } }
> = {
  "reaches-zero": { label: "Reaches zero, draws whole array",     state: { status: "ok", projection: DEBT_REACHES_ZERO } },
  "rises-clipped": { label: "Never clears, clipped to 24 months", state: { status: "ok", projection: DEBT_RISES_NEVER_CLEARS } },
  "empty":         { label: "No card carries a balance",          state: { status: "ok", projection: [] } },
  "error":         { label: "Fetch failed",                       state: { status: "error" } },
  "loading":       { label: "Loading",                            state: { status: "loading" } },
};

export const DEBT_STATE_ORDER = ["reaches-zero", "rises-clipped", "empty", "error", "loading"];
