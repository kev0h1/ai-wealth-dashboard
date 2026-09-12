"use client";

// Variant A, Brief first. One dominant verdict is followed by one review
// workspace. The 11-category tail and the independent movement flow are
// available in place without becoming two more always-expanded page tiers.

import type { PreviewMode, PreviewView } from "./SpendPageRefurbishmentClient";
import { MOVED_TOTAL, SPEND_PERIOD } from "./fixtures";
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

export default function VariantA({ view, mode }: { view: PreviewView; mode: PreviewMode }) {
  return (
    <section aria-label="Variant A, Brief first">
      <div className="mx-auto mb-4 flex max-w-5xl flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-base font-bold text-slate-900 dark:text-white">A · Brief first</h2>
          <p className="mt-1 max-w-xl text-pretty text-[12px] leading-5 text-slate-500 dark:text-slate-400">
            Recommended. Answer how spending is going, then separate decisions from quieter evidence.
          </p>
        </div>
        <ViewChoice variant="a" view={view} mode={mode} />
      </div>

      {view === "compare" ? (
        <CompareView treatment="brief" />
      ) : (
        <div className="mx-auto max-w-5xl">
          <Surface className="p-5 sm:p-6">
            <PeriodToolbar />
            <div className="mt-6 grid items-end gap-5 sm:grid-cols-[minmax(0,1fr)_auto]">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.05em] text-slate-500 dark:text-slate-400">Out</p>
                <p className="mt-1 text-[30px] font-bold leading-none tracking-[-0.025em] text-slate-950 dark:text-white">
                  <Currency value={SPEND_PERIOD.out} />
                </p>
                <p className="mt-3 max-w-2xl text-pretty text-sm leading-6 text-slate-600 dark:text-slate-300"><PeriodReading /></p>
              </div>
              <div className="grid grid-cols-2 gap-5 border-t border-slate-100 pt-4 sm:grid-cols-1 sm:border-l sm:border-t-0 sm:pl-6 sm:pt-0 dark:border-slate-700/70">
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-[0.05em] text-slate-500 dark:text-slate-400">In</p>
                  <p className="mt-1 text-sm font-bold text-slate-800 dark:text-slate-100"><Currency value={SPEND_PERIOD.in} /></p>
                </div>
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-[0.05em] text-slate-500 dark:text-slate-400">Moved, outside spending</p>
                  <p className="mt-1 text-sm font-bold text-slate-800 dark:text-slate-100"><Currency value={MOVED_TOTAL} /></p>
                </div>
              </div>
            </div>
          </Surface>

          <div className="mt-4 grid items-start gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(290px,0.75fr)]">
            <div>
              <SectionHeading>Worth a look</SectionHeading>
              <AttentionList />
            </div>
            <aside aria-label="Supporting Spend evidence" className="grid gap-3">
              <TidyUp />
              <MovementDisclosure />
              <QuietCategoryDisclosure />
              <PayShapeCard />
            </aside>
          </div>
        </div>
      )}
    </section>
  );
}
