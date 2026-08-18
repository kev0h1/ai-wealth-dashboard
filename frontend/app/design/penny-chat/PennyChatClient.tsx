"use client";

// TEMPORARY PREVIEW — delete after design review.
//
// Interactive throwaway preview of the approved "one Penny, three doors,
// zero bubbles" conversation design — fixture-powered, no auth, no live
// LLM, so the owner can feel the flow on his phone.
//
// Two scenes in one client:
//   Scene 1 "The door" — a mock Planning-page context (muted, non-interactive
//   fixture cards) with the Penny prompt bar + context chips as the ONLY
//   interactive elements.
//   Scene 2 "Penny" — a full-screen takeover: header, condensed structured
//   cards, the conversation (compact user line + full-width verdict card),
//   persistent suggestion chips, and a docked composer.
//
// Reference idioms this preview draws from (styling only, not imported):
// components/CanISection.tsx (the sheet/thread/offer state machine + QUICK
// chips this design REPLACES), components/PennyMark.tsx, lib/brand.ts
// (BRAND_GRADIENT — Penny-identity elements only, per the Penny Gradient
// Rule), components/CommitmentSheet.tsx (house sheet idiom).
//
// Deep-linkable: /design/penny-chat?mode=light|dark&open=1&q=0|1|2|3
// `open=1` renders Scene 2 already showing that Q&A answered (q indexes
// into QA_FIXTURES; q=0-2 match the three visible CHIPS, q=3 is the
// calm-bad-news fixture that has no visible chip) — makes review and
// screenshots possible without a tap.

import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { X, Send } from "lucide-react";
import PennyMark from "@/components/PennyMark";
import { BRAND_GRADIENT } from "@/lib/brand";
import { CHIPS, QA_FIXTURES, OUT_OF_SCOPE_FIXTURE, DOOR_CARDS, PENNY_ROWS, CONTEXT_WHISPER } from "./fixtures";

type Mode = "light" | "dark";
type Scene = "door" | "penny";

type Msg =
  | { kind: "user"; text: string }
  | { kind: "verdict"; headline: string; facts?: string[]; offer?: string };

function parseDeepLinkIndex(open: string | null, q: string | null): number | null {
  if (open !== "1") return null;
  const idx = q !== null ? parseInt(q, 10) : 0;
  if (!Number.isFinite(idx) || idx < 0 || idx >= QA_FIXTURES.length) return null;
  return idx;
}

/** Penny gradient chip — small mark, Penny-identity only (never on cards/backgrounds). */
function PennyTile({ size = 36, iconSize = 16 }: { size?: number; iconSize?: number }) {
  return (
    <span
      className="rounded-xl flex items-center justify-center flex-shrink-0"
      style={{ background: BRAND_GRADIENT, width: size, height: size }}
    >
      <PennyMark size={iconSize} className="text-white" />
    </span>
  );
}

/** Rounded suggestion-chip pill — 44px touch target. Used on both scenes. */
function SuggestionChip({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="min-h-[44px] inline-flex items-center text-[13px] font-medium px-4 rounded-full border border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-700/60 text-slate-600 dark:text-slate-300 active:scale-95 transition-transform focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
    >
      {label}
    </button>
  );
}

/** Full-width verdict card — headline bold, 2-3 muted grounding facts, an
 * optional indigo offer chip. This is the answer surface itself, not a chat
 * bubble. */
function VerdictCard({ headline, facts, offer }: { headline: string; facts?: string[]; offer?: string }) {
  return (
    <div className="glass-card rounded-2xl p-4 w-full">
      <p className="text-[16px] font-bold leading-snug text-slate-900 dark:text-slate-100">{headline}</p>
      {facts && facts.length > 0 && (
        <div className="mt-2 space-y-1">
          {facts.map((f, i) => (
            <p key={i} className="text-[13px] leading-snug text-slate-500 dark:text-slate-400">
              {f}
            </p>
          ))}
        </div>
      )}
      {offer && (
        <button
          type="button"
          className="mt-3 min-h-[44px] inline-flex items-center text-[13px] font-semibold text-indigo-600 dark:text-indigo-400 border border-indigo-200 dark:border-indigo-800 bg-indigo-50/60 dark:bg-indigo-900/20 rounded-full px-4 py-2 active:scale-95 transition-transform focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
        >
          {offer}
        </button>
      )}
    </div>
  );
}

/** Compact right-aligned user line — quiet, small, NOT an SMS bubble. */
function UserLine({ text }: { text: string }) {
  return (
    <div className="flex justify-end">
      <p className="max-w-[85%] text-[13px] text-slate-500 dark:text-slate-400 text-right leading-snug">{text}</p>
    </div>
  );
}

export default function PennyChatClient() {
  const searchParams = useSearchParams();
  const mode: Mode = searchParams.get("mode") === "dark" ? "dark" : "light";
  const deepLinkIdx = parseDeepLinkIndex(searchParams.get("open"), searchParams.get("q"));

  const [scene, setScene] = useState<Scene>(deepLinkIdx !== null ? "penny" : "door");
  // Already-open deep link renders with no animate-in (entered starts true);
  // a real tap starts entered=false so the enter transition plays.
  const [entered, setEntered] = useState(deepLinkIdx !== null);
  const [messages, setMessages] = useState<Msg[]>(() =>
    deepLinkIdx !== null
      ? [
          { kind: "user", text: QA_FIXTURES[deepLinkIdx].question },
          {
            kind: "verdict",
            headline: QA_FIXTURES[deepLinkIdx].headline,
            facts: QA_FIXTURES[deepLinkIdx].facts,
            offer: QA_FIXTURES[deepLinkIdx].offer,
          },
        ]
      : []
  );
  const [askedSet, setAskedSet] = useState<Set<number>>(() => (deepLinkIdx !== null ? new Set([deepLinkIdx]) : new Set()));
  const [input, setInput] = useState("");
  const [wantsFocus, setWantsFocus] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const threadEndRef = useRef<HTMLDivElement>(null);

  // Theme toggle — same pattern as sibling /design/* routes.
  useEffect(() => {
    const t = setTimeout(() => {
      document.documentElement.classList.toggle("dark", mode === "dark");
      document.querySelector('meta[name="color-scheme"]')?.setAttribute("content", mode === "dark" ? "dark" : "only light");
    }, 0);
    return () => clearTimeout(t);
  }, [mode]);

  // Enter transition — plays whenever scene becomes "penny" from a fresh
  // (not-yet-entered) state; skipped for the already-open deep link. Resets
  // on返回 to the door so reopening replays it. The global reduced-motion
  // rule (globals.css) collapses the CSS transition to ~0ms on its own, no
  // extra branching needed here.
  useEffect(() => {
    if (scene === "penny" && !entered) {
      const id = requestAnimationFrame(() => requestAnimationFrame(() => setEntered(true)));
      return () => cancelAnimationFrame(id);
    }
    if (scene === "door") setEntered(false);
  }, [scene, entered]);

  useEffect(() => {
    if (scene === "penny" && wantsFocus) {
      const id = setTimeout(() => {
        inputRef.current?.focus();
        setWantsFocus(false);
      }, 260);
      return () => clearTimeout(id);
    }
  }, [scene, wantsFocus]);

  useEffect(() => {
    threadEndRef.current?.scrollIntoView({ block: "end" });
  }, [messages.length]);

  function openFromBar() {
    setScene("penny");
    setWantsFocus(true);
  }

  function askFixture(idx: number) {
    const f = QA_FIXTURES[idx];
    setMessages((prev) => [
      ...prev,
      { kind: "user", text: f.question },
      { kind: "verdict", headline: f.headline, facts: f.facts, offer: f.offer },
    ]);
    setAskedSet((prev) => new Set(prev).add(idx));
    setScene("penny");
  }

  function closePenny() {
    setScene("door");
    setMessages([]);
    setAskedSet(new Set());
    setInput("");
  }

  function sendFreeText() {
    const trimmed = input.trim();
    if (!trimmed) return;
    setMessages((prev) => [
      ...prev,
      { kind: "user", text: trimmed },
      { kind: "verdict", headline: OUT_OF_SCOPE_FIXTURE.headline, facts: OUT_OF_SCOPE_FIXTURE.facts },
    ]);
    setInput("");
  }

  const remainingChips = CHIPS.map((c, i) => i).filter((i) => !askedSet.has(i));

  return (
    <div className={mode === "dark" ? "dark" : ""}>
      <div className="min-h-dvh bg-[#f0f2f7] dark:bg-[#0f172a]">
        {/* ── Scene 1 — The door ─────────────────────────────────────────── */}
        <div className="mx-auto w-full max-w-[430px] px-4 pt-6 pb-10">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500 mb-3">
            Planning (preview context)
          </p>

          {/* Mock Planning cards — fixture data, muted/non-interactive. Not
              the real components: simplified stand-ins so review attention
              stays on the prompt bar below. */}
          <div className="space-y-3 select-none">
            <div className="glass-card-flat rounded-2xl px-4 py-4">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 mb-0.5">
                {DOOR_CARDS.runway.label}
              </p>
              <p className="text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
                {DOOR_CARDS.runway.amount}
              </p>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">{DOOR_CARDS.runway.sub}</p>
            </div>

            <div className="glass-card-flat rounded-2xl p-4">
              <p className="text-[15px] font-semibold text-slate-900 dark:text-slate-100">{DOOR_CARDS.japan.label}</p>
              <p className="text-[12px] text-slate-500 dark:text-slate-400 mt-0.5">{DOOR_CARDS.japan.sub}</p>
              <div className="mt-2 h-1.5 rounded-full bg-slate-100 dark:bg-slate-700 overflow-hidden">
                <div className="h-full rounded-full bg-indigo-500" style={{ width: `${DOOR_CARDS.japan.pct}%` }} />
              </div>
            </div>
          </div>

          {/* The Penny prompt bar — the only interactive elements on this
              scene are this bar and the chips below it. */}
          <div className="mt-4">
            <button
              type="button"
              onClick={openFromBar}
              className="w-full glass-card rounded-2xl min-h-[44px] px-3.5 py-3 flex items-center gap-2.5 text-left active:scale-[0.99] transition-transform focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
            >
              <PennyTile size={28} iconSize={13} />
              <span className="text-[14px] text-slate-400 dark:text-slate-500 truncate">
                Ask Penny&hellip; Can I spend £45 this weekend?
              </span>
            </button>

            <div className="mt-2.5 flex flex-wrap gap-2">
              {CHIPS.map((c, i) => (
                <SuggestionChip key={c} label={c} onClick={() => askFixture(i)} />
              ))}
            </div>
            <p className="text-[11px] leading-snug text-slate-400 dark:text-slate-500 mt-2">
              Suggestions come from your own spending and plans.
            </p>
          </div>
        </div>

        {/* ── Scene 2 — Penny (full-screen takeover) ────────────────────── */}
        {scene === "penny" && (
          <div
            className="fixed inset-0 z-40 flex flex-col bg-[#f0f2f7] dark:bg-[#0f172a]"
            style={{
              transform: entered ? "translateY(0)" : "translateY(18px)",
              opacity: entered ? 1 : 0,
              transition: "transform 250ms ease-out, opacity 250ms ease-out",
            }}
            role="dialog"
            aria-modal="true"
            aria-label="Penny"
          >
            {/* Header */}
            <div
              className="flex-shrink-0 flex items-center gap-3 px-4 pb-3 border-b border-slate-200/70 dark:border-slate-800"
              style={{ paddingTop: "calc(0.75rem + env(safe-area-inset-top, 0px))" }}
            >
              <PennyTile />
              <div className="flex-1 min-w-0">
                <p className="text-base font-semibold text-slate-900 dark:text-slate-100 leading-tight">Penny</p>
                <p className="text-[12px] text-slate-500 dark:text-slate-400 mt-0.5">{CONTEXT_WHISPER}</p>
              </div>
              <button
                type="button"
                onClick={closePenny}
                aria-label="Close"
                className="w-10 h-10 flex items-center justify-center rounded-full bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400 flex-shrink-0 active:bg-slate-200 dark:active:bg-slate-600 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
              >
                <X size={16} />
              </button>
            </div>

            {/* Scrollable body — condensed structured cards + conversation */}
            <div className="flex-1 overflow-y-auto px-4 pt-3">
              <div className="space-y-2 mb-4 select-none">
                {PENNY_ROWS.map((r) => (
                  <div
                    key={r}
                    className="glass-card-flat rounded-2xl px-4 py-3 flex items-center justify-between"
                  >
                    <span className="text-[13px] font-medium text-slate-700 dark:text-slate-300">{r}</span>
                    <span className="text-slate-300 dark:text-slate-600 text-[13px]">›</span>
                  </div>
                ))}
              </div>

              {messages.length > 0 && (
                <div aria-live="polite" role="log" className="space-y-3 pb-2">
                  {messages.map((m, i) =>
                    m.kind === "user" ? (
                      <UserLine key={i} text={m.text} />
                    ) : (
                      <VerdictCard key={i} headline={m.headline} facts={m.facts} offer={m.offer} />
                    )
                  )}
                  <div ref={threadEndRef} />
                </div>
              )}
            </div>

            {/* Suggestion chips — persist above the composer, seeded with
                the unasked questions (the research fix: chips survive an
                answer instead of disappearing). */}
            {remainingChips.length > 0 && (
              <div className="flex-shrink-0 px-4 pb-2 flex flex-wrap gap-2">
                {remainingChips.map((i) => (
                  <SuggestionChip key={CHIPS[i]} label={CHIPS[i]} onClick={() => askFixture(i)} />
                ))}
              </div>
            )}

            {/* Docked composer */}
            <div
              className="flex-shrink-0 px-4 pt-2 border-t border-slate-200/70 dark:border-slate-800"
              style={{ paddingBottom: "calc(0.75rem + env(safe-area-inset-bottom, 0px))" }}
            >
              <div className="flex items-center gap-2">
                <input
                  ref={inputRef}
                  type="text"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && sendFreeText()}
                  placeholder="Ask Penny: Can I spend £45 this weekend?"
                  maxLength={160}
                  className="flex-1 min-h-[44px] text-sm bg-slate-50 dark:bg-slate-700 dark:text-slate-100 rounded-full px-4 py-2 outline-none border border-slate-200 dark:border-slate-600 focus:border-violet-300"
                />
                <button
                  type="button"
                  onClick={sendFreeText}
                  disabled={!input.trim()}
                  aria-label="Ask"
                  className="flex-shrink-0 w-11 h-11 rounded-full flex items-center justify-center disabled:opacity-40 text-white active:scale-95 transition-transform"
                  style={{ background: BRAND_GRADIENT }}
                >
                  <Send className="w-4 h-4" />
                </button>
              </div>
              <p className="text-[11px] leading-snug text-slate-400 dark:text-slate-500 mt-2">
                General information, not regulated financial advice.
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
