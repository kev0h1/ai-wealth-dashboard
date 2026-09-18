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
