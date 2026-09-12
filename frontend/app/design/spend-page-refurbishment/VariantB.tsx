"use client";

// Variant B, Reconciled register. The period body becomes one switchable
// register: Review is the useful default, while All categories makes the
// complete 14-row ledger explicit only when the reader asks for it.

import { ChevronRight } from "lucide-react";
import { useSearchParams } from "next/navigation";
import type { PreviewMode, PreviewView } from "./SpendPageRefurbishmentClient";
import { ATTENTION_CATEGORIES, MOVED_TOTAL, QUIET_CATEGORIES, SPEND_PERIOD } from "./fixtures";
import { AttentionMark, CategoryChip, Currency, SectionHeading, Surface } from "./primitives";
import {
  AttentionList,
  CompareView,
  MovementDisclosure,
  PayShapeCard,
  PeriodReading,
  PeriodToolbar,
  TidyUp,
  ViewChoice,
} from "./shared";

type RegisterScope = "review" | "all";

function CategoryRegister({ scope, mode }: { scope: RegisterScope; mode: PreviewMode }) {
  return (
    <div>
      <nav className="mb-3 grid grid-cols-2 gap-1 rounded-2xl bg-slate-200/70 p-1 dark:bg-slate-800/80" aria-label="Category register scope">
        <a
          href={`?variant=b&view=period&mode=${mode}&scope=review`}
          aria-current={scope === "review" ? "page" : undefined}
          className={`flex min-h-11 touch-manipulation items-center justify-center rounded-xl px-3 text-[13px] font-semibold [-webkit-tap-highlight-color:transparent] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${scope === "review" ? "bg-white text-slate-900 shadow-sm dark:bg-slate-700 dark:text-white" : "text-slate-600 [@media(hover:hover)]:hover:text-slate-900 dark:text-slate-400 dark:[@media(hover:hover)]:hover:text-white"}`}
        >
          Review 3
        </a>
        <a
          href={`?variant=b&view=period&mode=${mode}&scope=all`}
          aria-current={scope === "all" ? "page" : undefined}
          className={`flex min-h-11 touch-manipulation items-center justify-center rounded-xl px-3 text-[13px] font-semibold [-webkit-tap-highlight-color:transparent] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${scope === "all" ? "bg-white text-slate-900 shadow-sm dark:bg-slate-700 dark:text-white" : "text-slate-600 [@media(hover:hover)]:hover:text-slate-900 dark:text-slate-400 dark:[@media(hover:hover)]:hover:text-white"}`}
        >
          All 14
        </a>
      </nav>

      {scope === "review" ? (
        <div id="g57-register-review"><AttentionList /></div>
      ) : (
        <div id="g57-register-all" className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-800 dark:shadow-none">
          {[...ATTENTION_CATEGORIES, ...QUIET_CATEGORIES].map((category) => {
            const paceMultiple = "paceMultiple" in category && typeof category.paceMultiple === "number"
              ? category.paceMultiple
              : null;
            return (
              <button
                key={category.category}
                type="button"
                className="flex min-h-[56px] w-full touch-manipulation items-center gap-3 border-b border-slate-100 px-4 py-2 text-left last:border-b-0 [@media(hover:hover)]:hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-500 dark:border-slate-700/70 dark:[@media(hover:hover)]:hover:bg-slate-700/30"
              >
                <CategoryChip category={category.category} size={30} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-semibold text-slate-900 dark:text-white">{category.category}</span>
                  <span className="mt-0.5 block text-[10px] text-slate-500 dark:text-slate-400">
                    {category.payments === 0 ? "Nothing yet" : `${category.payments} payment${category.payments === 1 ? "" : "s"}`}
                  </span>
                </span>
                {paceMultiple != null && paceMultiple >= 2 ? <AttentionMark>{paceMultiple.toFixed(1)}×</AttentionMark> : null}
                <Currency value={category.spent} className="shrink-0 text-[13px] font-bold text-slate-900 dark:text-white" />
                <ChevronRight size={14} aria-hidden="true" className="shrink-0 text-slate-400" />
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default function VariantB({ view, mode }: { view: PreviewView; mode: PreviewMode }) {
  const params = useSearchParams();
  const scope: RegisterScope = params.get("scope") === "all" ? "all" : "review";
  return (
    <section aria-label="Variant B, Reconciled register">
      <div className="mx-auto mb-4 flex max-w-4xl flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-base font-bold text-slate-900 dark:text-white">B · Reconciled register</h2>
          <p className="mt-1 max-w-xl text-pretty text-[12px] leading-5 text-slate-500 dark:text-slate-400">Choose the review queue or the complete category ledger. Nothing else becomes a new tier.</p>
        </div>
        <ViewChoice variant="b" view={view} mode={mode} treatment="segmented" />
      </div>

      {view === "compare" ? (
        <CompareView treatment="ledger" />
      ) : (
        <div className="mx-auto max-w-4xl space-y-4">
          <Surface>
            <PeriodToolbar />
            <div className="mt-5 grid gap-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.05em] text-slate-500 dark:text-slate-400">Out</p>
                <p className="mt-1 text-[30px] font-bold leading-none tracking-[-0.025em] text-slate-950 dark:text-white"><Currency value={SPEND_PERIOD.out} /></p>
                <p className="mt-2 max-w-xl text-pretty text-sm leading-6 text-slate-600 dark:text-slate-300"><PeriodReading /></p>
              </div>
              <div className="flex items-center gap-5 border-t border-slate-100 pt-3 sm:border-l sm:border-t-0 sm:pl-5 sm:pt-0 dark:border-slate-700/70">
                <div><p className="text-[10px] font-semibold uppercase tracking-[0.05em] text-slate-500 dark:text-slate-400">In</p><p className="mt-1 text-sm font-bold"><Currency value={SPEND_PERIOD.in} /></p></div>
                <div><p className="text-[10px] font-semibold uppercase tracking-[0.05em] text-slate-500 dark:text-slate-400">Moved, outside spending</p><p className="mt-1 text-sm font-bold"><Currency value={MOVED_TOTAL} /></p></div>
              </div>
            </div>
          </Surface>

          <MovementDisclosure />

          <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1.35fr)_minmax(280px,0.65fr)]">
            <div>
              <SectionHeading>Category register</SectionHeading>
              <CategoryRegister scope={scope} mode={mode} />
            </div>
            <aside className="grid gap-3" aria-label="Supporting Spend actions">
              <TidyUp />
              <PayShapeCard />
            </aside>
          </div>
        </div>
      )}
    </section>
  );
}
