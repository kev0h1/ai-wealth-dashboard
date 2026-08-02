"use client";

import React, { useEffect, useState, useCallback, useRef, useMemo } from "react";
import { useSearchParams } from "next/navigation";
import { usePeriodSwipe } from "@/lib/usePeriodSwipe";

function useIsDark() {
  const [dark, setDark] = useState(false);
  useEffect(() => {
    const el = document.documentElement;
    const update = () => setDark(el.classList.contains("dark"));
    update();
    const obs = new MutationObserver(update);
    obs.observe(el, { attributes: true, attributeFilter: ["class"] });
    return () => obs.disconnect();
  }, []);
  return dark;
}
import { MessageCircle, X, Send, Loader2, Plus, Trash2, RotateCcw, ChevronDown, Flag, ChevronLeft, ChevronRight, Sparkles, BarChart2, TrendingUp } from "lucide-react";
import SwipeToDelete from "@/components/SwipeToDelete";
import { BRAND, BRAND_GRADIENT } from "@/components/MoneyAdvisorChat";
import { useLockBodyScroll } from "@/lib/useLockBodyScroll";
import { ComposedChart, Area, Line, BarChart, Bar, Cell, Tooltip, ResponsiveContainer, XAxis, YAxis, ReferenceDot } from "recharts";
import { api } from "@/lib/api";
import { useAuth } from "@/components/AuthProvider";
import { useColours } from "@/components/ColourProvider";
import { useCategories } from "@/components/CategoriesContext";
import { usePreferences } from "@/components/PreferencesContext";
import { CATEGORY_COLOURS } from "@/lib/categories";
import { isHomeCurrency } from "@/lib/currency";
import { getCategoryIcon } from "@/lib/categoryIcons";
import { useCategoryIcons } from "@/components/IconProvider";
import { useAllTransactions, invalidateTransactionsCache } from "@/lib/useAllTransactions";
import { useSheetA11y } from "@/lib/useSheetA11y";
import BottomNav from "@/components/BottomNav";
import Spinner from "@/components/Spinner";
import ChatMarkdown from "@/components/ChatMarkdown";
import { getPayPeriodWithConfig, filterPeriod, formatDate, formatPeriod, prevPeriodWithConfig, nextPeriodWithConfig } from "@/lib/payPeriod";
import type { Transaction, CashflowData, PaceDetail } from "@/lib/api";
import CustomSelect from "@/components/CustomSelect";
import BudgetLimitSheet from "@/components/BudgetLimitSheet";
import CategorySheet from "@/components/CategorySheet";
import TransactionSheet from "@/components/TransactionSheet";

interface Budget {
  category: string;
  monthly_limit: number;
}

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  suggestedBudgets?: Budget[];
}

function fmt(n: number, sym = "£") {
  return `${sym}${Math.abs(n).toLocaleString("en-GB", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

function fmt2(n: number, sym = "£") {
  return `${sym}${Math.abs(n).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

const MONTH_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

function interpolateCurve(curve: number[], elapsedFraction: number): number {
  if (!curve || curve.length < 2) return elapsedFraction;
  const n = curve.length - 1;
  const pos = Math.min(n, Math.max(0, elapsedFraction * n));
  const lo = Math.floor(pos);
  const hi = Math.min(n, lo + 1);
  if (lo === hi) return curve[lo];
  return curve[lo] + (pos - lo) * (curve[hi] - curve[lo]);
}

// Status colours — drive all over-budget bars and text from these two constants
const OVER_COLOUR  = "#f59e0b"; // amber: watch state (over a self-set budget)
const RISK_COLOUR  = "#ef4444"; // red: genuine risk only (bill can't clear)

const SKIP = new Set(["Transfer", "Savings", "Debt", "Income"]);

// Rendered only while the chat panel is open — freezes the page behind it
function ChatScrollLock() {
  useLockBodyScroll();
  return null;
}

export default function BudgetPage() {
  const isDark = useIsDark();
  const tickFill = isDark ? "#94a3b8" : "#64748b";
  const axisStroke = isDark ? "#334155" : "#e2e8f0";
  const { user } = useAuth();
  const { colours } = useColours();
  const { icons: iconOverrides } = useCategoryIcons();
  const { allCategories } = useCategories();
  const { region, hideNetWorth, payPeriodConfig, budgetWidgets, setBudgetWidgets } = usePreferences();
  const sym = region === "Kenya" ? "KES " : "£";
  const firstName = user?.name?.split(" ")[0] || "there";

  const searchParams = useSearchParams();

  // PaceDetail for current-period trends view
  const [detail, setDetail] = useState<PaceDetail | null>(null);

  const [budgets, setBudgets] = useState<Budget[]>([]);
  const [paceProfile, setPaceProfile] = useState<Record<string, number[]>>({});
  const { transactions: allTransactions, loading: txLoading, setTransactions: setAllTransactions } = useAllTransactions();
  const [periodStart, setPeriodStart] = useState<Date>(() => getPayPeriodWithConfig(new Date(), { type: "calendar_month" })[0]);
  const [oldestTxDate, setOldestTxDate] = useState<Date | null>(null);
  const [periodEnd, setPeriodEnd] = useState<Date>(() => getPayPeriodWithConfig(new Date(), { type: "calendar_month" })[1]);
  // Budgets are home-currency only — foreign-currency imports must not count
  const allPeriodTxns = useMemo(
    () => filterPeriod(allTransactions, periodStart, periodEnd)
      .filter(tx => isHomeCurrency(tx.currency, region)),
    [allTransactions, periodStart, periodEnd, region]
  );
  const [loading, setLoading] = useState(true);
  const [cashflow, setCashflow] = useState<CashflowData | null>(null);
  // Page is ready once both budgets/profile and transactions are loaded.
  const pageLoading = loading || txLoading;
  const [expandedCat, setExpandedCat] = useState<string | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [showDaily, setShowDaily] = useState(false);
  // Controls the collapsed Category Limits disclosure
  const [limitsOpen, setLimitsOpen] = useState(false);

  // Add budget form
  const [addCat, setAddCat] = useState("");
  const [addLimit, setAddLimit] = useState("");
  const [addError, setAddError] = useState("");

  // Budget limit sheet state
  const [budgetSheetCat, setBudgetSheetCat] = useState<string | null>(null);

  // Category sheet + transaction sheet state (for Your Choices rows)
  const [openCategory, setOpenCategory] = useState<{ name: string; total: number; count: number; transactions: Transaction[] } | null>(null);
  const [selectedTx, setSelectedTx] = useState<Transaction | null>(null);

  // Chat state
  const [chatOpen, setChatOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputText, setInputText] = useState("");
  const [chatLoading, setChatLoading] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const chatInputRef = useRef<HTMLInputElement>(null);
  const chatInitialised = useRef(false);
  // Undo-delete state (optimistic remove + 6 s undo window)
  const [undoBudget, setUndoBudget] = useState<Budget | null>(null);
  const [undoNonce, setUndoNonce] = useState(0);
  const undoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // a11y: dialog contract for chat panel — Escape closes, Tab traps, focus restores on close
  const chatPanelRef = useSheetA11y<HTMLDivElement>(() => setChatOpen(false));
  // After hook focuses first focusable (a header button), redirect focus to the chat input
  useEffect(() => {
    if (!chatOpen) return;
    const t = setTimeout(() => chatInputRef.current?.focus(), 50);
    return () => clearTimeout(t);
  }, [chatOpen]);

  const load = useCallback(async () => {
    try {
      const [{ budgets: b }, profile, cashflowData, detailData] = await Promise.all([
        api.getBudgets(),
        api.budgetPaceProfile().catch(() => ({ curves: {}, sample_points: 20, periods_analysed: 0 })),
        api.cashflow().catch(() => null),
        api.paceDetail().catch(() => null),
      ]);
      setPaceProfile(profile.curves);
      setBudgets(b);
      setCashflow(cashflowData);
      setDetail(detailData);
    } catch {}
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Prefill add-budget form from ?category= query param — open limits disclosure too
  useEffect(() => {
    const cat = searchParams.get("category");
    if (cat) {
      setAddCat(cat);
      setShowAddForm(true);
      setLimitsOpen(true);
    }
  }, []); // run once on mount only — eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    api.oldestTransaction().then(r => { if (r.date) setOldestTxDate(new Date(r.date)); }).catch(() => {});
  }, []);

  // Stop at the period containing the oldest transaction — no empty pre-history
  const canGoPrev = !oldestTxDate || periodStart.getTime() > oldestTxDate.getTime();

  useEffect(() => {
    const [s, e] = getPayPeriodWithConfig(new Date(), payPeriodConfig);
    setPeriodStart(s);
    setPeriodEnd(e);
  }, [JSON.stringify(payPeriodConfig)]); // eslint-disable-line react-hooks/exhaustive-deps

  const { spending, categoryTxns } = useMemo(() => {
    const spendMap: Record<string, number> = {};
    const txnMap: Record<string, Transaction[]> = {};
    for (const tx of allPeriodTxns) {
      const cat = tx.category || "Other";
      if (SKIP.has(cat)) continue;
      // Credits in a budget category are refunds — they net against the spend
      const isCredit = tx.transaction_type === "credit";
      if (tx.transaction_type !== "debit" && !isCredit) continue;
      txnMap[cat] = txnMap[cat] ?? [];
      txnMap[cat].push(tx);
      if (!tx.planned) {
        spendMap[cat] = (spendMap[cat] ?? 0) + (isCredit ? -Math.abs(tx.amount) : Math.abs(tx.amount));
      }
    }
    for (const cat of Object.keys(txnMap)) {
      txnMap[cat].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
      if (spendMap[cat] !== undefined) spendMap[cat] = Math.max(0, spendMap[cat]);
    }
    return { spending: spendMap, categoryTxns: txnMap };
  }, [allPeriodTxns]);

  const totalPlanned = useMemo(() => {
    let sum = 0;
    for (const tx of allPeriodTxns) {
      if (tx.planned && tx.transaction_type === "debit" && !SKIP.has(tx.category || "Other")) {
        sum += Math.abs(tx.amount);
      }
    }
    return sum;
  }, [allPeriodTxns]);

  async function handleTransactionPlanned(txId: string, currentPlanned: boolean) {
    const newPlanned = !currentPlanned;
    setAllTransactions(prev => prev.map(tx => tx.id === txId ? { ...tx, planned: newPlanned } : tx));
    await api.setTransactionPlanned(txId, newPlanned).catch(() => {
      setAllTransactions(prev => prev.map(tx => tx.id === txId ? { ...tx, planned: currentPlanned } : tx));
    });
    invalidateTransactionsCache();
  }

  // handleTxUpdated — mirrors SpendPage pattern
  function handleTxUpdated(updated: Transaction, additionalIds?: string[]) {
    invalidateTransactionsCache();
    setAllTransactions(prev =>
      prev.map(t => {
        if (t.id === updated.id) return { ...t, category: updated.category };
        if (additionalIds?.includes(t.id)) return { ...t, category: updated.category };
        return t;
      })
    );
  }

  // Chat session init
  useEffect(() => {
    if (!chatOpen || chatInitialised.current) return;
    chatInitialised.current = true;
    api.getBudgetChatSession().then(({ session_id, messages: sessionMsgs }) => {
      setSessionId(session_id);
      if (sessionMsgs && sessionMsgs.length > 0) {
        setMessages(sessionMsgs as ChatMessage[]);
      } else {
        setMessages([{
          role: "assistant",
          content: `Hi ${firstName}! I can help you set up budgets based on your spending. Say "suggest a budget" and I'll analyse your spending and create one automatically.`,
        }]);
      }
    }).catch(() => {
      setMessages([{
        role: "assistant",
        content: `Hi ${firstName}! I can help you create and manage budgets. Say "suggest a budget" and I'll analyse your spending!`,
      }]);
    });
  }, [chatOpen, firstName]);

  useEffect(() => {
    if (chatOpen) messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, chatOpen, chatLoading]);

  async function sendMessage() {
    const text = inputText.trim();
    if (!text || chatLoading) return;
    setInputText("");
    const userMsg: ChatMessage = { role: "user", content: text };
    setMessages(prev => [...prev, userMsg]);
    setChatLoading(true);
    try {
      const result = await api.budgetChat([userMsg], sessionId ?? undefined);
      setMessages(prev => [...prev, {
        role: "assistant",
        content: result.reply,
        suggestedBudgets: result.suggested_budgets ?? undefined,
      }]);
    } catch {
      setMessages(prev => [...prev, { role: "assistant", content: "Sorry, couldn't reach the AI. Try again." }]);
    } finally { setChatLoading(false); }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); }
  }

  async function handleAddBudget() {
    const cat = addCat.trim();
    const limit = parseFloat(addLimit);
    if (!cat) { setAddError("Choose a category"); return; }
    if (!limit || limit <= 0) { setAddError("Enter a valid limit"); return; }
    setAddError("");
    const existing = budgets.find(b => b.category === cat);
    const next = existing
      ? budgets.map(b => b.category === cat ? { ...b, monthly_limit: limit } : b)
      : [...budgets, { category: cat, monthly_limit: limit }];
    setBudgets(next);
    await api.setBudgets(next).catch(() => {});
    setAddCat("");
    setAddLimit("");
    setShowAddForm(false);
  }

  async function handleUpdateLimit(cat: string, value: string) {
    const limit = parseFloat(value);
    if (!limit || limit <= 0) return;
    const next = budgets.map(b => b.category === cat ? { ...b, monthly_limit: limit } : b);
    setBudgets(next);
    await api.setBudgets(next).catch(() => {});
  }

  // Clean up undo timer on unmount
  useEffect(() => () => { if (undoTimer.current) clearTimeout(undoTimer.current); }, []);

  function requestDelete(cat: string) {
    const target = budgets.find(b => b.category === cat);
    if (!target) return;
    // Optimistic remove
    const next = budgets.filter(b => b.category !== cat);
    setBudgets(next);
    api.setBudgets(next).catch(() => {});
    // Close any open sheet / expand state for this category
    if (budgetSheetCat === cat) setBudgetSheetCat(null);
    if (expandedCat === cat) setExpandedCat(null);
    // Stash for undo
    setUndoBudget(target);
    setUndoNonce(n => n + 1);
    if (undoTimer.current) clearTimeout(undoTimer.current);
    undoTimer.current = setTimeout(() => setUndoBudget(null), 6000);
  }

  function undoDelete() {
    if (!undoBudget) return;
    if (undoTimer.current) { clearTimeout(undoTimer.current); undoTimer.current = null; }
    const restored = [...budgets, undoBudget];
    setBudgets(restored);
    api.setBudgets(restored).catch(() => {});
    setUndoBudget(null);
  }

  async function applyBudgets(suggested: Budget[]) {
    const suggestedMap = new Map(suggested.map(b => [b.category, b]));
    const merged = [
        ...budgets.map(b => suggestedMap.get(b.category) ?? b),
        ...suggested.filter(b => !budgets.some(e => e.category === b.category)),
    ];
    await api.setBudgets(merged);
    setBudgets(merged);
    await load();
  }

  function cleanReply(text: string) {
    return text.replace(/```budgets[\s\S]*?```/g, "").trim();
  }

  // Only offer categories that don't already have a budget — editing an
  // existing one happens inline on its card, not through the add form.
  const budgetedCats = new Set(budgets.map(b => b.category));
  const availableCats = allCategories.filter(c => !SKIP.has(c) && !budgetedCats.has(c));

  const totalBudget = budgets.reduce((s, b) => s + b.monthly_limit, 0);
  const totalSpent = budgets.reduce((s, b) => s + (spending[b.category] ?? 0), 0);
  const overallPct = totalBudget > 0 ? Math.min(100, (totalSpent / totalBudget) * 100) : 0;
  const overBudgetCount = budgets.filter(b => (spending[b.category] ?? 0) > b.monthly_limit).length;

  // True at-risk: a bill that likely won't clear (within 7 days, amount > account balance)
  // or the available cash balance is already negative.
  const atRiskBills = cashflow
    ? cashflow.upcoming_bills.filter(
        b => b.days_away <= 7 &&
             b.account_balance != null &&
             b.account_balance >= 0 &&
             b.amount > b.account_balance
      )
    : [];
  const hasGenuineRisk =
    (cashflow?.available_balance != null && cashflow.available_balance < 0) ||
    atRiskBills.length > 0;

  // How far through the current pay period are we (linear fraction)?
  const _today = new Date();
  const _totalMs = Math.max(1, periodEnd.getTime() - periodStart.getTime());
  const _elapsedMs = Math.min(_totalMs, Math.max(0, _today.getTime() - periodStart.getTime()));
  const elapsedFraction = _elapsedMs / _totalMs;

  // Auto-detect "fixed" categories (bills, subscriptions) from the pace profile.
  const fixedCategories = useMemo(() => {
    const fixed = new Set<string>();
    for (const b of budgets) {
      const curve = paceProfile[b.category];
      if (curve && curve.length >= 2 && curve[1] > 0.5) {
        fixed.add(b.category);
      }
    }
    return fixed;
  }, [paceProfile, budgets]);

  // Budget-weighted combined pace curve from historical data.
  const combinedPaceCurve = useMemo(() => {
    if (!paceProfile || Object.keys(paceProfile).length === 0) return null;
    const points = 21;
    const weighted = new Array(points).fill(0);
    let totalWeight = 0;
    for (const b of budgets) {
      const curve = paceProfile[b.category];
      if (curve && b.monthly_limit > 0) {
        for (let j = 0; j < points; j++) {
          weighted[j] += (curve[j] ?? 0) * b.monthly_limit;
        }
        totalWeight += b.monthly_limit;
      }
    }
    if (totalWeight === 0) return null;
    return weighted.map(v => v / totalWeight);
  }, [paceProfile, budgets]);

  // Historical pace at today (fraction of budget expected spent by now).
  const historicalPaceAtToday = combinedPaceCurve
    ? interpolateCurve(combinedPaceCurve, elapsedFraction) * totalBudget
    : totalBudget * elapsedFraction;
  const overallAheadOfPace = totalSpent <= historicalPaceAtToday;

  // Variable-only budget: excludes fixed/bills categories from the daily comparison.
  const variableBudget = budgets.filter(b => !fixedCategories.has(b.category)).reduce((s, b) => s + b.monthly_limit, 0);

  // Data for the cumulative spend chart (past periods / no detail).
  const paceChartData = useMemo(() => {
    if (budgets.length === 0 || totalBudget === 0) return [];
    const periodDays = Math.round((periodEnd.getTime() - periodStart.getTime()) / 86400000) + 1;
    const todayEnd = new Date(); todayEnd.setHours(23, 59, 59, 999);
    const spendByDay: Record<string, number> = {};
    const variableSpendByDay: Record<string, number> = {};
    for (const tx of allPeriodTxns) {
      if (tx.transaction_type !== "debit" || tx.planned) continue;
      const cat = tx.category || "Other";
      if (SKIP.has(cat)) continue;
      const key = tx.date.slice(0, 10);
      spendByDay[key] = (spendByDay[key] ?? 0) + Math.abs(tx.amount);
      if (!fixedCategories.has(cat)) {
        variableSpendByDay[key] = (variableSpendByDay[key] ?? 0) + Math.abs(tx.amount);
      }
    }
    const variableDailyExpected = periodDays > 0 ? variableBudget / periodDays : 0;
    let cum = 0;
    return Array.from({ length: periodDays }, (_, i) => {
      const d = new Date(Date.UTC(
        periodStart.getUTCFullYear(), periodStart.getUTCMonth(), periodStart.getUTCDate() + i,
      ));
      const key = d.toISOString().slice(0, 10);
      const isPast = d <= todayEnd;
      const daySpend = spendByDay[key] ?? 0;
      if (isPast) cum += daySpend;
      const label = `${d.getUTCDate()} ${MONTH_SHORT[d.getUTCMonth()]}`;
      const currFrac = i / Math.max(1, periodDays - 1);
      const currHistFrac = combinedPaceCurve ? interpolateCurve(combinedPaceCurve, currFrac) : currFrac;
      const pace = totalBudget * currHistFrac;
      const variableSpend = isPast ? (variableSpendByDay[key] ?? 0) : null;
      return { i, label, actual: isPast ? cum : null, pace, dailySpend: isPast ? daySpend : null, variableSpend, variableDailyExpected };
    });
  }, [allPeriodTxns, periodStart, periodEnd, budgets, totalBudget, combinedPaceCurve, fixedCategories, variableBudget]);

  const todayIdx = paceChartData.length > 0 ? Math.round(elapsedFraction * (paceChartData.length - 1)) : 0;
  const todayPoint = paceChartData[todayIdx] ?? null;
  const daysLeft = paceChartData.length - 1 - todayIdx;
  const overallPaceGap = Math.abs(historicalPaceAtToday - totalSpent);
  const avgDailyPace = paceChartData.length > 0 ? totalBudget / paceChartData.length : 0;
  const chartTicks = paceChartData.length > 0
    ? [0, 0.25, 0.5, 0.75, 1].map(f => paceChartData[Math.round(f * (paceChartData.length - 1))]?.label).filter(Boolean) as string[]
    : [];

  // Is the displayed period the current pay period?
  const isCurrentPeriod = periodStart.getTime() === getPayPeriodWithConfig(new Date(), payPeriodConfig)[0].getTime();

  // Trends mode: current period + paceDetail available
  const trendsActive = isCurrentPeriod && detail?.status === "ok";

  // Chart data built from detail.series when trendsActive
  const trendsSeriesData = useMemo(() => {
    if (!trendsActive || detail?.status !== "ok") return null;
    return detail.series.map((p, i) => {
      const d = new Date(p.date + "T00:00:00Z");
      return {
        i,
        label: `${d.getUTCDate()} ${MONTH_SHORT[d.getUTCMonth()]}`,
        actual: p.cumulative_discretionary,
        // Guard null sustainable_line — never let recharts draw a 0 line for nulls
        pace: p.sustainable_line ?? undefined,
      };
    });
  }, [trendsActive, detail]);

  // Does at least one series point have a non-null sustainable_line?
  const hasSustainableLine = useMemo(() => {
    if (detail?.status !== "ok") return false;
    return detail.series.some(p => p.sustainable_line != null);
  }, [detail]);

  // Budget charts are opt-in. null = prefs not yet loaded; [] = none added.
  const widgets = budgetWidgets ?? [];
  const prefsLoaded = budgetWidgets !== null;
  const [chartGalleryOpen, setChartGalleryOpen] = useState(false);

  function saveBudgetWidgets(next: string[]) {
    setBudgetWidgets(next);
    api.updatePreferences({ budget_widgets: next } as any).catch(() => {});
  }

  function goPrev() {
    if (!canGoPrev) return;
    const [s, e] = prevPeriodWithConfig(periodStart, payPeriodConfig);
    setPeriodStart(s);
    setPeriodEnd(e);
  }

  function goNext() {
    const [s, e] = nextPeriodWithConfig(periodEnd, payPeriodConfig);
    const [cs] = getPayPeriodWithConfig(new Date(), payPeriodConfig);
    if (s.getTime() <= cs.getTime()) {
      setPeriodStart(s);
      setPeriodEnd(e);
    }
  }

  const periodSwipe = usePeriodSwipe({ onPrev: goPrev, onNext: goNext, canPrev: canGoPrev, canNext: !isCurrentPeriod });

  // Whisper label style (reused throughout)
  const whisperClass = "text-[11px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500";

  return (
    <div className="min-h-dvh bg-[#f0f2f7] dark:bg-[#0f172a] pb-24 lg:pb-8 lg:max-w-6xl lg:mx-auto" style={{ paddingTop: "env(safe-area-inset-top, 0px)" }}>
      {/* (a) Plain page title */}
      <div className="px-4 pt-6 pb-2">
        <h1 className="text-xl font-bold text-slate-900 dark:text-slate-100">Trends</h1>
      </div>

      {/* (b) Period-nav card — mirrors SpendPage structure */}
      <div className="px-4">
        <div className="glass-card rounded-2xl p-3" {...periodSwipe} style={{ touchAction: "pan-y" }}>
          <div className="flex items-center justify-between">
            <button
              onClick={goPrev}
              disabled={!canGoPrev}
              aria-label="Previous period"
              className="w-11 h-11 flex items-center justify-center rounded-full bg-slate-100 dark:bg-slate-700 active:bg-slate-200 dark:active:bg-slate-600 transition-colors disabled:opacity-30"
            >
              <ChevronLeft size={16} color="#64748b" />
            </button>
            <div className="text-center">
              <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">
                {formatPeriod(periodStart, periodEnd)}
              </p>
              {isCurrentPeriod && (
                <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">Current period</p>
              )}
            </div>
            <button
              onClick={goNext}
              disabled={isCurrentPeriod}
              aria-label="Next period"
              className="w-11 h-11 flex items-center justify-center rounded-full bg-slate-100 dark:bg-slate-700 active:bg-slate-200 dark:active:bg-slate-600 transition-colors disabled:opacity-30"
            >
              <ChevronRight size={16} color="#64748b" />
            </button>
          </div>
        </div>
      </div>

      {/* CURRENT PERIOD TRENDS VIEW */}
      {!pageLoading && trendsActive && detail?.status === "ok" && (() => {
        const pd = detail.period;
        const pace = detail.pace;
        const ratePerDay = fmt2(pace.actual, sym);
        const discretionarySoFar = pace.discretionary_so_far;
        const sustainable = pace.sustainable;
        const paceState = pace.state;
        const periodAllowance = pace.period_allowance;

        // Build ticks for series chart
        const seriesData = trendsSeriesData ?? [];
        const seriesTicks = seriesData.length > 0
          ? [0, 0.25, 0.5, 0.75, 1].map(f => seriesData[Math.round(f * (seriesData.length - 1))]?.label).filter(Boolean) as string[]
          : [];
        const todaySeriesIdx = (() => { let idx = 0; seriesData.forEach((p, i) => { if (p.actual != null) idx = i; }); return idx; })();
        const todaySeriesPoint = seriesData[todaySeriesIdx] ?? null;
        const seriesElapsedFrac = seriesData.length > 1 ? todaySeriesIdx / (seriesData.length - 1) : 0;
        const yMax = Math.max(periodAllowance, discretionarySoFar) * 1.12;

        // Daily rhythm chart data
        const dailyData = detail.daily.map(d => {
          const date = new Date(d.date + "T00:00:00Z");
          const dayLabel = `${date.getUTCDate()} ${MONTH_SHORT[date.getUTCMonth()].slice(0, 3)}`;
          return {
            label: dayLabel,
            weekday: d.weekday.slice(0, 3),
            total: d.total,
            usual_for_weekday: d.usual_for_weekday,
          };
        });
        const dailyTicks = dailyData.length > 0
          ? [0, Math.floor(dailyData.length / 3), Math.floor(2 * dailyData.length / 3), dailyData.length - 1]
              .filter((v, i, a) => a.indexOf(v) === i)
              .map(i => dailyData[i]?.label)
              .filter(Boolean) as string[]
          : [];

        return (
          <div className="px-4 space-y-8 mt-4">
            {/* ── 1. Header ─────────────────────────────────────────────── */}
            <div>
              <div className="glass-hero rounded-2xl p-4">
                <p className={`${whisperClass} mb-1`}>THIS PERIOD</p>
                <p className="flex items-baseline gap-2">
                  <span className="text-3xl font-bold num text-slate-900 dark:text-slate-100 tracking-tight">
                    {hideNetWorth ? `${sym}••` : fmt(discretionarySoFar, sym)}
                  </span>
                  <span className="text-sm text-slate-500 dark:text-slate-400 font-medium">spent on choices</span>
                </p>
                <p className="text-sm text-slate-500 dark:text-slate-400 mt-1.5">
                  {hideNetWorth ? `${sym}••/day` : `${ratePerDay}/day`}
                  {" · "}
                  {pd.days_left} days to payday
                  {paceState !== "short" && sustainable != null && !hideNetWorth && (
                    <> · {fmt2(sustainable, sym)}/day keeps you level</>
                  )}
                </p>
              </div>
            </div>

            {/* ── 2. Chart — Spending vs your pace ──────────────────────── */}
            <div>
              <div className="glass-card rounded-2xl p-4" {...periodSwipe} style={{ touchAction: "pan-y" }}>
                <p className="text-base font-bold text-slate-700 dark:text-slate-200 mb-2">Spending vs your pace</p>
                {/* Legend */}
                <div className="flex flex-wrap gap-x-5 gap-y-1 mb-3">
                  <span className="flex items-center gap-1.5 text-[11px] text-slate-500 dark:text-slate-400">
                    <span className="w-5 h-[2px] bg-indigo-500 inline-block rounded" />
                    Spent so far
                  </span>
                  {hasSustainableLine && (
                    <span className="flex items-center gap-1.5 text-[11px] text-slate-500 dark:text-slate-400">
                      <svg width="20" height="6" className="inline-block"><line x1="0" y1="3" x2="20" y2="3" stroke="#f59e0b" strokeWidth="1.5" strokeDasharray="4 3"/></svg>
                      Steady pace
                    </span>
                  )}
                </div>

                {!hasSustainableLine && (
                  <p className="text-[12px] text-slate-400 dark:text-slate-500 mb-2">No pace line while you&apos;re short before payday.</p>
                )}

                <ResponsiveContainer width="100%" height={170}>
                  <ComposedChart data={seriesData} margin={{ top: 8, right: 8, bottom: 0, left: 4 }}>
                    <defs>
                      <linearGradient id="trendsAreaGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#6366f1" stopOpacity={0.25} />
                        <stop offset="100%" stopColor="#6366f1" stopOpacity={0.01} />
                      </linearGradient>
                    </defs>
                    <XAxis
                      dataKey="label"
                      tick={{ fontSize: 9, fill: tickFill }}
                      tickLine={false}
                      axisLine={{ stroke: axisStroke }}
                      ticks={seriesTicks}
                    />
                    <YAxis
                      tick={{ fontSize: 9, fill: tickFill }}
                      tickLine={false}
                      axisLine={false}
                      tickFormatter={(v: number) => v === 0 ? '' : v >= 1000 ? `${sym}${(v / 1000).toFixed(v >= 10000 ? 0 : 1)}k` : `${sym}${Math.round(v)}`}
                      width={44}
                      domain={[0, yMax]}
                    />
                    <Tooltip
                      cursor={{ stroke: tickFill, strokeWidth: 1, strokeDasharray: '3 3' }}
                      content={(props: any) => {  // eslint-disable-line @typescript-eslint/no-explicit-any
                        const { active, payload, label } = props;
                        if (!active || !payload?.length) return null;
                        const actual = payload.find((p: any) => p.dataKey === 'actual')?.value;
                        const pace = payload.find((p: any) => p.dataKey === 'pace')?.value;
                        if (actual == null && pace == null) return null;
                        return (
                          <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl shadow-lg px-3 py-2 text-xs pointer-events-none">
                            <p className="font-semibold text-slate-600 dark:text-slate-300 mb-1.5">{label}</p>
                            {actual != null && <p className="text-indigo-600 dark:text-indigo-400">Spent: {hideNetWorth ? '••••' : fmt2(actual, sym)}</p>}
                            {pace != null && <p className="text-slate-500 dark:text-slate-400">Steady pace: {hideNetWorth ? '••••' : fmt2(pace, sym)}</p>}
                          </div>
                        );
                      }}
                    />
                    {/* Sustainable line — only render when data has non-null values; undefined keeps Recharts from drawing flat zero */}
                    {hasSustainableLine && (
                      <Line
                        type="monotone"
                        dataKey="pace"
                        stroke="#f59e0b"
                        strokeWidth={1.5}
                        strokeDasharray="5 4"
                        dot={false}
                        isAnimationActive={false}
                        connectNulls={false}
                      />
                    )}
                    <Area
                      type="monotone"
                      dataKey="actual"
                      stroke="#6366f1"
                      strokeWidth={2.5}
                      fill="url(#trendsAreaGrad)"
                      dot={false}
                      connectNulls={false}
                      isAnimationActive={false}
                    />
                    {todaySeriesPoint?.actual != null && seriesElapsedFrac > 0.01 && (
                      <ReferenceDot
                        x={todaySeriesPoint.label}
                        y={todaySeriesPoint.actual ?? 0}
                        r={5} fill="#6366f1" stroke="white" strokeWidth={2}
                      />
                    )}
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* ── 3. Daily rhythm ────────────────────────────────────────── */}
            {dailyData.length > 0 && (
              <div>
                <div className="glass-card rounded-2xl p-4">
                  <p className="text-base font-bold text-slate-700 dark:text-slate-200 mb-3">Daily rhythm</p>
                  <ResponsiveContainer width="100%" height={100}>
                    <ComposedChart data={dailyData} margin={{ top: 4, right: 8, bottom: 0, left: 4 }}>
                      <XAxis
                        dataKey="label"
                        tick={{ fontSize: 8, fill: tickFill }}
                        tickLine={false}
                        axisLine={false}
                        ticks={dailyTicks}
                      />
                      <YAxis hide domain={[0, 'auto']} />
                      <Tooltip
                        cursor={{ fill: 'rgba(148,163,184,0.1)' }}
                        content={(props: any) => {  // eslint-disable-line @typescript-eslint/no-explicit-any
                          const { active, payload, label } = props;
                          if (!active || !payload?.length) return null;
                          const entry = payload[0]?.payload;
                          return (
                            <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl shadow-lg px-3 py-2 text-xs pointer-events-none space-y-0.5">
                              <p className="font-semibold text-slate-600 dark:text-slate-300 mb-1">{label}</p>
                              <p className="text-indigo-600 dark:text-indigo-400">Spent: {hideNetWorth ? '••••' : fmt2(entry?.total ?? 0, sym)}</p>
                              {entry?.usual_for_weekday != null && (
                                <p className="text-slate-500 dark:text-slate-400">Usual {entry?.weekday}: {hideNetWorth ? '••••' : fmt2(entry.usual_for_weekday, sym)}</p>
                              )}
                            </div>
                          );
                        }}
                      />
                      <Bar dataKey="total" radius={[2, 2, 0, 0]} maxBarSize={12} fill="#818cf8" fillOpacity={0.75} isAnimationActive={false} />
                      {/* Render usual_for_weekday as a subtle 12px tick on each bar */}
                      <Line
                        dataKey="usual_for_weekday"
                        stroke="none"
                        isAnimationActive={false}
                        dot={(p: any) => {  // eslint-disable-line @typescript-eslint/no-explicit-any
                          if (p.value == null) return <g key={p.key} />;
                          return <rect key={p.key} x={p.cx - 6} y={p.cy - 1} width={12} height={2} rx={1} fill="#94a3b8" fillOpacity={0.6} />;
                        }}
                      />
                    </ComposedChart>
                  </ResponsiveContainer>
                  {/* Legend */}
                  <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2">
                    <span className="flex items-center gap-1.5 text-[11px] text-slate-500 dark:text-slate-400">
                      <span className="w-2.5 h-2.5 rounded-sm bg-indigo-400 inline-block opacity-75" />
                      Spent
                    </span>
                    <span className="flex items-center gap-1.5 text-[11px] text-slate-500 dark:text-slate-400">
                      <span className="inline-block w-3 h-[2px] rounded bg-slate-400 opacity-60" />
                      Your usual for that day
                    </span>
                  </div>
                  {/* Notable day — one calm muted line */}
                  {detail.notable_day != null && (
                    <p className="text-[12px] text-slate-400 dark:text-slate-500 mt-3">
                      {detail.notable_day.weekday} was {hideNetWorth ? `${sym}••` : fmt(detail.notable_day.amount, sym)} — about {detail.notable_day.multiple.toFixed(1)}× your usual {detail.notable_day.weekday}.
                    </p>
                  )}
                </div>
              </div>
            )}

            {/* ── 4. Your choices ────────────────────────────────────────── */}
            <div>
              <p className={`${whisperClass} mb-3`}>YOUR CHOICES</p>
              {detail.choices.length > 0 ? (
                <div className="glass-card rounded-2xl overflow-hidden">
                  {detail.choices.map((choice, i) => {
                    const colour = colours[choice.category] ?? CATEGORY_COLOURS[choice.category as keyof typeof CATEGORY_COLOURS] ?? CATEGORY_COLOURS.Other;
                    const Icon = getCategoryIcon(choice.category, iconOverrides);
                    const txns = categoryTxns[choice.category] ?? [];
                    const hasTxns = txns.length > 0;
                    // Build the muted sub-line fragments, omitting any null data
                    const fragments: string[] = [];
                    fragments.push(`${fmt2(choice.rate_per_day, sym)}/day`);
                    if (choice.multiple != null) fragments.push(`${choice.multiple.toFixed(1)}× your usual`);
                    if (choice.share_of_discretionary != null) fragments.push(`${Math.round(choice.share_of_discretionary * 100)}% of your spending`);
                    const subLine = fragments.join(" · ");

                    const rowContent = (
                      <div className={`flex items-center gap-3 px-4 py-3${i > 0 ? " border-t border-slate-50 dark:border-slate-700" : ""}`}>
                        {/* Category chip */}
                        <span
                          className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
                          style={{ backgroundColor: `${colour}26` }}
                        >
                          <Icon size={15} style={{ color: colour }} />
                        </span>
                        {/* Name + sub-line */}
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-slate-800 dark:text-slate-100 truncate">{choice.category}</p>
                          {subLine && (
                            <p className="text-[12px] text-slate-500 dark:text-slate-400 mt-0.5">{subLine}</p>
                          )}
                        </div>
                        {/* Amount — neutral slate, no colour alarm */}
                        <span className="text-base font-bold tabular-nums text-slate-700 dark:text-slate-200 flex-shrink-0">
                          {hideNetWorth ? `${sym}••` : fmt(choice.spent, sym)}
                        </span>
                      </div>
                    );

                    if (hasTxns) {
                      return (
                        <button
                          key={choice.category}
                          className="w-full text-left active:scale-[0.99] transition-transform active:bg-slate-50 dark:active:bg-slate-700/40"
                          onClick={() => setOpenCategory({ name: choice.category, total: choice.spent, count: choice.txn_count, transactions: txns })}
                        >
                          {rowContent}
                        </button>
                      );
                    }
                    return <div key={choice.category}>{rowContent}</div>;
                  })}
                </div>
              ) : (
                <p className="text-sm text-slate-400 dark:text-slate-500 px-1">No discretionary spending yet this period.</p>
              )}
            </div>

            {/* ── 5. Committed ───────────────────────────────────────────── */}
            {detail.committed.length > 0 && (
              <div>
                <p className={`${whisperClass} mb-3`}>COMMITTED</p>
                <div className="glass-tile rounded-2xl p-4">
                  <p className="text-[12px] text-slate-400 dark:text-slate-500 mb-3">These went out on schedule — they weren&apos;t choices this month.</p>
                  <div className="space-y-2">
                    {detail.committed.map(c => (
                      <div key={c.category} className="flex items-center justify-between">
                        <span className="text-sm text-slate-500 dark:text-slate-400">{c.category}</span>
                        <span className="text-sm font-medium text-slate-500 dark:text-slate-400 tabular-nums">
                          {hideNetWorth ? `${sym}••` : fmt(c.spent, sym)}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* ── 6. Category limits (optional) — collapsed by default ──── */}
            <div>
              <button
                className="flex items-center gap-2 w-full text-left"
                onClick={() => setLimitsOpen(v => !v)}
                aria-expanded={limitsOpen}
              >
                <span className="text-sm font-semibold text-slate-500 dark:text-slate-400 flex-1">Category limits (optional)</span>
                <ChevronDown
                  size={15}
                  className={`text-slate-400 dark:text-slate-500 transition-transform duration-200 ${limitsOpen ? "rotate-180" : ""}`}
                />
              </button>

              {limitsOpen && (
                <div className="mt-3 space-y-3">
                  <p className="text-[12px] text-slate-400 dark:text-slate-500">Limits are yours to set — they describe your intent, they don&apos;t judge your month.</p>

                  {/* Flag hint */}
                  <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-100 dark:border-blue-900/40 rounded-lg px-3 py-2">
                    <p className="text-[11px] text-slate-600 dark:text-slate-300">
                      <Flag size={12} className="inline mb-0.5 text-blue-500 dark:text-blue-400 mr-1" />Flag a transaction as planned if you budgeted for it separately — it won&apos;t count towards the total.
                    </p>
                  </div>

                  {/* Existing limits */}
                  {budgets.length > 0 && (
                    <div className="glass-card rounded-2xl overflow-hidden">
                      {[...budgets].sort((a, b) => {
                        const overspendA = (spending[a.category] ?? 0) - a.monthly_limit;
                        const overspendB = (spending[b.category] ?? 0) - b.monthly_limit;
                        if (overspendA > 0 && overspendB > 0) return overspendB - overspendA;
                        if (overspendA > 0) return -1;
                        if (overspendB > 0) return 1;
                        return 0;
                      }).map((b, i) => {
                        const spent = spending[b.category] ?? 0;
                        const colour = colours[b.category] ?? CATEGORY_COLOURS[b.category as keyof typeof CATEGORY_COLOURS] ?? CATEGORY_COLOURS.Other;
                        const txns = categoryTxns[b.category] ?? [];
                        const isExpanded = expandedCat === b.category;
                        const delta = b.monthly_limit > 0 ? b.monthly_limit - spent : null;
                        return (
                          <SwipeToDelete key={b.category} onDelete={() => requestDelete(b.category)} label="Delete">
                          <div className={`relative${i > 0 ? " border-t border-slate-50 dark:border-slate-700" : ""}`}>
                            <button
                              onClick={() => setExpandedCat(isExpanded ? null : b.category)}
                              className="w-full px-4 pt-3 pb-3 text-left"
                              aria-expanded={isExpanded}
                              aria-controls={`budget-txns-${b.category}`}
                              aria-label={b.monthly_limit === 0
                                ? `${b.category}: no limit set`
                                : `${b.category}: ${hideNetWorth ? "" : fmt2(spent, sym)} spent of ${hideNetWorth ? "" : fmt2(b.monthly_limit, sym)}`}
                            >
                              <div className="flex items-center gap-2.5 pr-14">
                                <div className="flex items-center gap-2.5 min-w-0 flex-1">
                                  {(() => {
                                    const Icon = getCategoryIcon(b.category, iconOverrides);
                                    return (
                                      <span className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0" style={{ backgroundColor: `${colour}26` }}>
                                        <Icon size={15} style={{ color: colour }} />
                                      </span>
                                    );
                                  })()}
                                  <div className="min-w-0">
                                    <span className="text-sm font-semibold text-slate-800 dark:text-slate-100 truncate block">{b.category}</span>
                                    <span className="text-[11px] text-slate-500 dark:text-slate-400 tabular-nums">
                                      {hideNetWorth ? "••••" : b.monthly_limit === 0 ? (
                                        <span className="italic">No limit set</span>
                                      ) : (
                                        <>{fmt2(spent, sym)} of{" "}
                                          <button
                                            onClick={e => { e.stopPropagation(); setBudgetSheetCat(b.category); }}
                                            className="underline decoration-dotted underline-offset-2 text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 transition-colors"
                                            aria-label={`Edit ${b.category} limit`}
                                          >
                                            {fmt2(b.monthly_limit, sym)}
                                          </button>
                                        </>
                                      )}
                                    </span>
                                  </div>
                                </div>
                                {/* Neutral delta — no red hero, no amber alarm */}
                                <div className="flex-shrink-0 text-right">
                                  {b.monthly_limit === 0 ? (
                                    <button
                                      onClick={e => { e.stopPropagation(); setBudgetSheetCat(b.category); }}
                                      className="text-[11px] text-indigo-500 dark:text-indigo-400 font-medium underline decoration-dotted underline-offset-2"
                                      aria-label={`Set ${b.category} limit`}
                                    >
                                      Set limit
                                    </button>
                                  ) : delta != null ? (
                                    <span className={`text-sm font-semibold tabular-nums ${delta < 0 ? "text-slate-600 dark:text-slate-300" : "text-slate-600 dark:text-slate-300"}`}>
                                      {hideNetWorth ? "••••" : `${fmt(spent, sym)} / ${fmt(b.monthly_limit, sym)}`}
                                    </span>
                                  ) : null}
                                </div>
                              </div>
                            </button>

                            {/* Chevron toggle */}
                            <div className="absolute top-3 right-4 flex items-center">
                              <button
                                onClick={() => setExpandedCat(isExpanded ? null : b.category)}
                                className="w-11 h-11 flex items-center justify-center rounded-full active:bg-slate-100 dark:active:bg-slate-700"
                                aria-label={isExpanded ? `Collapse ${b.category}` : `Expand ${b.category}`}
                                aria-expanded={isExpanded}
                                aria-controls={`budget-txns-${b.category}`}
                              >
                                <ChevronDown size={14} className={`text-slate-500 dark:text-slate-400 transition-transform duration-200 ${isExpanded ? "rotate-180" : ""}`} />
                              </button>
                            </div>

                            {/* Expanded: transactions */}
                            {isExpanded && (
                              <div id={`budget-txns-${b.category}`} className="border-t border-slate-50 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-700/20">
                                {txns.length === 0 ? (
                                  <p className="text-xs text-slate-500 dark:text-slate-400 text-center py-4">No transactions this period</p>
                                ) : (
                                  <div className="max-h-56 overflow-y-auto">
                                    {txns.map(tx => (
                                      <div key={tx.id} className="flex items-center justify-between px-4 py-2 border-b border-slate-100/60 dark:border-slate-700/40 last:border-0">
                                        <div className="min-w-0 flex-1">
                                          <p className={`text-xs font-medium truncate ${tx.planned ? "text-slate-500 dark:text-slate-400 line-through" : "text-slate-700 dark:text-slate-200"}`}>
                                            {tx.merchant_name || tx.description}
                                          </p>
                                          <p className="text-[11px] text-slate-500 dark:text-slate-400">{formatDate(tx.date)}</p>
                                        </div>
                                        <div className="flex items-center gap-2 flex-shrink-0 ml-3">
                                          <span className={`text-xs font-semibold ${tx.planned ? "text-slate-400 line-through" : tx.transaction_type === "credit" ? "text-emerald-500" : "text-slate-600 dark:text-slate-300"}`}>
                                            {hideNetWorth ? "••••" : `${tx.transaction_type === "credit" ? "+" : "-"}${fmt2(Math.abs(tx.amount), sym)}`}
                                          </span>
                                          {tx.transaction_type === "credit" ? (
                                            <span className="w-7 h-7 flex-shrink-0" />
                                          ) : (
                                            <button
                                              onClick={() => handleTransactionPlanned(tx.id, !!tx.planned)}
                                              className={`w-9 h-9 flex items-center justify-center rounded-full transition-colors flex-shrink-0 ${tx.planned ? "bg-blue-100 dark:bg-blue-900/40 text-blue-500" : "bg-slate-100 dark:bg-slate-700 text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/30 hover:text-blue-500"}`}
                                              aria-label={`${tx.planned ? "Unmark" : "Mark"} ${tx.merchant_name || tx.description} as planned`}
                                            >
                                              <Flag size={12} className={tx.planned ? "fill-blue-400 text-blue-500" : ""} />
                                            </button>
                                          )}
                                        </div>
                                      </div>
                                    ))}
                                  </div>
                                )}
                                <div className="px-4 pt-1 pb-3">
                                  <button
                                    onClick={() => requestDelete(b.category)}
                                    className="w-full flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-sm font-semibold text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                                    aria-label={`Remove ${b.category} limit`}
                                  >
                                    <Trash2 size={14} />
                                    Remove this limit
                                  </button>
                                </div>
                              </div>
                            )}
                          </div>
                          </SwipeToDelete>
                        );
                      })}
                    </div>
                  )}

                  {/* Add limit form */}
                  {!showAddForm ? (availableCats.length > 0 ? (
                    <button
                      onClick={() => setShowAddForm(true)}
                      className="w-full flex items-center justify-center gap-1.5 py-3 rounded-2xl border border-dashed border-slate-300 dark:border-slate-600 text-sm font-semibold text-slate-500 dark:text-slate-400 hover:border-indigo-400 hover:text-indigo-600 dark:hover:text-indigo-400 active:scale-[0.99] transition-all"
                    >
                      <Plus size={15} /> Add a limit
                    </button>
                  ) : null) : (
                    <div className="glass-card rounded-2xl p-4">
                      <p className="text-base font-bold text-slate-700 dark:text-slate-200 mb-3">Set a limit</p>
                      <div className="flex gap-2 mb-2">
                        <CustomSelect
                          value={addCat}
                          onChange={v => { setAddCat(v); setAddError(""); }}
                          placeholder="Category…"
                          options={availableCats.map(c => ({ value: c, label: c }))}
                          className="flex-1"
                          ariaLabel="Budget category"
                        />
                        <div className="relative flex-shrink-0">
                          <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-xs text-slate-400 whitespace-nowrap">{sym}</span>
                          <input
                            type="number" min="1" placeholder="Limit" value={addLimit}
                            onChange={e => setAddLimit(e.target.value)}
                            onKeyDown={e => { if (e.key === "Enter") handleAddBudget(); }}
                            aria-label="Monthly limit"
                            className={`text-sm bg-slate-50 dark:bg-slate-700 dark:text-slate-100 border border-slate-200 dark:border-slate-600 rounded-xl pr-3 py-2 outline-none focus:ring-2 focus:ring-indigo-500 ${sym.length > 2 ? "w-32 pl-11" : "w-28 pl-7"}`}
                          />
                        </div>
                        <button
                          data-tutorial-id="tutorial-budget-add"
                          onClick={handleAddBudget}
                          className="flex-shrink-0 w-9 h-9 rounded-xl bg-indigo-500 flex items-center justify-center active:scale-90 transition-transform"
                          aria-label="Add limit"
                        >
                          <Plus size={16} color="#fff" />
                        </button>
                      </div>
                      {addError && <p className="text-xs text-red-500 mb-2">{addError}</p>}
                      <button
                        onClick={() => { setShowAddForm(false); setAddCat(""); setAddLimit(""); setAddError(""); }}
                        className="text-xs text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300 transition-colors"
                      >
                        Cancel
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        );
      })()}

      {/* PAST PERIOD / FALLBACK: budget-based view (no trendsActive) */}
      {!pageLoading && !trendsActive && (() => {
        return (
          <>
            {/* Overall-spend summary card */}
            {budgets.length > 0 && (() => {
              const remaining = totalBudget - totalSpent;
              return (
                <div className="px-4 pt-3">
                  <div className="glass-card rounded-2xl p-4">
                    {remaining >= 0 ? (
                      <>
                        <p className="text-[11px] text-slate-500 dark:text-slate-400 mb-0.5">Left in your budget</p>
                        <p className="text-2xl font-bold text-slate-900 dark:text-slate-100 num mb-1">
                          {hideNetWorth ? "••••" : fmt(remaining, sym)}
                        </p>
                        <p className="text-[11px] text-slate-500 dark:text-slate-400 mb-1">
                          {hideNetWorth ? "••••" : `${fmt(totalSpent, sym)} spent of ${fmt(totalBudget, sym)}`}
                        </p>
                        {isCurrentPeriod && daysLeft > 0 && (
                          <p className="text-sm text-slate-500 dark:text-slate-400">
                            {hideNetWorth ? "••••" : fmt2(remaining / Math.max(1, daysLeft), sym)}/day · {daysLeft} days left
                          </p>
                        )}
                        {totalPlanned > 0 && (
                          <p className="text-[11px] text-slate-400 dark:text-slate-500 mt-1">{hideNetWorth ? "••••" : fmt(totalPlanned, sym)} planned</p>
                        )}
                      </>
                    ) : (
                      <>
                        <p className="text-[11px] text-slate-500 dark:text-slate-400 mb-0.5">Over your budget</p>
                        <p className="text-2xl font-bold num mb-1 text-amber-700 dark:text-amber-500">
                          {hideNetWorth ? "••••" : fmt(Math.abs(remaining), sym)} over
                        </p>
                        <p className="text-[11px] text-slate-500 dark:text-slate-400 mb-1">
                          {hideNetWorth ? "••••" : `${fmt(totalSpent, sym)} spent of ${fmt(totalBudget, sym)}`}
                        </p>
                        <p className="text-sm text-amber-700 dark:text-amber-400">
                          {overBudgetCount} {overBudgetCount === 1 ? "category" : "categories"} over budget{hasGenuineRisk ? <>{" "}<span className="text-red-600 dark:text-red-400">· a bill may not clear</span></> : ""}
                        </p>
                        {totalPlanned > 0 && (
                          <p className="text-[11px] text-slate-400 dark:text-slate-500 mt-1">{hideNetWorth ? "••••" : fmt(totalPlanned, sym)} planned</p>
                        )}
                      </>
                    )}
                    <div className="h-2 bg-slate-100 dark:bg-slate-700 rounded-full overflow-hidden mt-3" role="progressbar" aria-valuenow={Math.round(Math.min(overallPct, 100))} aria-valuemin={0} aria-valuemax={100} aria-label="Overall budget used">
                      <div
                        className="h-full rounded-full bar-sweep"
                        style={{ width: `${Math.min(100, overallPct)}%`, backgroundColor: remaining < 0 ? OVER_COLOUR : "#10b981" }}
                      />
                    </div>
                    {remaining >= 0 && overallAheadOfPace && totalBudget > 0 && (
                      <div className="mt-2">
                        <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/50 px-2 py-0.5 rounded-full">On track</span>
                      </div>
                    )}
                  </div>
                </div>
              );
            })()}

            <div className="px-4 pt-4">
              <div className="space-y-3 lg:space-y-0 lg:grid lg:grid-cols-5 lg:gap-4 lg:items-start">
              <div className="space-y-3 lg:col-span-3">
                {/* ── Spend Pacing Curve (opt-in widget) ─────────────────── */}
                {prefsLoaded && widgets.includes("pacing_curve") && paceChartData.length > 1 && budgets.length > 0 && (
                  <div className="glass-card rounded-2xl p-4" {...periodSwipe} style={{ touchAction: "pan-y" }}>
                    <div className="flex items-center justify-between mb-1">
                      <p className="text-base font-bold text-slate-700 dark:text-slate-200">Spending vs budget</p>
                      <button
                        onClick={() => saveBudgetWidgets(widgets.filter(id => id !== "pacing_curve"))}
                        className="text-[11px] text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300 px-2 py-1 rounded-lg active:bg-slate-100 dark:active:bg-slate-700 transition-colors"
                        aria-label="Remove Spending vs budget chart"
                      >
                        Remove
                      </button>
                    </div>
                    <div className="flex flex-wrap gap-x-5 gap-y-1 mb-2">
                      <span className="flex items-center gap-1.5 text-[11px] text-slate-500 dark:text-slate-400">
                        <span className="w-5 h-[2px] bg-indigo-500 inline-block rounded" />
                        Spent so far
                      </span>
                      <span className="flex items-center gap-1.5 text-[11px] text-slate-500 dark:text-slate-400">
                        <svg width="20" height="6" className="inline-block"><line x1="0" y1="3" x2="20" y2="3" stroke="#f59e0b" strokeWidth="1.5" strokeDasharray="4 3"/></svg>
                        Steady pace
                      </span>
                      <span className="flex items-center gap-1.5 text-[11px] text-slate-500 dark:text-slate-400">
                        <svg width="20" height="6" className="inline-block"><line x1="0" y1="3" x2="20" y2="3" stroke="#fb7185" strokeWidth="1.5"/></svg>
                        Your budget
                      </span>
                    </div>

                    <div className="relative" style={{ height: elapsedFraction >= 0.05 ? 52 : 0 }}>
                      {todayPoint?.actual !== null && elapsedFraction >= 0.05 && (
                        <div
                          className="absolute bottom-0 pointer-events-none"
                          style={{
                            left: `calc(44px + ${Math.min(0.88, Math.max(0.1, elapsedFraction))} * (100% - 56px))`,
                            transform: 'translateX(-50%)',
                          }}
                        >
                          <div className={`rounded-xl px-2.5 py-1.5 text-center border whitespace-nowrap shadow-sm ${overallAheadOfPace ? 'bg-emerald-50 dark:bg-emerald-950/60 border-emerald-200 dark:border-emerald-800' : 'bg-amber-50 dark:bg-amber-950/60 border-amber-200 dark:border-amber-800'}`}>
                            <p className={`text-[11px] font-bold leading-tight ${overallAheadOfPace ? 'text-emerald-700 dark:text-emerald-300' : 'text-amber-700 dark:text-amber-300'}`}>
                              {overallAheadOfPace ? "On track" : "Faster than planned"}
                            </p>
                            <p className={`text-[11px] ${overallAheadOfPace ? 'text-emerald-700 dark:text-emerald-400' : 'text-amber-700 dark:text-amber-400'}`}>
                              {hideNetWorth ? "••••" : fmt2(overallPaceGap, sym)} · {daysLeft > 0 ? `${daysLeft}d left` : "Period ended"}
                            </p>
                          </div>
                          <div className={`w-px h-2 mx-auto ${overallAheadOfPace ? 'bg-emerald-300 dark:bg-emerald-700' : 'bg-amber-300 dark:bg-amber-700'}`} />
                        </div>
                      )}
                    </div>

                    <ResponsiveContainer width="100%" height={170}>
                      <ComposedChart data={paceChartData} margin={{ top: 8, right: 8, bottom: 0, left: 4 }}>
                        <defs>
                          <linearGradient id="actualAreaGrad" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor="#6366f1" stopOpacity={0.25} />
                            <stop offset="100%" stopColor="#6366f1" stopOpacity={0.01} />
                          </linearGradient>
                        </defs>
                        <XAxis dataKey="label" tick={{ fontSize: 9, fill: tickFill }} tickLine={false} axisLine={{ stroke: axisStroke }} ticks={chartTicks} />
                        <YAxis tick={{ fontSize: 9, fill: tickFill }} tickLine={false} axisLine={false}
                          tickFormatter={(v: number) => v === 0 ? '' : v >= 1000 ? `${sym}${(v / 1000).toFixed(v >= 10000 ? 0 : 1)}k` : `${sym}${Math.round(v)}`}
                          width={44} domain={[0, Math.max(totalBudget, totalSpent + 1) * 1.12]} />
                        <Tooltip
                          cursor={{ stroke: tickFill, strokeWidth: 1, strokeDasharray: '3 3' }}
                          content={(props: any) => {  // eslint-disable-line @typescript-eslint/no-explicit-any
                            const { active, payload, label } = props;
                            if (!active || !payload?.length) return null;
                            const actual = payload.find((p: any) => p.dataKey === 'actual')?.value;
                            const pace = payload.find((p: any) => p.dataKey === 'pace')?.value;
                            if (actual == null && pace == null) return null;
                            const ahead = actual != null && pace != null && actual <= pace;
                            return (
                              <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl shadow-lg px-3 py-2 text-xs pointer-events-none">
                                <p className="font-semibold text-slate-600 dark:text-slate-300 mb-1.5">{label}</p>
                                {actual != null && <p className="text-indigo-600 dark:text-indigo-400">Spent: {hideNetWorth ? '••••' : fmt2(actual, sym)}</p>}
                                {pace != null && <p className="text-slate-500 dark:text-slate-400">Steady pace: {hideNetWorth ? '••••' : fmt2(pace, sym)}</p>}
                                {actual != null && pace != null && (
                                  <p className={`font-semibold mt-1 ${ahead ? 'text-emerald-700 dark:text-emerald-400' : 'text-amber-700 dark:text-amber-500'}`}>
                                    {ahead ? `${hideNetWorth ? '••••' : fmt2(pace - actual, sym)} under pace` : `${hideNetWorth ? '••••' : fmt2(actual - pace, sym)} faster than planned`}
                                  </p>
                                )}
                              </div>
                            );
                          }}
                        />
                        {/* Past-period budget reference line kept */}
                        <Line type="monotone" dataKey="pace" stroke="#f59e0b" strokeWidth={1.5} strokeDasharray="5 4" dot={false} isAnimationActive={false} />
                        <Area type="monotone" dataKey="actual" stroke="#6366f1" strokeWidth={2.5} fill="url(#actualAreaGrad)" dot={false} connectNulls={false} isAnimationActive={false} />
                        {todayPoint?.actual !== null && elapsedFraction > 0.01 && (
                          <ReferenceDot x={todayPoint!.label} y={todayPoint!.actual ?? 0} r={5} fill="#6366f1" stroke="white" strokeWidth={2} />
                        )}
                      </ComposedChart>
                    </ResponsiveContainer>
                  </div>
                )}

                {/* Add chart button */}
                {prefsLoaded && budgets.length > 0 && (
                  (() => {
                    const CHART_DEFS = [
                      { id: "pacing_curve", title: "Spending vs budget", description: "How your spending tracks against your budget through the period", Icon: TrendingUp },
                      { id: "daily_breakdown", title: "Daily breakdown", description: "Day-by-day spending, fixed vs variable", Icon: BarChart2 },
                    ] as const;
                    const available = CHART_DEFS.filter(c => !widgets.includes(c.id));
                    if (available.length === 0) return null;
                    return (
                      <>
                        <button
                          onClick={() => setChartGalleryOpen(true)}
                          className="w-full flex items-center justify-center gap-1.5 py-3.5 rounded-2xl border-2 border-dashed border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400 text-xs font-semibold active:scale-[0.98] transition-transform"
                        >
                          <Plus size={14} /> Add chart
                        </button>
                        {chartGalleryOpen && (
                          <BudgetChartGallery
                            available={available as any}
                            onAdd={(id: string) => { saveBudgetWidgets([...widgets, id]); setChartGalleryOpen(false); }}
                            onClose={() => setChartGalleryOpen(false)}
                          />
                        )}
                      </>
                    );
                  })()
                )}

                {/* ── Daily Spending Summary ──────────────────────────────── */}
                {prefsLoaded && widgets.includes("daily_breakdown") && paceChartData.some(d => (d.dailySpend ?? 0) > 0) && (() => {
                  const LOG_FLOOR = 0.1;
                  const pastDays = paceChartData
                    .filter(d => d.dailySpend !== null)
                    .map(d => ({ ...d, displaySpend: Math.max(d.dailySpend ?? 0, LOG_FLOOR) }));
                  return (
                    <div className="glass-card rounded-2xl p-4" {...periodSwipe} style={{ touchAction: "pan-y" }}>
                      <div className={`w-full flex items-center justify-between ${showDaily ? "mb-3" : ""}`}>
                        <button onClick={() => setShowDaily(v => !v)} aria-expanded={showDaily} className="flex items-center gap-1.5 flex-1 text-left">
                          <p className="text-base font-bold text-slate-600 dark:text-slate-300">Daily breakdown</p>
                          <ChevronDown size={14} className={`text-slate-500 dark:text-slate-400 transition-transform ${showDaily ? "rotate-180" : ""}`} />
                        </button>
                        <button
                          onClick={() => saveBudgetWidgets(widgets.filter(id => id !== "daily_breakdown"))}
                          className="text-[11px] text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300 px-2 py-1 rounded-lg active:bg-slate-100 dark:active:bg-slate-700 transition-colors"
                          aria-label="Remove Daily breakdown chart"
                        >Remove</button>
                      </div>
                      {showDaily && (
                      <>
                      <ResponsiveContainer width="100%" height={90}>
                        <BarChart data={pastDays} margin={{ top: 4, right: 8, bottom: 0, left: 4 }}>
                          <XAxis dataKey="label" tick={{ fontSize: 8, fill: tickFill }} tickLine={false} axisLine={false} interval={Math.max(0, Math.floor(pastDays.length / 6) - 1)} />
                          <YAxis hide scale="log" domain={[LOG_FLOOR, 'auto']} allowDataOverflow />
                          <Tooltip
                            cursor={{ fill: 'rgba(148,163,184,0.1)' }}
                            content={(props: any) => {  // eslint-disable-line @typescript-eslint/no-explicit-any
                              const { active, payload, label } = props;
                              if (!active || !payload?.length) return null;
                              const entry = payload[0]?.payload;
                              const totalSpend = entry?.dailySpend ?? 0;
                              const varSpend = entry?.variableSpend ?? 0;
                              const varExpected = entry?.variableDailyExpected ?? avgDailyPace;
                              const fixedSpend = totalSpend - varSpend;
                              const abovePace = varSpend > varExpected;
                              return (
                                <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl shadow-lg px-3 py-2 text-xs pointer-events-none space-y-0.5">
                                  <p className="font-semibold text-slate-600 dark:text-slate-300 mb-1">{label}</p>
                                  {fixedSpend > 0.01 && <p className="text-slate-500 dark:text-slate-400">Bills: {hideNetWorth ? '••••' : fmt2(fixedSpend, sym)}</p>}
                                  <p className={varSpend > 0 ? (abovePace ? 'text-orange-600 dark:text-orange-400' : 'text-indigo-600 dark:text-indigo-400') : 'text-slate-400'}>
                                    Variable: {hideNetWorth ? '••••' : fmt2(varSpend, sym)}
                                  </p>
                                  {varExpected > 0.01 && (
                                    <p className="text-slate-500 dark:text-slate-400">
                                      expected {hideNetWorth ? '••••' : fmt2(varExpected, sym)}/day · {abovePace ? `${fmt2(varSpend - varExpected, sym)} over` : `${fmt2(varExpected - varSpend, sym)} under`}
                                    </p>
                                  )}
                                </div>
                              );
                            }}
                          />
                          <Bar dataKey="displaySpend" radius={[2, 2, 0, 0]} maxBarSize={10} isAnimationActive={false}>
                            {pastDays.map((entry, idx) => (
                              <Cell key={idx} fill={(entry.variableSpend ?? 0) > (entry.variableDailyExpected ?? avgDailyPace) ? '#f97316' : '#6366f1'} fillOpacity={(entry.dailySpend ?? 0) <= LOG_FLOOR ? 0.15 : 0.75} />
                            ))}
                          </Bar>
                        </BarChart>
                      </ResponsiveContainer>
                      <div className="flex items-center gap-4 mt-1.5">
                        <span className="flex items-center gap-1.5 text-[11px] text-slate-500 dark:text-slate-400">
                          <svg width="16" height="6"><line x1="0" y1="3" x2="16" y2="3" stroke="#f59e0b" strokeWidth="1.5" strokeDasharray="3 2"/></svg>
                          Variable daily budget
                        </span>
                        <span className="flex items-center gap-1.5 text-[11px] text-slate-500 dark:text-slate-400">
                          <span className="w-2.5 h-2.5 rounded-sm bg-orange-400 inline-block opacity-80" />Variable over
                        </span>
                        <span className="flex items-center gap-1.5 text-[11px] text-slate-500 dark:text-slate-400">
                          <span className="w-2.5 h-2.5 rounded-sm bg-indigo-500 inline-block opacity-75" />Variable under
                        </span>
                      </div>
                      </>
                      )}
                    </div>
                  );
                })()}
              </div>

              <div className="space-y-3 lg:col-span-2">
                {/* Budget cards */}
                {budgets.length === 0 ? (
                  <>
                    <div className="glass-card rounded-2xl p-8 text-center">
                      <p className="text-slate-600 dark:text-slate-300 text-sm font-medium mb-1">No budgets set yet</p>
                      <p className="text-sm text-slate-500 dark:text-slate-400 mb-3">Budgets roll over each pay period automatically once set.</p>
                      <p className="text-sm text-slate-500 dark:text-slate-400">Add a category below or tap the chat button to let AI suggest budgets based on your spending.</p>
                    </div>
                    <div className="glass-card rounded-2xl p-4">
                      <p className="text-base font-bold text-slate-700 dark:text-slate-200 mb-3">Set a budget limit</p>
                      <div className="flex gap-2 mb-2">
                        <CustomSelect value={addCat} onChange={v => { setAddCat(v); setAddError(""); }} placeholder="Category…" options={availableCats.map(c => ({ value: c, label: c }))} className="flex-1" ariaLabel="Budget category" />
                        <div className="relative flex-shrink-0">
                          <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-xs text-slate-400 whitespace-nowrap">{sym}</span>
                          <input type="number" min="1" placeholder="Limit" value={addLimit} onChange={e => setAddLimit(e.target.value)} onKeyDown={e => { if (e.key === "Enter") handleAddBudget(); }} aria-label="Monthly limit" className={`text-sm bg-slate-50 dark:bg-slate-700 dark:text-slate-100 border border-slate-200 dark:border-slate-600 rounded-xl pr-3 py-2 outline-none focus:ring-2 focus:ring-emerald-500 ${sym.length > 2 ? "w-32 pl-11" : "w-28 pl-7"}`} />
                        </div>
                        <button data-tutorial-id="tutorial-budget-add" onClick={handleAddBudget} className="flex-shrink-0 w-9 h-9 rounded-xl bg-emerald-500 flex items-center justify-center active:scale-90 transition-transform" aria-label="Add budget">
                          <Plus size={16} color="#fff" />
                        </button>
                      </div>
                      {addError && <p className="text-xs text-red-500">{addError}</p>}
                    </div>
                  </>
                ) : (
                  <>
                    <p className="text-sm text-slate-500 dark:text-slate-400 px-1">
                      Where it&apos;s going — these limits describe your spending, they don&apos;t decide it.
                    </p>
                    <div className="glass-card rounded-2xl overflow-hidden">
                      <div className="px-4 pt-2.5 pb-1">
                        <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-100 dark:border-blue-900/40 rounded-lg px-3 py-2">
                          <p className="text-[11px] text-slate-600 dark:text-slate-300">
                            <Flag size={12} className="inline mb-0.5 text-blue-500 dark:text-blue-400 mr-1" />Flag a transaction as planned if you budgeted for it separately — it won&apos;t count towards the total.
                          </p>
                        </div>
                      </div>
                      {[...budgets].sort((a, b) => {
                        const overspendA = (spending[a.category] ?? 0) - a.monthly_limit;
                        const overspendB = (spending[b.category] ?? 0) - b.monthly_limit;
                        if (overspendA > 0 && overspendB > 0) return overspendB - overspendA;
                        if (overspendA > 0) return -1;
                        if (overspendB > 0) return 1;
                        return 0;
                      }).map((b, i) => {
                        const spent = spending[b.category] ?? 0;
                        const over = spent > b.monthly_limit;
                        const colour = colours[b.category] ?? CATEGORY_COLOURS[b.category as keyof typeof CATEGORY_COLOURS] ?? CATEGORY_COLOURS.Other;
                        const txns = categoryTxns[b.category] ?? [];
                        const isExpanded = expandedCat === b.category;
                        const curve = paceProfile[b.category];
                        const expectedFraction = curve ? interpolateCurve(curve, elapsedFraction) : elapsedFraction;
                        const paceGap = (expectedFraction * b.monthly_limit) - spent;
                        const aheadOfPace = !over && paceGap >= 0;
                        return (
                          <SwipeToDelete key={b.category} onDelete={() => requestDelete(b.category)} label="Delete">
                          <div className={`relative${i > 0 ? " border-t border-slate-50 dark:border-slate-700" : ""}`}>
                            <button
                              onClick={() => setExpandedCat(isExpanded ? null : b.category)}
                              className="w-full px-4 pt-3 pb-3 text-left"
                              aria-expanded={isExpanded}
                              aria-controls={`budget-txns-${b.category}`}
                              aria-label={b.monthly_limit === 0 ? `${b.category}: no limit set` : over ? `${b.category}: ${fmt2(spent - b.monthly_limit, sym)} over budget of ${fmt2(b.monthly_limit, sym)}` : `${b.category}: ${fmt2(b.monthly_limit - spent, sym)} left of ${fmt2(b.monthly_limit, sym)}`}
                            >
                              <div className="flex items-center gap-2.5 pr-14">
                                <div className="flex items-center gap-2.5 min-w-0 flex-1">
                                  {(() => {
                                    const Icon = getCategoryIcon(b.category, iconOverrides);
                                    return (
                                      <span className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0" style={{ backgroundColor: `${colour}26` }}>
                                        <Icon size={15} style={{ color: colour }} />
                                      </span>
                                    );
                                  })()}
                                  <div className="min-w-0">
                                    <span className="text-sm font-semibold text-slate-800 dark:text-slate-100 truncate block">{b.category}</span>
                                    <span className="text-[11px] text-slate-500 dark:text-slate-400 tabular-nums flex items-center gap-1 flex-wrap">
                                      {hideNetWorth ? "••••" : b.monthly_limit === 0 ? (
                                        <span className="text-slate-400 dark:text-slate-500 italic">No limit set</span>
                                      ) : (
                                        <>{fmt2(spent, sym)} of{" "}
                                          <button onClick={e => { e.stopPropagation(); setBudgetSheetCat(b.category); }} className="underline decoration-dotted underline-offset-2 text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 transition-colors" aria-label={`Edit ${b.category} budget limit`}>
                                            {fmt2(b.monthly_limit, sym)}
                                          </button>
                                        </>
                                      )}
                                    </span>
                                  </div>
                                </div>
                                <div className="flex-shrink-0 text-right">
                                  {b.monthly_limit === 0 ? (
                                    <button onClick={e => { e.stopPropagation(); setBudgetSheetCat(b.category); }} className="text-[11px] text-indigo-500 dark:text-indigo-400 font-medium underline decoration-dotted underline-offset-2" aria-label={`Set ${b.category} budget limit`}>Set limit</button>
                                  ) : over ? (
                                    <span className="text-base font-bold tabular-nums text-amber-600 dark:text-amber-500">
                                      {hideNetWorth ? "••••" : `${fmt(spent - b.monthly_limit, sym)} over`}
                                    </span>
                                  ) : !aheadOfPace && elapsedFraction >= 0.05 && elapsedFraction < 1 ? (
                                    <span className="text-base font-bold tabular-nums text-slate-600 dark:text-slate-300">
                                      {hideNetWorth ? "••••" : `${fmt(b.monthly_limit - spent, sym)} left`}
                                    </span>
                                  ) : (
                                    <span className="text-base font-bold tabular-nums text-slate-700 dark:text-slate-200">
                                      {hideNetWorth ? "••••" : `${fmt(b.monthly_limit - spent, sym)} left`}
                                    </span>
                                  )}
                                </div>
                              </div>
                            </button>
                            <div className="absolute top-3 right-4 flex items-center gap-1.5">
                              <button onClick={() => setExpandedCat(isExpanded ? null : b.category)} className="w-11 h-11 flex items-center justify-center rounded-full active:bg-slate-100 dark:active:bg-slate-700" aria-label={isExpanded ? `Collapse ${b.category}` : `Expand ${b.category}`} aria-expanded={isExpanded} aria-controls={`budget-txns-${b.category}`}>
                                <ChevronDown size={14} className={`text-slate-500 dark:text-slate-400 transition-transform duration-200 ${isExpanded ? "rotate-180" : ""}`} />
                              </button>
                            </div>
                            {isExpanded && (
                              <div id={`budget-txns-${b.category}`} className="border-t border-slate-50 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-700/20">
                                {txns.length === 0 ? (
                                  <p className="text-xs text-slate-500 dark:text-slate-400 text-center py-4">No transactions this period</p>
                                ) : (
                                  <div className="max-h-56 overflow-y-auto">
                                    {txns.map(tx => (
                                      <div key={tx.id} className="flex items-center justify-between px-4 py-2 border-b border-slate-100/60 dark:border-slate-700/40 last:border-0">
                                        <div className="min-w-0 flex-1">
                                          <p className={`text-xs font-medium truncate ${tx.planned ? "text-slate-500 dark:text-slate-400 line-through" : "text-slate-700 dark:text-slate-200"}`}>{tx.merchant_name || tx.description}</p>
                                          <p className="text-[11px] text-slate-500 dark:text-slate-400">{formatDate(tx.date)}</p>
                                        </div>
                                        <div className="flex items-center gap-2 flex-shrink-0 ml-3">
                                          <span className={`text-xs font-semibold ${tx.planned ? "text-slate-400 line-through" : tx.transaction_type === "credit" ? "text-emerald-500" : "text-red-600"}`}>
                                            {hideNetWorth ? "••••" : `${tx.transaction_type === "credit" ? "+" : "-"}${fmt2(Math.abs(tx.amount), sym)}`}
                                          </span>
                                          {tx.transaction_type === "credit" ? (
                                            <span className="w-7 h-7 flex-shrink-0" />
                                          ) : (
                                            <button onClick={() => handleTransactionPlanned(tx.id, !!tx.planned)} className={`w-9 h-9 flex items-center justify-center rounded-full transition-colors flex-shrink-0 ${tx.planned ? "bg-blue-100 dark:bg-blue-900/40 text-blue-500" : "bg-slate-100 dark:bg-slate-700 text-blue-400 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/30 hover:text-blue-500 dark:hover:text-blue-300"}`} aria-label={`${tx.planned ? "Unmark" : "Mark"} ${tx.merchant_name || tx.description} as planned`}>
                                              <Flag size={12} className={tx.planned ? "fill-blue-400 text-blue-500" : ""} />
                                            </button>
                                          )}
                                        </div>
                                      </div>
                                    ))}
                                  </div>
                                )}
                                <div className="px-4 pt-1 pb-3">
                                  <button onClick={() => requestDelete(b.category)} className="w-full flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-sm font-semibold text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors" aria-label={`Remove ${b.category} budget`}>
                                    <Trash2 size={14} /> Remove this budget
                                  </button>
                                </div>
                              </div>
                            )}
                          </div>
                          </SwipeToDelete>
                        );
                      })}
                    </div>

                    {!showAddForm ? (availableCats.length > 0 ? (
                      <button data-tutorial-id="tutorial-budget-form" onClick={() => setShowAddForm(true)} className="w-full flex items-center justify-center gap-1.5 py-3 rounded-2xl border border-dashed border-slate-300 dark:border-slate-600 text-sm font-semibold text-slate-500 dark:text-slate-400 hover:border-emerald-400 hover:text-emerald-600 dark:hover:text-emerald-400 active:scale-[0.99] transition-all">
                        <Plus size={15} /> Add a budget
                      </button>
                    ) : null) : (
                      <div className="glass-card rounded-2xl p-4">
                        <p className="text-base font-bold text-slate-700 dark:text-slate-200 mb-3">Set a budget limit</p>
                        <div className="flex gap-2 mb-2">
                          <CustomSelect value={addCat} onChange={v => { setAddCat(v); setAddError(""); }} placeholder="Category…" options={availableCats.map(c => ({ value: c, label: c }))} className="flex-1" ariaLabel="Budget category" />
                          <div className="relative flex-shrink-0">
                            <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-xs text-slate-400 whitespace-nowrap">{sym}</span>
                            <input type="number" min="1" placeholder="Limit" value={addLimit} onChange={e => setAddLimit(e.target.value)} onKeyDown={e => { if (e.key === "Enter") handleAddBudget(); }} aria-label="Monthly limit" className={`text-sm bg-slate-50 dark:bg-slate-700 dark:text-slate-100 border border-slate-200 dark:border-slate-600 rounded-xl pr-3 py-2 outline-none focus:ring-2 focus:ring-emerald-500 ${sym.length > 2 ? "w-32 pl-11" : "w-28 pl-7"}`} />
                          </div>
                          <button data-tutorial-id="tutorial-budget-add" onClick={handleAddBudget} className="flex-shrink-0 w-9 h-9 rounded-xl bg-emerald-500 flex items-center justify-center active:scale-90 transition-transform" aria-label="Add budget">
                            <Plus size={16} color="#fff" />
                          </button>
                        </div>
                        {addError && <p className="text-xs text-red-500 mb-2">{addError}</p>}
                        <button onClick={() => { setShowAddForm(false); setAddCat(""); setAddLimit(""); setAddError(""); }} className="text-xs text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300 transition-colors">Cancel</button>
                      </div>
                    )}
                  </>
                )}
              </div>
              </div>
            </div>
          </>
        );
      })()}

      {/* Loading state */}
      {pageLoading && (
        <div className="px-4 pt-8 flex items-center justify-center py-16">
          <Spinner size={32} />
        </div>
      )}

      {/* AI Chat button */}
      <button
        data-tutorial-id="tutorial-budget-chat"
        onClick={() => setChatOpen(true)}
        className="fixed z-[60] flex items-center justify-center w-14 h-14 rounded-full shadow-xl ring-2 ring-white/40 dark:ring-white/25 text-white"
        style={{ bottom: "calc(88px + env(safe-area-inset-bottom, 0px))", right: "16px", background: BRAND_GRADIENT }}
        aria-label="Chat with Penny"
      >
        <MessageCircle className="w-6 h-6" />
      </button>

      {/* AI Chat panel */}
      {chatOpen && (
        <>
        <ChatScrollLock />
        <div
          ref={chatPanelRef}
          role="dialog"
          aria-modal="true"
          aria-label="Budget chat with Penny"
          className="fixed z-[60] bg-white dark:bg-slate-800 rounded-2xl shadow-xl flex flex-col overflow-hidden"
          style={{ bottom: "calc(88px + env(safe-area-inset-bottom, 0px))", right: "16px", width: "340px", maxWidth: "calc(100vw - 32px)", height: "480px" }}
        >
          <div className="flex items-center justify-between px-4 py-3 text-white flex-shrink-0" style={{ background: BRAND_GRADIENT }}>
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-full bg-white/20 backdrop-blur flex items-center justify-center flex-shrink-0">
                <Sparkles className="w-4 h-4" />
              </div>
              <div>
                <p className="text-sm font-bold">Penny</p>
                <p className="text-[11px] opacity-70">Budget help · Powered by Claude</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={async () => {
                  try {
                    const { session_id } = await api.newBudgetChatSession();
                    setSessionId(session_id);
                    chatInitialised.current = false;
                    setMessages([{ role: "assistant", content: `Fresh start! Say "suggest a budget" and I'll analyse your spending to create one.` }]);
                  } catch {}
                }}
                aria-label="New chat"
                className="w-9 h-9 flex items-center justify-center rounded-full opacity-70 hover:opacity-100 transition-opacity"
              >
                <RotateCcw className="w-4 h-4" />
              </button>
              <button onClick={() => setChatOpen(false)} aria-label="Close" className="w-9 h-9 flex items-center justify-center rounded-full opacity-80 hover:opacity-100 transition-opacity">
                <X className="w-5 h-5" />
              </button>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto px-3 py-3 space-y-2">
            {messages.map((msg, i) => (
              <div key={i} className={`flex flex-col ${msg.role === "user" ? "items-end" : "items-start"}`}>
                <div className={`max-w-[80%] px-3 py-2 rounded-2xl text-sm leading-relaxed ${msg.role === "user" ? "text-white rounded-br-sm" : "bg-slate-100 dark:bg-slate-700 text-slate-800 dark:text-slate-100 rounded-bl-sm"}`} style={msg.role === "user" ? { background: BRAND } : undefined}>
                  {msg.role === "assistant" ? <ChatMarkdown>{cleanReply(msg.content)}</ChatMarkdown> : cleanReply(msg.content)}
                </div>
                {msg.suggestedBudgets && msg.suggestedBudgets.length > 0 && (
                  <ApplyBudgetCard budgets={msg.suggestedBudgets} colours={colours} sym={sym} onApply={() => applyBudgets(msg.suggestedBudgets!)} />
                )}
              </div>
            ))}
            {chatLoading && (
              <div className="flex justify-start">
                <div className="bg-slate-100 dark:bg-slate-700 rounded-2xl rounded-bl-sm px-4 py-3 flex items-center gap-1">
                  {[0, 150, 300].map(d => <span key={d} className="w-1.5 h-1.5 bg-slate-400 rounded-full animate-bounce" style={{ animationDelay: `${d}ms` }} />)}
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          <div className="flex-shrink-0 flex items-center gap-2 px-3 py-2 border-t border-slate-100 dark:border-slate-700">
            <input
              ref={chatInputRef}
              className="flex-1 text-sm bg-slate-50 dark:bg-slate-700 dark:text-slate-100 rounded-full px-4 py-2 outline-none border border-slate-200 dark:border-slate-600 focus:ring-2 focus:ring-indigo-500"
              placeholder="Ask about your budget…"
              value={inputText}
              onChange={e => setInputText(e.target.value)}
              onKeyDown={handleKeyDown}
              disabled={chatLoading}
            />
            <button onClick={sendMessage} disabled={!inputText.trim() || chatLoading} className="flex-shrink-0 w-9 h-9 rounded-full flex items-center justify-center disabled:opacity-40 text-white" style={{ background: BRAND_GRADIENT }} aria-label="Send">
              {chatLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            </button>
          </div>
        </div>
        </>
      )}

      {/* Undo snackbar */}
      {undoBudget && (
        <div key={undoNonce} className="fixed left-4 right-4 z-[70] pointer-events-none" style={{ bottom: "calc(96px + env(safe-area-inset-bottom, 0px))" }}>
          <div className="pointer-events-auto bg-slate-900/95 dark:bg-slate-100/95 backdrop-blur rounded-xl shadow-lg overflow-hidden">
            <div className="flex items-center justify-between gap-3 pl-4 pr-2 min-h-[48px]">
              <p className="text-sm font-medium text-white dark:text-slate-900">Budget removed</p>
              <button onClick={undoDelete} className="text-sm font-bold text-indigo-300 dark:text-indigo-600 rounded-lg px-4 min-h-[44px] active:bg-white/10 dark:active:bg-slate-900/10">Undo</button>
            </div>
            <div className="h-[3px] bg-indigo-400/90" style={{ animation: "wdCountdown 6s linear forwards" }} />
          </div>
        </div>
      )}

      {/* Budget limit sheet */}
      {budgetSheetCat && (() => {
        const b = budgets.find(bud => bud.category === budgetSheetCat);
        if (!b) return null;
        const colour = colours[b.category] ?? CATEGORY_COLOURS[b.category as keyof typeof CATEGORY_COLOURS] ?? CATEGORY_COLOURS.Other;
        const Icon = getCategoryIcon(b.category, iconOverrides);
        const spent = spending[b.category] ?? 0;
        return (
          <BudgetLimitSheet
            category={b.category}
            colour={colour}
            icon={Icon}
            spent={spent}
            currentLimit={b.monthly_limit}
            sym={sym}
            onClose={() => setBudgetSheetCat(null)}
            onSave={(v) => { handleUpdateLimit(b.category, String(v)); setBudgetSheetCat(null); }}
          />
        );
      })()}

      {/* Category sheet — from Your Choices rows */}
      {openCategory && (
        <CategorySheet
          name={openCategory.name}
          total={openCategory.total}
          count={openCategory.count}
          transactions={openCategory.transactions}
          sym={sym}
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
        />
      )}

      <BottomNav />
    </div>
  );
}

function BudgetChartGallery({ available, onAdd, onClose }: {
  available: Array<{ id: string; title: string; description: string; Icon: React.ComponentType<{ size?: number; className?: string }> }>;
  onAdd: (id: string) => void;
  onClose: () => void;
}) {
  useLockBodyScroll();
  const panelRef = useSheetA11y<HTMLDivElement>(onClose);
  return (
    <>
      <div className="fixed inset-0 bg-black/40 z-[65]" onClick={onClose} />
      <div ref={panelRef} role="dialog" aria-modal="true" aria-label="Add a chart" className="fixed bottom-0 left-1/2 -translate-x-1/2 w-full max-w-[430px] lg:max-w-md lg:bottom-auto lg:top-1/2 lg:-translate-y-1/2 bg-white dark:bg-slate-800 rounded-t-3xl lg:rounded-3xl z-[70] max-h-[88vh] overflow-y-auto p-5 pb-[calc(2rem+env(safe-area-inset-bottom))] lg:pb-5">
        <p className="text-base font-bold text-slate-900 dark:text-slate-100 mb-1">Add a chart</p>
        <p className="text-sm text-slate-500 dark:text-slate-400 mb-4">Charts use the pay period you&apos;re viewing.</p>
        <div className="space-y-2">
          {available.map(({ id, title, description, Icon }) => (
            <button key={id} onClick={() => onAdd(id)} className="w-full flex items-center gap-3 p-3 rounded-2xl bg-slate-50 dark:bg-slate-700/50 active:scale-[0.98] transition-transform text-left">
              <span className="w-9 h-9 rounded-xl bg-indigo-50 dark:bg-indigo-900/30 flex items-center justify-center flex-shrink-0">
                <Icon size={16} className="text-indigo-500 dark:text-indigo-400" />
              </span>
              <span className="flex-1 min-w-0">
                <span className="block text-sm font-semibold text-slate-800 dark:text-slate-100">{title}</span>
                <span className="block text-[11px] text-slate-500 dark:text-slate-400">{description}</span>
              </span>
              <Plus size={15} className="text-slate-300 dark:text-slate-500 flex-shrink-0" />
            </button>
          ))}
        </div>
      </div>
    </>
  );
}

function ApplyBudgetCard({
  budgets, colours, sym, onApply,
}: {
  budgets: Budget[];
  colours: Record<string, string>;
  sym: string;
  onApply: () => Promise<void>;
}) {
  const [applied, setApplied] = useState(false);
  const [applying, setApplying] = useState(false);

  async function handle() {
    if (applied || applying) return;
    setApplying(true);
    await onApply();
    setApplied(true);
    setApplying(false);
  }

  return (
    <div className="mt-1.5 max-w-[80%] bg-white dark:bg-slate-800 border border-slate-100 dark:border-slate-600 rounded-2xl rounded-tl-sm overflow-hidden shadow-sm">
      <div className="px-3 pt-2.5 pb-1.5 border-b border-slate-100 dark:border-slate-700">
        <p className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide">Suggested Budget</p>
      </div>
      <div className="px-3 py-1.5 space-y-1">
        {budgets.map(b => {
          const colour = colours[b.category] ?? CATEGORY_COLOURS[b.category as keyof typeof CATEGORY_COLOURS] ?? CATEGORY_COLOURS.Other;
          return (
            <div key={b.category} className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-1.5 min-w-0">
                <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: colour }} />
                <span className="text-xs text-slate-700 dark:text-slate-200 truncate">{b.category}</span>
              </div>
              <span className="text-xs font-semibold text-slate-900 dark:text-slate-100 flex-shrink-0">{sym}{b.monthly_limit}/mo</span>
            </div>
          );
        })}
      </div>
      <div className="px-3 pb-3 pt-2">
        <button
          onClick={handle}
          disabled={applied || applying}
          className={`w-full py-2 rounded-xl text-sm font-semibold transition-all active:scale-95 ${applied ? "bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400" : "text-white"}`}
          style={applied ? undefined : { background: BRAND_GRADIENT }}
        >
          {applied ? "✓ Budget applied" : applying ? "Applying…" : "Apply this budget"}
        </button>
      </div>
    </div>
  );
}
