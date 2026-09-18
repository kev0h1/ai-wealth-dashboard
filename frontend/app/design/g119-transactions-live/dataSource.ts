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

function paginate(items: Transaction[], page: number, pageSize: number): PagedTransactions {
  const total = items.length;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const start = (page - 1) * pageSize;
  return { items: items.slice(start, start + pageSize), total, page, pages };
}

/** `forcedFixture`, when set, is a review-mode override (?state=populated|
 * long|empty) — it never touches the network, so the loading/empty/long
 * states screenshot deterministically regardless of who's signed in.
 * `forcedFixture` absent is the real path: try the live endpoint, fall back
 * to the small synthetic set on ANY failure (401 unauthenticated, network
 * error, 5xx) — a failure never bubbles as an error state to the variant,
 * it always resolves to a usable (fixture) page. */
export async function fetchTransactionsPage(
  page: number,
  pageSize: number,
  forcedFixture: Transaction[] | null,
): Promise<PageResult> {
  if (forcedFixture) {
    return { result: paginate(forcedFixture, page, pageSize), source: "fixture" };
  }
  try {
    const result = await api.transactionsSearch({ page, page_size: pageSize });
    return { result, source: "live" };
  } catch {
    return { result: paginate(FIXTURE_POPULATED, page, pageSize), source: "fixture" };
  }
}
