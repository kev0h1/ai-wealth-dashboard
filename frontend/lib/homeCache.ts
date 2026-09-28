// `import type`, not a value import: every name here is used purely as a
// type below. Node's --experimental-strip-types (scripts/account-mutations.
// test.mjs loads this module directly) does not elide a type name sitting
// in a value import clause across module boundaries — see
// lib/openBankingAccess.ts's header comment for the fuller version of this
// same note.
import type { Account, AccountEligibility, CompanionItem, InvestmentAccount, SafeToSpend, Transaction } from "@/lib/api";
import type { TodayRequestStatus } from "@/lib/spendFromAccount";

// Module-level warm-paint cache for HomePage.tsx — lives here (rather than
// inline in the component) so it can be invalidated from outside the Home
// route — e.g. AuthProvider's logout(), which must clear every module-scope
// cache holding the previous user's figures before a different user signs
// in on the same tab. Same shape/reasoning as lib/verdictCache.ts and
// lib/signalsCache.ts, which made the same move for the same reason.
//
// Mirrors lib/useAllTransactions.ts's module-scope cache convention: a plain
// variable that survives remounts within the same page load (browser tab),
// otherwise cleared only by a hard reload. HomePage's own useState always
// resets cold on a fresh component mount, so without this, every return to
// Home — including a same-session back-navigation — would replay the full
// cold-load skeleton hold even though the data was on screen moments ago.
export type HomeCacheSnapshot = {
  accounts: Account[];
  investmentAccounts: InvestmentAccount[];
  safeToSpend: SafeToSpend | null;
  companionItems: CompanionItem[];
  // G110: the same per-account headroom snapshot GET /today/cover-plan
  // already exposed to Settings, now also on plain GET /today — cached
  // alongside companionItems (both come off the same response) so a warm
  // Home mount shows the "spend from" line immediately, not a beat later.
  accountEligibility: Record<string, AccountEligibility> | undefined;
  // G148: whether the GET /today that was supposed to deliver
  // `accountEligibility` above actually arrived. Cached WITH it, and this is
  // the point: `accountEligibility` is legitimately `undefined` both while
  // the request is in flight and when it came back carrying no such field,
  // so a snapshot that stores only the value cannot tell a warm remount
  // which of those it is looking at. Storing the undefined value without its
  // outcome is how a missing feature stays indistinguishable from a working
  // one across every remount for the rest of the page load.
  todayStatus: TodayRequestStatus;
  // G148 re-review: the same treatment for the GET /accounts outcome, and
  // for the same reason. A cached `accounts: []` is indistinguishable from
  // "this user has no bank accounts" unless the snapshot also remembers that
  // the request which produced it failed. `loadError` cannot cover this: it
  // is a fresh `useState` false on the next mount, while the empty list in
  // this snapshot survives.
  accountsStatus: TodayRequestStatus;
  recentTxns: Transaction[];
};

// ── Shape guard (G148, 2026-09-23) ──────────────────────────────────────────
//
// Every key `HomeCacheSnapshot` declares, as data. A snapshot missing any of
// them is REJECTED by getHomeCache rather than handed to HomePage, which
// would otherwise seed its state from `undefined` on a key it believes is
// always present.
//
// Why a list and not a version number: a version integer only invalidates
// across two different builds of this module, and this cache is module-scope
// memory that cannot outlive its own bundle, so the reader and writer are
// always the same build and the integer can never disagree with itself. The
// cache's real exposure is a WRITER that omits a key the reader depends on,
// which is the client-side shape of exactly the bug G148 fixes (the server
// half of it, where a persisted payload genuinely does outlive the code that
// wrote it, is versioned properly in
// backend/app/services/response_cache.py's SHAPE_VERSION).
//
// Invalidation itself is NOT re-invented here: `clearHomeCache` below is
// already wired into G138's single invalidator, lib/accountMutations.ts's
// invalidateAllAccountData(), which is what every account mutation and
// logout calls, and scripts/check-account-cache-coverage.mjs enforces that
// it stays wired in. This guard only decides whether an otherwise-live
// snapshot is the right SHAPE to hand back.
const REQUIRED_SNAPSHOT_KEYS: readonly (keyof HomeCacheSnapshot)[] = [
  "accounts",
  "investmentAccounts",
  "safeToSpend",
  "companionItems",
  "accountEligibility",
  "todayStatus",
  "accountsStatus",
  "recentTxns",
];

/** True when `snapshot` carries every key the current shape declares.
 *  Exported so scripts/home-cache-shape.test.mjs can prove the rejection
 *  without a React renderer. */
export function isCurrentHomeCacheShape(snapshot: unknown): snapshot is HomeCacheSnapshot {
  if (snapshot == null || typeof snapshot !== "object") return false;
  // `in`, not a truthiness test: `accountEligibility` and `safeToSpend`
  // are both legitimately undefined/null on a perfectly good snapshot.
  // The question is whether the WRITER knew about the key.
  return REQUIRED_SNAPSHOT_KEYS.every((key) => key in snapshot);
}

let homeCache: HomeCacheSnapshot | null = null;

export function getHomeCache(): HomeCacheSnapshot | null {
  if (homeCache != null && !isCurrentHomeCacheShape(homeCache)) {
    // Written by code that did not know about a key this shape now
    // declares. Drop it rather than serve a partial snapshot: a cold load
    // is a visible, self-correcting cost, a silently missing field is not.
    homeCache = null;
  }
  return homeCache;
}

export function setHomeCache(snapshot: HomeCacheSnapshot): void {
  if (!isCurrentHomeCacheShape(snapshot)) {
    // A writer that has drifted from the shape. Refusing the write keeps the
    // next mount on the cold path instead of pinning a partial snapshot in
    // memory for the rest of the page load.
    homeCache = null;
    return;
  }
  homeCache = snapshot;
}

export function clearHomeCache(): void {
  homeCache = null;
}
