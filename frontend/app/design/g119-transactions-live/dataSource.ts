import type { Transaction, PagedTransactions } from "@/lib/api";
import { FIXTURE_POPULATED } from "./fixtures";
// SearchFilters/EMPTY_FILTERS/hasActiveFilters now live in
// lib/transactionFilters.ts (folded into production once Kevin approved
// this round — app/transactions/TransactionsPage.tsx and
// components/TransactionFilterChips.tsx/TransactionFilterSheet.tsx share
// the SAME definition). Re-exported here so every file in this preview
// that already imports them from "./dataSource" keeps working unchanged.
export { type SearchFilters, EMPTY_FILTERS, hasActiveFilters } from "@/lib/transactionFilters";
import { type SearchFilters, EMPTY_FILTERS } from "@/lib/transactionFilters";

export type Source = "fixture";

export interface PageResult {
  result: PagedTransactions;
  source: Source;
}

function paginate(items: Transaction[], page: number, pageSize: number): PagedTransactions {
  const total = items.length;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const start = (page - 1) * pageSize;
  return { items: items.slice(start, start + pageSize), total, page, pages };
}

// Apply the same filter dimensions locally to synthetic rows only.
function applyFiltersLocally(items: Transaction[], filters: SearchFilters): Transaction[] {
  let out = items;
  const cats = filters.categories && filters.categories.length > 0 ? filters.categories : null;
  if (cats) {
    out = out.filter((t) => cats.includes(t.category || "Other"));
  } else if (filters.category) {
    out = out.filter((t) => (t.category || "Other") === filters.category);
  }
  if (filters.merchants && filters.merchants.length > 0) {
    const needles = filters.merchants.map((m) => m.trim().toLowerCase()).filter(Boolean);
    if (needles.length > 0) {
      out = out.filter((t) => {
        const hay = `${t.merchant_name || ""} ${t.description || ""}`.toLowerCase();
        return needles.some((n) => hay.includes(n));
      });
    }
  }
  if (filters.from) {
    out = out.filter((t) => t.date.slice(0, 10) >= filters.from!);
  }
  if (filters.to) {
    out = out.filter((t) => t.date.slice(0, 10) <= filters.to!);
  }
  if (filters.txnType) {
    out = out.filter((t) => t.transaction_type === filters.txnType);
  }
  return out;
}

// Every state, including the default, stays on fixture data. The async
// contract preserves the variants' loading and pagination behaviour.
export async function fetchTransactionsPage(
  page: number,
  pageSize: number,
  forcedFixture: Transaction[] | null,
  filters: SearchFilters = EMPTY_FILTERS,
): Promise<PageResult> {
  const filtered = applyFiltersLocally(forcedFixture ?? FIXTURE_POPULATED, filters);
  return { result: paginate(filtered, page, pageSize), source: "fixture" };
}
