// When the transactions hub shows an aim (G242, approved C: the aim lives on
// the hub, not in a pop-up). An aim belongs to one category in one pay
// period, so the block appears only for a SINGLE-category filter whose
// from/to is exactly the current period. A search, a merchant scope, a
// multi-category "money you moved" link, a credit-only scope, a past period
// or no period at all never shows it: there is nothing honest to check.
export interface HubAimScope {
  categoryFilter: string | null;
  categoriesFilter: string[] | null;
  merchantsFilter: string[] | null;
  searchQuery: string;
  txnType: "debit" | "credit" | null;
  periodFrom: string | null;
  periodTo: string | null;
}

export function hubAimEligible(scope: HubAimScope, current: { start: string; end: string } | null): boolean {
  if (!current) return false;
  if (!scope.categoryFilter) return false;
  if (scope.categoriesFilter && scope.categoriesFilter.length > 0) return false;
  if (scope.merchantsFilter && scope.merchantsFilter.length > 0) return false;
  if (scope.searchQuery.trim()) return false;
  if (scope.txnType === "credit") return false;
  return scope.periodFrom === current.start && scope.periodTo === current.end;
}
