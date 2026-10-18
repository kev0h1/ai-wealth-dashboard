// Pure derivations for the savings-tip signifiers shown on Spend's category
// list and the transactions page's collapsed tips line. Owner picked
// variant A (2026-09-05) — see DESIGN.md "Tips on
// Spend and the transactions page" for the copy rules this encodes: tips
// never add rows to Spend's category list, and a subline's count/figure
// signifier is a count, never a figure.

import type { SavingsInsight } from "@/lib/api";

/** G189: the one gate for the `show_tips` display preference. Every surface
 *  that feeds tips to the UI passes its insights through this, so an
 *  opted-out user gets an empty list and nothing downstream (sublines,
 *  Transactions tip rows) can render a tip. */
export function insightsForDisplay(showTips: boolean, insights: SavingsInsight[]): SavingsInsight[] {
  return showTips ? insights : [];
}

/** Every READABLE tip for a given Spend category — state "fresh" (or "stale",
 *  B44: the last good tip kept visible while research is failing, which the
 *  card labels "Tips may be out of date"), matched
 *  on the backend's own `app_category` field. For an older payload that
 *  predates the `state` field, falls back to the same missing-state rule
 *  the old Insights hero's own `heroOpen` used (that page, and `heroOpen`
 *  with it, deleted 2026-09-05): `!substituted`.
 *  Deliberately narrower than that historical rule otherwise — it also
 *  counted "quiet" as open, but a quiet card renders no title/body
 *  (components/InsightCard.tsx has nothing to show for it), so it is
 *  excluded here on purpose rather than opening a tip strip with no
 *  content. Never returns a verified/substituted/quiet tip; those are
 *  closed or silent states, not actionable tips. */
export function openTipsFor(category: string, insights: SavingsInsight[]): SavingsInsight[] {
  return insights.filter((t) => {
    if (t.app_category !== category) return false;
    if (t.state != null) return t.state === "fresh" || t.state === "stale";
    return !t.substituted;
  });
}

/** The tip a merchant-scoped transactions deep-link (`?merchants=…&tip=…`)
 *  should unfold to — used when there's no category filter active but a
 *  merchants filter is, mirroring `openTipsFor`'s category-scoped role for
 *  that case. Always returns at most one insight (or none): a merchant deep
 *  link only ever names the one insight the caller (HomeInsightSpotlight)
 *  actually linked to, never "every tip touching this merchant". Matches on
 *  `tipId` first (the authoritative link), then confirms that insight's own
 *  merchant evidence (`triggered_by[0].display_name`) is actually one of the
 *  merchants in the filter — a stale/mismatched `tip=` id (or a `merchants=`
 *  value that no longer matches its insight) yields no tip rather than a
 *  wrong one. Never returns a verified/substituted/quiet tip, same as
 *  `openTipsFor`. */
export function tipsForMerchants(
  merchants: string[],
  insights: SavingsInsight[],
  tipId: string | null
): SavingsInsight[] {
  if (!tipId || merchants.length === 0) return [];
  const tip = insights.find((t) => t.id === tipId);
  if (!tip) return [];
  if (tip.state != null ? tip.state !== "fresh" && tip.state !== "stale" : tip.substituted) return [];
  const merchantName = tip.triggered_by?.[0]?.display_name;
  if (!merchantName || !merchants.includes(merchantName)) return [];
  return [tip];
}

/** The subline SUFFIX only, no leading separator and no payment count:
 *  callers prepend their own "{n} payment{s}" (and " · " when non-null)
 *  themselves. G283 (Kevin, 2026-10-17): a tip count and nothing else, never
 *  a figure in pounds, never a claim about money.
 *    empty:  null            nothing to say
 *    else:   "{n} tip{s}"
 */
export function tipSubline(tips: SavingsInsight[]): string | null {
  if (tips.length === 0) return null;
  return `${tips.length} ${tips.length === 1 ? "tip" : "tips"}`;
}

/** The transactions page's own tips disclosure line, which carries the
 *  category name instead of a payment count: "{n} tip{s} for {category}".
 *  A count and a name only, no figure. */
export function tipsLineText(category: string, tips: SavingsInsight[]): string {
  return `${tips.length} ${tips.length === 1 ? "tip" : "tips"} for ${category}`;
}
