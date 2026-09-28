// G146: a transaction correction never cleared any client-side cache. The
// server side was already correct (routers/transactions.py's
// update_transaction calls response_cache.ainvalidate(uid) on every write),
// but nothing on the client told lib/homeCache.ts's companionItems
// warm-paint snapshot or lib/signalsCache.ts's per-period category
// multiples that the row they were computed from had just changed category
// — so the Home brief and the spending-pattern card kept painting
// pre-correction figures from module memory until a hard refresh.
//
// One function every correction path funnels through, the same shape as
// G138's lib/accountMutations.ts (invalidateAllAccountData, for account
// mutations) and lib/categoryMutations.ts (for category add/delete) — a
// SIBLING to those, not a merge into either: an account mutation adds or
// removes an account, which a plain category correction never does (so
// running the full account sweep here would also needlessly drop
// lib/accountsCache.ts and lib/moneyShape.ts on every single row edit), and
// a category correction is a different write shape from a category
// add/delete (no category KIND changes here, just which category a
// transaction sits in).
//
// Caches cleared here and why:
//   - lib/useAllTransactions.ts's 365-day transactions cache — the
//     corrected row's category is stale in it (feeds SpendTrends on Spend
//     and the rule-builder's match-preview pool on Accounts).
//   - lib/verdictCache.ts — a re-filed transaction moves which categories
//     are notable/majority/unresolved for the period(s) it falls in.
//   - lib/signalsCache.ts — the "×usual" category-multiple figures shift
//     for both the old and new category.
//   - lib/homeCache.ts — the Home brief's companionItems snapshot can name
//     the exact category/merchant that just moved.
//
// Deliberately NOT cleared: lib/moneyShape.ts's cache. A category's KIND
// (fixed/committed/free), not an individual transaction's category value,
// is what the money-shape split is keyed on, and the server's own cache
// for it (backend/app/services/money_shape.py) is only invalidated on a
// kind edit — see lib/categoryMutations.ts's own comment, which made the
// same call for the same reason. lib/accountsCache.ts is untouched too: no
// account is added, removed or changed by a transaction correction.
//
// Callers MUST call this only once the server has actually confirmed the
// write — never optimistically — so a failed correction (network drop,
// 4xx) leaves every cache exactly as it was, still correct for what the
// server actually holds. See components/TeachingSheet.tsx's notifyUpdated
// (the one place every PATCH /transactions/{id} and POST
// /transactions/{id}/resolve-movement in this app funnels through) and
// components/MiscategorisedReviewSheet.tsx's handleConfirmPair (POST
// /transactions/confirm-transfer-pair, the other write path that changes a
// transaction's category outside TeachingSheet) for the real call sites.
//
// Clearing a module cache does not by itself repaint a page that is
// ALREADY mounted and holding its own copy of that data in component
// state (e.g. SpendPage's `fetchedSignals`, HomePage's `companionItems`) —
// those pages additionally trigger their own refetch after calling this,
// so the correction is visible on the current mount, not just the next
// one. See SpendPage.tsx's handleTxUpdated (refetchSignals) and
// HomePage.tsx's handleTxUpdated (loadData()).
import { clearHomeCache } from "@/lib/homeCache";
import { invalidateSignalsCache } from "@/lib/signalsCache";
import { invalidateVerdictCache } from "@/lib/verdictCache";
import { invalidateTransactionsCache } from "@/lib/useAllTransactions";

export function invalidateAfterTransactionCorrection(
  txnId: string,
  detail: { oldCategory?: string; newCategory?: string },
): void {
  // txnId/detail are accepted for callers to document what changed and for
  // a future per-category-keyed cache to narrow against — every cache
  // cleared today is a whole-payload cache with no per-transaction key, so
  // clearing is unconditional regardless of which row or category moved.
  // `newCategory` is OPTIONAL, not `string`: Transaction.category itself is
  // optional (shared/src/types.ts), and every real caller (TeachingSheet.
  // tsx's notifyUpdated, SpendPage.tsx's handleTxUpdated) passes a live
  // transaction's `.category` straight through — a non-optional field here
  // would force a call site to invent a placeholder category just to
  // satisfy the type, which is worse than admitting the value can be
  // missing (an independent review caught this: tsc failed on exactly
  // that, TeachingSheet.tsx:177 and SpendPage.tsx:993 passing an optional
  // value into a required parameter).
  void txnId;
  void detail;
  invalidateTransactionsCache();
  invalidateVerdictCache();
  invalidateSignalsCache();
  clearHomeCache();
}
