// Pure, framework-free derivations behind each screen's Penny screen
// context (B39, 2026-09-14 — see components/PennySheetProvider.tsx's
// `PennyScreenView` doc comment for the feature this belongs to).
//
// Kept in a plain .ts module, no JSX, DELIBERATELY: every function here is
// called from BOTH a screen's own render (components/SafeToSpendCard.tsx,
// app/components/SpendPage.tsx, app/planning/PlanningPage.tsx) and that
// same screen's `setPennyScreenView` publish effect, so the figure actually
// rendered and the figure Penny can quote back can never come from two
// separate computations — that agreement is the entire point of B39. A
// second reason this lives outside any component file: Node's
// `--experimental-strip-types` (used by this repo's existing
// framework-free `.test.mjs` scripts, see scripts/preferences-version.test.mjs)
// only strips TYPES, it cannot parse a .tsx file's JSX — so a pure .ts
// module is also what makes `scripts/penny-screen-views.test.mjs` possible
// without pulling in a full component-testing framework this repo doesn't
// otherwise have.
import type { SafeToSpend, SpendVerdict, PennyScreenView } from "./api";

export function zeroSafe(value: number): number {
  return Math.abs(value) < 1 ? 0 : value;
}

/** £ format matching SafeToSpendCard.tsx's own `fmt` (no decimals, en-GB
 * grouping) — duplicated rather than imported so this module has zero
 * dependency on any component file (see the module doc comment above on
 * why that matters for the plain-Node test). Both call sites are one-line
 * and trivially eyeballed against each other; SafeToSpendCard.tsx's own
 * `fmt` is the one actually rendered, this is only for the figure string
 * published into Penny's view. */
function fmtGbp(value: number): string {
  return `£${Math.abs(value).toLocaleString("en-GB", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

export type SafeToSpendHeadline = {
  state: "comfortable" | "tight" | "short";
  stateLabel: string;
  isCardsUnconfirmedShort: boolean;
  heroAmount: number;
  paydayLabel: string;
};

/** Home's Safe-to-Spend hero figure/status word/payday label — the exact
 * maths SafeToSpendCard.tsx's own render uses for its hero figure and
 * status chip. */
export function deriveSafeToSpendHeadline(data: Extract<SafeToSpend, { status: "ok" }>): SafeToSpendHeadline {
  const freeAmount = zeroSafe(data.safe_to_spend);
  const cashRunway = data.safe_to_spend_cash == null ? freeAmount : zeroSafe(data.safe_to_spend_cash);
  const isCardsUnconfirmedShort = data.state === "short" && data.short_reason === "cards_unconfirmed";
  const state: "comfortable" | "tight" | "short" =
    data.state === "short" && !data.short_reason && freeAmount > -1 ? "comfortable" : data.state;
  const stateLabel = state === "comfortable" ? "On track" : state === "tight" ? "Tight" : isCardsUnconfirmedShort ? "Check card bill" : "Short";
  const heroAmount = state === "short" ? (isCardsUnconfirmedShort ? 0 : Math.abs(cashRunway)) : freeAmount;

  const paydayDate = new Date(data.next_payday);
  paydayDate.setHours(0, 0, 0, 0);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const daysAway = Math.round((paydayDate.getTime() - today.getTime()) / 86400000);
  const paydayLabel = daysAway <= 0 ? "today" : daysAway === 1 ? "tomorrow" : daysAway < 7
    ? new Date(data.next_payday).toLocaleDateString("en-GB", { weekday: "long" })
    : new Date(data.next_payday).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });

  return { state, stateLabel, isCardsUnconfirmedShort, heroAmount, paydayLabel };
}

/** Home's published `PennyScreenView` for the Safe-to-Spend card. `hidden`
 * mirrors the card's own `hideNetWorth`/`preferencesReady` gate: while
 * balances are hidden on screen, figures are OMITTED here too (not merely
 * masked) — this view rides into a model prompt, and the user's own choice
 * to hide a balance on screen should not be worked around by a different
 * door onto the same number. The status word (comfortable/tight/short)
 * still publishes: it is never blurred on screen either. */
export function buildSafeToSpendView(
  data: Extract<SafeToSpend, { status: "ok" }>,
  opts: { hidden: boolean },
): PennyScreenView {
  const headline = deriveSafeToSpendHeadline(data);
  return {
    route: "/",
    scope: `Until payday, ${headline.paydayLabel}`,
    verdict: headline.stateLabel,
    figures: opts.hidden ? [] : [{
      key: "safe_to_spend",
      label: headline.state === "short" && !headline.isCardsUnconfirmedShort ? "Short before payday" : "Safe to spend",
      value: fmtGbp(headline.heroAmount),
    }],
    asOf: data.last_synced ?? new Date().toISOString(),
  };
}

/** Spend's period-view headline — `pills`/`reading`/`period` are already
 * fully server-computed (GET /spend/verdict), so there is no arithmetic
 * here at all, only mapping onto the shared `PennyScreenView` shape. The
 * `reading` sentence is passed through verbatim as `verdict`: it is the
 * backend's own phrased judgement of the period (rule 2/6 in
 * penny_agent.py's system prompt — Penny reproduces a server verdict, she
 * never re-derives one), not something this function composes. */
export function buildSpendPeriodView(verdict: SpendVerdict): PennyScreenView {
  const { pills, period } = verdict;
  const start = new Date(`${period.start}T12:00:00`);
  const end = new Date(`${period.end}T12:00:00`);
  const fmtDay = (d: Date) => Number.isNaN(d.getTime()) ? null : d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
  const startLabel = fmtDay(start);
  const endLabel = fmtDay(end);
  const scope = startLabel && endLabel
    ? (period.closed ? `${startLabel} to ${endLabel}` : `${startLabel} to ${endLabel} (so far)`)
    : undefined;
  return {
    route: "/spend",
    ...(scope ? { scope } : {}),
    verdict: verdict.reading,
    figures: [
      { key: "spend_out", label: "Out", value: fmtGbp(pills.spent) },
      { key: "spend_in", label: "In", value: fmtGbp(pills.income) },
      { key: "spend_net", label: "Net", value: `${pills.net < 0 ? "−" : "+"}${fmtGbp(pills.net)}` },
    ],
    asOf: new Date().toISOString(),
  };
}

export type UpcomingRunwayInput = {
  runway: number;
  runwayStatus: "short" | "left" | "even";
  isCalendarMonth: boolean;
};

/** Upcoming's runway hero — mirrors PlanningPage.tsx's own
 * `runway`/`runwayStatus`/`isCalendarMonth` locals exactly (that file
 * computes them inline mid-render inside a large simulation and hands the
 * three results here rather than this function re-deriving them, since the
 * simulation itself depends on a lot of page-only state — see that file's
 * own comment on its Penny-view publish ref for why). */
export function buildUpcomingRunwayView(input: UpcomingRunwayInput): PennyScreenView {
  const { runway, runwayStatus, isCalendarMonth } = input;
  const label = runwayStatus === "short" ? "Short" : runwayStatus === "even" ? "Exactly covered" : "Left over";
  return {
    route: "/upcoming",
    scope: isCalendarMonth ? "Projected at month end" : "Projected at payday",
    verdict: label,
    figures: [{
      key: "runway",
      label: isCalendarMonth ? "Projected at month end" : "Projected at payday",
      value: `${runwayStatus === "short" ? "−" : ""}${fmtGbp(runway)}`,
    }],
    asOf: new Date().toISOString(),
  };
}
