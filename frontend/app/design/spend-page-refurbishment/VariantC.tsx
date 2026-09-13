"use client";

// Variant C, Split cockpit. Wide screens use their width for a genuine
// evidence-and-review split. On a phone the same hierarchy collapses into a
// deliberate stack, with Out still the only display-sized figure.

import type { PreviewMode, PreviewView } from "./SpendPageRefurbishmentClient";
import { MOVEMENT_ROWS, SPEND_PERIOD } from "./fixtures";
import { Currency, SectionHeading, Surface } from "./primitives";
import {
  AttentionList,
  CompareView,
  MovementDisclosure,
  PayShapeCard,
  PeriodReading,
  PeriodToolbar,
  QuietCategoryDisclosure,
  TidyUp,
  ViewChoice,
} from "./shared";

export default function VariantC({ view, mode }: { view: PreviewView; mode: PreviewMode }) {
  const movedTotal = MOVEMENT_ROWS.reduce((sum, row) => sum + row.amount, 0);
  return (
    <section aria-label="Variant C, Split cockpit">
      <div className="mx-auto mb-4 flex max-w-5xl flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-base font-bold text-slate-900 dark:text-white">C · Split cockpit</h2>
          <p className="mt-1 max-w-xl text-pretty text-[12px] leading-5 text-slate-500 dark:text-slate-400">Use desktop width for parallel evidence, while the mobile reading order remains verdict, review, then context.</p>
        </div>
        <ViewChoice variant="c" view={view} mode={mode} treatment="compact" />
      </div>

      {view === "compare" ? (
        <CompareView treatment="cockpit" />
      ) : (
        <div className="mx-auto max-w-5xl">
          <PeriodToolbar />
          <div className="mt-3 grid gap-4 lg:grid-cols-[minmax(0,1.35fr)_minmax(300px,0.65fr)]">
            <Surface className="p-5 sm:p-6">
              <p className="text-[11px] font-semibold uppercase tracking-[0.05em] text-slate-500 dark:text-slate-400">Out this period</p>
              <p className="mt-1 text-[30px] font-bold leading-none tracking-[-0.025em] text-slate-950 dark:text-white"><Currency value={SPEND_PERIOD.out} /></p>
              <p className="mt-4 max-w-2xl text-balance text-lg font-bold leading-6 text-slate-900 dark:text-white"><PeriodReading /></p>
              <p className="mt-2 text-[12px] text-slate-500 dark:text-slate-400">Usual by day {SPEND_PERIOD.day}: <Currency value={SPEND_PERIOD.usualByDay} /></p>
            </Surface>
            <Surface>
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-[0.05em] text-slate-500 dark:text-slate-400">In</p>
                <p className="mt-1 text-lg font-bold text-slate-900 dark:text-white"><Currency value={SPEND_PERIOD.in} /></p>
              </div>
              <div className="mt-4 border-t border-slate-100 pt-4 dark:border-slate-700/70">
                <p className="text-[10px] font-semibold uppercase tracking-[0.05em] text-slate-500 dark:text-slate-400">Moved, outside spending</p>
                <p className="mt-1 text-lg font-bold text-slate-800 dark:text-slate-100"><Currency value={movedTotal} /></p>
                <p className="mt-1 text-[11px] leading-4 text-slate-500 dark:text-slate-400">Mostly transfers between your own accounts.</p>
              </div>
            </Surface>
          </div>

          <div className="mt-5">
            <SectionHeading>Worth a look</SectionHeading>
            <AttentionList layout="cards" />
          </div>

          <div className="mt-4 grid items-start gap-4 lg:grid-cols-2">
            <div className="grid gap-3">
              <TidyUp />
              <MovementDisclosure />
              <PayShapeCard />
            </div>
            <QuietCategoryDisclosure layout="tiles" />
          </div>
        </div>
      )}
    </section>
  );
}
