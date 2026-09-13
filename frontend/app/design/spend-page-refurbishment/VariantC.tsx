"use client";

import { useMemo, useRef, useState } from "react";
import { ArrowRight, ChevronRight, CircleHelp } from "lucide-react";
import { ALL_CATEGORIES, ATTENTION, MOVED_TOTAL, PERIOD, QUIET, type SpendCategory } from "./data";
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

type View = "field" | "periods";

const tileClasses: Record<string, string> = {
  Bills: "col-span-2 row-span-2 min-h-[172px] sm:col-span-4 sm:row-span-3 sm:min-h-[260px]",
  "Eating Out": "col-span-1 row-span-2 min-h-[150px] sm:col-span-2 sm:row-span-3",
  Transport: "col-span-1 row-span-2 min-h-[150px] sm:col-span-2 sm:row-span-3",
  Groceries: "col-span-1 min-h-[112px] sm:col-span-2",
  Subscriptions: "col-span-1 min-h-[112px] sm:col-span-2",
  Shopping: "col-span-1 min-h-[104px] sm:col-span-2",
  Travel: "col-span-1 min-h-[104px] sm:col-span-2",
};

function CategoryTile({ category, selected, onSelect }: {
  category: SpendCategory;
  selected: boolean;
  onSelect: () => void;
}) {
  const prominent = category.category === "Bills";
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={`group flex w-full flex-col justify-between rounded-2xl border bg-white p-3 text-left transition-[transform,box-shadow,border-color] duration-200 active:scale-[0.98] motion-reduce:transition-none dark:bg-slate-800 ${tileClasses[category.category] ?? "col-span-1 min-h-[92px] sm:col-span-1"} ${selected ? "border-indigo-500 ring-2 ring-indigo-500/20" : "border-slate-200/80 dark:border-slate-700"} ${focusRing}`}
    >
      <span className="flex items-start justify-between gap-2">
        <CategoryMark category={category.category} size={prominent ? 42 : 32} />
        {category.paceMultiple != null && <PaceBadge category={category} />}
      </span>
      <span className="mt-4 block">
        <span className={`${prominent ? "text-lg" : "text-[13px]"} block font-bold text-slate-950 dark:text-white`}>{category.category}</span>
        <Money value={category.spent} className={`${prominent ? "mt-1 text-[28px]" : "mt-0.5 text-[13px]"} block font-bold leading-none text-slate-950 dark:text-white`} />
        <span className="mt-1 block text-[10px] text-slate-600 dark:text-slate-400">{category.payments ? `${category.payments} payments` : "Nothing yet"}</span>
      </span>
    </button>
  );
}

function FocusPanel({ category }: { category: SpendCategory }) {
  const hasPace = category.paceMultiple != null;
  return (
    <aside aria-live="polite" className="rounded-3xl bg-white p-5 shadow-sm dark:border dark:border-slate-700 dark:bg-slate-800 dark:shadow-none lg:sticky lg:top-5">
      <div className="flex items-start gap-3">
        <CategoryMark category={category.category} size={44} />
        <div className="min-w-0 flex-1">
          <h2 className="text-xl font-bold text-slate-950 dark:text-white">{category.category}</h2>
          <p className="mt-0.5 text-[12px] text-slate-600 dark:text-slate-400">{category.payments ? `${category.payments} payments this period` : "Nothing here this period"}</p>
        </div>
        <Money value={category.spent} className="text-base font-bold text-slate-950 dark:text-white" />
      </div>

      {hasPace ? (
        <>
          <div className="mt-5 border-y border-slate-200 py-4 dark:border-slate-700">
            <PaceBadge category={category} />
            <p className="mt-3 text-pretty text-[13px] leading-5 text-slate-600 dark:text-slate-300">
              About {category.paceMultiple?.toFixed(1)}× your usual pace by day {PERIOD.day}.
              {category.causes?.length ? <> Biggest: {category.causes.map((cause, causeIndex) => <span key={cause.name}>{causeIndex ? " · " : ""}{cause.name} <Money value={cause.amount} /></span>)}.</> : null}
            </p>
          </div>
          <button type="button" className={`mt-3 inline-flex min-h-11 items-center gap-2 text-[13px] font-semibold text-indigo-600 active:opacity-70 dark:text-indigo-400 ${focusRing}`}>
            See the {category.payments} payments <ArrowRight size={14} aria-hidden="true" />
          </button>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <button type="button" className={`min-h-11 rounded-xl bg-indigo-600 px-3 text-[13px] font-semibold text-white active:scale-95 ${focusRing}`}>One-off</button>
            <button type="button" className={`min-h-11 rounded-xl border border-slate-200 px-3 text-[13px] font-semibold text-slate-700 active:scale-95 dark:border-slate-600 dark:text-slate-200 ${focusRing}`}>New normal</button>
          </div>
        </>
      ) : category.spent > 0 ? (
        <div className="mt-5 border-t border-slate-200 pt-4 dark:border-slate-700">
          <p className="text-pretty text-[13px] leading-5 text-slate-600 dark:text-slate-300">This category is close to its usual shape. The detail is here when you want it, without adding another tier to the page.</p>
          <button type="button" className={`mt-3 inline-flex min-h-11 items-center gap-2 text-[13px] font-semibold text-indigo-600 active:opacity-70 dark:text-indigo-400 ${focusRing}`}>See {category.payments} payments <ArrowRight size={14} aria-hidden="true" /></button>
        </div>
      ) : (
        <p className="mt-5 border-t border-slate-200 pt-4 text-[13px] leading-5 text-slate-600 dark:border-slate-700 dark:text-slate-400">No spending is recorded here yet.</p>
      )}
    </aside>
  );
}

export default function VariantC() {
  const [view, setView] = useState<View>("field");
  const [selectedName, setSelectedName] = useState("Bills");
  const mobileFocusRef = useRef<HTMLDivElement>(null);
  const selected = useMemo(
    () => ALL_CATEGORIES.find((category) => category.category === selectedName) ?? ALL_CATEGORIES[0],
    [selectedName],
  );

  const selectCategory = (categoryName: string) => {
    setSelectedName(categoryName);
    window.requestAnimationFrame(() => {
      if (!window.matchMedia("(max-width: 1023px)").matches) return;

      mobileFocusRef.current?.focus({ preventScroll: true });
      mobileFocusRef.current?.scrollIntoView({
        behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
        block: "start",
      });
    });
  };

  return (
    <main className="mx-auto w-full max-w-7xl px-4 pb-20 pt-5 sm:px-6 lg:px-8">
      <PeriodBar
        trailing={(
          <nav aria-label="Spend view" className="grid min-h-11 grid-cols-2 rounded-xl bg-slate-200/70 p-1 dark:bg-slate-800">
            <button type="button" onClick={() => setView("field")} aria-pressed={view === "field"} className={`rounded-lg px-3 text-[12px] font-semibold active:scale-95 ${view === "field" ? "bg-white text-slate-900 shadow-sm dark:bg-slate-700 dark:text-white" : "text-slate-600 dark:text-slate-300"} ${focusRing}`}>Categories</button>
            <button type="button" onClick={() => setView("periods")} aria-pressed={view === "periods"} className={`rounded-lg px-3 text-[12px] font-semibold active:scale-95 ${view === "periods" ? "bg-white text-slate-900 shadow-sm dark:bg-slate-700 dark:text-white" : "text-slate-600 dark:text-slate-300"} ${focusRing}`}>Across periods</button>
          </nav>
        )}
      />

      {view === "field" ? (
        <>
          <section className="mt-7 flex flex-col gap-5 border-b border-slate-200 pb-6 dark:border-slate-700 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <h2 className="max-w-3xl text-balance text-[30px] font-bold leading-[1.08] tracking-[-0.035em] text-slate-950 dark:text-white sm:text-[40px]">
                <Money value={PERIOD.out} /> out, across fourteen categories
              </h2>
              <p className="mt-3 max-w-2xl text-pretty text-[14px] leading-6 text-slate-600 dark:text-slate-300">
                Area shows where the money went. An amber marker appears only on categories at twice their usual pace or more.
              </p>
            </div>
            <div className="max-w-sm lg:text-right"><ReconciliationNote /></div>
          </section>

          <div className="mt-6 grid items-start gap-6 lg:grid-cols-[minmax(0,1.55fr)_minmax(290px,0.62fr)]">
            <section aria-label="Spending by category">
              <div className="grid auto-rows-min grid-cols-2 gap-2 sm:grid-cols-8 sm:gap-3">
                {ATTENTION.map((category) => (
                  <CategoryTile key={category.category} category={category} selected={selectedName === category.category} onSelect={() => selectCategory(category.category)} />
                ))}
              </div>

              <div ref={mobileFocusRef} tabIndex={-1} className="mt-3 scroll-mt-4 rounded-3xl outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-slate-950 lg:hidden">
                <FocusPanel category={selected} />
              </div>

              <div className="mt-3 grid auto-rows-min grid-cols-2 gap-2 sm:grid-cols-8 sm:gap-3">
                {QUIET.map((category) => (
                  <CategoryTile key={category.category} category={category} selected={selectedName === category.category} onSelect={() => selectCategory(category.category)} />
                ))}
                <button type="button" className={`col-span-2 flex min-h-[92px] items-center gap-3 rounded-2xl border border-dashed border-indigo-300 bg-indigo-50/60 p-3 text-left active:scale-[0.99] dark:border-indigo-400/30 dark:bg-indigo-400/10 sm:col-span-3 ${focusRing}`}>
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-indigo-100 text-indigo-700 dark:bg-indigo-400/15 dark:text-indigo-300"><CircleHelp size={16} aria-hidden="true" /></span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[13px] font-bold text-slate-900 dark:text-white">3 payments need a place</span>
                    <span className="mt-0.5 block text-[11px] text-slate-600 dark:text-slate-400">Already included in Out</span>
                  </span>
                  <Money value={PERIOD.unresolved} className="text-[13px] font-bold text-slate-900 dark:text-white" />
                  <ChevronRight size={14} className="text-slate-400" aria-hidden="true" />
                </button>
              </div>
            </section>

            <div className="hidden lg:block">
              <FocusPanel category={selected} />
            </div>
          </div>

          <section className="mt-7 grid gap-5 border-t border-slate-200 pt-7 dark:border-slate-700 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.75fr)]">
            <details className="group" open>
              <summary className={`flex min-h-14 cursor-pointer list-none items-center justify-between gap-4 [&::-webkit-details-marker]:hidden ${focusRing}`}>
                <span>
                  <span className="block text-base font-bold text-slate-900 dark:text-white"><Money value={MOVED_TOTAL} /> moved outside spending</span>
                  <span className="mt-0.5 block text-[12px] text-slate-600 dark:text-slate-400">Mostly between your own accounts</span>
                </span>
                <ChevronRight size={16} className="text-slate-400 transition-transform duration-200 group-open:rotate-90 motion-reduce:transition-none" aria-hidden="true" />
              </summary>
              <div className="border-t border-slate-200 dark:border-slate-700"><MovementRows compact /></div>
            </details>
            <div className="border-t border-slate-200 pt-4 dark:border-slate-700 lg:border-l lg:border-t-0 lg:pl-6 lg:pt-0"><MoneyShape /></div>
          </section>
        </>
      ) : (
        <section className="mt-7 grid items-start gap-7 lg:grid-cols-[minmax(0,0.75fr)_minmax(0,1.25fr)] lg:gap-12">
          <div>
            <h2 className="max-w-xl text-balance text-[30px] font-bold leading-[1.08] tracking-[-0.035em] text-slate-950 dark:text-white sm:text-[40px]">Which changes are becoming a pattern?</h2>
            <p className="mt-4 max-w-xl text-pretty text-[14px] leading-6 text-slate-600 dark:text-slate-300">This view compares pay periods only. Your money&apos;s shape remains a separate drill-in because it answers a different question.</p>
            <div className="mt-6 border-y border-slate-200 py-5 dark:border-slate-700">
              <p className="text-[12px] font-semibold text-slate-600 dark:text-slate-400">Largest change this period</p>
              <div className="mt-2 flex items-end justify-between gap-4">
                <span className="text-xl font-bold text-slate-950 dark:text-white">Bills</span>
                <Money value={1280} className="text-xl font-bold text-slate-950 dark:text-white" />
              </div>
              <p className="mt-1 text-[12px] text-slate-600 dark:text-slate-400">above its usual pace</p>
            </div>
          </div>
          <div className="rounded-3xl bg-white px-5 shadow-sm dark:border dark:border-slate-700 dark:bg-slate-800 dark:shadow-none sm:px-6">
            <PeriodHistory />
          </div>
        </section>
      )}
    </main>
  );
}
