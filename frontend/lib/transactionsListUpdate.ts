// G358: pure list update for a category change that touched one or more rows.
//
// The Search screen filters server-side, so after a re-file the optimistic
// local list must do what the server would: patch every touched row, then drop
// rows that no longer match the active category filter and decrement the total
// per dropped row. The caller still refetches afterwards (authoritative); this
// only makes the change visible at once.

export type CategoryChange = { ids: string[]; category: string };
export type ListFilter = { categories?: string[] | null };

type Row = { id: string; category?: string | null };

// Mirror of backend `_category_clause`: "Other" also matches an empty or
// missing category; every other name is an exact match.
export function matchesCategoryFilter(
  category: string | null | undefined,
  categories: string[] | null | undefined,
): boolean {
  if (!categories || categories.length === 0) return true;
  const effective = category || "";
  return categories.some((c) => (c === "Other" ? effective === "" || effective === "Other" : effective === c));
}

export function applyCategoryChange<T extends Row>(
  items: T[],
  total: number,
  change: CategoryChange,
  filter: ListFilter,
): { items: T[]; total: number; removedIds: string[] } {
  const touched = new Set(change.ids);
  const next: T[] = [];
  const removedIds: string[] = [];
  for (const row of items) {
    if (!touched.has(row.id)) {
      next.push(row);
      continue;
    }
    const updated = { ...row, category: change.category };
    if (matchesCategoryFilter(updated.category, filter.categories)) next.push(updated);
    else removedIds.push(row.id);
  }
  return { items: next, total: Math.max(0, total - removedIds.length), removedIds };
}
