"use client";

import { useEffect, useState, useCallback, useRef, useMemo } from "react";
import { MessageCircle, X, Send, Loader2, Plus, Trash2, RotateCcw, Target, ChevronDown, Flag, ChevronLeft, ChevronRight } from "lucide-react";
import { ComposedChart, Area, Line, BarChart, Bar, Cell, Tooltip, ResponsiveContainer, XAxis, YAxis, ReferenceLine, ReferenceDot } from "recharts";
import { api } from "@/lib/api";
import { useAuth } from "@/components/AuthProvider";
import { useColours } from "@/components/ColourProvider";
import { useCategories } from "@/components/CategoriesContext";
import { usePreferences } from "@/components/PreferencesContext";
import { CATEGORY_COLOURS } from "@/lib/categories";
import BottomNav from "@/components/BottomNav";
import Spinner from "@/components/Spinner";
import { getPayPeriodWithConfig, filterPeriod, formatDate, formatPeriod, prevPeriodWithConfig, nextPeriodWithConfig } from "@/lib/payPeriod";
import type { Transaction } from "@/lib/api";

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

const SKIP = new Set(["Transfer", "Savings", "Debt", "Income"]);

export default function BudgetPage() {
  const { user } = useAuth();
  const { colours } = useColours();
  const { allCategories } = useCategories();
  const { region, hideNetWorth, payPeriodConfig } = usePreferences();
  const sym = region === "Kenya" ? "KES " : "£";
  const firstName = user?.name?.split(" ")[0] || "there";

  const [budgets, setBudgets] = useState<Budget[]>([]);
  const [paceProfile, setPaceProfile] = useState<Record<string, number[]>>({});
  const [allTransactions, setAllTransactions] = useState<Transaction[]>([]);
  const [periodStart, setPeriodStart] = useState<Date>(() => getPayPeriodWithConfig(new Date(), { type: "calendar_month" })[0]);
  const [periodEnd, setPeriodEnd] = useState<Date>(() => getPayPeriodWithConfig(new Date(), { type: "calendar_month" })[1]);
  const allPeriodTxns = useMemo(
    () => filterPeriod(allTransactions, periodStart, periodEnd),
    [allTransactions, periodStart, periodEnd]
  );
  const [loading, setLoading] = useState(true);
  const [expandedCat, setExpandedCat] = useState<string | null>(null);

  // Add budget form
  const [addCat, setAddCat] = useState("");
  const [addLimit, setAddLimit] = useState("");
  const [addError, setAddError] = useState("");

  // Chat state
  const [chatOpen, setChatOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputText, setInputText] = useState("");
  const [chatLoading, setChatLoading] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const chatInitialised = useRef(false);
  const touchStartX = useRef<number | null>(null);
  const touchStartY = useRef<number | null>(null);

  const load = useCallback(async () => {
    try {
      const [{ budgets: b }, accs, profile] = await Promise.all([
        api.getBudgets(),
        api.accounts().catch(() => []),
        api.budgetPaceProfile().catch(() => ({ curves: {}, sample_points: 20, periods_analysed: 0 })),
      ]);
      setPaceProfile(profile.curves);
      setBudgets(b);

      const allTxns: Transaction[] = [];
      await Promise.all(accs.map(async acc => {
        try {
          const txns = await api.transactions(acc.id);
          allTxns.push(...txns);
        } catch {}
      }));

      setAllTransactions(allTxns);
    } catch {}
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    const [s, e] = getPayPeriodWithConfig(new Date(), payPeriodConfig);
    setPeriodStart(s);
    setPeriodEnd(e);
  }, [JSON.stringify(payPeriodConfig)]); // eslint-disable-line react-hooks/exhaustive-deps

  const { spending, categoryTxns } = useMemo(() => {
    const spendMap: Record<string, number> = {};
    const txnMap: Record<string, Transaction[]> = {};
    for (const tx of allPeriodTxns) {
      if (tx.transaction_type !== "debit") continue;
      const cat = tx.category || "Other";
      if (SKIP.has(cat)) continue;
      txnMap[cat] = txnMap[cat] ?? [];
      txnMap[cat].push(tx);
      if (!tx.planned) {
        spendMap[cat] = (spendMap[cat] ?? 0) + Math.abs(tx.amount);
      }
    }
    for (const cat of Object.keys(txnMap)) {
      txnMap[cat].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
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

  function handleChartTouchStart(e: React.TouchEvent) {
    touchStartX.current = e.touches[0].clientX;
    touchStartY.current = e.touches[0].clientY;
  }

  function handleChartTouchEnd(e: React.TouchEvent) {
    if (touchStartX.current === null || touchStartY.current === null) return;
    const dx = e.changedTouches[0].clientX - touchStartX.current;
    const dy = e.changedTouches[0].clientY - touchStartY.current;
    touchStartX.current = null;
    touchStartY.current = null;
    // Only respond to clearly horizontal swipes (dx dominates, at least 50px)
    if (Math.abs(dx) < 50 || Math.abs(dx) < Math.abs(dy)) return;
    if (dx > 0) {
      // Swipe right → previous period
      const [s, en] = prevPeriodWithConfig(periodStart, payPeriodConfig);
      setPeriodStart(s); setPeriodEnd(en);
    } else {
      // Swipe left → next period, guarded at current period
      const [cs] = getPayPeriodWithConfig(new Date(), payPeriodConfig);
      if (periodStart >= cs) return;
      const [s, en] = nextPeriodWithConfig(periodEnd, payPeriodConfig);
      setPeriodStart(s); setPeriodEnd(en);
    }
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
  }

  async function handleRemove(cat: string) {
    const next = budgets.filter(b => b.category !== cat);
    setBudgets(next);
    await api.setBudgets(next).catch(() => {});
  }

  async function applyBudgets(suggested: Budget[]) {
    await api.setBudgets(suggested);
    setBudgets(suggested);
    await load();
  }

  function cleanReply(text: string) {
    return text.replace(/```budgets[\s\S]*?```/g, "").trim();
  }

  const availableCats = allCategories.filter(c => !SKIP.has(c));

  const totalBudget = budgets.reduce((s, b) => s + b.monthly_limit, 0);
  const totalSpent = budgets.reduce((s, b) => s + (spending[b.category] ?? 0), 0);
  const overallPct = totalBudget > 0 ? Math.min(100, (totalSpent / totalBudget) * 100) : 0;
  const overBudgetCount = budgets.filter(b => (spending[b.category] ?? 0) > b.monthly_limit).length;

  // How far through the current pay period are we (linear fraction)?
  const _today = new Date();
  const _totalMs = Math.max(1, periodEnd.getTime() - periodStart.getTime());
  const _elapsedMs = Math.min(_totalMs, Math.max(0, _today.getTime() - periodStart.getTime()));
  const elapsedFraction = _elapsedMs / _totalMs;
  const periodPacePct = elapsedFraction * 100;

  // Auto-detect "fixed" categories (bills, subscriptions) from the pace profile.
  // If more than 50% of a category's historical spending lands in the first ~10% of the
  // period (curve point index 1 > 0.5), it's lumpy/front-loaded = fixed.
  // Fixed categories are excluded from the daily variable-spend comparison so bills days
  // don't falsely show as "over pace."
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
  // Each category's paceProfile curve is weighted by its budget limit.
  // Result is a 21-point cumulative curve (0→1) representing when spending typically happens.
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

  // Data for the cumulative spend chart and daily summary.
  const paceChartData = useMemo(() => {
    if (budgets.length === 0 || totalBudget === 0) return [];
    const periodDays = Math.round((periodEnd.getTime() - periodStart.getTime()) / 86400000) + 1;
    const todayEnd = new Date(); todayEnd.setHours(23, 59, 59, 999);
    // Total spend per day (all categories, for cumulative chart)
    const spendByDay: Record<string, number> = {};
    // Variable spend per day (excluding fixed/bills, for daily bar coloring)
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
      // Historical cumulative pace for the total budget (non-linear, accounts for bills timing)
      const currFrac = i / Math.max(1, periodDays - 1);
      const prevFrac = i === 0 ? 0 : (i - 1) / Math.max(1, periodDays - 1);
      const currHistFrac = combinedPaceCurve ? interpolateCurve(combinedPaceCurve, currFrac) : currFrac;
      const pace = totalBudget * currHistFrac;
      // Variable spend for this day (for bar coloring — excludes fixed categories)
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

  return (
    <div className="min-h-dvh bg-[#f0f2f7] dark:bg-[#0f172a] pb-24 lg:pb-8 lg:max-w-6xl lg:mx-auto">
      {/* Header */}
      <div className="px-4 pt-6 pb-5 text-white"
        style={{ background: "linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%)" }}>
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold">Budgets</h1>
            {user && <p className="text-sm opacity-80 mt-0.5">Hi {firstName},</p>}
          </div>
          <Target className="w-7 h-7 opacity-60" />
        </div>
        {!loading && budgets.length > 0 && (
          <div className="mt-4">
            <div className="flex justify-between text-xs mb-1.5">
              <span className="opacity-70">
                {hideNetWorth ? "••••" : fmt(totalSpent, sym)} spent
                {totalPlanned > 0 && <span className="ml-1 text-white/50">· {hideNetWorth ? "••••" : fmt(totalPlanned, sym)} planned</span>}
                {overBudgetCount > 0 && <span className="ml-1 text-red-300">· {overBudgetCount} over</span>}
              </span>
              <span className="font-semibold">{hideNetWorth ? "••••" : fmt(totalBudget, sym)} total</span>
            </div>
            <div className="h-2 bg-white/20 rounded-full overflow-hidden">
              <div
                className="h-full rounded-full transition-all"
                style={{ width: `${overallPct}%`, backgroundColor: overBudgetCount > 0 ? "#fca5a5" : "#fff" }}
              />
            </div>
            <div className="flex justify-between mt-1 text-[10px] opacity-60">
              <span>{Math.round(overallPct)}% used this pay period</span>
            </div>
          </div>
        )}
      </div>

      <div className="px-4 pt-4 space-y-3">
        {loading ? (
          <div className="flex items-center justify-center py-16"><Spinner size={32} /></div>
        ) : (
          <>
            {/* ── Pay Period navigator (top of page) ───────────────────── */}
            <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-sm px-4 py-3">
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide">Pay Period</p>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => { const [s, e] = prevPeriodWithConfig(periodStart, payPeriodConfig); setPeriodStart(s); setPeriodEnd(e); }}
                    className="w-7 h-7 flex items-center justify-center rounded-full bg-slate-100 dark:bg-slate-700 active:bg-slate-200"
                  ><ChevronLeft size={13} color="#94a3b8" /></button>
                  <span className="text-xs text-slate-600 dark:text-slate-300 font-medium min-w-[100px] text-center">{formatPeriod(periodStart, periodEnd)}</span>
                  <button
                    onClick={() => { const [s, e] = nextPeriodWithConfig(periodEnd, payPeriodConfig); const [cs] = getPayPeriodWithConfig(new Date(), payPeriodConfig); if (s.getTime() <= cs.getTime()) { setPeriodStart(s); setPeriodEnd(e); } }}
                    disabled={periodStart >= getPayPeriodWithConfig(new Date(), payPeriodConfig)[0]}
                    className="w-7 h-7 flex items-center justify-center rounded-full bg-slate-100 dark:bg-slate-700 active:bg-slate-200 disabled:opacity-30"
                  ><ChevronRight size={13} color="#94a3b8" /></button>
                </div>
              </div>
            </div>

            {/* ── Add budget form ───────────────────────────────────────── */}
            <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-sm p-4">
              <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-3">Add / Update Budget</p>
              <div className="flex gap-2 mb-2">
                <select
                  value={addCat}
                  onChange={e => { setAddCat(e.target.value); setAddError(""); }}
                  className="flex-1 text-sm bg-slate-50 dark:bg-slate-700 dark:text-slate-100 border border-slate-200 dark:border-slate-600 rounded-xl px-3 py-2 outline-none focus:ring-2 focus:ring-emerald-500 appearance-none"
                >
                  <option value="">Category…</option>
                  {availableCats.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
                <div className="relative flex-shrink-0">
                  <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-xs text-slate-400 whitespace-nowrap">{sym}</span>
                  <input
                    type="number" min="1" placeholder="Limit" value={addLimit}
                    onChange={e => setAddLimit(e.target.value)}
                    onKeyDown={e => { if (e.key === "Enter") handleAddBudget(); }}
                    className={`text-sm bg-slate-50 dark:bg-slate-700 dark:text-slate-100 border border-slate-200 dark:border-slate-600 rounded-xl pr-3 py-2 outline-none focus:ring-2 focus:ring-emerald-500 ${sym.length > 2 ? "w-32 pl-11" : "w-28 pl-7"}`}
                  />
                </div>
                <button
                  onClick={handleAddBudget}
                  className="flex-shrink-0 w-9 h-9 rounded-xl bg-emerald-500 flex items-center justify-center active:scale-90 transition-transform"
                >
                  <Plus size={16} color="#fff" />
                </button>
              </div>
              {addError && <p className="text-xs text-red-500">{addError}</p>}
            </div>

            {/* ── Spend Pacing Curve ────────────────────────────────────── */}
            {paceChartData.length > 1 && budgets.length > 0 && (
              <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-sm p-4"
                onTouchStart={handleChartTouchStart} onTouchEnd={handleChartTouchEnd}>
                <div className="flex items-center justify-between mb-1">
                  <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">Spend Pacing Curve</p>
                </div>
                <div className="flex flex-wrap gap-x-5 gap-y-1 mb-2">
                  <span className="flex items-center gap-1.5 text-[10px] text-slate-500 dark:text-slate-400">
                    <span className="w-5 h-[2px] bg-indigo-500 inline-block rounded" />
                    Actual Spending
                  </span>
                  <span className="flex items-center gap-1.5 text-[10px] text-slate-500 dark:text-slate-400">
                    <svg width="20" height="6" className="inline-block"><line x1="0" y1="3" x2="20" y2="3" stroke="#f59e0b" strokeWidth="1.5" strokeDasharray="4 3"/></svg>
                    Target Pacing
                  </span>
                  <span className="flex items-center gap-1.5 text-[10px] text-slate-500 dark:text-slate-400">
                    <svg width="20" height="6" className="inline-block"><line x1="0" y1="3" x2="20" y2="3" stroke="#fb7185" strokeWidth="1.5"/></svg>
                    Budget Limit
                  </span>
                </div>

                {/* Annotation callout above chart */}
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
                        <p className={`text-[10px] font-bold leading-tight ${overallAheadOfPace ? 'text-emerald-700 dark:text-emerald-300' : 'text-amber-700 dark:text-amber-300'}`}>
                          {overallAheadOfPace ? "Ahead of Pace" : "Above Pace"}
                        </p>
                        <p className={`text-[9px] ${overallAheadOfPace ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400'}`}>
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
                    <XAxis
                      dataKey="label"
                      tick={{ fontSize: 9, fill: '#94a3b8' }}
                      tickLine={false}
                      axisLine={{ stroke: '#e2e8f0' }}
                      ticks={chartTicks}
                    />
                    <YAxis
                      tick={{ fontSize: 9, fill: '#94a3b8' }}
                      tickLine={false}
                      axisLine={false}
                      tickFormatter={(v: number) => v === 0 ? '' : v >= 1000 ? `${sym}${(v / 1000).toFixed(v >= 10000 ? 0 : 1)}k` : `${sym}${Math.round(v)}`}
                      width={44}
                      domain={[0, Math.max(totalBudget, totalSpent + 1) * 1.12]}
                    />
                    <Tooltip
                      cursor={{ stroke: '#94a3b8', strokeWidth: 1, strokeDasharray: '3 3' }}
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
                            {pace != null && <p className="text-slate-500 dark:text-slate-400">Target: {hideNetWorth ? '••••' : fmt2(pace, sym)}</p>}
                            {actual != null && pace != null && (
                              <p className={`font-semibold mt-1 ${ahead ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-500'}`}>
                                {ahead
                                  ? `${hideNetWorth ? '••••' : fmt2(pace - actual, sym)} ahead`
                                  : `${hideNetWorth ? '••••' : fmt2(actual - pace, sym)} above pace`}
                              </p>
                            )}
                          </div>
                        );
                      }}
                    />
                    <ReferenceLine y={totalBudget} stroke="#fb7185" strokeWidth={1.5} strokeOpacity={0.6} />
                    <Line type="monotone" dataKey="pace" stroke="#f59e0b" strokeWidth={1.5}
                      strokeDasharray="5 4" dot={false} isAnimationActive={false} />
                    <Area type="monotone" dataKey="actual" stroke="#6366f1" strokeWidth={2.5}
                      fill="url(#actualAreaGrad)" dot={false} connectNulls={false} isAnimationActive={false} />
                    {todayPoint?.actual !== null && elapsedFraction > 0.01 && (
                      <ReferenceDot x={todayPoint!.label} y={todayPoint!.actual ?? 0}
                        r={5} fill="#6366f1" stroke="white" strokeWidth={2} />
                    )}
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            )}

            {/* ── Daily Spending Summary ────────────────────────────────── */}
            {paceChartData.some(d => (d.dailySpend ?? 0) > 0) && (() => {
              // Use a log-safe floor (0.1) so log scale doesn't break on zero-spend days
              const LOG_FLOOR = 0.1;
              const pastDays = paceChartData
                .filter(d => d.dailySpend !== null)
                .map(d => ({ ...d, displaySpend: Math.max(d.dailySpend ?? 0, LOG_FLOOR) }));
              return (
                <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-sm p-4"
                  onTouchStart={handleChartTouchStart} onTouchEnd={handleChartTouchEnd}>
                  <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-3">Daily Summary</p>
                  <ResponsiveContainer width="100%" height={90}>
                    <BarChart data={pastDays} margin={{ top: 4, right: 8, bottom: 0, left: 4 }}>
                      <XAxis
                        dataKey="label"
                        tick={{ fontSize: 8, fill: '#94a3b8' }}
                        tickLine={false}
                        axisLine={false}
                        interval={Math.max(0, Math.floor(pastDays.length / 6) - 1)}
                      />
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
                              {fixedSpend > 0.01 && (
                                <p className="text-slate-400 dark:text-slate-500">Bills: {hideNetWorth ? '••••' : fmt2(fixedSpend, sym)}</p>
                              )}
                              <p className={varSpend > 0 ? (abovePace ? 'text-orange-600 dark:text-orange-400' : 'text-indigo-600 dark:text-indigo-400') : 'text-slate-400'}>
                                Variable: {hideNetWorth ? '••••' : fmt2(varSpend, sym)}
                              </p>
                              {varExpected > 0.01 && (
                                <p className="text-slate-400 dark:text-slate-500">
                                  expected {hideNetWorth ? '••••' : fmt2(varExpected, sym)}/day · {abovePace ? `${fmt2(varSpend - varExpected, sym)} over` : `${fmt2(varExpected - varSpend, sym)} under`}
                                </p>
                              )}
                            </div>
                          );
                        }}
                      />
                      <ReferenceLine y={Math.max(variableBudget / Math.max(1, paceChartData.length), LOG_FLOOR)} stroke="#f59e0b" strokeDasharray="3 3" strokeWidth={1} strokeOpacity={0.5} />
                      <Bar dataKey="displaySpend" radius={[2, 2, 0, 0]} maxBarSize={10} isAnimationActive={false}>
                        {pastDays.map((entry, idx) => (
                          <Cell
                            key={idx}
                            fill={(entry.variableSpend ?? 0) > (entry.variableDailyExpected ?? avgDailyPace) ? '#f97316' : '#6366f1'}
                            fillOpacity={(entry.dailySpend ?? 0) <= LOG_FLOOR ? 0.15 : 0.75}
                          />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                  <div className="flex items-center gap-4 mt-1.5">
                    <span className="flex items-center gap-1.5 text-[9px] text-slate-400 dark:text-slate-500">
                      <svg width="16" height="6"><line x1="0" y1="3" x2="16" y2="3" stroke="#f59e0b" strokeWidth="1.5" strokeDasharray="3 2"/></svg>
                      Variable daily budget
                    </span>
                    <span className="flex items-center gap-1.5 text-[9px] text-slate-400 dark:text-slate-500">
                      <span className="w-2.5 h-2.5 rounded-sm bg-orange-400 inline-block opacity-80" />
                      Variable over
                    </span>
                    <span className="flex items-center gap-1.5 text-[9px] text-slate-400 dark:text-slate-500">
                      <span className="w-2.5 h-2.5 rounded-sm bg-indigo-500 inline-block opacity-75" />
                      Variable under
                    </span>
                  </div>
                </div>
              );
            })()}

            {/* Budget cards */}
            {budgets.length === 0 ? (
              <div className="bg-white dark:bg-slate-800 rounded-2xl p-8 text-center shadow-sm">
                <p className="text-slate-600 dark:text-slate-300 text-sm font-medium mb-1">No budgets set yet</p>
                <p className="text-xs text-slate-400 dark:text-slate-500 mb-3">Budgets roll over each pay period automatically once set.</p>
                <p className="text-xs text-slate-400 dark:text-slate-500">Add a category above or tap the chat button to let AI suggest budgets based on your spending.</p>
              </div>
            ) : (
              <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-sm overflow-hidden">
                <div className="px-4 pt-2.5 pb-1">
                  <p className="text-[10px] text-slate-400 dark:text-slate-500">
                    <Flag size={9} className="inline mb-0.5 text-blue-400 mr-0.5" />Flag a transaction as planned if you budgeted for it separately — it won&apos;t count towards the total.
                  </p>
                </div>
                {budgets.map((b, i) => {
                  const spent = spending[b.category] ?? 0;
                  const pct = Math.min(100, (spent / b.monthly_limit) * 100);
                  const over = spent > b.monthly_limit;
                  const colour = colours[b.category] ?? CATEGORY_COLOURS[b.category] ?? CATEGORY_COLOURS.Other;
                  const txns = categoryTxns[b.category] ?? [];
                  const isExpanded = expandedCat === b.category;
                  const curve = paceProfile[b.category];
                  const expectedFraction = curve ? interpolateCurve(curve, elapsedFraction) : elapsedFraction;
                  const markerPct = expectedFraction * 100;
                  const expectedSpend = expectedFraction * b.monthly_limit;
                  const paceGap = expectedSpend - spent; // positive = spending less than pace (good)
                  const aheadOfPace = !over && paceGap >= 0;

                  return (
                    <div key={b.category} className={i > 0 ? "border-t border-slate-50 dark:border-slate-700" : ""}>
                      {/* Row — tappable to expand */}
                      <button
                        onClick={() => setExpandedCat(isExpanded ? null : b.category)}
                        className="w-full px-4 py-3 text-left"
                      >
                        <div className="flex items-center justify-between mb-1.5">
                          <div className="flex items-center gap-2 min-w-0">
                            <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: colour }} />
                            <span className="text-sm font-medium text-slate-800 dark:text-slate-100 truncate">{b.category}</span>
                          </div>
                          <div className="flex items-center gap-2 flex-shrink-0 ml-2">
                            <span className={`text-xs font-semibold ${over ? "text-red-500" : "text-slate-600 dark:text-slate-300"}`}>
                              {hideNetWorth ? "••••" : fmt2(spent, sym)} / {hideNetWorth ? "••••" : fmt(b.monthly_limit, "")}
                            </span>
                            <button
                              onClick={e => { e.stopPropagation(); handleRemove(b.category); }}
                              className="w-6 h-6 flex items-center justify-center rounded-full bg-slate-100 dark:bg-slate-700 active:bg-slate-200 dark:active:bg-slate-600"
                              aria-label={`Remove ${b.category} budget`}
                            >
                              <Trash2 size={11} color="#94a3b8" />
                            </button>
                            <ChevronDown
                              size={14}
                              color="#94a3b8"
                              className={`transition-transform duration-200 ${isExpanded ? "rotate-180" : ""}`}
                            />
                          </div>
                        </div>
                        <div className="relative h-2">
                          {/* Track + spending bar */}
                          <div className="absolute inset-0 bg-slate-100 dark:bg-slate-700 rounded-full overflow-hidden">
                            <div
                              className="h-full rounded-full transition-all"
                              style={{ width: `${pct}%`, backgroundColor: over ? "#f87171" : aheadOfPace ? colour : "#f59e0b" }}
                            />
                          </div>
                          {/* Pace marker — where you should be at this point in the period */}
                          {elapsedFraction < 1 && markerPct > 1 && markerPct < 99 && (
                            <div
                              className="absolute top-1/2 -translate-y-1/2 w-0.5 h-3.5 bg-slate-400 dark:bg-slate-500 rounded-full"
                              style={{ left: `${markerPct}%` }}
                            />
                          )}
                        </div>
                        <div className="flex justify-between mt-1">
                          <span className={`text-[10px] font-medium ${over ? "text-red-500" : elapsedFraction < 0.05 ? "text-slate-400 dark:text-slate-500" : aheadOfPace ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-500"}`}>
                            {hideNetWorth ? "••••" : over
                              ? `${fmt2(spent - b.monthly_limit, sym)} over budget`
                              : elapsedFraction < 0.05
                              ? "Period just started"
                              : elapsedFraction >= 1
                              ? (aheadOfPace ? `${fmt2(paceGap, sym)} under budget` : `${fmt2(Math.abs(paceGap), sym)} over budget`)
                              : aheadOfPace
                              ? `${fmt2(paceGap, sym)} ahead of pace`
                              : `${fmt2(Math.abs(paceGap), sym)} above pace`
                            }
                          </span>
                          <span className={`text-[10px] font-medium ${over ? "text-red-500" : "text-slate-500 dark:text-slate-400"}`}>
                            {hideNetWorth ? "••••" : over
                              ? `${fmt2(spent - b.monthly_limit, sym)} over`
                              : `${fmt2(b.monthly_limit - spent, sym)} left`
                            }
                          </span>
                        </div>
                      </button>

                      {/* Expanded: linked goal + transactions */}
                      {isExpanded && (
                        <div className="border-t border-slate-50 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-700/20">
                          {/* Transaction list */}
                          {txns.length === 0 ? (
                            <p className="text-xs text-slate-400 dark:text-slate-500 text-center py-4">No transactions this period</p>
                          ) : (
                            <div className="max-h-56 overflow-y-auto">
                              {txns.map(tx => (
                                <div key={tx.id} className="flex items-center justify-between px-4 py-2 border-b border-slate-100/60 dark:border-slate-700/40 last:border-0">
                                  <div className="min-w-0 flex-1">
                                    <p className={`text-xs font-medium truncate ${tx.planned ? "text-slate-400 dark:text-slate-500 line-through" : "text-slate-700 dark:text-slate-200"}`}>
                                      {tx.merchant_name || tx.description}
                                    </p>
                                    <p className="text-[10px] text-slate-400 dark:text-slate-500">{formatDate(tx.date)}</p>
                                  </div>
                                  <div className="flex items-center gap-2 flex-shrink-0 ml-3">
                                    <span className={`text-xs font-semibold ${tx.planned ? "text-slate-400 line-through" : "text-red-500"}`}>
                                      {hideNetWorth ? "••••" : `-${fmt2(Math.abs(tx.amount), sym)}`}
                                    </span>
                                    <button
                                      onClick={() => handleTransactionPlanned(tx.id, !!tx.planned)}
                                      className={`w-7 h-7 flex items-center justify-center rounded-full transition-colors flex-shrink-0 ${
                                        tx.planned
                                          ? "bg-blue-100 dark:bg-blue-900/40 text-blue-500"
                                          : "bg-slate-100 dark:bg-slate-700 text-slate-300 dark:text-slate-500 hover:bg-blue-50 dark:hover:bg-blue-900/20 hover:text-blue-400"
                                      }`}
                                      aria-label="Toggle planned"
                                    >
                                      <Flag size={12} className={tx.planned ? "fill-blue-400 text-blue-500" : ""} />
                                    </button>
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}


          </>
        )}
      </div>

      {/* AI Chat button */}
      <button
        onClick={() => setChatOpen(true)}
        className="fixed z-50 flex items-center justify-center w-14 h-14 rounded-full shadow-lg text-white"
        style={{ bottom: "88px", right: "16px", background: "linear-gradient(135deg, #059669 0%, #047857 100%)" }}
        aria-label="Open Budget Advisor"
      >
        <MessageCircle className="w-6 h-6" />
      </button>

      {/* AI Chat panel */}
      {chatOpen && (
        <div
          className="fixed z-50 bg-white dark:bg-slate-800 rounded-2xl shadow-xl flex flex-col overflow-hidden"
          style={{ bottom: "88px", right: "16px", width: "340px", maxWidth: "calc(100vw - 32px)", height: "480px" }}
        >
          <div className="flex items-center justify-between px-4 py-3 text-white flex-shrink-0"
            style={{ background: "linear-gradient(135deg, #059669 0%, #047857 100%)" }}>
            <div>
              <p className="text-sm font-bold">Budget Advisor</p>
              <p className="text-[10px] opacity-70">Powered by Claude</p>
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
                className="opacity-70 hover:opacity-100 transition-opacity"
              >
                <RotateCcw className="w-4 h-4" />
              </button>
              <button onClick={() => setChatOpen(false)} aria-label="Close">
                <X className="w-5 h-5 opacity-80 hover:opacity-100" />
              </button>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto px-3 py-3 space-y-2">
            {messages.map((msg, i) => (
              <div key={i} className={`flex flex-col ${msg.role === "user" ? "items-end" : "items-start"}`}>
                <div className={`max-w-[80%] px-3 py-2 rounded-2xl text-sm leading-relaxed ${
                  msg.role === "user"
                    ? "bg-emerald-600 text-white rounded-br-sm"
                    : "bg-slate-100 dark:bg-slate-700 text-slate-800 dark:text-slate-100 rounded-bl-sm"
                }`}>
                  {cleanReply(msg.content)}
                </div>
                {msg.suggestedBudgets && msg.suggestedBudgets.length > 0 && (
                  <ApplyBudgetCard
                    budgets={msg.suggestedBudgets}
                    colours={colours}
                    sym={sym}
                    onApply={() => applyBudgets(msg.suggestedBudgets!)}
                  />
                )}
              </div>
            ))}
            {chatLoading && (
              <div className="flex justify-start">
                <div className="bg-slate-100 dark:bg-slate-700 rounded-2xl rounded-bl-sm px-4 py-3 flex items-center gap-1">
                  {[0, 150, 300].map(d => (
                    <span key={d} className="w-1.5 h-1.5 bg-slate-400 rounded-full animate-bounce" style={{ animationDelay: `${d}ms` }} />
                  ))}
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          <div className="flex-shrink-0 flex items-center gap-2 px-3 py-2 border-t border-slate-100 dark:border-slate-700">
            <input
              className="flex-1 text-sm bg-slate-50 dark:bg-slate-700 dark:text-slate-100 rounded-full px-4 py-2 outline-none border border-slate-200 dark:border-slate-600 focus:border-emerald-300"
              placeholder="Ask about your budget…"
              value={inputText}
              onChange={e => setInputText(e.target.value)}
              onKeyDown={handleKeyDown}
              disabled={chatLoading}
            />
            <button
              onClick={sendMessage}
              disabled={!inputText.trim() || chatLoading}
              className="flex-shrink-0 w-9 h-9 rounded-full flex items-center justify-center disabled:opacity-40 text-white"
              style={{ background: "linear-gradient(135deg, #059669 0%, #047857 100%)" }}
              aria-label="Send"
            >
              {chatLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            </button>
          </div>
        </div>
      )}

      <BottomNav />
    </div>
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
        <p className="text-[10px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide">Suggested Budget</p>
      </div>
      <div className="px-3 py-1.5 space-y-1">
        {budgets.map(b => {
          const colour = colours[b.category] ?? CATEGORY_COLOURS[b.category] ?? CATEGORY_COLOURS.Other;
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
          className={`w-full py-2 rounded-xl text-sm font-semibold transition-all active:scale-95 ${
            applied
              ? "bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400"
              : "text-white"
          }`}
          style={applied ? undefined : { background: "linear-gradient(135deg, #059669 0%, #047857 100%)" }}
        >
          {applied ? "✓ Budget applied" : applying ? "Applying…" : "Apply this budget"}
        </button>
      </div>
    </div>
  );
}
