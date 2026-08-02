"use client";

import React, { useEffect, useState, useRef, useMemo } from "react";
import { useSearchParams } from "next/navigation";
import { usePeriodSwipe } from "@/lib/usePeriodSwipe";
import { MessageCircle, X, Send, Loader2, ChevronLeft, ChevronRight, Sparkles, RotateCcw } from "lucide-react";
import { BRAND, BRAND_GRADIENT } from "@/components/MoneyAdvisorChat";
import { useLockBodyScroll } from "@/lib/useLockBodyScroll";
import { api } from "@/lib/api";
import { useAuth } from "@/components/AuthProvider";
import { useColours } from "@/components/ColourProvider";
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
import { getPayPeriodWithConfig, filterPeriod, formatPeriod, prevPeriodWithConfig } from "@/lib/payPeriod";
import type { Transaction, PaceDetail } from "@/lib/api";
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

const SKIP = new Set(["Transfer", "Savings", "Debt", "Income"]);

function ChatScrollLock() {
  useLockBodyScroll();
  return null;
}

export default function BudgetPage() {
  const { user } = useAuth();
  const { colours } = useColours();
  const { icons: iconOverrides } = useCategoryIcons();
  const { region, hideNetWorth, payPeriodConfig } = usePreferences();
  const sym = region === "Kenya" ? "KES " : "£";
  const firstName = user?.name?.split(" ")[0] || "there";

  const searchParams = useSearchParams();

  // PaceDetail for trends view
  const [detail, setDetail] = useState<PaceDetail | null>(null);
  const [budgets, setBudgets] = useState<Budget[]>([]);
  const { transactions: allTransactions, loading: txLoading, setTransactions: setAllTransactions } = useAllTransactions();

  // Period navigation — offset based
  const [periodOffset, setPeriodOffset] = useState(0); // 0 = current, -1 = previous

  const [oldestTxDate, setOldestTxDate] = useState<Date | null>(null);

  const [periodStart, periodEnd] = useMemo(() => {
    let [s, e] = getPayPeriodWithConfig(new Date(), payPeriodConfig);
    for (let i = 0; i < Math.abs(periodOffset); i++) {
      [s, e] = prevPeriodWithConfig(s, payPeriodConfig);
    }
    return [s, e];
  }, [periodOffset, payPeriodConfig]); // eslint-disable-line react-hooks/exhaustive-deps

  const isCurrentPeriod = periodOffset === 0;

  // Budgets are home-currency only
  const allPeriodTxns = useMemo(
    () => filterPeriod(allTransactions, periodStart, periodEnd)
      .filter(tx => isHomeCurrency(tx.currency, region)),
    [allTransactions, periodStart, periodEnd, region]
  );

  const [detailLoading, setDetailLoading] = useState(true);
  const pageLoading = detailLoading || txLoading;

  // Category sheet + transaction sheet state
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

  // a11y: dialog contract for chat panel
  const chatPanelRef = useSheetA11y<HTMLDivElement>(() => setChatOpen(false));
  useEffect(() => {
    if (!chatOpen) return;
    const t = setTimeout(() => chatInputRef.current?.focus(), 50);
    return () => clearTimeout(t);
  }, [chatOpen]);

  // Effect 1 — budgets (seeds Penny's applyBudgets merge only; does not gate page)
  useEffect(() => {
    api.getBudgets()
      .then(({ budgets: b }) => setBudgets(b))
      .catch(() => {});
  }, []);

  // Effect 2 — paceDetail (refetch on periodOffset change, out-of-order guard)
  const currentOffsetRef = useRef(0);
  useEffect(() => {
    currentOffsetRef.current = periodOffset;
    setDetail(null);
    setDetailLoading(true);
    api.paceDetail(periodOffset)
      .then(d => {
        if (currentOffsetRef.current === periodOffset) {
          setDetail(d);
          setDetailLoading(false);
        }
      })
      .catch(() => {
        if (currentOffsetRef.current === periodOffset) {
          setDetail({ status: "unavailable" });
          setDetailLoading(false);
        }
      });
  }, [periodOffset]);

  useEffect(() => {
    api.oldestTransaction().then(r => { if (r.date) setOldestTxDate(new Date(r.date)); }).catch(() => {});
  }, []);

  const canGoPrev = !oldestTxDate || periodStart.getTime() > oldestTxDate.getTime();

  const { categoryTxns } = useMemo(() => {
    const txnMap: Record<string, Transaction[]> = {};
    for (const tx of allPeriodTxns) {
      const cat = tx.category || "Other";
      if (SKIP.has(cat)) continue;
      const isCredit = tx.transaction_type === "credit";
      if (tx.transaction_type !== "debit" && !isCredit) continue;
      txnMap[cat] = txnMap[cat] ?? [];
      txnMap[cat].push(tx);
    }
    for (const cat of Object.keys(txnMap)) {
      txnMap[cat].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    }
    return { categoryTxns: txnMap };
  }, [allPeriodTxns]);

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

  // Deep-link: open CategorySheet from ?category= param (once per mount)
  const deepLinkCat = searchParams.get("category");
  const deepLinkHandled = useRef(false);
  useEffect(() => {
    if (deepLinkHandled.current) return;
    if (!deepLinkCat || !detail || detail.status !== "ok") return;
    const choice = detail.choices.find(c => c.category === deepLinkCat);
    const txns = categoryTxns[deepLinkCat] ?? [];
    if (txns.length === 0) return; // leave flag unset so it can open once data arrives
    deepLinkHandled.current = true;
    setOpenCategory({
      name: deepLinkCat,
      total: choice?.spent ?? 0,
      count: choice?.txn_count ?? txns.length,
      transactions: txns,
    });
  }, [deepLinkCat, detail, categoryTxns]); // eslint-disable-line react-hooks/exhaustive-deps

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

  async function applyBudgets(suggested: Budget[]) {
    const suggestedMap = new Map(suggested.map(b => [b.category, b]));
    const merged = [
      ...budgets.map(b => suggestedMap.get(b.category) ?? b),
      ...suggested.filter(b => !budgets.some(e => e.category === b.category)),
    ];
    await api.setBudgets(merged);
    setBudgets(merged);
    api.getBudgets().then(({ budgets: b }) => setBudgets(b)).catch(() => {});
  }

  function cleanReply(text: string) {
    return text.replace(/```budgets[\s\S]*?```/g, "").trim();
  }

  function goPrev() {
    if (!canGoPrev) return;
    setPeriodOffset(o => o - 1);
  }

  function goNext() {
    setPeriodOffset(o => Math.min(0, o + 1));
  }

  const periodSwipe = usePeriodSwipe({ onPrev: goPrev, onNext: goNext, canPrev: canGoPrev, canNext: !isCurrentPeriod });

  // Whisper label style (reused throughout)
  const whisperClass = "text-[11px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500";

  return (
    <div className="min-h-dvh bg-[#f0f2f7] dark:bg-[#0f172a] pb-24 lg:pb-8 lg:max-w-6xl lg:mx-auto" style={{ paddingTop: "env(safe-area-inset-top, 0px)" }}>
      {/* Page title */}
      <div className="px-4 pt-6 pb-2">
        <h1 className="text-xl font-bold text-slate-900 dark:text-slate-100">Trends</h1>
      </div>

      {/* Period-nav card */}
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

      {/* Loading state */}
      {pageLoading && (
        <div className="px-4 pt-8 flex items-center justify-center py-16">
          <Spinner size={32} />
        </div>
      )}

      {/* Main content — only show when not loading */}
      {!pageLoading && (() => {
        // Unavailable state
        if (!detail || detail.status !== "ok") {
          return (
            <div className="px-4 mt-6">
              <p className="text-sm text-slate-400 dark:text-slate-500">Trends aren&apos;t available right now.</p>
            </div>
          );
        }

        const pd = detail.period;
        const pace = detail.pace;
        const ratePerDay = fmt2(pace.actual, sym);
        const discretionarySoFar = pace.discretionary_so_far;
        const isClosed = pd.closed;

        return (
          <div className="px-4 space-y-8 mt-4">
            {/* Header */}
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
                  {!isClosed && pd.days_left != null && (
                    <> · {pd.days_left} days to payday</>
                  )}
                </p>
              </div>
            </div>

            {/* Notable day */}
            {detail.notable_day != null && (
              <p className="text-[12px] text-slate-400 dark:text-slate-500 px-1">
                {detail.notable_day.weekday} was {hideNetWorth ? `${sym}••` : fmt(detail.notable_day.amount, sym)} — about {detail.notable_day.multiple.toFixed(1)}× your usual {detail.notable_day.weekday}.
              </p>
            )}

            {/* Your choices */}
            <div>
              <p className={`${whisperClass} mb-3`}>YOUR CHOICES</p>
              {detail.choices.length > 0 ? (
                <div className="glass-card rounded-2xl overflow-hidden">
                  {detail.choices.map((choice, i) => {
                    const colour = colours[choice.category] ?? CATEGORY_COLOURS[choice.category as keyof typeof CATEGORY_COLOURS] ?? CATEGORY_COLOURS.Other;
                    const Icon = getCategoryIcon(choice.category, iconOverrides);
                    const txns = categoryTxns[choice.category] ?? [];
                    const hasTxns = txns.length > 0;
                    const fragments: string[] = [];
                    fragments.push(`${fmt2(choice.rate_per_day, sym)}/day`);
                    if (choice.multiple != null) fragments.push(`${choice.multiple.toFixed(1)}× your usual`);
                    if (choice.share_of_discretionary != null) fragments.push(`${Math.round(choice.share_of_discretionary * 100)}% of your spending`);
                    const subLine = fragments.join(" · ");

                    const rowContent = (
                      <div className={`flex items-center gap-3 px-4 py-3${i > 0 ? " border-t border-slate-50 dark:border-slate-700" : ""}`}>
                        <span
                          className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
                          style={{ backgroundColor: `${colour}26` }}
                        >
                          <Icon size={15} style={{ color: colour }} />
                        </span>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-slate-800 dark:text-slate-100 truncate">{choice.category}</p>
                          {subLine && (
                            <p className="text-[12px] text-slate-500 dark:text-slate-400 mt-0.5">{subLine}</p>
                          )}
                        </div>
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
                <p className="text-sm text-slate-400 dark:text-slate-500 px-1">
                  {isClosed
                    ? "Nothing spent on choices this period."
                    : "Nothing spent on choices yet this period."}
                </p>
              )}
            </div>
          </div>
        );
      })()}

      {/* AI Chat button (Penny FAB) */}
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
