import generated from "./generated-fixtures.json";

export type PreviewState = "ready" | "future" | "loading" | "unavailable" | "hidden" | "long" | "paused" | "stale" | "empty";

export type PlanFixture = {
  id: string;
  name: string;
  scheduledLine: string;
  progressLine: string;
  progressFigure?: string;
  targetQualifier?: string;
  offerDeadline?: string;
  caution?: boolean;
  progressAria: string;
  progressPercent: number;
  progressWidth: string;
  progressTone?: "onPace" | "behind" | "neutral";
  markerPercent: number;
  markerLeft: string;
  markerLabel: string;
  status: string;
  detailIntro: string;
  evidence: readonly { label: string; value: string }[];
  unavailable?: boolean;
};

// Generated through the real pure backend calculator, with fictional inputs.
function readGeneratedPlan(row: Omit<PlanFixture, "progressTone"> & { progressTone: string }): PlanFixture {
  const tone = row.progressTone;
  if (tone !== "onPace" && tone !== "behind" && tone !== "neutral") {
    throw new Error("Unknown preview progress tone");
  }
  return { ...row, progressTone: tone };
}

const onTrack = readGeneratedPlan(generated.rows.onTrack);
const shortfall = readGeneratedPlan(generated.rows.shortfall);
const futureFirst = readGeneratedPlan(generated.rows.futureFirst);
const futureSecond = readGeneratedPlan(generated.rows.futureSecond);

const unavailablePlan: PlanFixture = {
  id: "unavailable",
  name: "Rewards card repayment plan",
  scheduledLine: "£180 each pay period",
  progressLine: "Progress unavailable",
  progressAria: "Progress unavailable",
  progressPercent: 0,
  progressWidth: "0%",
  markerPercent: 0,
  markerLeft: "0%",
  markerLabel: "",
  status: "Offer progress needs clearer balance evidence.",
  detailIntro: "The plan remains saved. Progress is withheld until the balance evidence is clear enough to assess the offer.",
  evidence: [
    { label: "Plan", value: "£180 each pay period" },
    { label: "Card balance owed", value: generated.unavailableCardBalance },
    { label: "Offer evidence", value: "More than one active 0% offer" },
    { label: "Progress", value: "Unavailable" },
  ],
  unavailable: true,
};

const longName: PlanFixture = {
  ...onTrack,
  id: "long-name",
  name: "Joint household and travel rewards card repayment plan for the card we use for annual insurance and rail travel",
};

export const PREVIEW_STATES: Record<Exclude<PreviewState, "hidden">, { debtTotal: string | null; plans: readonly PlanFixture[] }> = {
  ready: { debtTotal: generated.debtTotals.ready, plans: [onTrack, shortfall, unavailablePlan] },
  future: { debtTotal: generated.debtTotals.future, plans: [futureFirst, futureSecond, unavailablePlan] },
  loading: { debtTotal: null, plans: [] },
  unavailable: { debtTotal: null, plans: [] },
  long: { debtTotal: generated.debtTotals.ready, plans: [longName, shortfall, unavailablePlan] },
  paused: { debtTotal: generated.debtTotals.ready, plans: [readGeneratedPlan(generated.rows.paused), shortfall, unavailablePlan] },
  stale: { debtTotal: generated.debtTotals.ready, plans: [] },
  empty: { debtTotal: "£0", plans: [] },
};

export const GOALS = [
  { name: "Summer break", detail: "£640 of £2,400 · 7 left" },
  { name: "Daily Challenge", detail: "£61 of £871 · ends 16 Jan 2027" },
] as const;

export const DAILY_CHALLENGE_NOTE = "Fictional schedule context only. It illustrates a changing daily goal and does not claim that a live user record was corrected.";
