"use client";

import { useEffect, useLayoutEffect, useState, useCallback, useMemo, useRef } from "react";
import { useSearchParams } from "next/navigation";
import { ChevronDown, ChevronUp, ChevronLeft, ChevronRight, Settings2, X, SlidersHorizontal, AlertTriangle, ReceiptText, Fuel, CreditCard } from "lucide-react";
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
import UpcomingEditSheet from "@/components/UpcomingEditSheet";
import PlanOneOffSheet from "@/components/PlanOneOffSheet";
import PlannedEditSheet from "@/components/PlannedEditSheet";

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

  // Bills due strictly before the user's next payday — running-balance simulation per account.
  // Mirrors the at-risk logic in backend/app/routers/analytics.py.
  const atRiskBills = useMemo(() => {
    if (!cashflow) return [];

    // nextPayday = first day of next pay period = periodEnd + 1 day (UTC midnight)
    const nextPaydayMs = periodEnd.getTime() + 86400000; // midnight UTC of payday
    const scopedBills = cashflow.upcoming_bills.filter(
      (b) => new Date(b.expected_date).getTime() < nextPaydayMs &&
             b.account_balance != null && b.account_balance >= 0
    );
    if (scopedBills.length === 0) return [];

    // Seed running balance per account_id.
    // Bills with no account_id share a single "null" pot.
    const running: Record<string, number> = {};
    for (const b of scopedBills) {
      const key = b.account_id ?? "__null__";
      if (!(key in running)) {
        running[key] = b.account_balance!;
      }
    }

    // Build events: scoped bills + upcoming income (within 7 days).
    type Event =
      | { kind: "income"; days_away: number; amount: number; account_id: string | null | undefined }
      | { kind: "bill"; days_away: number; amount: number; account_id: string | null | undefined; bill: typeof scopedBills[0] };

    const events: Event[] = [
      ...scopedBills.map((b) => ({
        kind: "bill" as const,
        days_away: b.days_away,
        amount: b.amount,
        account_id: b.account_id,
        bill: b,
      })),
      ...cashflow.upcoming_income
        .filter((inc) => new Date(inc.expected_date).getTime() < nextPaydayMs)
        .map((inc) => ({
          kind: "income" as const,
          days_away: inc.days_away,
          amount: inc.amount,
          account_id: inc.account_id as string | null | undefined,
        })),
    ];

    // Sort: ascending days_away; income before bills on same day.
    events.sort((a, b) => {
      if (a.days_away !== b.days_away) return a.days_away - b.days_away;
      return a.kind === "income" ? -1 : 1;
    });

    const atRisk: typeof scopedBills = [];

    for (const ev of events) {
      if (ev.kind === "income") {
        if (ev.account_id) {
          // Apply to that specific account if it's in our running map
          const key = ev.account_id;
          if (key in running) running[key] += ev.amount;
        } else {
          // Broadcast to every seeded account (mirrors backend)
          for (const key of Object.keys(running)) {
            running[key] += ev.amount;
          }
        }
      } else {
        const key = ev.account_id ?? "__null__";
        if (!(key in running)) continue; // skip null-balance bills (already filtered)
        if (running[key] >= ev.amount) {
          running[key] -= ev.amount;
        } else {
          // Bounces — at risk; running unchanged
          atRisk.push(ev.bill);
        }
      }
    }

    return atRisk;
  }, [cashflow, periodEnd]);

  const accountShortfalls = useMemo(() => {
    if (!cashflow || atRiskBills.length === 0) return [];

    // Get distinct account IDs from at-risk bills
    const accountIds = [...new Set(atRiskBills.map(b => b.account_id ?? "__null__"))];

    return accountIds
      .map(accountId => {
        // Get balance from first at-risk bill for this account
        const firstBill = atRiskBills.find(b => (b.account_id ?? "__null__") === accountId);
        if (!firstBill) return null;
        const balance = firstBill.account_balance ?? 0;
        const bank = firstBill.account_bank || firstBill.account_name || "Account";

        // Sum bills strictly before payday for this account (same scope as atRiskBills)
        const nextPaydayMs = periodEnd.getTime() + 86400000;
        const scopedBills = cashflow.upcoming_bills.filter(
          b => (b.account_id ?? "__null__") === accountId &&
               new Date(b.expected_date).getTime() < nextPaydayMs &&
               b.account_balance != null &&
               b.account_balance >= 0
        );
        const billsSum = scopedBills.reduce((s, b) => s + b.amount, 0);
        const shortfall = billsSum - balance;
        if (shortfall <= 0) return null;

        return { accountId, bank, balance, shortfall };
      })
      .filter((x): x is { accountId: string; bank: string; balance: number; shortfall: number } => x !== null)
      .sort((a, b) => b.shortfall - a.shortfall);
  }, [cashflow, atRiskBills, periodEnd]);

  // Stop at the period containing the oldest transaction — no empty pre-history
  const canGoPrev = !oldestTxDate || periodStart.getTime() > oldestTxDate.getTime();

  const [undoBar, setUndoBar] = useState<{ kind: "recurring"; name: string } | { kind: "planned"; id: string } | null>(null);
  const [undoNonce, setUndoNonce] = useState(0);
  const undoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [largeToast, setLargeToast] = useState(false);
  const largeToastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const listSectionRef = useRef<HTMLDivElement>(null);
  const [highlightBill, setHighlightBill] = useState<string | null>(null);
  const [largeOnly, setLargeOnly] = useState(false);
  const [planSheetOpen, setPlanSheetOpen] = useState(false);
  const [editItem, setEditItem] = useState<null | {
    name: string;
    amount: number;
    expected_date: string;
    type: "bill" | "income";
    category?: string | null;
    edited?: boolean;
    rule_label?: string | null;
  }>(null);
  const [editPlanned, setEditPlanned] = useState<null | { id: string; name: string; amount: number; date: string; account_id: string | null }>(null);
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

  const lastPlannedDeleteRef = useRef<{
    id: string;
    bills: CashflowData["upcoming_bills"];
    timer: ReturnType<typeof setTimeout>;
  } | null>(null);

  function flushPlannedDelete() {
    const p = lastPlannedDeleteRef.current;
    if (!p) return;
    clearTimeout(p.timer);
    lastPlannedDeleteRef.current = null;
    api.deletePlanned(p.id).catch(() => {});
  }

  function deletePlannedWithUndo(id: string) {
    flushPlannedDelete();
    // Hide any recurring snackbar
    if (undoTimer.current) clearTimeout(undoTimer.current);
    let stashedBills: CashflowData["upcoming_bills"] = [];
    setCashflow(prev => {
      if (!prev) return prev;
      stashedBills = prev.upcoming_bills.filter(b => b.planned_id === id);
      return {
        ...prev,
        upcoming_bills: prev.upcoming_bills.filter(b => b.planned_id !== id),
      };
    });
    const timer = setTimeout(() => {
      api.deletePlanned(id).catch(() => {});
      lastPlannedDeleteRef.current = null;
      setUndoBar(null);
      api.cashflow().then(setCashflow).catch(() => {});
    }, 6000);
    lastPlannedDeleteRef.current = { id, bills: stashedBills, timer };
    setUndoBar({ kind: "planned", id });
    setUndoNonce(n => n + 1);
  }

  function undoPlannedDelete() {
    const p = lastPlannedDeleteRef.current;
    if (!p) return;
    clearTimeout(p.timer);
    lastPlannedDeleteRef.current = null;
    setUndoBar(null);
    setCashflow(prev => prev ? {
      ...prev,
      upcoming_bills: [...prev.upcoming_bills, ...p.bills].sort((a, b) => a.days_away - b.days_away),
    } : prev);
  }

  useEffect(() => {
    return () => { flushPlannedDelete(); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function dismissUpcoming(name: string) {
    flushPlannedDelete();
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
    setUndoBar({ kind: "recurring", name });
    setUndoNonce(n => n + 1);
    if (undoTimer.current) clearTimeout(undoTimer.current);
    undoTimer.current = setTimeout(() => setUndoBar(null), 6000);
  }

  async function undoLastDismiss() {
    const last = lastDismissRef.current;
    if (!last) return;
    setUndoBar(null);
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
    <div className="min-h-dvh pb-20 lg:pb-8 lg:max-w-6xl lg:mx-auto" style={{ paddingTop: "env(safe-area-inset-top, 0px)" }}>
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
        <div className="glass-card rounded-2xl p-3" {...periodSwipe} style={{ touchAction: "pan-y" }}>
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

        {/* Summary — three equal pills: Spent | Income | Net */}
        {!pageLoading && (
          <div className="mt-3 lg:mt-0 space-y-2">
            <div className="grid grid-cols-3 gap-2">
              {/* Spent */}
              <div className="glass-card rounded-xl px-3 py-2.5 flex flex-col items-center">
                <span className="text-[11px] text-slate-500 dark:text-slate-400 mb-0.5">Spent</span>
                <span className="text-sm font-bold text-slate-900 dark:text-slate-100">{fmtSummary(summary.spent)}</span>
              </div>
              {/* Income — tappable to expand drill-down */}
              <button
                onClick={() => setIncomeExpanded(v => !v)}
                className="glass-card rounded-xl px-3 py-2.5 flex flex-col items-center active:opacity-70 transition-opacity"
              >
                <span className="text-[11px] text-slate-500 dark:text-slate-400 mb-0.5 flex items-center gap-0.5">
                  Income {incomeExpanded ? <ChevronUp size={10} /> : <ChevronDown size={10} />}
                </span>
                <span className="text-sm font-bold text-slate-900 dark:text-slate-100">{fmtSummary(summary.income)}</span>
              </button>
              {/* Net */}
              <div className="glass-card rounded-xl px-3 py-2.5 flex flex-col items-center">
                <span className="text-[11px] text-slate-500 dark:text-slate-400 mb-0.5">Net</span>
                <span
                  className={`text-sm font-bold ${
                    summary.net >= 0
                      ? "text-emerald-700 dark:text-emerald-400"
                      : "text-slate-900 dark:text-slate-100"
                  }`}
                >
                  {summary.net >= 0 ? "+" : "−"}
                  {fmtSummary(Math.abs(summary.net))}
                </span>
              </div>
            </div>
            {/* Income drill-down — shown below the pills when expanded */}
            {incomeExpanded && incomeTxns.length > 0 && (
              <div className="glass-card rounded-xl overflow-hidden">
                <div className="px-4 pt-2.5 pb-1">
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
          </div>
        )}
        </div>{/* end lg:grid wrapper */}

        {/* Account shortfall callout — visible on all views when at-risk bills exist */}
        {isCurrentPeriod && accountShortfalls.length > 0 && (
          <div className="mt-3 w-full bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900/60 rounded-2xl px-4 py-3">
            <div className="flex items-start gap-2.5">
              <AlertTriangle size={16} className="text-rose-600 dark:text-rose-400 flex-shrink-0 mt-0.5" />
              <div className="flex-1 min-w-0">
                {(() => {
                  const sym = region === "Kenya" ? "KES " : "£";
                  const fmt = (n: number) => sym + n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
                  if (accountShortfalls.length === 1) {
                    const acct = accountShortfalls[0];
                    return (
                      <>
                        <p className="text-sm font-semibold text-rose-900 dark:text-rose-100">
                          Your {acct.bank} account is short before payday
                        </p>
                        <p className="text-xs text-rose-700 dark:text-rose-300 mt-0.5">
                          {fmt(acct.shortfall)} short for bills due before payday — move money in, or change a payment date.
                        </p>
                      </>
                    );
                  }
                  const shown = accountShortfalls.slice(0, 3);
                  const extra = accountShortfalls.length - 3;
                  return (
                    <>
                      <p className="text-sm font-semibold text-rose-900 dark:text-rose-100">
                        {accountShortfalls.length} accounts are short before payday
                      </p>
                      <p className="text-xs text-rose-700 dark:text-rose-300 mt-0.5">
                        {shown.map((a, i) => (
                          <span key={a.accountId}>
                            {i > 0 && " · "}{a.bank} · {fmt(a.shortfall)} short
                          </span>
                        ))}
                        {extra > 0 && <span> · +{extra} more</span>}
                      </p>
                      <p className="text-xs text-rose-700 dark:text-rose-300 mt-0.5">
                        Move money in, or change a payment date.
                      </p>
                    </>
                  );
                })()}
              </div>
              <button
                onClick={() => {
                  const top = [...atRiskBills].sort(
                    (a, b) => a.days_away !== b.days_away ? a.days_away - b.days_away : b.amount - a.amount
                  )[0];
                  if (top) setHighlightBill(`bill-${top.name}-${top.expected_date}`);
                  setView("upcoming");
                }}
                className="flex-shrink-0 self-center px-3 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-700 text-white text-xs font-semibold min-h-[44px] flex items-center active:scale-95 transition-transform"
              >
                Review
              </button>
            </div>
          </div>
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
              <div className="glass-card rounded-2xl p-8 text-center">
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
                      className="glass-card rounded-2xl p-4 text-left active:scale-95 transition-transform flex flex-col gap-2 overflow-hidden"
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
                      <p className="text-lg font-bold text-slate-900 dark:text-slate-100">
                        £{cat.total.toLocaleString("en-GB", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                      </p>
                      {/* spend bar */}
                      <div className="h-1.5 w-full rounded-full bg-slate-200 dark:bg-slate-700 overflow-hidden">
                        <div className="h-full rounded-full" style={{ width: `${Math.min(cat.pct, 100)}%`, backgroundColor: colour }} />
                      </div>
                      {(cat.name.toLowerCase() === "transport" || cat.name.toLowerCase() === "groceries" || cat.name === "Debt") && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-700/60 text-slate-500 dark:text-slate-300 text-[11px]">
                          {cat.name.toLowerCase() === "transport" ? (
                            <><Fuel size={10} style={{ color: colour }} /><span>cheaper fuel inside</span></>
                          ) : cat.name.toLowerCase() === "groceries" ? (
                            <><ReceiptText size={10} style={{ color: colour }} /><span>scan receipts inside</span></>
                          ) : (
                            <><CreditCard size={10} style={{ color: colour }} /><span>payoff plan</span></>
                          )}
                          <ChevronRight size={10} className="text-slate-400 dark:text-slate-500" />
                        </span>
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
              className="w-full flex items-center justify-between px-4 py-3 glass-card rounded-2xl"
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
                  ? <ChevronUp size={16} className="text-slate-500 dark:text-slate-400" />
                  : <ChevronDown size={16} className="text-slate-500 dark:text-slate-400" />}
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
                      className="glass-card rounded-2xl p-4 text-left active:scale-95 transition-transform flex flex-col gap-2 overflow-hidden"
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
              <div className="glass-card rounded-2xl p-8 text-center">
                <p className="text-slate-500 dark:text-slate-400 text-sm">
                  {largeOnly ? "No payments over £250 in this period" : "No transactions in this period"}
                </p>
              </div>
            ) : (
              <div className="glass-card rounded-2xl overflow-hidden divide-y divide-slate-50 dark:divide-slate-700 lg:max-h-[640px] lg:overflow-y-auto">
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
              const today = new Date();
              // Compute next payday: periodEnd + 1 day
              const nextPayday = new Date(periodEnd.getTime() + 86400000);
              const isCalendarMonth = payPeriodConfig.type === "calendar_month";
              // daysToPayday from today
              const todayMidnight = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
              const nextPaydayMidnight = new Date(Date.UTC(nextPayday.getUTCFullYear(), nextPayday.getUTCMonth(), nextPayday.getUTCDate()));
              const daysToPayday = Math.round((nextPaydayMidnight.getTime() - todayMidnight.getTime()) / 86400000);
              const paydayLabel = nextPayday.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });

              // Sort chronologically: income before bills on same day.
              // Clip to the first day of the next pay period (payday inclusive).
              const rawItems = [
                ...cashflow.upcoming_income.map(b => ({ ...b, type: "income" as const })),
                ...cashflow.upcoming_bills.map(b => ({ ...b, type: "bill" as const })),
              ].filter(b => new Date(b.expected_date).getTime() <= nextPaydayMidnight.getTime())
               .sort((a, b) => {
                if (a.days_away !== b.days_away) return a.days_away - b.days_away;
                if (a.type !== b.type) return a.type === "income" ? -1 : 1;
                return b.amount - a.amount;
              });

              if (rawItems.length === 0) {
                return (
                  <div className="space-y-3">
                    <div className="glass-card rounded-2xl p-8 text-center">
                      <p className="text-slate-500 dark:text-slate-400 text-sm">Nothing more expected this pay period</p>
                    </div>
                    <button
                      onClick={() => setPlanSheetOpen(true)}
                      className="w-full min-h-[44px] rounded-xl text-sm font-semibold text-indigo-600 dark:text-indigo-400 bg-transparent hover:bg-indigo-50 dark:hover:bg-indigo-900/20 transition-colors focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2"
                    >
                      + Plan a one-off
                    </button>
                  </div>
                );
              }

              // Running balance projection
              let running = cashflow.available_balance ?? 0;
              const items = rawItems.map(item => {
                if (item.type === "income") {
                  running += item.amount;
                  return { ...item, balance_after: running, at_risk: false, account_short: false, is_credit_card: false };
                } else {
                  running -= item.amount;
                  const acctBalance = item.account_balance ?? null;
                  const is_credit_card = acctBalance !== null && acctBalance < 0;
                  const account_short = !is_credit_card && acctBalance !== null && item.amount > acctBalance;
                  return { ...item, balance_after: running, at_risk: running < 0, account_short, is_credit_card };
                }
              });

              // Compute runway = available_balance - sum of bills before nextPayday
              const billsBeforePayday = rawItems.filter(item => {
                if (item.type !== "bill") return false;
                const d = new Date(item.expected_date);
                return d < nextPaydayMidnight;
              });
              const runwayBillsTotal = billsBeforePayday.reduce((s, b) => s + b.amount, 0);
              const runway = (cashflow.available_balance ?? 0) - runwayBillsTotal;
              const runwayNegative = runway < 0;

              const atRiskCount = items.filter(i => i.type === "bill" && i.at_risk).length;

              // Group by day label helper
              function groupByDay(list: typeof items) {
                const groups: { label: string; items: typeof items }[] = [];
                for (const item of list) {
                  const label = item.days_away === 0 ? "Today" : item.days_away === 1 ? "Tomorrow" : `${item.days_away} days`;
                  const g = groups.find(g => g.label === label);
                  if (g) g.items.push(item);
                  else groups.push({ label, items: [item] });
                }
                return groups;
              }

              const groups = groupByDay(items);

              // Format date helper
              function formatItemDate(iso: string) {
                const d = new Date(iso);
                return d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
              }

              // Row renderer
              function renderRow(item: typeof items[0]) {
                const isPlanned = item.type === "bill" && item.planned;
                const flagged = !isPlanned && item.type === "bill"
                  ? atRiskBills.some(r => r.name === item.name && r.expected_date === item.expected_date)
                  : false;
                const rowKey = `${item.type}-${item.name}-${item.expected_date}`;
                const highlighted = highlightBill === rowKey;
                const catName = item.type === "income" ? (item.category || "Income") : (item.category || "Other");
                const colour = colours[catName] ?? CATEGORY_COLOURS[catName as keyof typeof CATEGORY_COLOURS] ?? CATEGORY_COLOURS.Other;
                const Icon = getCategoryIcon(catName, iconOverrides);

                return (
                  <SwipeDismissRow
                    key={rowKey}
                    onDismiss={() => isPlanned ? deletePlannedWithUndo(item.planned_id!) : dismissUpcoming(item.name)}
                    label={isPlanned ? "Delete" : "Not recurring"}
                  >
                    <div
                      data-bill-key={rowKey}
                      onClick={() => {
                        if (isPlanned) {
                          setEditPlanned({ id: item.planned_id!, name: item.name, amount: item.amount, date: item.expected_date, account_id: item.account_id ?? null });
                        } else {
                          setEditItem({ name: item.name, amount: item.amount, expected_date: item.expected_date, type: item.type, category: item.category, edited: item.edited, rule_label: item.rule_label });
                        }
                      }}
                      role="button"
                      tabIndex={0}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          if (isPlanned) {
                            setEditPlanned({ id: item.planned_id!, name: item.name, amount: item.amount, date: item.expected_date, account_id: item.account_id ?? null });
                          } else {
                            setEditItem({ name: item.name, amount: item.amount, expected_date: item.expected_date, type: item.type, category: item.category, edited: item.edited, rule_label: item.rule_label });
                          }
                        }
                      }}
                      aria-label={isPlanned ? `Edit planned payment: ${item.name}` : `Edit ${item.name}`}
                      className={`rounded-2xl px-4 py-3 flex items-center gap-3 cursor-pointer active:scale-[0.98] transition-transform ${
                        flagged
                          ? "bg-rose-50 dark:bg-rose-900/20 border border-rose-200 dark:border-rose-800"
                          : "glass-card"
                      }${highlighted ? " ring-2 ring-rose-400 dark:ring-rose-500" : ""}`}
                    >
                      {/* Icon chip */}
                      {flagged ? (
                        <span className="w-8 h-8 rounded-lg bg-rose-100 dark:bg-rose-900/40 flex items-center justify-center flex-shrink-0 text-rose-500 text-sm" aria-hidden="true">⚠</span>
                      ) : (
                        <span
                          className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
                          style={{ backgroundColor: `${colour}26` }}
                          aria-hidden="true"
                        >
                          <Icon size={15} style={{ color: colour }} />
                        </span>
                      )}

                      {/* Name + details */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5 min-w-0">
                          <p className={`text-sm font-medium truncate ${flagged ? "text-rose-700 dark:text-rose-300" : "text-slate-800 dark:text-slate-100"}`}>
                            {item.name}
                          </p>
                          {isPlanned ? (
                            <span className="flex-shrink-0 text-[10px] font-semibold text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-900/30 px-1.5 py-0.5 rounded-md">planned</span>
                          ) : item.edited && (
                            <span className="flex-shrink-0 text-[10px] font-semibold text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-900/30 px-1.5 py-0.5 rounded-md">edited</span>
                          )}
                        </div>

                        {item.account_short && (item.account_bank || item.account_name) && (
                          <p className="text-[11px] font-semibold text-rose-500 dark:text-rose-400 truncate">
                            {item.account_bank || item.account_name} · only {sym}{(item.account_balance ?? 0).toLocaleString("en-GB", { maximumFractionDigits: 0 })} available
                          </p>
                        )}
                        {item.at_risk && !item.account_short && (
                          <p className="text-[11px] font-semibold text-rose-500 dark:text-rose-400">Overall balance will be low</p>
                        )}
                        {item.is_credit_card && (item.account_bank || item.account_name) && !flagged && (
                          <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                            {item.account_bank || item.account_name}
                          </p>
                        )}

                        <p className="text-[11px] text-slate-500 dark:text-slate-400">{formatItemDate(item.expected_date)}</p>
                        {item.type === "bill" && item.pending && (
                          <p className="text-[11px] text-slate-400 dark:text-slate-500">
                            expected {new Date(item.original_date ?? item.expected_date).toLocaleDateString("en-GB", { weekday: "short" })} — hasn&apos;t left yet
                          </p>
                        )}
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
                    </div>
                  </SwipeDismissRow>
                );
              }

              // Day-group section renderer
              function renderGroups(groups: ReturnType<typeof groupByDay>) {
                return groups.map(({ label, items: groupItems }) => (
                  <div key={label}>
                    <p className={`text-xs font-semibold uppercase tracking-wide mb-2 ${
                      label === "Today" || label === "Tomorrow"
                        ? "text-amber-700 dark:text-amber-400"
                        : "text-slate-500 dark:text-slate-400"
                    }`}>{label}</p>
                    <div className="space-y-2">
                      {groupItems.map(renderRow)}
                    </div>
                  </div>
                ));
              }

              return (
                <div className="space-y-4">
                  {/* ── Runway summary card ─────────────────────────────────── */}
                  {cashflow.available_balance != null && (
                    <div className={`rounded-2xl px-4 py-4 ${
                      runwayNegative
                        ? "bg-rose-50 dark:bg-rose-900/20 border border-rose-200 dark:border-rose-800"
                        : "glass-card"
                    }`}>
                      {/* Hero verdict */}
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 mb-0.5">
                            {isCalendarMonth ? "Before month end" : "To last until payday"}
                          </p>
                          <p className={`text-2xl font-bold tracking-tight ${
                            runwayNegative
                              ? "text-rose-600 dark:text-rose-400"
                              : "text-slate-900 dark:text-slate-100"
                          }`}>
                            {runwayNegative ? "−" : ""}{sym}{Math.abs(runway).toLocaleString("en-GB", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                          </p>
                          {/* Evidence line: shows the maths behind the runway figure */}
                          <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 leading-snug">
                            {sym}{(cashflow.available_balance ?? 0).toLocaleString("en-GB", { minimumFractionDigits: 0, maximumFractionDigits: 0 })} now
                            {" − "}
                            {sym}{runwayBillsTotal.toLocaleString("en-GB", { minimumFractionDigits: 0, maximumFractionDigits: 0 })} bills
                            {isCalendarMonth
                              ? ` · ${daysToPayday} ${daysToPayday === 1 ? "day" : "days"} remaining`
                              : ` · ${paydayLabel} (${daysToPayday} ${daysToPayday === 1 ? "day" : "days"})`}
                          </p>
                        </div>
                        {accountShortfalls.length > 0 && (
                          <span className="flex-shrink-0 flex items-center gap-1 px-2 py-1 rounded-lg bg-rose-100 dark:bg-rose-900/40 text-rose-600 dark:text-rose-400 text-[11px] font-semibold">
                            <span>⚠</span> {accountShortfalls.length} {accountShortfalls.length === 1 ? "account" : "accounts"} short
                          </span>
                        )}
                      </div>
                    </div>
                  )}

                  <p className="text-[10px] text-slate-400 dark:text-slate-500 px-1">
                    Based on your typical spending — last 90 days
                  </p>

                  <button
                    onClick={() => setPlanSheetOpen(true)}
                    className="w-full min-h-[44px] rounded-xl text-sm font-semibold text-indigo-600 dark:text-indigo-400 bg-transparent hover:bg-indigo-50 dark:hover:bg-indigo-900/20 transition-colors focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2"
                  >
                    + Plan a one-off
                  </button>

                  {/* ── Upcoming items ───────────────────────────────────────── */}
                  {groups.length > 0 && (
                    <div className="space-y-3">
                      {renderGroups(groups)}
                    </div>
                  )}
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

      {/* Undo snackbar — serves both recurring-dismiss and planned-delete */}
      {undoBar && (
        <div
          key={undoNonce}
          className="fixed left-4 right-4 z-[70] pointer-events-none"
          style={{ bottom: "calc(96px + env(safe-area-inset-bottom, 0px))" }}
        >
          {/* Material snackbar spec: viewport width minus margins, min 48dp
              height, 44dp+ action target — a timed undo must be easy to hit */}
          <div className="pointer-events-auto bg-slate-900/95 dark:bg-slate-100/95 backdrop-blur rounded-xl shadow-lg overflow-hidden">
            <div className="flex items-center justify-between gap-3 pl-4 pr-2 min-h-[48px]">
              <p className="text-sm font-medium text-white dark:text-slate-900">
                {undoBar.kind === "planned" ? "Planned payment deleted" : "Prediction removed"}
              </p>
              <button
                onClick={undoBar.kind === "planned" ? undoPlannedDelete : undoLastDismiss}
                className="text-sm font-bold text-indigo-300 dark:text-indigo-600 rounded-lg px-4 min-h-[44px] active:bg-white/10 dark:active:bg-slate-900/10"
              >
                Undo
              </button>
            </div>
            <div className="h-[3px] bg-indigo-400/90" style={{ animation: "wdCountdown 6s linear forwards" }} />
          </div>
        </div>
      )}

      {/* UpcomingEditSheet */}
      {editItem && (
        <UpcomingEditSheet
          item={editItem}
          onClose={() => setEditItem(null)}
          onDismiss={() => dismissUpcoming(editItem.name)}
          onSaved={async () => {
            try {
              const fresh = await api.cashflow();
              setCashflow(fresh);
            } catch {}
          }}
        />
      )}

      {/* PlannedEditSheet */}
      {editPlanned && (
        <PlannedEditSheet
          item={editPlanned}
          accounts={accounts}
          onClose={() => setEditPlanned(null)}
          onDelete={() => deletePlannedWithUndo(editPlanned.id)}
          onSaved={() => { api.cashflow().then(setCashflow).catch(() => {}); }}
        />
      )}

      {/* PlanOneOffSheet */}
      {planSheetOpen && (
        <PlanOneOffSheet
          accounts={accounts}
          onClose={() => setPlanSheetOpen(false)}
          onSaved={() => { api.cashflow().then(setCashflow).catch(() => {}); }}
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
          <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">Pay Period</h2>
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
                <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">{m.desc}</p>
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
function SwipeDismissRow({ onDismiss, children, label = "Not recurring" }: { onDismiss: () => void; children: React.ReactNode; label?: string }) {
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
        <span className="text-xs font-semibold text-white">{label}</span>
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
