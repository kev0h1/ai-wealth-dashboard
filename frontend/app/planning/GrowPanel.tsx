"use client";

// ── GrowPanel — the Planning tab's panel ─────────────────────────────────
// Originally the standalone Grow page (Variant 1, "instrument-panel
// ladder"), folded into Planning 2026-09-04. Embeds inline (no page chrome
// of its own) inside LongTermPlanningPage.tsx: verdict hero, an optional
// `stripSlot` render prop (the section jump strip, its own row right under
// the hero), the priority ladder, the CashAndInvestments card (buffer +
// save-vs-invest split, merged, owner decision 2026-09-04), savings plan
// milestones, then `debtSlot` and `goalsSlot` supplied by the caller
// (LongTermPlanningPage's own DebtPosition and long-term-goals section),
// then quiet notes. The ladder is folded rather than fully expanded (owner review,
// 2026-09-04, variant A of the planning-ladder preview): completed rungs
// collapse into one summary row, locked rungs into another, and only the
// active (and, when present, attention) rung renders in full, via
// CollapsedLadder below. The gauge-cluster visual language (illuminated
// rungs, dark/quiet when locked, glowing when active or cleared) is
// unchanged from the original.
//
// FCA note: only verdict/surplus/buffer/debt/invest/notes fields below are
// personal facts pulled straight from the API. `ladder[].options` is fixed
// generic phrasing from the backend ("some people…") and is rendered as-is —
// never rewritten into an instruction.

import { useCallback, useEffect, useId, useRef, useState } from "react";
import type { ReactNode } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  ChevronRight,
  CircleCheck,
  Gauge,
  Lock,
  Pencil,
  RefreshCw,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import type { GrowLadderStep, GrowView } from "@wealth/shared";
import { api, SavingsInsights, SavingsPlan } from "@/lib/api";
import { formatCurrency } from "@/lib/currency";
import { usePreferences } from "@/components/PreferencesContext";
import MoneyText from "@/components/MoneyText";
import SavingsGoalSheet from "@/components/SavingsGoalSheet";
import SavingsPlanCard from "@/components/SavingsPlanCard";

// ── formatting ───────────────────────────────────────────────────────────

export function money(n: number): string {
  return formatCurrency(n);
}

/** Same regex as LongTermPlanningPage.tsx's own `maskMoney` — kept in sync
 *  by hand since the two files don't share a helper module. Replaces every
 *  £ figure with "£••••" (still recognised and styled by MoneyText, which
 *  matches on the £ prefix rather than needing real digits) when the user
 *  has hide-balances on. */
export function maskMoney(text: string, hidden: boolean): string {
  if (!hidden) return text;
  return text.replace(/[~−+-]?£[\d,]+(?:\.\d+)?[km]?/gi, "£••••");
}

/** Quiet reassurance sub-line for the SHORT hero state (period_gate.short).
 *  Owner decision, 2026-08-30: a short CURRENT pay period must not lead
 *  with "spare to stash" even when the 90-day typical-month median is
 *  positive — this reframes that median per the emotional-jobs doctrine
 *  (reassurance + permission) instead of repeating the framing the owner
 *  rejected. The typical-month figure itself is untouched; only its
 *  billing here changes. */
function periodShortSubline(surplusMonthly: number): string {
  if (surplusMonthly > 0) {
    return `In a typical month you run ~${money(surplusMonthly)} ahead. This is timing, not trend.`;
  }
  if (surplusMonthly < 0) {
    return `Your typical month also runs about ${money(Math.abs(surplusMonthly))} behind, this isn't only timing.`;
  }
  return "Your typical month has been about even, this is timing, not trend.";
}

/** ISO date ("2026-09-30") → readable UK date ("30 Sep 2026"). Uses UTC to
 *  avoid off-by-one drift since the API sends date-only ISO strings. */
export function formatPromoCliff(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

/** Best-effort icon per rung, keyed off free-text title/key from the API.
 *  Renders the element directly (rather than returning a component
 *  reference) so callers never assign a dynamic tag inside render. */
function stepIcon(step: GrowLadderStep, size: number) {
  const k = `${step.key} ${step.title}`.toLowerCase();
  if (k.includes("invest") || k.includes("stocks") || k.includes("isa")) return <Sparkles size={size} strokeWidth={2.25} />;
  if (k.includes("debt") || k.includes("card") || k.includes("loan")) return <Gauge size={size} strokeWidth={2.25} />;
  return <ShieldCheck size={size} strokeWidth={2.25} />;
}

// ── skeleton ─────────────────────────────────────────────────────────────

function SkeletonGauge() {
  return (
    <div className="space-y-3 animate-pulse" aria-hidden>
      <div className="glass-hero rounded-3xl p-5 space-y-3">
        <div className="h-3 w-24 bg-slate-200 dark:bg-slate-700 rounded" />
        <div className="h-7 w-52 bg-slate-200 dark:bg-slate-700 rounded" />
        <div className="h-3 w-40 bg-slate-100 dark:bg-slate-700/60 rounded" />
      </div>
      {/* Strip-shaped placeholder — same three-column footprint as
          SectionJumpStrip's own chips, so the page doesn't jump when /grow
          resolves and the real strip mounts in this exact spot. */}
      <div className="grid grid-cols-3 gap-2">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-[52px] rounded-xl bg-slate-200 dark:bg-slate-700" />
        ))}
      </div>
      <div className="glass-card rounded-2xl p-4 space-y-4">
        {[0, 1, 2].map(i => (
          <div key={i} className="flex gap-3">
            <div className="h-8 w-8 rounded-lg bg-slate-200 dark:bg-slate-700 shrink-0" />
            <div className="flex-1 space-y-2 pt-1">
              <div className="h-3 w-28 bg-slate-200 dark:bg-slate-700 rounded" />
              <div className="h-2.5 w-full bg-slate-100 dark:bg-slate-700/60 rounded" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── LED rung indicator ──────────────────────────────────────────────────

function RungNode({ step }: { step: GrowLadderStep }) {
  if (step.state === "attention") {
    // Same solid-icon-chip construction as "done" (box-shadow alpha values
    // unchanged), recoloured to Risk Red — the one red signifier this rung
    // carries, matching the hero's short-state AlertTriangle/red-500
    // treatment. Nothing else on this rung (card wash, pill, border) repeats
    // red at this saturation, per Figures Are Ink / one-signifier-per-rung.
    return (
      <div
        className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-red-500 text-white"
        style={{ boxShadow: "0 0 0 3px rgba(239,68,68,0.16), 0 2px 6px rgba(239,68,68,0.35)" }}
      >
        <AlertTriangle size={16} strokeWidth={2.25} />
      </div>
    );
  }
  if (step.state === "done") {
    return (
      <div
        className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-emerald-500 text-white"
        style={{ boxShadow: "0 0 0 3px rgba(16,185,129,0.16), 0 2px 6px rgba(16,185,129,0.35)" }}
      >
        <CircleCheck size={17} strokeWidth={2.25} />
      </div>
    );
  }
  if (step.state === "active") {
    return (
      <div
        className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-indigo-600 text-white motion-safe:animate-pulse"
        style={{ boxShadow: "0 0 0 4px rgba(79,70,229,0.18), 0 3px 10px rgba(79,70,229,0.45)" }}
      >
        {stepIcon(step, 16)}
      </div>
    );
  }
  return (
    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50 text-slate-400 dark:text-slate-500">
      <Lock size={14} strokeWidth={2} />
    </div>
  );
}

/** A dense little "segment strip" — the gauge-cluster flourish next to each
 *  rung title. Purely a state indicator (lit vs unlit), never a fabricated
 *  progress fraction — we don't have per-rung completion data from the API. */
function SegmentStrip({ state }: { state: GrowLadderStep["state"] }) {
  const lit = state !== "locked";
  const pulsing = state === "active";
  const colour =
    state === "done" ? "bg-emerald-400" : state === "active" ? "bg-indigo-500" : "bg-slate-200 dark:bg-slate-700";
  return (
    <div className="flex items-center gap-[3px]" aria-hidden>
      {[0, 1, 2, 3, 4].map(i => (
        <span
          key={i}
          className={`h-2.5 w-1 rounded-full ${lit ? colour : "bg-slate-150 dark:bg-slate-700/60"} ${
            pulsing ? "motion-safe:animate-pulse" : ""
          }`}
          style={pulsing ? { animationDelay: `${i * 90}ms` } : undefined}
        />
      ))}
    </div>
  );
}

function StatePill({ state }: { state: GrowLadderStep["state"] }) {
  const label =
    state === "done" ? "Cleared" : state === "active" ? "In progress" : state === "attention" ? "Needs you" : "Locked";
  const cls =
    state === "done"
      ? "text-emerald-700 dark:text-emerald-300 bg-emerald-500/10"
      : state === "active"
      ? "text-indigo-700 dark:text-indigo-300 bg-indigo-500/10"
      : state === "attention"
      ? "text-red-700 dark:text-red-300 bg-red-500/10"
      : "text-slate-500 dark:text-slate-400 bg-slate-500/10";
  return (
    <span className={`text-[10px] font-semibold uppercase tracking-widest rounded-full px-2 py-0.5 ${cls}`}>
      {label}
    </span>
  );
}

// ── ladder rung row ──────────────────────────────────────────────────────

export function LadderRung({ step, isLast, hideValues }: { step: GrowLadderStep; isLast: boolean; hideValues: boolean }) {
  const router = useRouter();
  const quiet = step.state === "locked";
  return (
    <div className="relative flex gap-3">
      {/* rail */}
      <div className="flex flex-col items-center">
        <RungNode step={step} />
        {!isLast && (
          <div
            className={`w-px flex-1 min-h-[18px] mt-1 ${
              step.state === "done" ? "bg-emerald-300/70 dark:bg-emerald-700/50" : "bg-slate-200 dark:bg-slate-700"
            }`}
          />
        )}
      </div>

      {/* content */}
      <div className={`flex-1 pb-6 ${isLast ? "pb-0" : ""}`}>
        <div
          className={`rounded-2xl p-3 ${
            step.state === "active"
              ? "bg-indigo-50/70 dark:bg-indigo-500/10 border border-indigo-100 dark:border-indigo-500/20"
              : step.state === "attention"
              ? "bg-red-50/70 dark:bg-red-500/10 border border-red-100 dark:border-red-500/20"
              : "border border-transparent"
          }`}
        >
          <div className="flex items-center justify-between gap-2">
            <h3
              className={`text-sm font-bold ${
                quiet ? "text-slate-400 dark:text-slate-500" : "text-slate-900 dark:text-slate-50"
              }`}
            >
              {step.title}
            </h3>
            <StatePill state={step.state} />
          </div>

          <div className="mt-1.5 flex items-center gap-2">
            <SegmentStrip state={step.state} />
            <p className={`text-xs ${quiet ? "text-slate-400 dark:text-slate-600" : "text-slate-600 dark:text-slate-300"}`}>
              <MoneyText text={maskMoney(step.detail, hideValues)} />
            </p>
          </div>

          {/* Quiet in-app link — "›" suffix comes from the backend label */}
          {step.link && (
            <button
              type="button"
              onClick={() => router.push(step.link!.route)}
              className="min-h-[44px] flex items-center text-xs font-semibold text-indigo-600 dark:text-indigo-400 active:opacity-70 transition-opacity focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 rounded"
            >
              {step.link.label}
            </button>
          )}

          {/* Generic options — under the active rung only, per FCA guardrail:
              fixed neutral phrasing from the backend, never "you should". */}
          {step.state === "active" && step.options.length > 0 && (
            <ul className="mt-2.5 space-y-1 border-t border-indigo-100 dark:border-indigo-500/20 pt-2.5">
              {step.options.map((opt: string, i: number) => (
                <li key={i} className="text-xs text-slate-500 dark:text-slate-400 leading-snug flex gap-1.5">
                  <span className="text-indigo-400 dark:text-indigo-500 leading-snug">·</span>
                  <span>{opt}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

// ── folded ladder ─────────────────────────────────────────────────────────
// Promoted from the planning-ladder design preview's variant A (owner
// review, 2026-09-04): the ladder is mostly locked rungs once buffer/debt
// are underway, and rendering all seven in full pushed the live sections
// below it off the first screen. Only the attention rung (period gate, when
// present) and the single active rung render in full; a completed run of
// rungs folds into one "N done · names" row and a locked run folds into one
// "N more after this · names" row, each independently expandable in place.
// The hero is the only place the current pay period's shortfall is spoken,
// so this ladder carries no synthetic period rung of its own any more.

/** Same first-two-then-count summarising rule for both the "done" fold and
 *  the "locked" fold: full names when there are 3 or fewer, otherwise the
 *  first two plus "and N more". */
function summariseNames(names: string[]): string {
  if (names.length <= 3) return names.join(", ");
  return `${names[0]}, ${names[1]} and ${names.length - 2} more`;
}

function FoldRailNode({ kind }: { kind: "done" | "locked" }) {
  if (kind === "done") {
    return (
      <div
        className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-emerald-500 text-white"
        style={{ boxShadow: "0 0 0 3px rgba(16,185,129,0.16), 0 2px 6px rgba(16,185,129,0.35)" }}
      >
        <CircleCheck size={17} strokeWidth={2.25} />
      </div>
    );
  }
  return (
    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-slate-200 bg-slate-50 text-slate-400 dark:border-slate-700 dark:bg-slate-800/50 dark:text-slate-500">
      <Lock size={14} strokeWidth={2} />
    </div>
  );
}

/** The toggle row itself — same rail/node/line construction as LadderRung
 *  (a top-level "flex gap-3" row: rail column, then content column), so it
 *  is a plain sibling of the real LadderRungs around it, not a wrapper
 *  around them. `isLast` is a structural fact (is anything rendered after
 *  this group, open or not), independent of `open` — the rail must read as
 *  one continuous line whether the fold is open or closed. */
function FoldToggleRow({
  kind,
  open,
  onToggle,
  summary,
  isLast,
  regionId,
}: {
  kind: "done" | "locked";
  open: boolean;
  onToggle: () => void;
  summary: string;
  isLast: boolean;
  regionId: string;
}) {
  return (
    <div className="relative flex gap-3">
      <div className="flex flex-col items-center">
        <FoldRailNode kind={kind} />
        {!isLast && (
          <div
            className={`mt-1 min-h-[18px] w-px flex-1 ${
              kind === "done" ? "bg-emerald-300/70 dark:bg-emerald-700/50" : "bg-slate-200 dark:bg-slate-700"
            }`}
          />
        )}
      </div>
      {/* min-w-0 is load-bearing: without it this flex-1 column refuses to
          shrink below the summary text's natural width (flex items default
          to min-width:auto), which pushes the row wider than the card and
          defeats the inner span's `truncate` entirely. pb-0 when `isLast`,
          same as LadderRung — otherwise the toggle row leaves a trailing
          gap below whatever renders after it. */}
      <div className={`min-w-0 flex-1 pb-6 ${isLast ? "pb-0" : ""}`}>
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          aria-controls={regionId}
          className="flex min-h-11 w-full items-center gap-2 rounded-2xl px-3 py-2 text-left text-xs font-semibold text-slate-500 transition-colors hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:text-slate-400 dark:hover:bg-white/[0.03]"
        >
          <span className="min-w-0 flex-1 truncate">{summary}</span>
          <ChevronRight
            size={14}
            className={`shrink-0 transition-transform duration-200 ${open ? "rotate-90" : ""}`}
            aria-hidden="true"
          />
        </button>
      </div>
    </div>
  );
}

/** The revealed rungs, as a plain sibling of FoldToggleRow — NOT nested
 *  inside its content column, so each LadderRung's own rail node lands at
 *  the same left offset as the toggle row's node, and the whole thing reads
 *  as one rail rather than a second, indented one. grid-template-rows
 *  1fr/0fr collapse convention, `inert` when collapsed — matches
 *  SpendVerdictView.tsx's resolve animation; the global
 *  prefers-reduced-motion rule in globals.css zeroes transition-duration
 *  everywhere, so this needs no motion-reduce variant of its own. */
function CollapsibleRungs({
  id,
  open,
  steps,
  hideValues,
}: {
  id: string;
  open: boolean;
  steps: GrowLadderStep[];
  hideValues: boolean;
}) {
  return (
    <div
      id={id}
      className={`grid transition-[grid-template-rows,opacity] duration-200 ease-[var(--ease-out)] ${
        open ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"
      }`}
      inert={!open}
    >
      <div className="overflow-hidden">
        {steps.map((step, i) => (
          <LadderRung key={step.key} step={step} isLast={i === steps.length - 1} hideValues={hideValues} />
        ))}
      </div>
    </div>
  );
}

/** Same card chrome as the old full-length "Priority ladder" card
 *  (glass-card rounded-2xl p-4). Order is fixed to match the ladder's own
 *  priority order: the attention rung (period gate, when the current pay
 *  period is short) leads, above even the done fold, then done rungs fold
 *  into one row, then the active rung, then locked rungs fold into a final
 *  row. */
export function CollapsedLadder({ steps, hideValues }: { steps: GrowLadderStep[]; hideValues: boolean }) {
  const [doneOpen, setDoneOpen] = useState(false);
  const [lockedOpen, setLockedOpen] = useState(false);
  const doneRegionId = useId();
  const lockedRegionId = useId();

  const attentionSteps = steps.filter((step) => step.state === "attention");
  const doneSteps = steps.filter((step) => step.state === "done");
  const activeSteps = steps.filter((step) => step.state === "active");
  const lockedSteps = steps.filter((step) => step.state === "locked");

  const hasDone = doneSteps.length > 0;
  const hasActive = activeSteps.length > 0;
  const hasLocked = lockedSteps.length > 0;

  return (
    <div className="glass-card rounded-2xl p-4" data-tutorial-id="tutorial-planning-ladder">
      <p className="mb-4 text-[11px] font-semibold uppercase tracking-widest text-slate-500 dark:text-slate-400">
        Priority ladder
      </p>
      <div>
        {attentionSteps.map((step, i) => (
          <LadderRung
            key={step.key}
            step={step}
            isLast={i === attentionSteps.length - 1 && !hasDone && !hasActive && !hasLocked}
            hideValues={hideValues}
          />
        ))}

        {hasDone && (
          <>
            <FoldToggleRow
              kind="done"
              open={doneOpen}
              onToggle={() => setDoneOpen((open) => !open)}
              summary={`${doneSteps.length} done · ${summariseNames(doneSteps.map((step) => step.title))}`}
              isLast={!doneOpen && !hasActive && !hasLocked}
              regionId={doneRegionId}
            />
            <CollapsibleRungs id={doneRegionId} open={doneOpen} steps={doneSteps} hideValues={hideValues} />
          </>
        )}

        {activeSteps.map((step, i) => (
          <LadderRung
            key={step.key}
            step={step}
            isLast={i === activeSteps.length - 1 && !hasLocked}
            hideValues={hideValues}
          />
        ))}

        {hasLocked && (
          <>
            <FoldToggleRow
              kind="locked"
              open={lockedOpen}
              onToggle={() => setLockedOpen((open) => !open)}
              summary={`${lockedSteps.length} more after this · ${summariseNames(lockedSteps.map((step) => step.title))}`}
              isLast={!lockedOpen}
              regionId={lockedRegionId}
            />
            <CollapsibleRungs id={lockedRegionId} open={lockedOpen} steps={lockedSteps} hideValues={hideValues} />
          </>
        )}
      </div>
    </div>
  );
}

// ── hero verdict — the gauge cluster's headline reading ──────────────────

/** Extracted so design previews (see frontend/app/design/planning-ladder)
 *  can render the exact live hero markup with one addition: an optional
 *  `attention` slot rendered directly under the sub line (under the surplus
 *  chip in the normal branch, under the "to cover" subline in the short
 *  branch). `attention` is undefined in live code, so live output is
 *  byte-identical to before this extraction. */
export function GrowHero({
  view,
  hideValues,
  onSeeDue,
  attention,
}: {
  view: GrowView;
  hideValues: boolean;
  onSeeDue: () => void;
  attention?: ReactNode;
}) {
  return (
    <div className="glass-hero rounded-3xl p-5 relative overflow-hidden">
      {/* quiet dashboard-panel backdrop: faint horizontal scan lines */}
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.05] dark:opacity-[0.08]"
        style={{
          backgroundImage:
            "repeating-linear-gradient(180deg, currentColor 0px, currentColor 1px, transparent 1px, transparent 5px)",
        }}
        aria-hidden
      />
      <div className="relative">
        {view.period_gate?.short ? (
          // ── SHORT: the current pay period needs covering first —
          // owner decision, 2026-08-30. Leads with the period truth
          // (same red-alarm severity Home's Safe-to-Spend hero gives
          // this exact fact — SafeToSpendCard.tsx's AlertTriangle/
          // red-500 short-state treatment, borrowed unchanged), the
          // typical-month median demotes to a quiet reassurance line
          // and the SPARE stat chip does not render as the lead.
          <>
            <div className="flex items-center gap-1.5 mb-2">
              <AlertTriangle size={13} className="text-red-500 dark:text-red-400" />
              <p className="text-[11px] font-semibold uppercase tracking-widest text-slate-500 dark:text-slate-400">
                Planning
              </p>
            </div>
            <h1 className="text-[28px] leading-tight font-bold tracking-tight text-slate-900 dark:text-slate-50">
              This period needs you first
            </h1>
            <p className="mt-1.5 text-base font-semibold text-red-500 dark:text-red-400">
              <MoneyText text={maskMoney(`${money(view.period_gate.to_cover)} to cover before payday`, hideValues)} />
            </p>
            {attention}
            <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
              <MoneyText text={maskMoney(periodShortSubline(view.surplus_monthly), hideValues)} />
            </p>
            <button
              onClick={onSeeDue}
              className="mt-4 inline-flex items-center gap-1 text-sm font-medium text-indigo-600 dark:text-indigo-400 hover:opacity-80 active:scale-[0.98] transition-[transform,opacity] duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 rounded"
            >
              See what&apos;s due ›
            </button>
          </>
        ) : (
          <>
            <div className="flex items-center gap-1.5 mb-2">
              <Gauge size={13} className="text-indigo-500" />
              <p className="text-[11px] font-semibold uppercase tracking-widest text-slate-500 dark:text-slate-400">
                Planning
              </p>
            </div>
            <h1 className="text-[28px] leading-tight font-bold tracking-tight text-slate-900 dark:text-slate-50">
              <MoneyText text={maskMoney(view.verdict.headline, hideValues)} />
            </h1>
            <p className="mt-1.5 text-sm text-slate-600 dark:text-slate-300"><MoneyText text={maskMoney(view.verdict.sub, hideValues)} /></p>
            {view.debt.all_promo && view.debt.promo_cliff && (
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                Your card&apos;s at 0% until {formatPromoCliff(view.debt.promo_cliff)}, the after-debt figure reflects those repayments.
              </p>
            )}

            <div className="mt-4 glass-tile rounded-xl px-3.5 py-2.5 inline-flex items-baseline gap-2">
              <span className="text-[10px] font-semibold uppercase tracking-widest text-slate-500 dark:text-slate-400">
                {view.surplus_monthly < 0 ? "Short each month" : "Spare each month"}
              </span>
              <span className="text-base font-bold text-slate-900 dark:text-slate-50 font-mono tabular-nums">
                {maskMoney(money(Math.abs(view.surplus_monthly)), hideValues)}
              </span>
            </div>
            {attention}
            {/* Honest-lens label — this is a smoothed median, not a
                live period figure; makes that explicit rather than
                letting it read as "your current situation". */}
            <p className="mt-2 text-[10px] text-slate-400 dark:text-slate-500">
              Based on your typical month, smoothed over 90 days.
            </p>
            <p className="mt-1 text-[10px] text-slate-400 dark:text-slate-500">
              Excludes money moved to savings or investments.
            </p>
          </>
        )}
      </div>
    </div>
  );
}

// ── save vs invest split (cash held vs capital at risk) ─────────────────

export function SplitGauge({ view, hideValues }: { view: GrowView; hideValues: boolean }) {
  const cash = Math.max(0, view.buffer.current);
  const atRisk = Math.max(0, view.invest.portfolio_value);
  const total = cash + atRisk;
  const cashPct = total > 0 ? (cash / total) * 100 : 100;
  const riskPct = 100 - cashPct;

  return (
    <div className="glass-card rounded-2xl p-4">
      <p className="text-[11px] font-semibold uppercase tracking-widest text-slate-500 dark:text-slate-400 mb-3">
        Where it&apos;s sitting
      </p>

      <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
        {cashPct > 0 && <div className="h-full bg-emerald-500" style={{ width: `${cashPct}%` }} />}
        {riskPct > 0 && <div className="h-full bg-sky-400" style={{ width: `${riskPct}%` }} />}
      </div>

      <div className="mt-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="h-2 w-2 rounded-full bg-emerald-500" />
          <div>
            <p className="text-xs font-semibold text-slate-800 dark:text-slate-100 font-mono tabular-nums">{maskMoney(money(cash), hideValues)}</p>
            <p className="text-[10px] uppercase tracking-widest text-slate-400">Cash, safe</p>
          </div>
        </div>
        <div className="flex items-center gap-2 text-right">
          <div>
            <p className="text-xs font-semibold text-slate-800 dark:text-slate-100 font-mono tabular-nums">{maskMoney(money(atRisk), hideValues)}</p>
            <p className="text-[10px] uppercase tracking-widest text-slate-400">Invested, at risk</p>
          </div>
          <span className="h-2 w-2 rounded-full bg-sky-400" />
        </div>
      </div>
      {!view.invest.has_investments && (
        <p className="mt-2 text-[11px] text-slate-500 dark:text-slate-400 italic">
          Nothing invested yet, this fills in once the ladder reaches that rung.
        </p>
      )}
    </div>
  );
}

// ── cash and investments (buffer + save-vs-invest split, merged) ─────────
// Owner decision, 2026-09-04: the split gauge used to render at the very
// end of the panel, after goals, which felt misplaced even though investors
// still want the figure. Merged with the Buffer tile into one card that
// renders directly after the ladder, so Planning states its position
// figures (cash safe, invested at risk) in exactly one place. Replaces both
// the old `<section id="buffer">` Buffer tile and the trailing `<SplitGauge>`
// render at the foot of the panel. SplitGauge itself stays exported below,
// live no longer renders it, only the planning-ladder preview's variants B
// and C still do.
export function CashAndInvestments({
  view,
  hideValues,
  onEdit,
}: {
  view: GrowView;
  hideValues: boolean;
  onEdit?: () => void;
}) {
  const cash = Math.max(0, view.buffer.current);
  const atRisk = Math.max(0, view.invest.portfolio_value);
  const total = cash + atRisk;
  const cashPct = total > 0 ? (cash / total) * 100 : 100;
  const riskPct = 100 - cashPct;

  return (
    <section id="buffer" className="scroll-mt-4" aria-label="Cash and investments">
      <div className="glass-card rounded-2xl p-4">
        <div className="flex items-center justify-between gap-3">
          <p className="text-[11px] font-semibold uppercase tracking-widest text-slate-500 dark:text-slate-400">
            Cash and investments
          </p>
          {onEdit && (
            <button
              onClick={onEdit}
              aria-label="Edit safety net goal"
              className="inline-flex min-h-11 min-w-11 items-center justify-center -m-2 text-slate-400 hover:text-emerald-600 dark:hover:text-emerald-400 transition-colors"
            >
              <Pencil size={12} strokeWidth={2.25} />
            </button>
          )}
        </div>

        <div className="mt-3 flex h-2.5 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
          {cashPct > 0 && <div className="h-full bg-emerald-500" style={{ width: `${cashPct}%` }} />}
          {riskPct > 0 && <div className="h-full bg-sky-400" style={{ width: `${riskPct}%` }} />}
        </div>

        <div className="mt-3 grid grid-cols-2 gap-3">
          <div>
            <div className="flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-emerald-500" aria-hidden="true" />
              <p className="text-[10px] uppercase tracking-widest text-slate-400">Cash, safe</p>
            </div>
            <p className="mt-1 text-sm font-bold text-slate-900 dark:text-slate-50 font-mono tabular-nums">
              {maskMoney(money(cash), hideValues)}
            </p>
            <p className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
              <MoneyText
                text={maskMoney(
                  `of ${money(view.buffer.target)} target · ~${Math.max(0, Math.round(view.buffer.days_covered))} days covered`,
                  hideValues
                )}
              />
            </p>
          </div>
          <div className="text-right">
            <div className="flex items-center justify-end gap-2">
              <p className="text-[10px] uppercase tracking-widest text-slate-400">Invested, at risk</p>
              <span className="h-2 w-2 rounded-full bg-sky-400" aria-hidden="true" />
            </div>
            <p className="mt-1 text-sm font-bold text-slate-900 dark:text-slate-50 font-mono tabular-nums">
              {maskMoney(money(atRisk), hideValues)}
            </p>
            {!view.invest.has_investments && (
              <p className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400 italic">
                Nothing invested yet, this fills in once the ladder reaches that rung.
              </p>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

// ── main component ───────────────────────────────────────────────────────

type GrowPanelProps = {
  onLoaded?: (ok: boolean) => void;
  debtSlot: React.ReactNode;
  goalsSlot: React.ReactNode;
  /** The section jump strip (Buffer/Debt/Goals), rendered directly under
   *  the hero (or, on a failed /grow reading, under the error card) as its
   *  own row. A render-prop rather than a plain node because it needs the
   *  loaded `view` itself (the Buffer chip's day count) — the caller
   *  (LongTermPlanningPage) supplies the rest (debt, goals, hideValues).
   *  `view` is `null` when /grow failed: Debt and Goals still have their
   *  own independent fetches and can still be worth a look even when Grow
   *  itself couldn't load, so the strip survives a failed Grow reading
   *  rather than disappearing with it. */
  stripSlot?: (view: GrowView | null) => ReactNode;
};

export default function GrowPanel({ onLoaded, debtSlot, goalsSlot, stripSlot }: GrowPanelProps) {
  const router = useRouter();
  const { region, hideNetWorth } = usePreferences();
  const sym = region === "Kenya" ? "KES " : "£";
  const [view, setView] = useState<GrowView | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  // Safety-net goal editor state — fetched alongside the grow view, in
  // parallel, tolerating failure (the Edit affordance simply stays hidden).
  const [savings, setSavings] = useState<SavingsInsights | null>(null);
  const [savingsPlan, setSavingsPlan] = useState<SavingsPlan | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);

  // `onLoaded` is held in a ref rather than a `load` dependency: the caller
  // (LongTermPlanningPage) is expected to pass a stable callback, but even
  // if it doesn't, this keeps `load`'s identity (and therefore the mount
  // effect below) from changing on every parent render — an unstable
  // `onLoaded` used to cause a refetch + skeleton reset on every render.
  const onLoadedRef = useRef(onLoaded);
  useEffect(() => {
    onLoadedRef.current = onLoaded;
  }, [onLoaded]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const data = await api.getGrow();
      setView(data);
      onLoadedRef.current?.(true);
    } catch {
      setError(true);
      onLoadedRef.current?.(false);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadSavings = useCallback(async () => {
    try {
      const [s, p] = await Promise.all([api.savingsInsights(), api.getSavingsPlan()]);
      setSavings(s);
      setSavingsPlan(p.plan);
    } catch {
      setSavings(null);
      setSavingsPlan(null);
    }
  }, []);

  useEffect(() => {
    // Deferred a microtask: `load`/`loadSavings` each reset state
    // synchronously (setLoading/setError/setSavings) before their first
    // `await`, which react-hooks/set-state-in-effect flags if called
    // directly here. queueMicrotask moves the call out of the effect's own
    // synchronous execution without changing behaviour (still runs before
    // the next paint) — the state resets then happen inside a callback,
    // the pattern the rule itself recommends.
    queueMicrotask(() => {
      load();
      loadSavings();
    });
  }, [load, loadSavings]);

  async function toggleSavingsStep(id: string, done: boolean) {
    try {
      const { plan } = await api.toggleSavingsPlanStep(id, done);
      setSavingsPlan(plan);
    } catch {}
  }

  async function deleteSavingsStep(id: string) {
    try {
      const { plan } = await api.deleteSavingsPlanStep(id);
      setSavingsPlan(plan);
    } catch {}
  }

  async function deleteSavingsPlanFn() {
    try {
      await api.deleteSavingsPlan();
      setSavingsPlan(null);
    } catch {}
  }

  const hasLadder = !!view && view.ladder.length > 0;

  return (
    <>
        {loading ? (
          <SkeletonGauge />
        ) : error || !view ? (
          <div className="space-y-4">
            <div className="glass-card rounded-2xl p-5 space-y-3">
              <p className="text-sm text-slate-700 dark:text-slate-200">
                Your plan couldn&apos;t load. It needs a live reading to order the next steps.
              </p>
              <button
                onClick={load}
                className="inline-flex items-center gap-1.5 rounded-xl bg-indigo-600 text-white text-sm font-semibold px-4 py-2 active:scale-95 transition-transform"
              >
                <RefreshCw size={14} />
                Try again
              </button>
            </div>
            {stripSlot?.(null)}
          </div>
        ) : (
          <div className="space-y-4">
            {/* ── Hero verdict — the gauge cluster's headline reading ── */}
            <GrowHero view={view} hideValues={hideNetWorth} onSeeDue={() => router.push("/upcoming")} />

            {/* ── Section jump strip — Buffer/Debt/Goals, one row, right
                under the hero ── */}
            {stripSlot?.(view)}

            {/* ── The ladder — hero instrument, folded to what's live ── */}
            {hasLadder && <CollapsedLadder steps={view.ladder} hideValues={hideNetWorth} />}

            {!hasLadder && (
              <div className="glass-card rounded-2xl p-5">
                <p className="text-sm text-slate-600 dark:text-slate-300">
                  No order to show yet. Connect an account so Planning has a live reading to work from.
                </p>
              </div>
            )}

            {/* ── Cash and investments — buffer + save-vs-invest split, merged
                (owner decision, 2026-09-04): one card, directly after the
                ladder, states cash-safe and invested-at-risk together
                rather than splitting them across the top and foot of the
                panel ── */}
            <CashAndInvestments
              view={view}
              hideValues={hideNetWorth}
              onEdit={savings ? () => setSheetOpen(true) : undefined}
            />

            {/* ── Savings plan milestones — sits below the merged card once a plan exists ── */}
            {savings?.configured && savingsPlan && (
              <SavingsPlanCard
                plan={savingsPlan}
                sym={sym}
                accent="#059669"
                hideValues={hideNetWorth}
                onToggleStep={toggleSavingsStep}
                onDeleteStep={deleteSavingsStep}
                onDelete={deleteSavingsPlanFn}
              />
            )}
          </div>
        )}

        {/* ── Debt and goals — supplied by LongTermPlanningPage, rendered
            unconditionally: neither is a "Grow" fact, so a failed/loading
            /grow fetch above must never take them down with it. ── */}
        {debtSlot}

        {goalsSlot}

        {/* ── Quiet footnotes — /grow facts, so gated on a loaded view. The
            save-vs-invest split used to render here too; it now lives in
            CashAndInvestments, directly after the ladder (see above). ── */}
        {!loading && !error && view && (
          <div className="space-y-4">
            {view.notes.length > 0 && (
              <div className="space-y-1 px-1">
                {view.notes.map((n, i) => (
                  <p key={i} className="text-[11px] text-slate-500 dark:text-slate-400 italic leading-snug">
                    <MoneyText text={maskMoney(n, hideNetWorth)} />
                  </p>
                ))}
              </div>
            )}
          </div>
        )}

    {sheetOpen && (
      <SavingsGoalSheet
        data={savings}
        sym={sym}
        hideValues={hideNetWorth}
        onClose={() => setSheetOpen(false)}
        onSaved={() => { load(); loadSavings(); }}
      />
    )}
    </>
  );
}
