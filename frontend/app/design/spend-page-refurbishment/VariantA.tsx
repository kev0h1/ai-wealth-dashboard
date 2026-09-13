"use client";

import { ArrowDown, ArrowRight, ChevronDown, CircleHelp, WalletCards } from "lucide-react";
import { ATTENTION, MOVED_TOTAL, PERIOD, QUIET } from "./data";
import {
  CategoryMark,
  focusRing,
  Money,
  MoneyShape,
  MovementRows,
  PaceBadge,
  PeriodBar,
  PeriodHistory,
  ReconciliationNote,
} from "./shared";

export default function VariantA() {
  return (
    <main className="mx-auto w-full max-w-6xl px-4 pb-20 pt-5 sm:px-6 lg:px-8">
      <PeriodBar />

      <div className="mt-7 grid items-start gap-9 lg:grid-cols-[minmax(260px,0.72fr)_minmax(0,1.45fr)] lg:gap-14">
        <aside className="lg:sticky lg:top-6">
          <h2 className="max-w-md text-balance text-[30px] font-bold leading-[1.05] tracking-[-0.035em] text-slate-950 dark:text-white sm:text-[38px]">
            Your pay period, as it happened
          </h2>
          <p className="mt-4 max-w-md text-pretty text-[15px] leading-6 text-slate-600 dark:text-slate-300">
            You are <Money value={PERIOD.aheadOfUsual} className="font-bold text-slate-900 dark:text-white" /> ahead of your usual spending by day {PERIOD.day}. Bills explain most of the difference.
          </p>

          <dl className="mt-7 grid grid-cols-3 gap-3 border-y border-slate-200 py-4 dark:border-slate-700 lg:grid-cols-1 lg:gap-0 lg:divide-y lg:divide-slate-200 lg:py-0 dark:lg:divide-slate-700">
            <div className="lg:flex lg:items-end lg:justify-between lg:py-4">
              <dt className="text-[10px] font-semibold uppercase tracking-[0.06em] text-slate-600 dark:text-slate-400">In</dt>
              <dd className="mt-1"><Money value={PERIOD.income} className="text-sm font-bold text-slate-900 dark:text-white lg:text-base" /></dd>
            </div>
            <div className="lg:flex lg:items-end lg:justify-between lg:py-4">
              <dt className="text-[10px] font-semibold uppercase tracking-[0.06em] text-slate-600 dark:text-slate-400">Out</dt>
              <dd className="mt-1"><Money value={PERIOD.out} className="text-lg font-bold text-slate-950 dark:text-white lg:text-xl" /></dd>
            </div>
            <div className="lg:flex lg:items-end lg:justify-between lg:py-4">
              <dt className="text-[10px] font-semibold uppercase tracking-[0.06em] text-slate-600 dark:text-slate-400">Moved separately</dt>
              <dd className="mt-1"><Money value={MOVED_TOTAL} className="text-sm font-bold text-slate-900 dark:text-white lg:text-base" /></dd>
            </div>
          </dl>

          <div className="mt-4">
            <ReconciliationNote />
          </div>
        </aside>

        <div aria-label="Pay-period journey" className="relative pl-8 before:absolute before:bottom-3 before:left-[11px] before:top-3 before:w-px before:bg-slate-300 dark:before:bg-slate-600 sm:pl-10">
          <section className="relative pb-10">
            <span className="absolute -left-8 top-1 flex h-6 w-6 items-center justify-center rounded-full bg-indigo-600 text-white ring-4 ring-[#f0f2f7] dark:ring-[#0f172a] sm:-left-10" aria-hidden="true">
              <WalletCards size={12} />
            </span>
            <p className="text-[11px] font-semibold uppercase tracking-[0.06em] text-slate-600 dark:text-slate-400">Pay arrived · 30 Aug</p>
            <p className="mt-2 text-xl font-bold text-slate-950 dark:text-white"><Money value={PERIOD.income} /> recorded coming in</p>
            <p className="mt-1 max-w-2xl text-pretty text-[13px] leading-5 text-slate-600 dark:text-slate-400">Income is evidence for this period, not a claim that every pound of spending came from this pay packet.</p>
          </section>

          <section className="relative pb-10">
            <span className="absolute -left-8 top-1 h-6 w-6 rounded-full border-[6px] border-amber-400 bg-white ring-4 ring-[#f0f2f7] dark:bg-slate-900 dark:ring-[#0f172a] sm:-left-10" aria-hidden="true" />
            <p className="text-[11px] font-semibold uppercase tracking-[0.06em] text-slate-600 dark:text-slate-400">Today · day {PERIOD.day}</p>
            <div className="mt-2 flex flex-wrap items-baseline justify-between gap-3 border-b border-slate-200 pb-4 dark:border-slate-700">
              <h3 className="text-balance text-2xl font-bold tracking-[-0.025em] text-slate-950 dark:text-white">Three changes explain the pace</h3>
              <Money value={3140} className="text-base font-bold text-slate-900 dark:text-white" />
            </div>

            <div className="divide-y divide-slate-200 dark:divide-slate-700">
              {ATTENTION.map((category, index) => (
                <details key={category.category} open={index === 0} className="group">
                  <summary className={`flex min-h-[76px] cursor-pointer list-none items-center gap-3 py-3 [&::-webkit-details-marker]:hidden active:opacity-70 ${focusRing}`}>
                    <CategoryMark category={category.category} />
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-bold text-slate-900 dark:text-white">{category.category}</span>
                      <span className="mt-0.5 block text-[11px] text-slate-600 dark:text-slate-400">{category.payments} payments</span>
                    </span>
                    <span className="flex shrink-0 flex-col items-end gap-1">
                      <Money value={category.spent} className="text-sm font-bold text-slate-900 dark:text-white" />
                      <PaceBadge category={category} />
                    </span>
                    <ChevronDown size={15} className="shrink-0 text-slate-400 transition-transform duration-200 group-open:rotate-180 motion-reduce:transition-none" aria-hidden="true" />
                  </summary>
                  <div className="mb-4 ml-[50px] border-l border-slate-200 pl-4 dark:border-slate-700">
                    <p className="text-pretty text-[13px] leading-5 text-slate-600 dark:text-slate-300">
                      {category.category} is about {category.paceMultiple?.toFixed(1)}× its usual pace. Biggest: {category.causes?.map((cause, causeIndex) => (
                        <span key={cause.name}>{causeIndex ? " · " : ""}{cause.name} <Money value={cause.amount} /></span>
                      ))}.
                    </p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <button type="button" className={`min-h-11 rounded-xl bg-indigo-600 px-4 text-[13px] font-semibold text-white active:scale-95 ${focusRing}`}>See {category.payments} payments</button>
                      <button type="button" className={`min-h-11 rounded-xl border border-slate-200 bg-white px-4 text-[13px] font-semibold text-slate-700 active:scale-95 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200 ${focusRing}`}>One-off</button>
                      <button type="button" className={`min-h-11 rounded-xl border border-slate-200 bg-white px-4 text-[13px] font-semibold text-slate-700 active:scale-95 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200 ${focusRing}`}>New normal</button>
                    </div>
                  </div>
                </details>
              ))}
            </div>
          </section>

          <section className="relative pb-10">
            <span className="absolute -left-8 top-1 flex h-6 w-6 items-center justify-center rounded-full border border-indigo-300 bg-indigo-50 text-indigo-700 ring-4 ring-[#f0f2f7] dark:border-indigo-400/30 dark:bg-indigo-400/10 dark:text-indigo-300 dark:ring-[#0f172a] sm:-left-10" aria-hidden="true">
              <CircleHelp size={12} />
            </span>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h3 className="text-xl font-bold text-slate-950 dark:text-white">Three payments still need a place</h3>
                <p className="mt-1 text-[13px] text-slate-600 dark:text-slate-400">They are already included in Out, but not in a category.</p>
              </div>
              <Money value={PERIOD.unresolved} className="text-base font-bold text-slate-900 dark:text-white" />
            </div>
            <button type="button" className={`mt-4 inline-flex min-h-11 items-center gap-2 rounded-xl bg-indigo-600 px-4 text-[13px] font-semibold text-white active:scale-95 ${focusRing}`}>
              Place the payments <ArrowRight size={15} aria-hidden="true" />
            </button>
          </section>

          <section className="relative pb-10">
            <span className="absolute -left-8 top-1 h-6 w-6 rounded-full border-[6px] border-slate-300 bg-white ring-4 ring-[#f0f2f7] dark:border-slate-500 dark:bg-slate-900 dark:ring-[#0f172a] sm:-left-10" aria-hidden="true" />
            <div className="flex items-end justify-between gap-3 border-b border-slate-200 pb-3 dark:border-slate-700">
              <div>
                <h3 className="text-xl font-bold text-slate-950 dark:text-white">The rest of your spending</h3>
                <p className="mt-1 text-[12px] text-slate-600 dark:text-slate-400">Eleven quieter categories stay visible without another page tier.</p>
              </div>
              <Money value={1496} className="text-sm font-bold text-slate-900 dark:text-white" />
            </div>
            <div className="grid grid-cols-2 gap-x-5 sm:grid-cols-3">
              {QUIET.map((category) => (
                <button key={category.category} type="button" className={`flex min-h-[62px] items-center gap-2 border-b border-slate-200 py-2 text-left active:opacity-70 dark:border-slate-700 ${focusRing}`}>
                  <CategoryMark category={category.category} size={30} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[12px] font-semibold text-slate-800 dark:text-slate-100">{category.category}</span>
                    <Money value={category.spent} className="text-[11px] text-slate-600 dark:text-slate-400" />
                  </span>
                </button>
              ))}
            </div>
          </section>

          <section className="relative pb-10">
            <span className="absolute -left-8 top-1 flex h-6 w-6 items-center justify-center rounded-full border border-slate-300 bg-white text-slate-600 ring-4 ring-[#f0f2f7] dark:border-slate-600 dark:bg-slate-900 dark:text-slate-300 dark:ring-[#0f172a] sm:-left-10">
              <ArrowDown size={12} aria-hidden="true" />
            </span>
            <div className="flex items-end justify-between gap-3 border-b border-slate-200 pb-3 dark:border-slate-700">
              <div>
                <h3 className="text-xl font-bold text-slate-950 dark:text-white">Money moved on a separate route</h3>
                <p className="mt-1 text-[12px] text-slate-600 dark:text-slate-400">This never counts towards Out.</p>
              </div>
              <Money value={MOVED_TOTAL} className="text-sm font-bold text-slate-900 dark:text-white" />
            </div>
            <MovementRows compact />
          </section>

          <section className="relative pb-10">
            <span className="absolute -left-8 top-1 h-6 w-6 rounded-full border-[6px] border-emerald-400 bg-white ring-4 ring-[#f0f2f7] dark:bg-slate-900 dark:ring-[#0f172a] sm:-left-10" aria-hidden="true" />
            <MoneyShape />
          </section>

          <section className="relative">
            <span className="absolute -left-8 top-1 h-6 w-6 rounded-full border-[6px] border-indigo-400 bg-white ring-4 ring-[#f0f2f7] dark:bg-slate-900 dark:ring-[#0f172a] sm:-left-10" aria-hidden="true" />
            <h3 className="text-xl font-bold text-slate-950 dark:text-white">Across recent pay periods</h3>
            <p className="mt-1 text-[13px] text-slate-600 dark:text-slate-400">Patterns become the final chapter of the same story, not a separate mode.</p>
            <div className="mt-3"><PeriodHistory condensed /></div>
          </section>
        </div>
      </div>
    </main>
  );
}
