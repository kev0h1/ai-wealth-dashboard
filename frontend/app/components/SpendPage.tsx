"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import { ChevronDown, ChevronUp, Settings2, X } from "lucide-react";
import { api, Account, Transaction } from "@/lib/api";
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
import CategoryRow, { CategoryData } from "@/components/CategoryRow";
import TransactionSheet from "@/components/TransactionSheet";
import BottomNav from "@/components/BottomNav";
import Spinner from "@/components/Spinner";
import TransactionRow from "@/components/TransactionRow";

async function ensureAuth() {}

const SKIP_FROM_SPEND = new Set(["Transfer"]);

function formatDateLocal(iso: string) {
  const d = new Date(iso);
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

export default function SpendPage() {
  const { payPeriodConfig, setPayPeriodConfig } = usePreferences();
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
  const [expandedCat, setExpandedCat] = useState<string | null>(null);
  const [expandedUntrackedCat, setExpandedUntrackedCat] = useState<string | null>(null);
  const [untrackedOpen, setUntrackedOpen] = useState(false);
  const [selectedTx, setSelectedTx] = useState<Transaction | null>(null);
  const [incomeExpanded, setIncomeExpanded] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const [accounts, setAccounts] = useState<Account[]>([]);

  const loadData = useCallback(async () => {
    try {
      await ensureAuth();
      const accs = await api.accounts().catch(() => [] as Account[]);
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
    setExpandedCat(null);
    setExpandedUntrackedCat(null);
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

  function handlePrev() {
    const [s, e] = prevPeriodWithConfig(periodStart, payPeriodConfig);
    setPeriodStart(s);
    setPeriodEnd(e);
    setExpandedCat(null);
    setExpandedUntrackedCat(null);
  }

  function handleNext() {
    const [s, e] = nextPeriodWithConfig(periodEnd, payPeriodConfig);
    setPeriodStart(s);
    setPeriodEnd(e);
    setExpandedCat(null);
    setExpandedUntrackedCat(null);
  }

  const [currentStart, currentEnd] = getPayPeriodWithConfig(new Date(), payPeriodConfig);
  const isCurrentPeriod =
    periodStart.getTime() === currentStart.getTime() &&
    periodEnd.getTime() === currentEnd.getTime();

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
    <div className="min-h-dvh bg-[#f0f2f7] dark:bg-[#0f172a] pb-20 lg:pb-8 lg:max-w-6xl lg:mx-auto">
      {/* Header */}
      <div
        className="px-4 pt-6 pb-5 text-white"
        style={{
          background: "linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%)",
        }}
      >
        <h1 className="text-lg font-bold mb-4">Spending</h1>

        {/* Period nav */}
        <div className="flex items-center justify-between bg-white/15 backdrop-blur rounded-2xl px-3 py-2">
          <button
            onClick={handlePrev}
            className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-white/20 transition-colors"
          >
            <span className="text-white text-lg leading-none">‹</span>
          </button>
          <div className="text-center">
            <p className="text-sm font-semibold">
              {formatPeriodLocal(periodStart, periodEnd)}
            </p>
            {isCurrentPeriod && (
              <p className="text-[10px] opacity-70 mt-0.5">Current period</p>
            )}
          </div>
          <button
            onClick={handleNext}
            disabled={isCurrentPeriod}
            className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-white/20 transition-colors disabled:opacity-30"
          >
            <span className="text-white text-lg leading-none">›</span>
          </button>
        </div>

        <button
          onClick={() => setSettingsOpen(true)}
          className="mt-2 flex items-center gap-1.5 mx-auto text-white/70 hover:text-white/90 transition-colors text-xs"
        >
          <Settings2 size={12} />
          <span>Pay period settings</span>
        </button>

        {/* Summary chips */}
        {!loading && (
          <div className="flex gap-2 mt-4">
            <div className="flex-1 bg-white/15 backdrop-blur rounded-xl px-3 py-2 text-center">
              <p className="text-[10px] opacity-70 mb-0.5">Spent</p>
              <p className="text-sm font-bold">{fmtAmt(summary.spent)}</p>
            </div>
            <button
              onClick={() => setIncomeExpanded(v => !v)}
              className="flex-1 bg-white/15 backdrop-blur rounded-xl px-3 py-2 text-center active:bg-white/25 transition-colors"
            >
              <p className="text-[10px] opacity-70 mb-0.5 flex items-center justify-center gap-0.5">
                Income {incomeExpanded ? <ChevronUp size={10} /> : <ChevronDown size={10} />}
              </p>
              <p className="text-sm font-bold">{fmtAmt(summary.income)}</p>
            </button>
            <div className="flex-1 bg-white/15 backdrop-blur rounded-xl px-3 py-2 text-center">
              <p className="text-[10px] opacity-70 mb-0.5">Net</p>
              <p
                className={`text-sm font-bold ${
                  summary.net >= 0 ? "text-emerald-300" : "text-red-300"
                }`}
              >
                {summary.net >= 0 ? "+" : ""}
                {fmtAmt(summary.net)}
              </p>
            </div>
          </div>
        )}
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

      {/* Category list */}
      <div className="px-4 pt-4 space-y-2">
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <Spinner size={32} />
          </div>
        ) : categories.length === 0 ? (
          <div className="bg-white dark:bg-slate-800 rounded-2xl p-8 text-center shadow-sm">
            <p className="text-slate-400 dark:text-slate-500 text-sm">
              No spending in this period
            </p>
          </div>
        ) : (
          categories.map((cat) => (
            <CategoryRow
              key={cat.name}
              data={cat}
              expanded={expandedCat === cat.name}
              onToggle={() =>
                setExpandedCat(expandedCat === cat.name ? null : cat.name)
              }
              onTransactionClick={(tx) => setSelectedTx(tx)}
            />
          ))
        )}
      </div>

      {/* Untracked section */}
      {!loading && untrackedCategories.length > 0 && (
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
            <div className="mt-2 space-y-2">
              {untrackedCategories.map(cat => (
                <CategoryRow
                  key={cat.name}
                  data={cat}
                  expanded={expandedUntrackedCat === cat.name}
                  onToggle={() => setExpandedUntrackedCat(expandedUntrackedCat === cat.name ? null : cat.name)}
                  onTransactionClick={tx => setSelectedTx(tx)}
                />
              ))}
            </div>
          )}
        </div>
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
            <select
              value={payDay}
              onChange={e => setPayDay(Number(e.target.value))}
              className="w-full text-sm bg-slate-50 dark:bg-slate-700 dark:text-slate-100 border border-slate-200 dark:border-slate-600 rounded-xl px-3 py-2.5 outline-none focus:ring-2 focus:ring-indigo-500 appearance-none"
            >
              {Array.from({ length: 28 }, (_, i) => i + 1).map(d => (
                <option key={d} value={d}>{d}{d === 1 ? "st" : d === 2 ? "nd" : d === 3 ? "rd" : "th"} of each month</option>
              ))}
            </select>
          </div>
        )}

        {mode === "last_weekday_of_month" && (
          <div className="px-5 pb-4">
            <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-2">Day of week</p>
            <select
              value={weekday}
              onChange={e => setWeekday(Number(e.target.value))}
              className="w-full text-sm bg-slate-50 dark:bg-slate-700 dark:text-slate-100 border border-slate-200 dark:border-slate-600 rounded-xl px-3 py-2.5 outline-none focus:ring-2 focus:ring-indigo-500 appearance-none"
            >
              {WEEKDAYS.map((w, i) => <option key={i} value={i}>{w}</option>)}
            </select>
          </div>
        )}

        {mode === "biweekly" && (
          <div className="px-5 pb-4 space-y-3">
            <div>
              <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-2">Pay day</p>
              <select
                value={weekday}
                onChange={e => setWeekday(Number(e.target.value))}
                className="w-full text-sm bg-slate-50 dark:bg-slate-700 dark:text-slate-100 border border-slate-200 dark:border-slate-600 rounded-xl px-3 py-2.5 outline-none focus:ring-2 focus:ring-indigo-500 appearance-none"
              >
                {WEEKDAYS.map((w, i) => <option key={i} value={i}>{w}</option>)}
              </select>
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
