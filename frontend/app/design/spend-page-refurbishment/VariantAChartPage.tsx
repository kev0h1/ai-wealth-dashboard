"use client";

import type { Dispatch, SetStateAction } from "react";
import Link from "next/link";
import { ArrowLeft, CalendarDays, ChartNoAxesCombined, Home, LayoutList } from "lucide-react";
import { ChartManagerPreview, type ChartCollectionState } from "./VariantACharts";
import { focusRing } from "./shared";

export default function VariantAChartPage({ backHref, collection, setCollection }: {
  backHref: string;
  collection: ChartCollectionState;
  setCollection: Dispatch<SetStateAction<ChartCollectionState>>;
}) {
  return (
    <main className="mx-auto w-full max-w-5xl px-4 pb-24 pt-5 sm:px-6 lg:px-8">
      <header className="border-b border-slate-200 pb-5 dark:border-slate-700">
        <Link href={backHref} className={`inline-flex min-h-11 items-center gap-2 rounded-xl pr-3 text-sm font-bold text-indigo-700 transition-colors hover:bg-indigo-50 active:scale-95 motion-reduce:transition-none dark:text-indigo-300 dark:hover:bg-indigo-400/10 ${focusRing}`}>
          <span className="flex h-10 w-10 items-center justify-center"><ArrowLeft size={18} aria-hidden="true" /></span>
          Back to Spend
        </Link>
        <div className="mt-4 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-balance text-[30px] font-bold leading-tight tracking-[-0.03em] text-slate-950 dark:text-white">Your charts</h1>
            <p className="mt-1 max-w-xl text-pretty text-sm leading-6 text-slate-600 dark:text-slate-300">Choose what appears, change the order, or pin one chart to Home.</p>
          </div>
          <div className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 shadow-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:shadow-none">
            <CalendarDays size={15} className="text-slate-500 dark:text-slate-400" aria-hidden="true" />
            30 Aug to 26 Sep
          </div>
        </div>
      </header>

      <div className="mt-6 grid items-start gap-7 lg:grid-cols-[minmax(220px,0.62fr)_minmax(0,1.4fr)] lg:gap-10">
        <aside className="lg:sticky lg:top-6">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600 dark:bg-indigo-400/10 dark:text-indigo-300"><ChartNoAxesCombined size={19} aria-hidden="true" /></div>
          <h2 className="mt-4 text-balance text-xl font-bold text-slate-950 dark:text-white">One view, arranged by you</h2>
          <p className="mt-2 text-pretty text-sm leading-6 text-slate-600 dark:text-slate-300">The same chart choices and Home pin remain available; only their location changes.</p>
          <dl className="mt-5 divide-y divide-slate-200 border-y border-slate-200 text-xs dark:divide-slate-700 dark:border-slate-700">
            <div className="flex min-h-12 items-center justify-between gap-3">
              <dt className="flex items-center gap-2 text-slate-600 dark:text-slate-400"><LayoutList size={14} aria-hidden="true" /> Catalogue</dt>
              <dd className="font-bold tabular-nums text-slate-900 dark:text-white">7 charts</dd>
            </div>
            <div className="flex min-h-12 items-center justify-between gap-3">
              <dt className="flex items-center gap-2 text-slate-600 dark:text-slate-400"><Home size={14} aria-hidden="true" /> Home capacity</dt>
              <dd className="font-bold text-slate-900 dark:text-white">1 chart</dd>
            </div>
          </dl>
        </aside>

        <section aria-labelledby="chart-workspace-title" className="min-w-0">
          <div className="mb-4">
            <h2 id="chart-workspace-title" className="text-xl font-bold text-slate-950 dark:text-white">Shown charts</h2>
            <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">Changes save to your chart view and Home.</p>
          </div>
          <ChartManagerPreview collection={collection} setCollection={setCollection} headingLevel={3} />
        </section>
      </div>
    </main>
  );
}
