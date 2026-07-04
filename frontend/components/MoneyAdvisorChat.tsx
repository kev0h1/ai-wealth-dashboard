"use client";

import { forwardRef, useImperativeHandle, useState, useRef, useEffect } from "react";
import { MessageCircle, X, Send, Loader2, RotateCcw, Target, Sparkles } from "lucide-react";
import { api, SuggestedPlan } from "@/lib/api";
import { fmt, DebtInsights } from "@/app/debt/DebtPage";
import ChatMarkdown from "@/components/ChatMarkdown";

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  suggestedPlan?: SuggestedPlan;
}

const QUICK_PROMPTS = [
  "How do I pay this off faster?",
  "What should I cut first?",
  "Make me a monthly repayment plan",
  "Am I making progress?",
];

const QUICK_PROMPTS_NO_DEBT = [
  "How can I save more each month?",
  "Where am I overspending?",
  "Help me set a savings goal",
  "How's my financial health?",
];

const QUICK_PROMPTS_TRANSPORT = [
  "Am I spending too much on transport?",
  "Car vs public transport — which costs less?",
  "Where can I cut my travel costs?",
  "Is a season ticket worth it for me?",
];

export interface MoneyAdvisorChatHandle {
  open: (prompt?: string) => void;
}

// Penny has one identity everywhere — tab accents stay on the tabs
export const BRAND = "#4f46e5";
export const BRAND_GRADIENT = "linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%)";

interface Props {
  insights: DebtInsights | null;
  sym: string;
  firstName: string;
  onPlanSaved?: () => void;
  hidden?: boolean;
  /** Which screen the user is on — gives Penny situational awareness */
  page?: string;
}

const MoneyAdvisorChat = forwardRef<MoneyAdvisorChatHandle, Props>(function MoneyAdvisorChat(
  { insights, sym, firstName, onPlanSaved, hidden = false, page },
  ref,
) {
  const [chatOpen, setChatOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputText, setInputText] = useState("");
  const [chatLoading, setChatLoading] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [bodyLocked, setBodyLocked] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const chatInitialised = useRef(false);
  const pendingPromptRef = useRef<string | null>(null);

  useEffect(() => {
    const obs = new MutationObserver(() => {
      setBodyLocked(document.body.style.overflow === "hidden");
    });
    obs.observe(document.body, { attributes: true, attributeFilter: ["style"] });
    return () => obs.disconnect();
  }, []);

  // Lock page scroll while the chat is open — on mobile the card covers most
  // of the viewport and scroll-chaining moves the page behind it otherwise
  useEffect(() => {
    if (!chatOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, [chatOpen]);

  const hasDebt = (insights?.total_debt ?? 0) > 0;

  useImperativeHandle(ref, () => ({
    open(prompt?: string) {
      if (prompt) pendingPromptRef.current = prompt;
      setChatOpen(true);
    },
  }));

  useEffect(() => {
    if (!chatOpen || chatInitialised.current || !insights) return;
    chatInitialised.current = true;
    const greetingContent = page === "transport"
      ? `Hi ${firstName}, I'm Penny! I can see your transport spending across all modes. Ask me anything about your travel costs — I can help you find savings or compare options.`
      : hasDebt
      ? `Hi ${firstName}, I'm Penny! I can see you have ${fmt(insights.total_debt, sym)} in credit card debt. What would you like to work on first?`
      : `Hi ${firstName}, I'm Penny! You have no credit card debt — great position. I can help you analyse your spending or work towards savings goals. What would you like to explore?`;
    api.getChatSession().then(({ session_id, messages: sessionMsgs }) => {
      setSessionId(session_id);
      if (sessionMsgs && sessionMsgs.length > 0) {
        setMessages(sessionMsgs as ChatMessage[]);
      } else {
        setMessages([{ role: "assistant", content: greetingContent }]);
      }
      if (pendingPromptRef.current) {
        const p = pendingPromptRef.current;
        pendingPromptRef.current = null;
        setInputText(p);
      }
    }).catch(() => {
      setMessages([{ role: "assistant", content: greetingContent }]);
    });
  }, [chatOpen, insights, firstName, sym, hasDebt]);

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
      const { reply, suggested_plan } = await api.debtChat([userMsg], sessionId ?? undefined, page);
      setMessages((prev) => [...prev, { role: "assistant", content: reply, suggestedPlan: suggested_plan ?? undefined }]);
    } catch {
      setMessages((prev) => [...prev, { role: "assistant", content: "Sorry, I couldn't reach the AI right now. Please try again." }]);
    } finally {
      setChatLoading(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); }
  }

  function cleanReply(text: string) {
    return text.replace(/```plan[\s\S]*?```/g, "").trim();
  }

  async function savePlan(plan: SuggestedPlan) {
    const isSavings = plan.kind === "savings";
    if (plan.mode === "add") {
      await (isSavings ? api.addSavingsPlanMilestones(plan) : api.addDebtPlanMilestones(plan));
    } else {
      await (isSavings ? api.saveSavingsPlan(plan) : api.saveDebtPlan(plan));
    }
    onPlanSaved?.();
  }

  const prompts = page === "transport" ? QUICK_PROMPTS_TRANSPORT : hasDebt ? QUICK_PROMPTS : QUICK_PROMPTS_NO_DEBT;

  return (
    <>
      {/* Chat FAB — hidden when any sheet/modal locks body scroll */}
      {!hidden && !bodyLocked && (
        <button
          onClick={() => setChatOpen(true)}
          className="fixed z-[60] flex items-center justify-center w-14 h-14 rounded-full shadow-xl ring-2 ring-white/40 dark:ring-white/25 text-white"
          style={{ bottom: "calc(88px + env(safe-area-inset-bottom, 0px))", right: "16px", background: BRAND_GRADIENT }}
          aria-label="Chat with Penny"
        >
          <MessageCircle className="w-6 h-6" />
        </button>
      )}

      {chatOpen && (
        <div
          className="fixed z-[60] bg-white dark:bg-slate-800 rounded-2xl shadow-xl flex flex-col overflow-hidden"
          style={{ bottom: "calc(88px + env(safe-area-inset-bottom, 0px))", right: "16px", width: "340px", maxWidth: "calc(100vw - 32px)", height: "520px" }}
        >
          <div className="flex items-center justify-between px-4 py-3 text-white flex-shrink-0" style={{ background: BRAND_GRADIENT }}>
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-full bg-white/20 backdrop-blur flex items-center justify-center flex-shrink-0">
                <Sparkles className="w-4 h-4" />
              </div>
              <div>
                <p className="text-sm font-bold">Penny</p>
                <p className="text-[10px] opacity-70">Your money advisor · Powered by Claude</p>
              </div>
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
                      content: page === "transport"
                        ? `Hi ${firstName}! Starting fresh. Ask me anything about your transport spending.`
                        : hasDebt
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

          <div className="flex-1 overflow-y-auto overscroll-contain px-3 py-3 space-y-2">
            {messages.map((msg, i) => (
              <div key={i} className={`flex flex-col ${msg.role === "user" ? "items-end" : "items-start"}`}>
                <div className={`max-w-[80%] px-3 py-2 rounded-2xl text-sm leading-relaxed ${
                  msg.role === "user"
                    ? "bg-indigo-600 text-white rounded-br-sm"
                    : "bg-slate-100 dark:bg-slate-700 text-slate-800 dark:text-slate-100 rounded-bl-sm"
                }`}>
                  {msg.role === "assistant" ? <ChatMarkdown>{cleanReply(msg.content)}</ChatMarkdown> : msg.content}
                </div>
                {msg.suggestedPlan && msg.suggestedPlan.milestones?.length > 0 && (
                  <SavePlanCard plan={msg.suggestedPlan} sym={sym} accent={BRAND} onSave={() => savePlan(msg.suggestedPlan!)} />
                )}
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

          {messages.length <= 1 && !chatLoading && (
            <div className="flex-shrink-0 flex gap-1.5 px-3 pb-2 overflow-x-auto scrollbar-none">
              {prompts.map((p) => (
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

          <div className="flex-shrink-0 px-3 pb-1">
            <p className="text-[9px] leading-snug text-slate-400 dark:text-slate-500">
              General information, not regulated financial advice.
            </p>
          </div>

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
              style={{ background: BRAND }}
              aria-label="Send"
            >
              {chatLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            </button>
          </div>
        </div>
      )}
    </>
  );
});

function SavePlanCard({ plan, sym, accent, onSave }: {
  plan: SuggestedPlan;
  sym: string;
  accent: string;
  onSave: () => Promise<void>;
}) {
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const isAdd = plan.mode === "add";
  const isSavings = plan.kind === "savings";

  async function handle() {
    if (saved || saving) return;
    setSaving(true);
    try {
      await onSave();
      setSaved(true);
    } catch {
      // leave button active to retry
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mt-1.5 max-w-[80%] bg-white dark:bg-slate-800 border border-slate-100 dark:border-slate-600 rounded-2xl rounded-tl-sm overflow-hidden shadow-sm">
      <div className="px-3 pt-2.5 pb-1.5 border-b border-slate-100 dark:border-slate-700 flex items-center gap-1.5">
        <Target className="w-3.5 h-3.5" style={{ color: accent }} />
        <p className="text-[10px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide">
          {isAdd ? "Add to your plan" : isSavings ? "Your savings plan" : "Your debt-free plan"}{plan.target_months && !isAdd ? ` · ${plan.target_months} mo` : ""}
        </p>
      </div>
      <div className="px-3 py-2 space-y-1.5">
        {plan.milestones.map((m, i) => (
          <div key={i} className="flex items-start gap-2">
            <span
              className="mt-0.5 w-4 h-4 rounded-full flex items-center justify-center flex-shrink-0 text-[9px] font-bold text-white"
              style={{ background: accent }}
            >
              {i + 1}
            </span>
            <span className="text-xs text-slate-700 dark:text-slate-200 leading-snug">
              {m.text}
              {(m.type === "payment" || m.type === "savings") && m.target_balance != null && (
                <span className="text-slate-400 dark:text-slate-500"> · {fmt(m.target_balance, sym)}</span>
              )}
            </span>
          </div>
        ))}
      </div>
      <div className="px-3 pb-3 pt-1">
        <button
          onClick={handle}
          disabled={saved || saving}
          className={`w-full py-2 rounded-xl text-sm font-semibold transition-all active:scale-95 ${
            saved ? "bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300" : "text-white"
          }`}
          style={saved ? undefined : { background: accent }}
        >
          {saved ? (isAdd ? "✓ Added to plan" : "✓ Plan saved") : saving ? "Saving…" : isAdd ? "Add to my plan" : "Save this plan"}
        </button>
      </div>
    </div>
  );
}

export default MoneyAdvisorChat;
