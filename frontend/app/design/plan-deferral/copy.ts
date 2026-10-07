import { GOAL, deferMath, gbp } from "./fixtures";

// All user-facing copy for the G228 proposals. British English, no em dashes,
// no exclamation marks, hedged. Rewritten to DESIGN.md from Astra's drafts.

const m = deferMath(50);

export const COPY = {
  introTitle: "Easing a goal plan for one period",
  introBody: "Proposals for G228, round 2. The payment card and the goal row are production components. The new card, the Planning control and the sheet are hand-authored for this round and nothing is saved. Set-asides and plans never trade cash: easing a plan is only about your cash this period, and putting it back is an ordinary edit on Planning.",

  // A: Home card
  aKind: "Goal plan",
  aHeadline: `Cash looks short this period`,
  aBody: `Easing ${GOAL.name} by up to ${gbp(GOAL.usual)} for this pay period could help, and the plan catches up later. You choose whether to keep the date or the usual amount.`,
  aReason: "No other account looks able to spare it.",
  aNote: "This changes the plan. No money is moved.",
  aAction: `Ease ${GOAL.name} this period`,
  aDismiss: `Dismiss ${GOAL.name} suggestion`,
  aCappedHeadline: `${GOAL.name} has been eased twice this year`,
  aCappedBody: "To stop a goal drifting, we hold further easing back for now. Its usual amount or date could be changed instead.",
  aCappedAction: `Review ${GOAL.name}`,

  // C: Planning control and Home pointer
  cPrompt: "Short this period?",
  cAction: `Ease ${GOAL.name}`,
  cCapped: "Eased twice in the last 12 months. Further easing is held back.",
  pointer: `Short this period? Review ${GOAL.name}'s plan`,

  // Deferred
  deferredLine: `${GOAL.name} is ${gbp(m.thisPeriod)} this period.`,
  deferredDetail: `Later periods about ${gbp(m.keepDatePer)}, should still land ${GOAL.targetLabel}.`,
  editPlan: "Edit plan",

  // Sheet
  sheetTitle: `Ease ${GOAL.name} this period`,
  sheetDescription: "This period only. Later periods catch up.",
  stepLabel: "Reduce this period by",
  stepHint: `In £${GOAL.stepPounds} steps, from £0 up to the whole ${gbp(GOAL.usual)}.`,
  skip: "Skip this period",
  planned: "Planned this period",
  choiceLegend: "Then catch up by",
  keepDateTitle: `Keep ${GOAL.targetLabel}`,
  keepAmountTitle: `Keep ${gbp(GOAL.usual)} each period`,
  workingTitle: "How we worked it out",
  roundingCaveat: "Production rounds slices up to £5, so the shipped figure will be the engine's.",
  noBank: "This changes your plan, not a bank payment.",
  limits: (used: number) => `Eased ${used} of ${GOAL.maxEasedPer12Months} times in the last 12 months. Later periods stay within a quarter of the usual ${gbp(GOAL.usual)}, which is ${gbp(Math.round(GOAL.usual * 1.25))}.`,
  coveredNote: "A move from Savings looks able to cover your cash this period. You can still ease Japan if you would rather.",
  cancel: "Cancel",
  save: "Save plan change",
  auditHeading: "Note we will add to the goal",
  audit: (reduce: number, keep: "date" | "amount") => {
    const x = deferMath(reduce);
    return keep === "date"
      ? `7 Oct 2026. This period's plan reduced by ${gbp(reduce)}, from ${gbp(GOAL.usual)} to ${gbp(x.thisPeriod)}. Kept ${GOAL.targetLabel}: about ${gbp(x.keepDatePer)} a period after this. No money moved.`
      : `7 Oct 2026. This period's plan reduced by ${gbp(reduce)}, from ${gbp(GOAL.usual)} to ${gbp(x.thisPeriod)}. Kept ${gbp(GOAL.usual)} a period: should land ${x.landsLabel}. No money moved.`;
  },

  // Preview-only annotations
  coveredAnnotation: "A safe move covers the whole gap, so the Home brief shows nothing new for the goal.",
};
