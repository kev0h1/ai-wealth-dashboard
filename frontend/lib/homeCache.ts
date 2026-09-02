import { Account, CompanionItem, InvestmentAccount, NeedleSummary, SafeToSpend, Transaction } from "@/lib/api";

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
  recentTxns: Transaction[];
  needle: NeedleSummary | null;
  needleStatus: "loading" | "ready" | "failed";
};

let homeCache: HomeCacheSnapshot | null = null;

export function getHomeCache(): HomeCacheSnapshot | null {
  return homeCache;
}

export function setHomeCache(snapshot: HomeCacheSnapshot): void {
  homeCache = snapshot;
}

export function clearHomeCache(): void {
  homeCache = null;
}
