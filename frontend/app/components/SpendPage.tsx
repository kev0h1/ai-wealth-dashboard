"use client";

import { useEffect, useState, useCallback, useMemo, useRef } from "react";
import { useSearchParams } from "next/navigation";
import { ChevronDown, ChevronUp, ChevronLeft, ChevronRight, Settings2, X, SlidersHorizontal } from "lucide-react";
import { api, Account, Transaction, CashflowData } from "@/lib/api";
import { useLockBodyScroll } from "@/lib/useLockBodyScroll";
import { useColours } from "@/components/ColourProvider";
import { CATEGORY_COLOURS } from "@/lib/categories";
import { getToken, setToken } from "@/lib/auth";
import {
  getPayPeriodWithConfig,
  prevPeriodWithConfig,
  nextPeriodWithConfig,
  filterPeriod,
  PayPeriodConfig,
} from "@/lib/payPeriod";
import { usePreferences } from "@/components/PreferencesContext";
import PeriodNav from "@/components/PeriodNav";
import { CategoryData } from "@/components/CategoryRow";
import CategorySheet from "@/components/CategorySheet";
import TransactionSheet from "@/components/TransactionSheet";
import BottomNav from "@/components/BottomNav";
import Spinner from "@/components/Spinner";
import TransactionRow from "@/components/TransactionRow";
import CategoryManagerSheet from "@/components/CategoryManagerSheet";
import CustomSelect from "@/components/CustomSelect";

async function ensureAuth() {}

const SKIP_FROM_SPEND = new Set(["Transfer"]);

function formatDateLocal(iso: string) {
  const d = new Date(iso);
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

export default function SpendPage() {
  const { payPeriodConfig, setPayPeriodConfig } = usePreferences();
  const { colours } = useColours();
  const searchParams = useSearchParams();
  const [view, setView] = useState<"categories" | "list" | "upcoming">(
    searchParams.get("view") === "upcoming" ? "upcoming" : searchParams.get("view") === "list" ? "list" : "categories"
  );
  const [cashflow, setCashflow] = useState<CashflowData | null>(null);
  const [allTransactions, setAllTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [periodStart, setPeriodStart] = useState<Date>(() => {
    const [s] = getPayPeriodWithConfig(new Date(), { type: "calendar_month" });
    return s;
  });
  const [periodEnd, setPeriodEnd] = useState<Date>(() => {
    const [, e] = getPayPeriodWithConfig(new Date(), { type: "calendar_month" });
    return e;
  });
  const [untrackedOpen, setUntrackedOpen] = useState(false);
  const [oldestTxDate, setOldestTxDate] = useState<Date | null>(null);

  useEffect(() => {
    api.oldestTransaction().then(r => { if (r.date) setOldestTxDate(new Date(r.date)); }).catch(() => {});
  }, []);
  const [selectedTx, setSelectedTx] = useState<Transaction | null>(null);
  const [incomeExpanded, setIncomeExpanded] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [manageOpen, setManageOpen] = useState(searchParams.get("manage") === "1");
  const [openCategory, setOpenCategory] = useState<CategoryData | null>(null);

  const [accounts, setAccounts] = useState<Account[]>([]);

  const loadData = useCallback(async () => {
    try {
      await ensureAuth();
      const [accs] = await Promise.all([
        api.accounts().catch(() => [] as Account[]),
        api.cashflow().then(setCashflow).catch(() => {}),
      ]);
      setAccounts(accs);
      const all: Transaction[] = [];
      await Promise.all(
        accs.map(async (acc) => {
          try {
            const txns = await api.transactions(acc.id);
            all.push(...txns);
          } catch {}
        })
      );
      setAllTransactions(all);
    } catch {}
    finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Re-initialise period when config loads/changes
  const configKey = JSON.stringify(payPeriodConfig);
  useEffect(() => {
    const [s, e] = getPayPeriodWithConfig(new Date(), payPeriodConfig);
    setPeriodStart(s);
    setPeriodEnd(e);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [configKey]);

  // Period txns
  const periodTxns = useMemo(
    () => filterPeriod(allTransactions, periodStart, periodEnd),
    [allTransactions, periodStart, periodEnd]
  );

  // Compute summary
  const summary = useMemo(() => {
    let spent = 0;
    let income = 0;
    for (const tx of periodTxns) {
      if (tx.transaction_type === "debit") {
        const cat = tx.category || "Other";
        if (!SKIP_FROM_SPEND.has(cat)) spent += Math.abs(tx.amount);
      } else if (tx.transaction_type === "credit") {
        const cat = tx.category || "Other";
        if (cat !== "Transfer") income += Math.abs(tx.amount);
      }
    }
    return { spent, income, net: income - spent };
  }, [periodTxns]);

  // Category breakdown
  const categories = useMemo((): CategoryData[] => {
    const map: Record<string, { total: number; count: number; transactions: Transaction[] }> = {};
    for (const tx of periodTxns) {
      if (tx.transaction_type === "credit") continue;
      const cat = tx.category || "Other";
      if (SKIP_FROM_SPEND.has(cat)) continue;
      if (!map[cat]) map[cat] = { total: 0, count: 0, transactions: [] };
      map[cat].total += Math.abs(tx.amount);
      map[cat].count += 1;
      map[cat].transactions.push(tx);
    }
    const totalSpend = Object.values(map).reduce((s, v) => s + v.total, 0);
    return Object.entries(map)
      .map(([name, { total, count, transactions }]) => ({
        name,
        total,
        count,
        transactions: transactions.sort(
          (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
        ),
        pct: totalSpend > 0 ? (total / totalSpend) * 100 : 0,
      }))
      .sort((a, b) => b.total - a.total);
  }, [periodTxns]);

  // Untracked categories — only Transfer (both directions)
  const untrackedCategories = useMemo((): CategoryData[] => {
    const map: Record<string, { total: number; count: number; transactions: Transaction[] }> = {};
    for (const tx of periodTxns) {
      const cat = tx.category || "Other";
      if (cat !== "Transfer") continue;
      const label = tx.transaction_type === "credit" ? "Transfer (in)" : "Transfer (out)";
      if (!map[label]) map[label] = { total: 0, count: 0, transactions: [] };
      map[label].total += Math.abs(tx.amount);
      map[label].count += 1;
      map[label].transactions.push(tx);
    }
    return Object.entries(map)
      .map(([name, { total, count, transactions }]) => ({
        name,
        total,
        count,
        transactions: transactions.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()),
        pct: 0,
      }))
      .sort((a, b) => b.total - a.total);
  }, [periodTxns]);

  // Income transactions for drill-down
  const incomeTxns = useMemo(
    () =>
      periodTxns
        .filter(
          (tx) =>
            tx.transaction_type === "credit" &&
            (tx.category || "Other") !== "Transfer"
        )
        .sort(
          (a, b) =>
            new Date(b.date).getTime() - new Date(a.date).getTime()
        ),
    [periodTxns]
  );

  // All transactions in the period, newest first — for the chronological list view
  const listTxns = useMemo(
    () =>
      [...periodTxns].sort(
        (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
      ),
    [periodTxns]
  );

  const touchStartX = useRef<number | null>(null);
  const touchStartY = useRef<number | null>(null);

  function handleTouchStart(e: React.TouchEvent) {
    touchStartX.current = e.touches[0].clientX;
    touchStartY.current = e.touches[0].clientY;
  }

  function handleTouchEnd(e: React.TouchEvent) {
    if (touchStartX.current === null || touchStartY.current === null) return;
    const dx = e.changedTouches[0].clientX - touchStartX.current;
    const dy = e.changedTouches[0].clientY - touchStartY.current;
    touchStartX.current = null;
    touchStartY.current = null;
    // Ignore swipes while a sheet/overlay is open
    if (selectedTx || manageOpen || settingsOpen) return;
    // Only respond to clearly horizontal swipes (dx dominates, at least 50px)
    if (Math.abs(dx) < 50 || Math.abs(dx) < Math.abs(dy)) return;
    if (dx > 0) handlePrev();
    else if (!isCurrentPeriod) handleNext();
  }

  // Stop at the period containing the oldest transaction — no empty pre-history
  const canGoPrev = !oldestTxDate || periodStart.getTime() > oldestTxDate.getTime();

  function handlePrev() {
    if (!canGoPrev) return;
    const [s, e] = prevPeriodWithConfig(periodStart, payPeriodConfig);
    setPeriodStart(s);
    setPeriodEnd(e);
    if (view === "upcoming") setView("categories");
  }

  function handleNext() {
    const [s, e] = nextPeriodWithConfig(periodEnd, payPeriodConfig);
    setPeriodStart(s);
    setPeriodEnd(e);
  }

  const [currentStart, currentEnd] = getPayPeriodWithConfig(new Date(), payPeriodConfig);
  const isCurrentPeriod =
    periodStart.getTime() === currentStart.getTime() &&
    periodEnd.getTime() === currentEnd.getTime();

  // Sync view with ?view= query param when it changes (e.g. deep-link from home strip)
  useEffect(() => {
    const v = searchParams.get("view");
    if (v === "upcoming" || v === "list" || v === "categories") setView(v);
  }, [searchParams]);


  function handleTxUpdated(updated: Transaction, additionalIds?: string[]) {
    setAllTransactions((prev) =>
      prev.map((t) => {
        if (t.id === updated.id) return { ...t, category: updated.category };
        if (additionalIds?.includes(t.id)) return { ...t, category: updated.category };
        return t;
      })
    );
  }

  const fmtAmt = (n: number) =>
    `£${Math.abs(n).toLocaleString("en-GB", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`;

  return (
    <div className="min-h-dvh bg-[#f0f2f7] dark:bg-[#0f172a] pb-20 lg:pb-8 lg:max-w-6xl lg:mx-auto" style={{ paddingTop: "env(safe-area-inset-top, 0px)" }}
      onTouchStart={handleTouchStart} onTouchEnd={handleTouchEnd}>
      {/* Header */}
      <div className="px-4 pt-6 pb-2">
        <div className="flex items-center justify-between mb-4">
          <div>
            <p className="text-xs text-slate-500 dark:text-slate-400 font-medium uppercase tracking-wide">
              Where your money goes
            </p>
            <h1 className="text-xl font-bold text-slate-900 dark:text-slate-100">Spending</h1>
          </div>
          <button
            onClick={() => setManageOpen(true)}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-white dark:bg-slate-800 shadow-sm border border-slate-100 dark:border-slate-700 text-slate-600 dark:text-slate-300 active:scale-95 transition-transform"
          >
            <SlidersHorizontal size={14} />
            <span className="text-xs font-semibold">Manage</span>
          </button>
        </div>

        {/* Period nav */}
        <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-sm border border-slate-100 dark:border-slate-700 p-3">
          <div className="flex items-center justify-between">
            <button
              onClick={handlePrev}
              disabled={!canGoPrev}
              className="w-8 h-8 flex items-center justify-center rounded-full bg-slate-100 dark:bg-slate-700 active:bg-slate-200 dark:active:bg-slate-600 transition-colors disabled:opacity-30"
            >
              <ChevronLeft size={16} color="#64748b" />
            </button>
            <div className="text-center">
              <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">
                {formatPeriodLocal(periodStart, periodEnd)}
              </p>
              {isCurrentPeriod && (
                <p className="text-[10px] text-slate-400 dark:text-slate-500 mt-0.5">Current period</p>
              )}
            </div>
            <button
              onClick={handleNext}
              disabled={isCurrentPeriod}
              className="w-8 h-8 flex items-center justify-center rounded-full bg-slate-100 dark:bg-slate-700 active:bg-slate-200 dark:active:bg-slate-600 transition-colors disabled:opacity-30"
            >
              <ChevronRight size={16} color="#64748b" />
            </button>
          </div>
          <button
            onClick={() => setSettingsOpen(true)}
            className="mt-2 flex items-center gap-1.5 mx-auto text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300 transition-colors text-xs"
          >
            <Settings2 size={12} />
            <span>Pay period settings</span>
          </button>
        </div>

        {/* Summary chips */}
        {!loading && (
          <div className="flex gap-2 mt-3">
            <div className="flex-1 bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-100 dark:border-slate-700 px-3 py-2 text-center">
              <p className="text-[10px] text-slate-400 dark:text-slate-500 mb-0.5">Spent</p>
              <p className="text-sm font-bold text-slate-900 dark:text-slate-100">{fmtAmt(summary.spent)}</p>
            </div>
            <button
              onClick={() => setIncomeExpanded(v => !v)}
              className="flex-1 bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-100 dark:border-slate-700 px-3 py-2 text-center active:scale-[0.98] transition-transform"
            >
              <p className="text-[10px] text-slate-400 dark:text-slate-500 mb-0.5 flex items-center justify-center gap-0.5">
                Income {incomeExpanded ? <ChevronUp size={10} /> : <ChevronDown size={10} />}
              </p>
              <p className="text-sm font-bold text-slate-900 dark:text-slate-100">{fmtAmt(summary.income)}</p>
            </button>
            <div className="flex-1 bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-100 dark:border-slate-700 px-3 py-2 text-center">
              <p className="text-[10px] text-slate-400 dark:text-slate-500 mb-0.5">Net</p>
              <p
                className={`text-sm font-bold ${
                  summary.net >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-500 dark:text-red-400"
                }`}
              >
                {summary.net >= 0 ? "+" : ""}
                {fmtAmt(summary.net)}
              </p>
            </div>
          </div>
        )}

        {/* Proportional breakdown bar — categories view only */}
        {view === "categories" && !loading && summary.spent > 0 && categories.length > 0 && (
          <div className="mt-3 flex h-2.5 w-full rounded-full overflow-hidden bg-slate-100 dark:bg-slate-700">
            {categories.map((cat) => (
              <div
                key={cat.name}
                style={{ width: `${cat.pct}%`, backgroundColor: colours[cat.name] ?? CATEGORY_COLOURS.Other }}
                title={`${cat.name} · ${Math.round(cat.pct)}%`}
              />
            ))}
          </div>
        )}

        {/* View switcher — categories / transactions / upcoming */}
        {(() => {
          const urgentCount = cashflow
            ? [...cashflow.upcoming_bills, ...cashflow.upcoming_income].filter(b => b.days_away <= 1).length
            : 0;
          return (
            <div className="mt-3 flex bg-slate-200/80 dark:bg-slate-800 rounded-xl p-1">
              {(["categories", "list", ...(isCurrentPeriod ? ["upcoming" as const] : [])] as const).map((v) => (
                <button
                  key={v}
                  onClick={() => setView(v)}
                  className={`flex-1 py-1.5 rounded-lg text-xs font-semibold transition-colors relative ${
                    view === v
                      ? "bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 shadow-sm"
                      : "text-slate-600 dark:text-slate-400"
                  }`}
                >
                  {v === "categories" ? "Categories" : v === "list" ? "Transactions" : "Upcoming"}
                  {v === "upcoming" && urgentCount > 0 && (
                    <span className="absolute -top-0.5 -right-0.5 w-4 h-4 rounded-full bg-amber-400 text-white text-[9px] font-bold flex items-center justify-center">
                      {urgentCount}
                    </span>
                  )}
                </button>
              ))}
            </div>
          );
        })()}
      </div>

      {/* Income drill-down panel */}
      {incomeExpanded && incomeTxns.length > 0 && (
        <div className="mx-4 mt-3 bg-white dark:bg-slate-800 rounded-2xl shadow-sm overflow-hidden">
          <div className="px-4 pt-3 pb-1">
            <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide">Income this period</p>
          </div>
          {incomeTxns.map(tx => (
            <TransactionRow
              key={tx.id}
              transaction={tx}
              onClick={() => setSelectedTx(tx)}
            />
          ))}
        </div>
      )}

      {/* Category grid — categories view */}
      {view === "categories" && (
      <div className="px-4 pt-4" data-tutorial-id="tutorial-spend-categories">
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <Spinner size={32} />
          </div>
        ) : categories.length === 0 ? (
          <div className="bg-white dark:bg-slate-800 rounded-2xl p-8 text-center shadow-sm">
            <p className="text-slate-400 dark:text-slate-500 text-sm">No spending in this period</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            {categories.map((cat) => {
              const colour = colours[cat.name] ?? CATEGORY_COLOURS[cat.name as keyof typeof CATEGORY_COLOURS] ?? CATEGORY_COLOURS.Other;
              return (
                <button
                  key={cat.name}
                  onClick={() => setOpenCategory(cat)}
                  className="bg-white dark:bg-slate-800 rounded-2xl shadow-sm p-4 text-left active:scale-95 transition-transform flex flex-col gap-2 overflow-hidden relative"
                >
                  {/* colour stripe */}
                  <div className="absolute left-0 top-0 bottom-0 w-1 rounded-l-2xl" style={{ backgroundColor: colour }} />
                  <div className="pl-1">
                    <p className="text-[13px] font-semibold text-slate-800 dark:text-slate-100 truncate">{cat.name}</p>
                    <p className="text-[11px] text-slate-400 dark:text-slate-500 mt-0.5">{cat.count} txn{cat.count !== 1 ? "s" : ""}</p>
                  </div>
                  <p className="text-base font-bold text-slate-900 dark:text-slate-100 pl-1">
                    £{cat.total.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </p>
                  {/* spend bar */}
                  <div className="h-1 w-full rounded-full bg-slate-100 dark:bg-slate-700 overflow-hidden">
                    <div className="h-full rounded-full" style={{ width: `${Math.min(cat.pct, 100)}%`, backgroundColor: colour }} />
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>
      )}

      {/* Untracked section — categories view */}
      {view === "categories" && !loading && untrackedCategories.length > 0 && (
        <div className="px-4 pt-2 pb-2">
          <button
            onClick={() => setUntrackedOpen(v => !v)}
            className="w-full flex items-center justify-between px-4 py-3 bg-white dark:bg-slate-800 rounded-2xl shadow-sm"
          >
            <div className="text-left">
              <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide">Untracked</p>
              <p className="text-xs text-slate-400 dark:text-slate-500 mt-0.5">
                Transfers — not counted in spend
              </p>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0 ml-3">
              <span className="text-xs font-semibold text-slate-500 dark:text-slate-400 bg-slate-100 dark:bg-slate-700 px-2 py-0.5 rounded-full">
                {untrackedCategories.reduce((s, c) => s + c.count, 0)}
              </span>
              {untrackedOpen
                ? <ChevronUp size={15} color="#94a3b8" />
                : <ChevronDown size={15} color="#94a3b8" />}
            </div>
          </button>

          {untrackedOpen && (
            <div className="mt-2 grid grid-cols-2 gap-3">
              {untrackedCategories.map(cat => {
                const colour = colours[cat.name] ?? CATEGORY_COLOURS[cat.name as keyof typeof CATEGORY_COLOURS] ?? CATEGORY_COLOURS.Other;
                return (
                  <button
                    key={cat.name}
                    onClick={() => setOpenCategory(cat)}
                    className="bg-white dark:bg-slate-800 rounded-2xl shadow-sm p-4 text-left active:scale-95 transition-transform flex flex-col gap-2 overflow-hidden relative"
                  >
                    <div className="absolute left-0 top-0 bottom-0 w-1 rounded-l-2xl" style={{ backgroundColor: colour }} />
                    <div className="pl-1">
                      <p className="text-[13px] font-semibold text-slate-800 dark:text-slate-100 truncate">{cat.name}</p>
                      <p className="text-[11px] text-slate-400 dark:text-slate-500 mt-0.5">{cat.count} txn{cat.count !== 1 ? "s" : ""}</p>
                    </div>
                    <p className="text-base font-bold text-slate-900 dark:text-slate-100 pl-1">
                      £{cat.total.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </p>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Chronological transaction list — list view */}
      {view === "list" && (
        <div className="px-4 pt-4">
          {loading ? (
            <div className="flex items-center justify-center py-16">
              <Spinner size={32} />
            </div>
          ) : listTxns.length === 0 ? (
            <div className="bg-white dark:bg-slate-800 rounded-2xl p-8 text-center shadow-sm">
              <p className="text-slate-400 dark:text-slate-500 text-sm">
                No transactions in this period
              </p>
            </div>
          ) : (
            <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-sm overflow-hidden divide-y divide-slate-50 dark:divide-slate-700">
              {listTxns.map((tx) => (
                <TransactionRow
                  key={tx.id}
                  transaction={tx}
                  onClick={() => setSelectedTx(tx)}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {/* Upcoming bills & income — card view */}
      {view === "upcoming" && (
        <div className="px-4 pt-4 pb-2">
          {!cashflow ? (
            <div className="flex items-center justify-center py-16"><Spinner size={32} /></div>
          ) : (() => {
            const sym = "£";

            // Sort chronologically: income before bills on same day (salary lands first)
            const rawItems = [
              ...cashflow.upcoming_income.map(b => ({ ...b, type: "income" as const })),
              ...cashflow.upcoming_bills.map(b => ({ ...b, type: "bill" as const })),
            ].sort((a, b) => {
              if (a.days_away !== b.days_away) return a.days_away - b.days_away;
              if (a.type !== b.type) return a.type === "income" ? -1 : 1;
              return b.amount - a.amount;
            });

            if (rawItems.length === 0) {
              return (
                <div className="bg-white dark:bg-slate-800 rounded-2xl p-8 text-center shadow-sm">
                  <p className="text-slate-400 dark:text-slate-500 text-sm">Nothing due in the next 14 days</p>
                </div>
              );
            }

            // Running balance projection (total across all accounts)
            let running = cashflow.available_balance ?? 0;
            const items = rawItems.map(item => {
              if (item.type === "income") {
                running += item.amount;
                return { ...item, balance_after: running, at_risk: false, account_short: false, is_credit_card: false };
              } else {
                running -= item.amount;
                const acctBalance = item.account_balance ?? null;
                // Negative balance = credit card. Don't flag as insufficient — it's a card charge.
                const is_credit_card = acctBalance !== null && acctBalance < 0;
                const account_short = !is_credit_card && acctBalance !== null && item.amount > acctBalance;
                return { ...item, balance_after: running, at_risk: running < 0, account_short, is_credit_card };
              }
            });

            const finalBalance = running;
            const atRiskCount = items.filter(i => i.type === "bill" && i.at_risk).length;

            // Group by day label
            const groups: { label: string; items: typeof items }[] = [];
            for (const item of items) {
              const label = item.days_away === 0 ? "Today" : item.days_away === 1 ? "Tomorrow" : `${item.days_away} days`;
              const g = groups.find(g => g.label === label);
              if (g) g.items.push(item);
              else groups.push({ label, items: [item] });
            }

            return (
              <div className="space-y-4">
                {/* Balance summary banner */}
                {cashflow.available_balance != null && (
                  <div className={`rounded-2xl px-4 py-3 flex items-center justify-between ${
                    atRiskCount > 0
                      ? "bg-rose-50 dark:bg-rose-900/20"
                      : "bg-emerald-50 dark:bg-emerald-900/20"
                  }`}>
                    <div>
                      <p className="text-xs font-semibold text-slate-500 dark:text-slate-400">Available now</p>
                      <p className="text-base font-bold text-slate-800 dark:text-slate-100">
                        {sym}{cashflow.available_balance.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-xs font-semibold text-slate-500 dark:text-slate-400">After all upcoming</p>
                      <p className={`text-base font-bold ${finalBalance >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"}`}>
                        {finalBalance >= 0 ? "" : "−"}{sym}{Math.abs(finalBalance).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </p>
                    </div>
                  </div>
                )}

                {/* Day groups */}
                {groups.map(({ label, items: groupItems }) => (
                  <div key={label}>
                    <p className={`text-xs font-semibold uppercase tracking-wide mb-2 ${
                      label === "Today" || label === "Tomorrow"
                        ? "text-amber-500"
                        : "text-slate-400 dark:text-slate-500"
                    }`}>{label}</p>
                    <div className="space-y-2">
                      {groupItems.map((item) => {
                        const flagged = item.at_risk || item.account_short;
                        return (
                          <div
                            key={`${item.type}-${item.name}`}
                            className={`rounded-2xl shadow-sm px-4 py-3 flex items-center gap-3 ${
                              flagged
                                ? "bg-rose-50 dark:bg-rose-900/20 border border-rose-200 dark:border-rose-800"
                                : "bg-white dark:bg-slate-800"
                            }`}
                          >
                            {/* Left indicator */}
                            {flagged ? (
                              <span className="text-rose-500 text-[15px] flex-shrink-0">⚠</span>
                            ) : (
                              <div className={`w-2 h-2 rounded-full flex-shrink-0 ${
                                item.type === "income" ? "bg-emerald-400" :
                                item.is_credit_card ? "bg-violet-400" : "bg-rose-400"
                              }`} />
                            )}

                            {/* Name + contextual info */}
                            <div className="flex-1 min-w-0">
                              <p className={`text-sm font-medium truncate ${flagged ? "text-rose-700 dark:text-rose-300" : "text-slate-800 dark:text-slate-100"}`}>
                                {item.name}
                              </p>

                              {/* Only show account details when there's a problem */}
                              {item.account_short && item.account_name && (
                                <p className="text-[11px] font-semibold text-rose-500 dark:text-rose-400 truncate">
                                  {item.account_name} · only {sym}{(item.account_balance ?? 0).toLocaleString("en-GB", { maximumFractionDigits: 0 })} available
                                </p>
                              )}
                              {item.at_risk && !item.account_short && (
                                <p className="text-[11px] font-semibold text-rose-500 dark:text-rose-400">
                                  Overall balance will be low
                                </p>
                              )}

                              {/* Subtle credit card label — no affordability flag */}
                              {item.is_credit_card && item.account_name && !flagged && (
                                <p className="text-[11px] text-slate-400 dark:text-slate-500 truncate">
                                  {item.account_name}
                                </p>
                              )}

                              <p className="text-[11px] text-slate-400 dark:text-slate-500">{item.expected_date}</p>
                            </div>

                            {/* Amount + running balance */}
                            <div className="text-right flex-shrink-0">
                              <p className={`text-base font-bold ${
                                item.type === "income" ? "text-emerald-500" :
                                flagged ? "text-rose-600 dark:text-rose-400" :
                                "text-slate-800 dark:text-slate-100"
                              }`}>
                                {item.type === "income" ? "+" : "−"}{sym}{item.amount.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                              </p>
                              <p className={`text-[11px] font-medium ${item.balance_after >= 0 ? "text-slate-400 dark:text-slate-500" : "text-rose-400"}`}>
                                {item.balance_after >= 0 ? "" : "−"}{sym}{Math.abs(item.balance_after).toLocaleString("en-GB", { maximumFractionDigits: 0 })} left
                              </p>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            );
          })()}
        </div>
      )}

      {/* Category sheet */}
      {openCategory && (
        <CategorySheet
          name={openCategory.name}
          total={openCategory.total}
          count={openCategory.count}
          transactions={openCategory.transactions}
          onClose={() => setOpenCategory(null)}
          onTransactionClick={(tx) => { setOpenCategory(null); setSelectedTx(tx); }}
        />
      )}

      {/* Transaction sheet */}
      {selectedTx && (
        <TransactionSheet
          transaction={selectedTx}
          onClose={() => setSelectedTx(null)}
          onUpdated={handleTxUpdated}
          account={accounts.find(a => a.id === selectedTx.account_id) ? { name: accounts.find(a => a.id === selectedTx.account_id)!.name, provider: accounts.find(a => a.id === selectedTx.account_id)!.provider } : undefined}
        />
      )}

      {/* Pay period settings sheet */}
      {settingsOpen && (
        <PayPeriodSettingsSheet
          current={payPeriodConfig}
          onClose={() => setSettingsOpen(false)}
          onSave={(config) => {
            setPayPeriodConfig(config);
            setSettingsOpen(false);
          }}
        />
      )}

      {/* Category & rules manager sheet */}
      {manageOpen && <CategoryManagerSheet onClose={() => setManageOpen(false)} />}

      <BottomNav />
    </div>
  );
}

const MONTH_SHORT = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

function formatPeriodLocal(start: Date, end: Date): string {
  const sd = start.getUTCDate();
  const sm = MONTH_SHORT[start.getUTCMonth()];
  const ed = end.getUTCDate();
  const em = MONTH_SHORT[end.getUTCMonth()];
  return `${sd} ${sm} → ${ed} ${em}`;
}

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function PayPeriodSettingsSheet({
  current,
  onClose,
  onSave,
}: {
  current: PayPeriodConfig;
  onClose: () => void;
  onSave: (c: PayPeriodConfig) => void;
}) {
  useLockBodyScroll();
  const [mode, setMode] = useState<PayPeriodConfig["type"]>(current.type === "custom" || current.type === "weekly" ? "calendar_month" : current.type);
  const [payDay, setPayDay] = useState(
    current.type === "monthly_pay_date" ? current.day : 25
  );
  const [weekday, setWeekday] = useState(
    (current.type === "weekly" || current.type === "biweekly" || current.type === "last_weekday_of_month") ? current.weekday : 5
  );
  const [biweeklyRef, setBiweeklyRef] = useState(
    current.type === "biweekly" ? current.referenceDate : new Date().toISOString().slice(0, 10)
  );

  function buildConfig(): PayPeriodConfig {
    switch (mode) {
      case "last_friday": return { type: "last_friday" };
      case "last_weekday_of_month": return { type: "last_weekday_of_month", weekday };
      case "calendar_month": return { type: "calendar_month" };
      case "monthly_pay_date": return { type: "monthly_pay_date", day: payDay };
      case "biweekly": return { type: "biweekly", weekday, referenceDate: biweeklyRef };
      default: return { type: "calendar_month" };
    }
  }

  const MODES: Array<{ value: PayPeriodConfig["type"]; label: string; desc: string }> = [
    { value: "calendar_month", label: "Calendar month", desc: "1st to last day of each month" },
    { value: "monthly_pay_date", label: "Monthly pay date", desc: "Period starts on a fixed day each month" },
    { value: "biweekly", label: "Every two weeks", desc: "14-day periods from a reference payday" },
    { value: "last_weekday_of_month", label: "Last weekday of month", desc: "Payday = last chosen weekday each month" },
  ];

  return (
    <>
      <div className="fixed inset-0 bg-black/40 z-[65]" onClick={onClose} />
      <div className="fixed bottom-0 left-1/2 -translate-x-1/2 w-full max-w-[430px] bg-white dark:bg-slate-800 rounded-t-3xl z-[70] overflow-y-auto max-h-[88vh]">
        <div className="flex justify-center pt-3 pb-1">
          <div className="w-10 h-1 bg-slate-200 dark:bg-slate-600 rounded-full" />
        </div>
        <div className="flex items-center justify-between px-5 pt-2 pb-4">
          <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100">Pay Period</h2>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-full bg-slate-100 dark:bg-slate-700">
            <X size={16} color="#64748b" />
          </button>
        </div>

        <div className="px-5 pb-4 space-y-2">
          {MODES.map(m => (
            <button
              key={m.value}
              onClick={() => setMode(m.value)}
              className={`w-full flex items-start gap-3 px-4 py-3 rounded-xl border-2 text-left transition-all ${
                mode === m.value ? "border-indigo-500 bg-indigo-50 dark:bg-indigo-900/20" : "border-slate-100 dark:border-slate-700 bg-slate-50 dark:bg-slate-700/40"
              }`}
            >
              <span className={`mt-0.5 w-4 h-4 rounded-full border-2 flex-shrink-0 flex items-center justify-center ${
                mode === m.value ? "border-indigo-500" : "border-slate-300 dark:border-slate-500"
              }`}>
                {mode === m.value && <span className="w-2 h-2 rounded-full bg-indigo-500" />}
              </span>
              <div>
                <p className={`text-sm font-semibold ${mode === m.value ? "text-indigo-700 dark:text-indigo-300" : "text-slate-700 dark:text-slate-200"}`}>{m.label}</p>
                <p className="text-xs text-slate-400 dark:text-slate-500 mt-0.5">{m.desc}</p>
              </div>
            </button>
          ))}
        </div>

        {/* Sub-options */}
        {mode === "monthly_pay_date" && (
          <div className="px-5 pb-4">
            <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-2">Pay day of month</p>
            <CustomSelect
              value={payDay}
              onChange={v => setPayDay(Number(v))}
              options={Array.from({ length: 28 }, (_, i) => i + 1).map(d => ({
                value: d,
                label: `${d}${d === 1 ? "st" : d === 2 ? "nd" : d === 3 ? "rd" : "th"} of each month`,
              }))}
            />
          </div>
        )}

        {mode === "last_weekday_of_month" && (
          <div className="px-5 pb-4">
            <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-2">Day of week</p>
            <CustomSelect
              value={weekday}
              onChange={v => setWeekday(Number(v))}
              options={WEEKDAYS.map((w, i) => ({ value: i, label: w }))}
            />
          </div>
        )}

        {mode === "biweekly" && (
          <div className="px-5 pb-4 space-y-3">
            <div>
              <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-2">Pay day</p>
              <CustomSelect
                value={weekday}
                onChange={v => setWeekday(Number(v))}
                options={WEEKDAYS.map((w, i) => ({ value: i, label: w }))}
              />
            </div>
            <div>
              <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-2">A known payday date</p>
              <input
                type="date"
                value={biweeklyRef}
                onChange={e => setBiweeklyRef(e.target.value)}
                className="w-full text-sm bg-slate-50 dark:bg-slate-700 dark:text-slate-100 border border-slate-200 dark:border-slate-600 rounded-xl px-3 py-2.5 outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
          </div>
        )}

        <div className="px-5 pb-8">
          <button
            onClick={() => onSave(buildConfig())}
            className="w-full py-4 rounded-2xl font-semibold text-white text-base"
            style={{ background: "linear-gradient(135deg, #4f46e5, #7c3aed)" }}
          >
            Save Pay Period
          </button>
        </div>
      </div>
    </>
  );
}
