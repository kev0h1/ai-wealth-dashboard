"use client";

// Variant-local copy of the Spend hero header, forked from
// components/SpendHeader.tsx (production untouched) for the "Verdict
// first" art-direction pass (/design/spend-verdict-a).
//
// The diagnosis this rebuild answers: production's three-cell instrument
// (Out | In | Moved) presents three unrelated facts at equal visual weight,
// the emerald Moved figure is the loudest thing on the card despite being
// mostly own-account shuffling, and the one genuinely interesting fact
// (spent more than came in, or vice versa) is never stated. This version:
//
//  1. Leads with a computed net verdict line ("£X more out than in") —
//     presentational arithmetic on pills.spent - pills.income, no new
//     figures, no engine change.
//  2. Demotes Out/In/Moved to a single hairline row of small mono figures,
//     no boxes, no equal-column grid — each stays tappable at >=44px via
//     the same invisible-pseudo-element pattern SpendHeader already uses
//     for the OUT-pill footnote.
//  3. Moved keeps its fixture value but loses the emerald hero treatment —
//     it reads in the same ink tone as Out/In, no longer the brightest
//     figure on the card.
//  4. The pace strip keeps its bordered lit-panel inset but gains an
//     endpoint caption (the gap at today), derived from the last entry of
//     pace_series — the original had no axis, legend, or value.
//  5. The reading stays unclamped (DESIGN.md: verdicts lead, never
//     truncate Penny's verdict).
//  6. The eyebrow drops the redundant "PAY PERIOD" prefix and collapses to
//     one middle dot: "31 JUL → 27 AUG · DAY 27".

import { useState } from "react";
import TransactionRow from "@/components/TransactionRow";
import MoneyText from "@/components/MoneyText";
import type { SpendVerdict, SpendVerdictPaceEntry, Transaction } from "@/lib/api";

const zeroSafe = (v: number) => (Math.abs(v) < 1 ? 0 : v);

const fmt = (n: number) => {
  const v = zeroSafe(n);
  const sign = v < 0 ? "−" : "";
  return `${sign}£${Math.abs(Math.round(v)).toLocaleString("en-GB")}`;
};

function IncomeDrilldownA({ incomeTxns, onTransactionClick }: { incomeTxns: Transaction[]; onTransactionClick: (tx: Transaction) => void }) {
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

// Monotone cubic Hermite interpolation (Fritsch-Carlson) — copied verbatim
// from components/SpendHeader.tsx's own PaceStrip; a pure, self-contained
// function with no dependency on that file. See the original for the full
// rationale (a plain spline can ring past a cumulative-money point, which
// would visually claim money came back).
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

// ── Pace strip — same sparkline as production, plus a legend caption.
// Adjudicated correction: the first pass captioned the endpoint with the
// GAP figure ("£1,301 ahead of usual · day 13"), which sat directly above
// a reading that opens with the identical number and phrasing ("Running
// about £1,301 ahead of usual, mostly Bills.") — the same fact, same
// words, read twice in consecutive lines. DESIGN.md says verdicts lead and
// the reading is Penny's verdict, so the fix keeps the reading untouched
// and changes the caption instead: it now labels what the two LINES mean
// (solid = actual, dotted = usual) and where "today" sits on the strip, so
// the chart becomes legible on its own terms — the reading still owns the
// number. ────────────────────────────────────────────────────────────────
function PaceStripA({ series }: { series: SpendVerdictPaceEntry[] }) {
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

  // Legend, not a restated fact — no currency figure here on purpose, that
  // number belongs to the reading alone. Also dropped the "today: day N"
  // clause a first pass of this fix added: the eyebrow directly above
  // already states "day N" (see the period row), so repeating it here was
  // the same duplication problem one level down. Middle dots are rationed
  // app-wide (the eyebrow itself was cut back to one), so this caption uses
  // parentheses instead of dot-separated clauses, not because dots are
  // forbidden but because zero reads cleaner than three in a row.
  const legendCaption = hasUsual
    ? "Your pace (solid) against usual (dotted)"
    : "Your pace this period (solid). Usual pace still building.";

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
      </svg>
      {/* Legend caption — no MoneyText/mono here, there is no currency
          figure to carry; this is axis labelling, not a money line. */}
      <p className="mt-1.5 text-[11px] text-slate-500 dark:text-slate-400">
        {legendCaption}
      </p>
    </div>
  );
}

export interface VerdictHeaderAProps {
  verdict: SpendVerdict;
  periodLabel: string;
  incomeTxns: Transaction[];
  onTransactionClick: (tx: Transaction) => void;
  onOutTap?: () => void;
  onMovedTap?: () => void;
}

export default function VerdictHeaderA({ verdict, periodLabel, incomeTxns, onTransactionClick, onOutTap, onMovedTap }: VerdictHeaderAProps) {
  const [incomeExpanded, setIncomeExpanded] = useState(false);
  const { reading, pills, period, pace_series, moved_total } = verdict;
  const hasStrip = !!pace_series && pace_series.length > 0;
  const hasMoved = moved_total !== undefined;

  // Presentational arithmetic on figures already in the payload — not an
  // engine change, not a new field. Net > 0: spent more than came in.
  const net = pills.spent - pills.income;
  const netAbs = zeroSafe(Math.abs(net));
  const netFigure = `£${Math.round(netAbs).toLocaleString("en-GB")}`;
  const verdictSentence =
    net > 0
      ? `${netFigure} more out than in`
      : net < 0
        ? `${netFigure} more in than out`
        : "Out matched in, evenly";

  return (
    <div className="px-4 pt-6">
      <div className="glass-hero rounded-3xl p-4">
        {/* Eyebrow — one middle dot, no redundant "PAY PERIOD" prefix. */}
        <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-400 truncate">
          {periodLabel.toUpperCase()} · DAY {period.days_elapsed}
        </p>

        {/* The lead verdict — the card's dominant line. Direction carries
            through wording and weight, never colour: a gap this size is not
            genuine risk (DESIGN.md's Red Is Risk Rule), so red is banned
            here regardless of which way the net runs.
            Size: snapped to DESIGN.md's documented Headline step (20px/700),
            not the brief's "~24px" direction literally — that would invent
            an undocumented tier. Checked against Display (30px) instead:
            the longest realistic lead string across all five fixture
            states is "£4,664 more out than in" (23 characters, the Normal
            and Everything states). At Display 30px bold Figtree, ~23
            characters runs roughly 400px wide; this card's content width
            at a 390px viewport is ~326px (390 - 2×16px page padding -
            2×16px card padding), so Display would wrap the lead line onto
            two lines on the exact states most likely to be shown in review.
            Headline 20px keeps the same 23-character line at roughly
            267px, comfortably one line with margin to spare, so 20px is
            the pick. */}
        <p className="mt-2 text-[20px] font-bold leading-tight text-slate-900 dark:text-slate-100">
          <MoneyText text={verdictSentence} />
        </p>

        {/* Demoted Out / In / Moved — a single hairline row, no boxes, no
            equal-column grid. Each stays tappable at >=44px via the same
            invisible-pseudo-element pattern as the OUT-pill footnote below.
            Moved reads in the same ink tone as Out/In now — it no longer
            wins the "brightest number on the card" contest. */}
        <div className="mt-3 flex items-center gap-4 flex-wrap">
          <button
            type="button"
            onClick={onOutTap}
            className="relative min-h-[44px] flex items-baseline gap-1.5 before:absolute before:-inset-y-3 before:-inset-x-1 before:content-[''] active:opacity-70 transition-opacity"
          >
            <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">Out</span>
            <span className="text-[13px] font-semibold font-mono tabular-nums text-slate-700 dark:text-slate-300">{fmt(pills.spent)}</span>
          </button>
          <span className="h-3 w-px bg-slate-200 dark:bg-slate-700" aria-hidden="true" />
          <button
            type="button"
            onClick={() => setIncomeExpanded((v) => !v)}
            aria-expanded={incomeExpanded}
            className="relative min-h-[44px] flex items-baseline gap-1.5 before:absolute before:-inset-y-3 before:-inset-x-1 before:content-[''] active:opacity-70 transition-opacity"
          >
            <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">In</span>
            <span className="text-[13px] font-semibold font-mono tabular-nums text-slate-700 dark:text-slate-300">{fmt(pills.income)}</span>
          </button>
          {hasMoved && (
            <>
              <span className="h-3 w-px bg-slate-200 dark:bg-slate-700" aria-hidden="true" />
              <button
                type="button"
                onClick={onMovedTap}
                aria-label="Money you moved"
                className="relative min-h-[44px] flex items-baseline gap-1.5 before:absolute before:-inset-y-3 before:-inset-x-1 before:content-[''] active:opacity-70 transition-opacity"
              >
                <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">Moved</span>
                <span className="text-[13px] font-semibold font-mono tabular-nums text-slate-700 dark:text-slate-300">{fmt(moved_total!)}</span>
              </button>
            </>
          )}
        </div>

        {/* Pace strip — kept in its bordered lit-panel inset, now stating
            the gap at today instead of being a mute line. */}
        {hasStrip && (
          <div className="mt-3 rounded-2xl border border-slate-200/70 dark:border-slate-700/70 p-3">
            <div className="glass-tile rounded-xl p-3">
              <PaceStripA series={pace_series!} />
            </div>
          </div>
        )}

        {/* The reading — never clamped, DESIGN.md's "verdicts lead" north
            star. */}
        <p lang="en-GB" className="text-pretty mt-3 text-sm font-normal text-slate-600 dark:text-slate-300">
          <MoneyText text={reading} />
        </p>
      </div>

      {incomeExpanded && <IncomeDrilldownA incomeTxns={incomeTxns} onTransactionClick={onTransactionClick} />}
    </div>
  );
}
