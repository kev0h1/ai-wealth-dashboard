"use client";

// VARIANT-LOCAL "Weighted instrument" header for /design/spend-verdict-b.
// Not a fork of components/SpendHeader.tsx by accident — it is a deliberate
// re-weighting of the same bordered instrument (kept, per the brief, as the
// established identity) so OUT leads as the hero figure, IN/MOVED drop to a
// secondary tier below it, MOVED loses its emerald treatment (mostly
// shuffling hasn't earned Verified Emerald), and the pace strip gets an
// endpoint delta chip instead of communicating nothing. Preserves the real
// onOutTap / income-expand / onMovedTap interaction contract from the
// production header so this reads as a genuine re-weighting, not a
// different feature.
//
// DELETE after design review — see PENNY-adjacent /design/spend-live's own
// "TEMPORARY PREVIEW" header comment for the established convention.

import { useState } from "react";
import Link from "next/link";
import { ChevronLeft, Search } from "lucide-react";
import TransactionRow from "@/components/TransactionRow";
import MoneyText from "@/components/MoneyText";
import type { SpendVerdict, SpendVerdictPaceEntry, Transaction } from "@/lib/api";

// Same zero-safe / proper-minus convention as SpendHeader.tsx (copied
// locally, one-line pure helpers, no other dependency on that file).
const zeroSafe = (v: number) => (Math.abs(v) < 1 ? 0 : v);
const fmt = (n: number) => {
  const v = zeroSafe(n);
  const sign = v < 0 ? "−" : "";
  return `${sign}£${Math.abs(Math.round(v)).toLocaleString("en-GB")}`;
};
// Signed variant for the gap line / delta chip, where a positive number
// still needs an explicit "+" (fmt() only ever signs negatives).
const fmtSigned = (n: number) => {
  const v = zeroSafe(n);
  if (v === 0) return "£0";
  return v > 0 ? `+${fmt(v)}` : fmt(v);
};

export interface WeightedHeaderProps {
  verdict: SpendVerdict;
  periodLabel: string;
  isCurrentPeriod: boolean;
  onSelectOffset?: (offset: number) => void;
  incomeTxns: Transaction[];
  onTransactionClick: (tx: Transaction) => void;
  onOutTap?: () => void;
  onMovedTap?: () => void;
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

// Same Fritsch-Carlson monotone cubic interpolation as SpendHeader.tsx's
// PaceStrip (copied verbatim — a pure geometry helper, not a UI component,
// and the honesty guarantee it encodes, never overshoot the data, matters
// here too).
function monotonePath(points: { x: number; y: number }[]): string {
  const n = points.length;
  if (n === 0) return "";
  if (n === 1) return `M ${points[0].x} ${points[0].y}`;
  if (n === 2) return `M ${points[0].x} ${points[0].y} L ${points[1].x} ${points[1].y}`;

  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);

  const d: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    const dx = xs[i + 1] - xs[i];
    d.push(dx === 0 ? 0 : (ys[i + 1] - ys[i]) / dx);
  }

  const m: number[] = new Array(n);
  m[0] = d[0];
  m[n - 1] = d[n - 2];
  for (let i = 1; i < n - 1; i++) {
    m[i] = (d[i - 1] === 0 || d[i] === 0 || Math.sign(d[i - 1]) !== Math.sign(d[i])) ? 0 : (d[i - 1] + d[i]) / 2;
  }

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

// ── Pace strip, weighted-instrument variant — same monotone-cubic sparkline
// as production, PLUS an endpoint delta chip stating the gap versus usual
// today, since an axis-less, legend-less, value-less strip communicates
// nothing on its own. The chip states the gap in words that have already
// earned their weight: a small pill, not a second hero figure, and never
// coloured, running ahead of usual is information here, not a warning (the
// notable cards already carry the amber "usual" signifier where it's
// actually earned, DESIGN.md Figures Are Ink rule).
//
// The chip lives in its OWN reserved row above the svg, in normal document
// flow, right-aligned rather than absolutely positioned at the plotted
// point. An earlier pass anchored it with `position: absolute` + a
// translate to sit directly over today's data point; at a real 390px
// viewport that collided with both the gap sentence above the glass-tile
// (the chip could translate up out of the tile's own box) and the plotted
// actual line underneath it (the chip and the line shared the same
// coordinate space). A reserved band can't collide with either: it isn't
// stacked on top of anything, and its height doesn't depend on where the
// data happens to plot. Right-aligned still reads as "the live end of the
// line" — today (`last.day`) is always the series' rightmost x by
// construction — without the collision-prone pixel math. ─────────────────
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
  const delta = hasUsual ? last.actual - lastUsual.usual : null;

  const summary = hasUsual
    ? `Spending pace: ${fmt(last.actual)} so far this period, against a usual pace of ${fmt(lastUsual.usual)}, a gap of ${fmtSigned(delta!)}.`
    : `Spending pace: ${fmt(last.actual)} so far this period. Still learning your usual.`;

  return (
    <div>
      {/* Reserved band for the endpoint delta chip — its own row, in normal
          flow, above the svg. Right-aligned (today is always the series'
          rightmost x) rather than absolutely positioned over the plotted
          point, so it can never overlap the gap sentence above this tile or
          the actual/usual lines below it, regardless of where a given
          fixture's data happens to plot. */}
      <div className="flex justify-end min-h-[18px] mb-1">
        {hasUsual ? (
          <div className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-600">
            <span className="text-[10px] font-bold tabular-nums font-mono text-slate-700 dark:text-slate-200">
              {fmtSigned(delta!)}
            </span>
            <span className="text-[10px] text-slate-500 dark:text-slate-400">vs usual</span>
          </div>
        ) : (
          <span className="text-[10px] text-slate-500 dark:text-slate-400">still learning your usual</span>
        )}
      </div>
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
    </div>
  );
}

export default function WeightedInstrumentHeader({
  verdict, isCurrentPeriod, periodLabel, onSelectOffset, incomeTxns, onTransactionClick, onOutTap, onMovedTap,
}: WeightedHeaderProps) {
  const [incomeExpanded, setIncomeExpanded] = useState(false);

  const { reading, pills, pace_series, moved_total } = verdict;
  const hasStrip = !!pace_series && pace_series.length > 0;
  const hasMoved = moved_total !== undefined;

  // Point 3 — a quiet observation on the relationship between Out and In,
  // computed from figures already on the payload (presentational
  // arithmetic, no new engine field). Never red: a gap between what's gone
  // out and what's come in so far this pay period is completely ordinary
  // (income often lands in one lump near the start), not genuine risk.
  const gap = pills.spent - pills.income;
  const gapLine =
    gap > 0
      ? `${fmt(gap)} more has gone out than come in so far.`
      : gap < 0
        ? `${fmt(Math.abs(gap))} more has come in than gone out so far.`
        : `Out and in are level so far.`;

  return (
    <div className="px-4 pt-6">
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

      <div className="glass-hero rounded-3xl p-4">
        {/* Point 10 — eyebrow reduced to at most one middle dot, "PAY
            PERIOD" prefix dropped as redundant (the whole app knows this is
            Spend's period row). */}
        <div className="flex items-center justify-between gap-2">
          <p className="min-h-[44px] flex items-center text-[11px] font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-400 truncate">
            {periodLabel.toUpperCase()} · DAY {verdict.period.days_elapsed}
          </p>
          <Link
            href="/transactions"
            aria-label="Search transactions"
            className="w-11 h-11 flex items-center justify-center rounded-full glass-tile flex-shrink-0 active:scale-95 transition-transform"
          >
            <Search size={20} className="text-slate-500 dark:text-slate-400" />
          </Link>
        </div>

        {/* The instrument — bordered inset kept (established identity),
            re-ranked inside: OUT leads as the hero figure, IN/MOVED are a
            secondary tier below it rather than three equal cells. */}
        <div className="mt-4 rounded-2xl border border-slate-200/70 dark:border-slate-700/70 p-3">
          <button
            type="button"
            onClick={onOutTap}
            className="w-full min-h-[44px] px-1 py-1 flex flex-col items-start justify-center text-left active:opacity-70 transition-opacity"
          >
            <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-400">Out</span>
            <span className="text-[28px] leading-tight font-bold tabular-nums font-mono text-slate-900 dark:text-slate-100">
              {fmt(pills.spent)}
            </span>
          </button>

          <div className="mt-1 pt-2 flex divide-x divide-slate-200/70 dark:divide-slate-700/70 border-t border-slate-200/70 dark:border-slate-700/70">
            <button
              type="button"
              onClick={() => setIncomeExpanded((v) => !v)}
              aria-expanded={incomeExpanded}
              className="flex-1 min-h-[44px] px-2 py-1 flex flex-col items-start justify-center active:opacity-70 transition-opacity"
            >
              <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-500">In</span>
              <span className="text-sm font-bold tabular-nums font-mono text-slate-700 dark:text-slate-300">{fmt(pills.income)}</span>
            </button>
            {hasMoved && (
              // Point 2 — MOVED keeps its fixture value, loses the emerald
              // treatment: mostly-shuffling money hasn't earned Verified
              // Emerald (DESIGN.md's Red Is Risk sibling rule for green —
              // emerald means genuine good news).
              <button
                type="button"
                onClick={onMovedTap}
                aria-label="Money you moved"
                className="flex-1 min-h-[44px] px-2 py-1 flex flex-col items-start justify-center active:scale-95 transition-transform"
              >
                <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-500">Moved</span>
                <span className="text-sm font-bold tabular-nums font-mono text-slate-700 dark:text-slate-300">{fmt(moved_total!)}</span>
              </button>
            )}
          </div>

          {/* Point 3 — the quiet Out-vs-In observation. */}
          <p className="mt-2 px-1 text-[12px] text-slate-500 dark:text-slate-400">{gapLine}</p>

          {hasStrip && (
            <div className="mt-3 glass-tile rounded-xl p-3">
              <PaceStrip series={pace_series!} />
            </div>
          )}
        </div>

        {/* Point 5 — the reading stays unclamped, a caption under the
            instrument, never truncated (DESIGN.md: verdicts lead). */}
        <p lang="en-GB" className="text-pretty mt-3 text-sm font-normal text-slate-600 dark:text-slate-300">
          <MoneyText text={reading} />
        </p>
      </div>

      {incomeExpanded && <IncomeDrilldown incomeTxns={incomeTxns} onTransactionClick={onTransactionClick} />}
    </div>
  );
}
