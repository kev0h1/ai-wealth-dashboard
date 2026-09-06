"use client";

// The page hero: overall done/total progress plus three small at-a-glance
// figures (P1 open, blocked, in review) computed from the unfiltered
// board so they always read as the whole picture, not the current filter.

import { headerFigures, type GoLiveItem } from "@/lib/goLive";

export function HeaderHero({ items, done, total }: { items: GoLiveItem[]; done: number; total: number }) {
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  const { p1Open, blocked, inReview } = headerFigures(items);

  return (
    <div className="glass-hero rounded-3xl p-5">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Backlog progress</p>
      <p className="money mt-1 text-3xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
        {done} of {total} done
      </p>
      <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-700">
        <div className="h-full rounded-full bg-indigo-500" style={{ width: `${pct}%` }} />
      </div>
      <div className="mt-4 grid grid-cols-3 gap-3">
        <div>
          <p className="money text-lg font-bold text-amber-700 dark:text-amber-300">{p1Open}</p>
          <p className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">P1 open</p>
        </div>
        <div>
          <p className="money text-lg font-bold text-amber-700 dark:text-amber-300">{blocked}</p>
          <p className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">Blocked</p>
        </div>
        <div>
          <p className="money text-lg font-bold text-indigo-700 dark:text-indigo-300">{inReview}</p>
          <p className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">In review</p>
        </div>
      </div>
    </div>
  );
}
