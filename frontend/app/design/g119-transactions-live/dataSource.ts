// The real-data path for this preview (G119): read-only, session-scoped,
// fixture fallback when nobody is signed in.
//
// This calls api.transactionsSearch — the EXACT function
// frontend/app/transactions/TransactionsPage.tsx already calls, which hits
// GET /transactions/search (backend/app/routers/transactions.py) with page
// and page_size. Nothing here talks to a different endpoint or builds its
// own fetch — reusing the real call is what makes the two guarantees hold
// structurally rather than by promise:
//   - Read-only: `get<T>()` in lib/api.ts issues a plain fetch with no
//     method (GET) and no body; this module never imports post/del or any
//     mutating api.* function (patchTransaction, resolveMovement, addRule,
//     …). Verified in the report by logging every network request the
//     preview makes during a render.
//   - Never another user's data: the request carries whatever bearer token
//     lib/auth.ts's getToken() finds in this browser (authHeaders() in
//     lib/api.ts) — the same mechanism every authenticated page in the app
//     uses. The backend resolves that token to a user id
//     (current_user dependency) and every collection query in
//     search_transactions is scoped to `user_id: uid` server-side; there is
//     no parameter here or anywhere in this file that names a user. A
//     signed-out browser has no token, the request 401s, and this module
//     falls back to synthetic fixtures — it never retries with a different
//     identity or a service credential.
import { api, type Transaction, type PagedTransactions } from "@/lib/api";
import { FIXTURE_POPULATED } from "./fixtures";

export type Source = "live" | "fixture";

export interface PageResult {
  result: PagedTransactions;
  source: Source;
}

// The same filter dimensions GET /transactions/search actually accepts
// (backend/app/routers/transactions.py `_search_query`) — no more, no
// less. There is deliberately no `accountId`/account-scope field here: the
// global search endpoint this preview and the real TransactionsPage.tsx
// both call spans every source collection for the user (its own docstring:
// "every source a user has connected") and has no account parameter at
// all — only the per-account `get_transactions` route does. Inventing an
// account filter here would draw a control the backend cannot serve.
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

function paginate(items: Transaction[], page: number, pageSize: number): PagedTransactions {
  const total = items.length;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const start = (page - 1) * pageSize;
  return { items: items.slice(start, start + pageSize), total, page, pages };
}

// Mirrors `_search_query`'s own matching rules closely enough for the
// forced-fixture / signed-out-fallback paths to filter deterministically,
// client-side, on the synthetic set — never a real query, just the same
// shape of match so a screenshot of a filtered fixture list isn't a lie
// about what filtering means. `categories` wins over `category` (same
// precedence as the backend); `merchants` is an OR of case-insensitive
// substring matches against merchant_name/description (same as the
// backend's regex OR); `from`/`to` compare the date-only prefix, which is
// valid because every fixture date and every `from`/`to` bound here is a
// zero-padded ISO string (lexical order == chronological order).
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

/** `forcedFixture`, when set, is a review-mode override (?state=populated|
 * long|empty) — it never touches the network, so the loading/empty/long
 * states screenshot deterministically regardless of who's signed in.
 * `forcedFixture` absent is the real path: try the live endpoint, fall back
 * to the small synthetic set on ANY failure (401 unauthenticated, network
 * error, 5xx) — a failure never bubbles as an error state to the variant,
 * it always resolves to a usable (fixture) page.
 *
 * `filters`, when any dimension is set, narrows the result exactly like
 * TransactionsPage.tsx's own filter chips do — forwarded straight through
 * to api.transactionsSearch on the live path (server-side, so pagination/
 * counts stay correct), or applied locally on the fixture path so the
 * forced review states and the signed-out fallback both filter the same
 * way a real query would. */
export async function fetchTransactionsPage(
  page: number,
  pageSize: number,
  forcedFixture: Transaction[] | null,
  filters: SearchFilters = EMPTY_FILTERS,
): Promise<PageResult> {
  if (forcedFixture) {
    const filtered = applyFiltersLocally(forcedFixture, filters);
    return { result: paginate(filtered, page, pageSize), source: "fixture" };
  }
  try {
    const result = await api.transactionsSearch({
      page,
      page_size: pageSize,
      categories: filters.categories && filters.categories.length > 0 ? filters.categories : undefined,
      category: (!filters.categories || filters.categories.length === 0) ? (filters.category || undefined) : undefined,
      merchants: filters.merchants && filters.merchants.length > 0 ? filters.merchants.join(",") : undefined,
      from: filters.from || undefined,
      to: filters.to || undefined,
      txn_type: filters.txnType || undefined,
    });
    return { result, source: "live" };
  } catch {
    const filtered = applyFiltersLocally(FIXTURE_POPULATED, filters);
    return { result: paginate(filtered, page, pageSize), source: "fixture" };
  }
}
