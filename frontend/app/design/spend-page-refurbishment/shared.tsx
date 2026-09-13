"use client";

import type { ReactNode } from "react";
import {
  ArrowLeftRight,
  ChevronLeft,
  ChevronRight,
  CreditCard,
  Landmark,
  PiggyBank,
  SlidersHorizontal,
  TrendingUp,
} from "lucide-react";
import { getCategoryIcon } from "@/lib/categoryIcons";
import {
  CATEGORY_COLOURS,
  MOVEMENT,
  MOVED_TOTAL,
  PAY_SHAPE,
  PERIOD,
  PERIOD_HISTORY,
  type SpendCategory,
} from "./data";

export type PreviewMode = "light" | "dark";
export type PreviewVariant = "a" | "b" | "c";

export const focusRing =
  "touch-manipulation scroll-mb-24 [-webkit-tap-highlight-color:transparent] [@media(hover:hover)]:hover:brightness-[0.97] dark:[@media(hover:hover)]:hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 focus-visible:ring-offset-[#f0f2f7] dark:focus-visible:ring-offset-[#0f172a]";

const gbp = new Intl.NumberFormat("en-GB", {
  style: "currency",
  currency: "GBP",
  maximumFractionDigits: 0,
});

export function money(value: number): string {
  return gbp.format(Math.round(value));
}

export function Money({ value, className = "" }: { value: number; className?: string }) {
  return <span className={`font-mono tabular-nums ${className}`}>{money(value)}</span>;
}

export function CategoryMark({ category, size = 38 }: { category: string; size?: number }) {
  const colour = CATEGORY_COLOURS[category] ?? "#94a3b8";
  const Icon = getCategoryIcon(category);
  return (
    <span
      aria-hidden="true"
      className="flex shrink-0 items-center justify-center rounded-xl"
      style={{ width: size, height: size, color: colour, backgroundColor: `${colour}26` }}
    >
      <Icon size={size >= 38 ? 17 : 14} strokeWidth={2} />
    </span>
  );
}

export function PaceBadge({ category }: { category: SpendCategory }) {
  if (category.paceMultiple == null) return null;
  const watch = category.paceMultiple >= 2;
  return (
    <span
      className={`inline-flex min-h-6 items-center rounded-full px-2 text-[11px] font-semibold ${
        watch
          ? "border border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-300/20 dark:bg-amber-300/10 dark:text-amber-200"
          : "bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300"
      }`}
    >
      {category.paceMultiple.toFixed(1)}× usual
    </span>
  );
}

export function PeriodBar({ trailing }: { trailing?: ReactNode }) {
  return (
    <header className="flex flex-wrap items-center gap-x-4 gap-y-3 border-b border-slate-200/90 pb-4 dark:border-slate-700/80">
      <div className="mr-auto">
        <h1 className="text-balance text-[28px] font-bold leading-none tracking-[-0.03em] text-slate-950 dark:text-white">
          Spend
        </h1>
        <p className="mt-1 text-[13px] text-slate-600 dark:text-slate-400">Day {PERIOD.day} of {PERIOD.daysInPeriod}</p>
      </div>
      <nav aria-label="Pay period" className="flex min-h-11 items-center rounded-xl border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-800">
        <button type="button" aria-label="Previous pay period" className={`flex min-h-11 min-w-11 items-center justify-center rounded-l-xl active:scale-95 ${focusRing}`}>
          <ChevronLeft size={17} aria-hidden="true" />
        </button>
        <button type="button" className={`min-h-11 border-x border-slate-200 px-3 text-[13px] font-semibold text-slate-800 active:scale-[0.98] dark:border-slate-700 dark:text-slate-100 ${focusRing}`}>
          {PERIOD.start} to {PERIOD.end}
        </button>
        <button type="button" aria-label="Next pay period" disabled className="flex min-h-11 min-w-11 items-center justify-center rounded-r-xl text-slate-300 disabled:cursor-not-allowed dark:text-slate-600">
          <ChevronRight size={17} aria-hidden="true" />
        </button>
      </nav>
      <button type="button" aria-label="Spend settings" className={`flex min-h-11 min-w-11 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-600 active:scale-95 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 ${focusRing}`}>
        <SlidersHorizontal size={17} aria-hidden="true" />
      </button>
      {trailing}
    </header>
  );
}

const movementIcons = {
  own_accounts: ArrowLeftRight,
  pots: PiggyBank,
  credit_cards: CreditCard,
  investments: TrendingUp,
} as const;

export function MovementRows({ compact = false }: { compact?: boolean }) {
  return (
    <div className="divide-y divide-slate-200/80 dark:divide-slate-700/70">
      {MOVEMENT.map((row) => {
        const Icon = movementIcons[row.kind];
        return (
          <button
            key={row.kind}
            type="button"
            className={`flex min-h-14 w-full items-center gap-3 py-2 text-left active:opacity-70 ${focusRing}`}
          >
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300">
              <Icon size={15} aria-hidden="true" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[13px] font-semibold text-slate-800 dark:text-slate-100">{row.label}</span>
              {!compact && <span className="block text-[11px] text-slate-600 dark:text-slate-400">{row.payments} transfers</span>}
            </span>
            <Money value={row.amount} className="text-[13px] font-semibold text-slate-900 dark:text-white" />
            <ChevronRight size={14} className="text-slate-400" aria-hidden="true" />
          </button>
        );
      })}
    </div>
  );
}

export function MoneyShape({ quiet = false }: { quiet?: boolean }) {
  return (
    <button type="button" className={`w-full text-left active:scale-[0.99] ${focusRing}`}>
      <span className="flex items-start justify-between gap-4">
        <span>
          <span className="block text-sm font-bold text-slate-900 dark:text-white">How your pay was split</span>
          <span className="mt-1 block max-w-xl text-[12px] leading-5 text-slate-600 dark:text-slate-400">
            Of every <Money value={100} /> you take home, <Money value={47} /> was spoken for before you chose anything.
          </span>
        </span>
        <ChevronRight size={16} className="mt-0.5 shrink-0 text-slate-400" aria-hidden="true" />
      </span>
      {!quiet && (
        <>
          <span className="mt-4 flex h-2 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-700" aria-hidden="true">
            {PAY_SHAPE.jobs.map((job) => <span key={job.id} style={{ width: `${job.share}%`, backgroundColor: job.colour }} />)}
          </span>
          <span className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-4">
            {PAY_SHAPE.jobs.map((job) => (
              <span key={job.id}>
                <span className="block text-[10px] font-semibold uppercase tracking-[0.05em] text-slate-600 dark:text-slate-400">{job.label}</span>
                <span className="mt-0.5 block text-[13px] font-bold text-slate-900 dark:text-white">{job.share}%</span>
              </span>
            ))}
          </span>
        </>
      )}
    </button>
  );
}

export function PeriodHistory({ condensed = false }: { condensed?: boolean }) {
  return (
    <div className="divide-y divide-slate-200/80 dark:divide-slate-700/70">
      {PERIOD_HISTORY.map((row) => {
        const difference = row.out - row.usual;
        const isCurrent = "current" in row && row.current === true;
        return (
          <div key={row.label} className={`grid min-h-14 grid-cols-[minmax(0,1fr)_auto] items-center gap-4 py-2 ${condensed && !isCurrent ? "opacity-75" : ""}`}>
            <span>
              <span className="block text-[13px] font-semibold text-slate-800 dark:text-slate-100">{isCurrent ? "This period" : row.label}</span>
              <span className="block text-[11px] text-slate-600 dark:text-slate-400">
                <Money value={Math.abs(difference)} /> {difference > 0 ? "above usual" : "below usual"}
              </span>
            </span>
            <Money value={row.out} className="text-sm font-bold text-slate-900 dark:text-white" />
          </div>
        );
      })}
    </div>
  );
}

export function ReconciliationNote() {
  return (
    <p className="text-pretty text-[11px] leading-5 text-slate-600 dark:text-slate-400">
      <Money value={3140} /> needing a look + <Money value={1496} /> across the rest + <Money value={PERIOD.unresolved} /> unplaced = <Money value={PERIOD.out} /> out.
    </p>
  );
}

export function MovementSummary() {
  return (
    <span className="flex items-center gap-3">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300">
        <Landmark size={16} aria-hidden="true" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-bold text-slate-900 dark:text-white">Money moved outside spending</span>
        <span className="block text-[11px] text-slate-600 dark:text-slate-400">Mostly between your own accounts</span>
      </span>
      <Money value={MOVED_TOTAL} className="text-sm font-bold text-slate-900 dark:text-white" />
    </span>
  );
}
