"use client";

// The bounded Penny oracle — productionised from the approved design at
// app/design/penny-chat/PennyChatClient.tsx, then converted from full-width
// verdict cards to messenger bubbles (2026-08-25) per the owner's side-by-
// side call on app/design/penny-sheet/{CardsGrammar,BubblesGrammar}.tsx:
// people expect bubbles in a conversation. Ported treatment (do not
// re-litigate): user turn right-aligned `bg-violet-600 text-white
// rounded-2xl rounded-br-sm`, Penny turn left-aligned `bg-slate-100
// dark:bg-slate-700 rounded-2xl rounded-bl-sm`. Contrast checked at build
// time: white-on-violet-600 is ~5.70:1, clears WCAG AA's 4.5:1 for normal
// text with room to spare.
//
// The one thing the owner was hesitant about with bubbles survives the
// conversion: inside Penny's bubble the verdict headline is still the
// FIRST and HEAVIEST element (bold, 15px), then the reasoning sentence
// (14px, mid-muted), then the grounding facts (13px, lightest), then the
// offer chip. A bubble must never flatten that hierarchy — see
// VerdictBubble below. The explainer treatment (general knowledge, no
// verdict) keeps its quiet uppercase TAX eyebrow and never gets a bold
// headline, so it still reads as information rather than a read on the
// user's money — see ExplainerBubble below.
//
// Retires CanISection.tsx's launcher/bottom-sheet presentation (nothing
// imports that file live any more — it was only reachable via the nav's
// controlled-open prop and the Penny screen's now-removed inline mode) but
// keeps its state machine intact: ask/send/retry, the offer hand-off, and
// the CommitmentSheet round-trip.
//
// Two rendering modes, selected by the `inSheet` prop:
// - Full-page (inSheet falsy, unchanged): thread scrolls with the page,
//   composer is `position: fixed` docked above BottomNav. Used today by
//   app/penny/PennyPage.tsx.
// - Sheet (inSheet true): thread scrolls its OWN container (this component
//   renders a `flex flex-col h-full` shell with an internal
//   `overflow-y-auto` thread pane), autoscroll targets that container
//   directly instead of page-level `scrollIntoView`, and the composer
//   renders as a plain flow child (no `fixed` positioning) so the sheet's
//   own flex column places it at the bottom. A caller must give this
//   component a bounded-height box to sit in for `h-full` to resolve.
//
// `askContext` (sheet callers only) carries what screen opened Penny:
// - `askContext.ask` fires once PER OPEN, not once per component lifetime
//   — deliberately NOT the same semantics as `initialQuestion`/
//   `initialFiredRef` below, even though it looks like the sheet-mode
//   equivalent. `initialQuestion` targets a full-page mount, which really
//   does only happen once; this component is mounted exactly ONCE for the
//   whole session (PennySheetProvider keeps it alive across every
//   close/reopen so the thread survives), so a plain "have I ever fired"
//   ref here would submit the session's first `open({ask: ...})` and
//   silently do nothing on every one after — the composer just opens
//   empty. Guarded instead by `askSeq` (PennySheetProvider's `openSeq`,
//   passed through by PennySheet.tsx), a token that changes on every
//   `open()` call including a reopen, so "already handled" means "already
//   handled THIS open" — see `askSeqHandledRef` and its effect below.
// - `askContext.summary` grounds the FIRST request from that screen, sent
//   as its own `context` argument to `api.canI` (lib/api.ts, added
//   2026-08-25 for exactly this). It must NEVER be concatenated into the
//   question string sent to POST /can-i — an earlier version of this file
//   did that, and it was a live bug, not a style choice: the backend's
//   deterministic gates (`_extract_amount`, the spend/planning/debt domain
//   router's tier-1 checks, `_is_out_of_scope`, `_is_tax_question`) parse
//   `question` verbatim before any LLM runs. Planning's context line reads
//   like "£165 free · 4 days left" — concatenate that in front of an
//   amount-free question and `_extract_amount` sees an amount that was
//   never asked about, silently mis-routing exactly the screens that pass
//   context. `context` stays a structurally separate field, used only as
//   LLM grounding, so this can't happen. See `send()`'s
//   `summaryConsumedRef` for the one-request-per-screen limit.
// - `askContext.paydayActive` (REVISED 2026-08-25, direct owner feedback:
//   "every time I open it sends the message what is happening with my
//   payday, does this go straight to the llm" — yes, it did, and it was
//   rejected). The original version of this auto-fired one real, grounded
//   question to /can-i on every open in the payday window — a real LLM call
//   and quota unit the user never asked for, and a fake user bubble he
//   never typed. That's gone. The replacement (`paydayLead` state, its own
//   comment, and the effect below) is a deterministic, LLM-free lead built
//   entirely from `api.safeToSpend()` fields — no network round-trip beyond
//   that one fetch, no /can-i call, no fabricated user turn — rendered only
//   when the thread is EMPTY (a live conversation is never interrupted).
//   Same `askSeq`-keyed, once-per-open treatment as `askContext.ask` above
//   (see `paydaySeqHandledRef`) — the payday window can still be active on
//   a later open, and the lead's numbers (`days_until_payday` etc.) should
//   refresh then too, not just the first time this session.
//
// Backend contract (CONTRACT, may not be live yet):
//   GET /can-i/suggestions -> { chips: [{ label }], context_line }
//   POST /can-i now ALSO returns { headline, facts, out_of_scope } alongside
//   the existing { reply, offer }. Both new surfaces degrade gracefully:
//   canISuggestions() failing just means no chips/context line (every call
//   site treats it as decorative, fire-and-forget); a /can-i reply with no
//   `headline` renders `reply` as plain body text in the same bubble shell
//   instead of a bold verdict headline (see AssistantBubble's `degraded` case).

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Send, Loader2, X, ChevronRight } from "lucide-react";
import { api, CanIOffer, CanISuggestionChip, ScenarioItem } from "@/lib/api";
import { BRAND_GRADIENT } from "@/lib/brand";
import PennyMark from "@/components/PennyMark";
import CommitmentSheet from "@/components/CommitmentSheet";
import MoneyText from "@/components/MoneyText";
import ChatMarkdown from "@/components/ChatMarkdown";
import type { PennyAskContext } from "@/components/PennySheetProvider";
import { usePennySheet } from "@/components/PennySheetProvider";
import { getPennyScreenConfig, type PennyChip } from "@/lib/pennyScreenConfig";

const BG = BRAND_GRADIENT;
const HISTORY_CAP = 6;
const DEFAULT_PLACEHOLDER = "Ask Penny: Can I spend £45 this weekend?";

// Every message carries a stable `id`, assigned once at creation (see
// `newMsgId()` below) and never recomputed. Keying the thread render on
// this instead of array index matters because `messages` is a SLIDING
// WINDOW (every `setMessages` call ends in `.slice(-HISTORY_CAP)`) — once
// the thread exceeds the cap, index-keyed nodes have content shift under
// them instead of nodes being added/removed, and `ScenarioConfirmCard`'s
// lazy `useState(() => items.map(toDraft))` initialiser only runs on
// mount, so a reused instance under a shifted index kept a STALE draft
// from a different scenario message.
type UserMsg = { id: number; role: "user"; content: string };
type VerdictMsg = {
  id: number;
  role: "assistant";
  kind: "verdict";
  headline: string;
  /** The reasoning sentence(s) behind the headline, from POST /can-i's
   * `reply` field. `headline` is the verdict alone (under 8 words); this is
   * the "why" that makes the verdict legible instead of an abrupt one-liner
   * over generic stats. Left unset on the degraded paths below, where
   * `reply`'s content already lives in `headline` itself, so there's
   * nothing to duplicate. */
  reply?: string;
  facts?: string[];
  offer?: CanIOffer | null;
  outOfScope?: boolean;
  /** True when this came from a backend that doesn't ship headline/facts
   * yet — `headline` here is actually the raw `reply` string, rendered as
   * plain body text rather than a bold verdict headline. */
  degraded: boolean;
};
/** The slot-confirm gate for a "what if" scenario question — the deliberate
 * anti-chatbot step in this feature. POST /can-i's deterministic classifier
 * (backend/app/routers/scenario.py's `looks_like_scenario`) routes an
 * ongoing/future-dated money question here instead of a normal verdict; the
 * user must see and be able to correct exactly what will be simulated
 * before any numbers are produced. Rendered by ScenarioConfirmCard below;
 * "Run it" pushes the (possibly edited) items straight to /scenario. */
type ScenarioMsg = {
  id: number;
  role: "assistant";
  kind: "scenario";
  items: ScenarioItem[];
  rejected: string[];
  prefilled: boolean;
};
/** A general-knowledge answer (tax, currently the only topic) that isn't
 * grounded in the user's own balances — the fold-in of the retired TaxChat
 * popup (components/TaxChat.tsx, now deleted; see TaxPennyEntry.tsx for its
 * replacement entry point). Deliberately its own kind rather than a
 * degraded VerdictMsg: an explainer is markdown prose, not a headline +
 * facts, and giving it verdict weight would be exactly the mistake a design
 * review already flagged on this file (see ExplainerBubble below). */
type ExplainerMsg = {
  id: number;
  role: "assistant";
  kind: "explainer";
  reply: string;
  /** `| null` mirrors CanIResponse['topic'] — the backend sends explicit
   * JSON `null` on paths that aren't an explainer, not just an absent
   * field. `msg.topic && (...)` in ExplainerBubble treats both the same. */
  topic?: string | null;
};
type AssistantMsg = VerdictMsg | ScenarioMsg | ExplainerMsg;
type Msg = UserMsg | AssistantMsg;

function reducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** Deterministic short form for a personalised `canISuggestions` chip
 * (2026-08-25, owner: chips "could be summarised and when the user selects
 * it, it fully populates"). These chips are always backend-phrased as "Can
 * I spend/put/afford <the interesting part>?" (lib/api.ts's
 * CanISuggestionChip, api.canISuggestions()), so stripping that fixed
 * lead-in leaves just the amount/context that actually varies, e.g. "Can I
 * spend £35 this week?" -> "£35 this week?". Falls back to the full label
 * unchanged when it doesn't start with one of those three lead-ins, rather
 * than guessing at a truncation that could cut the actual figure off —
 * this only ever shortens, never rewrites. The FULL label is still what's
 * sent to `/can-i` and what a screen reader hears (see the chip row's own
 * `ariaLabel` usage below); this is display-only. */
function shortPersonalisedLabel(label: string): string {
  const m = label.match(/^Can I (?:spend|put|afford) (.+)$/i);
  return m ? m[1] : label;
}

/** Distance-aware date label for the payday lead's facts (see `paydayLead`
 * below) — same today/tomorrow/weekday-name/short-date convention already
 * used for `next_payday` in HomeBrief.tsx's `paydaySubline` and
 * SafeToSpendCard.tsx's own date line, so this doesn't invent a new date
 * format for the same field. */
function formatPaydayDateLabel(iso: string): string {
  const d = new Date(iso);
  d.setHours(0, 0, 0, 0);
  const today0 = new Date();
  today0.setHours(0, 0, 0, 0);
  const daysAway = Math.round((d.getTime() - today0.getTime()) / 86400000);
  if (daysAway <= 0) return "today";
  if (daysAway === 1) return "tomorrow";
  if (daysAway < 7) return new Date(iso).toLocaleDateString("en-GB", { weekday: "long" });
  return new Date(iso).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
}

/** Right-aligned filled user bubble with a tail — the retired TaxChat
 * popup's exact treatment (`bg-violet-600 text-white rounded-2xl
 * rounded-br-sm`), ported per the owner's bubbles-over-cards call (see this
 * file's header comment). Capped at 85% width; Penny's bubble below is
 * deliberately wider, they are not symmetric in importance. White-on-
 * violet-600 measures ~5.70:1 contrast, clears WCAG AA (4.5:1). */
function UserBubble({ text }: { text: string }) {
  return (
    <div className="flex justify-end">
      <div className="max-w-[85%] bg-violet-600 text-white rounded-2xl rounded-br-sm px-4 py-2.5">
        <p className="text-[14px] leading-snug break-words"><MoneyText text={text} /></p>
      </div>
    </div>
  );
}

/** Left-aligned muted bubble with a tail — Penny's turn. Wider than
 * UserBubble (90% vs 85%) on purpose: a verdict headline must never wrap
 * into a cramped column just to keep the two bubble widths symmetric. */
const PENNY_BUBBLE = "max-w-[90%] bg-slate-100 dark:bg-slate-700 rounded-2xl rounded-bl-sm px-4 py-3";

/** Penny's answer bubble. Anatomy is unchanged from the retired full-width
 * the retired full-width VerdictCard, just re-shelled into a bubble — bold headline first and
 * heaviest, then the reasoning sentence, then the muted grounding facts,
 * then the offer chip. This ordering/weighting is the non-negotiable part
 * of the bubbles conversion (see this file's header comment): a bubble
 * must never flatten the headline to the same weight as the facts.
 * Degraded (old-backend) replies render as plain 14px body text instead of
 * a bold headline, with no facts list. Out-of-scope answers use the exact
 * same bubble anatomy as any other verdict — no separate visual treatment. */
function VerdictBubble({ msg, onOfferTap }: { msg: VerdictMsg; onOfferTap: () => void }) {
  return (
    <div className="flex justify-start">
      <div className={PENNY_BUBBLE}>
        {msg.degraded ? (
          <p className="text-[14px] leading-relaxed text-slate-700 dark:text-slate-200 break-words"><MoneyText text={msg.headline} /></p>
        ) : (
          <p className="text-[15px] font-bold leading-snug text-slate-900 dark:text-slate-100 break-words"><MoneyText text={msg.headline} /></p>
        )}
        {/* Middle tier: the reasoning sentence behind the verdict. Suppressed
            for two cases where it would echo something already on screen:
            - `outOfScope`: the `facts` array below is deliberately doing the
              explaining here (see this file's header comment) — `reply` on
              that path is just a paraphrase of the same scope statement plus
              the same worked example already in `facts`, so showing both
              prints the "try: Can I spend £50..." example twice.
            - `reply.startsWith(headline)`: the backend's defensive
              `_parse_headline_reply` (can_i.py) sets `headline` to the FIRST
              SENTENCE of `reply`, not necessarily the whole string, when the
              model ignores the structured-output format. Plain inequality
              only catches the case where they're identical; a model output
              like reply="Yes. That leaves £61 free until Friday." with
              headline="Yes." would pass `!==` and still duplicate the "Yes."
              fragment across both tiers. Don't simplify this back to `!==`. */}
        {msg.reply && !msg.outOfScope && !msg.reply.startsWith(msg.headline) && (
          <p className="mt-1.5 text-[14px] leading-relaxed text-slate-600 dark:text-slate-300 break-words">
            <MoneyText text={msg.reply} />
          </p>
        )}
        {msg.facts && msg.facts.length > 0 && (
          <div className="mt-2 space-y-1">
            {msg.facts.map((f, i) => (
              <p key={i} className="text-[13px] leading-snug text-slate-500 dark:text-slate-400 break-words">
                <MoneyText text={f} />
              </p>
            ))}
          </div>
        )}
        {msg.offer && (
          <button
            type="button"
            onClick={onOfferTap}
            className="mt-3 min-h-[44px] inline-flex items-center text-[13px] font-semibold text-indigo-600 dark:text-indigo-400 border border-indigo-200 dark:border-indigo-800 bg-white/70 dark:bg-indigo-900/20 rounded-full px-4 py-2 active:scale-95 transition-transform focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
          >
            {/* Routed through MoneyText (impeccable review, LOW, 2026-08-25)
                rather than a hand-rolled `font-mono tabular-nums` span, same
                as every other figure in this file — `.money`'s CSS (font
                family + tabular-nums only, no colour) is a strict superset
                of what the old span set by hand, so the button's own
                indigo text colour is untouched. Rounded formatting
                (`Math.round`, `toLocaleString("en-GB")`) is unchanged. */}
            <MoneyText text={`Set this up: £${Math.round(msg.offer.per_period).toLocaleString("en-GB")}/period ›`} />
          </button>
        )}
      </div>
    </div>
  );
}

/** Same bubble shell as VerdictBubble, but deliberately WITHOUT a bold
 * verdict headline. A tax explainer isn't grounded in the user's own
 * balances, so giving it verdict weight would overstate it; that mismatch
 * is what the retired TaxChat popup's replacement is specifically here to
 * avoid. This distinction is exactly what the bubbles conversion had to
 * preserve (see this file's header comment): the quiet uppercase topic
 * label (no gradient, no colour fill — the indigo-to-violet gradient
 * belongs to Penny's brand mark alone) stays at the top of the bubble, and
 * the body is markdown prose, never a bold headline. */
function ExplainerBubble({ msg }: { msg: ExplainerMsg }) {
  return (
    <div className="flex justify-start">
      <div className={PENNY_BUBBLE}>
        {msg.topic && (
          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 mb-1.5">
            {msg.topic}
          </p>
        )}
        <div className="text-[14px] leading-relaxed text-slate-700 dark:text-slate-200">
          <ChatMarkdown>{msg.reply}</ChatMarkdown>
        </div>
      </div>
    </div>
  );
}

/** The deterministic payday lead — see `paydayLead`'s state comment (in the
 * component below) for why this exists instead of an auto-submitted
 * question. Same PENNY_BUBBLE shell and bold-headline-then-muted-facts
 * anatomy as VerdictBubble, so it reads as one of Penny's turns rather than
 * a different kind of surface, but nothing here is a judgement call —
 * `headline` is a fixed string and `facts` are engine numbers already
 * formatted for display by the effect that builds this (see
 * `askContext.paydayActive`'s effect). No offer/button: the header's
 * existing "Your plan and updates" link (PennySheet.tsx) already reaches
 * the hub, so this lead stays a calm, one-way piece of information. Not a
 * `Msg`/rendered via `messages.map` on purpose — see `paydayLead`'s comment
 * and `buildHistory`'s comment for why it must never reach the LLM as a
 * prior turn. */
function PaydayLeadBubble({ headline, facts }: { headline: string; facts: string[] }) {
  return (
    <div className="flex justify-start">
      <div className={PENNY_BUBBLE}>
        <p className="text-[15px] font-bold leading-snug text-slate-900 dark:text-slate-100 break-words">{headline}</p>
        <div className="mt-2 space-y-1">
          {facts.map((f, i) => (
            <p key={i} className="text-[13px] leading-snug text-slate-500 dark:text-slate-400 break-words">
              <MoneyText text={f} />
            </p>
          ))}
        </div>
      </div>
    </div>
  );
}

const CADENCE_OPTIONS: { value: ScenarioItem["cadence"]; label: string }[] = [
  { value: "monthly", label: "Monthly" },
  { value: "weekly", label: "Weekly" },
  { value: "annual", label: "Annual" },
  { value: "one_off", label: "One off" },
];

/** "2026-10-01" -> "2026-10", for a native `type="month"` input's value. */
function toMonthValue(iso: string | null | undefined): string {
  return iso ? iso.slice(0, 7) : "";
}
/** "2026-10" -> "2026-10-01" — the backend always deals in first-of-month
 * ISO dates for `starts`/`ends` (see parse_question's own resolved-start
 * output), so editing keeps that shape. */
function fromMonthValue(month: string): string {
  return month ? `${month}-01` : "";
}

/** A single confirmable scenario item, editable in place. Amount is kept as
 * a draft string (not a controlled number) while typing — same convention
 * as SavingsGoalSheet's amount fields — parsed back to a number only when
 * the parent reads it out for "Run it" or a remove/reorder re-render. */
type DraftItem = Omit<ScenarioItem, "amount"> & { amountText: string };

function toDraft(item: ScenarioItem): DraftItem {
  const { amount, ...rest } = item;
  return { ...rest, amountText: String(amount) };
}
function fromDraft(draft: DraftItem): ScenarioItem {
  const { amountText, ...rest } = draft;
  const n = Number(amountText);
  return { ...rest, amount: Number.isFinite(n) ? n : 0 };
}

const FIELD_CLASS =
  "mt-1 w-full min-h-[44px] text-sm bg-slate-50 dark:bg-slate-700 dark:text-slate-100 rounded-xl px-3 py-2 outline-none border border-slate-200 dark:border-slate-600 focus:border-violet-300 focus-visible:ring-2 focus-visible:ring-indigo-500";
const FIELD_LABEL_CLASS = "text-[11px] font-medium text-slate-500 dark:text-slate-400";

/** The slot-confirm card — the deliberate anti-chatbot gate for a "what if"
 * question. Shows every extracted item as editable fields (label, amount,
 * cadence, start month, ongoing-or-end-month) so the user can see and
 * correct exactly what will be simulated before any numbers are produced.
 * Holds its own draft state seeded from the backend's extraction; nothing
 * is sent anywhere until "Run it". `rejected` (items the backend dropped,
 * e.g. over the 3-item cap) is surfaced quietly underneath rather than
 * silently giving the user less than they asked for.
 *
 * CARVE-OUT from the bubbles conversion (2026-08-25, do not "fix" this
 * later): this stays a full-width `glass-card`, never a bubble. It's an
 * editable FORM — text/amount/select inputs and a submit button — and a
 * form squeezed into an 85-90%-wide bubble with a speech-bubble tail is bad
 * on every axis: cramped fields, a tail pointing at nothing meaningful, and
 * a shape that visually promises "read this" when the actual affordance is
 * "fill this in". Every other assistant turn in this thread is a bubble;
 * this one is deliberately not, because it isn't conversation, it's a form. */
function ScenarioConfirmCard({
  items,
  rejected,
  prefilled,
  onRun,
}: {
  items: ScenarioItem[];
  rejected: string[];
  prefilled: boolean;
  onRun: (items: ScenarioItem[]) => void;
}) {
  const [drafts, setDrafts] = useState<DraftItem[]>(() => items.map(toDraft));

  function patch(i: number, next: Partial<DraftItem>) {
    setDrafts((prev) => prev.map((d, idx) => (idx === i ? { ...d, ...next } : d)));
  }
  function remove(i: number) {
    setDrafts((prev) => prev.filter((_, idx) => idx !== i));
  }

  return (
    <div className="glass-card rounded-2xl p-4 w-full">
      <p className="text-[16px] font-bold leading-snug text-slate-900 dark:text-slate-100">Here&apos;s what I understood</p>
      {drafts.length === 0 ? (
        <p className="mt-2 text-[14px] leading-relaxed text-slate-500 dark:text-slate-400">
          Everything was removed, nothing left to run.
        </p>
      ) : (
        <form
          className="mt-3 flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            onRun(drafts.map(fromDraft));
          }}
        >
          {drafts.map((d, i) => {
            const isAssumption = prefilled && d.kind === "income_change";
            const hasEnd = !!d.ends;
            return (
              <fieldset key={i} className="rounded-xl border border-slate-200 dark:border-slate-600 p-3">
                <div className="flex items-start justify-between gap-2">
                  <legend className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 px-0.5">
                    {d.kind === "removal" ? "Cancel" : d.kind === "income_change" ? "Income change" : "New cost"}
                  </legend>
                  <button
                    type="button"
                    onClick={() => remove(i)}
                    aria-label={`Remove ${d.label || "this item"}`}
                    className="relative w-7 h-7 flex items-center justify-center rounded-full text-slate-500 dark:text-slate-400 active:bg-slate-200 dark:active:bg-slate-600 transition-colors before:absolute before:-inset-y-2 before:-inset-x-1 before:content-[''] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
                  >
                    <X size={14} />
                  </button>
                </div>

                <label className="block mt-1.5">
                  <span className={FIELD_LABEL_CLASS}>Label</span>
                  <input
                    type="text"
                    value={d.label}
                    onChange={(e) => patch(i, { label: e.target.value })}
                    maxLength={40}
                    required
                    className={FIELD_CLASS}
                  />
                </label>

                <div className="mt-2 grid grid-cols-2 gap-2">
                  <label className="block">
                    <span className={FIELD_LABEL_CLASS}>
                      Amount
                      {isAssumption && (
                        <span className="ml-1 inline-flex items-center gap-1">
                          <span aria-hidden className="w-1.5 h-1.5 rounded-full bg-amber-600 dark:bg-amber-400 flex-shrink-0" />
                          assumption, check this
                        </span>
                      )}
                    </span>
                    <div className="relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 dark:text-slate-400 text-sm pointer-events-none select-none mt-0.5">£</span>
                      <input
                        type="text"
                        inputMode="decimal"
                        value={d.amountText}
                        onChange={(e) => patch(i, { amountText: e.target.value })}
                        required
                        className={`${FIELD_CLASS} pl-6 font-mono tabular-nums`}
                      />
                    </div>
                  </label>

                  <label className="block">
                    <span className={FIELD_LABEL_CLASS}>Cadence</span>
                    <select
                      value={d.cadence}
                      onChange={(e) => patch(i, { cadence: e.target.value as ScenarioItem["cadence"] })}
                      className={FIELD_CLASS}
                    >
                      {CADENCE_OPTIONS.map((c) => (
                        <option key={c.value} value={c.value}>{c.label}</option>
                      ))}
                    </select>
                  </label>
                </div>

                {/* Stacked, not a 2-col grid like the fields above — a
                    native `type="month"` control needs its full row to
                    display a longer month name (e.g. "September 2026")
                    without truncating against its own built-in icon. */}
                <label className="block mt-2">
                  <span className={FIELD_LABEL_CLASS}>Starts</span>
                  <input
                    type="month"
                    value={toMonthValue(d.starts)}
                    onChange={(e) => patch(i, { starts: fromMonthValue(e.target.value) })}
                    required
                    className={`${FIELD_CLASS} appearance-none text-left [&::-webkit-date-and-time-value]:text-left`}
                  />
                </label>

                <label className="block mt-2">
                  <span className={FIELD_LABEL_CLASS}>Duration</span>
                  <select
                    value={hasEnd ? "until" : "ongoing"}
                    onChange={(e) =>
                      patch(i, { ends: e.target.value === "ongoing" ? null : d.ends || d.starts })
                    }
                    className={FIELD_CLASS}
                  >
                    <option value="ongoing">Ongoing</option>
                    <option value="until">Ends</option>
                  </select>
                </label>

                {hasEnd && (
                  <label className="block mt-2">
                    <span className={FIELD_LABEL_CLASS}>End month</span>
                    <input
                      type="month"
                      value={toMonthValue(d.ends)}
                      onChange={(e) => patch(i, { ends: fromMonthValue(e.target.value) })}
                      required
                      className={`${FIELD_CLASS} appearance-none text-left [&::-webkit-date-and-time-value]:text-left`}
                    />
                  </label>
                )}
              </fieldset>
            );
          })}

          {rejected.length > 0 && (
            <p className="text-[12px] leading-snug text-slate-500 dark:text-slate-400 text-pretty">{rejected.join(" ")}</p>
          )}

          <button
            type="submit"
            className="min-h-[44px] rounded-xl text-white text-sm font-semibold active:scale-95 transition-transform focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
            style={{ background: BG }}
          >
            Run it
          </button>
        </form>
      )}
      {drafts.length === 0 && rejected.length > 0 && (
        <p className="mt-2 text-[12px] leading-snug text-slate-500 dark:text-slate-400 text-pretty">{rejected.join(" ")}</p>
      )}
    </div>
  );
}

// Now that the surface is explicitly a chat (bubbles conversion, see this
// file's header comment), a conventional three-dot typing indicator reads
// correctly again — same PENNY_BUBBLE shell every other Penny turn uses, so
// it lands in the same spot the answer will replace rather than causing a
// layout jump. `animate-bounce` here is the deliberate, literal choice: a
// "…typing" indicator is the one place a bouncing dot is the established,
// legible convention (iMessage/WhatsApp/etc.), not decorative motion that
// should ease out instead.
function BouncingDots() {
  return (
    <div className="flex justify-start">
      <div className={PENNY_BUBBLE}>
        <span className="sr-only">Penny is checking your numbers</span>
        <div className="flex items-center gap-1">
          {[0, 150, 300].map((d) => (
            <span key={d} className="w-1.5 h-1.5 bg-slate-400 rounded-full animate-bounce" style={{ animationDelay: `${d}ms` }} />
          ))}
        </div>
      </div>
    </div>
  );
}

function ErrorRetry({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="flex justify-start">
      <div className={PENNY_BUBBLE}>
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
    </div>
  );
}

/** Dismissible suggestion pill — 44px target, solid fill (floats over
 * scrolling content so it can't rely on the page background for contrast).
 * `onDismiss` stops propagation so the X never also fires the ask.
 *
 * `onDismiss` is now OPTIONAL (2026-08-25, chip-row redesign): the sheet's
 * new top scrollable row (see the `inSheet` chip row further down) taps a
 * chip to POPULATE the composer rather than send, which makes a chip
 * zero-commitment — tapping it costs nothing, so there is nothing left to
 * dismiss, and the X is dropped entirely for that row (no `pr-1.5` X slot,
 * plain symmetric `px-4`). Full-page mode's chip row (unchanged, see its
 * own comment) still passes `onDismiss` and keeps the X exactly as before.
 * `ariaLabel` lets a caller announce the FULL question to screen readers
 * even when `label` itself is the short display form — the sheet row
 * passes both; full-page mode passes neither, so `label` doubles as the
 * accessible name there same as always. */
function SuggestionChip({
  label,
  ariaLabel,
  onTap,
  onDismiss,
}: {
  label: string;
  ariaLabel?: string;
  onTap: () => void;
  onDismiss?: () => void;
}) {
  return (
    <span
      className={`inline-flex items-center flex-shrink-0 whitespace-nowrap min-h-[44px] rounded-full border border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-700 gap-1 ${
        onDismiss ? "pl-4 pr-1.5" : "px-4"
      }`}
    >
      <button
        type="button"
        onClick={onTap}
        aria-label={ariaLabel}
        className="relative min-h-[28px] flex items-center before:absolute before:-inset-y-2 before:-inset-x-1 before:content-[''] text-[13px] font-medium text-slate-600 dark:text-slate-300 active:scale-95 transition-transform focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 rounded"
      >
        <MoneyText text={label} />
      </button>
      {onDismiss && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onDismiss();
          }}
          aria-label={`Dismiss suggestion: ${label}`}
          className="relative w-7 h-7 flex items-center justify-center rounded-full text-slate-500 dark:text-slate-400 active:bg-slate-200 dark:active:bg-slate-600 transition-colors before:absolute before:-inset-y-2 before:-inset-x-1 before:content-[''] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
        >
          <X size={12} />
        </button>
      )}
    </span>
  );
}

/** A navigating chip (lib/pennyScreenConfig.tsx's `link` kind) — visually a
 * single pill (unlike SuggestionChip's nested button+dismiss-X), because
 * there is nothing to dismiss: tapping it always navigates away and closes
 * the sheet, so it can't linger in a "already used" state the way an asked
 * question does. Two cues distinguish it from an ask chip in a mixed row
 * (impeccable review, 2026-08-25: the trailing chevron alone didn't read at
 * a glance): a transparent/ghost fill here against SuggestionChip's solid
 * `bg-slate-50 dark:bg-slate-700`, so the silhouette itself differs, not
 * just the icon, plus the same trailing chevron. Same border colour, same
 * text colour, same size, no new colours, still one chip family, just a
 * different fill weight for "this one leaves the conversation". */
function LinkChip({ label, onTap }: { label: string; onTap: () => void }) {
  return (
    <button
      type="button"
      onClick={onTap}
      className="min-h-[44px] inline-flex items-center flex-shrink-0 whitespace-nowrap gap-1 text-[13px] font-medium px-4 rounded-full border border-slate-200 dark:border-slate-600 bg-transparent text-slate-600 dark:text-slate-300 active:scale-95 transition-transform focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
    >
      {label}
      <ChevronRight size={13} aria-hidden="true" className="text-slate-400 dark:text-slate-500 flex-shrink-0" />
    </button>
  );
}

// PennyAskContext moved to components/PennySheetProvider.tsx (the sheet
// caller owns it now that it exists) — imported below as a type-only
// import so it can't introduce a real runtime cycle (this file already
// sits underneath PennySheetProvider -> PennySheet -> PennyConversation;
// `import type` is erased entirely at compile time under isolatedModules,
// so no import of this file's own module is ever emitted back into that
// chain). See this file's header comment for the full `askContext`
// rationale (`summary`/`paydayActive`/one-shot `ask`), which still lives
// here since it's about how THIS component consumes the type, not what
// the type itself declares.


export default function PennyConversation({
  initialQuestion,
  autoFocusComposer,
  onContextLine,
  className,
  inSheet,
  askContext,
  askSeq,
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
  /** True when a sheet is hosting this component (see this file's header
   * comment for the full mode split). Swaps the fixed, page-docked composer
   * for a plain flow child, and swaps page-level `scrollIntoView` autoscroll
   * for scrolling this component's own internal thread container. The
   * caller must give this component a bounded-height box for `h-full` (used
   * on the root shell in this mode) to resolve against. */
  inSheet?: boolean;
  /** What screen opened Penny and what the thread should lead with — see
   * PennyAskContext and this file's header comment. Only meaningful in
   * `inSheet` mode; a full-page caller keeps using `initialQuestion`. */
  askContext?: PennyAskContext;
  /** PennySheetProvider's `openSeq` — increments on every `open()` call,
   * including a reopen of an already-open sheet. See this file's header
   * comment on why the `askContext.ask`/`paydayActive` one-shot effects
   * below key off this rather than a plain "have I ever fired" ref: this
   * component is mounted exactly once for the whole session (see
   * PennySheetProvider.tsx), so a plain ref would only ever fire on the
   * FIRST open of the session and silently do nothing on every open after
   * that — composer opens empty, no error, nothing to notice by eye.
   * `askSeq` gives each open a distinct token so "already handled" can
   * mean "already handled THIS open" instead of "ever handled at all". */
  askSeq?: number;
}) {
  const router = useRouter();
  // Only used by config `link` chips below (navigate + close, see
  // lib/pennyScreenConfig.tsx's header comment) — safe to call
  // unconditionally: PennySheetProvider wraps the whole app (app/layout.tsx),
  // so this component is always inside it whether or not `inSheet` is set.
  // Full-page mode's own composer/close affordances are unaffected; a link
  // chip closing an already-closed sheet is a harmless no-op.
  const { close: closePennySheet } = usePennySheet();
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
  // The sheet's own scroll container (inSheet mode only) — this component
  // renders it, rather than receiving a ref from the caller, because the
  // two-prop contract (`inSheet`/`askContext`) has no ref slot; see this
  // file's header comment on why the scrollable pane lives in here.
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const initialFiredRef = useRef(false);
  // Last `askSeq` this component has already submitted an `askContext.ask`
  // for — NOT a plain "have I ever fired" boolean. This component mounts
  // once for the whole session (see PennySheetProvider.tsx), so a boolean
  // ref would only ever fire on the session's first open and silently do
  // nothing on every later one. `0` is a safe "never handled" sentinel:
  // PennySheetProvider's `openSeq` starts at 0 and is already >= 1 by the
  // time this component exists at all (it's deferred-mounted on the FIRST
  // open — see PennySheet.tsx's `hasOpenedRef` — so its very first render
  // already has a real, positive `askSeq`). See the effect below and this
  // file's header comment.
  const askSeqHandledRef = useRef(0);
  // Same per-open-token treatment for the payday lead below — it should be
  // able to (re)compute on a LATER open too, not just the first time the
  // payday window was ever active this session (numbers like
  // `days_until_payday` move day to day).
  const paydaySeqHandledRef = useRef(0);
  // Deterministic Penny-side lead shown when the sheet opens during the
  // payday window with an EMPTY thread — see `paydayLead`'s own effect
  // below for the full rationale. Replaces an earlier version of this
  // feature (2026-08-25, killed on direct owner feedback: "every time I
  // open it sends the message what is happening with my payday, does this
  // go straight to the llm") that auto-submitted a fake "What's happening
  // with my payday?" user turn through /can-i on every open in the window —
  // a real LLM call and a quota unit the owner never asked for, rendering a
  // bubble he never typed. This version costs neither: it's built entirely
  // from `api.safeToSpend()` fields, formatted, no LLM involved.
  const [paydayLead, setPaydayLead] = useState<{ headline: string; facts: string[] } | null>(null);
  // Set when the payday-window fetch below fails or comes back non-ok —
  // impeccable review, MEDIUM, 2026-08-25: a silent bail there broke the
  // amber dot's promise (BottomNav.tsx lights it specifically because "a
  // payday plan is waiting" — see PennyAskContext.paydayActive's own
  // comment), leaving a user who tapped it looking at a bare composer with
  // no explanation. Deliberately its own boolean rather than folded into
  // `paydayLead` itself: the two are mutually exclusive outcomes of the
  // same one-shot fetch, and keeping them separate means the render below
  // doesn't have to infer "did this fail" from an absence.
  const [paydayLeadFailed, setPaydayLeadFailed] = useState(false);
  // `askContext.summary` grounds ONE request only — the first this
  // component ever sends, regardless of whether that's `askContext.ask`,
  // the payday auto-ask, or a manually typed question (whichever fires
  // first) — for the WHOLE SESSION, not per open. Deliberately left as a
  // plain forever-once ref, unlike the two refs above: repeating a screen
  // summary as LLM grounding on every reopen is not the same class of bug
  // as silently dropping a question the user (or a caller on their behalf)
  // explicitly asked to be submitted — see `send()`.
  const summaryConsumedRef = useRef(false);
  // Monotonic counter for message ids — a plain ref (not Math.random() or
  // Date.now()) so it's deterministic and SSR-safe. See the `id` field
  // comment on the Msg union above for why every message needs one.
  const nextMsgIdRef = useRef(0);
  function newMsgId(): number {
    nextMsgIdRef.current += 1;
    return nextMsgIdRef.current;
  }

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

  // REMOVED 2026-08-25 (chip-row redesign, owner: chips "horizontally
  // scrollable at the top ... when the user selects it, it fully
  // populates"): this used to reset `dismissedChips` on every sheet OPEN
  // (keyed off `askSeq`) so an X tapped at session-start didn't suppress
  // that chip forever. It's dead code now, not just unneeded: the ONLY
  // place `askSeq` is ever non-null is sheet mode (full-page never passes
  // it — see the `askSeq` prop comment below), and the sheet's chip row no
  // longer has an X at all (tapping a chip there populates the composer
  // instead of sending, which makes it zero-commitment, so there's nothing
  // left to dismiss — see the top chip row further down and
  // `SuggestionChip`'s now-optional `onDismiss`). `dismissedChips` can
  // therefore never become non-empty while `askSeq` is set, which means
  // this effect only ever reset an already-empty set back to empty —
  // observably a no-op. `dismissedChips` itself is NOT removed: full-page
  // mode's own chip row (unchanged, never passes `askSeq`) still has an X
  // and still needs it.

  // `paydayLead` (see its own state comment and effect below) is
  // deliberately NOT folded into `msgs`/this function's output. It's an
  // informational card built from raw `safeToSpend()` fields, not something
  // Penny herself said in the conversation — feeding it back to /can-i as a
  // prior assistant turn would let the LLM "build on" a message it never
  // actually generated (and, since it's not a real answer to any question,
  // there's no matching user turn to pair it with either). It lives in its
  // own state slot and renders separately, above `messages`, precisely so
  // it stays out of history the same way it stays out of the message array.
  function buildHistory(msgs: Msg[]): Array<{ role: "user" | "assistant"; content: string }> {
    return msgs.slice(-HISTORY_CAP).map((m) => {
      if (m.role === "user") return { role: "user" as const, content: m.content };
      // A scenario confirm card has no headline of its own — summarise it
      // by label so a follow-up question still has something sensible to
      // read as "what Penny said last". An explainer turn contributes its
      // markdown `reply` verbatim, so a follow-up tax question keeps the
      // same context a verdict follow-up already gets.
      // Prefer `reply` (the actual reasoning) over the bare headline so a
      // follow-up question doesn't lose Penny's own working — a one-word
      // deterministic headline like "Yes" carries nothing for the model to
      // build on. Falls back to headline where reply is unset (degraded
      // paths already fold reply into headline; see VerdictMsg's comment).
      const content = m.kind === "scenario"
        ? `Here's what I understood: ${m.items.map((it) => it.label).join(", ")}.`
        : m.kind === "explainer"
        ? m.reply
        : m.reply ?? m.headline;
      return { role: "assistant" as const, content };
    });
  }

  async function ask(question: string, history: Array<{ role: "user" | "assistant"; content: string }>, context?: string) {
    setError(false);
    setLoading(true);
    try {
      const res = await api.canI(question, history, context);
      // One id per answer turn, shared across whichever branch below fires
      // (see the Msg union's `id` comment for why every message needs one).
      const id = newMsgId();
      let assistantMsg: AssistantMsg;
      if (res.scenario && res.items && res.items.length > 0 && !res.clarify) {
        // The slot-confirm gate — see ScenarioMsg's doc comment. Never a
        // verdict card: nothing has been simulated yet.
        assistantMsg = { id, role: "assistant", kind: "scenario", items: res.items, rejected: res.rejected ?? [], prefilled: res.prefilled ?? false };
      } else if (res.scenario) {
        // `clarify` non-null (or no usable items extracted) — nothing to
        // confirm, render `reply` as an ordinary plain-text message.
        assistantMsg = { id, role: "assistant", kind: "verdict", headline: res.reply, degraded: true };
      } else if (res.explainer) {
        // General-knowledge answer (tax) — checked BEFORE `res.headline`
        // since it's a different message kind entirely, not a verdict
        // variant. See ExplainerMsg/ExplainerBubble doc comments.
        assistantMsg = { id, role: "assistant", kind: "explainer", reply: res.reply, topic: res.topic };
      } else if (res.headline) {
        assistantMsg = { id, role: "assistant", kind: "verdict", headline: res.headline, reply: res.reply, facts: res.facts, offer: res.offer ?? null, outOfScope: res.out_of_scope, degraded: false };
      } else {
        assistantMsg = { id, role: "assistant", kind: "verdict", headline: res.reply, offer: res.offer ?? null, degraded: true };
      }
      setMessages((prev) => [...prev, assistantMsg].slice(-HISTORY_CAP));
      setOffer(res.offer ?? null);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
      // Refocusing the composer here used to happen synchronously right
      // after this setLoading(false) call, but that only SCHEDULES the
      // re-render that clears the input's `disabled={loading}` binding
      // (see the composer below) — the DOM node was still disabled at the
      // moment `.focus()` ran, and browsers no-op focus() on a disabled
      // element, so the "ask another one immediately" flow frequently
      // failed. Moved to the loading-transition effect below, which runs
      // after React has actually committed the enabled input to the DOM.
    }
  }

  /** "Run it" on a scenario confirm card — pushes the (possibly edited)
   * items straight to /scenario as a JSON-encoded `items` query param,
   * exactly what ScenarioPage.tsx expects. No re-typing the question:
   * editing happens entirely in the card, this is a pure navigation. */
  function runScenario(items: ScenarioItem[]) {
    router.push(`/scenario?items=${encodeURIComponent(JSON.stringify(items))}`);
  }

  function send(text: string) {
    const trimmed = text.trim();
    if (!trimmed || loading) return;
    const history = buildHistory(messages);
    setMessages((prev) => [...prev, { id: newMsgId(), role: "user" as const, content: trimmed }].slice(-HISTORY_CAP));
    setInput("");
    setOffer(null);
    setAskedLabels((prev) => new Set(prev).add(trimmed));
    // askContext.summary grounds the FIRST request from a sheet caller's
    // screen only (see PennyAskContext's doc comment and this file's header
    // comment). It is sent as its own `context` argument to `api.canI` —
    // NEVER concatenated into the question string. `question` is what the
    // backend's deterministic gates read (amount extraction, the domain
    // router's tier-1 checks, out-of-scope/tax detection all parse this
    // exact string before any LLM call happens); a screen summary like
    // "£165 free · 4 days left" concatenated in front of an amount-free
    // question makes it LOOK amount-bearing to `_extract_amount` and
    // silently mis-routes it. `context` is grounding for the LLM only, kept
    // structurally separate on the wire for exactly that reason. Do not
    // "simplify" this back into a single string.
    const context = askContext?.summary && !summaryConsumedRef.current ? askContext.summary : undefined;
    if (context) summaryConsumedRef.current = true;
    ask(trimmed, history, context);
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

  // askContext.ask — sheet-mode equivalent of the `initialQuestion` effect
  // above, but fires once per `askSeq` (once per `open()` call) rather than
  // once per component lifetime. See `askSeqHandledRef`'s own comment and
  // this file's header comment: this component is mounted exactly once for
  // the whole session, so a plain fired-once ref would only ever submit
  // the FIRST `open({ask: ...})` of the session and silently do nothing on
  // every one after — a bug a fresh-session smoke test can't catch. `!=
  // null` (not `!== undefined`) also guards the full-page caller, which
  // never passes `askSeq` at all.
  useEffect(() => {
    if (askContext?.ask && askSeq != null && askSeqHandledRef.current !== askSeq) {
      askSeqHandledRef.current = askSeq;
      send(askContext.ask);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [askContext?.ask, askSeq]);

  // askContext.paydayActive — deterministic lead, NOT an auto-ask. See
  // `paydayLead`'s state comment for why the old version of this effect
  // (which auto-submitted "What's happening with my payday?" through
  // /can-i, a real LLM call and quota unit on every open, rendering a user
  // bubble the owner never typed) was killed on direct owner feedback
  // (2026-08-25). This version fires once per `askSeq` (same per-open-token
  // reasoning as the `askContext.ask` effect above — this component mounts
  // once for the whole session, so a plain "ever fired" ref would only ever
  // compute on the session's first open), only when `askContext.ask` didn't
  // already claim the "first turn" slot, and only when the thread is EMPTY
  // — see the guard below. `messages` is read but deliberately NOT a
  // dependency: this should evaluate "was the thread empty at the moment
  // the sheet opened", not refire as the user's own later turns land.
  useEffect(() => {
    if (!askContext?.paydayActive || askContext?.ask || askSeq == null) return;
    if (paydaySeqHandledRef.current === askSeq) return;
    if (messages.length > 0) return; // the user's own conversation wins — never inject into a live thread
    paydaySeqHandledRef.current = askSeq;
    setPaydayLeadFailed(false);
    api.safeToSpend()
      .then((sts) => {
        // Non-ok is a real failure to surface here, not a silent bail — see
        // `paydayLeadFailed`'s own comment. A quiet caption renders instead
        // of the lead bubble (below), never a bold error treatment: this
        // is informational, not something gone wrong in the user's money.
        if (!sts || sts.status !== "ok") { setPaydayLeadFailed(true); return; }
        const dateLabel = formatPaydayDateLabel(sts.next_payday);
        // `safe_to_spend` is net of unpaid card growth and can land at or
        // below zero (a "short" pot) — never turn that into a negative
        // "free" figure or a negative daily rate, which would read as
        // permission to spend money that isn't there.
        const freeAmt = Math.round(sts.safe_to_spend);
        const facts = freeAmt > 0
          ? [`£${freeAmt.toLocaleString("en-GB")} free until ${dateLabel}`]
          : [`Nothing spare until ${dateLabel}, bills come first`];
        if (freeAmt > 0 && sts.days_until_payday > 0) {
          const perDay = Math.round(freeAmt / sts.days_until_payday);
          facts.push(`That's about £${perDay.toLocaleString("en-GB")} a day`);
        }
        // Estimate flag folded into the first (amount) fact line, muted
        // text same as the rest of `facts` — DESIGN.md's "Do label
        // estimates honestly" rule, same convention SafeToSpendCard.tsx
        // uses inline after its own headline figure. Never on the bold
        // headline itself: the headline stays a plain, calm verdict line.
        if (sts.estimated) facts[0] = `${facts[0]} · estimated`;
        setPaydayLead({ headline: "Payday is close.", facts });
      })
      .catch(() => setPaydayLeadFailed(true));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [askContext?.paydayActive, askContext?.ask, askSeq]);

  // ?compose=1 — focus the docked composer. Full-page mode only (no sheet
  // caller ever passes `autoFocusComposer`, but gated explicitly so this
  // can never be the thing that pops the on-screen keyboard on a sheet
  // open — 2026-08-25 owner feedback: "it shouldn't focus on the textbox
  // immediately I open it"). `askContext.ask` deliberately gets no
  // equivalent treatment: it submits without the user typing anything, so
  // there's nothing here for it to focus either.
  useEffect(() => {
    if (autoFocusComposer && !inSheet) inputRef.current?.focus({ preventScroll: true });
  }, [autoFocusComposer, inSheet]);

  // Refocus the composer once `loading` flips from true to false — desktop
  // rapid follow-up (CanISection had this too; the answer lands in a
  // bubble now instead of CanISection's old inline reply, but the "ask
  // another one immediately" flow is unchanged in full-page mode). Must be
  // an effect, not the `ask()` `finally` block: an effect runs after React
  // commits the DOM update, so by the time this fires the composer's
  // `disabled={loading}` binding has actually cleared. `wasLoadingRef`
  // restricts this to the true -> false transition specifically, so it
  // doesn't also fire (and fight the `autoFocusComposer` effect above) on
  // initial mount, when `loading` starts false and this effect's own
  // dependency array still runs once.
  //
  // Disabled entirely in sheet mode (2026-08-25, same owner feedback as
  // above): on a phone this refocus is what pops the keyboard back up the
  // instant any answer lands — including the payday auto-ask that used to
  // fire on open (now removed; see `paydayLead`), and any chip/typed ask a
  // user sends. The intent was narrower ("keep this only when the user had
  // already focused the composer themselves, mid-conversation, not on a
  // fresh open"), but this component has no reliable signal for "the user
  // focused the input on purpose" versus "focus landed here some other
  // way" — so per instruction, this errs toward never auto-focusing the
  // composer in sheet mode rather than guessing. The cost: a sheet user who
  // sends a follow-up question doesn't get the composer refocused for them
  // after the reply lands (they still can, by tapping it); full-page mode
  // is unaffected and keeps the original behaviour.
  const wasLoadingRef = useRef(false);
  useEffect(() => {
    if (wasLoadingRef.current && !loading && !inSheet) inputRef.current?.focus();
    wasLoadingRef.current = loading;
  }, [loading, inSheet]);

  // Instant open-time positioning — 2026-08-25 owner feedback ("whenever I
  // open it it scrolls down"). Keyed off `askSeq` (bumped on every
  // `open()` call, including a reopen — see PennySheetProvider.tsx), a
  // `useLayoutEffect` so it runs synchronously after the DOM commits but
  // BEFORE the browser paints: the panel and thread are already visible at
  // the correct scroll position in the very first frame the user sees,
  // instead of visibly animating there. Sets `scrollTop` directly (no
  // `behavior: "smooth"`) — this is a jump, not a scroll. The old visible
  // "scrolling down" the owner saw was mostly a symptom of the removed
  // payday auto-ask (see `paydayLead`) appending a message on open, which
  // drove the smooth-scroll effect below; that trigger is gone, but this
  // covers the case on its own terms too — an existing thread should
  // already BE at the bottom on reopen, not animate its way there, whether
  // or not anything happens to append a message that render. Full-page
  // mode is untouched (no `scrollContainerRef` there; page scroll position
  // isn't this component's to manage).
  useLayoutEffect(() => {
    if (!inSheet || askSeq == null) return;
    const el = scrollContainerRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [askSeq, inSheet]);

  // Scroll the newest turn into view as it lands — covers both the
  // ?ask= deep link ("scroll to answer") and any regular chip/composer ask.
  // Depends on the `messages` array itself, not `messages.length`: once the
  // thread hits HISTORY_CAP, every subsequent turn replaces one message for
  // another via `.slice(-HISTORY_CAP)`, so the length pins at 6 and a
  // length-only dependency would stop firing from the fourth exchange
  // onward — exactly when the composer's dock at the bottom makes the
  // missed scroll most visible. The ref scroll itself is idempotent, so
  // re-running it on every array identity change (even ones that don't
  // move anything) is harmless. That reasoning is unchanged by `inSheet` —
  // only WHERE the scroll happens differs: in sheet mode this component
  // does not own page scroll (the sheet may sit over a blurred, non-
  // scrolling page per DESIGN.md's Glass Sheet rule), so it scrolls its own
  // `scrollContainerRef` pane directly instead of asking the browser to
  // walk up to the nearest scrollable ancestor via `scrollIntoView`, which
  // in a sheet could just as easily resolve to the page behind it.
  useEffect(() => {
    if (messages.length === 0) return;
    if (inSheet) {
      const el = scrollContainerRef.current;
      if (el) el.scrollTo({ top: el.scrollHeight, behavior: reducedMotion() ? "auto" : "smooth" });
    } else {
      threadEndRef.current?.scrollIntoView({ behavior: reducedMotion() ? "auto" : "smooth", block: "end" });
    }
  }, [messages, inSheet]);

  function openOfferSheet() {
    setOfferSheetOpen(true);
  }

  const visibleChips = chips.filter((c) => !askedLabels.has(c.label) && !dismissedChips.has(c.label));

  // Screen-aware header links/chips (lib/pennyScreenConfig.tsx) — derived
  // fresh every render from `askContext?.screen`, not cached, so a REOPEN
  // over a different screen (same session-long component instance, see
  // this file's header comment) picks up that screen's config immediately
  // rather than whatever was active the first time this component rendered.
  // `getPennyScreenConfig(undefined)` (no `askContext`, i.e. the currently-
  // unused full-page mode) resolves to the "other" config, which is exactly
  // today's pre-config behaviour (personalised chips only, one header
  // link) — so this is a no-op change for that mode.
  const screenConfig = getPennyScreenConfig(askContext?.screen);
  // Config `ask` chips filter the same way personalised ones do above, but
  // matched against `q` (what actually gets sent — see the `label`/`q`
  // convention noted in lib/pennyScreenConfig.tsx's header comment), not
  // `label`. `link` chips are never filtered out here: they're not
  // dismissible and tapping one navigates away rather than leaving a state
  // behind to hide.
  const visibleConfigChips = screenConfig.chips.filter(
    (c) => c.kind === "link" || (!askedLabels.has(c.q) && !dismissedChips.has(c.q))
  );
  // Chip row, merged in a deliberate priority order — free answers first:
  //   1. deterministic ask chips (PennyChip.deterministic === true, e.g.
  //      PAYDAY_STATUS_ASK/PAYDAY_DUE_ASK) — answered by the backend with
  //      NO LLM call, the cheapest and fastest thing on offer, so they lead.
  //   2. link chips — zero LLM, zero network, pure client-side navigation;
  //      not quite as "free" as a deterministic answer (they leave the
  //      conversation rather than answering inline) but still cost nothing
  //      to show or tap.
  //   3. LLM ask chips — every other config `ask` chip (tax explainers,
  //      spend/planning/grow/debt domain questions); each tap is a real
  //      LLM round-trip, so these rank behind the two free tiers above.
  //   4. personalised suggestions (canISuggestions' £-chips) fill whatever
  //      slots remain — already screen-relevant, but generic next to a
  //      screen's own curated set, hence last.
  // `chipCap` applies AFTER this ordering, so on a screen with more
  // eligible chips than the cap the ones that survive are always the
  // cheapest/most-deterministic ones, never an arbitrary cut through a
  // mixed-priority list.
  //
  // The cap itself differs by mode (2026-08-25, chip-row redesign): full-
  // page mode keeps the original THREE (owner report, 2026-08-25: "is the
  // chat too cluttered with some of these chips" — that verdict was about a
  // WRAPPING row competing with the thread for vertical space, and full-
  // page mode is unchanged, see this file's header comment). The sheet's
  // new row (further down) is a single horizontally-scrolling line instead
  // of wrapping, so more chips cost no extra vertical space — raised to SIX
  // there. `inSheet` alone decides which cap applies since a given
  // component instance is only ever one mode for its whole lifetime.
  const chipCap = inSheet ? 6 : 3;
  const deterministicAskChips = visibleConfigChips.filter((c) => c.kind === "ask" && c.deterministic);
  const linkChips = visibleConfigChips.filter((c) => c.kind === "link");
  const llmAskChips = visibleConfigChips.filter((c) => c.kind === "ask" && !c.deterministic);
  const personalisedSuggestions = screenConfig.personalisedChips
    ? visibleChips.map((c) => ({ source: "personalised" as const, label: c.label }))
    : [];
  const allChips: (
    | { source: "personalised"; label: string }
    | (PennyChip & { source: "config" })
  )[] = [
    ...deterministicAskChips.map((c) => ({ ...c, source: "config" as const })),
    ...linkChips.map((c) => ({ ...c, source: "config" as const })),
    ...llmAskChips.map((c) => ({ ...c, source: "config" as const })),
    ...personalisedSuggestions,
  ].slice(0, chipCap);

  // The composer's inner markup is identical in both modes (same input,
  // same send button, same disclaimer) — only what WRAPS it differs (fixed
  // viewport dock vs. a plain flow child), so it's built once here and
  // dropped into whichever wrapper the render below picks. Defined inline
  // (not hoisted to a separate component) because it closes over this
  // render's `input`/`loading`/`placeholder` state and `inputRef`; only one
  // wrapper ever mounts it at a time, so there's no duplicate-instance risk.
  const composerCard = (
    <div className="glass-card rounded-2xl px-3 pt-2.5 pb-2 shadow-lg">
      <div className="flex items-center gap-2">
        <input
          ref={inputRef}
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && send(input)}
          placeholder={placeholder}
          aria-label="Ask Penny a spending question"
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
      <p className="text-[11px] leading-snug text-slate-500 dark:text-slate-400 mt-1.5">
        General information, not regulated financial advice.
      </p>
    </div>
  );

  // Render-time-only consecutive-fact dedupe (owner report, 2026-08-25: the
  // payday lead's "£179 free until Friday" line, then every subsequent
  // verdict's facts repeating "£179 free until Fri 28 Aug" — the same
  // grounding line printed in two ADJACENT bubbles reads as clutter on a
  // phone, whereas the same fact reappearing several turns later is fine,
  // the thread has scrolled past it by then. This is PURELY what gets
  // painted: `buildHistory` above and the `messages`/`paydayLead` state
  // both keep every message's full, undeduped `facts` array untouched, so
  // the LLM's own conversation history is unaffected. Never touches
  // `headline`/`reply`, only `facts` lines, and only exact string matches.
  //
  // Walks `messages` in order, tracking the facts actually SHOWN (i.e.
  // already deduped) in the nearest preceding assistant bubble:
  // - Starts from `paydayLead`'s own facts, so the FIRST assistant bubble
  //   in the thread dedupes against the lead too, not just against later
  //   verdicts.
  // - A user turn does not reset the pointer — "immediately previous
  //   assistant bubble" skips right over any user message in between, it
  //   only cares about the previous turn PENNY took.
  // - A scenario/explainer bubble carries no facts of its own, so it
  //   resets the pointer to empty: the next verdict after one of those has
  //   nothing to dedupe against.
  // - Compares against what was SHOWN (post-dedupe), not the raw
  //   `msg.facts`, so a run of repeats collapses to one visible showing
  //   instead of flip-flopping hidden/visible as the "previous" bubble's
  //   own displayed lines change.
  let prevAssistantFacts: string[] = paydayLead?.facts ?? [];
  const displayMessages: Msg[] = messages.map((m) => {
    if (m.role === "user" || m.kind !== "verdict") {
      if (m.role === "assistant") prevAssistantFacts = [];
      return m;
    }
    const rawFacts = m.facts ?? [];
    const shown = rawFacts.filter((f) => !prevAssistantFacts.includes(f));
    prevAssistantFacts = shown;
    return shown.length === rawFacts.length ? m : { ...m, facts: shown };
  });

  return (
    <div className={[inSheet ? "flex flex-col h-full min-h-0" : null, className].filter(Boolean).join(" ") || undefined}>
      {/* Sheet-mode chip row (2026-08-25, owner: "with the chips could they
          be horizontally scrollable at the top and perhaps could be
          summarised and when the user selects it, it fully populates").
          Sits at the very top of this component's body, i.e. directly under
          PennySheet.tsx's header divider — above the payday lead and the
          thread — a `shrink-0` flow sibling of the scroll container below,
          same as the old bottom row was. Full-page mode keeps its OWN chip
          row further down, unchanged; this one only renders `inSheet`.

          SINGLE ROW, no wrap: `overflow-x-auto` + `scrollbar-hide` (the
          existing hide-but-still-scroll utility, app/globals.css — not a
          new one) on a plain non-wrapping flex row. Every chip inside
          (`SuggestionChip`/`LinkChip`) carries `flex-shrink-0
          whitespace-nowrap` so the row scrolls instead of squeezing chips
          to fit. The right-edge fade below is a scrollability cue, not a
          mask — `pointer-events-none` so it never eats a tap on a chip
          that happens to sit under it.

          SELECTION BEHAVIOUR — the core change: an `ask` chip here no
          longer calls `send()`. It POPULATES the composer with the chip's
          FULL question text (never the short label) and focuses it, so the
          user can edit or just hit send. Focusing on tap is deliberately
          fine here despite the sheet's established "never autofocus the
          composer" rule (see `autoFocusComposer`'s and the loading-
          transition effect's own comments above) — that rule is about
          focus landing on the user WITHOUT them asking for it (on open, or
          after an answer lands); this is a direct response to a tap they
          just made, the same class of user-initiated focus a normal text
          input gets when you tap it. `link` chips are unchanged: navigate
          + close, same as the bottom row. No `onDismiss` is ever passed
          here — see `SuggestionChip`'s own comment on why the X is gone
          from this row specifically (population makes a chip zero-
          commitment, nothing to dismiss). */}
      {inSheet && allChips.length > 0 && (
        <div className="shrink-0 relative px-1 pt-1">
          <div className="flex items-center gap-2 overflow-x-auto scrollbar-hide pb-1">
            {allChips.map((c) => {
              if (c.source === "personalised") {
                const full = c.label;
                return (
                  <SuggestionChip
                    key={`top-personalised-${c.label}`}
                    label={shortPersonalisedLabel(full)}
                    ariaLabel={full}
                    onTap={() => { setInput(full); inputRef.current?.focus(); }}
                  />
                );
              }
              if (c.kind === "link") {
                return (
                  <LinkChip
                    key={`top-config-link-${c.label}`}
                    label={c.short ?? c.label}
                    onTap={() => { closePennySheet(); router.push(c.href); }}
                  />
                );
              }
              return (
                <SuggestionChip
                  key={`top-config-ask-${c.q}`}
                  label={c.short ?? c.label}
                  ariaLabel={c.label}
                  onTap={() => { setInput(c.q); inputRef.current?.focus(); }}
                />
              );
            })}
          </div>
          {/* Right-edge fade — same technique as CommitmentsBlock's own
              multi-goal scroll row (app/planning/PlanningPage.tsx), colour-
              matched to `.glass-sheet`'s actual fill (app/globals.css:
              `#ffffff` / dark `#0f172a`, i.e. exactly Tailwind's
              white/slate-900) rather than the page's `--background` var —
              this row sits inside the floating sheet panel, not over page
              content, so it must fade to the PANEL's colour or the seam
              would show. */}
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-y-0 right-1 w-6 bg-gradient-to-l from-white dark:from-slate-900 to-transparent"
          />
        </div>
      )}

      {/* Thread. Full-page mode: in-flow, page-scrolled (no inner scroll
          container; the docked composer below is fixed to the viewport
          independent of this). Sheet mode: this IS the scroll container
          (`flex-1 min-h-0 overflow-y-auto` — `min-h-0` is required for a
          flex child to actually shrink and scroll instead of stretching
          its flex parent per its content's natural height), scrolled via
          `scrollContainerRef` rather than page scroll — see the autoscroll
          effect above and this file's header comment. Rendered
          unconditionally either way (not gated on messages.length): a live
          region and its first content landing in the same commit is silent
          on several screen readers, which only announce mutations to a
          region that already existed on the page. Always mounting the
          empty shell means the very first answer gets announced too. */}
      <div
        ref={inSheet ? scrollContainerRef : undefined}
        aria-live="polite"
        role="log"
        className={inSheet ? "flex-1 min-h-0 overflow-y-auto space-y-3 px-1" : "space-y-3"}
      >
        {/* Rendered ahead of `messages` (not part of that array — see
            `paydayLead`'s state comment and `PaydayLeadBubble`'s doc
            comment) so it reads as the first bubble in the thread without
            being eligible for HISTORY_CAP eviction or LLM history. */}
        {paydayLead && <PaydayLeadBubble headline={paydayLead.headline} facts={paydayLead.facts} />}
        {/* Quiet fallback for the same slot — see `paydayLeadFailed`'s own
            comment. A caption, not a bubble: this isn't Penny failing to
            answer a question (ErrorRetry's job, with its "Try again"), it's
            one background fetch that didn't come back, so it gets the
            quietest treatment the thread has rather than an error surface. */}
        {paydayLeadFailed && (
          <p className="text-[12px] leading-snug text-slate-500 dark:text-slate-400 px-1">
            Couldn&apos;t load your payday numbers right now.
          </p>
        )}
        {displayMessages.map((m) => {
          // Keyed on `m.id`, NOT array index — see the `id` field comment
          // on the Msg union above (`messages` is a sliding window, so an
          // index key would reuse instances across shifted content once
          // the thread exceeds HISTORY_CAP). `displayMessages` is a 1:1,
          // same-order map over `messages` (see its own comment above) that
          // only ever replaces a verdict's `facts` array for display, so
          // this key contract is unaffected.
          if (m.role === "user") return <UserBubble key={m.id} text={m.content} />;
          if (m.kind === "scenario") {
            // Full-width form, deliberately NOT a bubble — see the
            // CARVE-OUT comment on ScenarioConfirmCard's own doc comment.
            return <ScenarioConfirmCard key={m.id} items={m.items} rejected={m.rejected} prefilled={m.prefilled} onRun={runScenario} />;
          }
          if (m.kind === "explainer") {
            return <ExplainerBubble key={m.id} msg={m} />;
          }
          return <VerdictBubble key={m.id} msg={m} onOfferTap={openOfferSheet} />;
        })}
        {loading && <BouncingDots />}
        {error && !loading && <ErrorRetry onRetry={retry} />}
        {/* Scroll target only exists (and is only needed) in full-page
            mode — sheet mode scrolls `scrollContainerRef` directly by
            `scrollHeight`, see the autoscroll effect above. */}
        {!inSheet && <div ref={threadEndRef} />}
      </div>

      {/* Persistent suggestion chips — FULL-PAGE MODE ONLY (2026-08-25, chip-
          row redesign: sheet mode now renders its own row at the TOP of
          this component, above the thread — see that block's comment).
          Nothing mounts this component full-page any more (see this file's
          header comment: only app/penny/PennyPage.tsx used to, and it now
          only renders `PennyPromptBar`, not this), so this block is
          unreachable in production today — kept, unchanged, only so the
          full-page path stays behaviourally intact rather than being ripped
          out, per instruction. Survives an answer instead of disappearing
          (removed only once asked or explicitly dismissed); scrolls with
          the thread, composer below stays docked. */}
      {!inSheet && allChips.length > 0 && (
        <div className="flex flex-wrap gap-2 mt-3">
          {allChips.map((c) => {
            if (c.source === "personalised") {
              return (
                <SuggestionChip
                  key={`personalised-${c.label}`}
                  label={c.label}
                  onTap={() => send(c.label)}
                  onDismiss={() => setDismissedChips((prev) => new Set(prev).add(c.label))}
                />
              );
            }
            if (c.kind === "link") {
              // Navigate + close — zero LLM, zero network (see
              // lib/pennyScreenConfig.tsx's header comment). Closing first
              // means the sheet isn't still visually open over the page
              // it's mid-navigation away from.
              return (
                <LinkChip
                  key={`config-link-${c.label}`}
                  label={c.label}
                  onTap={() => { closePennySheet(); router.push(c.href); }}
                />
              );
            }
            return (
              <SuggestionChip
                key={`config-ask-${c.q}`}
                label={c.label}
                onTap={() => send(c.q)}
                onDismiss={() => setDismissedChips((prev) => new Set(prev).add(c.q))}
              />
            );
          })}
        </div>
      )}

      {/* Composer. Full-page mode: docked above BottomNav (mobile only;
          nav is lg:hidden), `position: fixed`. "88px + safe-area" is the
          app's established clearance idiom for a floating element above the
          rail (see BudgetPage.tsx's FAB; the retired TaxChat.tsx's FAB used
          to share this idiom too, before that component was deleted).
          Wrapped in the same lg:max-w-2xl container the Penny/Planning
          pages use, so it lines up with page content on desktop instead of
          stretching edge to edge. Sheet mode: a plain `shrink-0` flow
          child — no `fixed` positioning, no viewport-relative clearance
          math, because the sheet itself owns where the composer sits (the
          last child in its own flex column), per this file's header
          comment and the two-prop contract. */}
      {inSheet ? (
        <div className="shrink-0 px-1 pt-2">{composerCard}</div>
      ) : (
        <div
          className="fixed inset-x-0 z-40 px-4 lg:px-0"
          style={{ bottom: "calc(88px + env(safe-area-inset-bottom, 0px))" }}
        >
          <div className="lg:max-w-2xl lg:mx-auto">{composerCard}</div>
        </div>
      )}

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
                id: newMsgId(),
                role: "assistant" as const,
                kind: "verdict" as const,
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
// Glass-card row (Penny chip + placeholder). Takes `onCompose`/`onAsk`
// callbacks rather than owning navigation itself — every call site now
// opens the Penny sheet (usePennySheet, components/PennySheetProvider.tsx)
// instead of routing to the old /penny?compose=1 / /penny?ask=<label>
// query params, which this bar predates. Suggestions fetch here is ALSO
// fire-and-forget and must never block Planning's own render — the bar
// shows its placeholder immediately; chips (and the whisper caption under
// them) simply pop in a beat later, or never, if the fetch fails.
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
        <span className="text-[14px] text-slate-500 dark:text-slate-400 truncate">
          Ask Penny&hellip; Can I spend <span className="font-mono tabular-nums">£45</span> this weekend?
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
                <MoneyText text={c.label} />
              </button>
            ))}
          </div>
          <p className="text-[11px] leading-snug text-slate-500 dark:text-slate-400 mt-2">
            Suggestions come from your own spending and plans.
          </p>
        </>
      )}
    </div>
  );
}
