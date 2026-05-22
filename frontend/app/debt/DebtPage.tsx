"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { MessageCircle, X, Send, Loader2, TrendingDown, ChevronDown, ChevronUp, RotateCcw } from "lucide-react";
import { api } from "@/lib/api";
import { useAuth } from "@/components/AuthProvider";
import { useColours } from "@/components/ColourProvider";
import { usePreferences } from "@/components/PreferencesContext";
import { CATEGORY_COLOURS } from "@/lib/categories";
import BottomNav from "@/components/BottomNav";
import Spinner from "@/components/Spinner";

interface DebtInsights {
  total_debt: number;
  accounts: { name: string; provider: string; balance: number }[];
  monthly_income: number;
  monthly_spending: number;
  monthly_surplus: number;
  monthly_debt_payment: number;
  payment_needed_12mo: number;
  gap_to_12mo: number;
  months_at_current_rate: number;
  category_spending: Record<string, number>;
  recommendations: { category: string; monthly_spend: number; cut_25pct_saves: number; cut_50pct_saves: number }[];
  recent_discretionary: { id: string; description: string; amount: number; date: string; category: string }[];
}

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

function fmt(n: number, sym = "£") {
  return `${sym}${Math.abs(n).toLocaleString("en-GB", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

function fmt2(n: number, sym = "£") {
  return `${sym}${Math.abs(n).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatDate(isoString: string) {
  const d = new Date(isoString);
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

function DebtGrowingCard({ insights, hideNetWorth, sym }: { insights: DebtInsights; hideNetWorth: boolean; sym: string }) {
  const deficit = Math.abs(insights.monthly_surplus);
  const breakEvenNeeded = deficit;
  const goal12moNeeded = deficit + insights.payment_needed_12mo;

  const maxBar = Math.max(insights.monthly_income, insights.monthly_spending);
  const incPct = (insights.monthly_income / maxBar) * 100;
  const spendPct = (insights.monthly_spending / maxBar) * 100;

  return (
    <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-sm p-4 space-y-4">
      <div className="flex items-center gap-2 bg-red-50 dark:bg-red-900/20 rounded-xl px-3 py-2.5">
        <span className="text-lg">⚠️</span>
        <div>
          <p className="text-sm font-semibold text-red-700 dark:text-red-400">Debt is growing</p>
          <p className="text-xs text-red-600 dark:text-red-500">
            You spend {hideNetWorth ? "••••" : fmt2(deficit, sym)} more than you earn each month
          </p>
        </div>
      </div>

      <div className="space-y-2">
        <div>
          <div className="flex justify-between text-xs text-slate-500 dark:text-slate-400 mb-1">
            <span>Monthly income</span>
            <span className="font-semibold text-emerald-600">{hideNetWorth ? "••••" : fmt(insights.monthly_income, sym)}</span>
          </div>
          <div className="h-2.5 bg-slate-100 dark:bg-slate-700 rounded-full overflow-hidden">
            <div className="h-full bg-emerald-400 rounded-full" style={{ width: `${incPct}%` }} />
          </div>
        </div>
        <div>
          <div className="flex justify-between text-xs text-slate-500 dark:text-slate-400 mb-1">
            <span>Monthly spending</span>
            <span className="font-semibold text-red-500">{hideNetWorth ? "••••" : fmt(insights.monthly_spending, sym)}</span>
          </div>
          <div className="h-2.5 bg-slate-100 dark:bg-slate-700 rounded-full overflow-hidden">
            <div className="h-full bg-red-400 rounded-full" style={{ width: `${spendPct}%` }} />
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2.5">
        <div className="bg-amber-50 dark:bg-amber-900/20 rounded-xl p-3">
          <p className="text-[10px] font-bold uppercase tracking-wide text-amber-700 dark:text-amber-400 mb-1.5">Stop debt growing</p>
          <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
            Cut spending <span className="font-semibold text-amber-700 dark:text-amber-400">{hideNetWorth ? "••••" : fmt2(breakEvenNeeded, sym)}/mo</span>
          </p>
          <p className="text-[10px] text-slate-400 dark:text-slate-500 mt-0.5">or earn that much more</p>
        </div>
        <div className="bg-indigo-50 dark:bg-indigo-900/20 rounded-xl p-3">
          <p className="text-[10px] font-bold uppercase tracking-wide text-indigo-700 dark:text-indigo-400 mb-1.5">Debt-free in 12mo</p>
          <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
            Need <span className="font-semibold text-indigo-700 dark:text-indigo-400">{hideNetWorth ? "••••" : fmt2(goal12moNeeded, sym)}/mo</span> extra
          </p>
          <p className="text-[10px] text-slate-400 dark:text-slate-500 mt-0.5">
            {hideNetWorth ? "••••" : fmt2(breakEvenNeeded, sym)} to break even + {hideNetWorth ? "••••" : fmt2(insights.payment_needed_12mo, sym)} to repay
          </p>
        </div>
      </div>
    </div>
  );
}

export default function DebtPage() {
  const { user } = useAuth();
  const { colours } = useColours();
  const { hideNetWorth, region } = usePreferences();
  const sym = region === "Kenya" ? "KES " : "£";
  const [insights, setInsights] = useState<DebtInsights | null>(null);
  const [loading, setLoading] = useState(true);
  const [cutExpanded, setCutExpanded] = useState(false);

  // Chat state
  const [chatOpen, setChatOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputText, setInputText] = useState("");
  const [chatLoading, setChatLoading] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const chatInitialised = useRef(false);

  const firstName = user?.name?.split(" ")[0] || "there";

  const load = useCallback(async () => {
    try {
      const data = await api.debtInsights();
      setInsights(data);
    } catch {
      // leave as null — error shown below
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Initialise chat with first AI message when panel first opens
  useEffect(() => {
    if (!chatOpen || chatInitialised.current || !insights) return;
    chatInitialised.current = true;
    // Load session from backend
    api.getChatSession().then(({ session_id, messages: sessionMsgs }) => {
      setSessionId(session_id);
      if (sessionMsgs && sessionMsgs.length > 0) {
        setMessages(sessionMsgs as ChatMessage[]);
      } else {
        const greeting: ChatMessage = {
          role: "assistant",
          content: insights.total_debt > 0
            ? `Hi ${firstName}! I can see you have ${fmt(insights.total_debt, sym)} in credit card debt. What would you like to work on first?`
            : `Hi ${firstName}! You have no credit card debt — great position to be in. I can help you analyse your spending or work towards savings goals. What would you like to explore?`,
        };
        setMessages([greeting]);
      }
    }).catch(() => {
      const greeting: ChatMessage = {
        role: "assistant",
        content: insights.total_debt > 0
          ? `Hi ${firstName}! I can see you have ${fmt(insights.total_debt, sym)} in credit card debt. What would you like to work on first?`
          : `Hi ${firstName}! You have no credit card debt — great position to be in. I can help you analyse your spending or work towards savings goals. What would you like to explore?`,
      };
      setMessages([greeting]);
    });
  }, [chatOpen, insights, firstName]);

  // Scroll to bottom when messages change
  useEffect(() => {
    if (chatOpen) {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages, chatOpen, chatLoading]);

  async function sendMessage() {
    const text = inputText.trim();
    if (!text || chatLoading) return;
    setInputText("");

    const userMsg: ChatMessage = { role: "user", content: text };
    const nextMessages = [...messages, userMsg];
    setMessages(nextMessages);
    setChatLoading(true);

    try {
      // Only send the new user message to the API — history is loaded from session on backend
      const { reply } = await api.debtChat([userMsg], sessionId ?? undefined);
      setMessages((prev) => [...prev, { role: "assistant", content: reply }]);
    } catch {
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: "Sorry, I couldn't reach the AI right now. Please try again." },
      ]);
    } finally {
      setChatLoading(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  }

  const hasDebt = (insights?.total_debt ?? 0) > 0;
  const onTrack = insights ? insights.months_at_current_rate <= 12 : false;
  const gapExists = insights ? insights.gap_to_12mo > 0 : false;

  // Timeline bar: total = months_at_current_rate, cap display at 36
  const displayMax = insights ? Math.max(24, Math.ceil(insights.months_at_current_rate)) : 24;
  const marker12Pct = Math.min(100, (12 / displayMax) * 100);
  const filledPct = insights
    ? Math.min(100, (insights.months_at_current_rate / displayMax) * 100)
    : 0;

  return (
    <div className="min-h-dvh bg-[#f0f2f7] dark:bg-[#0f172a] pb-24">
      {/* ── Header ── */}
      <div
        className="px-4 pt-6 pb-5 text-white"
        style={{ background: "linear-gradient(135deg, #b91c1c 0%, #7f1d1d 100%)" }}
      >
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold">Debt Tracker</h1>
            {user && <p className="text-sm opacity-80 mt-0.5">Hi {firstName},</p>}
          </div>
          <TrendingDown className="w-7 h-7 opacity-60" />
        </div>
        {loading ? (
          <div className="mt-4 h-12 w-40 bg-white/20 rounded-xl animate-pulse" />
        ) : insights ? (
          <div className="mt-4">
            {hasDebt ? (
              <>
                <p className="text-xs opacity-70 mb-0.5">Total Outstanding</p>
                <p className="text-4xl font-bold tracking-tight">{hideNetWorth ? "••••" : fmt(insights.total_debt, sym)}</p>
                <p className="text-sm opacity-60 mt-0.5">
                  across {insights.accounts.length} card{insights.accounts.length !== 1 ? "s" : ""}
                </p>
              </>
            ) : (
              <>
                <p className="text-xs opacity-70 mb-0.5">Monthly {insights.monthly_surplus >= 0 ? "Surplus" : "Deficit"}</p>
                <p className="text-4xl font-bold tracking-tight">
                  {hideNetWorth ? "••••" : fmt(Math.abs(insights.monthly_surplus), sym)}
                </p>
                <p className="text-sm opacity-60 mt-0.5">
                  {insights.monthly_surplus >= 0 ? "No credit card debt" : "Spending exceeds income"}
                </p>
              </>
            )}
          </div>
        ) : null}
      </div>

      <div className="px-4 pt-4 space-y-3">
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <Spinner size={32} />
          </div>
        ) : !insights ? (
          <div className="bg-white dark:bg-slate-800 rounded-2xl p-8 text-center shadow-sm">
            <p className="text-slate-400 dark:text-slate-500 text-sm">Could not load debt data</p>
          </div>
        ) : (
          <>
            {/* ── Story card ── */}
            {!hasDebt ? (
              /* ── No debt: income vs spending health card ── */
              <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-sm p-4 space-y-4">
                {insights.monthly_surplus >= 0 ? (
                  <div className="flex items-center gap-2 bg-emerald-50 dark:bg-emerald-900/20 rounded-xl px-3 py-2.5">
                    <span className="text-lg">✅</span>
                    <div>
                      <p className="text-sm font-semibold text-emerald-700 dark:text-emerald-400">Finances look healthy</p>
                      <p className="text-xs text-emerald-600 dark:text-emerald-500">
                        You have no credit card debt and a positive monthly surplus
                      </p>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center gap-2 bg-amber-50 dark:bg-amber-900/20 rounded-xl px-3 py-2.5">
                    <span className="text-lg">⚠️</span>
                    <div>
                      <p className="text-sm font-semibold text-amber-700 dark:text-amber-400">Spending exceeds income</p>
                      <p className="text-xs text-amber-600 dark:text-amber-500">
                        You spend {hideNetWorth ? "••••" : fmt2(Math.abs(insights.monthly_surplus), sym)} more than you earn each month
                      </p>
                    </div>
                  </div>
                )}
                <div className="space-y-2">
                  <div>
                    <div className="flex justify-between text-xs text-slate-500 dark:text-slate-400 mb-1">
                      <span>Monthly income</span>
                      <span className="font-semibold text-emerald-600">{hideNetWorth ? "••••" : fmt(insights.monthly_income, sym)}</span>
                    </div>
                    <div className="h-2.5 bg-slate-100 dark:bg-slate-700 rounded-full overflow-hidden">
                      <div className="h-full bg-emerald-400 rounded-full" style={{ width: `${(insights.monthly_income / Math.max(insights.monthly_income, insights.monthly_spending)) * 100}%` }} />
                    </div>
                  </div>
                  <div>
                    <div className="flex justify-between text-xs text-slate-500 dark:text-slate-400 mb-1">
                      <span>Monthly spending</span>
                      <span className="font-semibold text-red-500">{hideNetWorth ? "••••" : fmt(insights.monthly_spending, sym)}</span>
                    </div>
                    <div className="h-2.5 bg-slate-100 dark:bg-slate-700 rounded-full overflow-hidden">
                      <div className="h-full bg-red-400 rounded-full" style={{ width: `${(insights.monthly_spending / Math.max(insights.monthly_income, insights.monthly_spending)) * 100}%` }} />
                    </div>
                  </div>
                </div>
                {insights.monthly_surplus >= 0 && (
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Monthly surplus: <span className="font-semibold text-emerald-600">{hideNetWorth ? "••••" : fmt2(insights.monthly_surplus, sym)}</span>
                  </p>
                )}
              </div>
            ) : insights.monthly_surplus < 0 ? (
              /* ── Has debt + negative surplus: debt growing ── */
              <DebtGrowingCard insights={insights} hideNetWorth={hideNetWorth} sym={sym} />
            ) : (
              /* ── Has debt + positive surplus: timeline ── */
              <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-sm p-4">
                <p className="text-sm text-slate-700 dark:text-slate-200 leading-relaxed">
                  {onTrack ? (
                    <>
                      Your <span className="font-semibold text-emerald-600">{hideNetWorth ? "••••" : fmt2(insights.monthly_surplus, sym)}</span> monthly
                      surplus is enough to clear your <span className="font-semibold text-slate-900 dark:text-slate-100">{hideNetWorth ? "••••" : fmt(insights.total_debt, sym)}</span> debt in 12 months.
                      Keep putting <span className="font-semibold text-slate-900 dark:text-slate-100">{hideNetWorth ? "••••" : fmt2(insights.payment_needed_12mo, sym)}/month</span> towards repayments.
                    </>
                  ) : (
                    <>
                      Your monthly surplus is <span className="font-semibold text-slate-900 dark:text-slate-100">{hideNetWorth ? "••••" : fmt2(insights.monthly_surplus, sym)}</span>.
                      To clear your debt in 12 months you need <span className="font-semibold text-slate-900 dark:text-slate-100">{hideNetWorth ? "••••" : fmt2(insights.payment_needed_12mo, sym)}/month</span> — that&apos;s{" "}
                      <span className="font-semibold text-red-600">{hideNetWorth ? "••••" : fmt2(insights.gap_to_12mo, sym)} more</span> than you&apos;re freeing up.
                    </>
                  )}
                </p>
                <div className="mt-4">
                  <div className="relative h-4 mb-0.5">
                    <span
                      className="absolute text-[10px] font-semibold text-slate-600 dark:text-slate-300 whitespace-nowrap -translate-x-1/2"
                      style={{ left: `clamp(2.5rem, ${marker12Pct}%, calc(100% - 3rem))` }}
                    >
                      12mo goal
                    </span>
                  </div>
                  <div className="relative h-3 bg-slate-100 dark:bg-slate-700 rounded-full overflow-visible mx-1">
                    <div
                      className={`h-full rounded-full transition-all ${onTrack ? "bg-emerald-400" : "bg-amber-400"}`}
                      style={{ width: `${filledPct}%` }}
                    />
                    <div className="absolute top-0 bottom-0 w-0.5 bg-slate-500 dark:bg-slate-400" style={{ left: `${marker12Pct}%` }} />
                  </div>
                  <div className="flex justify-between mt-1">
                    <span className="text-[10px] text-slate-400">Now</span>
                    {displayMax < 999 && <span className="text-[10px] text-slate-400">{displayMax}mo</span>}
                  </div>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                    Debt-free in <span className={`font-semibold ${onTrack ? "text-emerald-600" : "text-amber-600"}`}>{insights.months_at_current_rate} months</span> at your current rate.
                  </p>
                </div>
              </div>
            )}

            {/* ── Cards breakdown ── */}
            {hasDebt && insights.accounts.length > 0 && (
              <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-sm overflow-hidden">
                <div className="px-4 pt-3 pb-2">
                  <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide">Credit Cards</p>
                </div>
                {insights.accounts.map((acc) => {
                  const owed = Math.abs(acc.balance);
                  const pct = insights.total_debt > 0 ? (owed / insights.total_debt) * 100 : 0;
                  return (
                    <div key={acc.name} className="px-4 py-3 border-t border-slate-50 dark:border-slate-700">
                      <div className="flex items-center justify-between mb-1.5">
                        <div>
                          <p className="text-sm font-medium text-slate-800 dark:text-slate-100">{acc.name}</p>
                          <p className="text-xs text-slate-400 dark:text-slate-500">{acc.provider}</p>
                        </div>
                        <p className="text-sm font-bold text-red-500">{hideNetWorth ? "••••" : fmt2(owed, sym)}</p>
                      </div>
                      <div className="h-1.5 bg-slate-100 dark:bg-slate-700 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-red-400 rounded-full"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                      <p className="text-[10px] text-slate-400 dark:text-slate-500 mt-0.5 text-right">
                        {Math.round(pct)}% of total
                      </p>
                    </div>
                  );
                })}
              </div>
            )}

            {/* ── Recent discretionary ── */}
            {insights.recent_discretionary.length > 0 && (
              <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-sm overflow-hidden">
                <div className="px-4 pt-3 pb-1">
                  <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide">
                    Recent non-essential spending
                  </p>
                  <p className="text-xs text-slate-400 dark:text-slate-500 mt-0.5">
                    Optional expenses from the last 30 days — reducing them frees up cash for debt repayment
                  </p>
                </div>
                {insights.recent_discretionary.map((txn) => {
                  const colour =
                    colours[txn.category] ??
                    CATEGORY_COLOURS[txn.category as keyof typeof CATEGORY_COLOURS] ??
                    CATEGORY_COLOURS.Other;
                  return (
                    <div
                      key={txn.id}
                      className="flex items-center justify-between px-4 py-2.5 border-t border-slate-50 dark:border-slate-700"
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <span
                          className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                          style={{ backgroundColor: colour }}
                        />
                        <div className="min-w-0">
                          <p className="text-sm text-slate-800 dark:text-slate-100 truncate">{txn.description}</p>
                          <p className="text-xs text-slate-400 dark:text-slate-500">{txn.category}</p>
                        </div>
                      </div>
                      <div className="flex flex-col items-end flex-shrink-0 ml-3">
                        <span className="text-sm font-semibold text-red-500">{hideNetWorth ? "••••" : `-${fmt2(txn.amount, sym)}`}</span>
                        <span className="text-[10px] text-slate-400">{formatDate(txn.date)}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* ── Where to cut (collapsible) ── */}
            {insights.recommendations.length > 0 && (
              <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-sm overflow-hidden">
                <button
                  className="w-full flex items-center justify-between px-4 py-3"
                  onClick={() => setCutExpanded((v) => !v)}
                >
                  <div className="text-left">
                    <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide">Where to Cut</p>
                    <p className="text-xs text-slate-400 dark:text-slate-500 mt-0.5">Monthly averages — last 3 months</p>
                  </div>
                  {cutExpanded ? (
                    <ChevronUp className="w-4 h-4 text-slate-400" />
                  ) : (
                    <ChevronDown className="w-4 h-4 text-slate-400" />
                  )}
                </button>
                {cutExpanded &&
                  insights.recommendations.map((rec) => {
                    const colour =
                      colours[rec.category] ??
                      CATEGORY_COLOURS[rec.category as keyof typeof CATEGORY_COLOURS] ??
                      CATEGORY_COLOURS.Other;
                    return (
                      <div key={rec.category} className="px-4 py-3 border-t border-slate-50 dark:border-slate-700">
                        <div className="flex items-center justify-between mb-2">
                          <div className="flex items-center gap-2">
                            <span
                              className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                              style={{ backgroundColor: colour }}
                            />
                            <span className="text-sm font-medium text-slate-800 dark:text-slate-100">{rec.category}</span>
                          </div>
                          <span className="text-sm font-bold text-slate-900 dark:text-slate-100">
                            {hideNetWorth ? "••••" : `${fmt2(rec.monthly_spend, sym)}/mo`}
                          </span>
                        </div>
                        <div className="flex gap-2">
                          <div className="flex-1 bg-slate-50 dark:bg-slate-700 rounded-lg px-3 py-1.5 text-center">
                            <p className="text-[10px] text-slate-400 dark:text-slate-500 mb-0.5">Cut 25%</p>
                            <p className="text-sm font-semibold text-emerald-600">
                              {hideNetWorth ? "••••" : `+${fmt2(rec.cut_25pct_saves, sym)}/mo`}
                            </p>
                          </div>
                          <div className="flex-1 bg-slate-50 dark:bg-slate-700 rounded-lg px-3 py-1.5 text-center">
                            <p className="text-[10px] text-slate-400 dark:text-slate-500 mb-0.5">Cut 50%</p>
                            <p className="text-sm font-semibold text-emerald-600">
                              {hideNetWorth ? "••••" : `+${fmt2(rec.cut_50pct_saves, sym)}/mo`}
                            </p>
                          </div>
                        </div>
                      </div>
                    );
                  })}
              </div>
            )}
          </>
        )}
      </div>

      {/* ── AI Chat floating button ── */}
      <button
        onClick={() => setChatOpen(true)}
        className="fixed z-50 flex items-center justify-center w-14 h-14 rounded-full shadow-lg text-white"
        style={{ bottom: "88px", right: "16px", background: "linear-gradient(135deg, #b91c1c 0%, #7f1d1d 100%)" }}
        aria-label="Open Debt Advisor"
      >
        <MessageCircle className="w-6 h-6" />
      </button>

      {/* ── AI Chat panel ── */}
      {chatOpen && (
        <div
          className="fixed z-50 bg-white dark:bg-slate-800 rounded-2xl shadow-xl flex flex-col overflow-hidden"
          style={{ bottom: "88px", right: "16px", width: "340px", maxWidth: "calc(100vw - 32px)", height: "480px" }}
        >
          {/* Panel header */}
          <div
            className="flex items-center justify-between px-4 py-3 text-white flex-shrink-0"
            style={{ background: "linear-gradient(135deg, #b91c1c 0%, #7f1d1d 100%)" }}
          >
            <div>
              <p className="text-sm font-bold">Debt Advisor</p>
              <p className="text-[10px] opacity-70">Powered by Claude</p>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={async () => {
                  try {
                    const { session_id } = await api.newChatSession();
                    setSessionId(session_id);
                    const greeting: ChatMessage = {
                      role: "assistant",
                      content: insights
                        ? insights.total_debt > 0
                          ? `Hi ${firstName}! Starting fresh. You have ${fmt(insights.total_debt, sym)} in credit card debt. What would you like to work on?`
                          : `Hi ${firstName}! Starting fresh. No credit card debt — I can help with spending or savings goals. What would you like to explore?`
                        : "Hi! How can I help you today?",
                    };
                    setMessages([greeting]);
                  } catch {}
                }}
                aria-label="New chat"
                className="opacity-70 hover:opacity-100 transition-opacity"
                title="New chat"
              >
                <RotateCcw className="w-4 h-4" />
              </button>
              <button onClick={() => setChatOpen(false)} aria-label="Close chat">
                <X className="w-5 h-5 opacity-80 hover:opacity-100" />
              </button>
            </div>
          </div>

          {/* Messages area */}
          <div className="flex-1 overflow-y-auto px-3 py-3 space-y-2">
            {messages.map((msg, i) => (
              <div
                key={i}
                className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
              >
                <div
                  className={`max-w-[80%] px-3 py-2 rounded-2xl text-sm leading-relaxed ${
                    msg.role === "user"
                      ? "bg-indigo-600 text-white rounded-br-sm"
                      : "bg-slate-100 dark:bg-slate-700 text-slate-800 dark:text-slate-100 rounded-bl-sm"
                  }`}
                >
                  {msg.content}
                </div>
              </div>
            ))}
            {chatLoading && (
              <div className="flex justify-start">
                <div className="bg-slate-100 rounded-2xl rounded-bl-sm px-4 py-3 flex items-center gap-1">
                  <span
                    className="w-1.5 h-1.5 bg-slate-400 rounded-full animate-bounce"
                    style={{ animationDelay: "0ms" }}
                  />
                  <span
                    className="w-1.5 h-1.5 bg-slate-400 rounded-full animate-bounce"
                    style={{ animationDelay: "150ms" }}
                  />
                  <span
                    className="w-1.5 h-1.5 bg-slate-400 rounded-full animate-bounce"
                    style={{ animationDelay: "300ms" }}
                  />
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Input row */}
          <div className="flex-shrink-0 flex items-center gap-2 px-3 py-2 border-t border-slate-100 dark:border-slate-700">
            <input
              className="flex-1 text-sm bg-slate-50 dark:bg-slate-700 dark:text-slate-100 rounded-full px-4 py-2 outline-none border border-slate-200 dark:border-slate-600 focus:border-red-300"
              placeholder="Ask anything…"
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              onKeyDown={handleKeyDown}
              disabled={chatLoading}
            />
            <button
              onClick={sendMessage}
              disabled={!inputText.trim() || chatLoading}
              className="flex-shrink-0 w-9 h-9 rounded-full flex items-center justify-center disabled:opacity-40 text-white"
              style={{ background: "linear-gradient(135deg, #b91c1c 0%, #7f1d1d 100%)" }}
              aria-label="Send"
            >
              {chatLoading ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Send className="w-4 h-4" />
              )}
            </button>
          </div>
        </div>
      )}

      <BottomNav />
    </div>
  );
}
