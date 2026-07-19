"use client";

import { useEffect, useLayoutEffect, useState, useCallback, useMemo, useRef } from "react";
import { RefreshCw, ChevronRight, AlertTriangle, TrendingUp } from "lucide-react";
import { api, Account, Transaction, KPIs, InvestmentAccount } from "@/lib/api";
import { getToken, setToken } from "@/lib/auth";
import NetWorthCard from "@/components/NetWorthCard";
import AccountMiniCard from "@/components/AccountMiniCard";
import InvestmentMiniCard from "@/components/InvestmentMiniCard";
import TransactionRow from "@/components/TransactionRow";
import TransactionSheet from "@/components/TransactionSheet";
import BottomNav from "@/components/BottomNav";
import { usePreferences } from "@/components/PreferencesContext";
import { useAuth } from "@/components/AuthProvider";
import { useRouter } from "next/navigation";
import { getPayPeriodWithConfig } from "@/lib/payPeriod";
import TutorialTrigger from "@/components/TutorialTrigger";
import HomeInsightSpotlight from "@/components/HomeInsightSpotlight";
import ValueDeliveredStat from "@/components/ValueDeliveredStat";
import UpcomingBillsStrip from "@/components/UpcomingBillsStrip";
import GoalsStrip from "@/components/GoalsStrip";
import MoneyAdvisorChat from "@/components/MoneyAdvisorChat";
import { PinnedWidgetCard } from "@/components/SpendTrends";
import { useColours } from "@/components/ColourProvider";
import { isHomeCurrency } from "@/lib/currency";
import FuelSavingsCard from "@/components/FuelSavingsCard";
import { GroceryBasketCard } from "@/app/insights/InsightsPage";
import { useHomePinnedCards } from "@/lib/useHomePinnedCards";

// Token is guaranteed by AuthProvider before this component mounts
async function ensureAuth() {}

export default function HomePage() {
  const router = useRouter();
  const { user } = useAuth();
  const firstName = user?.name?.split(" ")[0]?.trim();
  const { hideNetWorth, payPeriodConfig, region } = usePreferences();
  const { colours } = useColours();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [investmentAccounts, setInvestmentAccounts] = useState<InvestmentAccount[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [kpis, setKpis] = useState<KPIs | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState(false);
  const [selectedTx, setSelectedTx] = useState<Transaction | null>(null);
  const [incomeBracket, setIncomeBracket] = useState("");
  const [adjustedIncome, setAdjustedIncome] = useState<number | null>(null);
  const [pinnedIds, setPinnedIds] = useState<string[]>([]);
  const [pinnedWidget, setPinnedWidget] = useState<string | null>(null);
  const { pinned: pinnedCards } = useHomePinnedCards();

  const loadData = useCallback(async () => {
    setLoadError(false);
    try {
      await ensureAuth();
      const [accs, kpiData, invAccs] = await Promise.allSettled([
        api.accounts(),
        api.kpis(),
        api.getInvestmentAccounts(),
      ]);

      // If both the accounts fetch and the kpis fetch failed, surface an error
      // rather than showing a permanently blank page.
      if (accs.status === "rejected" && kpiData.status === "rejected") {
        setLoadError(true);
        return;
      }

      const loadedAccounts = accs.status === "fulfilled" ? accs.value : [];
      setAccounts(loadedAccounts);
      if (kpiData.status === "fulfilled") setKpis(kpiData.value);
      if (invAccs.status === "fulfilled") setInvestmentAccounts(invAccs.value);

      if (loadedAccounts.length > 0) {
        // One bulk call (already server-sorted) instead of one per account
        const allTxns = await api.allTransactions(90).catch(() => [] as Transaction[]);
        setTransactions(allTxns);
      }
    } catch {}
    finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  // Last-known bracket from cache so the tax card doesn't pop in after paint
  useLayoutEffect(() => {
    try {
      const b = localStorage.getItem("wd_bracket");
      if (b !== null) setIncomeBracket(b);
    } catch {}
  }, []);

  useEffect(() => {
    api.getPreferences().then(p => {
      setIncomeBracket(p.income_bracket ?? "");
      setPinnedIds(p.home_pinned_accounts ?? []);
      setPinnedWidget(p.home_pinned_widget ?? null);
      try { localStorage.setItem("wd_bracket", p.income_bracket ?? ""); } catch {}
      // Mirror the Tax page's adjusted-income computation so the two never disagree
      let inc = 0;
      if (p.income_value && p.income_value > 0) inc = p.income_value;
      else if (p.income_bracket === "100k_125k") inc = 110_000;
      else if (p.income_bracket === "125k_plus") inc = 130_000;
      setAdjustedIncome(inc > 0 ? inc - (p.pension_annual ?? 0) : null);
    }).catch(() => {});
  }, []);

  const syncErrorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  async function handleSync() {
    setSyncing(true);
    setSyncError(false);
    if (syncErrorTimerRef.current) clearTimeout(syncErrorTimerRef.current);
    try {
      await api.syncAll();
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

  return (
    <div className="min-h-dvh bg-[#f0f2f7] dark:bg-[#0f172a] pb-20 lg:pb-8">
      {/* Desktop 2-col grid wrapper */}
      <div className="lg:grid lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)] lg:gap-6 lg:p-6 lg:max-w-7xl lg:mx-auto">

        {/* ── Left column: header, KPIs, accounts, donut ── */}
        <div className="space-y-5">
          {/* ── ZONE 1: State — greeting, net worth, value stat, reauth banners ── */}
          <div className="px-4 pt-6 lg:px-0 lg:pt-0">
            <div className="flex items-center justify-between mb-4">
              <div>
                <p className="text-xs text-slate-500 dark:text-slate-400 font-medium uppercase tracking-wide">
                  Good {getGreeting()}
                </p>
                <h1 className="text-xl font-bold text-slate-900 dark:text-slate-100">
                  {firstName ? `Hi, ${firstName}` : "Welcome back"}
                </h1>
              </div>
              <div className="flex items-center gap-2">
                <TutorialTrigger variant="dark-on-white" />
                <button
                  onClick={handleSync}
                  disabled={syncing}
                  aria-label={syncing ? "Syncing…" : "Sync accounts"}
                  className="w-11 h-11 flex items-center justify-center rounded-full bg-white dark:bg-slate-800 shadow-sm border border-slate-100 dark:border-slate-700 active:scale-95 transition-transform focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
                >
                  <RefreshCw
                    size={16}
                    color="#64748b"
                    className={syncing ? "animate-spin" : ""}
                  />
                </button>
              </div>
            </div>
            {/* Sync failure notice — compact amber, auto-clears after 6s */}
            {syncError && (
              <div className="flex items-center gap-2 mt-3 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-xl px-3 py-2">
                <AlertTriangle size={13} className="text-amber-500 flex-shrink-0" />
                <p className="text-xs text-amber-700 dark:text-amber-300 flex-1">Sync didn&apos;t complete — try again in a moment.</p>
              </div>
            )}
            {loadError ? (
              <div className="mt-4 bg-white dark:bg-slate-800 rounded-2xl shadow-sm p-5 text-center">
                <p className="text-sm font-medium text-slate-600 dark:text-slate-300 mb-3">
                  Couldn&apos;t load your data — check your connection.
                </p>
                <button
                  onClick={() => { setLoading(true); setLoadError(false); loadData(); }}
                  className="w-full bg-indigo-600 hover:bg-indigo-700 active:scale-95 transition-all text-white text-sm font-semibold rounded-xl py-2.5 px-4"
                >
                  Try again
                </button>
              </div>
            ) : (
              <>
                <NetWorthCard kpis={kpis} loading={loading} />
                {!loading && <ValueDeliveredStat />}
              </>
            )}
          </div>

          {/* Reauth banners — still part of Zone 1 (state alerts) */}
          {expiredProviders.map(({ provider, provider_id }) => (
            <div key={provider} className="mx-4 flex items-center gap-3 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-2xl px-4 py-3 lg:mx-0">
              <AlertTriangle size={15} className="text-amber-500 flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-xs font-semibold text-amber-800 dark:text-amber-200">{provider} needs reconnecting</p>
                <p className="text-[11px] text-amber-600 dark:text-amber-400 leading-tight">Transactions have stopped syncing.</p>
              </div>
              <button
                onClick={() => handleReconnect(provider_id)}
                className="flex-shrink-0 text-xs font-semibold bg-amber-500 hover:bg-amber-600 active:scale-95 transition-all text-white px-3 py-1.5 rounded-lg"
              >
                Reconnect
              </button>
            </div>
          ))}

          {/* ── ZONE 2: Signals — goals + upcoming bills ── */}
          {/* Each strip self-manages its skeleton; render immediately so layout
              is stable from the first paint rather than popping in after load. */}
          {!loadError && <GoalsStrip />}
          {!loadError && <UpcomingBillsStrip />}

          {/* ── ZONE 3: Action — the single CTA spotlight ── */}
          {!loadError && <HomeInsightSpotlight />}

          {/* ── Below zones: demoted supporting content ── */}

          {/* User-pinned insight cards (fuel prices, grocery baskets) */}
          {!loading && pinnedCards.includes("fuel") && (
            <div className="px-4 lg:px-0"><FuelSavingsCard /></div>
          )}
          {!loading && pinnedCards.includes("groceries") && (
            <div className="px-4 lg:px-0"><GroceryBasketCard /></div>
          )}

          {/* Pinned chart widget — user-chosen from the Spend Trends tab */}
          {!loading && pinnedWidget && homeTxns.length > 0 && (() => {
            const [ps, pe] = getPayPeriodWithConfig(new Date(), payPeriodConfig);
            return (
              <PinnedWidgetCard
                id={pinnedWidget}
                transactions={homeTxns}
                periodStart={ps}
                periodEnd={pe}
                payPeriodConfig={payPeriodConfig}
                colours={colours}
                onOpen={() => router.push("/spend?view=trends")}
              />
            );
          })()}

          {/* Tax efficiency card — shown only for £100k+ earners */}
          {!loading && (incomeBracket === "100k_125k" || incomeBracket === "125k_plus") && (
            <TaxEfficiencyCard adjusted={adjustedIncome} router={router} />
          )}

          {/* Accounts — pinned/expired top picks in a grid, rest behind "+N more" */}
          <div className="px-4 lg:px-0">
            <div className="flex items-center justify-between mb-3">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">Accounts</p>
              <button
                data-tutorial-id="tutorial-manage-link"
                onClick={() => router.push("/accounts")}
                className="text-xs font-semibold text-indigo-500 dark:text-indigo-400 flex items-center gap-1 active:opacity-70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 rounded"
              >
                Manage <ChevronRight size={14} />
              </button>
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
                <p className="text-[13px] text-slate-500 dark:text-slate-400 mb-4 leading-snug">
                  Read-only access through open banking — we can never move your money.
                </p>
                <button
                  onClick={() => handleReconnect()}
                  className="w-full bg-indigo-600 hover:bg-indigo-700 active:scale-95 transition-all text-white text-sm font-semibold rounded-xl py-2.5 px-4"
                >
                  Connect a bank
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-3">
                {topPickAccounts.map((acc) => (
                  <AccountMiniCard
                    key={acc.id}
                    account={acc}
                    grid
                    hidden={hideNetWorth}
                    onClick={() => router.push(`/accounts?id=${acc.id}`)}
                  />
                ))}
                {investmentAccounts.slice(0, 1).map(inv => (
                  <InvestmentMiniCard
                    key={inv.id}
                    account={inv}
                    grid
                    hidden={hideNetWorth}
                    onClick={() => router.push("/accounts?tab=Investments")}
                  />
                ))}
                {hiddenAccountCount > 0 && (
                  <button
                    onClick={() => router.push("/accounts")}
                    className="rounded-2xl border-2 border-dashed border-slate-200 dark:border-slate-700 flex flex-col items-center justify-center gap-1 text-slate-400 dark:text-slate-500 active:scale-95 transition-transform min-h-[7rem]"
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
        <div>
          <div className="mx-4 mb-4 lg:mx-0 lg:mt-0" data-tutorial-id="tutorial-recent-transactions">
            <div className="flex items-center justify-between mb-3">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500 lg:pt-0">Recent Transactions</p>
              <button
                onClick={() => router.push("/spend?view=list")}
                className="text-xs font-semibold text-indigo-500 dark:text-indigo-400 flex items-center gap-1 active:opacity-70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 rounded"
              >
                See all <ChevronRight size={13} />
              </button>
            </div>
            <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-sm overflow-hidden lg:max-h-[calc(100vh-120px)] lg:overflow-y-auto">
              {loading ? (
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

      {/* Penny FAB — persistent AI adviser entry point on Home */}
      <MoneyAdvisorChat
        insights={null}
        sym={region === "Kenya" ? "KES " : "£"}
        firstName={firstName || "there"}
        page="home"
      />

      <BottomNav />
    </div>
  );
}

function getGreeting(): string {
  const h = new Date().getHours();
  if (h < 12) return "Morning";
  if (h < 17) return "Afternoon";
  return "Evening";
}

function TaxEfficiencyCard({ adjusted, router }: { adjusted: number | null; router: ReturnType<typeof useRouter> }) {
  // Same thresholds as the Tax page: taper starts at £100k, allowance gone at £125,140
  const is125k    = adjusted !== null && adjusted >= 125_140;
  const inTaper   = adjusted !== null && adjusted > 100_000 && adjusted < 125_140;
  const protectedAllowance = adjusted !== null && adjusted <= 100_000;
  // Plain card, not a gradient banner — permanent chrome shouldn't compete
  // with the rotating insight spotlight above it
  return (
    <div
      className="mx-4 lg:mx-0 rounded-2xl overflow-hidden cursor-pointer active:scale-[0.98] transition-transform bg-white dark:bg-slate-800 shadow-sm border border-slate-100 dark:border-slate-700"
      onClick={() => router.push("/insights?tab=tax")}
    >
      <div className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-violet-500 dark:text-violet-400 mb-1">
              Tax efficiency
            </p>
            {is125k ? (
              <>
                <p className="text-sm font-bold text-slate-800 dark:text-slate-100 leading-tight">
                  You&apos;ve lost your personal allowance
                </p>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                  Pension contributions still save 45p in every £1 — see how much to put in
                </p>
              </>
            ) : protectedAllowance ? (
              <>
                <p className="text-sm font-bold text-slate-800 dark:text-slate-100 leading-tight">
                  Personal allowance protected
                </p>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                  Your pension contributions keep you under £100k — check your remaining levers
                </p>
              </>
            ) : inTaper ? (
              <>
                <p className="text-sm font-bold text-slate-800 dark:text-slate-100 leading-tight">
                  You&apos;re in the 60% rate band
                </p>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                  Pension contributions can restore your personal allowance and cut your tax bill
                </p>
              </>
            ) : (
              <>
                <p className="text-sm font-bold text-slate-800 dark:text-slate-100 leading-tight">
                  You may be in the 60% rate band
                </p>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                  Set your income in Settings for a precise picture
                </p>
              </>
            )}
          </div>
          <div className="w-8 h-8 rounded-xl bg-violet-100 dark:bg-violet-900/40 flex items-center justify-center flex-shrink-0 mt-0.5">
            <TrendingUp size={16} className="text-violet-600 dark:text-violet-400" />
          </div>
        </div>
        <div className="mt-3 flex items-center gap-1 text-xs font-semibold text-violet-600 dark:text-violet-400">
          See your tax position <ChevronRight size={13} />
        </div>
      </div>
    </div>
  );
}
