// Static fixtures for the Insights-shape redesign preview (/design/insights-shape).
// Fictional numbers, NOT real user data. Owner brief 2026-09-02: money has a few
// jobs, and the proportion between them matters more than any line item — describe
// the user's own shape, never grade it (see BEHAVIOURS.md's "The Mirror Is Not A
// Score" named rule, same discipline applied here).

export const PAY_PERIOD_LABEL = "Aug 28 to Sep 27";
export const TAKE_HOME = 3400;

export interface JobShare {
  key: "fixed" | "moved" | "free" | "left";
  /** Long form, used in the Variant A legend. */
  label: string;
  /** Short form, used under Variant C's ribbon and in tile headers. */
  shortLabel: string;
  amount: number;
  pct: number;
  /** Solid Tailwind fill, for bar segments and legend dots. */
  bgClass: string;
  /** Tailwind text-colour (sets `color`), consumed via `currentColor` by the
   *  sparkline stroke so it never needs a second hex source of truth. */
  textClass: string;
  /** Six pay periods, percent share of take-home, oldest to newest. */
  trend: number[];
}

// Colour semantics are fixed across all three variants and named in every
// legend: Fixed = slate-600 (dark: slate-400), Moved = emerald-500,
// Free = sky-500, Left over = slate-200 (dark: slate-700). No red, no amber,
// no indigo/violet — these cards are informational, not Penny, so none of
// them borrow a grading or advice colour.
export const JOBS: JobShare[] = [
  {
    key: "fixed",
    label: "Fixed (bills, debt, rent)",
    shortLabel: "Fixed",
    amount: 2074,
    pct: 61,
    bgClass: "bg-slate-600 dark:bg-slate-400",
    textClass: "text-slate-600 dark:text-slate-400",
    trend: [57, 58, 59, 60, 60, 61],
  },
  {
    key: "moved",
    label: "Moved to savings",
    shortLabel: "Moved",
    amount: 340,
    pct: 10,
    bgClass: "bg-emerald-500",
    textClass: "text-emerald-500",
    trend: [8, 8, 9, 10, 10, 10],
  },
  {
    key: "free",
    label: "Free spending",
    shortLabel: "Free",
    amount: 816,
    pct: 24,
    bgClass: "bg-sky-500",
    textClass: "text-sky-500",
    trend: [29, 28, 27, 25, 25, 24],
  },
  {
    key: "left",
    label: "Left over",
    shortLabel: "Left",
    amount: 170,
    pct: 5,
    bgClass: "bg-slate-200 dark:bg-slate-700",
    textClass: "text-slate-400 dark:text-slate-500",
    // Not given directly in the brief; the remainder of the other three
    // trends each period, which lands on the stated final 5% and reads as a
    // believable mirror image of the Fixed climb.
    trend: [6, 6, 5, 5, 5, 5],
  },
];

export const VERDICT_SENTENCE =
  "Of every £100 you take home, £61 is spoken for before you choose anything. £24 is yours to spend freely.";

export const TREND_LINE =
  "Fixed share has crept up 4 points over six pay periods, mostly bills, not new subscriptions.";

export const HERO_LABEL = "YOUR MONEY SHAPE · THIS PAY PERIOD";

// ── "What works for you" card ───────────────────────────────────────────

export const WHAT_WORKS_LABEL = "WHAT WORKS FOR YOU · FROM YOUR LAST 6 PAY PERIODS";

export const WHAT_WORKS_HEADLINE =
  "Pay periods where you moved money to savings in the first week ended with cash left over 4 times out of 5.";

export const WHAT_WORKS_THIN_HEADLINE = "Not enough history yet.";
export const WHAT_WORKS_THIN_LINE = "This needs four pay periods of data. You have two.";

export interface EvidenceRow {
  period: string;
  timing: "early" | "late";
  cash: number; // signed — negative renders with the − currency minus
}

export const WHAT_WORKS_EVIDENCE: EvidenceRow[] = [
  { period: "Mar", timing: "early", cash: 212 },
  { period: "Apr", timing: "late", cash: -40 },
  { period: "May", timing: "early", cash: 95 },
  { period: "Jun", timing: "early", cash: 301 },
  { period: "Jul", timing: "late", cash: 18 },
  { period: "Aug", timing: "early", cash: 170 },
];

const MINUS = "−"; // matches MoneyText / AccountRow's unicode minus

/** Formats a signed cash figure as a MoneyText-recognisable token, e.g.
 *  "+£212" or "−£40" (unicode minus, never a hyphen). */
export function formatCash(n: number): string {
  const abs = `£${Math.abs(Math.round(n)).toLocaleString("en-GB")}`;
  return n < 0 ? `${MINUS}${abs}` : `+${abs}`;
}

// ── Reference shapes row ────────────────────────────────────────────────

export const REFERENCE_SHAPES = ["Conscious Spending Plan", "50/30/20", "Pay yourself first"];
