"use client";

// The bounded Penny oracle — productionised from the approved design at
// app/design/penny-chat/PennyChatClient.tsx (verdict-card anatomy, quiet
// right-aligned user lines, persistent suggestion chips, docked composer).
//
// Retires CanISection.tsx's launcher/bottom-sheet presentation (nothing
// imports that file live any more — it was only reachable via the nav's
// controlled-open prop and the Penny screen's now-removed inline mode) but
// keeps its state machine intact: ask/send/retry, the offer hand-off, and
// the CommitmentSheet round-trip. What's new here: the answer surface is a
// full-width verdict card (headline + muted facts + optional offer chip)
// instead of a chat bubble, and the composer is docked to the viewport
// bottom instead of living inside a sheet.
//
// Backend contract (CONTRACT, may not be live yet):
//   GET /can-i/suggestions -> { chips: [{ label }], context_line }
//   POST /can-i now ALSO returns { headline, facts, out_of_scope } alongside
//   the existing { reply, offer }. Both new surfaces degrade gracefully:
//   canISuggestions() failing just means no chips/context line (every call
//   site treats it as decorative, fire-and-forget); a /can-i reply with no
//   `headline` renders `reply` as plain body text in the same card shell
//   instead of a bold verdict headline (see VerdictCard's `degraded` case).

import { useEffect, useRef, useState } from "react";
import { Send, Loader2, X } from "lucide-react";
import { api, CanIOffer, CanISuggestionChip } from "@/lib/api";
import { BRAND_GRADIENT } from "@/lib/brand";
import PennyMark from "@/components/PennyMark";
import CommitmentSheet from "@/components/CommitmentSheet";

const BG = BRAND_GRADIENT;
const HISTORY_CAP = 6;
const DEFAULT_PLACEHOLDER = "Ask Penny: Can I spend £45 this weekend?";

type UserMsg = { role: "user"; content: string };
type AssistantMsg = {
  role: "assistant";
  headline: string;
  facts?: string[];
  offer?: CanIOffer | null;
  outOfScope?: boolean;
  /** True when this came from a backend that doesn't ship headline/facts
   * yet — `headline` here is actually the raw `reply` string, rendered as
   * plain body text rather than a bold verdict headline. */
  degraded: boolean;
};
type Msg = UserMsg | AssistantMsg;

function reducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** Compact right-aligned user line — quiet, small, NOT an SMS bubble. */
function UserLine({ text }: { text: string }) {
  return (
    <div className="flex justify-end">
      <p className="max-w-[85%] text-[13px] text-slate-500 dark:text-slate-400 text-right leading-snug">{text}</p>
    </div>
  );
}

/** Full-width verdict card — the answer surface itself, not a chat bubble.
 * Bold headline + 2-3 muted grounding facts + an optional offer chip.
 * Degraded (old-backend) replies render as plain 14px body text instead of
 * a bold headline, with no facts list — matching what CanISection's bubble
 * used to show, just inside the new card shell. Out-of-scope answers use
 * the exact same card anatomy as any other verdict (per the approved
 * design) — no separate visual treatment. */
function VerdictCard({ msg, onOfferTap }: { msg: AssistantMsg; onOfferTap: () => void }) {
  return (
    <div className="glass-card rounded-2xl p-4 w-full">
      {msg.degraded ? (
        <p className="text-[14px] leading-relaxed text-slate-700 dark:text-slate-200">{msg.headline}</p>
      ) : (
        <p className="text-[16px] font-bold leading-snug text-slate-900 dark:text-slate-100">{msg.headline}</p>
      )}
      {msg.facts && msg.facts.length > 0 && (
        <div className="mt-2 space-y-1">
          {msg.facts.map((f, i) => (
            <p key={i} className="text-[13px] leading-snug text-slate-500 dark:text-slate-400">
              {f}
            </p>
          ))}
        </div>
      )}
      {msg.offer && (
        <button
          type="button"
          onClick={onOfferTap}
          className="mt-3 min-h-[44px] inline-flex items-center text-[13px] font-semibold text-indigo-600 dark:text-indigo-400 border border-indigo-200 dark:border-indigo-800 bg-indigo-50/60 dark:bg-indigo-900/20 rounded-full px-4 py-2 active:scale-95 transition-transform focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
        >
          Set this up: £{Math.round(msg.offer.per_period).toLocaleString("en-GB")}/period ›
        </button>
      )}
    </div>
  );
}

function BouncingDots() {
  return (
    <div className="flex justify-start">
      <div className="glass-card rounded-2xl px-4 py-3 flex items-center gap-1">
        {[0, 150, 300].map((d) => (
          <span key={d} className="w-1.5 h-1.5 bg-slate-400 rounded-full animate-bounce" style={{ animationDelay: `${d}ms` }} />
        ))}
      </div>
    </div>
  );
}

function ErrorRetry({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="glass-card rounded-2xl p-4 w-full">
      <p className="text-[14px] leading-relaxed text-slate-500 dark:text-slate-400">
        Couldn&apos;t check that just now, try again in a moment.
      </p>
      <button
        onClick={onRetry}
        className="mt-1.5 min-h-[44px] text-[13px] font-semibold text-indigo-600 dark:text-indigo-400"
      >
        Try again
      </button>
    </div>
  );
}

/** Dismissible suggestion pill — 44px target, solid fill (floats over
 * scrolling content so it can't rely on the page background for contrast).
 * `onDismiss` stops propagation so the X never also fires the ask. */
function SuggestionChip({ label, onTap, onDismiss }: { label: string; onTap: () => void; onDismiss: () => void }) {
  return (
    <span className="inline-flex items-center min-h-[44px] rounded-full border border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-700 pl-4 pr-1.5 gap-1">
      <button
        type="button"
        onClick={onTap}
        className="relative min-h-[28px] flex items-center before:absolute before:-inset-y-2 before:-inset-x-1 before:content-[''] text-[13px] font-medium text-slate-600 dark:text-slate-300 active:scale-95 transition-transform focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 rounded"
      >
        {label}
      </button>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onDismiss();
        }}
        aria-label={`Dismiss suggestion: ${label}`}
        className="relative w-7 h-7 flex items-center justify-center rounded-full text-slate-400 dark:text-slate-500 active:bg-slate-200 dark:active:bg-slate-600 transition-colors before:absolute before:-inset-y-2 before:-inset-x-1 before:content-[''] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
      >
        <X size={12} />
      </button>
    </span>
  );
}

export default function PennyConversation({
  initialQuestion,
  autoFocusComposer,
  onContextLine,
  className,
}: {
  /** Submitted once on mount (e.g. from ?ask=<question>). */
  initialQuestion?: string | null;
  /** Focuses the docked composer on mount (e.g. from ?compose=1). No-op on
   * touch devices without a physical keyboard beyond opening the OS one. */
  autoFocusComposer?: boolean;
  /** Fires once suggestions resolve, with the context line ("£251 free ·
   * 10 days left") for a caller (PennyPage) that wants it in its own
   * header rather than repeated here. Null when suggestions fail/degrade. */
  onContextLine?: (line: string | null) => void;
  className?: string;
}) {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [offer, setOffer] = useState<CanIOffer | null>(null);
  const [offerSheetOpen, setOfferSheetOpen] = useState(false);
  const [input, setInput] = useState("");
  const [chips, setChips] = useState<CanISuggestionChip[]>([]);
  const [dismissedChips, setDismissedChips] = useState<Set<string>>(new Set());
  const [askedLabels, setAskedLabels] = useState<Set<string>>(new Set());
  const [placeholder, setPlaceholder] = useState(DEFAULT_PLACEHOLDER);
  const inputRef = useRef<HTMLInputElement>(null);
  const threadEndRef = useRef<HTMLDivElement>(null);
  const initialFiredRef = useRef(false);

  // Suggestions — fire-and-forget, decorative only. A missing/old backend
  // (404, or a payload without `chips`) just leaves the chip row empty and
  // the context line null; never blocks the conversation itself.
  useEffect(() => {
    api.canISuggestions()
      .then((s) => {
        const c = s?.chips ?? [];
        setChips(c);
        onContextLine?.(s?.context_line ?? null);
        // Seed the composer placeholder from the first £-bearing chip so it
        // reflects the user's own numbers; static fallback otherwise.
        const seeded = c.find((chip) => /£\s?\d/.test(chip.label));
        if (seeded) setPlaceholder(`Ask Penny: ${seeded.label}`);
      })
      .catch(() => onContextLine?.(null));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function buildHistory(msgs: Msg[]): Array<{ role: "user" | "assistant"; content: string }> {
    return msgs.slice(-HISTORY_CAP).map((m) =>
      m.role === "user" ? { role: "user" as const, content: m.content } : { role: "assistant" as const, content: m.headline }
    );
  }

  async function ask(question: string, history: Array<{ role: "user" | "assistant"; content: string }>) {
    setError(false);
    setLoading(true);
    try {
      const res = await api.canI(question, history);
      const assistantMsg: AssistantMsg = res.headline
        ? { role: "assistant", headline: res.headline, facts: res.facts, offer: res.offer ?? null, outOfScope: res.out_of_scope, degraded: false }
        : { role: "assistant", headline: res.reply, offer: res.offer ?? null, degraded: true };
      setMessages((prev) => [...prev, assistantMsg].slice(-HISTORY_CAP));
      setOffer(res.offer ?? null);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
      // Refocus the docked composer — desktop rapid follow-up (CanISection
      // had this too; the answer lands in a full-width card now instead of
      // a bubble, but the "ask another one immediately" flow is unchanged).
      inputRef.current?.focus();
    }
  }

  function send(text: string) {
    const trimmed = text.trim();
    if (!trimmed || loading) return;
    const history = buildHistory(messages);
    setMessages((prev) => [...prev, { role: "user" as const, content: trimmed }].slice(-HISTORY_CAP));
    setInput("");
    setOffer(null);
    setAskedLabels((prev) => new Set(prev).add(trimmed));
    ask(trimmed, history);
  }

  function retry() {
    if (loading) return;
    const last = messages[messages.length - 1];
    if (!last || last.role !== "user") return;
    const history = buildHistory(messages.slice(0, -1));
    ask(last.content, history);
  }

  // ?ask=<question> — submit exactly once on mount.
  useEffect(() => {
    if (initialQuestion && !initialFiredRef.current) {
      initialFiredRef.current = true;
      send(initialQuestion);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialQuestion]);

  // ?compose=1 — focus the docked composer.
  useEffect(() => {
    if (autoFocusComposer) inputRef.current?.focus({ preventScroll: true });
  }, [autoFocusComposer]);

  // Scroll the newest turn into view as it lands — covers both the
  // ?ask= deep link ("scroll to answer") and any regular chip/composer ask.
  useEffect(() => {
    if (messages.length === 0) return;
    threadEndRef.current?.scrollIntoView({ behavior: reducedMotion() ? "auto" : "smooth", block: "end" });
  }, [messages.length]);

  function openOfferSheet() {
    setOfferSheetOpen(true);
  }

  const visibleChips = chips.filter((c) => !askedLabels.has(c.label) && !dismissedChips.has(c.label));

  return (
    <div className={className}>
      {/* Thread — in-flow, page-scrolled (no inner scroll container; the
          docked composer below is fixed to the viewport independent of
          this). */}
      {messages.length > 0 && (
        <div aria-live="polite" role="log" className="space-y-3">
          {messages.map((m, i) =>
            m.role === "user" ? <UserLine key={i} text={m.content} /> : <VerdictCard key={i} msg={m} onOfferTap={openOfferSheet} />
          )}
          {loading && <BouncingDots />}
          {error && !loading && <ErrorRetry onRetry={retry} />}
          <div ref={threadEndRef} />
        </div>
      )}
      {messages.length === 0 && loading && <BouncingDots />}
      {messages.length === 0 && error && !loading && <ErrorRetry onRetry={retry} />}

      {/* Persistent suggestion chips — survive an answer instead of
          disappearing (removed only once asked or explicitly dismissed).
          Scrolls with the thread; the composer below stays docked. */}
      {visibleChips.length > 0 && (
        <div className="flex flex-wrap gap-2 mt-3">
          {visibleChips.map((c) => (
            <SuggestionChip
              key={c.label}
              label={c.label}
              onTap={() => send(c.label)}
              onDismiss={() => setDismissedChips((prev) => new Set(prev).add(c.label))}
            />
          ))}
        </div>
      )}

      {/* Docked composer — pinned above BottomNav (mobile only; nav is
          lg:hidden). "88px + safe-area" is the app's established clearance
          idiom for a floating element above the rail (see TaxChat.tsx,
          BudgetPage.tsx's FAB). Wrapped in the same lg:max-w-2xl container
          the Penny/Planning pages use, so it lines up with page content on
          desktop instead of stretching edge to edge. */}
      <div
        className="fixed inset-x-0 z-40 px-4 lg:px-0"
        style={{ bottom: "calc(88px + env(safe-area-inset-bottom, 0px))" }}
      >
        <div className="lg:max-w-2xl lg:mx-auto">
          <div className="glass-card rounded-2xl px-3 pt-2.5 pb-2 shadow-lg">
            <div className="flex items-center gap-2">
              <input
                ref={inputRef}
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && send(input)}
                placeholder={placeholder}
                maxLength={160}
                disabled={loading}
                className="flex-1 min-h-[44px] text-sm bg-slate-50 dark:bg-slate-700 dark:text-slate-100 rounded-full px-4 py-2 outline-none border border-slate-200 dark:border-slate-600 focus:border-violet-300"
              />
              <button
                onClick={() => send(input)}
                disabled={!input.trim() || loading}
                aria-label="Ask Penny"
                className="flex-shrink-0 w-11 h-11 rounded-full flex items-center justify-center disabled:opacity-40 text-white active:scale-95 transition-transform"
                style={{ background: BG }}
              >
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
              </button>
            </div>
            <p className="text-[11px] leading-snug text-slate-400 dark:text-slate-500 mt-1.5">
              General information, not regulated financial advice.
            </p>
          </div>
        </div>
      </div>

      {/* Commitment hand-off — prefilled from the offer; sheet fetches its
          own accounts. No sheet-reopen dance (unlike CanISection's bottom
          sheet, this surface is in-page, not a modal, so there's nothing
          to reopen underneath). */}
      {offerSheetOpen && offer && (
        <CommitmentSheet
          prefill={{ name: offer.name, amount: offer.amount, target_date: offer.target_date }}
          source="can_i"
          onClose={() => setOfferSheetOpen(false)}
          onSaved={(item) => {
            setOffer(null);
            setOfferSheetOpen(false);
            setMessages((prev) => [
              ...prev,
              {
                role: "assistant" as const,
                headline: `Set up: £${Math.round(item.per_period_slice).toLocaleString("en-GB")} ${item.period_label ? `each pay period (${item.period_label})` : "a period"} reserved.`,
                degraded: true,
              },
            ].slice(-HISTORY_CAP));
          }}
        />
      )}
    </div>
  );
}

// ── PENNY PROMPT BAR — Planning page's door into the conversation ─────────
// Glass-card row (Penny chip + placeholder) that routes to /penny?compose=1,
// plus up to 3 suggestion chips that route straight to an answered question
// (/penny?ask=<label>). Suggestions fetch here is ALSO fire-and-forget and
// must never block Planning's own render — the bar shows its placeholder
// immediately; chips (and the whisper caption under them) simply pop in a
// beat later, or never, if the fetch fails.
export function PennyPromptBar({
  onCompose,
  onAsk,
  showChips = true,
}: {
  onCompose: () => void;
  onAsk: (question: string) => void;
  /** Bar-only mode (Planning, 2026-08-18): the chips + whisper caption are
   * dropped, since they're redundant there (the same chips persist inside
   * /penny above the composer) and cost too much vertical space on a page
   * this dense. The bar itself (chip + placeholder, tap -> compose) is
   * unchanged either way. Defaults to the original full behaviour, and
   * skips the suggestions fetch entirely when off — there's nothing to
   * show, so no reason to make the request. */
  showChips?: boolean;
}) {
  const [chips, setChips] = useState<CanISuggestionChip[] | null>(null);

  useEffect(() => {
    if (!showChips) return;
    api.canISuggestions()
      .then((s) => setChips((s?.chips ?? []).slice(0, 3)))
      .catch(() => setChips(null));
  }, [showChips]);

  return (
    <div>
      <button
        type="button"
        onClick={onCompose}
        className="w-full glass-card rounded-2xl min-h-[44px] px-3.5 py-3 flex items-center gap-2.5 text-left active:scale-[0.99] transition-transform focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
      >
        <span
          className="w-7 h-7 rounded-xl flex items-center justify-center flex-shrink-0"
          style={{ background: BG }}
        >
          <PennyMark size={13} className="text-white" />
        </span>
        <span className="text-[14px] text-slate-400 dark:text-slate-500 truncate">
          Ask Penny&hellip; Can I spend £45 this weekend?
        </span>
      </button>

      {chips && chips.length > 0 && (
        <>
          <div className="mt-2.5 flex flex-wrap gap-2">
            {chips.map((c) => (
              <button
                key={c.label}
                type="button"
                onClick={() => onAsk(c.label)}
                className="min-h-[44px] inline-flex items-center text-[13px] font-medium px-4 rounded-full border border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-700/60 text-slate-600 dark:text-slate-300 active:scale-95 transition-transform focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
              >
                {c.label}
              </button>
            ))}
          </div>
          <p className="text-[11px] leading-snug text-slate-400 dark:text-slate-500 mt-2">
            Suggestions come from your own spending and plans.
          </p>
        </>
      )}
    </div>
  );
}
