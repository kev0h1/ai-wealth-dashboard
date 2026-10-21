import { deriveSafeToSpendHeadline } from "@/lib/pennyScreenViews";
import { cardPropsFor, type Scenario } from "./fixtures";

export type StatusTone = "risk" | "watch" | "good" | "neutral";
export type PreviewStatus = { tone: StatusTone; label: string };
export type StatePresentation = {
  home: PreviewStatus;
  upcoming: PreviewStatus;
  explanation: string;
  homeEyebrow?: string;
  homeCaption?: string;
  signedHome: boolean;
  upcomingQualifierTone: StatusTone;
};

/** Presentation for synthetic examples only. No production verdict, number,
 * payment schedule or financial calculation is changed by this proposal.
 * A cash-timeline gap outranks a positive ending balance. Optional reserves
 * and the safety buffer cannot, on their own, establish payment risk. */
export function statePresentationFor(scenario: Scenario): StatePresentation {
  const { data, syncing, loading, error } = cardPropsFor(scenario);
  const neutral = (label: string): StatePresentation => ({
    home: { tone: "neutral", label }, upcoming: { tone: "neutral", label: "No current verdict" },
    explanation: "A current forecast is not available. No risk or on-track colour is asserted while the figures are being checked.",
    signedHome: false, upcomingQualifierTone: "neutral",
  });
  if (loading) return neutral("Loading");
  if (error) return neutral("Unavailable");
  if (!data || data.status !== "ok") return neutral("Not enough history");
  if (syncing || data.calculation_status === "syncing") return neutral("Last known amount");
  if (data.calculation_status === "degraded") return neutral("Incomplete calculation");

  const headline = deriveSafeToSpendHeadline(data);
  const cash = data.safe_to_spend_cash ?? data.safe_to_spend;
  const lowest = data.lowest_projected_balance;
  if (lowest == null || !Number.isFinite(lowest)) return neutral("Check forecast");
  const end = typeof data.spendable_now === "number"
    ? data.spendable_now + data.income_before_payday - data.bills_total
      - (data.allocations_reserved ?? 0) - (data.commitments_reserved ?? 0)
    : null;
  if (lowest != null && lowest < 0) return {
    home: { tone: "risk", label: "Short" },
    upcoming: { tone: "risk", label: end != null && end >= 0 ? "Earlier gap" : "Short" },
    homeEyebrow: "Shortfall before payday", signedHome: cash < 0 && !headline.isCardsUnconfirmedShort,
    upcomingQualifierTone: end != null && end < 0 ? "risk" : "neutral",
    explanation: end != null && end >= 0
      ? "Cash runs short before the later income arrives, even though the payday balance is positive. Both red indicators flag the earlier payment gap."
      : "The dated cash forecast falls below zero before payday. Both red indicators flag genuine payment risk; the signed money figures stay in ink.",
  };
  if (headline.isCardsUnconfirmedShort) return {
    home: { tone: "watch", label: "Check card bill" }, upcoming: { tone: "watch", label: "Check card bill" },
    signedHome: false, upcomingQualifierTone: "neutral",
    explanation: "The card repayment needs checking. Home keeps its existing £0 available reading and separate signed safety calculation. This is not a confirmed cash shortfall.",
  };
  if (headline.plansOnly || (end != null && end < 0)) return {
    home: { tone: "watch", label: "Plans gap" }, upcoming: { tone: "watch", label: "Plans gap" },
    homeEyebrow: "Short after plans", signedHome: cash < 0, upcomingQualifierTone: "watch",
    explanation: "Cash covers the bills in this example. The shortfall appears after reserving plans and envelopes, so both indicators are amber. Home’s buffer also reduces its figure; it is not deducted again from Upcoming.",
  };
  if (cash < 0) return {
    home: { tone: "watch", label: "Below buffer" }, upcoming: { tone: "watch", label: "Below buffer" },
    homeEyebrow: "Below your buffer", homeCaption: "below your safety buffer", signedHome: true, upcomingQualifierTone: "neutral",
    explanation: "The cash forecast stays above zero, but does not preserve the safety buffer. The amber indicators distinguish that caution from a payment shortfall.",
  };
  if (headline.state === "tight" || end === 0) return {
    home: { tone: "watch", label: end === 0 ? "No headroom" : "Tight" },
    upcoming: { tone: "watch", label: end === 0 ? "No headroom" : "Tight" },
    signedHome: false, upcomingQualifierTone: end === 0 ? "watch" : "neutral",
    explanation: end === 0
      ? "The cash forecast is exactly even. Nothing is missing, but there is no spare cash. Both indicators are amber and the amount stays £0."
      : "Cash is available, with limited room after commitments and Home’s buffer. Amber indicates caution; neither figure is coloured or described as a payment shortfall.",
  };
  if (headline.state === "comfortable" && end != null && end > 0) return {
    home: { tone: "good", label: "On track" }, upcoming: { tone: "good", label: "On track" },
    signedHome: false, upcomingQualifierTone: "good",
    explanation: "Both small indicators are green and both money figures are ink. Home shows cash available after its buffer; Upcoming shows the separate balance projected at payday.",
  };
  return neutral("Check forecast");
}
