"use client";

import { ArrowRight, BarChart3, ChartNoAxesCombined } from "lucide-react";
import { PaceCurveWidget, type WidgetData } from "@/components/SpendTrends";
import { DEFAULT_PAY_PERIOD_CONFIG } from "@/lib/payPeriod";
import { PACE_SERIES, PERIOD_HISTORY } from "./data";
import { focusRing, money, Money } from "./shared";

const WIDGET_DATA: WidgetData = {
  periodTxns: [],
  allTxns: [],
  periodStart: new Date("2026-08-30T00:00:00Z"),
  periodEnd: new Date("2026-09-26T00:00:00Z"),
  payPeriodConfig: DEFAULT_PAY_PERIOD_CONFIG,
  colours: {},
  paceSeries: PACE_SERIES.map((point) => ({ ...point })),
};

function PeriodComparisonChart() {
  const maximum = Math.max(...PERIOD_HISTORY.flatMap((period) => [period.out, period.usual]));

  return (
    <ul aria-label="Out compared with usual across six recent pay periods" className="mt-4 space-y-3">
      {PERIOD_HISTORY.map((period) => (
        <li key={period.label}>
          <span className="sr-only">
            {"current" in period && period.current ? "This period" : period.label}: Out {money(period.out)}, usual {money(period.usual)}
          </span>
          <div aria-hidden="true">
            <div className="flex items-baseline justify-between gap-3 text-[11px]">
              <span className="truncate font-medium text-slate-600 dark:text-slate-300">
                {"current" in period && period.current ? "This period" : period.label.slice(0, 6)}
              </span>
              <Money value={period.out} className="font-bold text-slate-900 dark:text-white" />
            </div>
            <div className="relative mt-1 h-2 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-700">
              <span
                className="absolute inset-y-0 left-0 rounded-full bg-indigo-500"
                style={{ width: `${(period.out / maximum) * 100}%` }}
              />
              <span
                className="absolute inset-y-[-2px] w-px bg-slate-700 dark:bg-slate-200"
                style={{ left: `${(period.usual / maximum) * 100}%` }}
              />
            </div>
          </div>
        </li>
      ))}
      <li aria-hidden="true" className="flex flex-wrap gap-x-4 gap-y-1 pt-1 text-[10px] font-medium text-slate-600 dark:text-slate-400">
        <span className="inline-flex items-center gap-1.5"><span className="h-1.5 w-4 rounded-full bg-indigo-500" />Out</span>
        <span className="inline-flex items-center gap-1.5"><span className="h-3 w-px bg-slate-700 dark:bg-slate-200" />Usual</span>
      </li>
    </ul>
  );
}

export default function VariantACharts() {
  return (
    <div>
      <div className="grid gap-3 xl:grid-cols-2">
        <article className="min-w-0 rounded-2xl bg-white p-4 shadow-sm dark:border dark:border-slate-700 dark:bg-slate-800 dark:shadow-none">
          <div className="mb-3 flex items-center gap-2">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600 dark:bg-indigo-400/10 dark:text-indigo-300">
              <ChartNoAxesCombined size={17} aria-hidden="true" />
            </span>
            <div>
              <h4 className="text-sm font-bold text-slate-900 dark:text-white">Spending pace</h4>
              <p className="text-[11px] text-slate-600 dark:text-slate-400">Actual against your learned usual</p>
            </div>
          </div>
          <p className="text-sm leading-snug text-slate-600 dark:text-slate-300">
            Day <span className="font-bold text-slate-900 dark:text-white">13</span>: <Money value={4976} className="font-bold text-slate-900 dark:text-white" /> so far · <Money value={1586} className="font-bold text-slate-900 dark:text-white" /> ahead of usual
          </p>
          <div role="img" aria-label="Cumulative spending pace from day 1 to day 13. Actual spending rose from £410 to £4,976; usual spending rose from £360 to £3,390." className="mt-3">
            <PaceCurveWidget data={WIDGET_DATA} compact />
            <div aria-hidden="true" className="mt-1 flex justify-between px-1 text-[9px] text-slate-500 dark:text-slate-400">
              <span>Day 1</span><span>Day 7</span><span>Day 13</span>
            </div>
          </div>
        </article>

        <article className="min-w-0 rounded-2xl bg-white p-4 shadow-sm dark:border dark:border-slate-700 dark:bg-slate-800 dark:shadow-none">
          <div className="flex items-center gap-2">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600 dark:bg-indigo-400/10 dark:text-indigo-300">
              <BarChart3 size={17} aria-hidden="true" />
            </span>
            <div>
              <h4 className="text-sm font-bold text-slate-900 dark:text-white">Period comparison</h4>
              <p className="text-[11px] text-slate-600 dark:text-slate-400">Out and usual across six pay periods</p>
            </div>
          </div>
          <PeriodComparisonChart />
        </article>
      </div>

      <a
        href="/spend?view=patterns"
        className={`mt-3 flex min-h-14 w-full items-center gap-3 rounded-2xl border border-indigo-200 bg-indigo-50/70 px-4 text-left text-indigo-700 transition-colors hover:border-indigo-300 hover:bg-indigo-100/70 active:scale-[0.99] motion-reduce:transition-none dark:border-indigo-400/25 dark:bg-indigo-400/10 dark:text-indigo-300 dark:hover:border-indigo-400/40 dark:hover:bg-indigo-400/15 ${focusRing}`}
      >
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-indigo-100 dark:bg-indigo-400/15">
          <BarChart3 size={17} aria-hidden="true" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-bold">Open all charts</span>
          <span className="block text-[11px] text-slate-600 dark:text-slate-400">Seven views, including categories, daily spend and payment sizes</span>
        </span>
        <ArrowRight size={17} className="shrink-0" aria-hidden="true" />
      </a>
    </div>
  );
}
