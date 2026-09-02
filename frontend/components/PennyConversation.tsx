"use client";

// The bounded Penny oracle — productionised from the approved design at
// app/design/penny-chat/PennyChatClient.tsx, then converted from full-width
// verdict cards to messenger bubbles (2026-08-25) per the owner's side-by-
// side call on app/design/penny-sheet/{CardsGrammar,BubblesGrammar}.tsx:
// people expect bubbles in a conversation. Ported treatment (do not
// re-litigate): user turn right-aligned `bg-indigo-600 text-white
// rounded-2xl rounded-br-sm` (recoloured from the originally-ported
// `bg-violet-600` by a 2026-08-25 design review — see UserBubble's own
// comment, the Penny Gradient Rule), Penny turn left-aligned `bg-slate-100
// dark:bg-slate-700 rounded-2xl rounded-bl-sm`. Contrast checked at build
// time: white-on-indigo-600 is ~6.29:1, clears WCAG AA's 4.5:1 for normal
// text with room to spare.
//
// The one thing the owner was hesitant about with bubbles survives the
// conversion: inside Penny's bubble the verdict headline is still the
// FIRST and HEAVIEST element (bold, 16px), then the reasoning sentence
// (14px, mid-muted), then the offer chip. A bubble must never flatten
// that hierarchy — see VerdictBubble below. The muted grey "facts" tier
// that used to sit between the reasoning sentence and the offer chip
// (13px, lightest) is gone — owner order, 2026-08-25, the "duplication
// war": see VerdictBubble's own comment on the removed block. The
// explainer treatment (general knowledge, no verdict) keeps its quiet
// uppercase TAX eyebrow and never gets a bold headline, so it still reads
// as information rather than a read on the user's money — see
// ExplainerBubble below.
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
//
// Backend contract (CONTRACT, may not be live yet):
//   GET /can-i/suggestions -> { chips: [{ label }], context_line }
//   POST /can-i now ALSO returns { headline, facts, out_of_scope } alongside
//   the existing { reply, offer }. Both new surfaces degrade gracefully:
//   canISuggestions() failing just means no chips/context line (every call
//   site treats it as decorative, fire-and-forget); a /can-i reply with no
//   `headline` renders `reply` as plain body text in the same bubble shell
//   instead of a bold verdict headline (see AssistantBubble's `degraded` case).
//
// PER-SCREEN THREADS (owner decision, 2026-08-26, REVERSING the above from
// lived use): yesterday's one-thread-with-page-seam-markers model read fine
// on paper but confused the owner in actual use — "this one thread many
// conversations can get quite confusing, why can't we switch between
// threads as we navigate different pages?" The thread is now bucketed by
// screen (see `ThreadBucket`/`buckets` below, keyed by
// `PennyAskContext["screen"]` including "other"): navigating to a
// different screen and reopening Penny shows THAT screen's own
// conversation, not a shared scroll with a divider marking where it
// changed. The page-seam machinery that model needed — `MarkerMsg`,
// `PennyThreadMarker`, `SCREEN_DISPLAY_NAMES`, `lastSendScreenRef` — is
// gone entirely: the bucket switch itself is now the indicator, there is
// nothing left for a divider to announce. Do not rebuild any of it from
// stale memory of "how Penny's thread used to work"; this comment is the
// record of why it changed.
// - INACTIVITY TTL (`PENNY_THREAD_TTL_MS`) is unchanged in duration and
//   intent but now applies PER BUCKET: each bucket carries its own
//   `lastActivityAt`, checked only when that bucket becomes visible (an
//   open, or a screen switch — which, per PennySheet.tsx's own mount
//   comment, always arrives as a fresh open too, since the sheet closes on
//   navigation), and an expiry silently clears only that one bucket. A
//   stale morning Spend thread no longer wipes a same-session Home thread
//   just because they used to share one TTL clock. See the `askSeq`-keyed
//   effect below (still deliberately declared BEFORE the `askContext.ask`
//   one-shot effect — see that effect's own ordering comment) and
//   `bucketsRef`/`setBucket` for why event-handler reads go through a ref
//   rather than the `buckets` state variable directly.

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Send, Loader2, X, ChevronRight } from "lucide-react";
import { api, CanIOffer, CanISuggestionChip, PennyProposal, ScenarioItem } from "@/lib/api";
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
// How long a bucket's thread survives with no activity before that bucket
// becoming visible again (an open, or a screen switch — see this file's
// header comment, "PER-SCREEN THREADS") silently resets it (see the
// `askSeq`-keyed expiry effect below). 30 minutes: long enough that a phone
// call mid-conversation doesn't wipe it, short enough that a morning "can I
// afford lunch" thread isn't still there at 11pm asking about lunch.
const PENNY_THREAD_TTL_MS = 30 * 60 * 1000;

// Every message carries a stable `id`, assigned once at creation (see
// `newMsgId()` below) and never recomputed. Keying the thread render on
// this instead of array index matters because a bucket's `messages` is a
// SLIDING WINDOW (every append goes through `capMessages`, which ends in
// `.slice(-HISTORY_CAP)`) — once a bucket's thread exceeds the cap,
// index-keyed nodes have content shift under them instead of nodes being
// added/removed, and `ScenarioConfirmCard`'s lazy `useState(() =>
// items.map(toDraft))` initialiser only runs on mount, so a reused instance
// under a shifted index kept a STALE draft from a different scenario
// message.
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
/** Agent mode v1's confirm card (owner decisions locked: confirm-as-is, no
 * inline edits, one-time consent, origin badges, 15-min TTL) — Penny
 * drafted a concrete action and needs an explicit yes. `status` lives on
 * the MESSAGE, not local component state, deliberately: this card's own
 * React instance unmounts/remounts across a screen-bucket switch (`messages`
 * swaps to a different bucket's array entirely — see this file's header
 * comment, "PER-SCREEN THREADS"), so a plain `useState` inside
 * ProposalConfirmCard would forget a successful confirm the moment the user
 * navigated away and back to this screen's Penny thread. */
type ProposalMsg = {
  id: number;
  role: "assistant";
  kind: "proposal";
  proposal: PennyProposal;
  status: "pending" | "executing" | "done" | "cancelled" | "error";
  /** Set only on `status === "error"` — the backend's own human `detail`
   * string (expired/cancelled/etc, see api.executePennyProposal), rendered
   * verbatim rather than a generic "something went wrong". */
  errorDetail?: string;
};
/** The one-time gate before Penny can act on the user's behalf at all (set
 * up envelopes/goals/one-offs), as opposed to only answering. Same
 * status-on-the-message reasoning as ProposalMsg above. */
type ConsentMsg = {
  id: number;
  role: "assistant";
  kind: "consent";
  status: "pending" | "accepted" | "declined";
};
type AssistantMsg = VerdictMsg | ScenarioMsg | ExplainerMsg | ProposalMsg | ConsentMsg;
// MarkerMsg — a page-seam divider inserted between turns from different
// screens — died with the one-thread model it belonged to (see this file's
// header comment, "PER-SCREEN THREADS", 2026-08-26). A per-screen bucket
// has no seam to mark inside its own thread; do not resurrect this type or
// the PennyThreadMarker component that used to render it.
type Msg = UserMsg | AssistantMsg;

/** One conversation per screen (owner decision, 2026-08-26 — see this
 * file's header comment, "PER-SCREEN THREADS"). Keyed by
 * `PennyAskContext["screen"]`, including "other" (full-page mode never
 * sets `askContext` at all, so it always resolves to this one bucket — see
 * `currentScreen` in the component below). Only these three fields move
 * per-bucket; `dismissedChips` and the `canISuggestions` fetch stay a
 * single global set/request (see their own declarations below) — a
 * dismissed chip and the personalised suggestions themselves aren't
 * screen-specific the way a conversation or its asked-question set is. */
type ThreadBucket = {
  messages: Msg[];
  askedLabels: Set<string>;
  lastActivityAt: number;
};

function newBucket(): ThreadBucket {
  return { messages: [], askedLabels: new Set(), lastActivityAt: Date.now() };
}

/** Every screen gets its own fresh bucket up front, rather than lazily
 * creating one on first visit, so `buckets[screen]` is never a lookup that
 * can miss. Every `PennyAskContext["screen"]` member is listed explicitly
 * (not derived/looped over the type) so that adding a new screen to that
 * union without adding a matching entry here is a compile error, not a
 * silent runtime `undefined` the first time that screen opens Penny. */
function newBuckets(): Record<PennyAskContext["screen"], ThreadBucket> {
  return {
    home: newBucket(),
    spend: newBucket(),
    planning: newBucket(),
    insights: newBucket(),
    grow: newBucket(),
    debt: newBucket(),
    tax: newBucket(),
    // Added 2026-08-26 alongside PennySheetProvider.tsx's union gaining
    // "accounts" — exactly the compile error this function's own comment
    // predicted, not a surprise.
    accounts: newBucket(),
    other: newBucket(),
  };
}

function reducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** Right-aligned filled user bubble with a tail — originally ported from the
 * retired TaxChat popup's exact treatment verbatim, `bg-violet-600`
 * included; a design review (2026-08-25) flagged that violet-600 is the
 * literal hex DESIGN.md reserves as Penny Violet, the brand-gradient stop
 * that belongs to Penny's own identity alone (see ExplainerBubble's comment
 * below on the same rule) — the user's own words were wearing Penny's
 * colour. Recoloured to `bg-indigo-600`, the app's ordinary Adviser Indigo
 * action token, used everywhere else for "this is interactive/mine", not
 * Penny's. Per the Penny Gradient Rule (DESIGN.md), do not put violet back
 * on this bubble. Capped at 85% width; Penny's bubble below is deliberately
 * wider, they are not symmetric in importance. White-on-indigo-600 measures
 * ~6.29:1 contrast, clears WCAG AA (4.5:1) with more room than the old
 * violet-600 fill (~5.70:1). */
function UserBubble({ text }: { text: string }) {
  return (
    <div className="flex justify-end">
      <div className="max-w-[85%] bg-indigo-600 text-white rounded-2xl rounded-br-sm px-4 py-2.5">
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
 * heaviest, then the reasoning sentence, then the offer chip. This
 * ordering/weighting is the non-negotiable part of the bubbles conversion
 * (see this file's header comment): a bubble must never flatten the
 * headline to the same weight as the rest. The muted grey "facts" tier
 * that used to sit between the reasoning sentence and the offer chip is
 * gone (owner order, 2026-08-25 — see the removed block's own comment
 * further down for the full story). Degraded (old-backend) replies render
 * as plain 14px body text instead of a bold headline. Out-of-scope
 * answers use the exact same bubble anatomy as any other verdict — no
 * separate visual treatment. */
function VerdictBubble({ msg, onOfferTap }: { msg: VerdictMsg; onOfferTap: () => void }) {
  return (
    <div className="flex justify-start">
      <div className={PENNY_BUBBLE}>
        {msg.degraded ? (
          <p className="text-[14px] leading-relaxed text-slate-700 dark:text-slate-200 break-words"><MoneyText text={msg.headline} /></p>
        ) : (
          // 16px, not the previously-used 15px (design review, 2026-08-25:
          // 15px wasn't on DESIGN.md's type ramp). This is the same
          // Card/section-title token already used elsewhere for a verdict
          // line (e.g. ScenarioConfirmCard's "Here's what I understood"
          // heading and PennySheet.tsx's own header title, both
          // `text-[16px] font-bold` below) — reusing it here rather than
          // inventing a new size.
          <p className="text-[16px] font-bold leading-snug text-slate-900 dark:text-slate-100 break-words"><MoneyText text={msg.headline} /></p>
        )}
        {/* Middle tier: the reasoning sentence behind the verdict. Suppressed
            when `reply.startsWith(headline)`: the backend's defensive
            `_parse_headline_reply` (can_i.py) sets `headline` to the FIRST
            SENTENCE of `reply`, not necessarily the whole string, when the
            model ignores the structured-output format. Plain inequality
            only catches the case where they're identical; a model output
            like reply="Yes. That leaves £61 free until Friday." with
            headline="Yes." would pass `!==` and still duplicate the "Yes."
            fragment across both tiers. Don't simplify this back to `!==`.
            `outOfScope` used to also suppress this tier (the removed grey
            `facts` block below was doing the explaining on that path
            instead) — no longer: the backend now folds that same scope
            statement and worked example straight into `reply` itself (owner
            order, 2026-08-25, `facts` is always `[]`), so this tier is the
            ONLY place that content can render any more; suppressing it here
            too would show the out-of-scope headline with nothing under it. */}
        {msg.reply && !msg.reply.startsWith(msg.headline) && (
          <p className="mt-1.5 text-[14px] leading-relaxed text-slate-600 dark:text-slate-300 break-words">
            <MoneyText text={msg.reply} />
          </p>
        )}
        {/* The muted grey "facts" tier that used to render here is gone —
            owner order, 2026-08-25 (the "duplication war": his own
            screenshot showed a debt reply quoting "£23,587.71 carried
            across five cards" with a grey line underneath reading "£24,261
            total card debt", two unexplained aggregations of the same
            debt, side by side. "all these grayed out answers can we remove
            all of them."). The backend now always returns `facts: []`
            (see can_i.py) and folds anything that list used to show into
            `reply` itself instead; this block is removed rather than left
            as a dead `msg.facts.length > 0` no-op so an old in-session
            message that happens to carry a non-empty `facts` array (a
            stale cached message from before this change, in a
            long-lived session PennySheetProvider keeps alive) can never
            render a grey line again either. */}
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

// ── AGENT MODE v1 — ProposalConfirmCard / ConsentCard (owner decisions
// locked: confirm-as-is cards with NO inline edits, a one-time consent
// moment, origin badges on created artefacts, a 15-min server-enforced
// proposal TTL). Both are full-width `glass-card`s, deliberately NOT
// bubbles — the same CARVE-OUT as ScenarioConfirmCard above: a card with
// real buttons and a real side effect (creating something, granting an
// ongoing permission) doesn't belong squeezed into an 85-90%-wide speech
// bubble with a tail pointing at nothing. Siblings of ScenarioConfirmCard
// in every other sense: rendered full-width in the thread, keyed on the
// message's own stable `id`, holding no state ScenarioConfirmCard already
// solved a different way. ─────────────────────────────────────────────────

/** Confirm-as-is card for a single Penny-drafted action. Anatomy reuses
 * VerdictBubble's own two-tier hierarchy rather than inventing a new one:
 * `summary` is the headline (bold, heaviest, first), `consequence` is the
 * muted second line underneath it — exactly the verdict-then-reasoning
 * shape this file already uses everywhere else, just on a card instead of
 * a bubble. NO INLINE EDITING anywhere on this card (owner decision,
 * locked): there is no field here to change. If the user wants it
 * different, they say so in chat and Penny drafts a fresh proposal —
 * that's the entire correction mechanism, on purpose.
 *
 * Confirm is the app's single PRIMARY INDIGO treatment (`bg-indigo-600`
 * solid fill, DESIGN.md's Buttons section) — deliberately NOT the Penny
 * gradient ScenarioConfirmCard's "Run it" uses: that gradient marks "this
 * surface gives advice" (DESIGN.md's Penny Gradient Rule), where this
 * button's job is "commit a specific, already-drafted action", the same
 * job every other primary-indigo button in the app does. Cancel is quiet
 * text, no fill, no border — there is nothing to warn about (cancelling
 * changes nothing), so it doesn't earn Risk Red or even a Secondary/Ghost
 * button's border.
 *
 * `onConfirm`/`onCancel` fire exactly once per tap; the double-tap guard
 * itself lives in the caller (PennyConversation's confirmProposal/
 * cancelProposal, which check-and-flip `status` synchronously via
 * `bucketsRef` before the network call even starts), not here — this
 * component only reflects `status`, it never owns it. */
function ProposalConfirmCard({
  msg,
  onConfirm,
  onCancel,
  onOpenDone,
}: {
  msg: ProposalMsg;
  onConfirm: () => void;
  onCancel: () => void;
  /** Fired when the user taps a resolved "Done ..." row. Every v1 artefact
   * type (envelope/allocation, goal/commitment, one-off/planned) surfaces
   * on Planning, so the caller navigates there and closes the sheet — same
   * navigate-and-close behaviour as this file's own LinkChip. */
  onOpenDone: () => void;
}) {
  const { proposal, status } = msg;

  // Resolved states collapse into a quiet, bubble-shaped line — same
  // PENNY_BUBBLE shell every other Penny turn ends up in, so a resolved
  // proposal reads as an ordinary part of the conversation again rather
  // than a permanently full-width card. "Done" links through to the
  // surface that now shows the real thing; the honesty is in the copy
  // ("is set up", past tense, only reachable after a genuine 200), never a
  // silent disappearance.
  if (status === "done") {
    return (
      <div className="flex justify-start">
        <button
          type="button"
          onClick={onOpenDone}
          className="max-w-[90%] min-h-[44px] flex items-center gap-1 text-left bg-slate-100 dark:bg-slate-700 rounded-2xl rounded-bl-sm px-4 py-3 active:scale-[0.99] transition-transform focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
        >
          <span className="text-[14px] leading-relaxed text-slate-600 dark:text-slate-300 break-words">
            Done. <MoneyText text={proposal.summary} /> is set up
          </span>
          <ChevronRight size={14} className="flex-shrink-0 text-slate-400 dark:text-slate-500" aria-hidden="true" />
        </button>
      </div>
    );
  }
  if (status === "cancelled") {
    return (
      <div className="flex justify-start">
        <div className={PENNY_BUBBLE}>
          <p className="text-[14px] leading-relaxed text-slate-500 dark:text-slate-400">Cancelled, nothing changed.</p>
        </div>
      </div>
    );
  }
  if (status === "error") {
    return (
      <div className="flex justify-start">
        <div className={PENNY_BUBBLE}>
          {/* The server's own detail string, rendered honestly rather than
              a generic failure message — an expired (15-min TTL) or
              already-actioned proposal has a real, specific reason. */}
          <p className="text-[14px] leading-relaxed text-slate-500 dark:text-slate-400">
            {msg.errorDetail || "Couldn't do that just now."}
          </p>
          <p className="mt-1 text-[12px] text-slate-400 dark:text-slate-500">Ask me again if you&apos;d still like this done.</p>
        </div>
      </div>
    );
  }

  const busy = status === "executing";
  return (
    <div className="glass-card rounded-2xl p-4 w-full">
      <p className="text-[16px] font-bold leading-snug text-slate-900 dark:text-slate-100 break-words">
        <MoneyText text={proposal.summary} />
      </p>
      <p className="mt-1.5 text-[13px] leading-relaxed text-slate-500 dark:text-slate-400 break-words">
        <MoneyText text={proposal.consequence} />
      </p>
      <div className="mt-3 flex items-center gap-2">
        <button
          type="button"
          onClick={onConfirm}
          disabled={busy}
          className="min-h-[44px] flex-1 rounded-xl bg-indigo-600 text-white text-sm font-semibold disabled:opacity-60 active:scale-95 transition-transform focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
        >
          {busy ? "Setting up…" : "Confirm"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={busy}
          className="min-h-[44px] px-4 text-sm font-semibold text-slate-500 dark:text-slate-400 disabled:opacity-60 active:scale-95 transition-transform focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 rounded-xl"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

/** The one-time consent moment gating Penny's ability to act at all (as
 * opposed to only answer). Copy is Penny's own honest register: what it
 * would let her do, and the standing promise that every action still gets
 * a confirm card first — this card is the reason that promise is credible.
 * Same CARVE-OUT as ProposalConfirmCard above (real buttons, a real
 * ongoing-permission decision, not conversation).
 *
 * Accept uses the Penny GRADIENT (`BG`, same token ScenarioConfirmCard's
 * "Run it" uses) rather than plain indigo — deliberately the opposite
 * choice from ProposalConfirmCard's Confirm button just above: this button
 * isn't committing one drafted action, it's the literal gate to Penny's
 * advice-plus-action capability turning on at all, inside Penny's own
 * conversation surface (DESIGN.md's Penny Gradient Rule: "any surface
 * wearing it must be a place the user can get advice" — this is that
 * surface). Decline is quiet text, same weight as Cancel above; declining
 * costs nothing and risks nothing. */
function ConsentCard({
  msg,
  onAccept,
  onDecline,
}: {
  msg: ConsentMsg;
  onAccept: () => void;
  onDecline: () => void;
}) {
  if (msg.status === "declined") {
    return (
      <div className="flex justify-start">
        <div className={PENNY_BUBBLE}>
          <p className="text-[14px] leading-relaxed text-slate-600 dark:text-slate-300">Okay, I&apos;ll just answer for now.</p>
        </div>
      </div>
    );
  }
  if (msg.status === "accepted") {
    return (
      <div className="flex justify-start">
        <div className={PENNY_BUBBLE}>
          <p className="text-[14px] leading-relaxed text-slate-600 dark:text-slate-300">You can change your mind in Settings.</p>
          {/* The auto-resend indicator — the actual resend fires the moment
              `onAccept` resolves (see PennyConversation's acceptConsent /
              resendAfterConsent), this caption is what makes that
              invisible re-submission legible rather than a silent jump
              straight to a new answer. BouncingDots (this file, below)
              takes over as the visible "in flight" state the instant the
              resend's own `ask()` call sets `loading`. */}
          <p className="mt-1.5 text-[12px] text-slate-500 dark:text-slate-400">Asking again…</p>
        </div>
      </div>
    );
  }
  return (
    <div className="glass-card rounded-2xl p-4 w-full">
      <p className="text-[16px] font-bold leading-snug text-slate-900 dark:text-slate-100">
        Want me to be able to set things up for you?
      </p>
      <p className="mt-1.5 text-[14px] leading-relaxed text-slate-600 dark:text-slate-300">
        Things like envelopes, goals and one-offs. You&apos;ll always see exactly what would change and confirm before anything happens.
      </p>
      <div className="mt-3 flex items-center gap-2">
        <button
          type="button"
          onClick={onAccept}
          className="min-h-[44px] flex-1 rounded-xl text-white text-sm font-semibold active:scale-95 transition-transform focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
          style={{ background: BG }}
        >
          Yes, set things up
        </button>
        <button
          type="button"
          onClick={onDecline}
          className="min-h-[44px] px-4 text-sm font-semibold text-slate-500 dark:text-slate-400 active:scale-95 transition-transform focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 rounded-xl"
        >
          Not now
        </button>
      </div>
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

/** Dismissible suggestion pill — 44px target. Light indigo wash, not a
 * solid fill (2026-08-28, presentation fix — Kevin: "the chip on penny
 * looks like it's part of the conversation"). Root cause: this used to sit
 * on the same `bg-slate-50 dark:bg-slate-700` as any other quiet neutral
 * control, which in dark mode was PIXEL-IDENTICAL to PENNY_BUBBLE's own
 * `dark:bg-slate-700` fill (this file, above) — a chip and Penny's own
 * message bubble were, literally, the same colour, which is exactly why a
 * chip read as another turn in the thread instead of an offer floating
 * over it. `bg-indigo-50/70 dark:bg-indigo-500/10` can't collide with
 * either message fill: not PENNY_BUBBLE's neutral slate-100/700, not
 * UserBubble's solid indigo-600, and it's a flat tint, never
 * BRAND_GRADIENT (DESIGN.md's Penny Gradient Rule reserves that gradient
 * for the AI adviser itself, not for an offer to go ask it something).
 * Still a real fill, not fully transparent like LinkChip below, on
 * purpose: some fill is what lets this pill keep reading over scrolling
 * content without borrowing the page behind it for contrast (LinkChip
 * never scrolls independently of its neighbour, so it can afford to be
 * pure outline), and fill-vs-transparent is the signal that keeps the two
 * chip kinds visually distinct at a glance — see LinkChip's own comment
 * for the full "why they differ" case. Kept deliberately quieter than
 * OfferChip's own indigo CTA (`border-indigo-200 text-indigo-600
 * font-semibold`, this file above): OfferChip proposes a financial action;
 * this is only a question you could ask, so its indigo stays a whisper in
 * the frame, never in the text.
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
      className={`inline-flex items-center flex-shrink-0 whitespace-nowrap min-h-[44px] rounded-full border border-indigo-100 dark:border-indigo-800/50 bg-indigo-50/70 dark:bg-indigo-500/10 gap-1 ${
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
          className="relative w-7 h-7 flex items-center justify-center rounded-full text-slate-500 dark:text-slate-400 active:bg-indigo-100 dark:active:bg-indigo-500/20 transition-colors before:absolute before:-inset-y-2 before:-inset-x-1 before:content-[''] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
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
// rationale (`summary`/one-shot `ask`), which still lives
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
   * comment on why the `askContext.ask` one-shot effect
   * below keys off this rather than a plain "have I ever fired" ref: this
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
  // One conversation per screen (see `ThreadBucket`'s own comment above,
  // "PER-SCREEN THREADS"). `currentScreen` falls back to "other" both for
  // full-page mode (no `askContext` at all) and for a sheet opened from an
  // unrecognised route (`askContext.screen === "other"`) — either way
  // there's exactly one bucket for it. Recomputed fresh every render so a
  // reopen over a different screen (this component is mounted once for the
  // whole session, see this file's header comment) picks up that screen's
  // own bucket immediately.
  const currentScreen: PennyAskContext["screen"] = askContext?.screen ?? "other";
  const [buckets, setBuckets] = useState<Record<PennyAskContext["screen"], ThreadBucket>>(newBuckets);
  // `messages`/`askedLabels` below name exactly the two fields the rest of
  // this component already reads by these names (rendering, chip
  // filtering, the scroll-on-new-message effect) — deriving them from the
  // current bucket here means none of that downstream code needs to know
  // buckets exist at all.
  const { messages, askedLabels } = buckets[currentScreen];
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [offer, setOffer] = useState<CanIOffer | null>(null);
  const [offerSheetOpen, setOfferSheetOpen] = useState(false);
  const [input, setInput] = useState("");
  // Personalised £-chips (canISuggestions) and dismissed-chip bookkeeping
  // both stay GLOBAL, not per-bucket (owner spec, 2026-08-26, "PER-SCREEN
  // THREADS": only the conversation itself — messages, askedLabels,
  // lastActivityAt — is bucketed). `chips` is one app-wide fetch (see the
  // effect below) grounded in the user's own balances, not in which screen
  // opened Penny, so there's nothing screen-specific to bucket. A chip a
  // user dismissed with the X (full-page mode's row only, see
  // `SuggestionChip`'s own comment) is a "don't show me this one again"
  // decision, not a per-conversation one, so it stays suppressed
  // everywhere too — unlike `askedLabels`, which deliberately DOES move
  // per-bucket (see `send()`) so a chip already asked on Spend still shows
  // up as an option on Home.
  const [chips, setChips] = useState<CanISuggestionChip[]>([]);
  const [dismissedChips, setDismissedChips] = useState<Set<string>>(new Set());
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
  // `askContext.summary` grounds ONE request only — the first this
  // component ever sends, regardless of whether that's `askContext.ask`
  // or a manually typed question (whichever fires first) — for the WHOLE
  // SESSION, not per open. Deliberately left as a
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
  // Mirrors `buckets` state for reads inside event handlers (`send`,
  // `retry`) and the TTL-expiry effect below, instead of those functions
  // closing over the `buckets` state variable directly. Why this matters:
  // React only makes a new state value visible in closures created during
  // the NEXT render — not to code still running later in the SAME commit's
  // effect phase. The TTL-expiry effect and the `askContext.ask` one-shot
  // effect below can both fire in that same commit (a reopen after 30+
  // idle minutes that also carries a fresh `ask`), and the second effect
  // calls `send()`, a function closed over THIS render's now-stale
  // `buckets`. The THREAD ITSELF still ends up correct either way (every
  // `setBucket` call uses an updater function, and React feeds each queued
  // updater the PRIOR updater's result as `prev`, so the clear-then-append
  // sequence resolves correctly) — but anything `send()` reads OUTSIDE
  // that updater's `prev` argument (the LLM `history` payload) would
  // otherwise still see the pre-clear, 30-minutes-stale bucket. Reading
  // `bucketsRef.current` instead of `buckets` in those spots sidesteps the
  // staleness entirely. Kept in lockstep with `buckets` through `setBucket`
  // below — every mutation goes through that one function, never a bare
  // `setBuckets` call, so the two can never drift apart.
  const bucketsRef = useRef<Record<PennyAskContext["screen"], ThreadBucket>>(newBuckets());
  /** Updates ONE bucket, leaving every other screen's thread untouched.
   * `updater` receives that bucket's value from `bucketsRef` (not the
   * `buckets` state variable — see that ref's own comment above) so a
   * caller building on `prev` never reads a stale pre-commit snapshot. */
  function setBucket(screen: PennyAskContext["screen"], updater: (prev: ThreadBucket) => ThreadBucket) {
    const next = { ...bucketsRef.current, [screen]: updater(bucketsRef.current[screen]) };
    bucketsRef.current = next;
    setBuckets(next);
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

  /** Slides a bucket's thread window to the newest `HISTORY_CAP` messages.
   * Kept as its own named step (rather than an inline `.slice(-HISTORY_CAP)`
   * at each append site) since every append to a bucket's `messages` needs
   * it applied identically. Used to also skip past page-seam markers
   * without letting them consume a slot — markers are gone entirely now
   * (see this file's header comment, "PER-SCREEN THREADS"), so this is a
   * plain slice with nothing left to skip. */
  function capMessages(msgs: Msg[]): Msg[] {
    return msgs.slice(-HISTORY_CAP);
  }

  function buildHistory(msgs: Msg[]): Array<{ role: "user" | "assistant"; content: string }> {
    // `.slice` here is a defensive no-op against the live bucket state,
    // which `capMessages` above already keeps capped to `HISTORY_CAP` by
    // construction — kept in case `buildHistory` is ever called with an
    // uncapped array from a future call site.
    return msgs
      .slice(-HISTORY_CAP)
      .map((m) => {
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
          : m.kind === "proposal"
          ? `I proposed: ${m.proposal.summary} (${m.status}).`
          : m.kind === "consent"
          ? "I asked whether I could set things up automatically on your behalf."
          : m.reply ?? m.headline;
        return { role: "assistant" as const, content };
      });
  }

  async function ask(question: string, history: Array<{ role: "user" | "assistant"; content: string }>, context?: string) {
    // `askContext?.screen` is read HERE, at send time, not captured once
    // into a ref — `askContext` is a prop that PennySheet.tsx re-passes
    // fresh from its own live `ctx` on every render (see
    // PennySheetProvider.tsx's `usePennySheetState`), so a reopen of this
    // session-long component over a DIFFERENT screen already re-renders
    // this component with the new `askContext` before any further question
    // can be typed or sent. Reading it directly here — captured into a
    // local BEFORE the `await` below, so it reflects whatever screen was
    // current at the moment this call fired rather than whatever screen
    // happens to be current by the time the response lands — is what makes
    // that hold, and now does double duty: `sendScreen` is both the value
    // sent to the backend (unchanged: `undefined` in full-page mode, a real
    // screen or "other" in sheet mode) AND, via `bucketScreen`, which
    // bucket the eventual answer is appended to. That second part matters
    // because this component never unmounts and the sheet closes on
    // navigation (see this file's header comment, "PER-SCREEN THREADS") —
    // a slow answer can easily land after the user has already switched to
    // a different screen and reopened over it, and it must still land in
    // the bucket that actually asked, not whichever bucket is on screen
    // when the response arrives.
    const sendScreen = askContext?.screen;
    const bucketScreen: PennyAskContext["screen"] = sendScreen ?? "other";
    setError(false);
    setLoading(true);
    try {
      const res = await api.canI(question, history, context, sendScreen);
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
      } else if (res.consent_required) {
        // Agent mode v1's one-time gate — checked BEFORE `res.proposal`
        // (the two are mutually exclusive on the wire, but consent takes
        // priority if a backend ever somehow set both): nothing has been
        // drafted yet, there's only a permission question to answer.
        assistantMsg = { id, role: "assistant", kind: "consent", status: "pending" };
      } else if (res.proposal) {
        // Agent mode v1's confirm-as-is card — see ProposalMsg's own doc
        // comment. Never auto-actioned: nothing happens until Confirm.
        assistantMsg = { id, role: "assistant", kind: "proposal", proposal: res.proposal, status: "pending" };
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
      // Appended to the bucket the question was ASKED from (`bucketScreen`,
      // captured above), not necessarily whatever bucket is on screen now.
      // Also TTL bookkeeping (see `PENNY_THREAD_TTL_MS` and the expiry
      // effect below) — resets that bucket's idle clock, same as `send()`
      // does for its own bucket on the way out.
      setBucket(bucketScreen, (prev) => ({
        ...prev,
        messages: capMessages([...prev.messages, assistantMsg]),
        lastActivityAt: Date.now(),
      }));
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
    // Reads `bucketsRef.current`, not the `buckets` state variable — see
    // that ref's own comment on why event handlers go through it (the
    // short version: this function's closure can be stale by the time it
    // actually runs, specifically when the TTL-expiry effect below clears
    // this bucket in the SAME commit that also fires the `askContext.ask`
    // effect that calls this).
    const priorMessages = bucketsRef.current[currentScreen].messages;
    const history = buildHistory(priorMessages);
    // Appends the user's turn AND marks it asked, in ONE bucket update —
    // `currentScreen`'s own thread, never any other screen's (see this
    // file's header comment, "PER-SCREEN THREADS"). `askedLabels` moving
    // per-bucket here (rather than staying a single global set, the way
    // `dismissedChips` does — see that state's own comment above) is the
    // point of a chip asked on Spend staying offered on Home: this only
    // ever touches Spend's bucket.
    setBucket(currentScreen, (prev) => ({
      messages: capMessages([...prev.messages, { id: newMsgId(), role: "user" as const, content: trimmed }]),
      askedLabels: new Set(prev.askedLabels).add(trimmed),
      lastActivityAt: Date.now(),
    }));
    setInput("");
    setOffer(null);
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
    //
    // Contrast with `askContext.screen`, sent alongside this on every call
    // (inside `ask()` itself, not computed here): `summary` is deliberately
    // ONE-SHOT (`summaryConsumedRef` above gates it to the first request per
    // screen) because it's a free-text sentence that would get stale and
    // repetitive if resent on every follow-up. `screen` is the opposite —
    // cheap structured data (an enum tag, not prose), so there's no cost to
    // resending it, and the whole point of having it is that ANY question
    // mid-conversation ("what about this page") needs the CURRENT screen,
    // not just whichever screen was open when the thread started. Don't
    // fold `screen` into this one-shot gate.
    const context = askContext?.summary && !summaryConsumedRef.current ? askContext.summary : undefined;
    if (context) summaryConsumedRef.current = true;
    ask(trimmed, history, context);
  }

  function retry() {
    if (loading) return;
    // `bucketsRef.current`, not `buckets` state — see that ref's comment.
    // Retries the last user turn in the CURRENTLY VIEWED bucket — the same
    // thread the error/retry bubble is rendered in.
    const current = bucketsRef.current[currentScreen].messages;
    const last = current[current.length - 1];
    if (!last || last.role !== "user") return;
    const history = buildHistory(current.slice(0, -1));
    ask(last.content, history);
  }

  // ── AGENT MODE v1 — proposal Confirm/Cancel and the consent gate's
  // Accept/Decline. All four mutate ONE message in place (by `id`), never
  // append or remove — the message itself is the thread's permanent record
  // of what was asked and how it was resolved (a resolved card collapses
  // its own presentation, see ProposalConfirmCard/ConsentCard, it never
  // vanishes). Every mutation goes through `setBucket` (this file's own
  // `bucketsRef`-backed updater — see that function's comment above) so a
  // background TTL expiry or a screen switch mid-flight can never silently
  // undo one of these. ──────────────────────────────────────────────────

  /** Confirm — fires POST /penny/proposals/{id}/execute exactly once, even
   * on a double-tap: `status` flips to "executing" SYNCHRONOUSLY (via
   * `setBucket`, which writes `bucketsRef.current` immediately, not on
   * React's next commit — see that function's own comment) before the
   * network call starts, and the guard below reads that same ref, so a
   * second tap in the same event loop turn as the first already sees
   * "executing" and no-ops. The button itself is also `disabled` while
   * busy (ProposalConfirmCard), belt-and-braces on top of this. */
  function confirmProposal(screen: PennyAskContext["screen"], msgId: number, proposalId: string) {
    const current = bucketsRef.current[screen].messages.find(
      (m): m is ProposalMsg => m.role === "assistant" && m.kind === "proposal" && m.id === msgId
    );
    if (!current || current.status !== "pending") return;
    setBucket(screen, (prev) => ({
      ...prev,
      messages: prev.messages.map((m) =>
        m.role === "assistant" && m.kind === "proposal" && m.id === msgId ? { ...m, status: "executing" as const } : m
      ),
    }));
    api.executePennyProposal(proposalId)
      .then(() => {
        setBucket(screen, (prev) => ({
          ...prev,
          messages: prev.messages.map((m) =>
            m.role === "assistant" && m.kind === "proposal" && m.id === msgId ? { ...m, status: "done" as const } : m
          ),
        }));
      })
      .catch((e: unknown) => {
        // The backend's own detail string (expired/cancelled/already-
        // actioned) — see api.executePennyProposal's `toJson` routing.
        // Never a silent failure: this always lands as a visible, honest
        // error line with an "ask me again" hint (ProposalConfirmCard).
        setBucket(screen, (prev) => ({
          ...prev,
          messages: prev.messages.map((m) =>
            m.role === "assistant" && m.kind === "proposal" && m.id === msgId
              ? { ...m, status: "error" as const, errorDetail: e instanceof Error ? e.message : undefined }
              : m
          ),
        }));
      });
  }

  /** Cancel — same "pending only" guard as confirmProposal, fire-and-forget
   * on the network call: the card already reflects "cancelled" the instant
   * the user taps it (nothing to wait on, cancelling can't meaningfully
   * fail from the user's point of view), so a failed DELETE-equivalent on
   * the server is swallowed rather than surfaced — same treatment
   * CommitmentSheet's own offer hand-off gives a fire-and-forget follow-up. */
  function cancelProposal(screen: PennyAskContext["screen"], msgId: number, proposalId: string) {
    const current = bucketsRef.current[screen].messages.find(
      (m): m is ProposalMsg => m.role === "assistant" && m.kind === "proposal" && m.id === msgId
    );
    if (!current || current.status !== "pending") return;
    setBucket(screen, (prev) => ({
      ...prev,
      messages: prev.messages.map((m) =>
        m.role === "assistant" && m.kind === "proposal" && m.id === msgId ? { ...m, status: "cancelled" as const } : m
      ),
    }));
    api.cancelPennyProposal(proposalId).catch(() => {});
  }

  /** Accept the one-time consent gate: grant, flip the card to "accepted",
   * then auto-resend the question that triggered the gate (see
   * resendAfterConsent below). Left pending (not flipped) on a failed
   * grant so the same tap can be retried — there's no separate error copy
   * for this path, the card just stays exactly as it was. */
  function acceptConsent(msgId: number) {
    const screen = currentScreen;
    api.grantPennyAgentConsent()
      .then(() => {
        setBucket(screen, (prev) => ({
          ...prev,
          messages: prev.messages.map((m) =>
            m.role === "assistant" && m.kind === "consent" && m.id === msgId ? { ...m, status: "accepted" as const } : m
          ),
        }));
        resendAfterConsent(msgId);
      })
      .catch(() => {});
  }

  function declineConsent(msgId: number) {
    const screen = currentScreen;
    setBucket(screen, (prev) => ({
      ...prev,
      messages: prev.messages.map((m) =>
        m.role === "assistant" && m.kind === "consent" && m.id === msgId ? { ...m, status: "declined" as const } : m
      ),
    }));
    // No resend on decline (contrast with acceptConsent below): the user's
    // original action-shaped ask simply goes unanswered — Penny never had
    // permission to act on it, and there is nothing read-only left to
    // answer from the same question. Ordinary informational questions keep
    // working exactly as before; this gate never touched those.
  }

  /** Re-submits the question that triggered a consent gate, once the user
   * accepts. Deliberately NOT a call to `retry()` above: `retry()` only
   * ever resends the LAST message in the bucket when it happens to be the
   * user's own turn, but by the time Accept is tapped the consent card
   * itself is the last message (it was appended as Penny's reply to that
   * question) — `retry()`'s tail check would see an assistant turn and
   * silently no-op. This walks backward from the consent card's own
   * position instead, finds the nearest preceding user turn, and resends
   * it with the history that came before IT — otherwise identical to
   * `retry()` (same `buildHistory`/`ask()` primitives, same "read
   * `bucketsRef.current`, not the `buckets` state variable" reasoning). */
  function resendAfterConsent(consentMsgId: number) {
    const current = bucketsRef.current[currentScreen].messages;
    const consentIdx = current.findIndex((m) => m.role === "assistant" && m.kind === "consent" && m.id === consentMsgId);
    const before = consentIdx >= 0 ? current.slice(0, consentIdx) : current;
    for (let i = before.length - 1; i >= 0; i--) {
      const m = before[i];
      if (m.role === "user") {
        ask(m.content, buildHistory(before.slice(0, i)));
        return;
      }
    }
  }

  // ?ask=<question> — submit exactly once on mount.
  useEffect(() => {
    if (initialQuestion && !initialFiredRef.current) {
      initialFiredRef.current = true;
      send(initialQuestion);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialQuestion]);

  // Inactivity TTL (`PENNY_THREAD_TTL_MS`, 30 minutes) — checked once per
  // bucket becoming VISIBLE (`askSeq` territory), not on a background
  // timer: this is a client component with no polling loop, and a stale
  // thread only matters at the moment the user actually comes back to look
  // at it. "Becoming visible" covers both an open and a screen switch —
  // PennySheet.tsx's own mount comment notes the sheet closes on
  // navigation, so a switch always arrives as a fresh open too, i.e. a
  // fresh `askSeq` — see this file's header comment, "PER-SCREEN THREADS".
  // Only `currentScreen`'s OWN bucket is checked/cleared here; every other
  // bucket's clock keeps running untouched until IT becomes visible.
  // `askSeq == null` guards the full-page caller the same way the effect
  // below does — full-page mode has no reopen concept to key this off.
  //
  // ORDERING, load-bearing: this effect MUST be declared (and therefore
  // run) BEFORE the `askContext.ask` effect immediately below. Both are
  // plain `useEffect`s that can fire on the SAME `askSeq` change (a reopen
  // after 30+ idle minutes that also carries a fresh one-shot `ask`), and
  // React runs same-phase effects in the order they were declared during
  // render — so listing this one first guarantees its clear happens before
  // that effect's `send()` call. Concretely: `setBucket` here resets
  // `bucketsRef.current[currentScreen]` (synchronously, on the spot) and
  // queues the state update. By the time the next effect runs `send()`,
  // that bucket is already a fresh, empty one — so `send()` builds its LLM
  // history from a genuinely empty prior thread and treats the question as
  // the first message of a new conversation, rather than reading the
  // just-expired, 30-minutes-stale thread through a closure that hasn't
  // re-rendered yet. Reordering these two effects, or merging them into
  // one, would silently break that guarantee — do not do either without
  // re-verifying this reasoning holds.
  //
  // Expiry is SILENT — no "this conversation expired" system message added
  // to the fresh bucket. A notice would memorialise a conversation the
  // user has already forgotten they had; the entire point of the TTL is
  // that a stale morning thread shouldn't greet them at night, not that it
  // should announce its own death on the way out.
  useEffect(() => {
    if (askSeq == null) return;
    const bucket = bucketsRef.current[currentScreen];
    const idleFor = Date.now() - bucket.lastActivityAt;
    if (idleFor > PENNY_THREAD_TTL_MS && bucket.messages.length > 0) {
      setBucket(currentScreen, () => newBucket());
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [askSeq, currentScreen]);

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
  // fire on open (now removed, see the thread's opening-slot comment
  // further down for the full history), and any chip/typed ask a
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
  // payday auto-ask (see the thread's opening-slot comment further down
  // for the full history) appending a message on open, which
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
  // DEDUPE (owner screenshot, 2026-08-25: "Still due?" sitting right next to
  // "What's still due before payday?" in the chip row — the same question,
  // twice). The backend's personalised `canISuggestions` are reassurance-
  // shaped free text, not aware of this screen's config chips, so they can
  // independently land on the exact same question a config `ask` chip
  // already covers (PAYDAY_DUE_ASK above is the case that shipped this
  // bug). Compared case-insensitively and whitespace-trimmed against every
  // config `ask` chip's `q` (what it actually SENDS, not a paraphrase of
  // it) and against every personalised suggestion already kept, so two
  // backend suggestions that happen to collide with each other don't both
  // render either. The config chip always wins a collision: it's already
  // ahead of `personalisedSuggestions` in priority order below, so this
  // only ever drops the personalised side.
  const configAskQuestions = new Set(
    visibleConfigChips.filter((c) => c.kind === "ask").map((c) => c.q.trim().toLowerCase())
  );
  const seenPersonalisedLabels = new Set<string>();
  const dedupedPersonalisedSuggestions = personalisedSuggestions.filter((c) => {
    const key = c.label.trim().toLowerCase();
    if (configAskQuestions.has(key) || seenPersonalisedLabels.has(key)) return false;
    seenPersonalisedLabels.add(key);
    return true;
  });
  const allChips: (
    | { source: "personalised"; label: string }
    | (PennyChip & { source: "config" })
  )[] = [
    ...deterministicAskChips.map((c) => ({ ...c, source: "config" as const })),
    ...linkChips.map((c) => ({ ...c, source: "config" as const })),
    ...llmAskChips.map((c) => ({ ...c, source: "config" as const })),
    ...dedupedPersonalisedSuggestions,
  ].slice(0, chipCap);

  // The composer's inner markup (input + send button, then the disclaimer
  // line) is identical in both modes — only the SHELL around it differs,
  // and deliberately so, not as leftover duplication:
  // - Full-page mode floats this composer `position: fixed` over the page
  //   (see the render below), with no ambient panel behind it, so it needs
  //   to BE a surface of its own: a `glass-card` fill, rounded corners, and
  //   a shadow to lift it off whatever page content scrolls underneath.
  // - Sheet mode already sits inside `glass-sheet`'s own panel
  //   (PennySheet.tsx). Wrapping the same content in a second, nested card
  //   there stacked that card's own `px-3` on top of the wrapper's `px-5`
  //   below (owner screenshot, 2026-08-25: "this margin around the textbox
  //   forces the padding on the send button and textbox to be more than
  //   the other components") — the input and send button sat visibly
  //   deeper from the panel edge than the chip row and thread above, which
  //   share that same bare `px-5` with nothing layered on top. Sheet mode
  //   therefore renders `composerContent` directly, with no card fill, no
  //   rounded container, no shadow, and no inner horizontal padding — a
  //   flush child of the `px-5 pt-2 pb-6` wrapper below, landing on the
  //   exact same inset as the chip row and every bubble. The `<input>`
  //   itself keeps its own pill styling (`rounded-full`, border,
  //   background) in both modes either way — that's a form control's own
  //   chrome, not the retired outer shell.
  //
  // Defined inline (not hoisted to a separate component) because it closes
  // over this render's `input`/`loading`/`placeholder` state and
  // `inputRef`; only one shell ever mounts it at a time, so there's no
  // duplicate-instance risk.
  const composerContent = (
    <>
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
    </>
  );
  // Full-page mode's own floating surface (see the comment above for why it
  // still needs one) — sheet mode never uses this, it mounts
  // `composerContent` bare instead. See the render below.
  const composerCard = (
    <div className="glass-card rounded-2xl px-3 pt-2.5 pb-2 shadow-lg">{composerContent}</div>
  );

  // The consecutive-bubble fact-dedupe machinery that used to live here
  // (`displayMessages`, a render-time-only pass over `messages` that
  // suppressed a verdict's `facts` line when the immediately preceding
  // assistant bubble had already shown the identical line) is dead: the
  // grey facts tier it was deduplicating no longer renders at all (owner
  // order, 2026-08-25, the duplication war — see VerdictBubble's own
  // comment on the removed block). With nothing left to dedupe, this
  // component now renders straight from `messages`.

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

          FULL SENTENCES, not summarised (2026-08-25, REVERTED from the
          summarised form above — owner screenshot: the row showed "Still
          due?" right next to "What's still due before payday?", the SAME
          question twice, once via a config chip's now-unused `short` label
          and once via a personalised suggestion whose full label came
          through untransformed since `shortPersonalisedLabel` only stripped
          "Can I spend/put/afford" lead-ins, not a reassurance-shaped
          question like that one. Diagnosis: summarising also strips
          meaning — "Still due?" isn't parseable on its own — and this row
          scrolls horizontally precisely so a full question's length is
          fine, per this block's own comment above. So every chip here now
          renders its full `label`/`q` (`shortPersonalisedLabel` removed
          entirely; `PennyChip.short`, lib/pennyScreenConfig.tsx, is kept in
          the type but no longer read anywhere in this row — see that
          field's own comment for why it wasn't ripped out of every config
          entry). `ariaLabel` is dropped below for the same reason: it only
          ever differed from the visible label to carry the FULL text for
          screen readers when the visible text was shortened — with nothing
          shortened any more, the visible label already IS the accessible
          name (SuggestionChip falls back to its child text), same as
          full-page mode's row further down always did.

          DEDUPED before rendering (this render's `allChips`, built above
          from `dedupedPersonalisedSuggestions`): a personalised suggestion
          whose label collides, case-insensitively and trimmed, with a
          config `ask` chip's `q` (or with another personalised suggestion
          already kept) never reaches this row — the config chip wins. See
          that dedupe's own comment above `allChips` for why the backend's
          suggestions can collide with a screen's curated set at all.

          SELECTION BEHAVIOUR — the core change: an `ask` chip here no
          longer calls `send()`. It POPULATES the composer with the chip's
          FULL question text so the user can edit or just hit send.
          NO FOCUS CALL (2026-08-25, owner reversal: "when a user selects a
          chip it shouldn't automatically bring up the keyboard, or focus
          on the text box"). An earlier version of this comment argued tap-
          triggered focus was fine here as "the same class of user-
          initiated focus a normal text input gets when you tap it" —
          overruled by the owner above, not by a bug: populating the
          composer already shows the chip's question was heard, and the
          send button works perfectly well unfocused, so autofocus just
          costs a keyboard popping up the user didn't ask for. That
          reasoning is dead; do not restore the `.focus()` call on this
          rule's authority. `link` chips are unchanged: navigate + close,
          same as the bottom row. No `onDismiss` is ever passed here — see
          `SuggestionChip`'s own comment on why the X is gone from this row
          specifically (population makes a chip zero-commitment, nothing
          to dismiss).

          OWN SURFACE, hairline-bounded (2026-08-28, presentation fix —
          Kevin: "the chip on penny looks like it's part of the
          conversation"). This row already sat structurally apart from
          `messages` (it's a sibling of the scroll container, not inside
          it), but nothing marked that boundary to the eye: PennySheet.tsx's
          header divider closes off the top of this strip, yet the BOTTOM
          of it fed straight into the thread with no line between a chip and
          the first bubble below it, so a glance could still read the row as
          the start of the conversation rather than a control sitting above
          it. `border-b` below (same hairline token as the header's own
          divider, PennySheet.tsx) closes the strip on both edges, the same
          bordered-inset idiom the rest of this app uses for a distinct
          band (see DESIGN.md's Instrument Header, `glass-tile` inset). See
          `SuggestionChip`'s own comment for the matching fill fix (the
          other half of this same complaint). */}
      {inSheet && allChips.length > 0 && (
        // `pt-1` -> `pt-0.5` (design review, 2026-08-25): paired with
        // PennySheet.tsx's header divider `mt-1.5` -> `mt-1` change, tightens
        // the seam between the header's links row/divider and this chip row
        // so the two read as one utility cluster above the thread rather
        // than two separated bands of tap targets. 44px chip/link targets
        // are untouched, only the padding around them shrank.
        //
        // `pb-1 border-b` (2026-08-28) moved down from the scrollable row
        // below onto this outer wrapper, same 4px of breathing room, now
        // followed by a hairline rather than falling straight into the
        // thread — see this block's own header comment above.
        <div className="shrink-0 relative px-5 pt-0.5 pb-1 border-b border-slate-200/70 dark:border-slate-700">
          <div className="flex items-center gap-2 overflow-x-auto scrollbar-hide">
            {allChips.map((c) => {
              if (c.source === "personalised") {
                const full = c.label;
                return (
                  <SuggestionChip
                    key={`top-personalised-${c.label}`}
                    label={full}
                    onTap={() => setInput(full)}
                  />
                );
              }
              if (c.kind === "link") {
                return (
                  <LinkChip
                    key={`top-config-link-${c.label}`}
                    label={c.label}
                    onTap={() => { closePennySheet(); router.push(c.href); }}
                  />
                );
              }
              return (
                <SuggestionChip
                  key={`top-config-ask-${c.q}`}
                  label={c.label}
                  onTap={() => setInput(c.q)}
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
            className="pointer-events-none absolute inset-y-0 right-5 w-6 bg-gradient-to-l from-white dark:from-slate-900 to-transparent"
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
        className={inSheet ? "flex-1 min-h-0 overflow-y-auto space-y-3 px-5" : "space-y-3"}
      >
        {/* A deterministic "Payday is close..." lead bubble used to render
            here, ahead of `messages`, built from api.safeToSpend() to
            honour the amber nav dot's promise that something payday-
            specific was waiting when the sheet opened during the payday
            window. Killed by the owner (2026-08-25): it duplicated the
            Safe-to-Spend hero already visible on the Home page behind this
            sheet — "the payday is close doesn't make sense, this is
            already on the home page so isn't needed". That promise now
            lands via the payday chip in the chip row above
            (PAYDAY_STATUS_ASK/PAYDAY_DUE_ASK, lib/pennyScreenConfig.tsx)
            and the header's "Your plan and updates" link (PennySheet.tsx),
            not a bubble injected on open. Do not rebuild this without
            re-reading this comment; this surface has had features rebuilt
            from misread history before. */}
        {messages.map((m) => {
          // Keyed on `m.id`, NOT array index — see the `id` field comment
          // on the Msg union above (`messages` is a sliding window, so an
          // index key would reuse instances across shifted content once
          // the thread exceeds HISTORY_CAP).
          if (m.role === "user") return <UserBubble key={m.id} text={m.content} />;
          if (m.kind === "scenario") {
            // Full-width form, deliberately NOT a bubble — see the
            // CARVE-OUT comment on ScenarioConfirmCard's own doc comment.
            return <ScenarioConfirmCard key={m.id} items={m.items} rejected={m.rejected} prefilled={m.prefilled} onRun={runScenario} />;
          }
          if (m.kind === "explainer") {
            return <ExplainerBubble key={m.id} msg={m} />;
          }
          if (m.kind === "proposal") {
            // Full-width card, deliberately NOT a bubble — same CARVE-OUT
            // as ScenarioConfirmCard/ConsentCard (real buttons, a real
            // side effect). `screen`/`msgId` captured here from the
            // CURRENTLY VIEWED bucket (`currentScreen`) — only that
            // bucket's messages ever render, so this is always the right
            // bucket for the mutation.
            return (
              <ProposalConfirmCard
                key={m.id}
                msg={m}
                onConfirm={() => confirmProposal(currentScreen, m.id, m.proposal.proposal_id)}
                onCancel={() => cancelProposal(currentScreen, m.id, m.proposal.proposal_id)}
                onOpenDone={() => { closePennySheet(); router.push("/planning"); }}
              />
            );
          }
          if (m.kind === "consent") {
            return (
              <ConsentCard
                key={m.id}
                msg={m}
                onAccept={() => acceptConsent(m.id)}
                onDecline={() => declineConsent(m.id)}
              />
            );
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
          unreachable in production today — kept, unchanged (bar the same
          hairline/fill fix the sheet row above got, 2026-08-28, so the two
          modes stay presentationally in step even though only one of them
          ships) only so the full-page path stays behaviourally intact
          rather than being ripped out, per instruction. Survives an answer
          instead of disappearing (removed only once asked or explicitly
          dismissed); scrolls with the thread, composer below stays docked.

          `border-t` (2026-08-28, presentation fix, same complaint as the
          sheet row above): this row sits AFTER the thread in flow, so its
          own hairline goes on top rather than the bottom, closing the gap
          between the last bubble and this row the same way the sheet row's
          `border-b` closes the gap before ITS thread. */}
      {!inSheet && allChips.length > 0 && (
        <div className="flex flex-wrap gap-2 mt-3 pt-3 border-t border-slate-200/70 dark:border-slate-700">
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
          comment and the two-prop contract. `px-5` (2026-08-25, owner: the
          sheet's bubbles/chips/composer "don't look like they have
          adequate space from the margin of the chat window" — this was
          `px-1` and visibly kissed the panel's `rounded-3xl` edge) matches
          CommitmentSheet's own content inset (components/CommitmentSheet.tsx,
          `px-5` on both its header and its scrollable body) rather than
          inventing a new value — same `glass-sheet` shell convention, so
          this sheet's insets read as the same family. The thread container
          and the top chip row further up share this same `px-5`, so the
          composer, the chip row, and every bubble's edge line up on one
          consistent inset instead of three different values.

          `pb-6` (2026-08-25, owner: "there is no bottom margin from the
          text box") — this wrapper is the LAST child in the panel's flex
          column (PennySheet.tsx), so with only `pt-2` above and nothing
          below, `composerCard`'s own bottom edge sat flush against the
          panel's `rounded-3xl` bottom corners, same missing-breathing-room
          bug as the `px-5` fix above but on the remaining axis. `1.5rem`
          matches CommitmentSheet's own bottom-of-scroll-region inset
          (components/CommitmentSheet.tsx, `paddingBottom: "calc(1.5rem +
          env(safe-area-inset-bottom, 0px))"`) rather than inventing a new
          value — same interior-padding scale as the `px-5` match above,
          just the bottom-specific instance of it. The safe-area term isn't
          carried over: CommitmentSheet is pinned to the literal bottom of
          the viewport (`fixed inset-x-0 bottom-0`), so it needs the home-
          indicator clearance; this floating panel already sits well clear
          of the screen edge (PennySheet.tsx's `bottom-[calc(110px+env(
          safe-area-inset-bottom,0px))]` wrapper), so `pb-6` alone is
          genuine interior padding, not safe-area duplicated on top of an
          already-safe position.
          Composes cleanly with the on-screen-keyboard inset: that inset is
          a `marginBottom` on the PANEL itself (PennySheet.tsx's
          `keyboardInset`), pushing the whole floating window up as a unit
          when the keyboard opens, not a property of this composer wrapper
          — so this `pb-6` (interior space, panel-relative) and that
          `marginBottom` (whole-panel position, viewport-relative) sit on
          different elements and never fight each other.

          Sheet mode mounts `composerContent` here, NOT `composerCard` — no
          glass fill, no rounded shell, no shadow, no inner `px-3`. See the
          comment above `composerContent`'s own declaration for why the two
          modes' shells differ (floats-over-page vs flush-in-panel); this is
          what makes the input's left edge land on the same `px-5` inset as
          the chip row and every bubble above it instead of sitting deeper
          from the panel edge than they do. */}
      {inSheet ? (
        <div className="shrink-0 px-5 pt-2 pb-6">{composerContent}</div>
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
            // Lands in `currentScreen`'s bucket — the offer that triggered
            // this sheet came from that bucket's own thread, so the
            // confirmation belongs there too. Also counts as an answer
            // landing for TTL purposes, same bookkeeping as `ask()`'s own
            // `lastActivityAt` touch.
            setBucket(currentScreen, (prev) => ({
              ...prev,
              messages: capMessages([
                ...prev.messages,
                {
                  id: newMsgId(),
                  role: "assistant" as const,
                  kind: "verdict" as const,
                  headline: `Set up: £${Math.round(item.per_period_slice).toLocaleString("en-GB")} ${item.period_label ? `each pay period (${item.period_label})` : "a period"} reserved.`,
                  degraded: true,
                },
              ]),
              lastActivityAt: Date.now(),
            }));
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
