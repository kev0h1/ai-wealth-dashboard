"use client";

import { useEffect, useState, useCallback, useMemo, useRef } from "react";
import dynamic from "next/dynamic";
import { ChevronRight, AlertTriangle, ScanFace } from "lucide-react";
import { api, Account, Transaction, InvestmentAccount, SafeToSpend, CompanionItem, NeedleSummary } from "@/lib/api";
import { getToken, setToken } from "@/lib/auth";
import SafeToSpendCard from "@/components/SafeToSpendCard";
import AccountMiniCard from "@/components/AccountMiniCard";
import InvestmentMiniCard from "@/components/InvestmentMiniCard";
import TransactionRow from "@/components/TransactionRow";
import TransactionSheet from "@/components/TransactionSheet";
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
import HomeBrief from "@/components/HomeBrief";
import { invalidateTransactionsCache } from "@/lib/useAllTransactions";
import { resolveAttention } from "@/lib/attention";

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

export default function HomePage() {
  const router = useRouter();
  const { user } = useAuth();
  const firstName = user?.name?.split(" ")[0]?.trim();
  const { hideNetWorth, payPeriodConfig, region, homePinnedWidget } = usePreferences();
  const { colours } = useColours();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [investmentAccounts, setInvestmentAccounts] = useState<InvestmentAccount[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [safeToSpend, setSafeToSpend] = useState<SafeToSpend | null>(null);
  const [loading, setLoading] = useState(true);
  // Per-fetch skeleton gates: the Safe-to-Spend tile and the transactions
  // list each clear as soon as their OWN request settles — nothing waits on
  // the heavy 90-day transactions call.
  const [stsLoading, setStsLoading] = useState(true);
  const [txLoading, setTxLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState(false);
  const [hasUrgentBill, setHasUrgentBill] = useState(false);
  const [selectedTx, setSelectedTx] = useState<Transaction | null>(null);
  const [pinnedIds, setPinnedIds] = useState<string[]>([]);
  const { pinned: pinnedCards } = useHomePinnedCards();
  const [companionItems, setCompanionItems] = useState<CompanionItem[]>([]);
  const [needle, setNeedle] = useState<NeedleSummary | null>(null);
  const [needleStatus, setNeedleStatus] = useState<"loading" | "ready" | "failed">("loading");

  const loadData = useCallback(async () => {
    setLoadError(false);
    try {
      await ensureAuth();
      // Fire the fast calls — and the heavy 90-day transactions fetch — all
      // in parallel and set each state as its own promise resolves. The
      // Safe-to-Spend tile and brief never wait for siblings, and the
      // transactions request starts alongside accounts instead of after it.
      const accsP = api.accounts();
      const invP = api.getInvestmentAccounts();
      const safeP = api.safeToSpend();
      const todayP = api.getToday();
      const needleP = api.getNeedleSummary();
      const txP = api.allTransactions(90).catch(() => [] as Transaction[]);

      invP.then((v) => setInvestmentAccounts(v)).catch(() => {});
      safeP
        .then((v) => setSafeToSpend(v))
        .catch(() => {})
        .finally(() => setStsLoading(false));
      todayP.then((v) => setCompanionItems(v.items)).catch(() => {});
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
      // skeletons — before the transactions fetch starts blocking anything.
      await Promise.allSettled([invP, safeP, todayP, needleP]);
      setLoading(false);

      // One bulk call (already server-sorted) instead of one per account.
      // Only the recent-transactions skeleton (txLoading) waits on this.
      const allTxns = await txP;
      if (loadedAccounts.length > 0) setTransactions(allTxns);
    } catch {}
    finally {
      setLoading(false);
      setStsLoading(false);
      setTxLoading(false);
    }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

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
    setTransactions((prev) =>
      prev.map((t) => {
        if (t.id === updated.id) return { ...t, category: updated.category };
        if (additionalIds?.includes(t.id)) return { ...t, category: updated.category };
        return t;
      })
    );
  }

  // Spending totals are home-currency only; the recent list still shows
  // foreign-currency transactions with their own symbol
  const homeTxns = useMemo(
    () => transactions.filter(t => isHomeCurrency(t.currency, region)),
    [transactions, region]
  );

  // Micro pot-shuffles (round-ups, penny transfers) aren't "activity" worth
  // a slot on the home screen
  const recent = transactions
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

  // ── Attention glow — at most one card glows per screen; priority resolved
  // centrally so no component can independently decide to glow (lib/attention.ts).
  const heroNeedsAttention =
    safeToSpend?.status === "ok" && (safeToSpend.state === "tight" || safeToSpend.state === "short");
  const hasLivePlan = companionItems.some(i => i.type === "payday_plan");
  const attn = resolveAttention({
    hasExpiredProvider: expiredProviders.length > 0,
    syncError,
    hasUrgentBill,
    hasLivePlan,
    heroNeedsAttention: !!heroNeedsAttention,
  });

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
      {/* Desktop 2-col grid wrapper */}
      <div className="lg:grid lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)] lg:gap-6 lg:p-6 lg:max-w-7xl lg:mx-auto">

        {/* ── Left column: brief, KPIs, accounts, donut ── */}
        <div>

          {/* ── THE BRIEF ── */}
          <div className="px-4 pt-6 lg:px-0 lg:pt-0" ref={greetingRef}>
            <HomeBrief
              items={companionItems}
              firstName={firstName}
              safeToSpend={safeToSpend}
              loading={loading}
              syncing={syncing}
              syncError={syncError}
              onSync={handleSync}
              hideNetWorth={hideNetWorth}
              onRefresh={loadData}
              attnTarget={attn}
            />
          </div>

          {/* Load error fallback */}
          {loadError && (
            <div className="px-4 lg:px-0 mt-4">
              <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-sm p-5 text-center">
                <p className="text-sm font-medium text-slate-600 dark:text-slate-300 mb-3">
                  Couldn&apos;t load your data — check your connection.
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

          {/* ── WHERE YOU STAND ── */}
          {!loadError && (
            <div className="rise-in px-4 lg:px-0 mt-8" style={{ "--rise-index": 1 } as React.CSSProperties}>
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
                      glow={attn === "hero"}
                    />
                  );
                }
                return null;
              })()}

              {/* Unified index block — savings + mirror */}
              {!loading && (
                <div className="mt-3 rounded-2xl glass-card px-4">
                  <div className="divide-y divide-slate-100 dark:divide-slate-700/50">
                    {/* Row 1: Potential savings */}
                    <ValueDeliveredStat />

                    {/* Row 2: The Mirror */}
                    <button
                      onClick={() => router.push("/mirror")}
                      className="w-full min-h-[44px] flex items-center justify-between hover:opacity-80 active:scale-[0.98] transition-[transform,opacity] duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-inset rounded-lg"
                    >
                      <div className="flex items-center gap-2">
                        <ScanFace size={15} aria-hidden="true" className="text-slate-400 flex-shrink-0" />
                        <span className="text-sm font-medium text-slate-600 dark:text-slate-300">How your money behaves</span>
                      </div>
                      <span className="text-sm text-slate-400 dark:text-slate-500">›</span>
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Reauth banners */}
          {expiredProviders.map(({ provider, provider_id }, idx) => (
            <div
              key={provider}
              className={`mt-4 mx-4 flex items-center gap-3 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-2xl px-4 py-3 lg:mx-0${attn === "reconnect" && idx === 0 ? " needs-you" : ""}`}
            >
              <AlertTriangle size={15} aria-hidden="true" className="text-amber-500 flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-amber-800 dark:text-amber-200">{provider} needs reconnecting</p>
                <p className="text-[11px] text-amber-600 dark:text-amber-400 leading-tight">Transactions have stopped syncing.</p>
              </div>
              <button
                onClick={() => handleReconnect(provider_id)}
                className="flex-shrink-0 text-xs font-semibold bg-amber-500 hover:bg-amber-600 active:scale-95 transition-[transform,background-color] text-white px-3 py-1.5 rounded-lg"
              >
                Reconnect
              </button>
            </div>
          ))}

          {/* ── YOUR MONEY ── */}
          {!loadError && (
            <div className="rise-in mt-8" style={{ "--rise-index": 2 } as React.CSSProperties}>
              <div className="px-4 lg:px-0 mb-3">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
                  Your money
                </p>
              </div>
              <div className="space-y-3">
                <UpcomingBillsStrip glow={attn === "bill"} onUrgentChange={setHasUrgentBill} />
                <ThisMonthStrip summary={needle} summaryStatus={needleStatus} />
                <HomeInsightSpotlight />
              </div>
            </div>
          )}

          {/* ── Below zones: demoted supporting content ── */}

          {/* User-pinned insight cards (fuel prices, grocery baskets, chart widget) */}
          {!loading && (pinnedCards.includes("fuel") || pinnedCards.includes("groceries") || (homePinnedWidget && homeTxns.length > 0)) && (
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

          {/* Accounts — pinned/expired top picks in a grid, rest behind "+N more" */}
          <div className="rise-in px-4 lg:px-0 mt-8" style={{ "--rise-index": 3 } as React.CSSProperties}>
            <div className="flex items-center justify-between mb-3">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">Your estate</p>
              <div className="flex items-center gap-2">
                <button
                  data-tutorial-id="tutorial-manage-link"
                  onClick={() => router.push("/accounts")}
                  className="text-xs font-semibold text-indigo-500 dark:text-indigo-400 flex items-center gap-1 hover:opacity-80 active:opacity-70 transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 rounded"
                >
                  Manage <ChevronRight size={14} aria-hidden="true" />
                </button>
              </div>
            </div>
            {loading ? (
              <div className="grid grid-cols-2 gap-3">
                {[1, 2, 3, 4].map((i) => (
                  <div key={i} className="h-28 bg-white dark:bg-slate-800 rounded-2xl animate-pulse shadow-sm" />
                ))}
              </div>
            ) : accounts.length === 0 ? (
              <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-sm p-5">
                <p className="text-sm font-semibold text-slate-800 dark:text-slate-100 mb-1">
                  Connect your first bank
                </p>
                <p className="text-sm text-slate-500 dark:text-slate-400 mb-4 leading-snug">
                  Read-only access through open banking — we can never move your money.
                </p>
                <button
                  onClick={() => handleReconnect()}
                  className="w-full bg-indigo-600 hover:bg-indigo-700 active:scale-95 transition-[transform,background-color] text-white text-sm font-semibold rounded-xl py-2.5 px-4"
                >
                  Connect a bank
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-3">
                {topPickAccounts.map((acc, i) => (
                  <AccountMiniCard
                    key={acc.id}
                    account={acc}
                    grid
                    calm
                    glass
                    index={i}
                    hidden={hideNetWorth}
                    onClick={() => router.push(`/accounts?id=${acc.id}`)}
                  />
                ))}
                {investmentAccounts.slice(0, 1).map((inv, i) => (
                  <InvestmentMiniCard
                    key={inv.id}
                    account={inv}
                    grid
                    calm
                    glass
                    index={topPickAccounts.length + i}
                    hidden={hideNetWorth}
                    onClick={() => router.push("/accounts?tab=Investments")}
                  />
                ))}
                {hiddenAccountCount > 0 && (
                  <button
                    onClick={() => router.push("/accounts")}
                    className="rounded-2xl border-2 border-dashed border-slate-200 dark:border-slate-700 flex flex-col items-center justify-center gap-1 text-slate-400 dark:text-slate-500 hover:opacity-80 active:scale-95 transition-[transform,opacity] min-h-[7rem]"
                  >
                    <span className="text-lg font-bold">+{hiddenAccountCount}</span>
                    <span className="text-xs font-medium">more accounts</span>
                  </button>
                )}
              </div>
            )}
          </div>

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
        <TransactionSheet
          transaction={selectedTx}
          onClose={() => setSelectedTx(null)}
          onUpdated={handleTxUpdated}
          account={accounts.find(a => a.id === selectedTx.account_id) ? { name: accounts.find(a => a.id === selectedTx.account_id)!.name, provider: accounts.find(a => a.id === selectedTx.account_id)!.provider } : undefined}
        />
      )}

      <BottomNav />
    </div>
  );
}
