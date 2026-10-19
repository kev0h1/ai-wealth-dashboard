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
// category rows and the reading already carry the same "more than usual"
// fact in words). See DESIGN.md's "The Instrument Header (Spend)".
//
// This component never derives a money figure from raw transactions.

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronDown, ChevronLeft, ChevronRight, Settings2, Search, Info } from "lucide-react";
import { SheetFrame } from "@/components/SheetFrame";
import TransactionRow from "@/components/TransactionRow";
import MoneyText from "@/components/MoneyText";
import type { SpendVerdict, Transaction } from "@/lib/api";
import { unresolvedWorthAsking } from "@/lib/spendUnresolved";
import { dateToUTCDay } from "@/lib/payPeriod";

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
  const router = useRouter();
  return (
    <SheetFrame title="Pay periods" onClose={onClose} bodyClassName="px-2 py-2">
      {({ closeThen }) => <>
        <div className="px-2 pb-2" data-tutorial-id="tutorial-spend-periods">
          {recentPeriods.map((p) => (
            <button
              key={p.offset}
              type="button"
              onClick={() => closeThen(() => onSelectOffset(p.offset))}
              className="flex min-h-[44px] w-full items-center justify-between rounded-xl px-3 transition-colors hover:bg-slate-50 active:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-500 dark:hover:bg-slate-700/20 dark:active:bg-slate-700/40"
            >
              <span className="text-sm font-medium text-slate-800 dark:text-slate-100">{p.label}</span>
              {p.offset === 0 && (
                <span className="text-[11px] font-semibold text-indigo-600 dark:text-indigo-400">Current</span>
              )}
            </button>
          ))}
        </div>
        <div className="border-t border-slate-100 dark:border-slate-700 px-2 pt-2">
          <Link
            href="/transactions"
            onNavigate={event => { event.preventDefault(); closeThen(() => router.push("/transactions")); }}
            className="flex min-h-11 w-full items-center gap-2.5 rounded-xl px-3 text-left text-sm font-medium text-slate-800 transition-colors active:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:text-slate-100 dark:active:bg-slate-700/40"
          >
            <Search size={15} aria-hidden="true" className="shrink-0 text-slate-500 dark:text-slate-400" />
            Search transactions
          </Link>
          <button
            type="button"
            onClick={() => closeThen(onOpenSettings)}
            className="flex min-h-[44px] w-full items-center gap-2.5 rounded-xl px-3 text-left transition-colors hover:bg-slate-50 active:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-500 dark:hover:bg-slate-700/20 dark:active:bg-slate-700/40"
          >
            <Settings2 size={15} className="text-slate-500 dark:text-slate-400 flex-shrink-0" />
            <span className="text-sm font-medium text-slate-800 dark:text-slate-100">Pay period settings</span>
          </button>
          <button
            type="button"
            onClick={() => closeThen(onOpenRules)}
            className="flex min-h-[44px] w-full items-center gap-2.5 rounded-xl px-3 text-left transition-colors hover:bg-slate-50 active:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-500 dark:hover:bg-slate-700/20 dark:active:bg-slate-700/40"
            data-tutorial-id="tutorial-spend-manage"
          >
            <Info size={15} className="text-slate-500 dark:text-slate-400 flex-shrink-0" />
            <span className="text-sm font-medium text-slate-800 dark:text-slate-100">How we categorise your money</span>
          </button>
        </div>
      </>}
    </SheetFrame>
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

/** The full-width control row used by the approved pay-period journey. */
export function SpendPeriodBar(props: SpendHeaderProps) {
  const {
    verdict, periodLabel, isCurrentPeriod, canGoPrev, onPrev, onNext,
    onOpenSettings, onOpenRules, recentPeriods = [], onSelectOffset,
  } = props;
  const [sheetOpen, setSheetOpen] = useState(false);

  if (!verdict) return <SpendHeroSkeleton />;

  const start = new Date(dateToUTCDay(verdict.period.start));
  const end = new Date(dateToUTCDay(verdict.period.end));
  const dateFormat = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
  const fullRange = `${dateFormat.format(start)} to ${dateFormat.format(end)}`;
  const yearContext = start.getUTCFullYear() !== end.getUTCFullYear()
    ? `${start.getUTCFullYear()} to ${end.getUTCFullYear()}`
    : null;

  return (
    <>
      {/* G285 approved B: the complete date range sits beneath Spend;
          only the compact arrow pair and Search occupy the right tracks.
          No date truncation or shrunken targets are needed at 375/390px.
          The title's quiet day caption alone may wrap on a zoomed phone. */}
      <header data-g285-period-bar="b" className="grid grid-cols-[minmax(0,1fr)_auto_44px] items-center gap-1.5">
        <div data-period-title className="min-w-0 whitespace-nowrap">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
            <h1 className="text-[28px] font-bold leading-none tracking-[-0.03em] text-slate-950 dark:text-white">Spend</h1>
            <p className="text-[11px] text-slate-600 dark:text-slate-400">
              Day {verdict.period.days_elapsed}{verdict.period.days_left != null ? ` of ${verdict.period.days_elapsed + verdict.period.days_left}` : ""}
            </p>
          </div>
          <button
            type="button"
            data-period-picker
            aria-label={`Choose pay period, ${fullRange}`}
            aria-haspopup="dialog"
            aria-expanded={sheetOpen}
            onClick={() => setSheetOpen(true)}
            className="flex min-h-11 min-w-11 touch-manipulation flex-col items-start justify-start rounded-lg px-0 pb-1 pt-1 text-left text-slate-800 hover:bg-slate-100 active:opacity-70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 dark:text-slate-100 dark:hover:bg-slate-700 dark:focus-visible:ring-offset-slate-900"
          >
            <span className="flex items-center gap-1">
              <span data-period-label className="whitespace-nowrap text-[13px] font-semibold leading-[18px]">{periodLabel.replace(" → ", " to ")}</span>
              <ChevronDown size={12} aria-hidden="true" className="shrink-0" />
            </span>
            {yearContext && <span className="mt-0.5 whitespace-nowrap text-[11px] leading-4 text-slate-600 dark:text-slate-400">{yearContext}</span>}
          </button>
        </div>

        <nav aria-label="Pay period" className="flex items-center rounded-xl border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-800">
          <button
            type="button"
            aria-label="Previous pay period"
            disabled={!canGoPrev}
            onClick={onPrev}
            className="flex size-11 shrink-0 touch-manipulation items-center justify-center rounded-xl text-slate-600 hover:bg-slate-100 active:opacity-70 disabled:cursor-not-allowed disabled:text-slate-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 dark:text-slate-300 dark:hover:bg-slate-700 dark:disabled:text-slate-500 dark:focus-visible:ring-offset-slate-900"
          >
            <ChevronLeft size={17} aria-hidden="true" />
          </button>
          <button
            type="button"
            aria-label="Next pay period"
            disabled={isCurrentPeriod}
            onClick={onNext}
            className="flex size-11 shrink-0 touch-manipulation items-center justify-center rounded-xl text-slate-600 hover:bg-slate-100 active:opacity-70 disabled:cursor-not-allowed disabled:text-slate-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 dark:text-slate-300 dark:hover:bg-slate-700 dark:disabled:text-slate-500 dark:focus-visible:ring-offset-slate-900"
          >
            <ChevronRight size={17} aria-hidden="true" />
          </button>
        </nav>

        <Link
          href="/transactions"
          aria-label="Search transactions"
          className="flex size-11 shrink-0 touch-manipulation items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-600 hover:bg-slate-100 active:opacity-70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700 dark:focus-visible:ring-offset-slate-900"
        >
          <Search size={17} aria-hidden="true" />
        </Link>
      </header>

      {!isCurrentPeriod && onSelectOffset && (
        <button
          type="button"
          onClick={() => onSelectOffset(0)}
          className="mt-3 inline-flex min-h-11 items-center gap-1.5 rounded-xl border border-indigo-200 bg-indigo-50 px-3 text-[12px] font-semibold text-indigo-700 transition-transform active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 motion-reduce:transition-none dark:border-indigo-400/30 dark:bg-indigo-400/10 dark:text-indigo-300"
        >
          <ChevronLeft size={13} aria-hidden="true" />
          Back to this period
        </button>
      )}

      {sheetOpen && (
        <PeriodSheet
          recentPeriods={recentPeriods}
          onSelectOffset={(offset) => onSelectOffset?.(offset)}
          onOpenSettings={onOpenSettings}
          onOpenRules={onOpenRules}
          onClose={() => setSheetOpen(false)}
        />
      )}
    </>
  );
}

/** The stable answer-first summary that sits beside the journey on desktop. */
export function SpendJourneySummary(props: SpendHeaderProps) {
  const {
    verdict, incomeTxns, onIncomeOpen, onTransactionClick, onOutTap, onMovedTap,
  } = props;
  const [incomeExpanded, setIncomeExpanded] = useState(false);

  if (!verdict) return null;

  const attentionTotal = verdict.notables.reduce((sum, item) => sum + item.spent, 0);
  const unresolvedTotal = verdict.unresolved.total;
  const restTotal = Math.max(0, verdict.pills.spent - attentionTotal - unresolvedTotal);
  // The drill-in section is built from moved rows, so the summary action is
  // present only when that destination exists. The server derives
  // moved_total from the same rows.
  const hasMoved = verdict.moved.length > 0;
  const movedTotal = verdict.moved_total ?? verdict.moved.reduce((sum, item) => sum + item.amount, 0);

  return (
    <div data-tutorial-id="tutorial-spend-verdict">
      <h2 className="max-w-md text-balance text-[30px] font-bold leading-[1.05] tracking-[-0.035em] text-slate-950 dark:text-white sm:text-[38px]">
        Your pay period, as it happened
      </h2>
      <p lang="en-GB" className="mt-4 max-w-md text-pretty text-[15px] leading-6 text-slate-600 dark:text-slate-300">
        <MoneyText text={verdict.reading} />
      </p>

      <dl className={`mt-7 grid ${hasMoved ? "grid-cols-3" : "grid-cols-2"} gap-3 border-t border-slate-400/25 py-4 dark:border-white/10 lg:grid-cols-1 lg:gap-0 lg:divide-y lg:divide-slate-200/70 lg:py-0 dark:lg:divide-white/10`}>
        <div className="lg:flex lg:items-end lg:justify-between lg:py-4">
          <dt className="text-[10px] font-semibold uppercase tracking-[0.06em] text-slate-600 dark:text-slate-400">In</dt>
          <dd>
            <button
              type="button"
              onClick={() => {
                const next = !incomeExpanded;
                setIncomeExpanded(next);
                if (next) onIncomeOpen?.();
              }}
              aria-expanded={incomeExpanded}
              className="mt-1 inline-flex min-h-11 items-center font-mono text-lg font-bold tracking-[-0.025em] tabular-nums text-slate-950 transition-colors hover:text-indigo-700 active:opacity-70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:text-white dark:hover:text-indigo-300 sm:text-xl lg:text-2xl"
            >
              {fmt(verdict.pills.income)}
            </button>
          </dd>
        </div>
        <div className="lg:flex lg:items-end lg:justify-between lg:py-4">
          <dt className="text-[10px] font-semibold uppercase tracking-[0.06em] text-slate-600 dark:text-slate-400">Out</dt>
          <dd>
            <button
              type="button"
              onClick={onOutTap}
              className="mt-1 inline-flex min-h-11 items-center font-mono text-[26px] font-bold tracking-[-0.035em] tabular-nums text-slate-950 transition-colors hover:text-indigo-700 active:opacity-70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:text-white dark:hover:text-indigo-300 sm:text-[28px] lg:text-[30px]"
            >
              {fmt(verdict.pills.spent)}
            </button>
          </dd>
        </div>
        {hasMoved && (
          <div className="lg:flex lg:items-end lg:justify-between lg:py-4">
            <dt className="text-[10px] font-semibold uppercase tracking-[0.06em] text-slate-600 dark:text-slate-400">Moved separately</dt>
            <dd>
              <button
                type="button"
                onClick={onMovedTap}
                className="mt-1 inline-flex min-h-11 items-center font-mono text-lg font-bold tracking-[-0.025em] tabular-nums text-slate-950 transition-colors hover:text-indigo-700 active:opacity-70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:text-white dark:hover:text-indigo-300 sm:text-xl lg:text-2xl"
              >
                {fmt(movedTotal)}
              </button>
            </dd>
          </div>
        )}
      </dl>

      <details className="group mt-2">
        <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 rounded-xl px-1 text-left text-[12px] font-semibold text-slate-600 transition-colors hover:text-slate-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:text-slate-400 dark:hover:text-white [&::-webkit-details-marker]:hidden">
          <span>
            How <span className="font-mono tabular-nums">{fmt(verdict.pills.spent)}</span> out adds up
          </span>
          <ChevronDown size={15} aria-hidden="true" className="shrink-0 transition-transform group-open:rotate-180 motion-reduce:transition-none" />
        </summary>
        <dl className="space-y-2 px-1 pb-2 pt-1 text-[12px]">
          <div className="flex items-center justify-between gap-4">
            <dt className="text-slate-600 dark:text-slate-400">Needs a look</dt>
            <dd className="font-mono font-semibold tabular-nums text-slate-900 dark:text-slate-100">{fmt(attentionTotal)}</dd>
          </div>
          <div className="flex items-center justify-between gap-4">
            <dt className="text-slate-600 dark:text-slate-400">Other categorised spending</dt>
            <dd className="font-mono font-semibold tabular-nums text-slate-900 dark:text-slate-100">{fmt(restTotal)}</dd>
          </div>
          {unresolvedWorthAsking(unresolvedTotal) && (
            <div className="flex items-center justify-between gap-4">
              <dt className="text-slate-600 dark:text-slate-400">To categorise</dt>
              <dd className="font-mono font-semibold tabular-nums text-slate-900 dark:text-slate-100">{fmt(unresolvedTotal)}</dd>
            </div>
          )}
          <div className="flex items-center justify-between gap-4 border-t border-slate-200/80 pt-2 dark:border-white/10">
            <dt className="font-semibold text-slate-700 dark:text-slate-300">Total out</dt>
            <dd className="font-mono font-bold tabular-nums text-slate-950 dark:text-white">{fmt(verdict.pills.spent)}</dd>
          </div>
        </dl>
      </details>

      {incomeExpanded && <IncomeDrilldown incomeTxns={incomeTxns} onTransactionClick={onTransactionClick} />}
    </div>
  );
}
