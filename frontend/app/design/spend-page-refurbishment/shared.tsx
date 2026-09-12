"use client";

import type { ReactNode } from "react";
import {
  ArrowLeftRight,
  CalendarDays,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CreditCard,
  PiggyBank,
  Search,
  TrendingUp,
} from "lucide-react";
import {
  ATTENTION_CATEGORIES,
  MOVEMENT_ROWS,
  PATTERN_CHANGES,
  PAY_SHAPE,
  QUIET_CATEGORIES,
  SPEND_PERIOD,
  TREND_POINTS,
} from "./fixtures";
import {
  ActionControl,
  AttentionMark,
  CategoryChip,
  Currency,
  formatGbp,
  formatMonth,
  formatPeriod,
  SectionHeading,
  Surface,
} from "./primitives";
import type { PreviewMode, PreviewVariant, PreviewView } from "./SpendPageRefurbishmentClient";

const focusRing = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 focus-visible:ring-offset-[#f0f2f7] dark:focus-visible:ring-offset-slate-900";

export function PeriodToolbar() {
  return (
    <div className="flex min-h-11 items-center justify-between gap-2">
      <div className="flex min-w-0 items-center gap-1">
        <button
          type="button"
          aria-label="Previous pay period"
          className={`flex h-11 w-11 shrink-0 touch-manipulation items-center justify-center rounded-xl text-slate-500 [@media(hover:hover)]:hover:bg-slate-200/70 active:bg-slate-200 dark:text-slate-400 dark:[@media(hover:hover)]:hover:bg-slate-800 ${focusRing}`}
        >
          <ChevronLeft size={16} aria-hidden="true" />
        </button>
        <button
          type="button"
          className={`flex min-h-11 min-w-0 touch-manipulation items-center gap-2 rounded-xl px-2 text-left [@media(hover:hover)]:hover:bg-slate-200/70 active:bg-slate-200 dark:[@media(hover:hover)]:hover:bg-slate-800 ${focusRing}`}
        >
          <CalendarDays size={15} aria-hidden="true" className="shrink-0 text-slate-400" />
          <span className="truncate text-[11px] font-semibold uppercase tracking-[0.05em] text-slate-600 dark:text-slate-300">
            {formatPeriod(SPEND_PERIOD.start, SPEND_PERIOD.end)} · day {SPEND_PERIOD.day}
          </span>
        </button>
      </div>
      <button
        type="button"
        aria-label="Search transactions"
        className={`flex h-11 w-11 shrink-0 touch-manipulation items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500 shadow-sm [@media(hover:hover)]:hover:bg-slate-50 active:scale-95 motion-reduce:active:scale-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:[@media(hover:hover)]:hover:bg-slate-700 ${focusRing}`}
      >
        <Search size={18} aria-hidden="true" />
      </button>
    </div>
  );
}

export function PeriodReading() {
  return <>Running about <Currency value={SPEND_PERIOD.aheadOfUsual} /> ahead of usual, mostly Bills.</>;
}

export function ViewChoice({
  variant,
  view,
  mode,
  treatment = "plain",
}: {
  variant: PreviewVariant;
  view: PreviewView;
  mode: PreviewMode;
  treatment?: "plain" | "segmented" | "compact";
}) {
  const items: { key: PreviewView; label: string }[] = [
    { key: "period", label: "This period" },
    { key: "compare", label: treatment === "segmented" ? "Over time" : "Compare periods" },
  ];
  const frame = treatment === "segmented"
    ? "grid grid-cols-2 gap-1 rounded-2xl bg-slate-200/70 p-1 dark:bg-slate-800/80"
    : "flex flex-wrap items-center gap-1";
  return (
    <nav aria-label="Spend view" className={frame}>
      {items.map((item) => {
        const active = item.key === view;
        return (
          <a
            key={item.key}
            href={`?variant=${variant}&view=${item.key}&mode=${mode}`}
            aria-current={active ? "page" : undefined}
            className={`flex min-h-11 touch-manipulation items-center justify-center rounded-xl px-4 text-[13px] font-semibold transition-[background-color,color,box-shadow] duration-150 motion-reduce:transition-none ${focusRing} ${
              treatment === "segmented"
                ? active
                  ? "bg-white text-slate-900 shadow-sm dark:bg-slate-700 dark:text-white"
                  : "text-slate-600 [@media(hover:hover)]:hover:text-slate-900 dark:text-slate-400 dark:[@media(hover:hover)]:hover:text-white"
                : active
                  ? "bg-slate-900 text-white dark:bg-white dark:text-slate-950"
                  : "text-slate-600 [@media(hover:hover)]:hover:bg-white dark:text-slate-300 dark:[@media(hover:hover)]:hover:bg-slate-800"
            }`}
          >
            {item.label}
          </a>
        );
      })}
    </nav>
  );
}

function PaceLabel({ multiple }: { multiple: number }) {
  if (multiple >= 2) return <AttentionMark>{multiple.toFixed(1)}× usual</AttentionMark>;
  return <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">{multiple.toFixed(1)}× usual</span>;
}

export function AttentionList({ layout = "rows" }: { layout?: "rows" | "cards" }) {
  return (
    <div className={layout === "cards" ? "grid items-start gap-3 xl:grid-cols-3" : "overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-800 dark:shadow-none"}>
      {ATTENTION_CATEGORIES.map((category, index) => (
        <details
          key={category.category}
          open={index === 0}
          className={`group ${layout === "cards" ? "overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-800 dark:shadow-none" : "border-b border-slate-100 last:border-b-0 dark:border-slate-700/70"}`}
        >
          <summary className={`flex min-h-[72px] cursor-pointer list-none touch-manipulation items-center gap-3 px-4 py-3 [-webkit-tap-highlight-color:transparent] [@media(hover:hover)]:hover:bg-slate-50/80 active:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-500 dark:[@media(hover:hover)]:hover:bg-slate-700/30 dark:active:bg-slate-700/50 [&::-webkit-details-marker]:hidden ${layout === "cards" ? "items-start" : ""}`}>
            <CategoryChip category={category.category} size={32} />
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-semibold text-slate-900 dark:text-white">{category.category}</span>
              <span className="mt-0.5 block text-[11px] leading-4 text-slate-500 dark:text-slate-400">
                {category.payments} payments · day {SPEND_PERIOD.day}
              </span>
            </span>
            <span className="flex shrink-0 flex-col items-end gap-1">
              <Currency value={category.spent} className="text-sm font-bold text-slate-950 dark:text-white" />
              <PaceLabel multiple={category.paceMultiple} />
            </span>
            <ChevronDown
              size={15}
              aria-hidden="true"
              className="shrink-0 text-slate-400 transition-transform duration-150 group-open:rotate-180 motion-reduce:transition-none dark:text-slate-500"
            />
          </summary>
          <div className="border-t border-slate-100 px-4 pb-4 pt-3 dark:border-slate-700/70">
            <p className="text-pretty text-[13px] leading-5 text-slate-600 dark:text-slate-300">
              About {category.paceMultiple.toFixed(1)}× your usual pace. Biggest: {category.causes.map((cause, causeIndex) => (
                <span key={cause.name}>{causeIndex > 0 ? " · " : ""}{cause.name} <Currency value={cause.amount} /></span>
              ))}.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <ActionControl tone="primary">See {category.payments} payments</ActionControl>
              <ActionControl>One-off</ActionControl>
              <ActionControl>New normal</ActionControl>
            </div>
          </div>
        </details>
      ))}
    </div>
  );
}

export function QuietCategoryDisclosure({ layout = "rows", defaultOpen = false }: { layout?: "rows" | "tiles"; defaultOpen?: boolean }) {
  const total = QUIET_CATEGORIES.reduce((sum, item) => sum + item.spent, 0);
  return (
    <details open={defaultOpen} className="group overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-800 dark:shadow-none">
      <summary className="flex min-h-[68px] cursor-pointer list-none touch-manipulation items-center gap-3 px-4 py-3 [-webkit-tap-highlight-color:transparent] [@media(hover:hover)]:hover:bg-slate-50/80 active:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-500 dark:[@media(hover:hover)]:hover:bg-slate-700/30 dark:active:bg-slate-700/50 [&::-webkit-details-marker]:hidden">
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-bold text-slate-900 dark:text-white">Other spending</span>
          <span className="mt-0.5 block text-[11px] leading-4 text-slate-500 dark:text-slate-400">11 quieter categories, 1 with nothing yet</span>
        </span>
        <Currency value={total} className="shrink-0 text-sm font-bold text-slate-900 dark:text-white" />
        <ChevronDown size={16} aria-hidden="true" className="shrink-0 text-slate-400 transition-transform duration-150 group-open:rotate-180 motion-reduce:transition-none" />
      </summary>
      <div className={`border-t border-slate-100 p-2 dark:border-slate-700/70 ${layout === "tiles" ? "grid grid-cols-2 gap-2" : "divide-y divide-slate-100 dark:divide-slate-700/70"}`}>
        {QUIET_CATEGORIES.map((category) => (
          <button
            key={category.category}
            type="button"
            className={`flex min-h-11 w-full touch-manipulation items-center gap-2.5 rounded-xl px-2.5 py-2 text-left [@media(hover:hover)]:hover:bg-slate-50 active:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-500 dark:[@media(hover:hover)]:hover:bg-slate-700/40 dark:active:bg-slate-700/60 ${layout === "tiles" ? "border border-slate-100 dark:border-slate-700/70" : ""}`}
          >
            <CategoryChip category={category.category} size={28} />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13px] font-semibold text-slate-800 dark:text-slate-100">{category.category}</span>
              <span className="block text-[10px] text-slate-500 dark:text-slate-400">{category.payments === 0 ? "Nothing yet" : `${category.payments} payment${category.payments === 1 ? "" : "s"}`}</span>
            </span>
            <Currency value={category.spent} className="shrink-0 text-[12px] font-semibold text-slate-800 dark:text-slate-100" />
          </button>
        ))}
      </div>
    </details>
  );
}

const MOVEMENT_ICONS = {
  own_accounts: ArrowLeftRight,
  pots: PiggyBank,
  credit_cards: CreditCard,
  investments: TrendingUp,
} as const;

export function MovementDisclosure({ defaultOpen = false }: { defaultOpen?: boolean }) {
  const total = MOVEMENT_ROWS.reduce((sum, item) => sum + item.amount, 0);
  return (
    <details open={defaultOpen} className="group overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-800 dark:shadow-none">
      <summary className="flex min-h-[72px] cursor-pointer list-none touch-manipulation items-center gap-3 px-4 py-3 [-webkit-tap-highlight-color:transparent] [@media(hover:hover)]:hover:bg-slate-50/80 active:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-500 dark:[@media(hover:hover)]:hover:bg-slate-700/30 dark:active:bg-slate-700/50 [&::-webkit-details-marker]:hidden">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-slate-500 dark:bg-slate-700 dark:text-slate-300">
          <ArrowLeftRight size={16} aria-hidden="true" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-bold text-slate-900 dark:text-white">Money moved, separate from spending</span>
          <span className="mt-0.5 block text-[11px] leading-4 text-slate-500 dark:text-slate-400">Most was between your own accounts</span>
        </span>
        <Currency value={total} className="shrink-0 text-sm font-bold text-slate-800 dark:text-slate-100" />
        <ChevronDown size={16} aria-hidden="true" className="shrink-0 text-slate-400 transition-transform duration-150 group-open:rotate-180 motion-reduce:transition-none" />
      </summary>
      <div className="divide-y divide-slate-100 border-t border-slate-100 px-4 dark:divide-slate-700/70 dark:border-slate-700/70">
        {MOVEMENT_ROWS.map((row) => {
          const Icon = MOVEMENT_ICONS[row.kind];
          return (
            <div key={row.kind} className="flex min-h-11 items-center gap-2.5 py-2">
              <span aria-hidden="true" className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-400 dark:bg-slate-700/70 dark:text-slate-400">
                <Icon size={13} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[13px] font-semibold text-slate-800 dark:text-slate-100">{row.label}</span>
                <span className="block text-[10px] text-slate-500 dark:text-slate-400">{row.payments} transfer{row.payments === 1 ? "" : "s"}</span>
              </span>
              <Currency value={row.amount} className="shrink-0 text-[12px] font-semibold text-slate-800 dark:text-slate-100" />
            </div>
          );
        })}
      </div>
    </details>
  );
}

export function TidyUp() {
  return (
    <Surface>
      <SectionHeading>Needs your input</SectionHeading>
      <div className="divide-y divide-slate-100 dark:divide-slate-700/70">
        <button type="button" className={`flex min-h-[60px] w-full touch-manipulation items-center gap-3 text-left ${focusRing}`}>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-semibold text-slate-900 dark:text-white">Place 3 payments</span>
            <span className="mt-0.5 block text-[11px] text-slate-500 dark:text-slate-400">Not yet included in a category</span>
          </span>
          <Currency value={SPEND_PERIOD.unresolved} className="text-sm font-bold text-slate-900 dark:text-white" />
          <ChevronRight size={15} aria-hidden="true" className="text-slate-400" />
        </button>
        <button type="button" className={`flex min-h-[60px] w-full touch-manipulation items-center gap-3 text-left ${focusRing}`}>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-semibold text-slate-900 dark:text-white">Review 2 transfers</span>
            <span className="mt-0.5 block text-[11px] text-slate-500 dark:text-slate-400">Confirm which accounts are yours</span>
          </span>
          <ChevronRight size={15} aria-hidden="true" className="text-slate-400" />
        </button>
      </div>
    </Surface>
  );
}

const SHAPE_COLOURS: Record<string, string> = {
  fixed: "bg-sky-400",
  moved: "bg-indigo-500",
  free: "bg-emerald-400",
  left: "bg-slate-400",
};

export function PayShapeCard() {
  return (
    <button
      type="button"
      className={`w-full touch-manipulation rounded-2xl border border-slate-200 bg-white p-4 text-left shadow-sm [@media(hover:hover)]:hover:border-slate-300 active:scale-[0.99] motion-reduce:active:scale-100 dark:border-slate-700 dark:bg-slate-800 dark:shadow-none dark:[@media(hover:hover)]:hover:border-slate-600 ${focusRing}`}
    >
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-semibold uppercase tracking-[0.05em] text-slate-500 dark:text-slate-400">How your pay was split</p>
          <div aria-hidden="true" className="mt-2 flex h-2 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-700">
            {PAY_SHAPE.jobs.map((job) => <span key={job.id} className={SHAPE_COLOURS[job.id]} style={{ width: `${job.share}%` }} />)}
          </div>
          <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-4">
            {PAY_SHAPE.jobs.map((job) => (
              <span key={job.id} className="min-w-0">
                <span className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-[0.04em] text-slate-500 dark:text-slate-400">
                  <span aria-hidden="true" className={`h-1.5 w-1.5 shrink-0 rounded-full ${SHAPE_COLOURS[job.id]}`} />
                  <span className="truncate">{job.label}</span>
                </span>
                <span className="mt-0.5 block text-[13px] font-bold text-slate-900 dark:text-white">{job.share}%</span>
              </span>
            ))}
          </div>
        </div>
        <ChevronRight size={16} aria-hidden="true" className="mt-0.5 shrink-0 text-slate-400" />
      </div>
    </button>
  );
}

function TrendChart() {
  const max = 5500;
  const actualPoints = TREND_POINTS.map((point, index) => `${20 + index * 96},${132 - (point.out / max) * 104}`).join(" ");
  const usualPoints = TREND_POINTS.map((point, index) => `${20 + index * 96},${132 - (point.usual / max) * 104}`).join(" ");
  return (
    <figure>
      <div className="flex items-center gap-4 text-[11px] text-slate-500 dark:text-slate-400">
        <span className="inline-flex items-center gap-1.5"><span aria-hidden="true" className="h-0.5 w-4 bg-indigo-600" />Out</span>
        <span className="inline-flex items-center gap-1.5"><span aria-hidden="true" className="h-0.5 w-4 border-t border-dashed border-slate-400" />Usual by this point</span>
      </div>
      <svg role="img" aria-label="Out compared with usual across 6 pay periods" viewBox="0 0 520 155" className="mt-3 h-auto w-full overflow-visible">
        {[0, 1, 2].map((line) => <line key={line} x1="20" y1={38 + line * 42} x2="500" y2={38 + line * 42} className="stroke-slate-200 dark:stroke-slate-700" strokeWidth="1" />)}
        <polyline points={usualPoints} fill="none" className="stroke-slate-400" strokeWidth="2" strokeDasharray="5 5" vectorEffect="non-scaling-stroke" />
        <polyline points={actualPoints} fill="none" className="stroke-indigo-600 dark:stroke-indigo-400" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
        {TREND_POINTS.map((point, index) => (
          <g key={point.periodEnd}>
            <circle cx={20 + index * 96} cy={132 - (point.out / max) * 104} r="4" className="fill-indigo-600 dark:fill-indigo-400" />
            <text x={20 + index * 96} y="151" textAnchor={index === 0 ? "start" : index === TREND_POINTS.length - 1 ? "end" : "middle"} className="fill-slate-500 text-[10px] dark:fill-slate-400">{point.current ? "Now" : formatMonth(point.periodEnd)}</text>
          </g>
        ))}
      </svg>
      <figcaption className="sr-only">Out rose from {formatGbp(TREND_POINTS[0].out)} in {formatMonth(TREND_POINTS[0].periodEnd)} to {formatGbp(SPEND_PERIOD.out)} this period, against {formatGbp(SPEND_PERIOD.usualByDay)} usual by day {SPEND_PERIOD.day}.</figcaption>
    </figure>
  );
}

function PatternFact({ label, value, copy }: { label: string; value: ReactNode; copy: string }) {
  return (
    <Surface>
      <p className="text-[11px] font-semibold uppercase tracking-[0.05em] text-slate-500 dark:text-slate-400">{label}</p>
      <p className="mt-2 text-lg font-bold text-slate-950 dark:text-white">{value}</p>
      <p className="mt-1 text-pretty text-[12px] leading-5 text-slate-500 dark:text-slate-400">{copy}</p>
    </Surface>
  );
}

export function CompareView({ treatment }: { treatment: "brief" | "ledger" | "cockpit" }) {
  const lead = (
    <>
      <PeriodToolbar />
      <div className="mt-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.05em] text-slate-500 dark:text-slate-400">Compared with your usual pace</p>
          <p className="mt-1 text-[30px] font-bold leading-none tracking-[-0.025em] text-slate-950 dark:text-white"><Currency value={SPEND_PERIOD.aheadOfUsual} /></p>
        </div>
        <p className="max-w-sm text-pretty text-[13px] leading-5 text-slate-600 dark:text-slate-300">Higher by day {SPEND_PERIOD.day}, led by Bills. This view compares periods; the money shape analysis stays in its own drill-in.</p>
      </div>
    </>
  );

  if (treatment === "ledger") {
    return (
      <div className="mx-auto max-w-4xl space-y-4">
        <Surface>{lead}</Surface>
        <Surface>
          <SectionHeading>6-period register</SectionHeading>
          <div className="mt-1 divide-y divide-slate-100 dark:divide-slate-700/70">
            {TREND_POINTS.map((point) => (
              <div key={point.periodEnd} className="grid min-h-11 grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-4 py-2 text-[12px]">
                <span className="font-semibold text-slate-800 dark:text-slate-100">{point.current ? "This period" : formatMonth(point.periodEnd)}</span>
                <span className="text-right text-slate-500 dark:text-slate-400"><span className="sr-only">Usual </span><Currency value={point.usual} /></span>
                <span className="min-w-20 text-right font-semibold text-slate-900 dark:text-white"><span className="sr-only">Out </span><Currency value={point.out} /></span>
              </div>
            ))}
          </div>
        </Surface>
        <div className="grid gap-3 md:grid-cols-3">
          <PatternFact label="Largest rise" value={<Currency value={PATTERN_CHANGES.largestIncrease.change} />} copy={`${PATTERN_CHANGES.largestIncrease.category} above its usual pace.`} />
          <PatternFact label="Largest payment" value={<Currency value={PATTERN_CHANGES.largestPayment.amount} />} copy={`${PATTERN_CHANGES.largestPayment.merchant}, in ${PATTERN_CHANGES.largestPayment.category}.`} />
          <PatternFact label="Still to place" value={<Currency value={PATTERN_CHANGES.unresolved.amount} />} copy={`${PATTERN_CHANGES.unresolved.payments} payments need a category.`} />
        </div>
      </div>
    );
  }

  if (treatment === "cockpit") {
    return (
      <div className="mx-auto max-w-5xl">
        <Surface>{lead}</Surface>
        <div className="mt-4 grid items-start gap-4 lg:grid-cols-[minmax(0,1.45fr)_minmax(280px,0.75fr)]">
          <Surface>
            <SectionHeading>Out over time</SectionHeading>
            <div className="mt-3"><TrendChart /></div>
          </Surface>
          <div className="grid gap-3">
            <PatternFact label="Main change" value={PATTERN_CHANGES.largestIncrease.category} copy={`${formatGbp(PATTERN_CHANGES.largestIncrease.change)} above its usual pace.`} />
            <PatternFact label="Review" value={`${PATTERN_CHANGES.unresolved.payments} payments`} copy={`${formatGbp(PATTERN_CHANGES.unresolved.amount)} is not yet placed.`} />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <Surface>{lead}<div className="mt-5"><TrendChart /></div></Surface>
      <div className="grid gap-3 md:grid-cols-3">
        <PatternFact label="Largest rise" value={PATTERN_CHANGES.largestIncrease.category} copy={`${formatGbp(PATTERN_CHANGES.largestIncrease.change)} above its usual pace.`} />
        <PatternFact label="Largest payment" value={<Currency value={PATTERN_CHANGES.largestPayment.amount} />} copy={`${PATTERN_CHANGES.largestPayment.merchant}, ${PATTERN_CHANGES.largestPayment.category}.`} />
        <PatternFact label="To review" value={`${PATTERN_CHANGES.unresolved.payments} payments`} copy={`${formatGbp(PATTERN_CHANGES.unresolved.amount)} is not yet placed.`} />
      </div>
    </div>
  );
}
