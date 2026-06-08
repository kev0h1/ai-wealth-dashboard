"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { MessageCircle, X, Send, Loader2, TrendingDown, ChevronDown, ChevronUp, RotateCcw, Target, Trash2 } from "lucide-react";
import { api } from "@/lib/api";
import { useAuth } from "@/components/AuthProvider";
import { useColours } from "@/components/ColourProvider";
import { usePreferences } from "@/components/PreferencesContext";
import { CATEGORY_COLOURS } from "@/lib/categories";
import BottomNav from "@/components/BottomNav";
import Spinner from "@/components/Spinner";
import {
  ResponsiveContainer, ComposedChart, Area, Line, XAxis, YAxis,
  Tooltip, ReferenceLine, ReferenceDot,
} from "recharts";

interface CCAccount {
  account_id: string;
  name: string;
  provider: string;
  balance: number;
  apr: number | null;
  monthly_interest: number;
}

interface DebtInsights {
  total_debt: number;
  accounts: CCAccount[];
  monthly_income: number;
  monthly_spending: number;
  monthly_surplus: number;
  monthly_debt_payment: number;
  payment_needed_12mo: number;
  gap_to_12mo: number;
  months_at_current_rate: number;
  weighted_apr: number;
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

function debtFreeDate(months: number): string {
  if (!isFinite(months) || months > 600) return "a very long time";
  const d = new Date();
  d.setMonth(d.getMonth() + Math.ceil(months));
  return d.toLocaleDateString("en-GB", { month: "long", year: "numeric" });
}

// Circular SVG progress ring
function Ring({ pct, size = 64, stroke = 6 }: { pct: number; size?: number; stroke?: number }) {
  const r = (size - stroke) / 2;
  const circ = 2 * Math.PI * r;
  const offset = circ * (1 - Math.min(1, Math.max(0, pct / 100)));
  return (
    <svg width={size} height={size} className="-rotate-90" viewBox={`0 0 ${size} ${size}`}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(255,255,255,0.2)" strokeWidth={stroke} />
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="white" strokeWidth={stroke}
        strokeDasharray={circ} strokeDashoffset={offset} strokeLinecap="round" />
    </svg>
  );
}

function MissionCard({ insights, hideNetWorth, sym, targetMonths, onOpenChat }: {
  insights: DebtInsights; hideNetWorth: boolean; sym: string; targetMonths: number;
  onOpenChat: (prompt?: string) => void;
}) {
  const months = insights.months_at_current_rate;
  const score = Math.round(Math.min(100, Math.max(0, (targetMonths / months) * 100)));
  const targetDate = debtFreeDate(months);
  const onTrack = months <= targetMonths;
  const paymentNeeded = insights.total_debt > 0 ? insights.total_debt / targetMonths : 0;

  return (
    <div
      className="rounded-2xl p-4 text-white shadow-sm"
      style={{ background: "linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%)" }}
    >
      <div className="flex items-center gap-1.5 mb-3">
        <Target className="w-3.5 h-3.5 opacity-80" />
        <p className="text-[11px] font-bold uppercase tracking-widest opacity-80">Your Mission</p>
      </div>

      <div className="flex items-center gap-4 mb-4">
        <div className="relative flex-shrink-0" style={{ width: 64, height: 64 }}>
          <Ring pct={score} />
          <div className="absolute inset-0 flex items-center justify-center">
            <span className="text-xs font-bold">{score}%</span>
          </div>
        </div>
        <div>
          <p className="text-[11px] opacity-60 mb-0.5">Debt-free by</p>
          <p className="text-xl font-bold leading-tight">{targetDate}</p>
          <p className="text-xs opacity-60 mt-0.5">
            {onTrack ? `✅ On track for ${targetMonths}mo target` : months > 600 ? "⚠️ Very slow at current rate" : `${Math.ceil(months)} months at current rate`}
          </p>
        </div>
      </div>

      {/* Two quick stats */}
      <div className="grid grid-cols-2 gap-2 mb-3">
        <div className="bg-white/10 rounded-xl px-3 py-2">
          <p className="text-[10px] opacity-60 mb-0.5">Pay per month</p>
          <p className="text-sm font-bold">{hideNetWorth ? "••••" : fmt2(paymentNeeded, sym)}</p>
          <p className="text-[10px] opacity-50">to clear in {targetMonths}mo</p>
        </div>
        <div className="bg-white/10 rounded-xl px-3 py-2">
          <p className="text-[10px] opacity-60 mb-0.5">Daily cost</p>
          <p className="text-sm font-bold">{hideNetWorth ? "••••" : fmt2(insights.total_debt / (months * 30), sym)}</p>
          <p className="text-[10px] opacity-50">of carrying this debt</p>
        </div>
      </div>

      <button
        onClick={() => onOpenChat(`Help me build a concrete plan to be debt-free in ${targetMonths} months (by ${targetDate}). My total debt is ${fmt(insights.total_debt, sym)}, monthly surplus is ${fmt2(insights.monthly_surplus, sym)}, and I need to pay ${fmt2(paymentNeeded, sym)}/month.`)}
        className="w-full bg-white/20 hover:bg-white/30 active:scale-95 transition-all rounded-xl py-2.5 text-sm font-semibold"
      >
        Build my debt-free plan →
      </button>
    </div>
  );
}

function DebtGrowingCard({ insights, hideNetWorth, sym, targetMonths }: { insights: DebtInsights; hideNetWorth: boolean; sym: string; targetMonths: number }) {
  const deficit = Math.abs(insights.monthly_surplus);
  const paymentNeeded = insights.total_debt > 0 ? insights.total_debt / targetMonths : 0;
  const maxBar = Math.max(insights.monthly_income, insights.monthly_spending);

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
            <span className="font-semibold text-sky-600">{hideNetWorth ? "••••" : fmt(insights.monthly_income, sym)}</span>
          </div>
          <div className="h-2.5 bg-slate-100 dark:bg-slate-700 rounded-full overflow-hidden">
            <div className="h-full bg-sky-400 rounded-full" style={{ width: `${(insights.monthly_income / maxBar) * 100}%` }} />
          </div>
        </div>
        <div>
          <div className="flex justify-between text-xs text-slate-500 dark:text-slate-400 mb-1">
            <span>Monthly spending</span>
            <span className="font-semibold text-orange-500">{hideNetWorth ? "••••" : fmt(insights.monthly_spending, sym)}</span>
          </div>
          <div className="h-2.5 bg-slate-100 dark:bg-slate-700 rounded-full overflow-hidden">
            <div className="h-full bg-orange-400 rounded-full" style={{ width: `${(insights.monthly_spending / maxBar) * 100}%` }} />
          </div>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2.5">
        <div className="bg-amber-50 dark:bg-amber-900/20 rounded-xl p-3">
          <p className="text-[10px] font-bold uppercase tracking-wide text-amber-700 dark:text-amber-400 mb-1.5">Stop debt growing</p>
          <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
            Cut spending <span className="font-semibold text-amber-700 dark:text-amber-400">{hideNetWorth ? "••••" : fmt2(deficit, sym)}/mo</span>
          </p>
          <p className="text-[10px] text-slate-400 dark:text-slate-500 mt-0.5">or earn that much more</p>
        </div>
        <div className="bg-indigo-50 dark:bg-indigo-900/20 rounded-xl p-3">
          <p className="text-[10px] font-bold uppercase tracking-wide text-indigo-700 dark:text-indigo-400 mb-1.5">Debt-free in {targetMonths}mo</p>
          <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
            Need <span className="font-semibold text-indigo-700 dark:text-indigo-400">{hideNetWorth ? "••••" : fmt2(deficit + paymentNeeded, sym)}/mo</span> extra
          </p>
        </div>
      </div>
    </div>
  );
}

const QUICK_PROMPTS = [
  "How do I pay this off faster?",
  "What should I cut first?",
  "Make me a monthly repayment plan",
  "Am I making progress?",
];

type BurndownData = {
  burndown: { month: string; actual: number | null; target: number | null; projected: number | null }[];
  current_debt: number;
  target_months: number;
  target_date: string;
  monthly_payment_needed: number;
  currency: string;
  total_interest_target: number;
  total_interest_projected: number;
  weighted_apr: number;
  strategy: string;
  has_rates: boolean;
};

export default function DebtPage() {
  const { user } = useAuth();
  const { colours } = useColours();
  const { hideNetWorth, region, debtTargetMonths, setDebtTargetMonths, debtTrackingStart, setDebtTrackingStart } = usePreferences();
  const sym = region === "Kenya" ? "KES " : "£";
  const [insights, setInsights] = useState<DebtInsights | null>(null);
  const [burndown, setBurndown] = useState<BurndownData | null>(null);
  const [strategy, setStrategy] = useState<"avalanche" | "snowball">("avalanche");
  const [burndownMode, setBurndownMode] = useState<"time" | "amount">("time");
  const [monthlyPaymentInput, setMonthlyPaymentInput] = useState<number>(0);
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
  const pendingPromptRef = useRef<string | null>(null);
  const burndownMounted = useRef(false);
  const burndownRef = useRef<BurndownData | null>(null);

  const firstName = user?.name?.split(" ")[0] || "there";

  const load = useCallback(async () => {
    try {
      // Don't pass start_date — backend reads debt_tracking_start from saved prefs,
      // so the initial load always uses the correct persisted value.
      const [data, bdata] = await Promise.all([
        api.debtInsights(), api.debtBurndown(debtTargetMonths, strategy),
      ]);
      setInsights(data);
      setBurndown(bdata);
      if (!monthlyPaymentInput) setMonthlyPaymentInput(Math.ceil(bdata.monthly_payment_needed));
    } catch {
      // leave as null
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { burndownRef.current = burndown; }, [burndown]);

  // Derived: effective months based on mode
  const effectiveTargetMonths = burndownMode === "amount" && burndown && monthlyPaymentInput > 0
    ? calcMonthsFromPayment(burndown.current_debt, monthlyPaymentInput, burndown.weighted_apr)
    : debtTargetMonths;

  // Reload burndown when anything changes — skip initial mount
  useEffect(() => {
    if (!burndownMounted.current) { burndownMounted.current = true; return; }
    // Use current burndown's debt/apr for amount-mode calculation (stable, no dep needed)
    const months = burndownMode === "amount" && burndown && monthlyPaymentInput > 0
      ? calcMonthsFromPayment(burndown.current_debt, monthlyPaymentInput, burndown.weighted_apr)
      : debtTargetMonths;
    api.debtBurndown(months, strategy, debtTrackingStart).then(setBurndown).catch(() => {});
  }, [debtTargetMonths, burndownMode, monthlyPaymentInput, strategy, debtTrackingStart]); // eslint-disable-line react-hooks/exhaustive-deps

  function openChatWithPrompt(prompt?: string) {
    if (prompt) pendingPromptRef.current = prompt;
    setChatOpen(true);
  }

  useEffect(() => {
    if (!chatOpen || chatInitialised.current || !insights) return;
    chatInitialised.current = true;
    api.getChatSession().then(({ session_id, messages: sessionMsgs }) => {
      setSessionId(session_id);
      if (sessionMsgs && sessionMsgs.length > 0) {
        setMessages(sessionMsgs as ChatMessage[]);
        // Still send the pending prompt if present
        if (pendingPromptRef.current) {
          const p = pendingPromptRef.current;
          pendingPromptRef.current = null;
          setInputText(p);
        }
      } else {
        const greeting: ChatMessage = {
          role: "assistant",
          content: insights.total_debt > 0
            ? `Hi ${firstName}! I can see you have ${fmt(insights.total_debt, sym)} in credit card debt. What would you like to work on first?`
            : `Hi ${firstName}! You have no credit card debt — great position. I can help you analyse your spending or work towards savings goals. What would you like to explore?`,
        };
        setMessages([greeting]);
        if (pendingPromptRef.current) {
          const p = pendingPromptRef.current;
          pendingPromptRef.current = null;
          setInputText(p);
        }
      }
    }).catch(() => {
      const greeting: ChatMessage = {
        role: "assistant",
        content: insights.total_debt > 0
          ? `Hi ${firstName}! I can see you have ${fmt(insights.total_debt, sym)} in credit card debt. What would you like to work on first?`
          : `Hi ${firstName}! No credit card debt — I can help with spending or savings goals. What would you like to explore?`,
      };
      setMessages([greeting]);
    });
  }, [chatOpen, insights, firstName, sym]);

  useEffect(() => {
    if (chatOpen) messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, chatOpen, chatLoading]);

  async function sendMessage(overrideText?: string) {
    const text = (overrideText ?? inputText).trim();
    if (!text || chatLoading) return;
    setInputText("");

    const userMsg: ChatMessage = { role: "user", content: text };
    setMessages((prev) => [...prev, userMsg]);
    setChatLoading(true);

    try {
      const { reply } = await api.debtChat([userMsg], sessionId ?? undefined);
      setMessages((prev) => [...prev, { role: "assistant", content: reply }]);
    } catch {
      setMessages((prev) => [...prev, { role: "assistant", content: "Sorry, I couldn't reach the AI right now. Please try again." }]);
    } finally {
      setChatLoading(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); }
  }

  const hasDebt = (insights?.total_debt ?? 0) > 0;
  const onTrack = insights ? insights.months_at_current_rate <= effectiveTargetMonths : false;
  const displayMax = insights ? Math.max(effectiveTargetMonths + 6, Math.ceil(insights.months_at_current_rate)) : effectiveTargetMonths + 6;
  const markerTargetPct = Math.min(100, (effectiveTargetMonths / displayMax) * 100);
  const filledPct = insights ? Math.min(100, (insights.months_at_current_rate / displayMax) * 100) : 0;
  const paymentNeededForTarget = burndownMode === "amount" && monthlyPaymentInput > 0
    ? monthlyPaymentInput
    : (insights && insights.total_debt > 0 ? insights.total_debt / effectiveTargetMonths : 0);

  return (
    <div className="min-h-dvh bg-[#f0f2f7] dark:bg-[#0f172a] pb-24 lg:pb-8 lg:max-w-6xl lg:mx-auto">
      {/* Header */}
      <div className="px-4 pt-6 pb-5 text-white" style={{ background: "linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%)" }}>
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
                  across {insights.accounts.length} card{insights.accounts.length !== 1 ? "s" : ""} · free by{" "}
                  <span className="font-semibold opacity-90">{debtFreeDate(insights.months_at_current_rate)}</span>
                </p>
              </>
            ) : (
              <>
                <p className="text-xs opacity-70 mb-0.5">Monthly {insights.monthly_surplus >= 0 ? "Surplus" : "Deficit"}</p>
                <p className="text-4xl font-bold tracking-tight">{hideNetWorth ? "••••" : fmt(Math.abs(insights.monthly_surplus), sym)}</p>
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
          <div className="flex items-center justify-center py-16"><Spinner size={32} /></div>
        ) : !insights ? (
          <div className="bg-white dark:bg-slate-800 rounded-2xl p-8 text-center shadow-sm">
            <p className="text-slate-400 dark:text-slate-500 text-sm">Could not load debt data</p>
          </div>
        ) : (
          <>
            {/* Burndown chart — only when there's debt */}
            {hasDebt && burndown && burndown.burndown.length > 0 && (
              <DebtBurndownCard
                data={burndown}
                mode={burndownMode}
                onModeChange={setBurndownMode}
                targetMonths={debtTargetMonths}
                onTargetChange={setDebtTargetMonths}
                monthlyPayment={monthlyPaymentInput}
                onMonthlyPaymentChange={setMonthlyPaymentInput}
                effectiveTargetMonths={effectiveTargetMonths}
                trackingStart={debtTrackingStart}
                onTrackingStartChange={setDebtTrackingStart}
                strategy={strategy}
                onStrategyChange={setStrategy}
                hideValues={hideNetWorth}
                sym={sym}
              />
            )}

            {/* Mission card — only when there's debt to clear */}
            {hasDebt && insights.monthly_surplus > 0 && (
              <MissionCard insights={insights} hideNetWorth={hideNetWorth} sym={sym} targetMonths={effectiveTargetMonths} onOpenChat={openChatWithPrompt} />
            )}

            {/* Story card */}
            {!hasDebt ? (
              <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-sm p-4 space-y-4">
                {insights.monthly_surplus >= 0 ? (
                  <div className="flex items-center gap-2 bg-emerald-50 dark:bg-emerald-900/20 rounded-xl px-3 py-2.5">
                    <span className="text-lg">✅</span>
                    <div>
                      <p className="text-sm font-semibold text-emerald-700 dark:text-emerald-400">Finances look healthy</p>
                      <p className="text-xs text-emerald-600 dark:text-emerald-500">No credit card debt and a positive monthly surplus</p>
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
                      <span className="font-semibold text-sky-600">{hideNetWorth ? "••••" : fmt(insights.monthly_income, sym)}</span>
                    </div>
                    <div className="h-2.5 bg-slate-100 dark:bg-slate-700 rounded-full overflow-hidden">
                      <div className="h-full bg-sky-400 rounded-full" style={{ width: `${(insights.monthly_income / Math.max(insights.monthly_income, insights.monthly_spending)) * 100}%` }} />
                    </div>
                  </div>
                  <div>
                    <div className="flex justify-between text-xs text-slate-500 dark:text-slate-400 mb-1">
                      <span>Monthly spending</span>
                      <span className="font-semibold text-orange-500">{hideNetWorth ? "••••" : fmt(insights.monthly_spending, sym)}</span>
                    </div>
                    <div className="h-2.5 bg-slate-100 dark:bg-slate-700 rounded-full overflow-hidden">
                      <div className="h-full bg-orange-400 rounded-full" style={{ width: `${(insights.monthly_spending / Math.max(insights.monthly_income, insights.monthly_spending)) * 100}%` }} />
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
              <DebtGrowingCard insights={insights} hideNetWorth={hideNetWorth} sym={sym} targetMonths={effectiveTargetMonths} />
            ) : (
              <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-sm p-4">
                <p className="text-sm text-slate-700 dark:text-slate-200 leading-relaxed">
                  {onTrack ? (
                    <>Your <span className="font-semibold text-emerald-600">{hideNetWorth ? "••••" : fmt2(insights.monthly_surplus, sym)}</span> monthly
                    surplus is enough to clear your <span className="font-semibold text-slate-900 dark:text-slate-100">{hideNetWorth ? "••••" : fmt(insights.total_debt, sym)}</span> debt in {effectiveTargetMonths} months.
                    Keep putting <span className="font-semibold">{hideNetWorth ? "••••" : fmt2(paymentNeededForTarget, sym)}/month</span> towards repayments.</>
                  ) : (
                    <>Your monthly surplus is <span className="font-semibold">{hideNetWorth ? "••••" : fmt2(insights.monthly_surplus, sym)}</span>.
                    To clear in {effectiveTargetMonths} months you need <span className="font-semibold">{hideNetWorth ? "••••" : fmt2(paymentNeededForTarget, sym)}/month</span> — that&apos;s{" "}
                    <span className="font-semibold text-red-600">{hideNetWorth ? "••••" : fmt2(Math.max(0, paymentNeededForTarget - insights.monthly_surplus), sym)} more</span> than you&apos;re freeing up.</>
                  )}
                </p>
                <div className="mt-4">
                  <div className="relative h-4 mb-0.5">
                    <span className="absolute text-[10px] font-semibold text-slate-600 dark:text-slate-300 whitespace-nowrap -translate-x-1/2"
                      style={{ left: `clamp(2.5rem, ${markerTargetPct}%, calc(100% - 3rem))` }}>
                      {effectiveTargetMonths}mo goal
                    </span>
                  </div>
                  <div className="relative h-3 bg-slate-100 dark:bg-slate-700 rounded-full overflow-visible mx-1">
                    <div className={`h-full rounded-full transition-all ${onTrack ? "bg-indigo-400" : "bg-amber-400"}`} style={{ width: `${filledPct}%` }} />
                    <div className="absolute top-0 bottom-0 w-0.5 bg-slate-500 dark:bg-slate-400" style={{ left: `${markerTargetPct}%` }} />
                  </div>
                  <div className="flex justify-between mt-1">
                    <span className="text-[10px] text-slate-400">Now</span>
                    {displayMax < 999 && <span className="text-[10px] text-slate-400">{displayMax}mo</span>}
                  </div>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                    Debt-free in <span className={`font-semibold ${onTrack ? "text-emerald-600" : "text-amber-600"}`}>{insights.months_at_current_rate > 600 ? "a very long time" : `${insights.months_at_current_rate} months`}</span> at your current rate.
                  </p>
                </div>
              </div>
            )}

            {/* Cards breakdown */}
            {hasDebt && insights.accounts.length > 0 && (
              <CreditCardsCard
                accounts={insights.accounts}
                totalDebt={insights.total_debt}
                hideNetWorth={hideNetWorth}
                sym={sym}
                onRateChange={() => {
                  api.debtInsights().then(setInsights).catch(() => {});
                  const bdn = burndownRef.current;
                  const months = burndownMode === "amount" && bdn && monthlyPaymentInput > 0
                    ? calcMonthsFromPayment(bdn.current_debt, monthlyPaymentInput, bdn.weighted_apr)
                    : debtTargetMonths;
                  api.debtBurndown(months, strategy, debtTrackingStart).then(setBurndown).catch(() => {});
                }}
              />
            )}

            {/* Recent discretionary */}
            {insights.recent_discretionary.length > 0 && (
              <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-sm overflow-hidden">
                <div className="px-4 pt-3 pb-1">
                  <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide">Recent non-essential spending</p>
                  <p className="text-xs text-slate-400 dark:text-slate-500 mt-0.5">Reducing these frees up cash for repayment</p>
                </div>
                {insights.recent_discretionary.map((txn) => {
                  const colour = colours[txn.category] ?? CATEGORY_COLOURS[txn.category as keyof typeof CATEGORY_COLOURS] ?? CATEGORY_COLOURS.Other;
                  return (
                    <div key={txn.id} className="flex items-center justify-between px-4 py-2.5 border-t border-slate-50 dark:border-slate-700">
                      <div className="flex items-center gap-2.5 min-w-0">
                        <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: colour }} />
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

            {/* Where to cut */}
            {insights.recommendations.length > 0 && (
              <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-sm overflow-hidden">
                <button className="w-full flex items-center justify-between px-4 py-3" onClick={() => setCutExpanded((v) => !v)}>
                  <div className="text-left">
                    <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide">Where to Cut</p>
                    <p className="text-xs text-slate-400 dark:text-slate-500 mt-0.5">Monthly averages — last 3 months</p>
                  </div>
                  {cutExpanded ? <ChevronUp className="w-4 h-4 text-slate-400" /> : <ChevronDown className="w-4 h-4 text-slate-400" />}
                </button>
                {cutExpanded && insights.recommendations.map((rec) => {
                  const colour = colours[rec.category] ?? CATEGORY_COLOURS[rec.category as keyof typeof CATEGORY_COLOURS] ?? CATEGORY_COLOURS.Other;
                  const surplus = insights.monthly_surplus;
                  const moSaved = surplus > 0
                    ? Math.max(0, insights.months_at_current_rate - (insights.total_debt / (surplus + rec.cut_25pct_saves)))
                    : 0;
                  return (
                    <div key={rec.category} className="px-4 py-3 border-t border-slate-50 dark:border-slate-700">
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2">
                          <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: colour }} />
                          <span className="text-sm font-medium text-slate-800 dark:text-slate-100">{rec.category}</span>
                        </div>
                        <span className="text-sm font-bold text-slate-900 dark:text-slate-100">{hideNetWorth ? "••••" : `${fmt2(rec.monthly_spend, sym)}/mo`}</span>
                      </div>
                      <div className="flex gap-2">
                        <div className="flex-1 bg-slate-50 dark:bg-slate-700 rounded-lg px-3 py-1.5 text-center">
                          <p className="text-[10px] text-slate-400 dark:text-slate-500 mb-0.5">Cut 25%</p>
                          <p className="text-sm font-semibold text-emerald-600">{hideNetWorth ? "••••" : `+${fmt2(rec.cut_25pct_saves, sym)}/mo`}</p>
                          {moSaved > 0.5 && <p className="text-[9px] text-slate-400 mt-0.5">{Math.round(moSaved)} mo sooner</p>}
                        </div>
                        <div className="flex-1 bg-slate-50 dark:bg-slate-700 rounded-lg px-3 py-1.5 text-center">
                          <p className="text-[10px] text-slate-400 dark:text-slate-500 mb-0.5">Cut 50%</p>
                          <p className="text-sm font-semibold text-emerald-600">{hideNetWorth ? "••••" : `+${fmt2(rec.cut_50pct_saves, sym)}/mo`}</p>
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

      {/* Chat FAB */}
      <button
        onClick={() => openChatWithPrompt()}
        className="fixed z-50 flex items-center justify-center w-14 h-14 rounded-full shadow-lg text-white"
        style={{ bottom: "88px", right: "16px", background: "linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%)" }}
        aria-label="Open Debt Advisor"
      >
        <MessageCircle className="w-6 h-6" />
      </button>

      {/* Chat panel */}
      {chatOpen && (
        <div
          className="fixed z-50 bg-white dark:bg-slate-800 rounded-2xl shadow-xl flex flex-col overflow-hidden"
          style={{ bottom: "88px", right: "16px", width: "340px", maxWidth: "calc(100vw - 32px)", height: "520px" }}
        >
          <div className="flex items-center justify-between px-4 py-3 text-white flex-shrink-0"
            style={{ background: "linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%)" }}>
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
                    chatInitialised.current = false;
                    setMessages([{
                      role: "assistant",
                      content: insights?.total_debt ?? 0 > 0
                        ? `Hi ${firstName}! Starting fresh. You have ${fmt(insights!.total_debt, sym)} in debt. What would you like to work on?`
                        : `Hi ${firstName}! Starting fresh. How can I help?`,
                    }]);
                  } catch {}
                }}
                aria-label="New chat" className="opacity-70 hover:opacity-100 transition-opacity" title="New chat">
                <RotateCcw className="w-4 h-4" />
              </button>
              <button onClick={() => setChatOpen(false)} aria-label="Close chat">
                <X className="w-5 h-5 opacity-80 hover:opacity-100" />
              </button>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto px-3 py-3 space-y-2">
            {messages.map((msg, i) => (
              <div key={i} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                <div className={`max-w-[80%] px-3 py-2 rounded-2xl text-sm leading-relaxed ${
                  msg.role === "user"
                    ? "bg-indigo-600 text-white rounded-br-sm"
                    : "bg-slate-100 dark:bg-slate-700 text-slate-800 dark:text-slate-100 rounded-bl-sm"
                }`}>
                  {msg.content}
                </div>
              </div>
            ))}
            {chatLoading && (
              <div className="flex justify-start">
                <div className="bg-slate-100 rounded-2xl rounded-bl-sm px-4 py-3 flex items-center gap-1">
                  {[0, 150, 300].map((d) => (
                    <span key={d} className="w-1.5 h-1.5 bg-slate-400 rounded-full animate-bounce" style={{ animationDelay: `${d}ms` }} />
                  ))}
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Quick prompt chips — shown only when chat is fresh (≤1 message) */}
          {messages.length <= 1 && !chatLoading && (
            <div className="flex-shrink-0 flex gap-1.5 px-3 pb-2 overflow-x-auto scrollbar-none">
              {QUICK_PROMPTS.map((p) => (
                <button
                  key={p}
                  onClick={() => sendMessage(p)}
                  className="flex-shrink-0 text-[11px] font-medium px-3 py-1.5 rounded-full border border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-700 text-slate-600 dark:text-slate-300 hover:border-indigo-300 hover:text-indigo-700 dark:hover:text-indigo-400 transition-colors whitespace-nowrap"
                >
                  {p}
                </button>
              ))}
            </div>
          )}

          <div className="flex-shrink-0 flex items-center gap-2 px-3 py-2 border-t border-slate-100 dark:border-slate-700">
            <input
              className="flex-1 text-sm bg-slate-50 dark:bg-slate-700 dark:text-slate-100 rounded-full px-4 py-2 outline-none border border-slate-200 dark:border-slate-600 focus:border-indigo-300"
              placeholder="Ask anything…"
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              onKeyDown={handleKeyDown}
              disabled={chatLoading}
            />
            <button
              onClick={() => sendMessage()}
              disabled={!inputText.trim() || chatLoading}
              className="flex-shrink-0 w-9 h-9 rounded-full flex items-center justify-center disabled:opacity-40 text-white"
              style={{ background: "linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%)" }}
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

// ── Credit Cards Card (with APR editing) ─────────────────────────────────────

function AprInput({ accountId, initialApr, onSaved }: { accountId: string; initialApr: number | null; onSaved: () => void }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(initialApr !== null ? String(initialApr) : "");
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    const apr = value.trim() === "" ? null : parseFloat(value);
    if (apr !== null && (isNaN(apr) || apr < 0 || apr > 100)) { setSaving(false); return; }
    await api.setAccountRate(accountId, apr).catch(() => {});
    setSaving(false);
    setEditing(false);
    onSaved();
  }

  async function remove() {
    setSaving(true);
    await api.setAccountRate(accountId, null).catch(() => {});
    setValue("");
    setSaving(false);
    setEditing(false);
    onSaved();
  }

  if (!editing) {
    return (
      <div className="flex items-center gap-1.5">
        <button onClick={() => setEditing(true)} className="flex items-center gap-1 text-xs font-semibold">
          {initialApr !== null ? (
            <span className="text-amber-600 dark:text-amber-400">{initialApr}% APR</span>
          ) : (
            <span className="text-slate-400 dark:text-slate-500 underline decoration-dashed">Add APR</span>
          )}
        </button>
        {initialApr !== null && (
          <button onClick={remove} disabled={saving} aria-label="Remove APR" className="text-slate-300 dark:text-slate-600 hover:text-red-400 dark:hover:text-red-400 transition-colors">
            <Trash2 size={11} />
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="flex items-center gap-1">
      <input
        autoFocus
        type="number"
        min="0"
        max="100"
        step="0.01"
        value={value}
        onChange={e => setValue(e.target.value)}
        onKeyDown={e => { if (e.key === "Enter") save(); if (e.key === "Escape") setEditing(false); }}
        className="w-20 text-xs px-2 py-1 rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-800 dark:text-slate-100 outline-none focus:ring-1 focus:ring-amber-400"
        placeholder="e.g. 21.9"
      />
      <span className="text-xs text-slate-400">%</span>
      <button onClick={save} disabled={saving} className="text-xs font-semibold text-indigo-600 dark:text-indigo-400 active:opacity-70">
        {saving ? "…" : "Save"}
      </button>
      <button onClick={() => setEditing(false)} className="text-xs text-slate-400">✕</button>
    </div>
  );
}

function CreditCardsCard({ accounts, totalDebt, hideNetWorth, sym, onRateChange }: {
  accounts: CCAccount[];
  totalDebt: number;
  hideNetWorth: boolean;
  sym: string;
  onRateChange: () => void;
}) {
  const totalMonthlyInterest = accounts.reduce((s, a) => s + (a.monthly_interest ?? 0), 0);

  return (
    <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-sm overflow-hidden">
      <div className="px-4 pt-3 pb-2 flex items-center justify-between">
        <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide">Credit Cards</p>
        {totalMonthlyInterest > 0 && (
          <span className="text-[10px] font-semibold text-amber-600 dark:text-amber-400">
            ~{sym}{totalMonthlyInterest.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}/mo interest
          </span>
        )}
      </div>
      {accounts.map((acc) => {
        const owed = Math.abs(acc.balance);
        const pct = totalDebt > 0 ? (owed / totalDebt) * 100 : 0;
        return (
          <div key={acc.account_id} className="px-4 py-3 border-t border-slate-50 dark:border-slate-700">
            <div className="flex items-center justify-between mb-1">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-slate-800 dark:text-slate-100 truncate">{acc.name}</p>
                <p className="text-xs text-slate-400 dark:text-slate-500">{acc.provider}</p>
              </div>
              <div className="flex flex-col items-end ml-3 gap-0.5">
                <p className="text-sm font-bold text-rose-500">{hideNetWorth ? "••••" : fmt2(owed, sym)}</p>
                <AprInput accountId={acc.account_id} initialApr={acc.apr} onSaved={onRateChange} />
              </div>
            </div>
            <div className="h-1.5 bg-slate-100 dark:bg-slate-700 rounded-full overflow-hidden">
              <div className="h-full bg-rose-400 rounded-full" style={{ width: `${pct}%` }} />
            </div>
            <div className="flex justify-between mt-0.5">
              <span className="text-[10px] text-slate-400">{Math.round(pct)}% of total</span>
              {acc.monthly_interest > 0 && (
                <span className="text-[10px] text-amber-500 font-medium">
                  {hideNetWorth ? "••" : `+${sym}${acc.monthly_interest.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}/mo interest`}
                </span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Debt Burndown Chart ───────────────────────────────────────────────────────

const TARGET_OPTIONS = [6, 12, 18, 24, 36];

function calcMonthsFromPayment(debt: number, payment: number, weightedAprPct: number): number {
  if (!payment || payment <= 0 || debt <= 0) return 120;
  const r = weightedAprPct / 12 / 100;
  if (r > 0 && payment > r * debt) {
    const n = -Math.log(1 - (r * debt) / payment) / Math.log(1 + r);
    return Math.min(120, Math.ceil(n));
  }
  return Math.min(120, Math.ceil(debt / payment));
}

function fmtMonth(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString("en-GB", { month: "short", year: "2-digit" });
}

function DebtBurndownCard({
  data, mode, onModeChange, targetMonths, onTargetChange, monthlyPayment, onMonthlyPaymentChange,
  effectiveTargetMonths, trackingStart, onTrackingStartChange, strategy, onStrategyChange, hideValues, sym,
}: {
  data: BurndownData;
  mode: "time" | "amount";
  onModeChange: (m: "time" | "amount") => void;
  targetMonths: number;
  onTargetChange: (n: number) => void;
  monthlyPayment: number;
  onMonthlyPaymentChange: (n: number) => void;
  effectiveTargetMonths: number;
  trackingStart: string;
  onTrackingStartChange: (s: string) => void;
  strategy: "avalanche" | "snowball";
  onStrategyChange: (s: "avalanche" | "snowball") => void;
  hideValues: boolean;
  sym: string;
}) {
  const today = new Date().toISOString().slice(0, 7);
  const todayIdx = data.burndown.findIndex(p => p.month === today);

  const chartData = data.burndown.map(p => ({
    month: fmtMonth(p.month),
    actual:    p.actual    !== null ? p.actual    : undefined,
    target:    p.target    !== null ? p.target    : undefined,
    projected: p.projected !== null ? p.projected : undefined,
  }));

  const yFmt = (v: number) =>
    hideValues ? "••" : (v >= 1000 ? `${sym}${(v / 1000).toFixed(0)}k` : `${sym}${v}`);

  // Annotation: compare paydown since tracking start vs required paydown.
  // The backend anchors target[today] = current_debt always, so comparing actual[today]
  // to target[today] is meaningless (always equal). Instead compare trajectories:
  //   actual paydown = startActual - currentActual  (positive = debt shrank)
  //   required paydown = startTarget - currentTarget (same: how much target dropped)
  //   on track ⟺ actual paydown ≥ required paydown
  const fraction = todayIdx >= 0 ? todayIdx / Math.max(1, data.burndown.length - 1) : -1;
  const todayActual = todayIdx >= 0 ? chartData[todayIdx]?.actual : undefined;
  const todayTarget = todayIdx >= 0 ? chartData[todayIdx]?.target : undefined;
  const firstActualIdx = chartData.findIndex(d => d.actual !== undefined);
  const startActual = firstActualIdx >= 0 ? chartData[firstActualIdx]?.actual : undefined;
  const startTarget = firstActualIdx >= 0 ? chartData[firstActualIdx]?.target : undefined;
  const actualPaydown  = startActual !== undefined && todayActual !== undefined ? startActual - todayActual : null;
  const requiredPaydown = startTarget !== undefined && todayTarget !== undefined ? startTarget - todayTarget : null;
  const isOnTrack = actualPaydown !== null && requiredPaydown !== null && actualPaydown >= requiredPaydown;
  const annotationGap = actualPaydown !== null && requiredPaydown !== null
    ? Math.abs(actualPaydown - requiredPaydown) : null;

  return (
    <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-sm overflow-hidden">
      {/* Card header */}
      <div className="px-4 pt-4 pb-2">
        <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">Debt Burndown</p>
        <p className="text-xs text-slate-400 dark:text-slate-500 mt-0.5">
          Clear by <span className="font-medium text-slate-600 dark:text-slate-300">{fmtMonth(data.target_date)}</span>
          {" · "}
          <span className="text-indigo-500 font-medium">{hideValues ? "••••" : `${sym}${data.monthly_payment_needed.toLocaleString("en-GB", { maximumFractionDigits: 0 })}/mo`}</span>
        </p>
      </div>

      {/* Legend row */}
      <div className="px-4 pb-2 flex items-center gap-4">
        <span className="flex items-center gap-1.5">
          <span className="w-5 h-[2px] bg-indigo-500 rounded inline-block" />
          <span className="text-[10px] text-slate-500 dark:text-slate-400">Actual</span>
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-5 inline-block" style={{ borderTop: "2px dashed #14b8a6", display: "inline-block" }} />
          <span className="text-[10px] text-teal-600 dark:text-teal-400">Target</span>
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-5 inline-block" style={{ borderTop: "2px dotted #f59e0b", display: "inline-block" }} />
          <span className="text-[10px] text-amber-500 dark:text-amber-400">Projected</span>
        </span>
      </div>

      {/* Interest summary — only when rates are set */}
      {data.has_rates && (
        <div className="mx-4 mb-3 flex items-center gap-3 bg-amber-50 dark:bg-amber-900/20 rounded-xl px-3 py-2">
          <div className="flex-1">
            <p className="text-[10px] font-semibold text-amber-700 dark:text-amber-400 uppercase tracking-wide">Interest cost</p>
            <p className="text-xs text-amber-800 dark:text-amber-300">
              {hideValues ? "••••" : `${sym}${data.total_interest_target.toLocaleString("en-GB", { maximumFractionDigits: 0 })}`}{" "}
              <span className="text-amber-600 dark:text-amber-400">on target · </span>
              {hideValues ? "••••" : `${sym}${data.total_interest_projected.toLocaleString("en-GB", { maximumFractionDigits: 0 })}`}{" "}
              <span className="text-amber-600 dark:text-amber-400">projected</span>
            </p>
          </div>
          <span className="text-xs font-bold text-amber-700 dark:text-amber-400">{data.weighted_apr.toFixed(1)}% avg APR</span>
        </div>
      )}

      {/* Chart + annotation */}
      <div className="relative px-1 pb-2">
        {/* Annotation callout at today — only shown when we have a meaningful history window */}
        {fraction >= 0 && firstActualIdx >= 0 && firstActualIdx < todayIdx && (
          <div
            className="absolute pointer-events-none z-10 -translate-x-1/2"
            style={{ top: 4, left: `calc(44px + ${fraction} * (100% - 56px))` }}
          >
            <div className={`text-[10px] font-semibold px-2 py-1 rounded-lg shadow-sm border whitespace-nowrap ${
              isOnTrack
                ? "bg-emerald-50 dark:bg-emerald-900/40 border-emerald-200 dark:border-emerald-700 text-emerald-700 dark:text-emerald-300"
                : "bg-amber-50 dark:bg-amber-900/40 border-amber-200 dark:border-amber-700 text-amber-700 dark:text-amber-300"
            }`}>
              {isOnTrack ? "On Track" : "Behind"}
              {annotationGap !== null && !hideValues && ` · ${sym}${Math.round(annotationGap).toLocaleString("en-GB")} ${isOnTrack ? "ahead" : "behind"}`}
            </div>
          </div>
        )}

        <div className="h-56">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={chartData} margin={{ top: 36, right: 8, bottom: 0, left: 0 }}>
              <defs>
                <linearGradient id="burndownActualGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#6366f1" stopOpacity={0.25} />
                  <stop offset="95%" stopColor="#6366f1" stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <XAxis
                dataKey="month"
                tick={{ fontSize: 10, fill: "#94a3b8" }}
                tickLine={false}
                axisLine={false}
                interval="preserveStartEnd"
              />
              <YAxis
                tickFormatter={yFmt}
                tick={{ fontSize: 10, fill: "#94a3b8" }}
                tickLine={false}
                axisLine={false}
                width={44}
              />
              <Tooltip
                content={(props: any) => {
                  const { active, payload, label } = props;
                  if (!active || !payload?.length) return null;
                  const actual    = payload.find((p: any) => p.dataKey === "actual")?.value;
                  const target    = payload.find((p: any) => p.dataKey === "target")?.value;
                  const projected = payload.find((p: any) => p.dataKey === "projected")?.value;
                  const fmtVal = (v: number | undefined) =>
                    v === undefined ? null : hideValues ? "••••" : `${sym}${Math.round(v).toLocaleString("en-GB")}`;
                  return (
                    <div className="bg-white dark:bg-slate-800 border border-slate-100 dark:border-slate-700 rounded-xl shadow-lg px-3 py-2 text-xs space-y-0.5">
                      <p className="font-semibold text-slate-700 dark:text-slate-200 mb-1">{label}</p>
                      {actual    !== undefined && <p className="text-indigo-600">Actual: {fmtVal(actual)}</p>}
                      {target    !== undefined && <p className="text-teal-600">Target: {fmtVal(target)}</p>}
                      {projected !== undefined && <p className="text-amber-500">Projected: {fmtVal(projected)}</p>}
                    </div>
                  );
                }}
              />
              {/* Today reference line */}
              {todayIdx >= 0 && (
                <ReferenceLine
                  x={chartData[todayIdx]?.month}
                  stroke="#94a3b8"
                  strokeDasharray="4 4"
                  label={{ value: "Today", position: "insideBottomRight", fontSize: 9, fill: "#94a3b8" }}
                />
              )}
              {/* Actual — gradient area */}
              <Area
                type="monotone"
                dataKey="actual"
                name="Actual"
                stroke="#6366f1"
                strokeWidth={2.5}
                fill="url(#burndownActualGradient)"
                dot={false}
                connectNulls={false}
              />
              {/* Target — dashed teal line */}
              <Line
                type="monotone"
                dataKey="target"
                name="Target"
                stroke="#14b8a6"
                strokeWidth={2}
                strokeDasharray="6 3"
                dot={false}
                connectNulls={false}
              />
              {/* Projected — dotted amber line */}
              <Line
                type="monotone"
                dataKey="projected"
                name="Projected"
                stroke="#f59e0b"
                strokeWidth={1.5}
                strokeDasharray="2 4"
                dot={false}
                connectNulls={false}
              />
              {/* Today dot on actual */}
              {todayIdx >= 0 && todayActual !== undefined && (
                <ReferenceDot
                  x={chartData[todayIdx]?.month}
                  y={todayActual}
                  r={4}
                  fill="#6366f1"
                  stroke="#fff"
                  strokeWidth={2}
                />
              )}
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Settings */}
      <div className="px-4 pb-4 pt-2 border-t border-slate-50 dark:border-slate-700 space-y-4">

        {/* Tracking start */}
        <div>
          <p className="text-[10px] font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-wide mb-2">Tracking start</p>
          <div className="flex items-center gap-2">
            <input
              type="month" value={trackingStart} max={today}
              onChange={e => { if (e.target.value) onTrackingStartChange(e.target.value); }}
              className="text-xs bg-slate-50 dark:bg-slate-700 dark:text-slate-100 border border-slate-200 dark:border-slate-600 rounded-xl px-3 py-1.5 outline-none focus:ring-2 focus:ring-indigo-400"
            />
            {trackingStart !== today && (
              <button onClick={() => onTrackingStartChange(today)} className="text-[10px] text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300 underline">
                Reset to today
              </button>
            )}
          </div>
        </div>

        {/* Goal type toggle */}
        <div>
          <p className="text-[10px] font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-wide mb-2">Goal type</p>
          <div className="flex gap-2 mb-3">
            <button
              onClick={() => onModeChange("time")}
              className={`flex-1 py-2 rounded-xl text-xs font-semibold transition-all text-left px-3 ${mode === "time" ? "bg-indigo-600 text-white" : "bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400"}`}
            >
              <span className="block font-bold">By date</span>
              <span className="text-[10px] opacity-70">Choose a timeline</span>
            </button>
            <button
              onClick={() => onModeChange("amount")}
              className={`flex-1 py-2 rounded-xl text-xs font-semibold transition-all text-left px-3 ${mode === "amount" ? "bg-indigo-600 text-white" : "bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400"}`}
            >
              <span className="block font-bold">By amount</span>
              <span className="text-[10px] opacity-70">Set a monthly payment</span>
            </button>
          </div>

          {mode === "time" ? (
            <div className="flex gap-2 flex-wrap">
              {TARGET_OPTIONS.map(mo => (
                <button
                  key={mo}
                  onClick={() => onTargetChange(mo)}
                  className={`px-3 py-1 rounded-full text-xs font-semibold transition-all ${
                    targetMonths === mo
                      ? "bg-indigo-600 text-white"
                      : "bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-600"
                  }`}
                >
                  {mo < 12 ? `${mo}mo` : `${mo / 12}yr${mo > 12 ? "s" : ""}`}
                </button>
              ))}
            </div>
          ) : (
            <div className="flex items-center gap-3">
              <div className="relative flex-1">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-slate-400 pointer-events-none">{sym.trim()}</span>
                <input
                  type="number" min="1" placeholder="e.g. 500"
                  value={monthlyPayment || ""}
                  onChange={e => onMonthlyPaymentChange(Number(e.target.value))}
                  className={`w-full text-xs bg-slate-50 dark:bg-slate-700 dark:text-slate-100 border border-slate-200 dark:border-slate-600 rounded-xl py-2 outline-none focus:ring-2 focus:ring-indigo-400 ${sym.length > 2 ? "pl-11 pr-3" : "pl-7 pr-3"}`}
                />
              </div>
              <span className="text-xs text-slate-500 dark:text-slate-400 whitespace-nowrap">
                /month → <span className="font-semibold text-slate-700 dark:text-slate-200">{effectiveTargetMonths}mo</span>
              </span>
            </div>
          )}
        </div>

        {/* Strategy */}
        <div>
          <div className="flex items-baseline gap-2 mb-1.5">
            <p className="text-[10px] font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-wide">Projected strategy</p>
            <p className="text-[9px] text-slate-400 dark:text-slate-500">affects projected line only — target is fixed</p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => onStrategyChange("avalanche")}
              className={`flex-1 px-3 py-2 rounded-xl text-xs font-semibold transition-all text-left ${strategy === "avalanche" ? "bg-indigo-500 text-white" : "bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-600"}`}
            >
              <span className="block font-bold">Avalanche</span>
              <span className="text-[10px] opacity-70">Highest APR first · saves most interest</span>
            </button>
            <button
              onClick={() => onStrategyChange("snowball")}
              className={`flex-1 px-3 py-2 rounded-xl text-xs font-semibold transition-all text-left ${strategy === "snowball" ? "bg-indigo-500 text-white" : "bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-600"}`}
            >
              <span className="block font-bold">Snowball</span>
              <span className="text-[10px] opacity-70">Smallest balance first · builds momentum</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
