"use client";

// TEMPORARY PREVIEW — delete after design review.
//
// The sheet shell itself. Reuses the established sheet infrastructure
// (lib/useSheetA11y.ts, lib/useLockBodyScroll.ts, lib/useSheetOpen.ts) and
// the portal + backdrop + slideUpSheet animation idiom from
// components/CommitmentSheet.tsx, but solves four things no existing sheet
// in this codebase needs to:
//
// 1. An internally scrolling message thread (its own overflow-y-auto
//    region; new-message autoscroll targets THIS container, not the page,
//    since a capped-height sheet has no page scroll to rely on).
// 2. A composer docked to the sheet's own bottom edge while the thread
//    scrolls independently above it, by giving the panel a flex column
//    layout (header shrink-0, thread flex-1 min-h-0 overflow-y-auto,
//    composer shrink-0) instead of copying PennyConversation.tsx's
//    composer, which is `position: fixed; bottom: calc(88px + safe-area)`
//    calibrated to float above the page's own nav rail. That's wrong
//    inside a sheet, which has no nav rail below it, and would either
//    hide behind the sheet's own bottom edge or float in the wrong place.
// 3. On-screen keyboard avoidance, ported from components/BankPickerSheet.tsx's
//    window.visualViewport technique (the only precedent in this codebase),
//    pushing the whole panel up via margin-bottom rather than resizing it.
// 4. Sheet-over-sheet: the offer chip opens StubOfferSheet.tsx, a stand-in
//    for the real CommitmentSheet, at a deliberately higher z-index tier
//    (see StubOfferSheet.tsx's own comment) so stacking is a contract, not
//    DOM-order luck.

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { Send } from "lucide-react";
import { useLockBodyScroll } from "@/lib/useLockBodyScroll";
import { useSheetA11y } from "@/lib/useSheetA11y";
import { useSheetOpen } from "@/lib/useSheetOpen";
import PennyMark from "@/components/PennyMark";
import { BRAND_GRADIENT } from "@/lib/brand";
import CardsGrammar from "./CardsGrammar";
import BubblesGrammar from "./BubblesGrammar";
import StubOfferSheet from "./StubOfferSheet";
import { cannedReply, type ThreadItem } from "./fixtures";

export type Grammar = "cards" | "bubbles";

function reducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** Requirement 3: on-screen keyboard avoidance, same technique as
 * components/BankPickerSheet.tsx (visualViewport shrinks when the keyboard
 * appears, window.innerHeight does not) re-implemented locally so this
 * route stays self-contained. */
function useKeyboardInset(): number {
  const [inset, setInset] = useState(0);
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const update = () => setInset(Math.max(0, window.innerHeight - vv.height - vv.offsetTop));
    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);
    return () => {
      vv.removeEventListener("resize", update);
      vv.removeEventListener("scroll", update);
    };
  }, []);
  return inset;
}

function GrammarSwitch({ grammar, onChange }: { grammar: Grammar; onChange: (g: Grammar) => void }) {
  return (
    <div
      role="radiogroup"
      aria-label="Answer grammar"
      className="inline-flex items-center rounded-full bg-slate-100 dark:bg-slate-700/60 p-0.5 flex-shrink-0"
    >
      {(["cards", "bubbles"] as const).map((g) => (
        <button
          key={g}
          type="button"
          role="radio"
          aria-checked={grammar === g}
          onClick={() => onChange(g)}
          className={`min-h-[32px] px-3 rounded-full text-[12px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${
            grammar === g
              ? "bg-white dark:bg-slate-900 text-indigo-600 dark:text-indigo-400 shadow-sm"
              : "text-slate-500 dark:text-slate-400"
          }`}
        >
          {g === "cards" ? "Cards" : "Bubbles"}
        </button>
      ))}
    </div>
  );
}

export default function PennySheet({
  grammar,
  onGrammarChange,
  items,
  onSend,
  onClose,
}: {
  grammar: Grammar;
  onGrammarChange: (g: Grammar) => void;
  items: ThreadItem[];
  onSend: (question: string) => void;
  onClose: () => void;
}) {
  useLockBodyScroll();
  useSheetOpen();
  const panelRef = useSheetA11y<HTMLDivElement>(onClose);
  const threadRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [input, setInput] = useState("");
  const [offerOpen, setOfferOpen] = useState<string | null>(null);
  const keyboardInset = useKeyboardInset();

  // Requirement 1: autoscroll targets the thread's OWN scroll container,
  // not the page. Fires on open and whenever the item count changes (a new
  // composer turn appended, or a pending turn resolved in place).
  useEffect(() => {
    const el = threadRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: reducedMotion() ? "auto" : "smooth" });
  }, [items.length]);

  function handleSend() {
    const q = input.trim();
    if (!q) return;
    onSend(q);
    setInput("");
  }

  const Grammar = grammar === "cards" ? CardsGrammar : BubblesGrammar;

  return createPortal(
    <>
      <div className="fixed inset-0 bg-black/40 z-[65] fade-in" onClick={onClose} />
      <div
        className="fixed inset-x-0 bottom-0 z-[70]"
        style={reducedMotion() ? undefined : { animation: "slideUpSheet 280ms cubic-bezier(0.32, 0.72, 0, 1) both" }}
      >
        <div
          ref={panelRef}
          role="dialog"
          aria-modal="true"
          aria-label="Ask Penny"
          className="mx-auto w-full max-w-[500px] glass-sheet rounded-t-3xl flex flex-col transition-[margin] duration-100"
          style={{ maxHeight: "88dvh", marginBottom: keyboardInset }}
        >
          {/* Header — flex-shrink-0, stays put while the thread scrolls. */}
          <div className="flex-shrink-0 px-4 pt-3">
            <div className="mx-auto w-10 h-1 bg-slate-200 dark:bg-slate-600 rounded-full mb-2" />
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <span
                  className="rounded-xl flex items-center justify-center flex-shrink-0"
                  style={{ background: BRAND_GRADIENT, width: 28, height: 28 }}
                >
                  <PennyMark size={13} className="text-white" />
                </span>
                <h2 className="text-[16px] font-bold text-slate-900 dark:text-slate-100 truncate">Ask Penny</h2>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                <GrammarSwitch grammar={grammar} onChange={onGrammarChange} />
                <button
                  type="button"
                  onClick={onClose}
                  aria-label="Close"
                  className="w-9 h-9 min-w-[44px] min-h-[44px] -m-2.5 flex items-center justify-center rounded-full bg-slate-100 dark:bg-slate-700 active:scale-90 transition-transform focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
                >
                  <X size={15} className="text-slate-500 dark:text-slate-400" />
                </button>
              </div>
            </div>
          </div>

          {/* Thread — requirement 1: its own scroll container. */}
          <div
            ref={threadRef}
            role="log"
            aria-live="polite"
            className="flex-1 min-h-0 overflow-y-auto px-4 py-4"
          >
            <Grammar items={items} onOfferTap={(label) => setOfferOpen(label)} />
          </div>

          {/* Composer — requirement 2: a normal flex-shrink-0 child at the
              end of the column, docked to the SHEET's own bottom edge, not
              position:fixed to the viewport. Requirement 3: the panel's
              own margin-bottom (keyboardInset, above) keeps this clear of
              an on-screen keyboard. */}
          <div
            className="flex-shrink-0 border-t border-slate-200/70 dark:border-slate-700 px-3 pt-2.5"
            style={{ paddingBottom: "max(12px, env(safe-area-inset-bottom, 0px))" }}
          >
            <div className="flex items-center gap-2">
              <input
                ref={inputRef}
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleSend()}
                placeholder="Ask Penny: Can I spend £45 this weekend?"
                aria-label="Ask Penny a spending question"
                maxLength={160}
                className="flex-1 min-h-[44px] text-sm bg-slate-50 dark:bg-slate-700 dark:text-slate-100 rounded-full px-4 py-2 outline-none border border-slate-200 dark:border-slate-600 focus:border-violet-300 focus-visible:ring-2 focus-visible:ring-indigo-500"
              />
              <button
                type="button"
                onClick={handleSend}
                disabled={!input.trim()}
                aria-label="Send"
                className="flex-shrink-0 w-11 h-11 rounded-full flex items-center justify-center disabled:opacity-40 text-white active:scale-95 transition-transform focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
                style={{ background: BRAND_GRADIENT }}
              >
                <Send className="w-4 h-4" />
              </button>
            </div>
            <p className="text-[11px] leading-snug text-slate-500 dark:text-slate-400 mt-1.5 pb-1">
              General information, not regulated financial advice.
            </p>
          </div>
        </div>
      </div>

      {/* Requirement 4: sheet-over-sheet, deliberately a full tier above
          (z-[75]/z-[80] vs this sheet's z-[65]/z-[70]). Closing it leaves
          this sheet's items/scroll/input state untouched underneath. */}
      {offerOpen && <StubOfferSheet label={offerOpen} onClose={() => setOfferOpen(null)} />}
    </>,
    document.body
  );
}
