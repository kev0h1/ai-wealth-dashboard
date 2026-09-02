"use client";

import { useEffect, useState, useCallback, useMemo, useRef } from "react";
import dynamic from "next/dynamic";
import { ChevronRight } from "lucide-react";
import { api, Account, Transaction, InvestmentAccount, SafeToSpend, CompanionItem, NeedleSummary } from "@/lib/api";
import { getToken, setToken } from "@/lib/auth";
import SafeToSpendCard from "@/components/SafeToSpendCard";
import AccountLedgerRow from "@/components/AccountLedgerRow";
import { bankToRow, investmentToRow } from "@/lib/accountsEstate";
import TransactionRow from "@/components/TransactionRow";
import TeachingSheet from "@/components/TeachingSheet";
import BottomNav from "@/components/BottomNav";
import { usePreferences } from "@/components/PreferencesContext";
import { useAuth } from "@/components/AuthProvider";
import { useRouter } from "next/navigation";
import { getPayPeriodWithConfig } from "@/lib/payPeriod";
import HomeInsightSpotlight from "@/components/HomeInsightSpotlight";
import ValueDeliveredStat from "@/components/ValueDeliveredStat";
import UpcomingBillsStrip from "@/components/UpcomingBillsStrip";
import ThisMonthStrip from "@/components/ThisMonthStrip";
import { useColours } from "@/components/ColourProvider";
import { isHomeCurrency } from "@/lib/currency";
import FuelSavingsCard from "@/components/FuelSavingsCard";
import GroceryBasketCard from "@/components/GroceryBasketCard";
import { useHomePinnedCards } from "@/lib/useHomePinnedCards";
import { getHomeCache, setHomeCache } from "@/lib/homeCache";
import HomeBrief, { HomeBriefClearedRow } from "@/components/HomeBrief";
import ReconnectStrip from "@/components/ReconnectStrip";
import { invalidateTransactionsCache } from "@/lib/useAllTransactions";
import { resolveAttention } from "@/lib/attention";
import { isPaydayWindowActive, writePaydayDotCache } from "@/lib/paydayWindow";
import { useTutorialReady } from "@/components/TutorialContext";

// Recharts-backed pinned widget (~448KB) is rare on Home (opt-in pin) — keep
// it out of the initial route chunk.
const PinnedWidgetCard = dynamic(
  () => import("@/components/SpendTrends").then((mod) => mod.PinnedWidgetCard),
  {
    ssr: false,
    loading: () => <div className="h-[150px] rounded-2xl glass-card animate-pulse" />,
  }
);
// kept-for-future: import CompanionStack from "@/components/CompanionStack";

// Token is guaranteed by AuthProvider before this component mounts
async function ensureAuth() {}

// Module-level warm-paint cache now lives in lib/homeCache.ts (getHomeCache/
// setHomeCache/clearHomeCache) so AuthProvider's logout() can clear it
// without importing this whole page component. See that file's doc comment
// for the cache's own reasoning. `pageReady` below starts out true precisely
// when a warm snapshot is present at mount — the hold is for cold loads
// only. Only ever written once a mount has itself completed a full settle
// (see the sync effect near the bottom of the component) so a rapid
// double-navigation during the very first cold load can never seed this
// with empty/default data.

// Full-page loading skeleton — shown only while `pageReady` is false (a
// cold load still settling; see HomePage below). Mirrors the real
// layout's shape section-for-section so the reveal itself causes no
// shift: greeting, hero, the three "Your money" strips, "Your estate"
// rows and Recent Transactions rows, in the same positions and
// approximate heights as the loaded page. The hero reuses
// SafeToSpendCard's own `loading` skeleton (already used lower down in
// this file); the estate and recent-transactions rows are the exact
// skeleton markup already used further down in this file for those
// sections, relocated rather than reinvented; the three strip
// placeholders use the min-height values each of those files already
// documents for their own loading skeleton (166 / 64 / 128px).
function HomeSkeleton({ firstName }: { firstName?: string }) {
  return (
    <div
      className="lg:grid lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)] lg:gap-6 lg:p-6 lg:max-w-7xl lg:mx-auto"
      aria-hidden="true"
    >
      {/* Left column */}
      <div>
        <div className="px-4 pt-6 lg:px-0 lg:pt-0">
          <h1 className="text-[28px] font-bold tracking-tight text-slate-900 dark:text-slate-100 leading-tight">
            {firstName ? `Hi, ${firstName}` : "Welcome back"}
          </h1>
        </div>

        <div className="px-4 lg:px-0 mt-8">
          <SafeToSpendCard data={null} loading cardDeltaSoFar={null} />
        </div>

        <div className="mt-8">
          <div className="px-4 lg:px-0 mb-3">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
              Your money
            </p>
          </div>
          <div className="space-y-3">
            <div className="px-4 lg:px-0">
              <div className="w-full min-h-[166px] glass-card rounded-2xl animate-pulse" />
            </div>
            <div className="px-4 lg:px-0">
              <div className="h-16 rounded-2xl glass-card animate-pulse" />
            </div>
            <div className="px-4 lg:px-0">
              <div className="h-32 rounded-2xl glass-card animate-pulse" />
            </div>
          </div>
        </div>

        <div className="px-4 lg:px-0 mt-8">
          <div className="flex items-center justify-between mb-3">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">Your estate</p>
          </div>
          <div className="glass-card rounded-2xl overflow-hidden divide-y divide-slate-100 dark:divide-white/5">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-[60px] px-4 py-2.5 flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-slate-100 dark:bg-slate-700 animate-pulse flex-shrink-0" />
                <div className="flex-1 space-y-1.5">
                  <div className="h-3.5 w-28 bg-slate-100 dark:bg-slate-700 rounded animate-pulse" />
                  <div className="h-2.5 w-20 bg-slate-100 dark:bg-slate-700 rounded animate-pulse" />
                </div>
                <div className="h-3.5 w-14 bg-slate-100 dark:bg-slate-700 rounded animate-pulse" />
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Right column */}
      <div>
        <div className="px-4 mb-4 lg:px-0 mt-8 lg:mt-0">
          <div className="flex items-center justify-between mb-3">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500 lg:pt-0">Recent Transactions</p>
          </div>
          <div className="glass-card rounded-2xl overflow-hidden">
            <div className="p-4 space-y-3">
              {[1, 2, 3, 4, 5].map((i) => (
                <div key={i} className="flex items-center gap-3">
                  <div className="w-2.5 h-2.5 rounded-full bg-slate-200 dark:bg-slate-700 animate-pulse" />
                  <div className="flex-1 space-y-1">
                    <div className="h-3.5 w-36 bg-slate-200 dark:bg-slate-700 rounded animate-pulse" />
                    <div className="h-2.5 w-20 bg-slate-100 dark:bg-slate-700 rounded animate-pulse" />
                  </div>
                  <div className="h-3.5 w-14 bg-slate-200 dark:bg-slate-700 rounded animate-pulse" />
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function HomePage() {
  const router = useRouter();
  const { user } = useAuth();
  const firstName = user?.name?.split(" ")[0]?.trim();
  const { hideNetWorth, payPeriodConfig, region, homePinnedWidget } = usePreferences();
  const { colours } = useColours();
  // Read once per render so every initializer/guard below sees the same
  // snapshot — see lib/homeCache.ts for what this cache is and why it's
  // there.
  const homeCache = getHomeCache();
  const [accounts, setAccounts] = useState<Account[]>(homeCache?.accounts ?? []);
  const [investmentAccounts, setInvestmentAccounts] = useState<InvestmentAccount[]>(homeCache?.investmentAccounts ?? []);
  // Fed only by the lazy 90-day bulk fetch below, gated on homePinnedWidget —
  // the sole remaining consumer is the pinned chart widget via homeTxns.
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  // Recent Transactions' own small fetch, via the same GET /transactions/search
  // the /transactions hub uses (server-sorted across every source) — replaces
  // reading off the 90-day bulk fetch so the section paints without waiting
  // on it, and correction lands through TeachingSheet like everywhere else.
  const [recentTxns, setRecentTxns] = useState<Transaction[]>(homeCache?.recentTxns ?? []);
  // Bumped once per loadData call (mount and every handleSync) — re-couples
  // the lazy bulk-fetch effect below to loadData without pulling the fetch
  // itself back into loadData's own body. See that effect's comment.
  const [bulkNonce, setBulkNonce] = useState(0);
  const [safeToSpend, setSafeToSpend] = useState<SafeToSpend | null>(homeCache?.safeToSpend ?? null);
  // Cold-load-only initial value: `true` unless a warm `homeCache` snapshot
  // already exists (see that module-level cache's own doc comment), in
  // which case there is nothing to hold for and every gate below starts
  // pre-cleared.
  const [loading, setLoading] = useState(!homeCache);
  // Per-fetch skeleton gates: the Safe-to-Spend tile and the transactions
  // list each clear as soon as their OWN request settles — nothing waits on
  // the heavy 90-day transactions call (which no longer feeds this list at all).
  const [stsLoading, setStsLoading] = useState(!homeCache);
  const [txLoading, setTxLoading] = useState(!homeCache);
  const [loadError, setLoadError] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState(false);
  const [selectedTx, setSelectedTx] = useState<Transaction | null>(null);
  const [pinnedIds, setPinnedIds] = useState<string[]>([]);
  const { pinned: pinnedCards } = useHomePinnedCards();
  const [companionItems, setCompanionItems] = useState<CompanionItem[]>(homeCache?.companionItems ?? []);
  // Fed by HomeBrief's onClearedChange (see BriefBodyProps.onClearedChange
  // in HomeBrief.tsx) — HomeBriefClearedRow is mounted here, below
  // SafeToSpendCard, as HomeBrief's own sibling rather than its child, so
  // the "cleared" row's derived state has to travel up via this callback
  // instead of just being rendered in place.
  const [clearedAdvice, setClearedAdvice] = useState<{ count: number; type: CompanionItem["type"] } | null>(null);
  // Fed by HomeBrief's onInsightWinVisibleChange (see BriefBodyProps in
  // HomeBrief.tsx) — owner decision A1, Home dedup review 2026-08-31: while
  // a live insight_win celebration card is showing on Home, ValueDeliveredStat's
  // "£X/mo saved" chip below hides (one voice at a time, story then ledger).
  const [insightWinVisible, setInsightWinVisible] = useState(false);
  const [needle, setNeedle] = useState<NeedleSummary | null>(homeCache?.needle ?? null);
  const [needleStatus, setNeedleStatus] = useState<"loading" | "ready" | "failed">(homeCache?.needleStatus ?? "loading");

  // ── Full-page loading hold ───────────────────────────────────────────
  // The owner's call: hold the whole page until Home has settled, then
  // reveal the finished layout in one go, rather than letting each section
  // insert itself independently and shove the content the user is already
  // reading down the page. `pageReady` gates a single top-level
  // skeleton-vs-real-tree swap in the JSX below; nothing inside the real
  // tree's own conditional rendering changes, since it's mounted (fetching
  // normally, so the three self-fetching strips below can report in) but
  // hidden the whole time it isn't shown, and revealed with a plain
  // display toggle — no transition, no stagger, no fade (see req: no
  // visibility-gating animation on the reveal).
  const [pageReady, setPageReady] = useState(!!homeCache);
  // Readiness inputs this page cannot see on its own: UpcomingBillsStrip,
  // ThisMonthStrip and HomeInsightSpotlight each run their own fetch
  // (ThisMonthStrip only when HomePage hasn't handed it `summary`/
  // `summaryStatus` — see its own props). Each calls the onReady prop
  // wired below exactly once, in a `finally`, on both success and
  // failure, and never again on a later revalidation (retry, resync,
  // dismiss-and-reload) — see each file's own onReady wiring.
  const [billsReady, setBillsReady] = useState(!!homeCache);
  const [monthReady, setMonthReady] = useState(!!homeCache);
  const [spotlightReady, setSpotlightReady] = useState(!!homeCache);
  const onBillsReady = useCallback(() => setBillsReady(true), []);
  const onMonthReady = useCallback(() => setMonthReady(true), []);
  const onSpotlightReady = useCallback(() => setSpotlightReady(true), []);
  // Guards `reveal` below to a single call per mount — a warm mount starts
  // this (and `pageReady`) already true, so the readiness effect and the
  // timeout effect underneath both become instant no-ops for it.
  const revealedRef = useRef(!!homeCache);
  const reveal = useCallback(() => {
    if (revealedRef.current) return;
    revealedRef.current = true;
    setPageReady(true);
  }, []);
  // Every readiness input, ANDed together: HomePage's own primary fetches
  // (`loading` — accounts/investments/companion-items/needle/recent-txns,
  // see loadData below — plus `stsLoading` and `txLoading`, which clear
  // independently of `loading` for their own tiles) and the three
  // self-fetching children's onReady signals. If any one of these never
  // resolves (several of the underlying fetches already swallow errors
  // with `.catch(() => {})`), this effect simply never fires — that's what
  // the timeout effect below exists to cover.
  useEffect(() => {
    if (revealedRef.current) return;
    const allSettled = !loading && !stsLoading && !txLoading && billsReady && monthReady && spotlightReady;
    if (allSettled) reveal();
  }, [loading, stsLoading, txLoading, billsReady, monthReady, spotlightReady, reveal]);
  // Non-negotiable release valve: whatever hasn't arrived within 5000ms of
  // this mount is shown as-is (its own section falls back to its existing
  // inner skeleton/empty state) rather than leaving the user stuck on the
  // full-page skeleton indefinitely. No-op on a warm mount (revealedRef
  // already true).
  useEffect(() => {
    if (revealedRef.current) return;
    const t = setTimeout(reveal, 5000);
    return () => clearTimeout(t);
  }, [reveal]);
  // Keeps the module-level warm-paint cache current for the next mount —
  // only once this mount has itself completed a settle (guarded on
  // `revealedRef.current`), so a rapid double back-navigation during the
  // very first cold load can never seed the cache with empty/default data.
  useEffect(() => {
    if (!revealedRef.current) return;
    setHomeCache({ accounts, investmentAccounts, safeToSpend, companionItems, recentTxns, needle, needleStatus });
  });

  const loadData = useCallback(async () => {
    setLoadError(false);
    try {
      await ensureAuth();
      // Fire the fast calls all in parallel and set each state as its own
      // promise resolves. The Safe-to-Spend tile and brief never wait for
      // siblings, and Recent Transactions gets its own small search-endpoint
      // request here instead of reading off the heavy 90-day bulk fetch
      // (that one is now lazy — see the homePinnedWidget effect below).
      const accsP = api.accounts();
      const invP = api.getInvestmentAccounts();
      const safeP = api.safeToSpend();
      const todayP = api.getToday();
      const needleP = api.getNeedleSummary();
      // Over-fetch to 12 rather than 6: the micro-pot-shuffle filter below
      // (round-ups, penny transfers) can drop rows, and asking the server
      // for exactly 6 could leave fewer than 6 on screen after filtering.
      const recentTxP = api.transactionsSearch({ page: 1, page_size: 12 });
      // This is where the old code kicked off the 90-day bulk fetch
      // directly. It's lazy now (see the homePinnedWidget effect below), but
      // every loadData call — mount and every manual sync — still needs to
      // trigger a refresh of it when the widget is pinned, so bump the nonce
      // that effect is keyed on instead of awaiting the fetch here.
      setBulkNonce((n) => n + 1);

      invP.then((v) => setInvestmentAccounts(v)).catch(() => {});
      safeP
        .then((v) => setSafeToSpend(v))
        .catch(() => {})
        .finally(() => setStsLoading(false));
      todayP.then((v) => setCompanionItems(v.items)).catch(() => {});
      recentTxP
        .then((r) => setRecentTxns(r.items))
        .catch(() => setRecentTxns([]))
        .finally(() => setTxLoading(false));
      // Write-through for BottomNav's Penny dot (see lib/paydayWindow.ts) —
      // Home already fetches both of these for its own brief, so once they
      // resolve, hand the same boolean to the nav's cache instead of letting
      // its hook fire a redundant copy of the same two requests.
      Promise.all([todayP, safeP])
        .then(([today, sts]) => {
          const hasLivePlan = today.items.some((i) => i.type === "payday_plan");
          writePaydayDotCache(isPaydayWindowActive({
            hasLivePlan,
            daysUntilPayday: sts.status === "ok" ? sts.days_until_payday : null,
          }));
        })
        .catch(() => {});
      needleP
        .then((v) => { setNeedle(v); setNeedleStatus("ready"); })
        .catch(() => setNeedleStatus("failed"));

      let loadedAccounts: Account[] = [];
      try {
        loadedAccounts = await accsP;
        setAccounts(loadedAccounts);
      } catch {
        setLoadError(true);
        return;
      }

      // Let the remaining fast calls settle, then clear the page-level
      // skeletons. recentTxP and safeP each clear their own skeleton
      // (txLoading, stsLoading) independently as they settle, above.
      await Promise.allSettled([invP, safeP, todayP, needleP, recentTxP]);
      setLoading(false);
    } catch {}
    finally {
      setLoading(false);
      setStsLoading(false);
      // Belt-and-braces: if an early exit (e.g. ensureAuth throwing) lands us
      // here before recentTxP was ever created, its own .finally above never
      // runs and this skeleton would otherwise be stuck on forever.
      setTxLoading(false);
    }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  // Tour readiness: `loading` only clears once accsP (estate section) and
  // safeP (hero) have both settled (see loadData above), so it already
  // covers both anchors below — no need to also gate on stsLoading/txLoading.
  // Also gated on `pageReady`: the anchored elements live in the real tree,
  // which stays display:none until the page-level hold releases (see
  // `pageReady` above), so they aren't actually painted before then even
  // once `loading` itself has cleared.
  useTutorialReady("home", pageReady && !loading);

  // The 90-day bulk fetch (transactions state) now feeds only the opt-in
  // pinned chart widget below, via homeTxns — Recent Transactions has its
  // own small fetch above. Deferred to its own effect, keyed on
  // homePinnedWidget, so the common case (nothing pinned) never pays for a
  // 90-day fetch across every account. homePinnedWidget comes from
  // usePreferences() and can arrive after first paint (it fetches
  // /preferences once, async), so this effect re-fires whenever the value
  // changes rather than running once on mount — it no-ops while unset.
  // bulkNonce is what re-couples this fetch to loadData/handleSync: it's
  // bumped once per loadData call, so a manual sync still refreshes the
  // pinned widget's data exactly as it did before this fetch was pulled out
  // of loadData's own body — while an unpinned widget still costs nothing,
  // since the guard below returns before the fetch (or any nonce bump from
  // this effect itself) can happen.
  useEffect(() => {
    if (!homePinnedWidget) return;
    let cancelled = false;
    api.allTransactions(90)
      .then((v) => { if (!cancelled) setTransactions(v); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [homePinnedWidget, bulkNonce]);

  // Cross-page pin staleness (F3 review correction): PreferencesContext
  // fetches /preferences exactly once per full page load and never
  // refreshes on client-side navigation, so deriving pinnedIds from rawPrefs
  // alone would miss pins toggled elsewhere — e.g. AccountsPage.togglePin
  // writes preferences directly, bypassing this context — until a hard
  // reload. PreferencesContext.tsx and AccountsPage.tsx are outside this
  // fix's touched-files, so re-fetch preferences directly on every Home
  // mount instead of trusting the (possibly stale) context snapshot.
  useEffect(() => {
    let cancelled = false;
    api.getPreferences()
      .then((p) => { if (!cancelled) setPinnedIds(p.home_pinned_accounts ?? []); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const [stickyHeaderVisible, setStickyHeaderVisible] = useState(false);
  const greetingRef = useRef<HTMLDivElement>(null);
  const syncErrorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  async function handleSync() {
    setSyncing(true);
    setSyncError(false);
    if (syncErrorTimerRef.current) clearTimeout(syncErrorTimerRef.current);
    try {
      await api.syncAll();
      invalidateTransactionsCache();
      await loadData();
    } catch {
      setSyncError(true);
      syncErrorTimerRef.current = setTimeout(() => setSyncError(false), 6000);
    } finally {
      setSyncing(false);
    }
  }

  useEffect(() => {
    return () => { if (syncErrorTimerRef.current) clearTimeout(syncErrorTimerRef.current); };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const el = greetingRef.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      ([entry]) => setStickyHeaderVisible(!entry.isIntersecting),
      { threshold: 0, rootMargin: "0px" }
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  function handleTxUpdated(updated: Transaction, additionalIds?: string[]) {
    const patch = (prev: Transaction[]) =>
      prev.map((t) => {
        if (t.id === updated.id) return { ...t, category: updated.category };
        if (additionalIds?.includes(t.id)) return { ...t, category: updated.category };
        return t;
      });
    // `transactions` still feeds the pinned chart widget below; `recentTxns`
    // is what this screen's own Recent Transactions row actually renders —
    // both need the correction so it's visible immediately, wherever it's read.
    setTransactions(patch);
    setRecentTxns(patch);
  }

  // Spending totals are home-currency only; the recent list still shows
  // foreign-currency transactions with their own symbol
  const homeTxns = useMemo(
    () => transactions.filter(t => isHomeCurrency(t.currency, region)),
    [transactions, region]
  );

  // Micro pot-shuffles (round-ups, penny transfers) aren't "activity" worth
  // a slot on the home screen — this is why recentTxns over-fetches 12
  // above, so 6 real rows usually survive this filter.
  const recent = recentTxns
    .filter(t => !(t.category === "Transfer" && t.amount < 1))
    .slice(0, 6);

  // Top picks: expired connections first (action needed), then the user's
  // pins from the Accounts page, then autofill with the biggest balances
  const topPickAccounts = useMemo(() => {
    const picks: Account[] = [];
    const seen = new Set<string>();
    const add = (a?: Account) => { if (a && !seen.has(a.id)) { seen.add(a.id); picks.push(a); } };
    accounts.filter(a => a.status === "expired").forEach(add);
    pinnedIds.forEach(id => add(accounts.find(a => a.id === id)));
    const isSavings = (a: Account) => (a.subtype ?? "").toLowerCase().includes("saving");
    const isCredit  = (a: Account) => a.type.toLowerCase().includes("credit") || (a.subtype ?? "").toLowerCase().includes("credit");
    const current = accounts.filter(a => !isSavings(a) && !isCredit(a)).sort((x, y) => y.balance - x.balance);
    const savings = accounts.filter(isSavings).sort((x, y) => y.balance - x.balance);
    for (const a of [...current, ...savings]) { if (picks.length >= 3) break; add(a); }
    return picks.slice(0, 3);
  }, [accounts, pinnedIds]);

  const hiddenAccountCount =
    Math.max(0, accounts.length - topPickAccounts.length) +
    Math.max(0, investmentAccounts.length - 1);

  const expiredProviders = useMemo(() => {
    const seen = new Set<string>();
    const result: { provider: string; provider_id?: string }[] = [];
    for (const a of accounts) {
      if (a.status === "expired" && !seen.has(a.provider)) {
        seen.add(a.provider);
        result.push({ provider: a.provider, provider_id: a.provider_id });
      }
    }
    return result;
  }, [accounts]);

  async function handleReconnect(providerId?: string) {
    try {
      const { auth_url } = await api.connectLink(providerId);
      window.location.href = auth_url;
    } catch {}
  }

  // ── Fresh-user (no connected data) detection ────────────────────────────
  // Same condition the "Your estate" empty state already used
  // (accounts.length === 0), extended to also require zero investment
  // accounts, a settled load, AND no load error — this is the "nothing
  // connected yet" state that leads with onboarding instead of empty
  // account/Safe-to-Spend shells. Without the !loadError guard, a real
  // user whose /accounts fetch simply failed would see the "Connect your
  // first bank" hero and a blanked brief instead of the load-error retry UI.
  const isFreshUser = !loading && !loadError && accounts.length === 0 && investmentAccounts.length === 0;
  // Undefined while accounts are still loading (so PaydayPlanSection's
  // hasAccounts guard doesn't prematurely suppress a real user's entry row
  // before their accounts have arrived) — settles to a real boolean once
  // `loading` clears.
  const hasAccountsForBrief = loading ? undefined : accounts.length > 0 || investmentAccounts.length > 0;

  // ── Attention glow — at most one card glows per screen; priority resolved
  // centrally so no component can independently decide to glow (lib/attention.ts).
  // No fallback rung: Safe-to-Spend no longer glows on its own tight/short
  // verdict (removed 2026-08-18, see lib/attention.ts doctrine comment).
  // "reconnect" was removed from the resolver entirely (2026-08-28, see
  // lib/attention.ts) — the expired-provider banner's own amber icon chip is
  // its attention voice now. "payday" was removed the same way (2026-08-29,
  // owner: no glow/ring on the payday plan card) — the card's own Penny
  // branding and hero figure are its attention voice. Sync error is now the
  // only rung; when it's clear, nothing on Home glows.
  const attn = resolveAttention({ syncError });

  // Reauth banner — rendered inside HomeBrief, directly under the greeting
  // row (2026-08-28, phone review, second time): a dead connection means
  // every figure below it (Safe-to-Spend, the month strip, the payday plan
  // card) may be stale, so it must outrank all of them, including the
  // payday plan card that lives INSIDE HomeBrief. Passing it as a sibling
  // after the <HomeBrief> div (the previous fix) still left it below that
  // card, since the greeting and the payday plan both render inside
  // HomeBrief itself — only HomeBrief's own `banner` slot sits above both.
  //
  // Shape: Variant C, "quiet strip, progressive disclosure" (chosen by the
  // owner 2026-08-28 from the three coded directions at /design/reconnect,
  // see app/design/reconnect/ReconnectClient.tsx), replacing the interim
  // glass-card-per-provider format above. A status dot is the amber
  // signifier now, not an icon chip — the quietest cue the app has — and
  // N>1 collapses behind a native disclosure instead of stacking one full
  // card per provider. No glow (see lib/attention.ts): the status dot is
  // this banner's own attention voice, so "reconnect" was removed from the
  // attention resolver outright rather than gated here.
  const reauthBanner = expiredProviders.length > 0 && (
    <ReconnectStrip providers={expiredProviders} onReconnect={handleReconnect} />
  );

  return (
    <div className="relative isolate min-h-dvh pb-[calc(9rem+env(safe-area-inset-bottom,0px))] lg:pb-8" style={{ paddingTop: "env(safe-area-inset-top, 0px)" }}>
      {/* Sticky desktop header — appears when greeting scrolls out of view */}
      {stickyHeaderVisible && (
        <div className="hidden lg:flex fixed top-0 z-40 items-center gap-3 px-6 h-14 bg-white/85 dark:bg-slate-900/85 backdrop-blur-md border-b border-slate-100 dark:border-slate-800 fade-in"
          style={{ left: "16rem", right: 0 }}>
          <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">
            {firstName ? `Hi, ${firstName}` : "Welcome back"}
          </p>
        </div>
      )}
      {/* Full-page skeleton — cold loads only, see `pageReady` above. The
          real tree below stays mounted the whole time (so the three
          self-fetching strips can report their onReady in) but hidden via
          a plain display toggle, never unmounted, so nothing here ever
          double-fetches and the reveal is instant with no transition. */}
      {!pageReady && <HomeSkeleton firstName={firstName} />}

      {/* Desktop 2-col grid wrapper */}
      <div
        className="lg:grid lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)] lg:gap-6 lg:p-6 lg:max-w-7xl lg:mx-auto"
        style={pageReady ? undefined : { display: "none" }}
      >

        {/* ── Left column: brief, KPIs, accounts, donut ── */}
        <div>

          {/* ── THE BRIEF ── */}
          <div className="px-4 pt-6 lg:px-0 lg:pt-0" ref={greetingRef}>
            <HomeBrief
              items={isFreshUser ? [] : companionItems}
              firstName={firstName}
              safeToSpend={safeToSpend}
              loading={loading}
              syncing={syncing}
              syncError={syncError}
              onSync={handleSync}
              hideNetWorth={hideNetWorth}
              onRefresh={loadData}
              attnTarget={attn}
              dismissible
              hasAccounts={hasAccountsForBrief}
              onClearedChange={setClearedAdvice}
              onInsightWinVisibleChange={setInsightWinVisible}
              banner={reauthBanner}
            />
          </div>

          {/* ── Fresh user (nothing connected yet): lead with onboarding ──
              Directly under the greeting/brief. This is the single instance
              of the "Connect your first bank" hero — the "Your estate"
              section below is suppressed entirely in this state so it never
              duplicates. */}
          {isFreshUser && (
            <div data-tutorial-id="tutorial-home-fresh" className="px-4 lg:px-0 mt-6">
              <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-sm p-5">
                <p className="text-sm font-semibold text-slate-800 dark:text-slate-100 mb-1">
                  Connect your first bank
                </p>
                <p className="text-sm text-slate-500 dark:text-slate-400 mb-4 leading-snug">
                  Read-only access through open banking, we can never move your money.
                </p>
                <button
                  onClick={() => handleReconnect()}
                  data-tutorial-id="tutorial-home-fresh-cta"
                  className="w-full bg-indigo-600 hover:bg-indigo-700 active:scale-95 transition-[transform,background-color] text-white text-sm font-semibold rounded-xl py-2.5 px-4"
                >
                  Connect a bank
                </button>
              </div>
            </div>
          )}

          {/* Load error fallback */}
          {loadError && (
            <div className="px-4 lg:px-0 mt-4">
              <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-sm p-5 text-center">
                <p className="text-sm font-medium text-slate-600 dark:text-slate-300 mb-3">
                  Couldn&apos;t load your data, check your connection.
                </p>
                <button
                  onClick={() => { setLoading(true); setStsLoading(true); setTxLoading(true); setLoadError(false); loadData(); }}
                  className="w-full bg-indigo-600 hover:bg-indigo-700 active:scale-95 transition-[transform,background-color] text-white text-sm font-semibold rounded-xl py-2.5 px-4"
                >
                  Try again
                </button>
              </div>
            </div>
          )}

          {/* ── WHERE YOU STAND ── suppressed for a fresh user: no accounts
              means no real Safe-to-Spend data, and it must never render a
              "£0" shell — the onboarding hero above is the whole story. */}
          {!loadError && !isFreshUser && (
            <div data-tutorial-id="tutorial-safe-to-spend" className="rise-in px-4 lg:px-0 mt-8" style={{ "--rise-index": 1 } as React.CSSProperties}>
              {/* Verdict card */}
              {(() => {
                const hasRealData = safeToSpend != null && safeToSpend.status !== "insufficient_data";
                const hasMoveItem = companionItems.some(i => i.type === "move");
                if (stsLoading || hasRealData) {
                  return (
                    <SafeToSpendCard
                      data={safeToSpend}
                      loading={stsLoading}
                      suppressCTA={hasMoveItem}
                      cardDeltaSoFar={needle?.current?.card_delta_so_far ?? null}
                    />
                  );
                }
                return null;
              })()}

              {/* Cleared-advice pointer — see HomeBriefClearedRow's doc
                  comment in components/HomeBrief.tsx for why this state
                  exists. Mounted here, below the verdict, rather than inside
                  HomeBrief above it: Home's top slot answers "am I okay",
                  and a routing pointer to Penny isn't that answer. Renders
                  nothing when there's nothing cleared to point at. */}
              {!loading && (
                <HomeBriefClearedRow cleared={clearedAdvice} router={router} />
              )}

              {/* Potential-savings index — "How your money behaves" (the
                  Mirror row) relocated to its own rich entry card on the
                  Penny screen (its permanent home now), reached via the
                  nav's Penny button. */}
              {!loading && !insightWinVisible && <ValueDeliveredStat />}
            </div>
          )}

          {/* ── YOUR MONEY ── suppressed for a fresh user (bills/spend
              strips have nothing to show without connected accounts). */}
          {!loadError && !isFreshUser && (
            <div className="rise-in mt-8" style={{ "--rise-index": 2 } as React.CSSProperties}>
              <div className="px-4 lg:px-0 mb-3">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
                  Your money
                </p>
              </div>
              <div className="space-y-3">
                <UpcomingBillsStrip onReady={onBillsReady} />
                <ThisMonthStrip summary={needle} summaryStatus={needleStatus} onReady={onMonthReady} />
                <HomeInsightSpotlight onReady={onSpotlightReady} />
              </div>
            </div>
          )}

          {/* ── Below zones: demoted supporting content ── */}

          {/* User-pinned insight cards (fuel prices, grocery baskets, chart widget) */}
          {!isFreshUser && !loading && (pinnedCards.includes("fuel") || pinnedCards.includes("groceries") || (homePinnedWidget && homeTxns.length > 0)) && (
            <div className="mt-8 space-y-3 px-4 lg:px-0">
              {pinnedCards.includes("fuel") && <FuelSavingsCard />}
              {pinnedCards.includes("groceries") && <GroceryBasketCard />}
              {homePinnedWidget && homeTxns.length > 0 && (() => {
                const [ps, pe] = getPayPeriodWithConfig(new Date(), payPeriodConfig);
                return (
                  <PinnedWidgetCard
                    id={homePinnedWidget}
                    transactions={homeTxns}
                    periodStart={ps}
                    periodEnd={pe}
                    payPeriodConfig={payPeriodConfig}
                    colours={colours}
                    onOpen={() => router.push("/spend?view=trends")}
                  />
                );
              })()}
            </div>
          )}

          {/* Accounts — pinned/expired top picks in a grid, rest behind
              "+N more". Suppressed entirely for a fresh user: the single
              "Connect your first bank" hero already rendered at the top of
              the page owns that job, so this section (which would otherwise
              render its own copy of the same empty state) is skipped rather
              than duplicated. */}
          {!isFreshUser && (
            <div className="rise-in px-4 lg:px-0 mt-8" style={{ "--rise-index": 3 } as React.CSSProperties}>
              <div className="flex items-center justify-between mb-3">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">Your estate</p>
                <div className="flex items-center gap-2">
                  <button
                    data-tutorial-id="tutorial-manage-link"
                    onClick={() => router.push("/accounts")}
                    className="min-h-[44px] text-xs font-semibold text-indigo-500 dark:text-indigo-400 flex items-center gap-1 hover:opacity-80 active:opacity-70 transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 rounded"
                  >
                    Manage <ChevronRight size={13} aria-hidden="true" />
                  </button>
                </div>
              </div>
              {loading ? (
                <div className="glass-card rounded-2xl overflow-hidden divide-y divide-slate-100 dark:divide-white/5">
                  {[1, 2, 3].map((i) => (
                    <div key={i} className="h-[60px] px-4 py-2.5 flex items-center gap-3">
                      <div className="w-9 h-9 rounded-xl bg-slate-100 dark:bg-slate-700 animate-pulse flex-shrink-0" />
                      <div className="flex-1 space-y-1.5">
                        <div className="h-3.5 w-28 bg-slate-100 dark:bg-slate-700 rounded animate-pulse" />
                        <div className="h-2.5 w-20 bg-slate-100 dark:bg-slate-700 rounded animate-pulse" />
                      </div>
                      <div className="h-3.5 w-14 bg-slate-100 dark:bg-slate-700 rounded animate-pulse" />
                    </div>
                  ))}
                </div>
              ) : accounts.length === 0 ? (
                <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-sm p-5">
                  <p className="text-sm font-semibold text-slate-800 dark:text-slate-100 mb-1">
                    Connect your first bank
                  </p>
                  <p className="text-sm text-slate-500 dark:text-slate-400 mb-4 leading-snug">
                    Read-only access through open banking, we can never move your money.
                  </p>
                  <button
                    onClick={() => handleReconnect()}
                    className="w-full bg-indigo-600 hover:bg-indigo-700 active:scale-95 transition-[transform,background-color] text-white text-sm font-semibold rounded-xl py-2.5 px-4"
                  >
                    Connect a bank
                  </button>
                </div>
              ) : (
                <div className="glass-card rounded-2xl overflow-hidden">
                  {topPickAccounts.map((acc, i) => (
                    <div key={acc.id} className={i > 0 ? "border-t border-slate-100 dark:border-white/5" : ""}>
                      <AccountLedgerRow
                        row={bankToRow(acc, pinnedIds)}
                        onClick={() => router.push(`/accounts?id=${acc.id}`)}
                      />
                    </div>
                  ))}
                  {investmentAccounts.slice(0, 1).map((inv) => (
                    <div key={inv.id} className={topPickAccounts.length > 0 ? "border-t border-slate-100 dark:border-white/5" : ""}>
                      <AccountLedgerRow
                        row={investmentToRow(inv)}
                        onClick={() => router.push("/accounts?tab=Investments")}
                      />
                    </div>
                  ))}
                  {hiddenAccountCount > 0 && (
                    <button
                      onClick={() => router.push("/accounts")}
                      className={`w-full min-h-[52px] flex items-center justify-center gap-1 px-4 py-2.5 text-sm font-medium text-slate-400 dark:text-slate-500 active:bg-slate-50 dark:active:bg-white/5 transition-colors ${
                        topPickAccounts.length + Math.min(investmentAccounts.length, 1) > 0 ? "border-t border-slate-100 dark:border-white/5" : ""
                      }`}
                    >
                      +{hiddenAccountCount} more accounts <ChevronRight size={13} aria-hidden="true" />
                    </button>
                  )}
                </div>
              )}
            </div>
          )}

        </div>

        {/* ── Right column: recent transactions ── */}
        <div className="rise-in" style={{ "--rise-index": 4 } as React.CSSProperties}>
          <div className="px-4 mb-4 lg:px-0 mt-8 lg:mt-0" data-tutorial-id="tutorial-recent-transactions">
            <div className="flex items-center justify-between mb-3">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500 lg:pt-0">Recent Transactions</p>
              <button
                onClick={() => router.push("/transactions")}
                className="text-xs font-semibold text-indigo-500 dark:text-indigo-400 flex items-center gap-1 hover:opacity-80 active:opacity-70 transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 rounded"
              >
                See all <ChevronRight size={13} aria-hidden="true" />
              </button>
            </div>
            <div className="glass-card rounded-2xl overflow-hidden lg:max-h-[calc(100vh-120px)] lg:overflow-y-auto">
              {txLoading ? (
                <div className="p-4 space-y-3">
                  {[1, 2, 3, 4, 5].map((i) => (
                    <div key={i} className="flex items-center gap-3">
                      <div className="w-2.5 h-2.5 rounded-full bg-slate-200 dark:bg-slate-700 animate-pulse" />
                      <div className="flex-1 space-y-1">
                        <div className="h-3.5 w-36 bg-slate-200 dark:bg-slate-700 rounded animate-pulse" />
                        <div className="h-2.5 w-20 bg-slate-100 dark:bg-slate-700 rounded animate-pulse" />
                      </div>
                      <div className="h-3.5 w-14 bg-slate-200 dark:bg-slate-700 rounded animate-pulse" />
                    </div>
                  ))}
                </div>
              ) : recent.length === 0 ? (
                <div className="py-8 text-center">
                  <p className="text-sm text-slate-400 dark:text-slate-500">No transactions yet</p>
                </div>
              ) : (
                <div className="divide-y divide-slate-50 dark:divide-slate-700">
                  {recent.map((tx) => (
                    <TransactionRow
                      key={tx.id}
                      transaction={tx}
                      onClick={() => setSelectedTx(tx)}
                    />
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {selectedTx && (
        <TeachingSheet
          transaction={selectedTx}
          onClose={() => setSelectedTx(null)}
          onUpdated={handleTxUpdated}
          account={accounts.find(a => a.id === selectedTx.account_id)}
        />
      )}

      <BottomNav />
    </div>
  );
}
