import { derivePaceCopy, type PaceCopyInput } from "./copyModel";

export type PaceCopyState = "over" | "under" | "level" | "balanced" | "unplaced" | "long" | "none" | "baseline";

export type PaceCopyFixture = PaceCopyInput & {
  label: string;
  description: string;
};

export const PACE_COPY_FIXTURES: Record<PaceCopyState, PaceCopyFixture> = {
  over: {
    label: "Above usual",
    description: "Named categories and other differences both add to an above-usual pace.",
    daysElapsed: 13,
    actualOut: 4917,
    usualByNow: 3616,
    namedCategories: ["Bills", "Transport", "Health"],
    namedExcess: 1271,
    unresolvedTotal: 0,
  },
  under: {
    label: "Below usual",
    description: "Two categories are running high, but the period remains below usual overall.",
    daysElapsed: 20,
    actualOut: 3509,
    usualByNow: 4010,
    namedCategories: ["Eating Out", "Entertainment"],
    namedExcess: 111,
    unresolvedTotal: 0,
  },
  level: {
    label: "In line",
    description: "Named changes cancel out exactly at the current point in the pay period.",
    daysElapsed: 13,
    actualOut: 2500,
    usualByNow: 2500,
    namedCategories: ["Groceries"],
    namedExcess: 85,
    unresolvedTotal: 0,
  },
  balanced: {
    label: "No balancing amount",
    description: "The named category difference exactly explains the overall difference.",
    daysElapsed: 13,
    actualOut: 2585,
    usualByNow: 2500,
    namedCategories: ["Groceries"],
    namedExcess: 85,
    unresolvedTotal: 0,
  },
  unplaced: {
    label: "Unplaced payments",
    description: "The balancing amount can include payments which have not been categorised yet.",
    daysElapsed: 13,
    actualOut: 4917,
    usualByNow: 3616,
    namedCategories: ["Bills", "Transport", "Health"],
    namedExcess: 1271,
    unresolvedTotal: 1294,
  },
  long: {
    label: "Long names",
    description: "Long category names remain readable without changing the arithmetic.",
    daysElapsed: 19,
    actualOut: 6140,
    usualByNow: 5460,
    namedCategories: ["Home improvements and furnishings", "Health, fitness and wellbeing", "Travel and weekends away"],
    namedExcess: 1040,
    unresolvedTotal: 0,
  },
  none: {
    label: "No named changes",
    description: "A comparable pace exists, but no category is notable enough to name.",
    daysElapsed: 13,
    actualOut: 2480,
    usualByNow: 2510,
    namedCategories: [],
    namedExcess: 0,
    unresolvedTotal: 0,
  },
  baseline: {
    label: "Still learning",
    description: "Thin history means no usual-by-now figure and no pace claim.",
    daysElapsed: 4,
    actualOut: 480,
    usualByNow: null,
    namedCategories: [],
    namedExcess: 0,
    unresolvedTotal: 0,
  },
};

export const PACE_COPY_STATES = Object.keys(PACE_COPY_FIXTURES) as PaceCopyState[];

export function fixtureCopy(state: PaceCopyState) {
  return derivePaceCopy(PACE_COPY_FIXTURES[state]);
}
