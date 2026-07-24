"use client";

import { useEffect, useLayoutEffect, useState, useCallback, useMemo, useRef } from "react";
import { useSearchParams } from "next/navigation";
import { ChevronDown, ChevronUp, ChevronLeft, ChevronRight, Settings2, X, SlidersHorizontal, AlertTriangle } from "lucide-react";
import { api, Account, Transaction, CashflowData } from "@/lib/api";
import { useAllTransactions, invalidateTransactionsCache } from "@/lib/useAllTransactions";
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
import { usePeriodSwipe } from "@/lib/usePeriodSwipe";
import { isHomeCurrency } from "@/lib/currency";
import { getCategoryIcon } from "@/lib/categoryIcons";
import { useCategoryIcons } from "@/components/IconProvider";
import { useSheetA11y } from "@/lib/useSheetA11y";
import { CategoryData } from "@/components/CategoryRow";
import CategorySheet from "@/components/CategorySheet";
import TransactionSheet from "@/components/TransactionSheet";
import BottomNav from "@/components/BottomNav";
import Spinner from "@/components/Spinner";
import TransactionRow from "@/components/TransactionRow";
import CategoryManagerSheet from "@/components/CategoryManagerSheet";
import SpendTrends from "@/components/SpendTrends";
import CustomSelect from "@/components/CustomSelect";
import SegmentedControl from "@/components/SegmentedControl";

async function ensureAuth() {}

const SKIP_FROM_SPEND = new Set(["Transfer"]);

function formatDateLocal(iso: string) {
  const d = new Date(iso);
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

export default function SpendPage() {
  const { payPeriodConfig, setPayPeriodConfig, region } = usePreferences();
  const { colours } = useColours();
  const { icons: iconOverrides } = useCategoryIcons();
  const searchParams = useSearchParams();
  const [view, setView] = useState<"categories" | "list" | "upcoming" | "trends">(() => {
    const v = searchParams.get("view");
    return v === "upcoming" || v === "list" || v === "trends" ? v : "categories";
  });
  const [cashflow, setCashflow] = useState<CashflowData | null>(null);
  const { transactions: allTransactions, loading: txLoading, setTransactions: setAllTransactions } = useAllTransactions();
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
  const [isPro, setIsPro] = useState<boolean>(false);

  // Desktop shows every view at once (no tabs), so render mode must be
  // decided in JS — CSS-hiding a duplicate tree would double every fetch.
  const [isDesktop, setIsDesktop] = useState(false);
  useLayoutEffect(() => {
    const mq = window.matchMedia("(min-width: 1024px)");
    const update = () => setIsDesktop(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);

  const loadData = useCallback(async () => {
    try {
      await ensureAuth();
      const [accs] = await Promise.all([
        api.accounts().catch(() => [] as Account[]),
        api.cashflow().then(setCashflow).catch(() => {}),
      ]);
      setAccounts(accs);
    } catch {}
    finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  useEffect(() => {
    api.getSubscription()
      .then(s => setIsPro(s.tier !== "free"))
      .catch(() => setIsPro(true));
  }, []);

  // Page is ready once both accounts/cashflow and transactions are loaded.
  const pageLoading = loading || txLoading;

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

  // Totals are single-currency: foreign-currency transactions (e.g. a KES
  // statement import) show in the list with their own symbol but must not be
  // summed into home-currency figures
  const homeTxns = useMemo(
    () => periodTxns.filter(tx => isHomeCurrency(tx.currency, region)),
    [periodTxns, region]
  );
  const homeAllTxns = useMemo(
    () => allTransactions.filter(tx => isHomeCurrency(tx.currency, region)),
    [allTransactions, region]
  );

  // Compute summary. Transactions live where their category points: Income
  // counts as income, anything else counts as spend — a credit categorised
  // as e.g. Eating Out is a refund and nets against that category, not income.
  const summary = useMemo(() => {
    let spent = 0;
    let income = 0;
    for (const tx of homeTxns) {
      const cat = tx.category || "Other";
      if (cat === "Transfer") continue;
      const amt = Math.abs(tx.amount);
      if (cat === "Income") {
        income += tx.transaction_type === "credit" ? amt : -amt;
      } else {
        spent += tx.transaction_type === "debit" ? amt : -amt;
      }
    }
    return { spent, income, net: income - spent };
  }, [homeTxns]);

  // Category breakdown
  const categories = useMemo((): CategoryData[] => {
    const map: Record<string, { total: number; count: number; transactions: Transaction[] }> = {};
    for (const tx of homeTxns) {
      const cat = tx.category || "Other";
      if (SKIP_FROM_SPEND.has(cat) || cat === "Income") continue;
      if (!map[cat]) map[cat] = { total: 0, count: 0, transactions: [] };
      // Credits here are refunds — they net against the category's spend
      map[cat].total += tx.transaction_type === "credit" ? -Math.abs(tx.amount) : Math.abs(tx.amount);
      map[cat].count += 1;
      map[cat].transactions.push(tx);
    }
    const totalSpend = Object.values(map).reduce((s, v) => s + Math.max(v.total, 0), 0);
    return Object.entries(map)
      .map(([name, { total, count, transactions }]) => ({
        name,
        total,
        count,
        transactions: transactions.sort(
          (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
        ),
        pct: totalSpend > 0 && total > 0 ? (total / totalSpend) * 100 : 0,
      }))
      .sort((a, b) => b.total - a.total);
  }, [homeTxns]);

  // Untracked categories — only Transfer (both directions)
  const untrackedCategories = useMemo((): CategoryData[] => {
    const map: Record<string, { total: number; count: number; transactions: Transaction[] }> = {};
    for (const tx of homeTxns) {
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
  }, [homeTxns]);

  // Income transactions for drill-down — Income category only; other credits
  // are refunds and live in their own category
  const incomeTxns = useMemo(
    () =>
      homeTxns
        .filter(
          (tx) =>
            tx.transaction_type === "credit" &&
            (tx.category || "Other") === "Income"
        )
        .sort(
          (a, b) =>
            new Date(b.date).getTime() - new Date(a.date).getTime()
        ),
    [homeTxns]
  );

  // All transactions in the period, newest first — for the chronological list view
  const listTxns = useMemo(
    () =>
      [...periodTxns].sort(
        (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
      ),
    [periodTxns]
  );

  // Bills due within 7 days whose linked account can't cover the amount.
  // Mirrors the at-risk predicate in backend/app/routers/analytics.py at_risk_count.
  const atRiskBills = useMemo(
    () =>
      cashflow
        ? cashflow.upcoming_bills.filter(
            (b) =>
              b.days_away <= 7 &&
              b.account_balance != null &&
              b.account_balance >= 0 &&
              b.amount > b.account_balance
          )
        : [],
    [cashflow]
  );

  // Stop at the period containing the oldest transaction — no empty pre-history
  const canGoPrev = !oldestTxDate || periodStart.getTime() > oldestTxDate.getTime();

  const [undoDismiss, setUndoDismiss] = useState<string | null>(null);
  const [undoNonce, setUndoNonce] = useState(0);
  const undoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [largeToast, setLargeToast] = useState(false);
  const largeToastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const listSectionRef = useRef<HTMLDivElement>(null);
  const [highlightBill, setHighlightBill] = useState<string | null>(null);
  const [largeOnly, setLargeOnly] = useState(false);
  // When the shortfall callout's "Review" is tapped, scroll the flagged bill
  // into view on the Upcoming tab and briefly ring it, then clear the highlight.
  useEffect(() => {
    if (view !== "upcoming" || !highlightBill) return;
    const scrollTimer = setTimeout(() => {
      try {
        document
          .querySelector(`[data-bill-key="${CSS.escape(highlightBill)}"]`)
          ?.scrollIntoView({ behavior: "smooth", block: "center" });
      } catch {}
    }, 120);
    const clearTimer = setTimeout(() => setHighlightBill(null), 2800);
    return () => { clearTimeout(scrollTimer); clearTimeout(clearTimer); };
  }, [view, highlightBill]);

  // Keep what was removed + the in-flight request, so Undo can restore the UI
  // instantly and sequence the server calls (restore must not race dismiss)
  const lastDismissRef = useRef<{
    name: string;
    bills: CashflowData["upcoming_bills"];
    income: CashflowData["upcoming_income"];
    request: Promise<unknown>;
  } | null>(null);

  function dismissUpcoming(name: string) {
    setCashflow(prev => {
      if (!prev) return prev;
      lastDismissRef.current = {
        name,
        bills: prev.upcoming_bills.filter(b => b.name === name),
        income: prev.upcoming_income.filter(b => b.name === name),
        request: api.dismissRecurring(name).catch(() => {}),
      };
      return {
        ...prev,
        upcoming_bills: prev.upcoming_bills.filter(b => b.name !== name),
        upcoming_income: prev.upcoming_income.filter(b => b.name !== name),
      };
    });
    setUndoDismiss(name);
    setUndoNonce(n => n + 1);
    if (undoTimer.current) clearTimeout(undoTimer.current);
    undoTimer.current = setTimeout(() => setUndoDismiss(null), 6000);
  }

  async function undoLastDismiss() {
    const last = lastDismissRef.current;
    if (!last) return;
    setUndoDismiss(null);
    lastDismissRef.current = null;
    // Put the rows back immediately — the server catches up behind the scenes
    setCashflow(prev => prev ? {
      ...prev,
      upcoming_bills: [...prev.upcoming_bills, ...last.bills].sort((a, b) => a.days_away - b.days_away),
      upcoming_income: [...prev.upcoming_income, ...last.income].sort((a, b) => a.days_away - b.days_away),
    } : prev);
    try {
      await last.request;                    // wait for the dismiss to land first
      await api.restoreRecurring(last.name); // then undo it
      const fresh = await api.cashflow();    // reconcile with server truth
      setCashflow(fresh);
    } catch {}
  }

  function handlePrev() {
    if (!canGoPrev) return;
    const [s, e] = prevPeriodWithConfig(periodStart, payPeriodConfig);
    setPeriodStart(s);
    setPeriodEnd(e);
    if (view === "upcoming") setView("categories");
    setLargeOnly(false);
  }

  function handleNext() {
    const [s, e] = nextPeriodWithConfig(periodEnd, payPeriodConfig);
    setPeriodStart(s);
    setPeriodEnd(e);
    setLargeOnly(false);
  }

  const [currentStart, currentEnd] = getPayPeriodWithConfig(new Date(), payPeriodConfig);
  const isCurrentPeriod =
    periodStart.getTime() === currentStart.getTime() &&
    periodEnd.getTime() === currentEnd.getTime();

  const periodSwipe = usePeriodSwipe({ onPrev: handlePrev, onNext: handleNext, canPrev: canGoPrev, canNext: !isCurrentPeriod });

  // Sync view with ?view= query param when it changes (e.g. deep-link from home strip)
  useEffect(() => {
    const v = searchParams.get("view");
    if (v === "upcoming" || v === "list" || v === "categories" || v === "trends") setView(v);
  }, [searchParams]);


  function handleTxUpdated(updated: Transaction, additionalIds?: string[]) {
    invalidateTransactionsCache();
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

  const fmtSummary = (n: number) =>
    `£${Math.abs(n).toLocaleString("en-GB", {
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    })}`;

  return (
    <div className="min-h-dvh bg-[#f0f2f7] dark:bg-[#0f172a] pb-20 lg:pb-8 lg:max-w-6xl lg:mx-auto" style={{ paddingTop: "env(safe-area-inset-top, 0px)" }}>
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

        {/* Period nav + summary chips: stacked on mobile, side-by-side on desktop */}
        <div className="lg:grid lg:grid-cols-2 lg:gap-3 lg:items-stretch">
        <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-sm border border-slate-100 dark:border-slate-700 p-3" {...periodSwipe} style={{ touchAction: "pan-y" }}>
          <div className="flex items-center justify-between">
            <button
              onClick={handlePrev}
              disabled={!canGoPrev}
              className="w-11 h-11 flex items-center justify-center rounded-full bg-slate-100 dark:bg-slate-700 active:bg-slate-200 dark:active:bg-slate-600 transition-colors disabled:opacity-30"
            >
              <ChevronLeft size={16} color="#64748b" />
            </button>
            <div className="text-center">
              <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">
                {formatPeriodLocal(periodStart, periodEnd)}
              </p>
              {isCurrentPeriod && (
                <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">Current period</p>
              )}
            </div>
            <button
              onClick={handleNext}
              disabled={isCurrentPeriod}
              className="w-11 h-11 flex items-center justify-center rounded-full bg-slate-100 dark:bg-slate-700 active:bg-slate-200 dark:active:bg-slate-600 transition-colors disabled:opacity-30"
            >
              <ChevronRight size={16} color="#64748b" />
            </button>
          </div>
          <button
            onClick={() => setSettingsOpen(true)}
            className="mt-2 flex items-center gap-1.5 mx-auto text-slate-500 dark:text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors text-xs"
          >
            <Settings2 size={12} />
            <span>Pay period settings</span>
          </button>
        </div>

        {/* Summary chips */}
        {!pageLoading && (
          <div className="flex gap-2 mt-3 lg:mt-0">
            <div className="flex-1 bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-100 dark:border-slate-700 px-3 py-2 text-center">
              <p className="text-[11px] text-slate-500 dark:text-slate-400 mb-0.5">Spent</p>
              <p className="text-sm font-bold text-slate-900 dark:text-slate-100">{fmtSummary(summary.spent)}</p>
            </div>
            <button
              onClick={() => setIncomeExpanded(v => !v)}
              className="flex-1 bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-100 dark:border-slate-700 px-3 py-2 text-center active:scale-[0.98] transition-transform"
            >
              <p className="text-[11px] text-slate-500 dark:text-slate-400 mb-0.5 flex items-center justify-center gap-0.5">
                Income {incomeExpanded ? <ChevronUp size={10} /> : <ChevronDown size={10} />}
              </p>
              <p className="text-sm font-bold text-slate-900 dark:text-slate-100">{fmtSummary(summary.income)}</p>
            </button>
            <div className="flex-1 bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-100 dark:border-slate-700 px-3 py-2 text-center">
              <p className="text-[11px] text-slate-500 dark:text-slate-400 mb-0.5">Net</p>
              <p
                className={`text-sm font-bold ${
                  summary.net >= 0 ? "text-emerald-700 dark:text-emerald-400" : "text-red-600 dark:text-red-400"
                }`}
              >
                {summary.net >= 0 ? "+" : ""}
                {fmtSummary(summary.net)}
              </p>
            </div>
          </div>
        )}
        </div>{/* end lg:grid wrapper */}

        {/* Proportional breakdown bar — categories view only */}
        {(isDesktop || view === "categories") && !pageLoading && summary.spent > 0 && categories.length > 0 && (
          <div
            role="img"
            aria-label={"Spending breakdown: " + categories.map(c => `${c.name} ${Math.round(c.pct)}%`).join(", ")}
            className="mt-3 flex h-2.5 w-full rounded-full overflow-hidden bg-slate-100 dark:bg-slate-700"
          >
            {categories.map((cat) => (
              <div
                key={cat.name}
                style={{ width: `${cat.pct}%`, backgroundColor: colours[cat.name] ?? CATEGORY_COLOURS.Other }}
                title={`${cat.name} · ${Math.round(cat.pct)}%`}
              />
            ))}
          </div>
        )}

        {/* Bill shortfall callout — visible on all views when at-risk bills exist */}
        {isCurrentPeriod && atRiskBills.length > 0 && (
          <button
            onClick={() => {
              const top = atRiskBills[0];
              if (top) setHighlightBill(`bill-${top.name}-${top.expected_date}`);
              setView("upcoming");
            }}
            className="mt-3 w-full text-left bg-rose-50 dark:bg-rose-900/20 border border-rose-200 dark:border-rose-800 rounded-2xl px-4 py-3 active:scale-[0.99] transition-transform"
          >
            <div className="flex items-start gap-2.5">
              <AlertTriangle size={16} className="text-rose-500 dark:text-rose-400 flex-shrink-0 mt-0.5" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-rose-700 dark:text-rose-300">
                  {atRiskBills.length === 1
                    ? "1 bill may not clear this week"
                    : `${atRiskBills.length} bills may not clear this week`}
                </p>
                {(() => {
                  const top = atRiskBills[0];
                  const sym = region === "Kenya" ? "KES " : "£";
                  return (
                    <p className="text-xs text-rose-600 dark:text-rose-400 mt-0.5 truncate">
                      {top.name} {sym}{top.amount.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      {" — "}
                      {top.account_name || "your account"} only has {sym}{(top.account_balance ?? 0).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </p>
                  );
                })()}
              </div>
              <span className="text-xs font-semibold text-rose-600 dark:text-rose-400 flex-shrink-0 self-center">Review</span>
            </div>
          </button>
        )}

        {/* View switcher — categories / transactions / upcoming */}
        {(() => {
          if (isDesktop) return null;
          const urgentCount = cashflow
            ? [...cashflow.upcoming_bills, ...cashflow.upcoming_income].filter(b => b.days_away <= 1).length
            : 0;
          return (
            <SegmentedControl
              ariaLabel="View"
              className="mt-3"
              value={view}
              onChange={(v) => setView(v as typeof view)}
              options={[
                { value: "categories", label: "Categories" },
                { value: "list", label: "Transactions" },
                { value: "trends", label: "Trends" },
                ...(isCurrentPeriod ? [{ value: "upcoming", label: "Upcoming", badge: urgentCount }] : []),
              ]}
            />
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

      {/* ── Content blocks extracted as consts for desktop/mobile reuse ── */}
      {(() => {
        const sectionTitle = (label: string, colour: string) => (
          <div className="flex items-center gap-2 px-1">
            <span className="w-2 h-2 rounded-full" style={{ backgroundColor: colour }} />
            <h2 className="text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">{label}</h2>
          </div>
        );

        const categoriesBlock = (
          <>
            {pageLoading ? (
              <div className="flex items-center justify-center py-16">
                <Spinner size={32} />
              </div>
            ) : categories.length === 0 ? (
              <div className="bg-white dark:bg-slate-800 rounded-2xl p-8 text-center shadow-sm">
                <p className="text-slate-500 dark:text-slate-400 text-sm">No spending in this period</p>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-3">
                {categories.map((cat) => {
                  const colour = colours[cat.name] ?? CATEGORY_COLOURS[cat.name as keyof typeof CATEGORY_COLOURS] ?? CATEGORY_COLOURS.Other;
                  const Icon = getCategoryIcon(cat.name, iconOverrides);
                  return (
                    <button
                      key={cat.name}
                      onClick={() => setOpenCategory(cat)}
                      className="bg-white dark:bg-slate-800 rounded-2xl shadow-sm p-4 text-left active:scale-95 transition-transform flex flex-col gap-2 overflow-hidden"
                    >
                      <div className="flex items-center gap-2.5">
                        {/* tinted icon chip — the card's single colour-identity cue */}
                        <span
                          className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
                          style={{ backgroundColor: `${colour}26` }}
                        >
                          <Icon size={16} style={{ color: colour }} />
                        </span>
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-slate-800 dark:text-slate-100 truncate">{cat.name}</p>
                          <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">{cat.count} txn{cat.count !== 1 ? "s" : ""}</p>
                        </div>
                      </div>
                      <p className="text-base font-bold text-slate-900 dark:text-slate-100">
                        £{cat.total.toLocaleString("en-GB", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                      </p>
                      {/* spend bar */}
                      <div className="h-1 w-full rounded-full bg-slate-100 dark:bg-slate-700 overflow-hidden">
                        <div className="h-full rounded-full" style={{ width: `${Math.min(cat.pct, 100)}%`, backgroundColor: colour }} />
                      </div>
                      {(cat.name.toLowerCase() === "transport" || cat.name.toLowerCase() === "groceries" || cat.name === "Debt") && (
                        <p className="text-[10px] text-slate-400 dark:text-slate-500 font-medium -mt-1">
                          {cat.name.toLowerCase() === "transport" ? "⛽ cheaper fuel inside" : cat.name.toLowerCase() === "groceries" ? "🧾 scan receipts inside" : "› payoff plan"}
                        </p>
                      )}
                    </button>
                  );
                })}
              </div>
            )}
          </>
        );

        const untrackedBlock = (
          <>
            <button
              onClick={() => setUntrackedOpen(v => !v)}
              className="w-full flex items-center justify-between px-4 py-3 bg-white dark:bg-slate-800 rounded-2xl shadow-sm"
            >
              <div className="text-left">
                <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide">Untracked</p>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
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
                  const Icon = getCategoryIcon(cat.name, iconOverrides);
                  return (
                    <button
                      key={cat.name}
                      onClick={() => setOpenCategory(cat)}
                      className="bg-white dark:bg-slate-800 rounded-2xl shadow-sm p-4 text-left active:scale-95 transition-transform flex flex-col gap-2 overflow-hidden"
                    >
                      <div className="flex items-center gap-2.5">
                        <span
                          className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
                          style={{ backgroundColor: `${colour}26` }}
                        >
                          <Icon size={16} style={{ color: colour }} />
                        </span>
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-slate-800 dark:text-slate-100 truncate">{cat.name}</p>
                          <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">{cat.count} txn{cat.count !== 1 ? "s" : ""}</p>
                        </div>
                      </div>
                      <p className="text-base font-bold text-slate-900 dark:text-slate-100">
                        £{cat.total.toLocaleString("en-GB", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                      </p>
                    </button>
                  );
                })}
              </div>
            )}
          </>
        );

        const displayTxns = largeOnly ? listTxns.filter(tx => Math.abs(tx.amount) >= 250) : listTxns;
        const listBlock = (
          <div ref={listSectionRef}>
            {largeOnly && (
              <div className="flex items-center justify-between mb-2 px-1">
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-indigo-100 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-700/60">
                  Payments over £250
                </span>
                <button
                  onClick={() => setLargeOnly(false)}
                  className="text-xs font-semibold text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 transition-colors"
                >
                  Show all
                </button>
              </div>
            )}
            {pageLoading ? (
              <div className="flex items-center justify-center py-16">
                <Spinner size={32} />
              </div>
            ) : displayTxns.length === 0 ? (
              <div className="bg-white dark:bg-slate-800 rounded-2xl p-8 text-center shadow-sm">
                <p className="text-slate-500 dark:text-slate-400 text-sm">
                  {largeOnly ? "No payments over £250 in this period" : "No transactions in this period"}
                </p>
              </div>
            ) : (
              <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-sm overflow-hidden divide-y divide-slate-50 dark:divide-slate-700 lg:max-h-[640px] lg:overflow-y-auto">
                {displayTxns.map((tx) => (
                  <TransactionRow
                    key={tx.id}
                    transaction={tx}
                    onClick={() => setSelectedTx(tx)}
                  />
                ))}
              </div>
            )}
          </div>
        );

        const trendsBlock = (
          <>
            {pageLoading ? (
              <div className="flex items-center justify-center py-16">
                <Spinner size={32} />
              </div>
            ) : (
              <SpendTrends
                periodTxns={homeTxns}
                allTxns={homeAllTxns}
                periodStart={periodStart}
                periodEnd={periodEnd}
                payPeriodConfig={payPeriodConfig}
                colours={colours}
                onReviewLarge={() => {
                  setLargeOnly(true);
                  setView("list");
                  setLargeToast(true);
                  if (largeToastTimer.current) clearTimeout(largeToastTimer.current);
                  largeToastTimer.current = setTimeout(() => setLargeToast(false), 2500);
                  // After the state update paints, scroll to the transactions list
                  // (window top on mobile; list section into view on desktop).
                  // Respects prefers-reduced-motion: smooth vs instant.
                  requestAnimationFrame(() => {
                    const reducedMotion =
                      typeof window !== "undefined" &&
                      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
                    const scrollBehavior: ScrollBehavior = reducedMotion ? "auto" : "smooth";
                    if (listSectionRef.current) {
                      listSectionRef.current.scrollIntoView({ behavior: scrollBehavior, block: "start" });
                    } else {
                      window.scrollTo({ top: 0, behavior: scrollBehavior });
                    }
                  });
                }}
              />
            )}
          </>
        );

        const upcomingBlock = (
          <>
            {!cashflow ? (
              <div className="flex items-center justify-center py-16"><Spinner size={32} /></div>
            ) : (() => {
              const sym = "£";

              // Sort chronologically: income before bills on same day (salary lands first).
              // Clip to the end of the current pay period — the backend projects
              // further so any period length is covered.
              const rawItems = [
                ...cashflow.upcoming_income.map(b => ({ ...b, type: "income" as const })),
                ...cashflow.upcoming_bills.map(b => ({ ...b, type: "bill" as const })),
              ].filter(b => new Date(b.expected_date) <= periodEnd)
               .sort((a, b) => {
                if (a.days_away !== b.days_away) return a.days_away - b.days_away;
                if (a.type !== b.type) return a.type === "income" ? -1 : 1;
                return b.amount - a.amount;
              });

              if (rawItems.length === 0) {
                return (
                  <div className="bg-white dark:bg-slate-800 rounded-2xl p-8 text-center shadow-sm">
                    <p className="text-slate-500 dark:text-slate-400 text-sm">Nothing more expected this pay period</p>
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
                    <>
                    <div className={`rounded-2xl px-4 py-3 flex items-center justify-between ${
                      atRiskCount > 0
                        ? "bg-rose-50 dark:bg-rose-900/20"
                        : "bg-emerald-50 dark:bg-emerald-900/20"
                    }`}>
                      <div>
                        <p className="text-xs font-semibold text-slate-600 dark:text-slate-400">Available now</p>
                        <p className="text-base font-bold text-slate-800 dark:text-slate-100">
                          {sym}{cashflow.available_balance.toLocaleString("en-GB", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="text-xs font-semibold text-slate-600 dark:text-slate-400">After all upcoming</p>
                        <p className={`text-base font-bold ${finalBalance >= 0 ? "text-emerald-700 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"}`}>
                          {finalBalance >= 0 ? "" : "−"}{sym}{Math.abs(finalBalance).toLocaleString("en-GB", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                        </p>
                      </div>
                    </div>
                    <p className="text-[10px] text-slate-400 dark:text-slate-500 mt-1 px-1">
                      Based on your typical spending — last 90 days
                    </p>
                    </>
                  )}

                  {/* Day groups */}
                  {groups.map(({ label, items: groupItems }) => (
                    <div key={label}>
                      <p className={`text-xs font-semibold uppercase tracking-wide mb-2 ${
                        label === "Today" || label === "Tomorrow"
                          ? "text-amber-700 dark:text-amber-400"
                          : "text-slate-500 dark:text-slate-400"
                      }`}>{label}</p>
                      <div className="space-y-2">
                        {groupItems.map((item) => {
                          const flagged = item.at_risk || item.account_short;
                          const rowKey = `${item.type}-${item.name}-${item.expected_date}`;
                          const highlighted = highlightBill === rowKey;
                          return (
                            <SwipeDismissRow
                              key={rowKey}
                              onDismiss={() => dismissUpcoming(item.name)}
                            >
                            <div
                              data-bill-key={rowKey}
                              className={`rounded-2xl shadow-sm px-4 py-3 flex items-center gap-3 transition-shadow ${
                                flagged
                                  ? "bg-rose-50 dark:bg-rose-900/20 border border-rose-200 dark:border-rose-800"
                                  : "bg-white dark:bg-slate-800"
                              }${highlighted ? " ring-2 ring-rose-400 dark:ring-rose-500" : ""}`}
                            >
                              {/* Left indicator — category icon chip, same as the category grid */}
                              {flagged ? (
                                <span className="w-8 h-8 rounded-lg bg-rose-100 dark:bg-rose-900/40 flex items-center justify-center flex-shrink-0 text-rose-500 text-sm">⚠</span>
                              ) : (() => {
                                const catName = item.type === "income" ? (item.category || "Income") : (item.category || "Other");
                                const colour = colours[catName] ?? CATEGORY_COLOURS[catName as keyof typeof CATEGORY_COLOURS] ?? CATEGORY_COLOURS.Other;
                                const Icon = getCategoryIcon(catName, iconOverrides);
                                return (
                                  <span
                                    className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
                                    style={{ backgroundColor: `${colour}26` }}
                                  >
                                    <Icon size={15} style={{ color: colour }} />
                                  </span>
                                );
                              })()}

                              {/* Name + contextual info */}
                              <div className="flex-1 min-w-0">
                                <p className={`text-sm font-medium truncate ${flagged ? "text-rose-700 dark:text-rose-300" : "text-slate-800 dark:text-slate-100"}`}>
                                  {item.name}
                                </p>

                                {/* Only show account details when there's a problem */}
                                {item.account_short && (item.account_bank || item.account_name) && (
                                  <p className="text-[11px] font-semibold text-rose-500 dark:text-rose-400 truncate">
                                    {item.account_bank || item.account_name} · only {sym}{(item.account_balance ?? 0).toLocaleString("en-GB", { maximumFractionDigits: 0 })} available
                                  </p>
                                )}
                                {item.at_risk && !item.account_short && (
                                  <p className="text-[11px] font-semibold text-rose-500 dark:text-rose-400">
                                    Overall balance will be low
                                  </p>
                                )}

                                {/* Subtle credit card label — no affordability flag */}
                                {item.is_credit_card && (item.account_bank || item.account_name) && !flagged && (
                                  <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                                    {item.account_bank || item.account_name}
                                  </p>
                                )}

                                <p className="text-[11px] text-slate-500 dark:text-slate-400">{item.expected_date}</p>
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
                                <p className={`text-[11px] font-medium ${item.balance_after >= 0 ? "text-slate-500 dark:text-slate-400" : "text-rose-400"}`}>
                                  {item.balance_after >= 0 ? "" : "−"}{sym}{Math.abs(item.balance_after).toLocaleString("en-GB", { maximumFractionDigits: 0 })} left
                                </p>
                              </div>

                              {/* Dismiss a wrong prediction. × is the universally
                                  recognised "remove from list" glyph and matches the
                                  swipe backdrop; the "Not recurring" label + undo toast
                                  carry the nuance that this stops future predictions. */}
                              <button
                                onClick={() => dismissUpcoming(item.name)}
                                title="Not recurring — stop predicting this"
                                aria-label="Dismiss prediction"
                                className={`flex-shrink-0 w-11 h-11 flex items-center justify-center rounded-full transition-colors hover:text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-900/20 ${flagged ? "text-rose-500 dark:text-rose-400" : "text-slate-400 dark:text-slate-500"}`}
                              >
                                <X size={15} />
                              </button>
                            </div>
                            </SwipeDismissRow>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              );
            })()}
          </>
        );

        return isDesktop ? (
          <>
            <div className="px-4 pt-4 grid grid-cols-2 gap-4 items-start">
              <div className="space-y-3" data-tutorial-id="tutorial-spend-categories">
                {sectionTitle("Categories", "#6366f1")}
                {categoriesBlock}
                {!pageLoading && untrackedCategories.length > 0 && untrackedBlock}
                {isCurrentPeriod && (
                  <>
                    {sectionTitle("Transactions", "#10b981")}
                    {listBlock}
                  </>
                )}
              </div>
              <div className="space-y-3">
                {isCurrentPeriod ? (
                  <>
                    {sectionTitle("Upcoming", "#f59e0b")}
                    {upcomingBlock}
                  </>
                ) : (
                  <>
                    {sectionTitle("Transactions", "#10b981")}
                    {listBlock}
                  </>
                )}
              </div>
            </div>
            <div className="pt-6">
              <div className="px-4">{sectionTitle("Trends", "#8b5cf6")}</div>
              {trendsBlock}
            </div>
          </>
        ) : (
          <>
            {view === "categories" && (
              <div className="px-4 pt-4" data-tutorial-id="tutorial-spend-categories">{categoriesBlock}</div>
            )}
            {view === "categories" && !pageLoading && untrackedCategories.length > 0 && (
              <div className="px-4 pt-2 pb-2">{untrackedBlock}</div>
            )}
            {view === "list" && <div className="px-4 pt-4">{listBlock}</div>}
            {view === "trends" && trendsBlock}
            {view === "upcoming" && <div className="px-4 pt-4 pb-2">{upcomingBlock}</div>}
          </>
        );
      })()}

      {/* Category sheet */}
      {openCategory && (
        <CategorySheet
          name={openCategory.name}
          total={openCategory.total}
          count={openCategory.count}
          transactions={openCategory.transactions}
          onClose={() => setOpenCategory(null)}
          onTransactionClick={(tx) => { setOpenCategory(null); setSelectedTx(tx); }}
          isPro={isPro}
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

      {/* Transient confirmation toast — "Showing payments over £250" */}
      {largeToast && (
        <div
          className="wd-toast fixed left-4 right-4 z-[70] pointer-events-none bg-slate-900/95 dark:bg-slate-100/95 backdrop-blur rounded-xl shadow-lg px-4 min-h-[48px] flex items-center"
          style={{ bottom: "calc(96px + env(safe-area-inset-bottom, 0px))" }}
        >
          <p className="text-sm font-medium text-white dark:text-slate-900">Showing payments over £250</p>
        </div>
      )}

      {/* Undo snackbar for dismissed predictions — countdown bar shows the undo window */}
      {undoDismiss && (
        <div
          key={undoNonce}
          className="fixed left-4 right-4 z-[70] pointer-events-none"
          style={{ bottom: "calc(96px + env(safe-area-inset-bottom, 0px))" }}
        >
          {/* Material snackbar spec: viewport width minus margins, min 48dp
              height, 44dp+ action target — a timed undo must be easy to hit */}
          <div className="pointer-events-auto bg-slate-900/95 dark:bg-slate-100/95 backdrop-blur rounded-xl shadow-lg overflow-hidden">
            <div className="flex items-center justify-between gap-3 pl-4 pr-2 min-h-[48px]">
              <p className="text-sm font-medium text-white dark:text-slate-900">Prediction removed</p>
              <button
                onClick={undoLastDismiss}
                className="text-sm font-bold text-indigo-300 dark:text-indigo-600 rounded-lg px-4 min-h-[44px] active:bg-white/10 dark:active:bg-slate-900/10"
              >
                Undo
              </button>
            </div>
            <div className="h-[3px] bg-indigo-400/90" style={{ animation: "wdCountdown 6s linear forwards" }} />
          </div>
        </div>
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
  useLockBodyScroll();
  const panelRef = useSheetA11y<HTMLDivElement>(onClose);
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
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="Pay period settings"
        className="fixed bottom-0 left-1/2 -translate-x-1/2 w-full max-w-[430px] bg-white dark:bg-slate-800 rounded-t-3xl z-[70] overflow-y-auto max-h-[88vh]"
      >
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
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{m.desc}</p>
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
            className="w-full py-4 rounded-2xl font-semibold text-white text-base bg-indigo-600 hover:bg-indigo-700 transition-colors active:scale-[0.98]"
          >
            Save Pay Period
          </button>
        </div>
      </div>
    </>
  );
}


// ── Swipe-to-dismiss shell for upcoming-payment rows ──────────────────────────
// Gmail-style: the row follows the finger leftwards over a red "Not recurring"
// backdrop; past 40% width (or a quick flick) it slides out and dismisses.
// Axis-locks so diagonal scrolling never grabs the row.
function SwipeDismissRow({ onDismiss, children }: { onDismiss: () => void; children: React.ReactNode }) {
  const [dx, setDx] = useState(0);
  const [dragging, setDragging] = useState(false);
  const start = useRef<{ x: number; y: number; t: number } | null>(null);
  const axis = useRef<"none" | "h" | "v">("none");
  const shellRef = useRef<HTMLDivElement>(null);

  function onTouchStart(e: React.TouchEvent) {
    start.current = { x: e.touches[0].clientX, y: e.touches[0].clientY, t: Date.now() };
    axis.current = "none";
  }

  function onTouchMove(e: React.TouchEvent) {
    if (!start.current) return;
    const mx = e.touches[0].clientX - start.current.x;
    const my = e.touches[0].clientY - start.current.y;
    if (axis.current === "none") {
      if (Math.abs(mx) < 8 && Math.abs(my) < 8) return;
      axis.current = Math.abs(mx) > Math.abs(my) * 1.5 ? "h" : "v";
      if (axis.current === "h") setDragging(true);
    }
    if (axis.current !== "h") return;
    setDx(Math.min(0, mx)); // left only — right is a no-op
  }

  function onTouchEnd() {
    if (!start.current) { setDragging(false); return; }
    const width = shellRef.current?.offsetWidth ?? 320;
    const elapsed = Date.now() - start.current.t;
    const flick = elapsed < 250 && dx < -60;
    start.current = null;
    setDragging(false);
    if (dx < -width * 0.4 || flick) {
      setDx(-width - 24);
      setTimeout(onDismiss, 180);
    } else {
      setDx(0);
    }
    axis.current = "none";
  }

  return (
    <div ref={shellRef} className="relative overflow-hidden rounded-2xl">
      {/* Backdrop revealed by the swipe */}
      <div
        className="absolute inset-0 rounded-2xl bg-rose-500 flex items-center justify-end gap-1.5 pr-4"
        style={{ opacity: Math.min(1, Math.abs(dx) / 80) }}
      >
        <X size={14} className="text-white" />
        <span className="text-xs font-semibold text-white">Not recurring</span>
      </div>
      <div
        style={{
          transform: `translateX(${dx}px)`,
          transition: dragging ? "none" : "transform 180ms ease-out",
        }}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
      >
        {children}
      </div>
    </div>
  );
}
