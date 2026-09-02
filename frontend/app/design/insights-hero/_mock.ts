// TEMPORARY PREVIEW DATA — delete with the preview routes.
//
// Pure-data fixtures for /design/insights-hero. Kevin picked Variant B,
// "Opportunity leads" (the hero is the total identified across currently
// open insights, honestly labelled as an estimate, with verified savings
// as a smaller earned chip beside it) — this file now only carries the
// four ESTIMATE-COVERAGE states that variant has to survive, not the A/B/C
// comparison.
//
// Why coverage states, not just "more data": the insight generation prompt
// (backend/app/routers/savings_insights.py, hard_rules #5, ~line 715)
// deliberately allows savings_estimate to be null — it may ONLY be a figure
// quoted from a search result or the arithmetic difference of two stated
// figures, and null is "expected and common, not a failure". So a real
// user's open insights are rarely 100% costed. A hero that always shows a
// confident total (as the first draft did) would silently misrepresent
// coverage the moment even one open idea has no number.
//
// Shape mirrors GET /value-delivered (backend/app/routers/analytics.py
// ~line 3757), which is gaining three fields for exactly this case:
// open_monthly_saving (sum of ONLY the open insights that have a derivable
// estimate), open_insights (count of all currently-open insights, costed
// or not), open_with_estimate (how many of those have a number). breakdown
// / verified_monthly_saving continue to describe money already banked.
// liveInsights below is additional context not in that payload — it
// stands in for GET /savings-insights, the open cards still sitting on the
// tab, each of which may or may not carry an estimate.

export type LiveInsight = {
  title: string;
  categoryHex: string;
  /** Raw estimate string as shown on the insight card itself, e.g.
   *  "~£15/mo", "up to £18/mo" — null when no derivable estimate exists
   *  (hard_rules #5: no stated figure, no two figures to subtract). */
  estimateLabel: string | null;
  /** Parsed monthly figure backing that label, for the opportunity total.
   *  null in lockstep with estimateLabel. */
  estimateMonthly: number | null;
};

export type InsightsHeroState = {
  key: "full" | "partial" | "none" | "done";
  label: string;
  note: string;
  verifiedMonthlySaving: number;
  /** How many insights have, over time, actually had a payment verified
   *  stopped — used only for the "done" state's achievement copy. */
  insightsActedOn: number;
  liveInsights: LiveInsight[];
  /** Mirrors GET /value-delivered's open_insights: every currently-open
   *  insight, costed or not. */
  openInsights: number;
  /** Mirrors open_with_estimate: how many of those have a derivable
   *  number. */
  openWithEstimate: number;
  /** Mirrors open_monthly_saving: the sum of ONLY the ones with a number —
   *  never a total over all open insights, that would silently claim
   *  coverage the data doesn't have. */
  openMonthlySaving: number;
};

// Derives the three open_* fields from a liveInsights array so the mock
// can't drift out of sync with what it displays underneath the hero.
function withOpenTotals(
  base: Omit<InsightsHeroState, "openInsights" | "openWithEstimate" | "openMonthlySaving">
): InsightsHeroState {
  const withEstimate = base.liveInsights.filter((i) => i.estimateMonthly != null);
  return {
    ...base,
    openInsights: base.liveInsights.length,
    openWithEstimate: withEstimate.length,
    openMonthlySaving: Math.round(withEstimate.reduce((s, i) => s + (i.estimateMonthly ?? 0), 0) * 100) / 100,
  };
}

export const STATES: InsightsHeroState[] = [
  withOpenTotals({
    key: "full",
    label: "Full coverage",
    note: "4 open ideas, all 4 have a number",
    verifiedMonthlySaving: 34.98,
    insightsActedOn: 2,
    liveInsights: [
      {
        title: "Two music subscriptions overlap",
        categoryHex: "#22d3ee",
        // Estimates are rounded to whole pounds in their display label —
        // stating an estimate to the penny (£9.99) claims a precision the
        // figure doesn't have (DESIGN.md "label estimates honestly"). The
        // underlying estimateMonthly stays granular for summation, only
        // the shown text rounds.
        estimateLabel: "~£10/mo",
        estimateMonthly: 9.99,
      },
      {
        title: "Gym membership, barely used since June",
        categoryHex: "#2dd4bf",
        estimateLabel: "~£25/mo",
        estimateMonthly: 24.99,
      },
      {
        title: "Broadband renewal is worth a call",
        // Deliberately not bills' usual rose (#fb7185) — rose sits close
        // enough to Risk Red that colouring a savings-tab row with it
        // works against The Red Is Risk Rule, even as a small identity dot.
        categoryHex: "#a3e635",
        estimateLabel: "up to £15/mo",
        estimateMonthly: 15,
      },
      {
        title: "Car insurance renewal is due, worth a quote",
        categoryHex: "#818cf8",
        estimateLabel: "up to £18/mo",
        estimateMonthly: 18,
      },
    ],
  }),

  withOpenTotals({
    key: "partial",
    label: "Partial coverage",
    note: "4 open ideas, only 2 have a number",
    verifiedMonthlySaving: 24.99,
    insightsActedOn: 1,
    liveInsights: [
      {
        title: "Streaming bundle works out cheaper combined",
        categoryHex: "#22d3ee",
        estimateLabel: "~£6/mo",
        estimateMonthly: 6,
      },
      {
        title: "Car insurance renewal is due, worth a quote",
        categoryHex: "#818cf8",
        estimateLabel: "up to £18/mo",
        estimateMonthly: 18,
      },
      {
        // No stated principal, no two comparable prices to subtract — per
        // hard_rules #5 the estimate must be null, not a guess.
        title: "Broadband contract has rolled onto its default rate",
        categoryHex: "#a3e635",
        estimateLabel: null,
        estimateMonthly: null,
      },
      {
        title: "Mobile plan looks pricier than newer deals out there",
        categoryHex: "#60a5fa",
        estimateLabel: null,
        estimateMonthly: null,
      },
    ],
  }),

  withOpenTotals({
    key: "none",
    label: "No coverage",
    note: "4 open ideas, none costed yet",
    verifiedMonthlySaving: 0,
    insightsActedOn: 0,
    liveInsights: [
      {
        title: "Streaming bundle might be worth combining",
        categoryHex: "#22d3ee",
        estimateLabel: null,
        estimateMonthly: null,
      },
      {
        title: "Insurance renewal is coming up next month",
        categoryHex: "#818cf8",
        estimateLabel: null,
        estimateMonthly: null,
      },
      {
        title: "Grocery spend has crept up over the last few weeks",
        categoryHex: "#34d399",
        estimateLabel: null,
        estimateMonthly: null,
      },
      {
        title: "Two subscriptions look similar, worth comparing",
        categoryHex: "#f472b6",
        estimateLabel: null,
        estimateMonthly: null,
      },
    ],
  }),

  withOpenTotals({
    key: "done",
    label: "Nothing open",
    note: "Everything acted on, nothing left open",
    verifiedMonthlySaving: 142.5,
    insightsActedOn: 5,
    liveInsights: [],
  }),
];

/** Exact, to the penny — VERIFIED money only, matched against what actually
 * happened. Never use this for an estimate (see moneyEstimate below). */
export function money(n: number): string {
  const abs = Math.abs(n).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return n < 0 ? `−£${abs}` : `£${abs}`;
}

/** Rounded to the nearest whole pound with a leading "~" — an ESTIMATE,
 * never stated to the penny. Any sum of estimates (an opportunity total,
 * a "plus £X identified" line) must round through this, not money(), or
 * the figure claims a precision it doesn't have. */
export function moneyEstimate(n: number): string {
  const rounded = Math.round(Math.abs(n)).toLocaleString("en-GB");
  return n < 0 ? `~−£${rounded}` : `~£${rounded}`;
}
