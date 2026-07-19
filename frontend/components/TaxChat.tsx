"use client";

import { useState, useRef, useEffect } from "react";
import { MessageCircle, X, Send, Loader2, Sparkles } from "lucide-react";
import { api } from "@/lib/api";
import ChatMarkdown from "@/components/ChatMarkdown";
import { BRAND_GRADIENT } from "@/components/MoneyAdvisorChat";
import { useSheetA11y } from "@/lib/useSheetA11y";

type Msg = { role: "user" | "assistant"; content: string };

const QUICK = [
  "How does pension carry-forward work?",
  "What counts as salary sacrifice?",
  "Do I need to register for self-assessment?",
  "How does Gift Aid reduce my tax?",
];

const BG = BRAND_GRADIENT;

export default function TaxChat() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const panelRef = useSheetA11y<HTMLDivElement>(() => setOpen(false));

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  // Lock page scroll while the chat is open (matches MoneyAdvisorChat)
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, [open]);

  async function send(text: string) {
    const trimmed = text.trim();
    if (!trimmed || loading) return;
    const userMsg: Msg = { role: "user", content: trimmed };
    const next = [...messages, userMsg];
    setMessages(next);
    setInput("");
    setLoading(true);
    try {
      const { reply } = await api.taxChat(next);
      setMessages([...next, { role: "assistant", content: reply }]);
    } catch {
      setMessages([...next, { role: "assistant", content: "Sorry, something went wrong. Try again." }]);
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      {/* FAB — circular, matching MoneyAdvisorChat style */}
      {!open && (
        <button
          onClick={() => setOpen(true)}
          className="fixed z-[60] flex items-center justify-center w-14 h-14 rounded-full shadow-xl ring-2 ring-white/40 dark:ring-white/25 text-white active:scale-95 transition-transform"
          style={{ bottom: "calc(88px + env(safe-area-inset-bottom, 0px))", right: "16px", background: BG }}
          aria-label="Tax questions"
        >
          <MessageCircle className="w-6 h-6" />
        </button>
      )}

      {/* Floating card — same shape as MoneyAdvisorChat */}
      {open && (
        <div
          ref={panelRef}
          role="dialog"
          aria-modal="true"
          aria-label="Tax chat with Penny"
          className="fixed z-[60] bg-white dark:bg-slate-800 rounded-2xl shadow-xl flex flex-col overflow-hidden"
          style={{
            bottom: "calc(88px + env(safe-area-inset-bottom, 0px))",
            right: "16px",
            width: "340px",
            maxWidth: "calc(100vw - 32px)",
            height: "520px",
          }}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 text-white flex-shrink-0" style={{ background: BG }}>
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-full bg-white/20 backdrop-blur flex items-center justify-center flex-shrink-0">
                <Sparkles className="w-4 h-4" />
              </div>
              <div>
                <p className="text-sm font-bold">Penny</p>
                <p className="text-[11px] opacity-70">Tax questions · Powered by Claude</p>
              </div>
            </div>
            <button onClick={() => setOpen(false)} aria-label="Close chat">
              <X className="w-5 h-5 opacity-80 hover:opacity-100" />
            </button>
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto overscroll-contain px-3 py-3 space-y-2 min-h-0">
            {messages.map((m, i) => (
              <div key={i} className={`flex flex-col ${m.role === "user" ? "items-end" : "items-start"}`}>
                <div className={`max-w-[80%] px-3 py-2 rounded-2xl text-sm leading-relaxed ${
                  m.role === "user"
                    ? "bg-violet-600 text-white rounded-br-sm"
                    : "bg-slate-100 dark:bg-slate-700 text-slate-800 dark:text-slate-100 rounded-bl-sm"
                }`}>
                  {m.role === "assistant" ? <ChatMarkdown>{m.content}</ChatMarkdown> : m.content}
                </div>
              </div>
            ))}
            {loading && (
              <div className="flex justify-start">
                <div className="bg-slate-100 dark:bg-slate-700 rounded-2xl rounded-bl-sm px-4 py-3 flex items-center gap-1">
                  {[0, 150, 300].map((d) => (
                    <span key={d} className="w-1.5 h-1.5 bg-slate-400 rounded-full animate-bounce" style={{ animationDelay: `${d}ms` }} />
                  ))}
                </div>
              </div>
            )}
            <div ref={bottomRef} />
          </div>

          {/* Quick prompts — shown before any user message */}
          {messages.length === 0 && !loading && (
            <div className="flex-shrink-0 flex gap-1.5 px-3 pb-2 overflow-x-auto scrollbar-none">
              {QUICK.map((q) => (
                <button
                  key={q}
                  onClick={() => send(q)}
                  className="flex-shrink-0 text-[11px] font-medium px-3 py-1.5 rounded-full border border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-700 text-slate-600 dark:text-slate-300 hover:border-violet-300 hover:text-violet-700 dark:hover:text-violet-400 transition-colors whitespace-nowrap"
                >
                  {q}
                </button>
              ))}
            </div>
          )}

          <div className="flex-shrink-0 px-3 pb-1">
            <p className="text-[11px] leading-snug text-slate-400 dark:text-slate-500">
              General information, not regulated financial advice.
            </p>
          </div>

          {/* Input */}
          <div className="flex-shrink-0 flex items-center gap-2 px-3 py-2 border-t border-slate-100 dark:border-slate-700">
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && send(input)}
              placeholder="Ask about your tax position…"
              className="flex-1 text-sm bg-slate-50 dark:bg-slate-700 dark:text-slate-100 rounded-full px-4 py-2 outline-none border border-slate-200 dark:border-slate-600 focus:border-violet-300"
              disabled={loading}
            />
            <button
              onClick={() => send(input)}
              disabled={!input.trim() || loading}
              className="flex-shrink-0 w-9 h-9 rounded-full flex items-center justify-center disabled:opacity-40 text-white active:scale-95 transition-transform"
              style={{ background: BG }}
              aria-label="Send"
            >
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            </button>
          </div>
        </div>
      )}
    </>
  );
}
