// Pace reading for an aim (G242). An aim is a PACE CHECK, not a budget: it
// never blocks and never judges. It says how this period is tracking against
// the pace the user chose. Passing an aim is not a financial risk, so no
// state here is ever styled red or amber; the words do the work, hedged.
//
// The figures are computed on the SERVER (backend/app/services/checkpoints.py
// aim_pace) and arrive on every aim as `pace`, so the Spend rows, the hub, the
// Mirror and Penny's nudge all read one number. The local rule below is only
// the fallback for a response that predates the field (a stale cache) and for
// fixtures; the backend test and check:g242-aims pin the two to the same table.
import type { Checkpoint } from "@/lib/api";

export type AimPaceState = "on" | "under" | "likely" | "past";

export interface AimPace {
  state: AimPaceState;
  /** Short lower-case phrase for a sentence: "on pace". */
  phrase: string;
  /** Fraction of the period elapsed, 0 to 1. */
  elapsedFraction: number;
  /** Where an even pace would be today, in pounds. */
  paceToday: number;
  /** Fraction of the aim spent so far, capped at 1 for drawing. */
  spentFraction: number;
}

const PHRASE: Record<AimPaceState, string> = {
  on: "on pace",
  under: "under pace",
  likely: "likely to pass your aim",
  past: "past your aim",
};

export function aimPace(aim: Pick<Checkpoint, "aim_amount" | "spent_so_far" | "days_left" | "pace">, periodDays: number): AimPace {
  if (aim.pace) {
    return {
      state: aim.pace.state,
      phrase: aim.pace.phrase,
      elapsedFraction: aim.pace.elapsed_fraction,
      paceToday: aim.pace.pace_today,
      spentFraction: aim.pace.spent_fraction,
    };
  }
  const total = Math.max(1, periodDays);
  const left = Math.min(Math.max(0, aim.days_left), total);
  const elapsed = Math.max(1, total - left);
  const frac = Math.min(1, elapsed / total);
  const amount = Math.max(1, aim.aim_amount);
  const paceToday = amount * frac;
  const spentFraction = Math.min(1, Math.max(0, aim.spent_so_far / amount));
  let state: AimPaceState = "on";
  if (aim.spent_so_far >= amount) state = "past";
  // Too early in the period to project honestly: say "on pace" rather than guess.
  else if (frac >= 0.25 && aim.spent_so_far / frac > amount * 1.05) state = "likely";
  else if (aim.spent_so_far <= paceToday * 0.85) state = "under";
  return { state, phrase: PHRASE[state], elapsedFraction: frac, paceToday, spentFraction };
}
