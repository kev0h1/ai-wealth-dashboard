"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { MessageCircle, X, Send, Loader2, Plus, Trash2, RotateCcw, Target } from "lucide-react";
import { api } from "@/lib/api";
import { useAuth } from "@/components/AuthProvider";
import { useColours } from "@/components/ColourProvider";
import { useCategories } from "@/components/CategoriesContext";
import { CATEGORY_COLOURS } from "@/lib/categories";
import BottomNav from "@/components/BottomNav";
import Spinner from "@/components/Spinner";
import { getPayPeriod, filterPeriod } from "@/lib/payPeriod";
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

function fmt(n: number) {
  return `£${Math.abs(n).toLocaleString("en-GB", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

function fmt2(n: number) {
  return `£${Math.abs(n).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

const SKIP = new Set(["Transfer", "Savings", "Debt", "Income"]);

export default function BudgetPage() {
  const { user } = useAuth();
  const { colours } = useColours();
  const { allCategories } = useCategories();
  const firstName = user?.name?.split(" ")[0] || "there";

  const [budgets, setBudgets] = useState<Budget[]>([]);
  const [spending, setSpending] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);

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

  const load = useCallback(async () => {
    try {
      const [{ budgets: b }, accs] = await Promise.all([
        api.getBudgets(),
        api.accounts().catch(() => []),
      ]);
      setBudgets(b);

      // Current pay period spending
      const [periodStart, periodEnd] = getPayPeriod(new Date());
      const allTxns: Transaction[] = [];
      await Promise.all(accs.map(async acc => {
        try {
          const txns = await api.transactions(acc.id);
          allTxns.push(...txns);
        } catch {}
      }));
      const periodTxns = filterPeriod(allTxns, periodStart, periodEnd);
      const spendMap: Record<string, number> = {};
      for (const tx of periodTxns) {
        if (tx.transaction_type !== "debit") continue;
        const cat = tx.category || "Other";
        if (SKIP.has(cat)) continue;
        spendMap[cat] = (spendMap[cat] ?? 0) + Math.abs(tx.amount);
      }
      setSpending(spendMap);
    } catch {}
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

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
          content: `Hi ${firstName}! I can help you set up budgets based on your spending. Just tell me what you'd like to budget for, or say "suggest a budget" and I'll analyse your spending and create one automatically.`,
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
      const assistantMsg: ChatMessage = {
        role: "assistant",
        content: result.reply,
        suggestedBudgets: result.suggested_budgets ?? undefined,
      };
      setMessages(prev => [...prev, assistantMsg]);
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
    let next: Budget[];
    if (existing) {
      next = budgets.map(b => b.category === cat ? { ...b, monthly_limit: limit } : b);
    } else {
      next = [...budgets, { category: cat, monthly_limit: limit }];
    }
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

  const availableCats = allCategories.filter(c => !SKIP.has(c));

  // Strip the raw ```budgets JSON block from display text (button replaces it)
  function cleanReply(text: string) {
    return text.replace(/```budgets[\s\S]*?```/g, "").trim();
  }

  async function applyBudgets(suggested: Budget[]) {
    await api.setBudgets(suggested);
    setBudgets(suggested);
    await load();
  }

  return (
    <div className="min-h-dvh bg-[#f0f2f7] dark:bg-[#0f172a] pb-24">
      {/* Header */}
      <div className="px-4 pt-6 pb-5 text-white"
        style={{ background: "linear-gradient(135deg, #059669 0%, #047857 100%)" }}>
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold">Budgets</h1>
            {user && <p className="text-sm opacity-80 mt-0.5">Hi {firstName},</p>}
          </div>
          <Target className="w-7 h-7 opacity-60" />
        </div>
        {!loading && (
          <div className="mt-3 flex gap-3">
            <div className="flex-1 bg-white/15 backdrop-blur rounded-xl px-3 py-2 text-center">
              <p className="text-[10px] opacity-70 mb-0.5">Budgets set</p>
              <p className="text-lg font-bold">{budgets.length}</p>
            </div>
            <div className="flex-1 bg-white/15 backdrop-blur rounded-xl px-3 py-2 text-center">
              <p className="text-[10px] opacity-70 mb-0.5">Total limit</p>
              <p className="text-lg font-bold">{fmt(budgets.reduce((s, b) => s + b.monthly_limit, 0))}</p>
            </div>
          </div>
        )}
      </div>

      <div className="px-4 pt-4 space-y-3">
        {loading ? (
          <div className="flex items-center justify-center py-16"><Spinner size={32} /></div>
        ) : (
          <>
            {/* Add budget form */}
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
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-slate-400">£</span>
                  <input
                    type="number"
                    min="1"
                    placeholder="Limit"
                    value={addLimit}
                    onChange={e => setAddLimit(e.target.value)}
                    onKeyDown={e => { if (e.key === "Enter") handleAddBudget(); }}
                    className="w-28 text-sm bg-slate-50 dark:bg-slate-700 dark:text-slate-100 border border-slate-200 dark:border-slate-600 rounded-xl pl-7 pr-3 py-2 outline-none focus:ring-2 focus:ring-emerald-500"
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

            {/* Budget progress cards */}
            {budgets.length === 0 ? (
              <div className="bg-white dark:bg-slate-800 rounded-2xl p-8 text-center shadow-sm">
                <p className="text-slate-400 dark:text-slate-500 text-sm mb-2">No budgets set yet</p>
                <p className="text-xs text-slate-400 dark:text-slate-500">Add one above or tap the chat button to let AI suggest budgets.</p>
              </div>
            ) : (
              <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-sm overflow-hidden">
                <div className="px-4 pt-3 pb-1">
                  <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide">This Pay Period</p>
                </div>
                {budgets.map((b, i) => {
                  const spent = spending[b.category] ?? 0;
                  const pct = Math.min(100, (spent / b.monthly_limit) * 100);
                  const over = spent > b.monthly_limit;
                  const colour = colours[b.category] ?? CATEGORY_COLOURS[b.category] ?? CATEGORY_COLOURS.Other;
                  return (
                    <div key={b.category} className={`px-4 py-3 ${i > 0 ? "border-t border-slate-50 dark:border-slate-700" : ""}`}>
                      <div className="flex items-center justify-between mb-1.5">
                        <div className="flex items-center gap-2">
                          <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: colour }} />
                          <span className="text-sm font-medium text-slate-800 dark:text-slate-100">{b.category}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className={`text-xs font-semibold ${over ? "text-red-500" : "text-slate-600 dark:text-slate-300"}`}>
                            {fmt2(spent)} / {fmt(b.monthly_limit)}
                          </span>
                          <button
                            onClick={() => handleRemove(b.category)}
                            className="w-6 h-6 flex items-center justify-center rounded-full bg-slate-100 dark:bg-slate-700 active:bg-slate-200 dark:active:bg-slate-600"
                            aria-label={`Remove ${b.category} budget`}
                          >
                            <Trash2 size={11} color="#94a3b8" />
                          </button>
                        </div>
                      </div>
                      <div className="h-2 bg-slate-100 dark:bg-slate-700 rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all ${over ? "bg-red-400" : ""}`}
                          style={{ width: `${pct}%`, backgroundColor: over ? undefined : colour }}
                        />
                      </div>
                      <div className="flex justify-between mt-0.5">
                        <span className="text-[10px] text-slate-400 dark:text-slate-500">{Math.round(pct)}% used</span>
                        {over ? (
                          <span className="text-[10px] font-semibold text-red-500">{fmt2(spent - b.monthly_limit)} over</span>
                        ) : (
                          <span className="text-[10px] text-emerald-600 dark:text-emerald-400">{fmt2(b.monthly_limit - spent)} left</span>
                        )}
                      </div>
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
                    setMessages([{ role: "assistant", content: `Fresh start! Say "suggest a budget" and I'll analyse your spending to create one.` }]);
                  } catch {}
                }}
                aria-label="New chat"
                className="opacity-70 hover:opacity-100 transition-opacity"
                title="New chat"
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
                    onApply={() => applyBudgets(msg.suggestedBudgets!)}
                  />
                )}
              </div>
            ))}
            {chatLoading && (
              <div className="flex justify-start">
                <div className="bg-slate-100 dark:bg-slate-700 rounded-2xl rounded-bl-sm px-4 py-3 flex items-center gap-1">
                  <span className="w-1.5 h-1.5 bg-slate-400 rounded-full animate-bounce" style={{ animationDelay: "0ms" }} />
                  <span className="w-1.5 h-1.5 bg-slate-400 rounded-full animate-bounce" style={{ animationDelay: "150ms" }} />
                  <span className="w-1.5 h-1.5 bg-slate-400 rounded-full animate-bounce" style={{ animationDelay: "300ms" }} />
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
  budgets,
  colours,
  onApply,
}: {
  budgets: Budget[];
  colours: Record<string, string>;
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
              <span className="text-xs font-semibold text-slate-900 dark:text-slate-100 flex-shrink-0">£{b.monthly_limit}/mo</span>
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
