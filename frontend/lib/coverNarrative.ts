import type { LastResort } from "./api";

/** G428: plain copy when current accounts cannot cover a shortfall alone. A
 * recommendation in words only: the app never moves money, and a savings
 * balance is never counted as spendable. Mirrors the engine's own wording
 * (backend split_cover_note) so every surface reads the same. */
export const UNCOVERED_OPTIONS = "You could edit a plan or skip a payment on Upcoming instead.";

/**
 * The G496 recommendation is deliberately strict at the UI boundary. An
 * incomplete cached payload must retain the existing, honest fallback rather
 * than presenting a link that cannot open a saved plan.
 */
export type LastResortReview = {
  planId: string;
  recordId: string;
  kind: "goal" | "set_aside";
  name: string;
  frees: number;
};

const usableText = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0;
const usableAmount = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value > 0;

/** Returns only the server's first, canonical plan option. No amounts are
 * combined or inferred here: `frees` is the backend's capped recommendation. */
export function firstLastResortReview(value: LastResort | null | undefined): LastResortReview | null {
  const option = value?.options?.[0];
  if (!option || !usableText(option.plan_id) || !usableText(option.record_id) || !usableText(option.name) || !usableAmount(option.remaining) || !usableAmount(option.frees) || option.frees > option.remaining) return null;
  if (option.kind !== "goal" && option.kind !== "set_aside") return null;
  const expectedPlanId = `${option.kind === "goal" ? "goal" : "allocation"}:${option.record_id}`;
  if (option.plan_id !== expectedPlanId) return null;
  return {
    planId: option.plan_id,
    recordId: option.record_id,
    kind: option.kind,
    name: option.name.trim(),
    frees: option.frees,
  };
}

export function lastResortReviewHref(review: LastResortReview): string {
  return review.kind === "goal"
    ? `/planning?goal=${encodeURIComponent(review.recordId)}`
    : `/upcoming?plan=${encodeURIComponent(review.planId)}`;
}

/** Formats the server-provided review amount without calculating a new one. */
export function lastResortReviewText(review: LastResortReview): string {
  const amount = review.frees.toLocaleString("en-GB", {
    minimumFractionDigits: Number.isInteger(review.frees) ? 0 : 2,
    maximumFractionDigits: 2,
  });
  const noun = review.kind === "goal" ? "goal" : "set-aside";
  return `${review.name} ${noun} could free up to £${amount}.`;
}

const pounds = (value: number) => `£${Math.round(value).toLocaleString("en-GB")}`;

export type CoverSplit = { currentAmount: number; savingsAmount: number; savingsName: string };

/** `uncovered` is what stays short after every suggested move (pounds). */
export function coverSplitSentence(split: CoverSplit, uncovered = 0): string {
  const open = uncovered > 0.5;
  const lead = split.currentAmount > 0 ? `Your other accounts can cover ${pounds(split.currentAmount)}. ` : "";
  // The name is a label used as is ("your Barclays savings"); never capitalised inside a sentence.
  const move = `A move of ${pounds(split.savingsAmount)} from ${split.savingsName}`;
  if (split.currentAmount > 0) {
    return open ? `${lead}${move} would cover more, but ${pounds(uncovered)} is still uncovered. ${UNCOVERED_OPTIONS}` : `${lead}${move} would cover the rest.`;
  }
  return open ? `${move} would cover part of it, but ${pounds(uncovered)} is still uncovered. ${UNCOVERED_OPTIONS}` : `${move} would cover it.`;
}

/** The plain line when suggested moves leave some of the gap uncovered and no savings is involved. */
export function uncoveredSentence(uncovered: number): string {
  return `${pounds(uncovered)} is still uncovered. ${UNCOVERED_OPTIONS}`;
}
