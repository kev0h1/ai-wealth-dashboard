"use client";

import type { Dispatch, ReactNode, SetStateAction } from "react";
import {
  ArrowDown,
  ArrowRight,
  BarChart3,
  ChevronDown,
  CircleHelp,
  ReceiptText,
  RotateCcw,
  TrendingUp,
  WalletCards,
} from "lucide-react";
import {
  ATTENTION,
  ATTENTION_CHANGE,
  ELSEWHERE_OFFSET,
  MOVED_TOTAL,
  PERIOD,
  QUIET,
} from "./data";
import {
  CategoryMark,
  focusRing,
  Money,
  MoneyShape,
  MovementRows,
  PaceBadge,
  PeriodBar,
  ReconciliationNote,
} from "./shared";
import VariantACharts, { type ChartCollectionState, type ChartPlacement } from "./VariantACharts";

type JourneyTarget = "changes" | "place" | "spending" | "charts";

const sectionFocus =
  "scroll-mt-24 outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-4 focus-visible:ring-offset-[#f0f2f7] dark:focus-visible:ring-offset-[#0f172a]";

function jumpToSection(target: JourneyTarget) {
  const section = document.getElementById(`journey-${target}`);
  if (!section) return;

  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  section.focus({ preventScroll: true });
  section.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "start" });
}

function JumpButton({
  label,
  value,
  target,
  needsLook = false,
  compact = false,
}: {
  label: string;
  value: ReactNode;
  target: JourneyTarget;
  needsLook?: boolean;
  compact?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={() => jumpToSection(target)}
      className={`flex min-h-12 min-w-0 flex-1 flex-col items-start justify-center rounded-xl border border-slate-200 bg-white py-2 text-left shadow-sm transition-colors hover:border-slate-300 hover:bg-slate-50 active:scale-95 motion-reduce:transition-none dark:border-slate-700 dark:bg-slate-800 dark:shadow-none dark:hover:border-slate-600 dark:hover:bg-slate-700 ${compact ? "px-2" : "px-3"} ${focusRing}`}
    >
      <span className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.05em] text-slate-600 dark:text-slate-400">
        {label}
        {needsLook && <span className="h-1.5 w-1.5 rounded-full bg-amber-400" aria-label="Needs a look" />}
      </span>
      <span className="mt-0.5 text-[12px] font-bold text-slate-900 dark:text-white">{value}</span>
    </button>
  );
}

function JourneyJumpStrip({ desktop = false, chartPlacement }: { desktop?: boolean; chartPlacement: ChartPlacement }) {
  return (
    <nav aria-label="Jump through this pay period" className={`grid gap-2 ${desktop ? "grid-cols-2" : "grid-cols-4"}`}>
      <JumpButton label="Changes" value={<><Money value={PERIOD.aheadOfUsual} />{desktop && " ahead"}</>} target="changes" needsLook compact={!desktop} />
      <JumpButton label="Place" value={<>{PERIOD.unresolvedPayments} · <Money value={PERIOD.unresolved} /></>} target="place" compact={!desktop} />
      <JumpButton label="Spending" value={<><Money value={1496} />{desktop && " across 11"}</>} target="spending" compact={!desktop} />
      <JumpButton label="Charts" value={chartPlacement === "here" ? "2 shown" : "Own page"} target="charts" compact={!desktop} />
    </nav>
  );
}

export default function VariantA({ chartPlacement, chartsHref, chartCollection, setChartCollection }: {
  chartPlacement: ChartPlacement;
  chartsHref: string;
  chartCollection: ChartCollectionState;
  setChartCollection: Dispatch<SetStateAction<ChartCollectionState>>;
}) {
  return (
    <main className="mx-auto w-full max-w-6xl px-4 pb-20 pt-5 sm:px-6 lg:px-8">
      <PeriodBar />

      <div className="sticky top-0 z-30 -mx-4 mt-3 border-y border-slate-200/90 bg-[#f0f2f7]/95 px-4 py-2 backdrop-blur-sm dark:border-slate-700/80 dark:bg-[#0f172a]/95 lg:hidden">
        <JourneyJumpStrip chartPlacement={chartPlacement} />
      </div>

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

          <div className="mt-4"><ReconciliationNote /></div>
          <div className="mt-5 hidden lg:block"><JourneyJumpStrip desktop chartPlacement={chartPlacement} /></div>
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

          <section id="journey-changes" tabIndex={-1} className={`relative pb-10 ${sectionFocus}`}>
            <span className="absolute -left-8 top-1 h-6 w-6 rounded-full border-[6px] border-amber-400 bg-white ring-4 ring-[#f0f2f7] dark:bg-slate-900 dark:ring-[#0f172a] sm:-left-10" aria-hidden="true" />
            <p className="text-[11px] font-semibold uppercase tracking-[0.06em] text-slate-600 dark:text-slate-400">Today · day {PERIOD.day}</p>
            <h3 className="mt-2 text-balance text-2xl font-bold tracking-[-0.025em] text-slate-950 dark:text-white">
              What put you <Money value={PERIOD.aheadOfUsual} /> ahead
            </h3>
            <p className="mt-2 text-pretty text-[13px] leading-5 text-slate-600 dark:text-slate-300">
              You have spent <Money value={PERIOD.out} /> by day {PERIOD.day}, against a usual <Money value={PERIOD.usualByDay} />.
            </p>

            <dl className="mt-4 divide-y divide-slate-200 rounded-2xl border border-slate-200 bg-white px-4 shadow-sm dark:divide-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:shadow-none">
              <div className="flex min-h-12 items-center justify-between gap-4 py-2 text-[12px]">
                <dt className="text-slate-600 dark:text-slate-300">More across three categories</dt>
                <dd><Money value={ATTENTION_CHANGE} className="font-bold text-slate-900 dark:text-white" /></dd>
              </div>
              <div className="flex min-h-12 items-center justify-between gap-4 py-2 text-[12px]">
                <dt className="text-slate-600 dark:text-slate-300">Less across everything else</dt>
                <dd><Money value={ELSEWHERE_OFFSET} className="font-bold text-slate-900 dark:text-white" /></dd>
              </div>
              <div className="flex min-h-12 items-center justify-between gap-4 py-2 text-[13px]">
                <dt className="font-bold text-slate-900 dark:text-white">Ahead overall</dt>
                <dd><Money value={PERIOD.aheadOfUsual} className="font-bold text-slate-900 dark:text-white" /></dd>
              </div>
            </dl>

            <div className="mt-4 divide-y divide-slate-200 border-y border-slate-200 dark:divide-slate-700 dark:border-slate-700">
              {ATTENTION.map((category, index) => {
                const usual = category.usualByDay ?? category.spent;
                const difference = category.spent - usual;

                return (
                  <details key={category.category} open={index === 0} className="group">
                    <summary className={`flex min-h-[82px] cursor-pointer list-none items-center gap-3 py-3 transition-colors hover:bg-slate-50/60 motion-reduce:transition-none dark:hover:bg-slate-800/50 [&::-webkit-details-marker]:hidden active:opacity-70 ${focusRing}`}>
                      <CategoryMark category={category.category} />
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-bold text-slate-900 dark:text-white">{category.category}</span>
                        <span className="mt-0.5 block text-[11px] text-slate-600 dark:text-slate-400">
                          {category.payments} payments · <Money value={difference} /> more than usual
                        </span>
                      </span>
                      <span className="flex shrink-0 flex-col items-end gap-1">
                        <Money value={category.spent} className="text-sm font-bold text-slate-900 dark:text-white" />
                        <PaceBadge category={category} />
                      </span>
                      <ChevronDown size={15} className="shrink-0 text-slate-400 transition-transform duration-200 group-open:rotate-180 motion-reduce:transition-none" aria-hidden="true" />
                    </summary>
                    <div className="mb-5 ml-[50px] border-l border-slate-200 pl-4 dark:border-slate-700">
                      <p className="text-pretty text-[13px] leading-5 text-slate-700 dark:text-slate-200">
                        By day {PERIOD.day}, you would usually have spent about <Money value={usual} /> here. This period is <Money value={difference} /> higher.
                      </p>
                      <p className="mt-1 text-pretty text-[12px] leading-5 text-slate-600 dark:text-slate-400">
                        Largest payments this period: {category.causes?.map((cause, causeIndex) => (
                          <span key={cause.name}>{causeIndex ? " · " : ""}{cause.name} <Money value={cause.amount} /></span>
                        ))}.
                      </p>

                      <button type="button" className={`mt-3 flex min-h-11 w-full items-center gap-2 rounded-xl text-left text-[13px] font-semibold text-indigo-600 transition-colors hover:text-indigo-700 active:opacity-70 motion-reduce:transition-none dark:text-indigo-400 dark:hover:text-indigo-300 ${focusRing}`}>
                        <ReceiptText size={16} aria-hidden="true" />
                        Review {category.payments} payments
                        <ArrowRight size={15} className="ml-auto" aria-hidden="true" />
                      </button>

                      <div className="mt-3 border-t border-slate-200 pt-3 dark:border-slate-700">
                        <p className="text-[12px] font-semibold text-slate-700 dark:text-slate-200">Was this a one-off, or the new normal?</p>
                        <div className="mt-2 grid grid-cols-2 gap-2">
                          <button type="button" className={`flex min-h-[68px] flex-col items-start justify-center rounded-xl border border-slate-300 bg-white px-3 text-left transition-colors hover:border-indigo-300 hover:bg-indigo-50/50 active:scale-95 motion-reduce:transition-none dark:border-slate-600 dark:bg-slate-800 dark:hover:border-indigo-400/50 dark:hover:bg-indigo-400/10 ${focusRing}`}>
                            <span className="flex items-center gap-2 text-[13px] font-bold text-slate-800 dark:text-slate-100"><RotateCcw size={15} aria-hidden="true" />One-off</span>
                            <span className="mt-1 text-[10px] leading-4 text-slate-600 dark:text-slate-400">Keep your usual pace</span>
                          </button>
                          <button type="button" className={`flex min-h-[68px] flex-col items-start justify-center rounded-xl border border-slate-300 bg-white px-3 text-left transition-colors hover:border-indigo-300 hover:bg-indigo-50/50 active:scale-95 motion-reduce:transition-none dark:border-slate-600 dark:bg-slate-800 dark:hover:border-indigo-400/50 dark:hover:bg-indigo-400/10 ${focusRing}`}>
                            <span className="flex items-center gap-2 text-[13px] font-bold text-slate-800 dark:text-slate-100"><TrendingUp size={15} aria-hidden="true" />New normal</span>
                            <span className="mt-1 text-[10px] leading-4 text-slate-600 dark:text-slate-400">Review a new usual</span>
                          </button>
                        </div>
                      </div>
                    </div>
                  </details>
                );
              })}
            </div>
          </section>

          <section id="journey-place" tabIndex={-1} className={`relative pb-10 ${sectionFocus}`}>
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
            <button type="button" className={`mt-4 flex min-h-14 w-full items-center gap-3 rounded-2xl bg-indigo-600 px-4 text-left text-white transition-colors hover:bg-indigo-700 active:scale-[0.99] motion-reduce:transition-none ${focusRing}`}>
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white/15"><CircleHelp size={17} aria-hidden="true" /></span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-bold">Place three payments</span>
                <span className="block text-[11px] text-indigo-100"><Money value={PERIOD.unresolved} /> is already counted in Out</span>
              </span>
              <ArrowRight size={17} className="shrink-0" aria-hidden="true" />
            </button>
          </section>

          <section id="journey-spending" tabIndex={-1} className={`relative pb-10 ${sectionFocus}`}>
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
                <button key={category.category} type="button" className={`flex min-h-[62px] items-center gap-2 border-b border-slate-200 py-2 text-left transition-colors hover:bg-slate-50/60 active:opacity-70 motion-reduce:transition-none dark:border-slate-700 dark:hover:bg-slate-800/50 ${focusRing}`}>
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

          <section id="journey-charts" tabIndex={-1} className={`relative ${sectionFocus}`}>
            <span className="absolute -left-8 top-1 flex h-6 w-6 items-center justify-center rounded-full border border-indigo-300 bg-indigo-50 text-indigo-700 ring-4 ring-[#f0f2f7] dark:border-indigo-400/30 dark:bg-indigo-400/10 dark:text-indigo-300 dark:ring-[#0f172a] sm:-left-10" aria-hidden="true">
              <BarChart3 size={12} />
            </span>
            <h3 className="text-xl font-bold text-slate-950 dark:text-white">Your charts</h3>
            <p className="mt-1 max-w-2xl text-pretty text-[13px] leading-5 text-slate-600 dark:text-slate-400">
              {chartPlacement === "here"
                ? "Choose which charts appear in this journey, reorder them, or pin one to Home."
                : "Keep this journey shorter and manage the same chart collection on its own page."}
            </p>
            <div className="mt-4"><VariantACharts placement={chartPlacement} pageHref={chartsHref} collection={chartCollection} setCollection={setChartCollection} /></div>
          </section>
        </div>
      </div>
    </main>
  );
}
