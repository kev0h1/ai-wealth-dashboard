import type { FillCandidate, PlanFillCandidates } from "@/lib/api";

/** A matching transfer to a selected destination leads, without selecting it.
 * Keep the suggested rule's actual matching text, which can differ from its
 * cleaned display name. All other source payments remain available. */
export function prioritisePlanFillCandidates(result: PlanFillCandidates): FillCandidate[] {
  const suggestion = result.suggestion;
  if (!suggestion) return result.items;
  const existing = result.items.find(item => (item.match_value ?? item.display_name) === suggestion.match_value);
  return [existing ?? { series_key: "suggested", display_name: suggestion.match_value, last_amount: suggestion.last_amount, last_date: suggestion.last_date, occurrences_90d: suggestion.occurrences_90d }, ...result.items.filter(item => item !== existing)];
}
