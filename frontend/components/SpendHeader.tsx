"use client";

// The Spend hub's TOP region — everything above SpendVerdictView's reading.
//
// "Verdict Header" — one glass-hero card holding a whisper period row (tap
// to open the period sheet), the reading, and a hairline-divided Out/In
// footer. This is the ONE header: production (SpendPage.tsx) and the
// /design/spend-live preview both render this exact component from
// verdict.pills / verdict.period / verdict.reading — server-computed (Show
// Your Working Rule, ENGINE.md) — so preview and production can never draw
// different numbers again (the bug that shipped: the real page computed its
// own client-side "spent" including Savings/Investment/Debt-kind categories,
// while the preview route hand-copied a header that happened to read the
// correct verdict.pills figure — nobody noticed the two disagreed because
// nothing forced them to share code). Earlier "current" and "a" top variants
// were retired once the owner picked this one (2026-08).
//
// This component never derives a money figure from raw transactions.

import { useState } from "react";
import Link from "next/link";
import { ChevronLeft, ChevronRight, Settings2, Search, Info, X } from "lucide-react";
import { useLockBodyScroll } from "@/lib/useLockBodyScroll";
import { useSheetA11y } from "@/lib/useSheetA11y";
import TransactionRow from "@/components/TransactionRow";
import type { SpendVerdict, Transaction } from "@/lib/api";

const MINUS = "−";
const fmt = (n: number) => `£${Math.round(n).toLocaleString("en-GB")}`;

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
  onTransactionClick: (tx: Transaction) => void;
  /** "Out" is the Show Your Working entry point for the spend figure — see
   *  SpendVerdictView's expandMajoritySignal/#spend-majority-section. Forces
   *  the majority list open and scrolls to it: the exact reconciled
   *  transactions (notables + majority + unresolved = pills.spent) behind
   *  the figure, reusing the frozen body's own evidence rather than building
   *  a second one. */
  onOutTap?: () => void;
  /** Recent periods to jump to, and past periods to view — the period
   *  sheet's in-sheet row list (native pickers never appear, DESIGN.md). */
  recentPeriods?: RecentPeriodOption[];
  onSelectOffset?: (offset: number) => void;
  /** Gates pill/hero rendering until the verdict has loaded (true = show
   *  nothing yet rather than a wrong number). */
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

// ── This period / Over time toggle — an ARIA tablist immediately above the
// majority list (SpendVerdictView's `aboveMajority` slot), styled as that
// section's own header row, so the swap between "this period" and "over
// time" is announced. Rebuilt at a true 44px tap target;
// slate-600/dark:slate-400 (production's old slate-400-alone was 2.26:1
// against the canvas — fails WCAG AA 4.5:1). ───────────────────────────────
export function SpendPatternsToggle({
  showPatterns,
  onSetShowPatterns,
}: {
  showPatterns: boolean;
  onSetShowPatterns: (v: boolean) => void;
}) {
  const items: Array<{ key: "period" | "over"; label: string; active: boolean; onClick: () => void }> = [
    { key: "period", label: "This period", active: !showPatterns, onClick: () => onSetShowPatterns(false) },
    { key: "over", label: "Over time", active: showPatterns, onClick: () => onSetShowPatterns(true) },
  ];
  return (
    <div className="flex items-center gap-1.5 px-1 mb-2" role="tablist" aria-label="Spend view">
      {items.map((it) => (
        <button
          key={it.key}
          type="button"
          role="tab"
          aria-selected={it.active}
          onClick={it.onClick}
          className={`min-h-[44px] px-4 flex items-center justify-center rounded-full text-[11px] font-semibold transition-colors ${
            it.active
              ? "bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 shadow-sm"
              : "text-slate-600 dark:text-slate-400"
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
        <div className="px-2 pb-2">
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
          >
            <Info size={15} className="text-slate-500 dark:text-slate-400 flex-shrink-0" />
            <span className="text-sm font-medium text-slate-800 dark:text-slate-100">How we categorise your money</span>
          </button>
        </div>
      </div>
    </>
  );
}

export default function SpendHeader(props: SpendHeaderProps) {
  const {
    verdict, isCurrentPeriod, canGoPrev, onPrev, onNext, periodLabel, swipeHandlers,
    onOpenSettings, onOpenRules, incomeTxns, onTransactionClick, onOutTap,
    recentPeriods = [], onSelectOffset, loading,
  } = props;
  const [incomeExpanded, setIncomeExpanded] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);

  if (loading || !verdict) {
    return <div className="px-4 pt-6" style={{ minHeight: 220 }} />;
  }

  const { reading, pills, period } = verdict;

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

      <div className="glass-hero rounded-3xl p-4" {...swipeHandlers} style={{ touchAction: "pan-y" }}>
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
              <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-400 truncate">
                PAY PERIOD · {periodLabel.toUpperCase()} · DAY {period.days_elapsed}
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

        {/* The reading */}
        <p className="mt-3 text-[20px] font-bold leading-snug text-balance text-slate-900 dark:text-slate-100">{reading}</p>

        {/* Hairline-divided footer — two 44px cells, not nested tiles */}
        <div className="mt-4 -mx-4 border-t border-slate-200/70 dark:border-slate-700/70 flex">
          <button
            type="button"
            onClick={onOutTap}
            className="flex-1 min-h-[44px] px-4 pt-3 flex flex-col items-start active:opacity-70 transition-opacity"
          >
            <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-400">Out</span>
            <span className="text-[20px] font-bold text-slate-900 dark:text-slate-100">{fmt(pills.spent)}</span>
          </button>
          <div className="w-px my-2 bg-slate-200/70 dark:bg-slate-700/70" aria-hidden />
          <button
            type="button"
            onClick={() => setIncomeExpanded((v) => !v)}
            aria-expanded={incomeExpanded}
            className="flex-1 min-h-[44px] px-4 pt-3 flex flex-col items-start active:opacity-70 transition-opacity"
          >
            <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-400">In</span>
            <span className="text-[20px] font-bold text-slate-900 dark:text-slate-100">{fmt(pills.income)}</span>
          </button>
        </div>
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
