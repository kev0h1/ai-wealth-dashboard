"use client";

// The Spend hub's TOP region — everything above SpendVerdictView's reading.
//
// "Verdict Header" — one glass-hero card holding a whisper period row (tap
// to open the period sheet), a weighted Out / In / Moved instrument, and the
// reading as a caption underneath. This is the ONE header: production
// (SpendPage.tsx) and the /design/spend-live preview both trace back to
// this component's approved content — verdict.pills / verdict.period /
// verdict.reading / verdict.moved_total are all server-computed (Show Your
// Working Rule, ENGINE.md) — so preview and production can never draw
// different numbers again (the bug that shipped: the real page computed its
// own client-side "spent" including Savings/Investment/Debt-kind
// categories, while the preview route hand-copied a header that happened to
// read the correct verdict.pills figure — nobody noticed the two disagreed
// because nothing forced them to share code).
// Earlier "current" and "a" top variants were retired once the owner picked
// the three-cell instrument (2026-08, "lit panel"/spend-inst-b); that in
// turn was retired for THIS weighted re-ranking once the owner picked
// variant B ("weighted instrument") of the notable-cards/header review
// (2026-08-27) — Out leads as the hero figure since Spend is about
// spending, In and Moved are a secondary tier below it, and the pace strip
// is cut entirely (it read as a sparkline nobody could act on; the
// category rows and the reading already carry the same "running ahead of
// usual" fact in words). See DESIGN.md's "The Instrument Header (Spend)".
//
// This component never derives a money figure from raw transactions.

import { useState } from "react";
import Link from "next/link";
import { ChevronLeft, ChevronRight, Settings2, Search, Info, X } from "lucide-react";
import { useLockBodyScroll } from "@/lib/useLockBodyScroll";
import { useSheetA11y } from "@/lib/useSheetA11y";
import TransactionRow from "@/components/TransactionRow";
import MoneyText from "@/components/MoneyText";
import type { SpendVerdict, Transaction } from "@/lib/api";

// Tiny negative floats (rounding noise) must never render as a phantom
// minus — same <£1 zero-safe convention as SafeToSpendCard.tsx's
// `zeroSafe`/CanISection.tsx's `fmtWhole` (copied locally: one-line pure
// helper, no other dependency on those files).
const zeroSafe = (v: number) => (Math.abs(v) < 1 ? 0 : v);

// Proper minus sign (−, U+2212) BEFORE the £, not a raw "-" after it —
// Math.round(-150).toLocaleString() on its own renders "£-150" (the
// double-sign bug: a negative Out/In/Moved figure must read "−£150", the
// house currency-minus style used throughout the app, e.g. CanISection.tsx's
// fmtWhole, AccountsPage.tsx's card-total row).
const fmt = (n: number) => {
  const v = zeroSafe(n);
  const sign = v < 0 ? "−" : "";
  return `${sign}£${Math.abs(Math.round(v)).toLocaleString("en-GB")}`;
};

export interface RecentPeriodOption {
  offset: number;
  label: string;
}

export interface SpendHeaderProps {
  verdict: SpendVerdict | null;
  /** Pre-formatted "31 Jul → 27 Aug" — callers already own period-label logic. */
  periodLabel: string;
  isCurrentPeriod: boolean;
  canGoPrev: boolean;
  onPrev: () => void;
  onNext: () => void;
  /** Swipe-the-hero-card-to-change-period touch handlers (usePeriodSwipe). */
  swipeHandlers?: { onTouchStart: (e: React.TouchEvent) => void; onTouchEnd: (e: React.TouchEvent) => void };
  onOpenSettings: () => void;
  onOpenRules: () => void;
  /** Income transactions for the "In" drill-down — same list production
   *  already builds from live transactions; the preview passes a small
   *  fixture list so the interaction is demonstrable without a login. */
  incomeTxns: Transaction[];
  /** Requests transaction history only when the income disclosure is opened. */
  onIncomeOpen?: () => void;
  onTransactionClick: (tx: Transaction) => void;
  /** "Out" is the Show Your Working entry point for the spend figure — see
   *  SpendVerdictView's expandMajoritySignal/#spend-majority-section. Forces
   *  the majority list open and scrolls to it: the exact reconciled
   *  transactions (notables + majority + unresolved = pills.spent) behind
   *  the figure, reusing the frozen body's own evidence rather than building
   *  a second one. */
  onOutTap?: () => void;
  /** Third instrument cell — "Moved" (verdict.moved_total). Optional
   *  scroll-to-evidence hook, same Show Your Working idea as onOutTap but
   *  pointing at the body's "Money you moved" block instead. The cell (and
   *  this handler) only render when verdict.moved_total is present; older
   *  payloads without it fall back to a two-cell Out | In row. */
  onMovedTap?: () => void;
  /** Show Your Working entry point for the OUT-pill footnote ("Includes
   *  £X not yet placed ›", only rendered when `verdict.unresolved_material`
   *  is true) — scrolls to the unresolved ask/whisper block in the body
   *  (SpendVerdictView's id="spend-unresolved"). */
  onUnresolvedTap?: () => void;
  /** Recent periods to jump to, and past periods to view — the period
   *  sheet's in-sheet row list (native pickers never appear, DESIGN.md). */
  recentPeriods?: RecentPeriodOption[];
  onSelectOffset?: (offset: number) => void;
  /** UNUSED by this component — the hero only ever gates on `verdict` itself
   *  now (see the bail-out below). This page-level "accounts + all
   *  transactions" flag used to also suppress the hero, which was the bug:
   *  on a warm-cache back-navigation the verdict is already here but
   *  `loading` (SpendPage's `pageLoading`) was still true for a beat, so the
   *  hero rendered as a bare 220px box while the rest of the page painted,
   *  then popped in at full height and shoved everything down. Kept only so
   *  existing callers (app/design/spend-live/SpendLiveClient.tsx, which
   *  still passes `loading={false}`) don't need a synchronised edit. */
  loading?: boolean;
}

function IncomeDrilldown({ incomeTxns, onTransactionClick }: { incomeTxns: Transaction[]; onTransactionClick: (tx: Transaction) => void }) {
  if (incomeTxns.length === 0) return null;
  return (
    <div className="mt-2 glass-card rounded-xl overflow-hidden">
      <div className="px-4 pt-2.5 pb-1">
        <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide">Income this period</p>
      </div>
      {incomeTxns.map((tx) => (
        <TransactionRow key={tx.id} transaction={tx} onClick={() => onTransactionClick(tx)} />
      ))}
    </div>
  );
}

// ── This period / Patterns — the Spend page's only view switch. It
// sits immediately below the shared header, so people choose the scope
// before reading either the reconciled period breakdown or the cross-period
// pattern summary. A full-width segmented control gives both choices equal
// weight and preserves a true 44px tap target. ───────────────────────────────
export function SpendPatternsToggle({
  showPatterns,
  onSetShowPatterns,
}: {
  showPatterns: boolean;
  onSetShowPatterns: (v: boolean) => void;
}) {
  const items: Array<{ key: "period" | "over"; label: string; active: boolean; onClick: () => void }> = [
    { key: "period", label: "This period", active: !showPatterns, onClick: () => onSetShowPatterns(false) },
    { key: "over", label: "Patterns", active: showPatterns, onClick: () => onSetShowPatterns(true) },
  ];
  return (
    <div className="grid grid-cols-2 gap-1 rounded-2xl bg-slate-200/70 p-1 dark:bg-slate-800/80" role="tablist" aria-label="Spend view">
      {items.map((it) => (
        <button
          key={it.key}
          type="button"
          role="tab"
          aria-selected={it.active}
          onClick={it.onClick}
          className={`min-h-[44px] px-4 flex items-center justify-center rounded-xl text-[13px] font-semibold transition-[background-color,color,box-shadow] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-slate-900 ${
            it.active
              ? "bg-white text-slate-900 shadow-sm dark:bg-slate-700 dark:text-slate-100"
              : "text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100"
          }`}
        >
          {it.label}
        </button>
      ))}
    </div>
  );
}

// ── Period sheet — home for period navigation, pay-period settings and "how
// we categorise" (rehomed off the hero card so nothing floats between it and
// the body — the same .glass-sheet treatment as every other bottom sheet;
// native pickers never appear, DESIGN.md). Opened by tapping the hero's
// period whisper row. ───────────────────────────────────────────────────
function PeriodSheet({
  recentPeriods,
  onSelectOffset,
  onOpenSettings,
  onOpenRules,
  onClose,
}: {
  recentPeriods: RecentPeriodOption[];
  onSelectOffset: (offset: number) => void;
  onOpenSettings: () => void;
  onOpenRules: () => void;
  onClose: () => void;
}) {
  useLockBodyScroll();
  const panelRef = useSheetA11y<HTMLDivElement>(onClose);
  return (
    <>
      <div className="fixed inset-0 bg-black/40 z-[65]" onClick={onClose} />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="Pay periods"
        className="fixed bottom-0 left-1/2 -translate-x-1/2 w-full max-w-[430px] glass-sheet rounded-t-3xl z-[70] overflow-y-auto max-h-[80dvh]"
        style={{ paddingBottom: "max(16px, env(safe-area-inset-bottom, 0px))" }}
      >
        <div className="flex items-center justify-between px-4 pt-4 pb-2">
          <p className="text-sm font-bold text-slate-900 dark:text-slate-100">Pay periods</p>
          <button
            onClick={onClose}
            aria-label="Close"
            className="w-11 h-11 -mr-2 flex items-center justify-center rounded-full active:bg-slate-100 dark:active:bg-slate-700/60 transition-colors"
          >
            <X size={18} className="text-slate-500 dark:text-slate-400" />
          </button>
        </div>
        <div className="px-2 pb-2" data-tutorial-id="tutorial-spend-periods">
          {recentPeriods.map((p) => (
            <button
              key={p.offset}
              type="button"
              onClick={() => { onSelectOffset(p.offset); onClose(); }}
              className="w-full min-h-[44px] flex items-center justify-between px-3 rounded-xl active:bg-slate-100 dark:active:bg-slate-700/40 transition-colors"
            >
              <span className="text-sm font-medium text-slate-800 dark:text-slate-100">{p.label}</span>
              {p.offset === 0 && (
                <span className="text-[11px] font-semibold text-indigo-600 dark:text-indigo-400">Current</span>
              )}
            </button>
          ))}
        </div>
        <div className="border-t border-slate-100 dark:border-slate-700 px-2 pt-2">
          <button
            type="button"
            onClick={() => { onOpenSettings(); onClose(); }}
            className="w-full min-h-[44px] flex items-center gap-2.5 px-3 rounded-xl active:bg-slate-100 dark:active:bg-slate-700/40 transition-colors text-left"
          >
            <Settings2 size={15} className="text-slate-500 dark:text-slate-400 flex-shrink-0" />
            <span className="text-sm font-medium text-slate-800 dark:text-slate-100">Pay period settings</span>
          </button>
          <button
            type="button"
            onClick={() => { onOpenRules(); onClose(); }}
            className="w-full min-h-[44px] flex items-center gap-2.5 px-3 rounded-xl active:bg-slate-100 dark:active:bg-slate-700/40 transition-colors text-left"
            data-tutorial-id="tutorial-spend-manage"
          >
            <Info size={15} className="text-slate-500 dark:text-slate-400 flex-shrink-0" />
            <span className="text-sm font-medium text-slate-800 dark:text-slate-100">How we categorise your money</span>
          </button>
        </div>
      </div>
    </>
  );
}

// ── Hero placeholder — shown only when there is genuinely no verdict to
// paint yet (cold load, or a period swiped to that has no cached verdict
// while its fetch is in flight). Traces the real glass-hero card's own DOM
// shape below line for line — period row (44px via the search glyph's
// h-11), the bordered instrument inset (Out row, the In/Moved divided row,
// the gap-line caption) and a two-line reading placeholder — rather than a
// loose approximation, so the placeholder-to-real swap doesn't itself shift
// the page (measured: real hero ~319-343px incl. its px-4 pt-6 wrapper vs
// this placeholder's ~295-319px — within ~7%, the remaining gap being the
// reading's own variable line count). SpendPage.tsx's cold-load
// `SpendSkeleton` renders this exact component for its hero block too, so
// the two can never drift apart into two different heights again.
export function SpendHeroSkeleton() {
  return (
    <div className="px-4 pt-6" aria-hidden="true">
      <div className="glass-hero rounded-3xl p-4 animate-pulse">
        <div className="flex items-center justify-between gap-2">
          <div className="min-h-[44px] flex items-center">
            <div className="h-3 w-40 rounded bg-slate-200 dark:bg-slate-700" />
          </div>
          <div className="w-11 h-11 rounded-full bg-slate-200 dark:bg-slate-700 flex-shrink-0" />
        </div>
        <div className="mt-5">
          <div className="h-2.5 w-10 rounded bg-slate-200 dark:bg-slate-700" />
          <div className="mt-2 h-9 w-36 rounded bg-slate-200 dark:bg-slate-700" />
          <div className="mt-4 flex gap-3">
            <div className="h-3.5 w-20 rounded bg-slate-200 dark:bg-slate-700" />
            <div className="h-3.5 w-24 rounded bg-slate-200 dark:bg-slate-700" />
          </div>
        </div>
        <div className="mt-3 space-y-1.5">
          <div className="h-3.5 w-full rounded bg-slate-200 dark:bg-slate-700" />
          <div className="h-3.5 w-2/3 rounded bg-slate-200 dark:bg-slate-700" />
        </div>
      </div>
    </div>
  );
}

export default function SpendHeader(props: SpendHeaderProps) {
  const {
    verdict, isCurrentPeriod, canGoPrev, onPrev, onNext, periodLabel, swipeHandlers,
    onOpenSettings, onOpenRules, incomeTxns, onIncomeOpen, onTransactionClick, onOutTap, onMovedTap,
    onUnresolvedTap, recentPeriods = [], onSelectOffset,
  } = props;
  const [incomeExpanded, setIncomeExpanded] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);

  // Gates on `verdict` alone now — see the `loading` prop's own comment
  // above. incomeTxns/recentPeriods (the other props fed from SpendPage's
  // still-loading accounts+transactions fetch) are safe to leave stale
  // here: incomeTxns only ever paints inside IncomeDrilldown, which is
  // gated on `incomeExpanded` (starts false, never restored), and
  // recentPeriods only ever paints inside PeriodSheet, gated on `sheetOpen`
  // (also starts false) — neither can appear on first paint, so neither can
  // shift it when its data arrives a moment later.
  if (!verdict) {
    return <SpendHeroSkeleton />;
  }

  const { reading, pills, period, moved_total, unresolved_total, unresolved_material } = verdict;
  // moved_total is additive/optional on SpendVerdict (lib/api.ts) — older
  // payloads without it still render a correct, flat two-cell Out | In
  // header. verdict.pace_series remains on the payload/type (lib/api.ts) —
  // the owner's weighted-instrument pick (variant B, 2026-08-27) cut the
  // pace strip from the rendered header entirely, and it is still never read
  // here. The series didn't stay unused for long, though: SpendTrends.tsx's
  // "pace_curve" chart widget (Charts tab, added after this header's own
  // strip was cut) reads it from SpendPage.tsx's verdict state directly, so
  // it is no longer true that only this file's fixtures touched the field.
  const hasMoved = moved_total !== undefined;
  // OUT-pill footnote — server-decided (spend_impact.is_unresolved_material)
  // so this can never disagree with the reading's own hedge; absent on
  // older payloads (unresolved_material undefined) just like hasMoved above.
  const showUnresolvedFootnote = !!unresolved_material && unresolved_total !== undefined;

  return (
    <div className="px-4 pt-6">
      {/* "Back to this period" — the period label above is a small whisper,
          so a past period (offset<0) needs a clearly visible way back. */}
      {!isCurrentPeriod && onSelectOffset && (
        <button
          type="button"
          onClick={() => onSelectOffset(0)}
          className="mb-3 inline-flex min-h-[36px] items-center gap-1.5 px-3 rounded-full bg-indigo-50 dark:bg-indigo-500/15 text-indigo-700 dark:text-indigo-300 text-[12px] font-semibold active:scale-95 transition-transform"
        >
          <ChevronLeft size={13} />
          Back to this period
        </button>
      )}

      <div className="glass-hero rounded-3xl p-4" data-tutorial-id="tutorial-spend-verdict" {...swipeHandlers} style={{ touchAction: "pan-y" }}>
        {/* Whisper period row — tap the label to open the period sheet */}
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1 min-w-0">
            {canGoPrev && (
              <button
                type="button"
                onClick={onPrev}
                aria-label="Previous period"
                className="h-11 w-7 -ml-1 flex items-center justify-center flex-shrink-0 active:opacity-60 transition-opacity"
              >
                <ChevronLeft size={14} className="text-slate-500 dark:text-slate-400" />
              </button>
            )}
            <button
              type="button"
              onClick={() => setSheetOpen(true)}
              className="min-h-[44px] flex items-center text-left active:opacity-60 transition-opacity min-w-0"
            >
              {/* Point 5 (variant B) — the redundant "PAY PERIOD" prefix is
                  dropped (the whole app already knows this is Spend's period
                  row) and the eyebrow keeps at most one middle dot. */}
              <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-400 truncate">
                {periodLabel.toUpperCase()} · DAY {period.days_elapsed}
              </p>
            </button>
            {!isCurrentPeriod && (
              <button
                type="button"
                onClick={onNext}
                aria-label="Next period"
                className="h-11 w-7 flex items-center justify-center flex-shrink-0 active:opacity-60 transition-opacity"
              >
                <ChevronRight size={14} className="text-slate-500 dark:text-slate-400" />
              </button>
            )}
          </div>
          <Link
            href="/transactions"
            aria-label="Search transactions"
            className="w-11 h-11 flex items-center justify-center rounded-full glass-tile flex-shrink-0 active:scale-95 transition-transform"
          >
            <Search size={20} className="text-slate-500 dark:text-slate-400" />
          </Link>
        </div>

        {/* The instrument — re-weighted per the owner's variant B pick
            (2026-08-27, "weighted instrument"): OUT leads as the hero
            figure (Spend is about spending), IN and MOVED drop to a
            secondary tier below it rather than sitting beside it as three
            equal cells, and the pace strip is cut entirely — see DESIGN.md's
            "The Instrument Header (Spend)" for the rewritten doctrine. Still
            housed in the same bordered inset (the lit-panel identity,
            permanent) and this card still deliberately never takes the
            app's glow-as-attention treatment (.needs-you) — that stays
            reserved for cards with an actual move to make
            (HomeBrief.tsx/PaydayPlanCard.tsx/SafeToSpendCard.tsx/
            UpcomingBillsStrip.tsx). */}
        <div className="mt-5">
          <button
            type="button"
            onClick={onOutTap}
            className="w-full min-h-[44px] flex flex-col items-start justify-center text-left active:opacity-70 transition-opacity"
          >
            <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-400">Out</span>
            {/* Display/30 (DESIGN.md Typography Hierarchy: "the one hero
                figure per screen") — the nearest documented type step to
                variant B's un-ramped text-[28px]. Out is now that hero
                figure for this instrument, so Display is the correct step,
                not just the closer number. */}
            <span className="text-[30px] leading-tight tracking-[-0.025em] font-bold tabular-nums font-mono text-slate-900 dark:text-slate-100">
              {fmt(pills.spent)}
            </span>
          </button>

          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1">
            <button
              type="button"
              onClick={() => {
                const next = !incomeExpanded;
                setIncomeExpanded(next);
                if (next) onIncomeOpen?.();
              }}
              aria-expanded={incomeExpanded}
              className="min-h-[44px] inline-flex items-center gap-1.5 active:opacity-70 transition-opacity"
            >
              <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">In</span>
              {/* Title/14 (DESIGN.md: "Row primaries, button labels") — the
                  secondary tier's step, one below Out's Display/30. */}
              <span className="text-sm font-bold tabular-nums font-mono text-slate-700 dark:text-slate-300">{fmt(pills.income)}</span>
            </button>
            {hasMoved && (
              // Point 2 (variant B) — MOVED loses the Verified Emerald
              // treatment and renders in the same neutral ink as In: mostly-
              // shuffling money (own-account transfers) hasn't earned
              // Verified Emerald, which DESIGN.md now reserves for genuine
              // good news (see the rewritten "Instrument Header" section).
              <button
                type="button"
                onClick={onMovedTap}
                aria-label="Money you moved"
                className="min-h-[44px] inline-flex items-center gap-1.5 active:opacity-70 transition-opacity"
              >
                <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Moved</span>
                <span className="text-sm font-bold tabular-nums font-mono text-slate-700 dark:text-slate-300">{fmt(moved_total!)}</span>
              </button>
            )}
          </div>
        </div>

        {/* OUT-pill footnote — sits below the instrument and above the
            reading, since it's an annotation on the Out figure specifically.
            44px tap target via the established invisible-pseudo-element
            pattern (PennyConversation.tsx's SuggestionChip) around an 11px
            line. */}
        {showUnresolvedFootnote && (
          <button
            type="button"
            onClick={onUnresolvedTap}
            className="relative mt-2 min-h-[28px] flex items-center before:absolute before:-inset-y-2 before:-inset-x-1 before:content-[''] text-[11px] text-slate-500 dark:text-slate-400 active:opacity-60 transition-opacity"
          >
            Includes {fmt(unresolved_total!)} not yet placed ›
          </button>
        )}

        {/* The reading, now a caption under the instrument rather than the
            card's own 20px hero line. Never clamped: this is Penny's verdict
            and DESIGN.md's north star is "verdicts lead" — truncating it
            with an ellipsis and no way to expand is a direct violation. The
            backend already bounds reading length, so the unclamped cost is
            at most a line or two of extra card height; no fixed-height
            sibling below this depends on the reading staying short. */}
        <p lang="en-GB" className="text-pretty mt-3 text-sm font-normal text-slate-600 dark:text-slate-300"><MoneyText text={reading} /></p>
      </div>

      {incomeExpanded && <IncomeDrilldown incomeTxns={incomeTxns} onTransactionClick={onTransactionClick} />}

      {sheetOpen && (
        <PeriodSheet
          recentPeriods={recentPeriods}
          onSelectOffset={(o) => onSelectOffset?.(o)}
          onOpenSettings={onOpenSettings}
          onOpenRules={onOpenRules}
          onClose={() => setSheetOpen(false)}
        />
      )}
    </div>
  );
}
