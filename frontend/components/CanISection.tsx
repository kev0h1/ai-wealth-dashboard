"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Send, Loader2, ChevronRight, X } from "lucide-react";
import { api, CanIOffer } from "@/lib/api";
import { BRAND_GRADIENT } from "@/lib/brand";
import CommitmentSheet from "@/components/CommitmentSheet";
import { useLockBodyScroll } from "@/lib/useLockBodyScroll";
import { useSheetOpen } from "@/lib/useSheetOpen";
import { useSheetA11y } from "@/lib/useSheetA11y";

// "Can I...?" for the Planning page — a value-first LAUNCHER row (the only
// idle footprint: Penny chip + the free-until-period-end figure) that opens
// the short-lived Q&A thread as a bottom sheet (the CommitmentSheet portal
// idiom: backdrop z-[65], sheet z-[70], drag handle, reduced-motion).
// The thread state lives in the launcher component so it survives the sheet
// closing — including the offer → CommitmentSheet round-trip.
//
// Sheet stacking (both sheets are z-[70], so they must never coexist):
// tapping the offer chip CLOSES the Can-I sheet, then opens CommitmentSheet;
// when CommitmentSheet closes — saved or cancelled — the Can-I sheet REOPENS.
// After a save it reopens showing the confirmation bubble (chosen over a
// toast: it reuses the existing message-append flow and keeps the user in
// the conversation they started; cancelling reopens with the offer chip
// intact so the hand-off is never lost).
//
// The thread grows by at most two exchanges (4 visible bubbles) then holds a
// constant height — older turns are dropped from state, not scrolled to.

type Msg = { role: "user" | "assistant"; content: string };

const QUICK = ["Can I spend £200 this weekend?", "Can I buy £80 trainers?", "How much can I spend on a birthday gift?"];

const BG = BRAND_GRADIENT;
const HISTORY_CAP = 6;
const VISIBLE_CAP = 4;

/** Free-figure context threaded in from the page's runway hero. */
export type CanIFreeHint = { free: number; daysLeft: number };

function fmtWhole(n: number): string {
  return `£${Math.round(n).toLocaleString("en-GB")}`;
}

/** ✦ Penny gradient chip — same idiom as PaydayPlanCard/MiscategorisedReviewSheet. */
function PennyChip() {
  return (
    <span
      className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-white rounded-full px-2.5 py-1 flex-shrink-0"
      style={{ background: BG }}
    >
      ✦ Penny
    </span>
  );
}

export default function CanISection({
  onCommitmentSaved,
  freeHint,
}: {
  /** Fires after the offer chip's sheet saves — lets the page refresh its commitments list. */
  onCommitmentSaved?: () => void;
  /** The page's already-computed runway free figure — shown on the launcher and restated in the sheet header. */
  freeHint?: CanIFreeHint | null;
}) {
  const [sheetOpen, setSheetOpen] = useState(false);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  // Commitment hand-off — kept outside `messages` so the chip is exempt from
  // the bubble-cap truncation while visible.
  const [offer, setOffer] = useState<CanIOffer | null>(null);
  const [offerSheetOpen, setOfferSheetOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  async function ask(question: string, history: Msg[]) {
    setError(false);
    setLoading(true);
    try {
      const { reply, offer: newOffer } = await api.canI(question, history);
      setMessages((prev) => [...prev, { role: "assistant" as const, content: reply }].slice(-HISTORY_CAP));
      setOffer(newOffer ?? null);
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
    setOffer(null);
    ask(trimmed, history);
  }

  function retry() {
    if (loading) return;
    const last = messages[messages.length - 1];
    if (!last || last.role !== "user") return;
    const history = messages.slice(0, -1).slice(-HISTORY_CAP);
    ask(last.content, history);
  }

  // Offer chip → CommitmentSheet: close the Can-I sheet first so the two
  // z-[70] sheets never stack.
  function openOfferSheet() {
    setSheetOpen(false);
    setOfferSheetOpen(true);
  }

  return (
    <>
      {/* Launcher — the only idle footprint: value first, never a chat bubble */}
      <button
        onClick={() => setSheetOpen(true)}
        className="w-full glass-card rounded-2xl min-h-[44px] px-4 py-3 flex items-center gap-2 text-left active:scale-[0.99] transition-transform focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
      >
        <PennyChip />
        <span className="text-[15px] font-semibold text-slate-900 dark:text-slate-100 flex-shrink-0">Can I…?</span>
        {freeHint && (
          <span className="text-[13px] text-slate-500 dark:text-slate-400 truncate min-w-0">
            · {fmtWhole(freeHint.free)} free until period end
          </span>
        )}
        <ChevronRight size={16} className="text-slate-400 dark:text-slate-500 flex-shrink-0 ml-auto" aria-hidden="true" />
      </button>

      {sheetOpen && (
        <CanISheet
          freeHint={freeHint}
          messages={messages}
          loading={loading}
          error={error}
          offer={offer}
          input={input}
          inputRef={inputRef}
          onInput={setInput}
          onSend={send}
          onRetry={retry}
          onOfferTap={openOfferSheet}
          onClose={() => setSheetOpen(false)}
        />
      )}

      {/* Commitment sheet — prefilled from the offer; sheet fetches its own
          accounts. Closing it (saved or not) reopens the Can-I sheet. */}
      {offerSheetOpen && offer && (
        <CommitmentSheet
          prefill={{ name: offer.name, amount: offer.amount, target_date: offer.target_date }}
          source="can_i"
          onClose={() => {
            setOfferSheetOpen(false);
            setSheetOpen(true);
          }}
          onSaved={(item) => {
            // CommitmentSheet calls onSaved then onClose — the reopen above
            // brings the thread back with this confirmation bubble showing.
            setOffer(null);
            setMessages((prev) => [
              ...prev,
              {
                role: "assistant" as const,
                content: `Set up — ${fmtWhole(item.per_period_slice)}/period reserved.`,
              },
            ].slice(-HISTORY_CAP));
            onCommitmentSaved?.();
          }}
        />
      )}
    </>
  );
}

// ── The bottom sheet ─────────────────────────────────────────────────────────
// Mounted only while open so the sheet hooks (scroll lock, shell blur, a11y
// focus trap) run exactly for its lifetime — mirrors CommitmentSheet.

function CanISheet({
  freeHint,
  messages,
  loading,
  error,
  offer,
  input,
  inputRef,
  onInput,
  onSend,
  onRetry,
  onOfferTap,
  onClose,
}: {
  freeHint?: CanIFreeHint | null;
  messages: Msg[];
  loading: boolean;
  error: boolean;
  offer: CanIOffer | null;
  input: string;
  inputRef: React.RefObject<HTMLInputElement | null>;
  onInput: (v: string) => void;
  onSend: (text: string) => void;
  onRetry: () => void;
  onOfferTap: () => void;
  onClose: () => void;
}) {
  useLockBodyScroll();
  useSheetOpen();
  const panelRef = useSheetA11y<HTMLDivElement>(onClose);
  const logRef = useRef<HTMLDivElement>(null);

  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  // Keep the newest bubble in view as the thread grows on short viewports.
  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [messages.length, loading, error, offer]);

  const reduceMotion =
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  if (!mounted) return null;

  const visible = messages.slice(-VISIBLE_CAP);

  return createPortal(
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/40 z-[65] fade-in"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Sheet */}
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="Can I…? Ask Penny"
        className="fixed inset-x-0 bottom-0 z-[70]"
        style={reduceMotion ? undefined : { animation: "slideUpSheet 280ms cubic-bezier(0.32, 0.72, 0, 1) both" }}
      >
        <div
          className="mx-auto w-full max-w-[500px] glass-sheet rounded-t-3xl flex flex-col"
          style={{ maxHeight: "85dvh" }}
        >
          {/* Drag handle */}
          <div className="flex justify-center pt-3 pb-1 flex-shrink-0">
            <div className="w-10 h-1 bg-slate-200 dark:bg-slate-600 rounded-full" />
          </div>

          {/* Header — context restated so the answer surface carries its own numbers */}
          <div className="flex items-center gap-3 px-5 pt-2 pb-3 flex-shrink-0">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <PennyChip />
                <p className="text-base font-semibold text-slate-900 dark:text-slate-100">Can I…?</p>
              </div>
              {freeHint && (
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                  {fmtWhole(freeHint.free)} free · {freeHint.daysLeft} {freeHint.daysLeft === 1 ? "day" : "days"} left
                </p>
              )}
            </div>
            <button
              onClick={onClose}
              aria-label="Close"
              className="w-10 h-10 flex items-center justify-center rounded-full bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400 flex-shrink-0 ml-2 active:bg-slate-200 dark:active:bg-slate-600 transition-colors focus:outline-none focus:ring-2 focus:ring-slate-400 focus:ring-offset-2"
            >
              <X size={15} />
            </button>
          </div>

          {/* Scrollable thread */}
          <div ref={logRef} className="overflow-y-auto flex-1 px-5 pb-3">
            <div aria-live="polite" role="log" className={messages.length > 0 ? "space-y-2" : undefined}>
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
                      onClick={onRetry}
                      className="block mt-1.5 text-[13px] font-semibold text-indigo-600 dark:text-indigo-400"
                    >
                      Try again
                    </button>
                  </div>
                </div>
              )}

              {/* Commitment hand-off chip — under the last Penny bubble */}
              {offer && !loading && !error && (
                <div className="flex justify-start">
                  <button
                    onClick={onOfferTap}
                    className="min-h-[44px] text-[13px] font-semibold text-indigo-600 dark:text-indigo-400 border border-indigo-200 dark:border-indigo-800 bg-indigo-50/60 dark:bg-indigo-900/20 rounded-full px-4 py-2 active:scale-95 transition-transform focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
                  >
                    Set this up — £{Math.round(offer.per_period).toLocaleString("en-GB")}/period ›
                  </button>
                </div>
              )}
            </div>

            {messages.length === 0 && !loading && (
              <div className="flex flex-wrap gap-1.5">
                {QUICK.map((q) => (
                  <button
                    key={q}
                    onClick={() => onSend(q)}
                    className="text-[11px] font-medium px-3 py-1.5 rounded-full border border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-700 text-slate-600 dark:text-slate-300 hover:border-violet-300 hover:text-violet-700 dark:hover:text-violet-400 transition-colors"
                  >
                    {q}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Input — pinned at the sheet bottom, above the keyboard */}
          <div
            className="flex-shrink-0 px-5 pt-2"
            style={{ paddingBottom: "calc(0.75rem + env(safe-area-inset-bottom, 0px))" }}
          >
            <div className="flex items-center gap-2">
              <input
                ref={inputRef}
                type="text"
                value={input}
                onChange={(e) => onInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && onSend(input)}
                placeholder="Can I spend £200 this weekend?"
                maxLength={160}
                disabled={loading}
                className="flex-1 min-h-[44px] text-sm bg-slate-50 dark:bg-slate-700 dark:text-slate-100 rounded-full px-4 py-2 outline-none border border-slate-200 dark:border-slate-600 focus:border-violet-300"
              />
              <button
                onClick={() => onSend(input)}
                disabled={!input.trim() || loading}
                aria-label="Ask"
                className="flex-shrink-0 w-11 h-11 rounded-full flex items-center justify-center disabled:opacity-40 text-white active:scale-95 transition-transform"
                style={{ background: BG }}
              >
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
              </button>
            </div>

            <p className="text-[11px] leading-snug text-slate-400 dark:text-slate-500 mt-2">
              General information, not regulated financial advice.
            </p>
          </div>
        </div>
      </div>
    </>,
    document.body
  );
}
