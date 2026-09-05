import { api, Account } from "@/lib/api";

// ── Accounts cache (module level) ─────────────────────────────────────────
// Mirrors lib/verdictCache.ts's pattern (module-level value + inflight
// promise + TTL, invalidated explicitly on write) for the same reason: six
// pages — HomePage, SpendPage, PlanningPage, LongTermPlanningPage,
// SettingsPage, AccountsPage — each called api.accounts() independently on
// their own mount, paying for the same GET /accounts on every route change
// even though the account list rarely changes within a session. Unlike
// verdictCache (keyed per period offset) this resource has no key — one
// account list per user — so the cache is a single value, not a Map.
//
// GET /accounts returns bank AND manual (offline) accounts together (every
// Account here can carry `.manual: true`), so anything that adds, edits or
// removes either kind — connect, disconnect, a manual account create/edit/
// delete, or a mirror-rule create/edit/delete/toggle/backfill (rules change
// a manual account's mirrored balance) — must call invalidateAccounts() so
// the next read (on this page or any other) is forced fresh instead of
// serving the pre-write snapshot for up to the full TTL.
export const ACCOUNTS_TTL_MS = 60_000;
let accountsCache: { data: Account[]; at: number } | null = null;
let accountsInflight: Promise<Account[]> | null = null;

export function invalidateAccounts() {
  accountsCache = null;
  accountsInflight = null;
}

/** `force` bypasses a fresh cache entry and always re-fetches (still deduped
 *  against a concurrent call) — used right after a mutation this same call
 *  site knows just changed the list (e.g. the post-reconnect poll waiting
 *  for a newly-connected account to appear). */
export function getAccountsCached(force = false): Promise<Account[]> {
  if (!force && accountsCache && Date.now() - accountsCache.at < ACCOUNTS_TTL_MS) {
    return Promise.resolve(accountsCache.data);
  }
  if (!accountsInflight) {
    accountsInflight = api.accounts()
      .then((data) => {
        accountsCache = { data, at: Date.now() };
        return data;
      })
      .finally(() => { accountsInflight = null; });
  }
  return accountsInflight;
}
