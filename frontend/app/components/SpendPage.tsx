"use client";

import { useEffect, useLayoutEffect, useState, useCallback, useMemo, useRef } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { ChevronDown, ChevronUp, ChevronLeft, ChevronRight, Settings2, SlidersHorizontal, ReceiptText, Fuel, CreditCard } from "lucide-react";
import { api, Account, Transaction, CategorySignal } from "@/lib/api";
import { useAllTransactions, invalidateTransactionsCache } from "@/lib/useAllTransactions";
import { useColours } from "@/components/ColourProvider";
import { CATEGORY_COLOURS } from "@/lib/categories";
import { getToken, setToken } from "@/lib/auth";
import {
  getPayPeriodWithConfig,
  prevPeriodWithConfig,
  nextPeriodWithConfig,
  filterPeriod,
} from "@/lib/payPeriod";
import { usePreferences } from "@/components/PreferencesContext";
import { usePeriodSwipe } from "@/lib/usePeriodSwipe";
import { isHomeCurrency } from "@/lib/currency";
import { getCategoryIcon } from "@/lib/categoryIcons";
import { useCategoryIcons } from "@/components/IconProvider";
import { CategoryData } from "@/components/CategoryRow";
import CategorySheet from "@/components/CategorySheet";
import TransactionSheet from "@/components/TransactionSheet";
import BottomNav from "@/components/BottomNav";
import Spinner from "@/components/Spinner";
import TransactionRow from "@/components/TransactionRow";
import CategoryManagerSheet from "@/components/CategoryManagerSheet";
import SpendTrends from "@/components/SpendTrends";
import SegmentedControl from "@/components/SegmentedControl";
import PayPeriodSettingsSheet, { formatPeriodLocal } from "@/components/PayPeriodSettingsSheet";

async function ensureAuth() {}

const SKIP_FROM_SPEND = new Set(["Transfer"]);

// ── Category-signal cache (module level, per period offset) ──────────────────
// The tiles themselves render from `useAllTransactions`, which is memoised for
// 60 s — so on a revisit or a period swipe the amounts paint instantly while a
// freshly-fetched multiple lands a round trip later. That gap is the whole
// "× usual appears late" symptom. Mirroring the transactions cache (same TTL,
// same in-flight dedupe) closes it: a period we have already read is instant.
// Any mutation that can move a multiple clears this cache explicitly.
type SignalMap = Record<string, CategorySignal>;
const SIGNALS_TTL_MS = 60_000;
const signalsCache = new Map<number, { data: SignalMap; at: number }>();
const signalsInflight = new Map<number, Promise<SignalMap>>();

export function invalidateSignalsCache() {
  signalsCache.clear();
  signalsInflight.clear();
}

function cachedSignals(offset: number): SignalMap | null {
  const hit = signalsCache.get(offset);
  return hit && Date.now() - hit.at < SIGNALS_TTL_MS ? hit.data : null;
}

function fetchSignals(offset: number, force = false): Promise<SignalMap> {
  if (!force) {
    const hit = cachedSignals(offset);
    if (hit) return Promise.resolve(hit);
    const pending = signalsInflight.get(offset);
    if (pending) return pending;
  }
  const p = api.categorySignals(offset)
    .then(d => {
      const data = d.signals ?? {};
      signalsCache.set(offset, { data, at: Date.now() });
      return data;
    })
    .finally(() => { signalsInflight.delete(offset); });
  signalsInflight.set(offset, p);
  return p;
}

export default function SpendPage() {
  const { payPeriodConfig, setPayPeriodConfig, region } = usePreferences();
  const { colours } = useColours();
  const { icons: iconOverrides } = useCategoryIcons();
  const searchParams = useSearchParams();
  const router = useRouter();
  const [view, setView] = useState<"categories" | "list" | "trends">(() => {
    const v = searchParams.get("view");
    return v === "list" || v === "trends" ? v : "categories";
  });
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
  const [pendingCategory, setPendingCategory] = useState<string | null>(null);
  const [periodOffset, setPeriodOffset] = useState(0);
  const [signals, setSignals] = useState<SignalMap>(() => cachedSignals(0) ?? {});
  const signalsOffsetRef = useRef(0);
  // force = the Door or a category just changed, so the cached copy is dead.
  const refetchSignals = useCallback((force = true) => {
    const captured = signalsOffsetRef.current;
    if (force) invalidateSignalsCache();
    fetchSignals(captured, force)
      .then(d => { if (signalsOffsetRef.current === captured) setSignals(d); })
      .catch(() => { if (signalsOffsetRef.current === captured) setSignals({}); });
  }, []);
  useEffect(() => {
    signalsOffsetRef.current = periodOffset;
    // Only blank the multiples when we have nothing for this period — a
    // remembered period keeps its readings and never flashes empty.
    const hit = cachedSignals(periodOffset);
    setSignals(hit ?? {});
    if (!hit) refetchSignals(false);
    // Warm the period the user is one swipe away from, after this one settles.
    const warm = setTimeout(() => { fetchSignals(periodOffset - 1).catch(() => {}); }, 400);
    return () => clearTimeout(warm);
  }, [periodOffset, refetchSignals]);

  const [accounts, setAccounts] = useState<Account[]>([]);
  const [isPro, setIsPro] = useState<boolean>(false);
  const [miscategorisedCount, setMiscategorisedCount] = useState(0);

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
      const [accs, misc] = await Promise.all([
        api.accounts().catch(() => [] as Account[]),
        api.getMiscategorisedCount().catch(() => ({ count: 0, ids: [] as string[] })),
      ]);
      setAccounts(accs);
      setMiscategorisedCount(misc.count);
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

  // Category deep-link — e.g. from RhythmCard "I'd like to change this"
  useEffect(() => {
    if (typeof window === "undefined") return;
    const cat = sessionStorage.getItem("wealth_open_category");
    if (cat) {
      sessionStorage.removeItem("wealth_open_category");
      setPendingCategory(cat);
    }
  }, []);

  // Page is ready once both accounts and transactions are loaded.
  const pageLoading = loading || txLoading;

  // Re-initialise period when config loads/changes
  const configKey = JSON.stringify(payPeriodConfig);
  useEffect(() => {
    const [s, e] = getPayPeriodWithConfig(new Date(), payPeriodConfig);
    setPeriodStart(s);
    setPeriodEnd(e);
    setPeriodOffset(0);
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

  // Open the matching category once categories have loaded (deep-link from RhythmCard)
  useEffect(() => {
    if (!pendingCategory) return;
    const match = categories.find(c => c.name === pendingCategory);
    if (match) {
      setPendingCategory(null);
      setOpenCategory(match);
    }
  }, [pendingCategory, categories]);

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

  // Stop at the period containing the oldest transaction — no empty pre-history
  const canGoPrev = !oldestTxDate || periodStart.getTime() > oldestTxDate.getTime();

  const [largeToast, setLargeToast] = useState(false);
  const largeToastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const listSectionRef = useRef<HTMLDivElement>(null);
  const [largeOnly, setLargeOnly] = useState(false);

  function handlePrev() {
    if (!canGoPrev) return;
    const [s, e] = prevPeriodWithConfig(periodStart, payPeriodConfig);
    setPeriodStart(s);
    setPeriodEnd(e);
    setPeriodOffset(o => o - 1);
    setLargeOnly(false);
  }

  function handleNext() {
    const [s, e] = nextPeriodWithConfig(periodEnd, payPeriodConfig);
    setPeriodStart(s);
    setPeriodEnd(e);
    setPeriodOffset(o => o + 1);
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
    if (v === "upcoming") { router.replace("/planning"); return; }
    if (v === "list" || v === "categories" || v === "trends") setView(v);
  }, [searchParams, router]);


  function handleTxUpdated(updated: Transaction, additionalIds?: string[]) {
    invalidateTransactionsCache();
    // Re-categorising moves what "usual" means for both categories involved.
    invalidateSignalsCache();
    setAllTransactions((prev) =>
      prev.map((t) => {
        if (t.id === updated.id) return { ...t, category: updated.category };
        if (additionalIds?.includes(t.id)) return { ...t, category: updated.category };
        return t;
      })
    );
  }

  const sym = region === "Kenya" ? "KES " : "£";
  const fmtSummary = (n: number) =>
    `£${Math.abs(n).toLocaleString("en-GB", {
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    })}`;

  return (
    <div className="min-h-dvh pb-36 lg:pb-8 lg:max-w-6xl lg:mx-auto" style={{ paddingTop: "env(safe-area-inset-top, 0px)" }}>
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
            {/* Quiet guardrail — informational only, calm slate chip (never
                red/alarm: Calm Cockpit, Red Is Risk is reserved for genuine
                liability). Taps into the existing transactions view rather
                than opening a new surface. */}
            {miscategorisedCount > 0 && (
              <button
                onClick={() => setView("list")}
                className="w-full flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-full bg-slate-100/70 dark:bg-slate-700/40 text-slate-500 dark:text-slate-400 text-[11px] font-medium active:opacity-70 transition-opacity"
              >
                <span>
                  {miscategorisedCount} transfer{miscategorisedCount !== 1 ? "s" : ""} may be miscategorised
                </span>
              </button>
            )}
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

        {/* View switcher — categories / transactions / trends */}
        {!isDesktop && (
          <SegmentedControl
            ariaLabel="View"
            className="mt-3"
            value={view}
            onChange={(v) => setView(v as typeof view)}
            options={[
              { value: "categories", label: "Categories" },
              { value: "list", label: "Transactions" },
              { value: "trends", label: "Trends" },
            ]}
          />
        )}
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
                  const sig = signals[cat.name];
                  const s = cat.count !== 1 ? "s" : "";
                  const multipleFragment = sig?.multiple != null ? ` · ${sig.multiple.toFixed(1)}× usual` : "";
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
                          <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">{cat.count} txn{s}{multipleFragment}</p>
                        </div>
                      </div>
                      <p className="text-lg font-bold text-slate-900 dark:text-slate-100">
                        £{cat.total.toLocaleString("en-GB", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                      </p>
                      {/* spend bar */}
                      <div className="h-1.5 w-full rounded-full bg-slate-200 dark:bg-slate-700 overflow-hidden">
                        <div className="h-full rounded-full" style={{ width: `${Math.min(cat.pct, 100)}%`, backgroundColor: colour }} />
                      </div>
                      {/* Badge slot — precedence: checkpoint > "is this usual?" > existing category badges */}
                      {(() => {
                        if (sig?.checkpoint) {
                          return (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-700/60 text-slate-500 dark:text-slate-300 text-[11px]">
                              <span>{sym}{Math.round(sig.checkpoint.spent_so_far)} of {sym}{Math.round(sig.checkpoint.aim_amount)} aim</span>
                              <ChevronRight size={10} className="text-slate-400 dark:text-slate-500" />
                            </span>
                          );
                        }
                        if (sig && sig.multiple != null && sig.multiple >= 1.5 && !sig.door_engaged) {
                          return (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-700/60 text-slate-500 dark:text-slate-300 text-[11px]">
                              <span>is this usual?</span>
                              <ChevronRight size={10} className="text-slate-400 dark:text-slate-500" />
                            </span>
                          );
                        }
                        if (cat.name.toLowerCase() === "transport" || cat.name.toLowerCase() === "groceries" || cat.name === "Debt") {
                          return (
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
                          );
                        }
                        return null;
                      })()}
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
          <div ref={listSectionRef} className="relative">
            {/* Ambient glow — this card sits low enough on the page that the
                page-wide hero glow (app/layout.tsx) has faded to bare canvas
                by the time it reaches here, so the glass reads flat. Echoes
                the same indigo/violet field, scoped to this region. No new
                blur layer (One Blur Rule) — glass-card below still owns the
                only blur. */}
            <div aria-hidden="true" className="glow-ambient-panel absolute -inset-x-3 -inset-y-6 -z-10 pointer-events-none" />
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

        return isDesktop ? (
          <>
            <div className="px-4 pt-4 grid grid-cols-2 gap-4 items-start">
              <div className="space-y-3" data-tutorial-id="tutorial-spend-categories">
                {sectionTitle("Categories", "#6366f1")}
                {categoriesBlock}
                {!pageLoading && untrackedCategories.length > 0 && untrackedBlock}
              </div>
              <div className="space-y-3">
                {sectionTitle("Transactions", "#10b981")}
                {listBlock}
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
          sym={sym}
          onClose={() => setOpenCategory(null)}
          onTransactionClick={(tx) => { setOpenCategory(null); setSelectedTx(tx); }}
          isPro={isPro}
          door={signals[openCategory.name] ? (() => {
            const catSig = signals[openCategory.name];
            return {
              category: openCategory.name,
              multiple: catSig.multiple,
              suggestedAim: catSig.suggested_aim,
              checkpoint: catSig.checkpoint,
              intent: catSig.intent,
              doorEngaged: catSig.door_engaged,
              isCurrentPeriod,
              sym,
              onChanged: refetchSignals,
            };
          })() : undefined}
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

      <BottomNav />
    </div>
  );
}
