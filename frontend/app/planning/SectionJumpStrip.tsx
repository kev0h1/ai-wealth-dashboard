"use client";

// ── section jump strip ────────────────────────────────────────────────────
// Three equal chips (Buffer, Debt, Goals) directly under the Planning hero:
// each carries one small figure and jump-scrolls to its own live section
// further down the page, with an amber dot on whichever section has
// something worth a look. Promoted from the planning-ladder design
// preview's variant A (owner-approved 2026-09-04) — instead of naming one
// fact in hero prose, it points at where every section's own truth already
// lives, so nothing folded below the ladder goes unnoticed. Buffer never
// dots (a low day-count is ordinary, not an attention condition on its
// own); Debt and Goals dot via lib/planningAttention.ts's
// debtNeedsLook/goalNeedsLook, so this strip can never disagree with what
// those sections say about themselves.

import type { ReactNode } from "react";
import type { GrowView } from "@wealth/shared";
import type { Commitment, DebtPlanSummary } from "@/lib/api";
import MoneyText from "@/components/MoneyText";
import { maskMoney } from "@/app/planning/GrowPanel";
import { debtNeedsLook, goalNeedsLook } from "@/lib/planningAttention";

type Loadable<T> = T | null | undefined;

/** Whole-pound formatting matching DebtPosition's own total figure
 *  (LongTermPlanningPage.tsx's local `money()`), not GrowPanel's
 *  money()/formatCurrency, which carries pennies. The strip's Debt chip
 *  must read the exact total the Debt section itself shows ("£24,698"),
 *  not a two-decimal figure. Kept in sync by hand, the same pattern
 *  GrowPanel.tsx's own maskMoney comment documents for its
 *  LongTermPlanningPage twin. */
function wholePounds(value: number): string {
  return `£${Math.round(value).toLocaleString("en-GB")}`;
}

function debtTotal(debt: DebtPlanSummary): number {
  return debt.cards.reduce((sum, card) => sum + Math.max(0, card.debt), 0);
}

function scrollToSection(id: string): void {
  const reduced =
    typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  document.getElementById(id)?.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "start" });
}

/** Stands in for a chip's value while its data is still loading — a small
 *  pulse bar, never a fabricated zero or dash. */
function PulseValue() {
  return (
    <span
      className="mt-1 block h-3.5 w-12 animate-pulse rounded bg-slate-200 dark:bg-slate-700"
      aria-hidden="true"
    />
  );
}

function UnavailableValue() {
  return <span className="text-slate-400 dark:text-slate-500">Unavailable</span>;
}

function JumpChip({
  label,
  value,
  dotted,
  ariaLabel,
  onJump,
}: {
  label: string;
  value: ReactNode;
  dotted: boolean;
  ariaLabel?: string;
  onJump: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onJump}
      aria-label={ariaLabel}
      className="glass-card flex min-h-11 flex-col items-start justify-center rounded-xl px-3 py-2 text-left transition-transform active:scale-95"
    >
      <span className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
        {label}
        {dotted && (
          <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500 dark:bg-amber-400" aria-hidden="true" />
        )}
      </span>
      <span className="mt-0.5 text-[13px] font-medium text-slate-900 dark:text-slate-100">{value}</span>
    </button>
  );
}

export default function SectionJumpStrip({
  view,
  debt,
  goals,
  hideValues,
  today,
}: {
  /** `null` when /grow failed to load — Debt and Goals each fetch
   *  independently and can still be worth a look even when Grow itself
   *  couldn't, so the strip survives a failed Grow reading rather than
   *  disappearing with it; only the Buffer chip (the one figure sourced
   *  from /grow) falls back to "Unavailable". */
  view: GrowView | null;
  debt: Loadable<DebtPlanSummary>;
  goals: Loadable<Commitment[]>;
  hideValues: boolean;
  today?: Date;
}) {
  const now = today ?? new Date();

  const bufferValue = view ? `~${Math.max(0, Math.round(view.buffer.days_covered))} days` : <UnavailableValue />;

  const debtDotted = debtNeedsLook(debt, now);
  const debtText = debt ? maskMoney(wholePounds(debtTotal(debt)), hideValues) : null;
  const debtValue =
    debt === undefined ? <PulseValue /> : debt === null ? <UnavailableValue /> : <MoneyText text={debtText!} />;
  // Hide-balances must not leak the masked figure into the aria-label
  // either — "£•••• owed" still names an amount shape. State the fact in
  // words instead: the balance is hidden, not what it roughly is.
  const debtAriaLabel = !debtDotted
    ? undefined
    : hideValues
    ? "Debt, balance hidden, needs a look"
    : `Debt, ${debtText} owed, needs a look`;

  const goalsDotted = goals ? goals.some(goalNeedsLook) : false;
  const goalsCount = goals ? `${goals.length} goal${goals.length === 1 ? "" : "s"}` : null;
  const goalsValue =
    goals === undefined ? (
      <PulseValue />
    ) : goals === null ? (
      <UnavailableValue />
    ) : goals.length === 0 ? (
      "None yet"
    ) : (
      goalsCount
    );
  const goalsAriaLabel = goalsDotted && goalsCount ? `Goals, ${goalsCount}, needs a look` : undefined;

  return (
    <div className="grid grid-cols-3 gap-2">
      <JumpChip label="Buffer" value={bufferValue} dotted={false} onJump={() => scrollToSection("buffer")} />
      <JumpChip
        label="Debt"
        value={debtValue}
        dotted={debtDotted}
        ariaLabel={debtAriaLabel}
        onJump={() => scrollToSection("debt")}
      />
      <JumpChip
        label="Goals"
        value={goalsValue}
        dotted={goalsDotted}
        ariaLabel={goalsAriaLabel}
        onJump={() => scrollToSection("commitments")}
      />
    </div>
  );
}
