"use client";

import { useRef, useState } from "react";
import { Send, Loader2 } from "lucide-react";
import { api } from "@/lib/api";
import { BRAND_GRADIENT } from "@/lib/brand";

// "Can I...?" chat-with-a-cap for the Planning page — a short-lived thread
// (unlike TaxChat's full floating panel): borrows TaxChat's bubble /
// loading-dot / input idioms and the ✦ Penny chip used by PaydayPlanCard /
// MiscategorisedReviewSheet, rendered inline in a glass-card. The card grows
// by at most two exchanges (4 visible bubbles) then holds a constant height
// — older turns are dropped from state, not scrolled to.

type Msg = { role: "user" | "assistant"; content: string };

const QUICK = ["Can I spend £200 this weekend?", "Can I buy £80 trainers?", "How much can I spend on a birthday gift?"];

const BG = BRAND_GRADIENT;
const HISTORY_CAP = 6;
const VISIBLE_CAP = 4;

export default function CanISection() {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  async function ask(question: string, history: Msg[]) {
    setError(false);
    setLoading(true);
    try {
      const { reply } = await api.canI(question, history);
      setMessages((prev) => [...prev, { role: "assistant" as const, content: reply }].slice(-HISTORY_CAP));
    } catch {
      setError(true);
    } finally {
      setLoading(false);
      inputRef.current?.focus();
    }
  }

  function send(text: string) {
    const trimmed = text.trim();
    if (!trimmed || loading) return;
    const history = messages.slice(-HISTORY_CAP);
    setMessages((prev) => [...prev, { role: "user" as const, content: trimmed }].slice(-HISTORY_CAP));
    setInput("");
    ask(trimmed, history);
  }

  function retry() {
    if (loading) return;
    const last = messages[messages.length - 1];
    if (!last || last.role !== "user") return;
    const history = messages.slice(0, -1).slice(-HISTORY_CAP);
    ask(last.content, history);
  }

  const visible = messages.slice(-VISIBLE_CAP);

  return (
    <div className="glass-card rounded-2xl p-4">
      {/* Penny gradient chip — same idiom as PaydayPlanCard/MiscategorisedReviewSheet */}
      <div className="flex items-center gap-2 mb-3">
        <span
          className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-white rounded-full px-2.5 py-1"
          style={{ background: BG }}
        >
          ✦ Penny
        </span>
        <span className="text-[13px] text-slate-500 dark:text-slate-400">Can I…?</span>
      </div>

      <div aria-live="polite" role="log" className={messages.length > 0 ? "space-y-2 mb-3" : undefined}>
        {visible.map((m, i) => (
          <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
            <div
              className={`max-w-[80%] px-3 py-2 rounded-2xl text-[14px] leading-relaxed ${
                m.role === "user"
                  ? "bg-indigo-600 text-white rounded-br-sm"
                  : "bg-slate-100 dark:bg-slate-700 text-slate-800 dark:text-slate-100 rounded-bl-sm"
              }`}
            >
              {m.content}
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

        {error && !loading && (
          <div className="flex justify-start">
            <div className="max-w-[80%] px-3 py-2 rounded-2xl rounded-bl-sm text-[14px] leading-relaxed bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400">
              Couldn&apos;t check that just now — try again in a moment.
              <button
                onClick={retry}
                className="block mt-1.5 text-[13px] font-semibold text-indigo-600 dark:text-indigo-400"
              >
                Try again
              </button>
            </div>
          </div>
        )}
      </div>

      {messages.length === 0 && !loading && (
        <div className="flex flex-wrap gap-1.5 mb-3">
          {QUICK.map((q) => (
            <button
              key={q}
              onClick={() => send(q)}
              className="text-[11px] font-medium px-3 py-1.5 rounded-full border border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-700 text-slate-600 dark:text-slate-300 hover:border-violet-300 hover:text-violet-700 dark:hover:text-violet-400 transition-colors"
            >
              {q}
            </button>
          ))}
        </div>
      )}

      <div className="flex items-center gap-2">
        <input
          ref={inputRef}
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && send(input)}
          placeholder="Can I spend £200 this weekend?"
          maxLength={160}
          disabled={loading}
          className="flex-1 min-h-[44px] text-sm bg-slate-50 dark:bg-slate-700 dark:text-slate-100 rounded-full px-4 py-2 outline-none border border-slate-200 dark:border-slate-600 focus:border-violet-300"
        />
        <button
          onClick={() => send(input)}
          disabled={!input.trim() || loading}
          aria-label="Ask"
          className="flex-shrink-0 w-11 h-11 rounded-full flex items-center justify-center disabled:opacity-40 text-white active:scale-95 transition-transform"
          style={{ background: BG }}
        >
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
        </button>
      </div>

      <p className="text-[11px] leading-snug text-slate-400 dark:text-slate-500 mt-3">
        General information, not regulated financial advice.
      </p>
    </div>
  );
}
