"use client";

import { useEffect, useState, useCallback, useMemo, useRef } from "react";
import { RefreshCw, ChevronLeft, ChevronRight, AlertTriangle } from "lucide-react";
import { api, Account, Transaction, KPIs, InvestmentAccount } from "@/lib/api";
import { getToken, setToken } from "@/lib/auth";
import NetWorthCard from "@/components/NetWorthCard";
import ThemeColor from "@/components/ThemeColor";
import AccountMiniCard from "@/components/AccountMiniCard";
import InvestmentMiniCard from "@/components/InvestmentMiniCard";
import TransactionRow from "@/components/TransactionRow";
import TransactionSheet from "@/components/TransactionSheet";
import BottomNav from "@/components/BottomNav";
import { CATEGORY_COLOURS } from "@/lib/categories";
import { useColours } from "@/components/ColourProvider";
import { usePreferences } from "@/components/PreferencesContext";
import {
  PieChart,
  Pie,
  Cell,
  Sector,
  ResponsiveContainer,
} from "recharts";
import { useRouter } from "next/navigation";
import { getPayPeriod, getPayPeriodWithConfig, formatPeriod, filterPeriod, PayPeriodConfig } from "@/lib/payPeriod";
import TutorialTrigger from "@/components/TutorialTrigger";

// Token is guaranteed by AuthProvider before this component mounts
async function ensureAuth() {}

export default function HomePage() {
  const router = useRouter();
  const { hideNetWorth } = usePreferences();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [investmentAccounts, setInvestmentAccounts] = useState<InvestmentAccount[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [kpis, setKpis] = useState<KPIs | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [selectedTx, setSelectedTx] = useState<Transaction | null>(null);

  const loadData = useCallback(async () => {
    try {
      await ensureAuth();
      const [accs, kpiData, invAccs] = await Promise.allSettled([
        api.accounts(),
        api.kpis(),
        api.getInvestmentAccounts(),
      ]);

      const loadedAccounts = accs.status === "fulfilled" ? accs.value : [];
      setAccounts(loadedAccounts);
      if (kpiData.status === "fulfilled") setKpis(kpiData.value);
      if (invAccs.status === "fulfilled") setInvestmentAccounts(invAccs.value);

      if (loadedAccounts.length > 0) {
        const allTxns: Transaction[] = [];
        await Promise.all(
          loadedAccounts.map(async (acc) => {
            try {
              const txns = await api.transactions(acc.id);
              allTxns.push(...txns);
            } catch {}
          })
        );
        setTransactions(
          allTxns.sort(
            (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
          )
        );
      }
    } catch {}
    finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  async function handleSync() {
    setSyncing(true);
    try {
      await api.syncAll();
      await loadData();
    } catch {} finally {
      setSyncing(false);
    }
  }

  function handleTxUpdated(updated: Transaction, additionalIds?: string[]) {
    setTransactions((prev) =>
      prev.map((t) => {
        if (t.id === updated.id) return { ...t, category: updated.category };
        if (additionalIds?.includes(t.id)) return { ...t, category: updated.category };
        return t;
      })
    );
  }

  const recent = transactions.slice(0, 30);

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
      <ThemeColor color={(kpis?.net_worth ?? 0) < 0 ? "#b91c1c" : "#4f46e5"} />
      {/* Desktop 2-col grid wrapper */}
      <div className="lg:grid lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)] lg:gap-6 lg:p-6 lg:max-w-7xl lg:mx-auto">

        {/* ── Left column: header, KPIs, accounts, donut ── */}
        <div>
          {/* Header */}
          <div className="px-4 pt-6 pb-4 lg:px-0 lg:pt-0">
            <div className="flex items-center justify-between mb-4">
              <div>
                <p className="text-xs text-slate-500 dark:text-slate-400 font-medium uppercase tracking-wide">
                  Good {getGreeting()}
                </p>
                <h1 className="text-xl font-bold text-slate-900 dark:text-slate-100">Dashboard</h1>
              </div>
              <div className="flex items-center gap-2">
                <TutorialTrigger variant="dark-on-white" />
                <button
                  onClick={handleSync}
                  disabled={syncing}
                  className="w-9 h-9 flex items-center justify-center rounded-full bg-white dark:bg-slate-800 shadow-sm border border-slate-100 dark:border-slate-700 active:scale-95 transition-transform"
                >
                  <RefreshCw
                    size={16}
                    color="#64748b"
                    className={syncing ? "animate-spin" : ""}
                  />
                </button>
              </div>
            </div>
            <NetWorthCard kpis={kpis} loading={loading} />
          </div>

          {/* Reauth banners */}
          {expiredProviders.map(({ provider, provider_id }) => (
            <div key={provider} className="mx-4 mt-3 flex items-center gap-3 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-2xl px-4 py-3 lg:mx-0">
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

          {/* Accounts horizontal scroll */}
          <div className="px-4 mb-5 lg:px-0">
            <div className="flex items-center justify-between mb-3">
              <p className="text-sm font-semibold text-slate-600 dark:text-slate-300">Accounts</p>
              <button
                data-tutorial-id="tutorial-manage-link"
                onClick={() => router.push("/accounts")}
                className="text-xs font-semibold text-indigo-500 dark:text-indigo-400 flex items-center gap-1 active:opacity-70"
              >
                Manage <span className="text-base leading-none">+</span>
              </button>
            </div>
            {loading ? (
              <div className="flex gap-3">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="flex-shrink-0 w-40 h-24 bg-white dark:bg-slate-800 rounded-2xl animate-pulse shadow-sm" />
                ))}
              </div>
            ) : accounts.length === 0 ? (
              <div className="bg-white dark:bg-slate-800 rounded-2xl p-4 text-center shadow-sm">
                <p className="text-sm text-slate-400 dark:text-slate-500">No accounts connected</p>
              </div>
            ) : (
              <div className="flex gap-3 overflow-x-auto scrollbar-hide pb-1">
                {accounts.map((acc) => (
                  <AccountMiniCard
                    key={acc.id}
                    account={acc}
                    hidden={hideNetWorth}
                    onClick={() => router.push(`/accounts?id=${acc.id}`)}
                  />
                ))}
              </div>
            )}
          </div>

          {/* Investments horizontal scroll — only shown when accounts exist */}
          {(loading || investmentAccounts.length > 0) && (
            <div className="px-4 mb-5 lg:px-0">
              <div className="flex items-center justify-between mb-3">
                <p className="text-sm font-semibold text-slate-600 dark:text-slate-300">Investments</p>
                <button
                  onClick={() => router.push("/accounts?tab=Investments")}
                  className="text-xs font-semibold text-indigo-500 dark:text-indigo-400 flex items-center gap-1 active:opacity-70"
                >
                  Manage <span className="text-base leading-none">+</span>
                </button>
              </div>
              {loading ? (
                <div className="flex gap-3">
                  {[1, 2].map((i) => (
                    <div key={i} className="flex-shrink-0 w-44 h-28 bg-white dark:bg-slate-800 rounded-2xl animate-pulse shadow-sm" />
                  ))}
                </div>
              ) : (
                <div className="flex gap-3 overflow-x-auto scrollbar-hide pb-1">
                  {investmentAccounts.map(inv => (
                    <InvestmentMiniCard
                      key={inv.id}
                      account={inv}
                      hidden={hideNetWorth}
                      onClick={() => router.push("/accounts?tab=Investments")}
                    />
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Spending donut — monthly with swipe navigation */}
          {!loading && transactions.length > 0 && (
            <SpendingDonut transactions={transactions} desktopFlat />
          )}
        </div>

        {/* ── Right column: recent transactions ── */}
        <div>
          <div className="mx-4 mb-4 lg:mx-0 lg:mt-0" data-tutorial-id="tutorial-recent-transactions">
            <p className="text-sm font-semibold text-slate-600 dark:text-slate-300 mb-3 lg:pt-0">Recent Transactions</p>
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

      <BottomNav />
    </div>
  );
}

const SKIP_CATS = new Set(["Transfer", "Savings", "Debt", "Income"]);

type PayPeriod = { start: Date; end: Date };

function buildPayPeriodList(transactions: Transaction[], config: PayPeriodConfig): PayPeriod[] {
  const seen = new Set<string>();
  const periods: PayPeriod[] = [];
  // Always include the current pay period so new months appear immediately
  const [curStart, curEnd] = getPayPeriodWithConfig(new Date(), config);
  seen.add(curStart.toISOString());
  periods.push({ start: curStart, end: curEnd });
  for (const tx of transactions) {
    if (tx.transaction_type === "credit") continue;
    if (SKIP_CATS.has(tx.category || "")) continue;
    const [start, end] = getPayPeriodWithConfig(new Date(tx.date), config);
    const key = start.toISOString();
    if (!seen.has(key)) { seen.add(key); periods.push({ start, end }); }
  }
  return periods.sort((a, b) => a.start.getTime() - b.start.getTime());
}

function buildSpend(txns: Transaction[], period: PayPeriod | null) {
  const map: Record<string, number> = {};
  const filtered = period ? filterPeriod(txns, period.start, period.end) : txns;
  for (const tx of filtered) {
    if (tx.transaction_type === "credit") continue;
    const cat = tx.category || "Other";
    if (SKIP_CATS.has(cat)) continue;
    map[cat] = (map[cat] ?? 0) + Math.abs(tx.amount);
  }
  return Object.entries(map)
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 6);
}

function SpendingDonut({ transactions, desktopFlat }: { transactions: Transaction[]; desktopFlat?: boolean }) {
  const { colours } = useColours();
  const { payPeriodConfig, region } = usePreferences();
  const sym = region === "Kenya" ? "KES " : "£";
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const touchStartX = useRef<number | null>(null);

  // Pay periods covering the transactions, oldest → newest
  const payPeriods = useMemo(() => buildPayPeriodList(transactions, payPeriodConfig), [transactions, payPeriodConfig]);
  // periods array: each pay period + null sentinel for "All Time"
  const periods: Array<PayPeriod | null> = useMemo(() => [...payPeriods, null], [payPeriods]);

  // Default to the most recent period with actual spending; fall back to current period
  const currentPeriodIdx = useMemo(() => {
    for (let i = payPeriods.length - 1; i >= 0; i--) {
      if (buildSpend(transactions, payPeriods[i]).length > 0) return i;
    }
    const [curStart] = getPayPeriodWithConfig(new Date(), payPeriodConfig);
    const idx = payPeriods.findIndex((p) => p.start.getTime() === curStart.getTime());
    return idx !== -1 ? idx : Math.max(0, payPeriods.length - 1);
  }, [payPeriods, payPeriodConfig, transactions]);

  const [periodIdx, setPeriodIdx] = useState<number>(currentPeriodIdx);

  useEffect(() => { setPeriodIdx(currentPeriodIdx); }, [currentPeriodIdx]);

  const selectedPeriod = periods[periodIdx]; // null = All Time
  const isTotal = selectedPeriod === null;
  const categorySpend = useMemo(() => buildSpend(transactions, selectedPeriod ?? null), [transactions, selectedPeriod]);
  const total = categorySpend.reduce((s, c) => s + c.value, 0);

  const canGoLeft = periodIdx > 0;
  const canGoRight = periodIdx < periods.length - 1;

  function goLeft() { setActiveIndex(null); setPeriodIdx((i) => Math.max(0, i - 1)); }
  function goRight() { setActiveIndex(null); setPeriodIdx((i) => Math.min(periods.length - 1, i + 1)); }

  function onTouchStart(e: React.TouchEvent) {
    touchStartX.current = e.touches[0].clientX;
  }
  function onTouchEnd(e: React.TouchEvent) {
    if (touchStartX.current === null) return;
    const dx = touchStartX.current - e.changedTouches[0].clientX;
    if (Math.abs(dx) > 40) {
      if (dx > 0) goLeft(); // swipe left → older month
      else goRight();        // swipe right → newer / total
    }
    touchStartX.current = null;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const renderSector = (props: any) => {
    const { cx, cy, innerRadius, outerRadius, startAngle, endAngle, index } = props;
    const fill = colours[categorySpend[index]?.name ?? ""] ?? CATEGORY_COLOURS.Other;
    const active = index === activeIndex;
    return (
      <Sector
        cx={cx} cy={cy}
        innerRadius={active ? innerRadius - 3 : innerRadius}
        outerRadius={active ? outerRadius + 10 : outerRadius}
        startAngle={startAngle} endAngle={endAngle} fill={fill}
      />
    );
  };

  // Visible dot range — show at most 7 dots, centred on current
  const maxDots = Math.min(periods.length, 9);
  const half = Math.floor(maxDots / 2);
  const dotStart = Math.max(0, Math.min(periodIdx - half, periods.length - maxDots));
  const dotEnd = dotStart + maxDots;
  const visibleDots = periods.slice(dotStart, dotEnd);

  return (
    <div
      className={`mb-5 bg-white dark:bg-slate-800 rounded-2xl shadow-sm p-4 select-none ${desktopFlat ? "mx-4 lg:mx-0" : "mx-4"}`}
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
    >
      {/* Navigation row */}
      <div className="flex items-center justify-between mb-2">
        <button
          onClick={goLeft}
          disabled={!canGoLeft}
          className="w-7 h-7 flex items-center justify-center rounded-full bg-slate-100 dark:bg-slate-700 active:bg-slate-200 dark:active:bg-slate-600 disabled:opacity-25 transition-opacity"
        >
          <ChevronLeft size={15} color="#64748b" />
        </button>

        <div className="text-center">
          <p className="text-sm font-semibold text-slate-700 dark:text-slate-200 leading-tight">
            {isTotal ? "All Time" : formatPeriod(selectedPeriod!.start, selectedPeriod!.end)}
          </p>
          <p className="text-[10px] text-slate-400 dark:text-slate-500 leading-tight">Top Spending</p>
        </div>

        <button
          onClick={goRight}
          disabled={!canGoRight}
          className="w-7 h-7 flex items-center justify-center rounded-full bg-slate-100 dark:bg-slate-700 active:bg-slate-200 dark:active:bg-slate-600 disabled:opacity-25 transition-opacity"
        >
          <ChevronRight size={15} color="#64748b" />
        </button>
      </div>

      {/* Dot indicators */}
      <div className="flex justify-center items-center gap-1 mb-3">
        {visibleDots.map((p, i) => {
          const absIdx = dotStart + i;
          const active = absIdx === periodIdx;
          const isT = p === null;
          return (
            <button
              key={isT ? "total" : (p as PayPeriod).start.toISOString()}
              onClick={() => { setActiveIndex(null); setPeriodIdx(absIdx); }}
              className={`rounded-full transition-all duration-200 ${
                active
                  ? isT
                    ? "w-4 h-1.5 bg-slate-500"
                    : "w-4 h-1.5 bg-indigo-500"
                  : "w-1.5 h-1.5 bg-slate-200 dark:bg-slate-600"
              }`}
            />
          );
        })}
      </div>

      {/* Chart + legend */}
      {categorySpend.length === 0 ? (
        <div className="flex items-center justify-center h-24 text-sm text-slate-400 dark:text-slate-500">
          No spending this period
        </div>
      ) : (
        <div className="flex items-center gap-3">
          <div className="flex-shrink-0 outline-none" style={{ width: 130, height: 130 }} tabIndex={-1}>
            <ResponsiveContainer width="100%" height="100%">
              <PieChart tabIndex={-1}>
                <Pie
                  data={categorySpend}
                  dataKey="value"
                  cx="50%" cy="50%"
                  innerRadius={32} outerRadius={54}
                  strokeWidth={3} stroke="#fff"
                  shape={renderSector}
                  style={{ pointerEvents: "none" }}
                >
                  {categorySpend.map((entry) => (
                    <Cell key={entry.name} fill={colours[entry.name] ?? CATEGORY_COLOURS.Other} />
                  ))}
                </Pie>
              </PieChart>
            </ResponsiveContainer>
          </div>

          <div className="flex-1 min-w-0 space-y-2">
            {categorySpend.map((cat, i) => {
              const colour = colours[cat.name] ?? CATEGORY_COLOURS.Other;
              const pct = Math.round((cat.value / total) * 100);
              const active = activeIndex === i;
              return (
                <button
                  key={cat.name}
                  className="w-full text-left focus:outline-none"
                  onMouseEnter={() => setActiveIndex(i)}
                  onMouseLeave={() => setActiveIndex(null)}
                  onClick={() => setActiveIndex((j) => (j === i ? null : i))}
                >
                  <div className="flex items-center justify-between mb-0.5">
                    <span className={`text-xs truncate transition-all ${active ? "font-semibold text-slate-900 dark:text-slate-100" : "font-medium text-slate-600 dark:text-slate-300"}`}>
                      {cat.name}
                    </span>
                    <span
                      className={`ml-2 flex-shrink-0 transition-all ${active ? "text-sm font-extrabold" : "text-xs font-semibold text-slate-700 dark:text-slate-200"}`}
                      style={{ color: active ? colour : undefined }}
                    >
                      {sym}{cat.value.toLocaleString("en-GB", { maximumFractionDigits: 0 })}
                    </span>
                  </div>
                  <div className="h-1.5 w-full rounded-full bg-slate-100 dark:bg-slate-700 overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all duration-200"
                      style={{ width: `${pct}%`, backgroundColor: colour }}
                    />
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function getGreeting(): string {
  const h = new Date().getHours();
  if (h < 12) return "Morning";
  if (h < 17) return "Afternoon";
  return "Evening";
}
