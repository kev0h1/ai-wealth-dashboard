// Canonical shape of "what GET /transactions/search can actually narrow by"
// (backend/app/routers/transactions.py `_search_query`) — extracted out of
// the G119 design round (app/design/g119-transactions-live/dataSource.ts)
// so the production transactions hub (app/transactions/TransactionsPage.tsx)
// and its filter chips/sheet (components/TransactionFilterChips.tsx,
// components/TransactionFilterSheet.tsx) share ONE definition instead of
// each preview and the real page drifting their own copies. There is
// deliberately no account-scope field here: the endpoint this type
// describes spans every source a user has connected and has no account
// parameter at all — only the per-account `get_transactions` route does;
// inventing one here would describe a control the backend cannot serve.
export interface SearchFilters {
  category: string | null;
  categories: string[] | null;
  merchants: string[] | null;
  from: string | null;
  to: string | null;
  txnType: "debit" | "credit" | null;
}

export const EMPTY_FILTERS: SearchFilters = {
  category: null,
  categories: null,
  merchants: null,
  from: null,
  to: null,
  txnType: null,
};

export function hasActiveFilters(f: SearchFilters): boolean {
  return Boolean(
    f.category || (f.categories && f.categories.length > 0) ||
    (f.merchants && f.merchants.length > 0) || f.from || f.to || f.txnType,
  );
}

// ── Active-filter chip vocabulary ────────────────────────────────────────
// Pure logic (no JSX) so it can be imported both by
// components/TransactionFilterChips.tsx (the rendering layer) AND by
// scripts/transaction-filter-chips.test.mjs, this codebase's plain-Node
// test harness — `node --experimental-strip-types` strips TypeScript types
// but does not transform JSX, so a .tsx file with rendering functions in it
// (FilterChips/FilterTrigger/FilterBar) can never be imported directly by a
// test, the same reason lib/categoryMutations.ts exists as a plain module
// CategoriesContext.tsx delegates to (see
// scripts/category-mutations.test.mjs's own header).

// Formats the period chip. British English, no em dashes, no arrows — a
// bounded window reads "11 Sept to 24 Sept" (Kevin: "use 'to', not an
// en dash or arrow"), an open-ended lower bound reads "Since 11 Sept" (not
// "From 11 Sept").
export function formatPeriodChip(from: string | null, to: string | null): string {
  const fmt = (iso: string) => {
    const d = new Date(iso + "T00:00:00");
    return d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
  };
  if (from && to) return `${fmt(from)} to ${fmt(to)}`;
  if (from) return `Since ${fmt(from)}`;
  return `Until ${fmt(to!)}`;
}

export interface ChipItem {
  key: "category" | "direction" | "merchant" | "period";
  label: string;
  ariaLabel: string;
  onClear: () => void;
  // "merchant" carried its own indigo tint even before this round (the
  // other three shared one slate tone) — kept only so treatment="legacy"
  // can reproduce that exact, pre-existing asymmetry. Every other
  // treatment renders all four kinds identically; the fix is that every
  // active filter now reads as the same kind of object, not a hierarchy
  // of some chips mattering more than others.
  kind: "primary" | "merchant";
}

export interface BuildChipItemsArgs {
  filters: SearchFilters;
  categoryLabel: string | null;
  onClearCategory: () => void;
  onClearDirection: () => void;
  onClearMerchants: () => void;
  onClearPeriod: () => void;
}

// `categoryLabel` is the ONLY signal for which of two shapes a
// category/direction pairing is — do not infer it from hasCategory/
// hasDirection, and do not "simplify" this back to an `else if` (that was
// the G119 review bug: selecting a category AND a direction in
// FilterSheet.tsx collapsed into one category chip, silently hiding the
// direction narrowing and leaving it with no way to clear on its own):
//
//   - labelled (categoryLabel set): category and txn_type arrived from
//     another page as ONE named concept — e.g. MoneyShapeHero.tsx's
//     jobHref sets categories+txn_type+label together for "Money you
//     moved", or txn_type+label alone with NO category at all for the
//     overspent-only "Everything that went out". Exactly one chip,
//     carrying the label; clearing it clears category + categories +
//     label + txn_type together via onClearCategory — unchanged from
//     before this fix.
//   - unlabelled (categoryLabel absent): either an old-style single-
//     dimension deep link (?category=X alone, or FilterSheet.tsx setting
//     just one of the two), or the user composed a category AND a
//     direction independently in FilterSheet.tsx. Render whichever of the
//     two are active as SEPARATE chips, each independently clearable —
//     clearing the category chip must leave the direction filter intact,
//     and vice versa.
export function buildChipItems({
  filters, categoryLabel, onClearCategory, onClearDirection, onClearMerchants, onClearPeriod,
}: BuildChipItemsArgs): ChipItem[] {
  const items: ChipItem[] = [];
  const hasCategory = Boolean(filters.category || (filters.categories && filters.categories.length > 0));
  const hasDirection = Boolean(filters.txnType);
  if (categoryLabel && (hasCategory || hasDirection)) {
    items.push({ key: "category", label: categoryLabel, ariaLabel: `Remove ${categoryLabel} filter`, onClear: onClearCategory, kind: "primary" });
  } else {
    if (hasCategory) {
      const label = filters.category ?? filters.categories!.join(", ");
      items.push({ key: "category", label, ariaLabel: `Remove ${label} filter`, onClear: onClearCategory, kind: "primary" });
    }
    if (hasDirection) {
      const label = filters.txnType === "debit" ? "Money out" : "Money in";
      items.push({ key: "direction", label, ariaLabel: "Remove direction filter", onClear: onClearDirection, kind: "primary" });
    }
  }
  if (filters.merchants && filters.merchants.length > 0) {
    const label = filters.merchants.length > 1
      ? `${filters.merchants[0]} +${filters.merchants.length - 1}`
      : filters.merchants[0];
    items.push({
      key: "merchant",
      label,
      ariaLabel: `Remove ${filters.merchants.join(", ")} filter`,
      onClear: onClearMerchants,
      kind: "merchant",
    });
  }
  if (filters.from || filters.to) {
    items.push({
      key: "period",
      label: formatPeriodChip(filters.from, filters.to),
      ariaLabel: "Remove period filter, widen to all history",
      onClear: onClearPeriod,
      kind: "primary",
    });
  }
  return items;
}
