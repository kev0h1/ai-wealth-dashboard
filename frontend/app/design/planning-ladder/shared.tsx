"use client";

// TEMPORARY PREVIEW — delete after design review.
// Shared pieces across the three planning-ladder variants: the attention
// resolver (the one bit of "business logic" this preview invents) and the
// three presentational blocks that consume it. See PlanningLadderClient.tsx
// for the owner brief this preview answers.
//
// Variant A is the shipped design as of 2026-09-04; B and C are kept for
// reference. CollapsedLadder, SectionJumpStrip and the cliff/attention
// helpers below are re-exported from the live modules they were promoted
// into (frontend/app/planning/GrowPanel.tsx, SectionJumpStrip.tsx and
// frontend/lib/planningAttention.ts) rather than defined here a second
// time, so this preview and the live Planning tab can never drift.

import { ChevronRight } from "lucide-react";
import type { GrowLadderStep, GrowView } from "@wealth/shared";
import type { Commitment, DebtPlanSummary } from "@/lib/api";
import MoneyText from "@/components/MoneyText";
import { CashAndInvestments, CollapsedLadder, maskMoney, money } from "@/app/planning/GrowPanel";
import { findEarliestPromoCliff, isCliffSoon } from "@/lib/planningAttention";

export { CashAndInvestments, CollapsedLadder };
export { default as SectionJumpStrip } from "@/app/planning/SectionJumpStrip";

// ── attention resolver ────────────────────────────────────────────────────

export type AttentionTone = "risk" | "watch";
export type AttentionItem = { key: string; text: string; route: string; tone: AttentionTone };

/** Pure function: given the same facts the live Planning tab already has
 *  (the /grow view, the /debt-plan/summary, the active long-term goals) and
 *  "today", returns an ordered list of "needs you" facts that the current
 *  ladder buries under locked rungs. Order is fixed: the current pay period
 *  (a genuine risk — money's in the wrong place before payday) always leads
 *  when present, then a 0% offer ending soon, then a goal running behind
 *  its pace. `hideValues` routes every £ figure through the same maskMoney
 *  the rest of this preview (and the live tab) uses. No side effects, no
 *  fixture-specific hardcoding beyond the literal facts passed in. Variant
 *  B/C only — variant A (shipped) reads these same facts through the jump
 *  strip's per-section dots instead of one ranked list. */
export function resolveAttention(
  view: GrowView,
  debtSummary: DebtPlanSummary | null,
  goals: Commitment[],
  today: Date,
  hideValues: boolean
): AttentionItem[] {
  const items: AttentionItem[] = [];

  if (view.period_gate.short) {
    items.push({
      key: "period-short",
      text: maskMoney(
        `£${Math.round(view.period_gate.to_cover).toLocaleString("en-GB")} to cover before payday`,
        hideValues
      ),
      route: "/upcoming",
      tone: "risk",
    });
  }

  const earliestCliff = findEarliestPromoCliff(debtSummary, today);
  if (earliestCliff && isCliffSoon(earliestCliff.until, today)) {
    const sameMonth =
      earliestCliff.until.getFullYear() === today.getFullYear() && earliestCliff.until.getMonth() === today.getMonth();
    const when = sameMonth ? "this month" : `in ${earliestCliff.until.toLocaleDateString("en-GB", { month: "long" })}`;
    items.push({
      key: "promo-cliff",
      text: `Your 0% on ${earliestCliff.name} ends ${when}`,
      route: "/cards",
      tone: "watch",
    });
  }

  const behindGoal = goals.find(
    (goal) => goal.feasibility_tone === "caution" || goal.feasibility === "stretch" || goal.on_track === false
  );
  if (behindGoal) {
    items.push({
      key: "goal-pace",
      text: `${behindGoal.name} is running behind its pace`,
      route: "/planning#commitments",
      tone: "watch",
    });
  }

  return items;
}

// ── attention line (hero slot) ───────────────────────────────────────────

/** The `risk` tone in `AttentionTone` is intentionally still part of the
 *  type (resolveAttention genuinely produces it for the short period-gate
 *  fact) — but no variant ever passes a risk-toned item into this
 *  component: the hero's own red branch already IS that fact when the
 *  period is short (see PlanningLadderClient's heroItem selection, which
 *  always picks the first WATCH item). So this renders watch styling only:
 *  a leading amber dot signifies, ink carries the words, never coloured
 *  text, per Figures Are Ink / Amber Lives In The Signifier. Wraps
 *  (text-pretty) rather than truncating — these are short facts, not
 *  space-constrained list rows. */
export function AttentionLine({ item }: { item: AttentionItem }) {
  return (
    <a
      href={item.route}
      className="mt-2 -mx-1 flex min-h-11 items-start gap-1.5 rounded px-1 py-1.5 text-[13px] text-slate-800 active:opacity-70 dark:text-slate-100"
    >
      <span className="mt-[5px] h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500 dark:bg-amber-400" aria-hidden="true" />
      <MoneyText text={item.text} className="min-w-0 flex-1 text-pretty" />
      <ChevronRight size={14} className="mt-[3px] shrink-0 text-slate-400 dark:text-slate-500" aria-hidden="true" />
    </a>
  );
}

// ── needs-you card (variant B) ────────────────────────────────────────────

export function NeedsYouCard({ items }: { items: AttentionItem[] }) {
  if (items.length === 0) return null;
  return (
    <div className="glass-card rounded-2xl p-4">
      <p className="mb-2 text-[11px] font-semibold uppercase tracking-widest text-slate-500 dark:text-slate-400">
        Needs you this month
      </p>
      <div className="divide-y divide-slate-100 dark:divide-white/5">
        {items.slice(0, 3).map((item) => (
          <a key={item.key} href={item.route} className="flex min-h-11 items-start gap-2.5 py-1.5 active:opacity-70">
            <span
              className={`mt-[5px] h-2 w-2 shrink-0 rounded-full ${
                item.tone === "risk" ? "bg-red-500 dark:bg-red-400" : "bg-amber-500 dark:bg-amber-400"
              }`}
              aria-hidden="true"
            />
            <MoneyText
              text={item.text}
              className="min-w-0 flex-1 text-pretty text-[13px] font-medium text-slate-900 dark:text-slate-100"
            />
            <ChevronRight size={15} className="mt-[2px] shrink-0 text-slate-400 dark:text-slate-500" aria-hidden="true" />
          </a>
        ))}
      </div>
    </div>
  );
}

// ── synthetic period rung (variant C only) ────────────────────────────────

/** Variant C keeps rendering the full, unfolded ladder, so it still needs
 *  the synthetic period-gate rung the live tab retired when variant A's
 *  folded ladder shipped (the hero alone now carries that fact live). Kept
 *  here, preview-only, purely so variant C's "full ladder" comparison still
 *  shows the same rung it did during the original round. */
export function buildLadderSteps(view: GrowView): GrowLadderStep[] {
  if (!view.period_gate.short) return view.ladder;
  const periodRung: GrowLadderStep = {
    key: "period_gate",
    title: "This period",
    state: "attention",
    detail: `${money(view.period_gate.to_cover)} sits in the wrong place before payday. Cover it first, then the ladder below carries on.`,
    options: [],
    link: { label: "See what's due ›", route: "/upcoming" },
  };
  return [periodRung, ...view.ladder];
}

// ── buffer tile ───────────────────────────────────────────────────────────

/** Byte-for-byte the live Buffer tile from GrowPanel.tsx, minus the
 *  savings-goal edit wiring this preview has no data for — the pencil
 *  renders (so the tile looks the same) but is inert: no button, no
 *  handler, never focusable. */
export function BufferTile({ view, hideValues }: { view: GrowView; hideValues: boolean }) {
  return (
    <div className="glass-card rounded-2xl p-3.5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-400">Buffer</p>
          <p className="mt-1 font-mono text-sm font-bold tabular-nums text-slate-900 dark:text-slate-50">
            {maskMoney(money(view.buffer.current), hideValues)}{" "}
            <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
              / {maskMoney(money(view.buffer.target), hideValues)}
            </span>
          </p>
          <p className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
            ~{Math.max(0, Math.round(view.buffer.days_covered))} days covered
          </p>
        </div>
        <span
          aria-hidden="true"
          className="-m-2 inline-flex min-h-11 min-w-11 items-center justify-center text-slate-400"
        >
          <PencilGlyph />
        </span>
      </div>
    </div>
  );
}

function PencilGlyph() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round">
      <path d="m18 2 4 4-14 14H4v-4L18 2z" />
    </svg>
  );
}

// ── notes / footer ────────────────────────────────────────────────────────

export function GrowNotes({ notes, hideValues }: { notes: string[]; hideValues: boolean }) {
  if (notes.length === 0) return null;
  return (
    <div className="space-y-1 px-1">
      {notes.map((note, i) => (
        <p key={i} className="text-[11px] italic leading-snug text-slate-500 dark:text-slate-400">
          <MoneyText text={maskMoney(note, hideValues)} />
        </p>
      ))}
    </div>
  );
}
