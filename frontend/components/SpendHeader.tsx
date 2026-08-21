"use client";

// The Spend hub's TOP region — everything above SpendVerdictView's reading.
//
// "Verdict Header" — one glass-hero card holding a whisper period row (tap
// to open the period sheet), an Out | In | Moved instrument row (with an
// optional pace-strip sparkline nested in a lit-panel inset), and the
// reading as a caption underneath. This is the ONE header: production
// (SpendPage.tsx) and the /design/spend-inst-b preview both trace back to
// this component's approved content — verdict.pills / verdict.period /
// verdict.reading / verdict.pace_series / verdict.moved_total are all
// server-computed (Show Your Working Rule, ENGINE.md) — so preview and
// production can never draw different numbers again (the bug that shipped:
// the real page computed its own client-side "spent" including Savings/
// Investment/Debt-kind categories, while the preview route hand-copied a
// header that happened to read the correct verdict.pills figure — nobody
// noticed the two disagreed because nothing forced them to share code).
// Earlier "current" and "a" top variants were retired once the owner picked
// this one (2026-08); the two-cell Out/In footer was retired for the
// three-cell instrument row once "lit panel" (spend-inst-b) was approved.
//
// This component never derives a money figure from raw transactions.

import { useState } from "react";
import Link from "next/link";
import { ChevronLeft, ChevronRight, Settings2, Search, Info, X } from "lucide-react";
import { useLockBodyScroll } from "@/lib/useLockBodyScroll";
import { useSheetA11y } from "@/lib/useSheetA11y";
import TransactionRow from "@/components/TransactionRow";
import MoneyText from "@/components/MoneyText";
import type { SpendVerdict, SpendVerdictPaceEntry, Transaction } from "@/lib/api";

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

// Whether the instrument should glow — the ONE glow-as-attention condition
// for this card (globals.css's `.needs-you`, at most one per screen: it
// signals "your move", not decoration, so it must actually gate on
// something). True only when the strip has a known usual AND today's
// actual has run past it — never when there's no strip at all, or no
// baseline yet.
function isOverPace(series?: SpendVerdictPaceEntry[]): boolean {
  if (!series || series.length === 0) return false;
  const last = series[series.length - 1];
  return last.usual != null && last.actual > last.usual;
}

// Monotone cubic Hermite interpolation (Fritsch-Carlson, i.e. d3's
// curveMonotoneX) — builds a smooth <path> "d" string through points that
// are monotone (non-decreasing) in x, WITHOUT ever overshooting above or
// undershooting below the data values it passes through. This matters
// because the pace strip plots cumulative money: a plain Catmull-Rom/basis
// spline can ring past a point (dip below on the way up, bulge above on the
// way down) which would visually claim money came back — dishonest for a
// cumulative series that only climbs or holds. Fritsch-Carlson clamps each
// segment's tangent so the interpolant never exceeds the range of its two
// bracketing points, i.e. it stays within [min(y_i, y_i+1), max(y_i, y_i+1)]
// on every segment — that's the monotonicity guarantee, and it holds
// regardless of whether the input itself is monotone (flat/step-y bill-day
// data is exactly what this is for).
function monotonePath(points: { x: number; y: number }[]): string {
  const n = points.length;
  if (n === 0) return "";
  if (n === 1) return `M ${points[0].x} ${points[0].y}`;
  if (n === 2) return `M ${points[0].x} ${points[0].y} L ${points[1].x} ${points[1].y}`;

  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);

  // Secant (segment) slopes.
  const d: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    const dx = xs[i + 1] - xs[i];
    d.push(dx === 0 ? 0 : (ys[i + 1] - ys[i]) / dx);
  }

  // Initial tangents: average of adjacent secants (endpoints borrow their
  // single neighbouring secant).
  const m: number[] = new Array(n);
  m[0] = d[0];
  m[n - 1] = d[n - 2];
  for (let i = 1; i < n - 1; i++) {
    m[i] = (d[i - 1] === 0 || d[i] === 0 || Math.sign(d[i - 1]) !== Math.sign(d[i])) ? 0 : (d[i - 1] + d[i]) / 2;
  }

  // Fritsch-Carlson: clamp tangents so each segment stays within the data
  // range (the step that makes this "monotone" rather than plain Hermite).
  for (let i = 0; i < n - 1; i++) {
    if (d[i] === 0) {
      m[i] = 0;
      m[i + 1] = 0;
      continue;
    }
    const a = m[i] / d[i];
    const b = m[i + 1] / d[i];
    const s = a * a + b * b;
    if (s > 9) {
      const t = 3 / Math.sqrt(s);
      m[i] = t * a * d[i];
      m[i + 1] = t * b * d[i];
    }
  }

  let path = `M ${xs[0]} ${ys[0]}`;
  for (let i = 0; i < n - 1; i++) {
    const dx = xs[i + 1] - xs[i];
    const c1x = xs[i] + dx / 3;
    const c1y = ys[i] + m[i] * (dx / 3);
    const c2x = xs[i + 1] - dx / 3;
    const c2y = ys[i + 1] - m[i + 1] * (dx / 3);
    path += ` C ${c1x} ${c1y}, ${c2x} ${c2y}, ${xs[i + 1]} ${ys[i + 1]}`;
  }
  return path;
}

// ── Pace strip — a small "instrument" reading: cumulative actual spend
// (solid indigo, the actual-spend line colour per DESIGN.md) against a
// cumulative usual pace (dotted slate), today marked with a 4px dot. Pure
// SVG, no chart library — this is a sparkline, not a real chart. Lines are
// drawn as monotone cubic <path>s (see monotonePath above) rather than
// straight <polyline> segments, so bill-day step jumps read as smooth
// curves instead of sharp corners — without ever overshooting the data. ──
function PaceStrip({ series }: { series: SpendVerdictPaceEntry[] }) {
  if (series.length === 0) return null;

  const width = 300;
  const height = 56;
  const pad = 6;

  const maxDay = Math.max(1, ...series.map((p) => p.day));
  const usualPoints = series.filter(
    (p): p is SpendVerdictPaceEntry & { usual: number } => p.usual != null,
  );
  const hasUsual = usualPoints.length > 0;
  const maxVal = Math.max(
    1,
    ...series.map((p) => p.actual),
    ...usualPoints.map((p) => p.usual),
  );

  const x = (day: number) => pad + (day / maxDay) * (width - 2 * pad);
  const y = (val: number) => height - pad - (val / maxVal) * (height - 2 * pad);

  const actualPath = monotonePath(series.map((p) => ({ x: x(p.day), y: y(p.actual) })));
  const usualPath = monotonePath(usualPoints.map((p) => ({ x: x(p.day), y: y(p.usual) })));

  const last = series[series.length - 1];
  const lastUsual = usualPoints[usualPoints.length - 1];

  const summary = hasUsual
    ? `Spending pace: ${fmt(last.actual)} so far this period, against a usual pace of ${fmt(lastUsual.usual)}.`
    : `Spending pace: ${fmt(last.actual)} so far this period. Still learning your usual.`;

  return (
    <div>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        className="w-full"
        style={{ height: 56 }}
        role="img"
        aria-label={summary}
      >
        {hasUsual && (
          <path
            d={usualPath}
            fill="none"
            stroke="currentColor"
            className="text-slate-600 dark:text-slate-400"
            strokeWidth={1.5}
            strokeDasharray="3 4"
            strokeLinecap="round"
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
          />
        )}
        <path
          d={actualPath}
          fill="none"
          stroke="#4f46e5"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />
        <circle cx={x(last.day)} cy={y(last.actual)} r={4} fill="#4f46e5" vectorEffect="non-scaling-stroke" />
        {hasUsual && (
          <text
            x={x(lastUsual.day)}
            y={y(lastUsual.usual) - 6}
            fontSize={10}
            textAnchor="end"
            className="fill-slate-600 dark:fill-slate-400"
          >
            usual
          </text>
        )}
      </svg>
      {!hasUsual && (
        <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">still learning your usual</p>
      )}
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
    onOpenSettings, onOpenRules, incomeTxns, onTransactionClick, onOutTap, onMovedTap,
    onUnresolvedTap, recentPeriods = [], onSelectOffset, loading,
  } = props;
  const [incomeExpanded, setIncomeExpanded] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);

  if (loading || !verdict) {
    return <div className="px-4 pt-6" style={{ minHeight: 220 }} />;
  }

  const { reading, pills, period, pace_series, moved_total, unresolved_total, unresolved_material } = verdict;
  // Both are additive/optional on SpendVerdict (lib/api.ts) — older payloads
  // without them still render a correct, flat two-cell Out | In header with
  // no strip and no glow.
  const hasStrip = !!pace_series && pace_series.length > 0;
  const hasMoved = moved_total !== undefined;
  // OUT-pill footnote — server-decided (spend_impact.is_unresolved_material)
  // so this can never disagree with the reading's own hedge; absent on
  // older payloads (unresolved_material undefined) just like hasStrip/
  // hasMoved above.
  const showUnresolvedFootnote = !!unresolved_material && unresolved_total !== undefined;
  // Glow only when the instrument actually needs the user (see isOverPace
  // above) — never unconditional. The bordered .glass-tile inset below
  // stays permanent; only this boolean gates `.needs-you`.
  const glowInstrument = isOverPace(pace_series);

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

        {/* The instrument — cells + pace strip treated as ONE unit, always
            housed in a bordered inset (the lit-panel identity, permanent).
            The app's glow-as-attention treatment (.needs-you, at most one
            per screen) layers on top of that inset ONLY when glowInstrument
            is true (see isOverPace above) — a card glows because it needs
            the user, never as permanent decoration (the same contract
            HomeBrief.tsx/PaydayPlanCard.tsx/SafeToSpendCard.tsx/
            UpcomingBillsStrip.tsx gate on). Combining a Tailwind `border`
            utility with `.needs-you` mirrors that existing pattern —
            `.needs-you` supplies the border colour + lit background + glow,
            the utility supplies the border width/style, and both are
            present regardless so the inset never visibly "pops" when the
            glow toggles on. */}
        <div
          className={`mt-4 rounded-2xl border border-slate-200/70 dark:border-slate-700/70 p-3${glowInstrument ? " needs-you" : ""}`}
        >
          <div className="flex divide-x divide-slate-200/70 dark:divide-slate-700/70">
            <button
              type="button"
              onClick={onOutTap}
              className="flex-1 min-h-[44px] px-3 py-1.5 flex flex-col items-start justify-center active:opacity-70 transition-opacity"
            >
              <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-400">Out</span>
              <span className="text-[20px] font-bold tabular-nums font-mono text-slate-900 dark:text-slate-100">{fmt(pills.spent)}</span>
            </button>
            <button
              type="button"
              onClick={() => setIncomeExpanded((v) => !v)}
              aria-expanded={incomeExpanded}
              className="flex-1 min-h-[44px] px-3 py-1.5 flex flex-col items-start justify-center active:opacity-70 transition-opacity"
            >
              <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-400">In</span>
              <span className="text-[20px] font-bold tabular-nums font-mono text-slate-900 dark:text-slate-100">{fmt(pills.income)}</span>
            </button>
            {hasMoved && (
              <button
                type="button"
                onClick={onMovedTap}
                aria-label="Money you moved"
                className="flex-1 min-h-[44px] px-3 py-1.5 flex flex-col items-start justify-center active:scale-95 transition-transform"
              >
                <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-400">Moved</span>
                <span className="text-[20px] font-bold tabular-nums font-mono text-emerald-600 dark:text-emerald-400">{fmt(moved_total!)}</span>
              </button>
            )}
          </div>

          {hasStrip && (
            <div className="mt-3 glass-tile rounded-xl p-3">
              <PaceStrip series={pace_series!} />
            </div>
          )}
        </div>

        {/* OUT-pill footnote — sits below the instrument (not inside it,
            so it never crowds the pace strip) and above the reading, since
            it's an annotation on the Out figure specifically. 44px tap
            target via the established invisible-pseudo-element pattern
            (PennyConversation.tsx's SuggestionChip) around an 11px line. */}
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
            card's own 20px hero line. */}
        <p lang="en-GB" className="text-pretty mt-3 text-sm font-normal text-slate-600 dark:text-slate-300 line-clamp-3"><MoneyText text={reading} /></p>
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
