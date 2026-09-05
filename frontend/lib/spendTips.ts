// Pure derivations for the savings-tip signifiers shown on Spend's category
// list and the transactions page's collapsed tips line. Promoted unchanged
// in behaviour from the /design/spend-tips preview (fixtures.ts/shared.tsx)
// once the owner picked variant A (2026-09-05) — see DESIGN.md "Tips on
// Spend and the transactions page" for the copy rules this encodes: tips
// never add rows to Spend's category list, and a subline's count/figure
// signifier must never imply every tip is costed.

import type { SavingsInsight } from "@/lib/api";

/** Every READABLE tip for a given Spend category — state "fresh", matched
 *  on the backend's own `app_category` field. For an older payload that
 *  predates the `state` field, falls back to the same rule
 *  InsightsPage.tsx's own `heroOpen` uses for a missing state:
 *  `!verified_savings && !substituted`. Deliberately narrower than
 *  heroOpen otherwise — heroOpen also counts "quiet" as open, but a quiet
 *  card renders no title/body/estimate (InsightCard has nothing to show
 *  for it), so it is excluded here on purpose rather than opening a tip
 *  strip with no content. Never returns a verified/substituted/quiet tip;
 *  those are closed or silent states, not actionable tips. */
export function openTipsFor(category: string, insights: SavingsInsight[]): SavingsInsight[] {
  return insights.filter((t) => {
    if (t.app_category !== category) return false;
    if (t.state != null) return t.state === "fresh";
    return !t.verified_savings && !t.substituted;
  });
}

/** Sum of `savings_estimate_monthly` across exactly the tips passed in,
 *  whole pounds, single rounding, 0 when none of them carry an estimate. */
export function sumEstimates(tips: SavingsInsight[]): number {
  return Math.round(tips.reduce((s, t) => s + (t.savings_estimate_monthly ?? 0), 0));
}

/** The subline SUFFIX only, no leading separator and no payment count —
 *  callers prepend their own "{n} payment{s}" (and " · " when non-null)
 *  themselves. The figure must never read as if every tip listed is
 *  costed (a real risk once a category carries a mix of costed and
 *  uncosted tips):
 *    empty:        null                                    — nothing to say
 *    none costed:  "{n} tip{s}"                             — no figure at all
 *    all costed:   "{n} tip{s}, ~£{sum}/mo"                 — one clean figure
 *    some costed:  "{n} tips · ~£{sum}/mo from {k}"         — figure scoped to
 *                  the {k} tips it actually covers, never implied global
 */
export function tipSubline(tips: SavingsInsight[]): string | null {
  if (tips.length === 0) return null;
  const withEstimate = tips.filter((t) => t.savings_estimate_monthly != null);
  const tipWord = tips.length === 1 ? "tip" : "tips";
  const sum = sumEstimates(tips);
  if (withEstimate.length === 0) return `${tips.length} ${tipWord}`;
  if (withEstimate.length === tips.length) return `${tips.length} ${tipWord}, ~£${sum}/mo`;
  return `${tips.length} ${tipWord} · ~£${sum}/mo from ${withEstimate.length}`;
}

/** Same three-tier honesty rule as tipSubline above, reworded for the
 *  transactions page's own tips disclosure line, which carries the
 *  category name instead of a payment count (the payment count already
 *  lives in the filter chips above this line, this line's job is just
 *  "here is what's on the table for this category"):
 *    none costed:  "{n} tip{s} for {category}"
 *    all costed:   "{n} tip{s} for {category}, ~£{sum}/mo"
 *    some costed:  "{n} tips for {category} · ~£{sum}/mo from {k}"
 */
export function tipsLineText(category: string, tips: SavingsInsight[]): string {
  const tipWord = tips.length === 1 ? "tip" : "tips";
  const withEstimate = tips.filter((t) => t.savings_estimate_monthly != null);
  const sum = sumEstimates(tips);
  if (withEstimate.length === 0) return `${tips.length} ${tipWord} for ${category}`;
  if (withEstimate.length === tips.length) return `${tips.length} ${tipWord} for ${category}, ~£${sum}/mo`;
  return `${tips.length} ${tipWord} for ${category} · ~£${sum}/mo from ${withEstimate.length}`;
}
