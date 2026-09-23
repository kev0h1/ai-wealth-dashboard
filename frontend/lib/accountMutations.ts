import { invalidateAccounts } from "@/lib/accountsCache";
import { invalidateTransactionsCache } from "@/lib/useAllTransactions";
import { clearHomeCache } from "@/lib/homeCache";
import { invalidateVerdictCache } from "@/lib/verdictCache";
import { invalidateMoneyShapeCache } from "@/lib/moneyShape";
import { invalidateSignalsCache } from "@/lib/signalsCache";
import { PAYDAY_DOT_CACHE_KEY } from "@/lib/paydayWindow";

// G138: a deleted Barclays savings account's £100 transaction of 21 Sep kept
// showing on Spend as an unplaced payment, counted in Out, until a hard
// refresh — confirmed server-side clean (all six transaction collections
// searched on UAT, nothing found; routers/accounts.py's delete route runs
// services/account_cascade.py, which deletes the transactions, the account
// doc, cashflow_cache, companion items and derived caches, and bumps the
// data version so the server's own response cache is invalidated). The leak
// was client-side: AccountsPage.tsx's delete handler called only
// invalidateAccounts(), leaving every OTHER module-scope cache that reads
// off accounts/transactions (the verdict, money-shape and Home caches, plus
// the two localStorage badge caches below) serving their pre-deletion
// payload for up to the rest of its own TTL — and Home's idle prefetch
// warms the verdict cache, so it was often already populated by the time
// Spend was opened.
//
// This is the CLASS fix, not the instance fix: one function that clears
// every cache in frontend/lib/ whose contents depend on which accounts
// exist or what their transactions are, called from every mutation that can
// change that — delete, a new bank connection landing, a reconnect landing,
// a statement upload, and every manual-account/manual-transaction/mirror-
// rule write in AccountsPage.tsx (all of which already called
// invalidateAccounts() alone, the same one-cache gap as delete). The next
// cache added under lib/ that holds account- or transaction-derived data
// must be wired in here too — scripts/account-mutations-coverage.test.mjs
// enforces that every exported `invalidate*`/`clear*` function under lib/
// is either called from this function or named in that script's own
// ALLOWED_UNREACHABLE list with a reason.
//
// Deliberately NOT cleared here (see that script's ALLOWED_UNREACHABLE list
// for the full reasoning): lib/openBankingAccess.ts (subscription-tier
// data, untouched by an account mutation) and lib/homeDismissedAdvice.ts
// (a dismissal preference that self-prunes against the live /today feed
// rather than caching a stale value).
//
// Lives in its own file, importing each cache's real invalidator, the same
// shape as lib/categoryMutations.ts — not folded into AccountsPage.tsx —
// so AuthProvider's logout() can also call it (removing its own duplicate
// copy of this same cache list) and so a plain Node script can prove the
// invalidation without a React renderer, the way
// scripts/category-mutations.test.mjs already proves the category case.
export function invalidateAllAccountData(): void {
  invalidateAccounts();
  invalidateTransactionsCache();
  clearHomeCache();
  invalidateVerdictCache();
  invalidateMoneyShapeCache();
  invalidateSignalsCache();

  // localStorage counts/flags derived from the user's accounts or
  // transactions, not covered by an in-memory cache above.
  try {
    // Bills-at-risk badge (components/BottomNav.tsx's useAtRiskCount) — a
    // count of bills due in 7 days their account can't cover. Named
    // explicitly in the G138 item as the localStorage half of this leak.
    localStorage.removeItem("wd_spend_badge");
    // Penny nav dot (lib/paydayWindow.ts) — derived from safeToSpend/
    // companion items, both of which can change when an account is added,
    // reconnected or removed.
    localStorage.removeItem(PAYDAY_DOT_CACHE_KEY);
    // Insights badge count — same "derived count" shape as the two above
    // (see components/AuthProvider.tsx's logout(), which already clears it
    // defensively). No active reader/writer exists in the frontend today
    // (grepped 2026-09-22), so this is a no-op in practice, but it is
    // cleared here rather than left for the next person to rediscover the
    // gap the hard way if a writer is ever added back.
    localStorage.removeItem("wd_insight_badge");
  } catch {
    // localStorage unavailable (private mode / quota) — nothing to clear;
    // the in-memory caches above are still invalidated regardless.
  }
}
