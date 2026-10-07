import type { Commitment } from "@/lib/api";

// G228 fixtures and maths. No user data. The goal mirrors the real Commitment
// fields (amount, progress, remaining, periods_left, per_period_slice,
// target_date). Proposal only: nothing here is wired to the backend.

export type DeferVariant = "a" | "b" | "c";
export type DeferState = "eligible" | "capped" | "deferred" | "covered";

export const GOAL = {
  name: "Japan",
  usual: 80, // per_period_slice
  periodsLeft: 25, // this period included
  remaining: 2000, // remaining before this period
  targetLabel: "Nov 2028",
  targetMonth: "2028-11",
  gap: 50, // cash gap this period, in pounds
  periodEnd: "31 Oct",
  stepPounds: 5,
  /** Proposed limits. */
  maxEasedPer12Months: 2,
  easedUsed: 1, // eligible and deferred states; the capped state uses easedUsedCapped
  easedUsedCapped: 2,
  catchUpCeilingPct: 125,
};

export const goalCommitment: Commitment = {
  id: "goal-japan",
  name: GOAL.name,
  amount: 2500,
  target_date: "2028-11-01",
  funding_account_id: "japan-pot",
  funding_account_name: "Japan pot",
  source: "manual",
  status: "active",
  progress: 500,
  remaining: GOAL.remaining,
  periods_left: GOAL.periodsLeft,
  per_period_slice: GOAL.usual,
  period_label: "monthly",
  on_track: true,
  shared_pot_goals: [],
} as unknown as Commitment;

export const gbp = (v: number) => `£${v.toLocaleString("en-GB", { minimumFractionDigits: Number.isInteger(v) ? 0 : 2, maximumFractionDigits: 2 })}`;

function addMonths(ym: string, n: number) {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return new Intl.DateTimeFormat("en-GB", { month: "short", year: "numeric", timeZone: "UTC" }).format(d);
}

/**
 * Recalculation rule. Round displayed contributions UP to the whole pound so
 * the goal never lands short; the final contribution takes the remainder so it
 * never overfunds. (Production's own slice steps in whole £5 via _ceil5; the
 * sheet must show whatever slice the engine returns, an open question for the
 * build round.)
 */
export function deferMath(reduce: number, g = GOAL) {
  const thisPeriod = g.usual - reduce;
  const after = g.remaining - thisPeriod;
  const later = g.periodsLeft - 1;
  const keepDatePer = Math.ceil(after / later);
  const keepDateFinal = Math.max(0, after - keepDatePer * (later - 1));
  const keepAmountPeriods = Math.ceil(after / g.usual);
  const periodsLater = Math.max(0, keepAmountPeriods - later);
  const keepAmountFinal = after - g.usual * (keepAmountPeriods - 1);
  return {
    reduce,
    thisPeriod,
    after,
    later,
    exactPer: after / later,
    keepDatePer,
    keepDateFinal,
    keepAmountPeriods,
    periodsLater,
    keepAmountFinal,
    landsLabel: addMonths(g.targetMonth, periodsLater),
    ceilingPer: Math.round((g.usual * g.catchUpCeilingPct) / 100),
    withinCeiling: keepDatePer <= (g.usual * g.catchUpCeilingPct) / 100,
  };
}
