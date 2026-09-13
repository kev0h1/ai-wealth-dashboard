"use client";

import { useRef, useState, type ReactNode } from "react";
import {
  ArrowRight,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  CircleHelp,
  ListFilter,
  Route,
  ScanSearch,
} from "lucide-react";
import { ALL_CATEGORIES, ATTENTION, MOVED_TOTAL, PERIOD } from "./data";
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

type Destination = "review" | "place" | "all" | "moved" | "compare";

const destinations: readonly {
  key: Destination;
  title: string;
  detail: ReactNode;
  icon: typeof Route;
  attention?: boolean;
}[] = [
  { key: "review", title: "Review 3 changes", detail: "Bills, Eating Out and Transport", icon: ScanSearch, attention: true },
  { key: "place", title: "Place 3 payments", detail: <><Money value={PERIOD.unresolved} /> is already in Out</>, icon: CircleHelp },
  { key: "all", title: "Browse all spending", detail: "14 categories, reconciled to Out", icon: ListFilter },
  { key: "moved", title: "Follow money moved", detail: "Separate from spending", icon: Route },
  { key: "compare", title: "Compare pay periods", detail: "See what changed over time", icon: CheckCircle2 },
];

function DestinationButton({ destination, selected, onSelect }: {
  destination: (typeof destinations)[number];
  selected: boolean;
  onSelect: () => void;
}) {
  const Icon = destination.icon;
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={`group flex min-h-[74px] w-full items-center gap-3 border-b border-slate-200 px-1 py-3 text-left last:border-b-0 active:scale-[0.99] dark:border-slate-700 ${focusRing}`}
    >
      <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl transition-colors duration-200 motion-reduce:transition-none ${selected ? "bg-indigo-600 text-white" : "bg-white text-slate-600 dark:bg-slate-800 dark:text-slate-300"}`}>
        <Icon size={18} aria-hidden="true" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2 text-[14px] font-bold text-slate-900 dark:text-white">
          {destination.attention && <span className="h-2 w-2 shrink-0 rounded-full bg-amber-400" aria-label="Needs a look" />}
          {destination.title}
        </span>
        <span className="mt-0.5 block text-[11px] leading-4 text-slate-600 dark:text-slate-400">{destination.detail}</span>
      </span>
      <ArrowRight size={17} aria-hidden="true" className={`shrink-0 transition-transform duration-200 motion-reduce:transition-none ${selected ? "translate-x-1 text-indigo-600 dark:text-indigo-400" : "text-slate-400"}`} />
    </button>
  );
}

export default function VariantB() {
  const [destination, setDestination] = useState<Destination>("review");
  const [focusIndex, setFocusIndex] = useState(0);
  const workspaceRef = useRef<HTMLElement>(null);
  const category = ATTENTION[focusIndex];

  const selectDestination = (nextDestination: Destination) => {
    setDestination(nextDestination);
    window.requestAnimationFrame(() => {
      if (!window.matchMedia("(max-width: 1023px)").matches) return;

      workspaceRef.current?.focus({ preventScroll: true });
      workspaceRef.current?.scrollIntoView({
        behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
        block: "start",
      });
    });
  };

  return (
    <main className="mx-auto w-full max-w-6xl px-4 pb-20 pt-5 sm:px-6 lg:px-8">
      <PeriodBar />

      <section className="mt-7 border-b border-slate-200 pb-7 dark:border-slate-700">
        <p className="max-w-4xl text-balance text-[30px] font-bold leading-[1.08] tracking-[-0.035em] text-slate-950 dark:text-white sm:text-[40px]">
          <span className="mr-3 inline-block h-3 w-3 rounded-full bg-amber-400 align-[0.12em]" aria-hidden="true" />
          Spending is <Money value={PERIOD.aheadOfUsual} /> ahead of usual. Bills explain most of it.
        </p>
        <div className="mt-5 flex flex-wrap items-center gap-x-8 gap-y-3 text-[13px] text-slate-600 dark:text-slate-300">
          <span><span className="mr-2 text-[10px] font-semibold uppercase tracking-[0.06em] text-slate-600 dark:text-slate-400">Out</span><Money value={PERIOD.out} className="font-bold text-slate-900 dark:text-white" /></span>
          <span><span className="mr-2 text-[10px] font-semibold uppercase tracking-[0.06em] text-slate-600 dark:text-slate-400">In</span><Money value={PERIOD.income} className="font-bold text-slate-900 dark:text-white" /></span>
          <span><span className="mr-2 text-[10px] font-semibold uppercase tracking-[0.06em] text-slate-600 dark:text-slate-400">Moved</span><Money value={MOVED_TOTAL} className="font-bold text-slate-900 dark:text-white" /> outside spending</span>
        </div>
      </section>

      <div className="mt-6 grid items-start gap-7 lg:grid-cols-[320px_minmax(0,1fr)] lg:gap-10">
        <nav aria-label="Spend destinations" className="lg:sticky lg:top-5">
          <h2 className="text-sm font-bold text-slate-900 dark:text-white">What do you want to do?</h2>
          <p className="mt-1 text-[12px] leading-5 text-slate-600 dark:text-slate-400">The page shows one useful destination at a time. Every figure keeps a route back to its evidence.</p>
          <div className="mt-3 border-y border-slate-200 dark:border-slate-700">
            {destinations.map((item) => (
              <DestinationButton key={item.key} destination={item} selected={destination === item.key} onSelect={() => selectDestination(item.key)} />
            ))}
          </div>
          <div className="mt-4"><ReconciliationNote /></div>
        </nav>

        <section ref={workspaceRef} tabIndex={-1} aria-live="polite" className="min-w-0 scroll-mt-4 rounded-3xl bg-white p-5 shadow-sm outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 dark:border dark:border-slate-700 dark:bg-slate-800 dark:shadow-none dark:focus-visible:ring-offset-slate-950 sm:p-7">
          {destination === "review" && (
            <div>
              <div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-200 pb-5 dark:border-slate-700">
                <div>
                  <p className="text-[12px] font-semibold text-slate-600 dark:text-slate-400">Change {focusIndex + 1} of {ATTENTION.length}</p>
                  <h2 className="mt-1 text-balance text-2xl font-bold tracking-[-0.025em] text-slate-950 dark:text-white">Is this a one-off, or your new normal?</h2>
                </div>
                <div className="flex gap-2">
                  <button type="button" disabled={focusIndex === 0} onClick={() => setFocusIndex((index) => Math.max(0, index - 1))} aria-label="Previous change" className={`flex min-h-11 min-w-11 items-center justify-center rounded-xl border border-slate-200 text-slate-600 disabled:opacity-30 dark:border-slate-600 dark:text-slate-300 ${focusRing}`}><ChevronLeft size={17} /></button>
                  <button type="button" disabled={focusIndex === ATTENTION.length - 1} onClick={() => setFocusIndex((index) => Math.min(ATTENTION.length - 1, index + 1))} aria-label="Next change" className={`flex min-h-11 min-w-11 items-center justify-center rounded-xl border border-slate-200 text-slate-600 disabled:opacity-30 dark:border-slate-600 dark:text-slate-300 ${focusRing}`}><ChevronRight size={17} /></button>
                </div>
              </div>

              <div className="py-7 sm:grid sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start sm:gap-8">
                <div className="flex items-start gap-4">
                  <CategoryMark category={category.category} size={48} />
                  <div>
                    <h3 className="text-xl font-bold text-slate-950 dark:text-white">{category.category}</h3>
                    <p className="mt-1 text-[13px] leading-5 text-slate-600 dark:text-slate-400">{category.payments} payments by day {PERIOD.day}</p>
                  </div>
                </div>
                <div className="mt-5 flex flex-col items-start gap-2 sm:mt-0 sm:items-end">
                  <Money value={category.spent} className="text-[24px] font-bold leading-none text-slate-950 dark:text-white" />
                  <PaceBadge category={category} />
                </div>
              </div>

              <div className="border-y border-slate-200 py-5 dark:border-slate-700">
                <p className="text-pretty text-[14px] leading-6 text-slate-700 dark:text-slate-200">
                  About {category.paceMultiple?.toFixed(1)}× your usual pace. Biggest: {category.causes?.map((cause, causeIndex) => (
                    <span key={cause.name}>{causeIndex ? " · " : ""}{cause.name} <Money value={cause.amount} /></span>
                  ))}.
                </p>
                <button type="button" className={`mt-2 inline-flex min-h-11 items-center gap-2 text-[13px] font-semibold text-indigo-600 active:opacity-70 dark:text-indigo-400 ${focusRing}`}>
                  See the {category.payments} payments <ArrowRight size={14} aria-hidden="true" />
                </button>
              </div>

              <div className="mt-5 grid gap-3 sm:grid-cols-2">
                <button type="button" className={`min-h-12 rounded-xl bg-indigo-600 px-4 text-[14px] font-semibold text-white active:scale-95 ${focusRing}`}>One-off</button>
                <button type="button" className={`min-h-12 rounded-xl border border-slate-200 px-4 text-[14px] font-semibold text-slate-800 active:scale-95 dark:border-slate-600 dark:text-slate-100 ${focusRing}`}>New normal</button>
              </div>
            </div>
          )}

          {destination === "place" && (
            <div>
              <p className="text-[12px] font-semibold text-slate-600 dark:text-slate-400">Keep Out accurate</p>
              <h2 className="mt-1 text-balance text-2xl font-bold tracking-[-0.025em] text-slate-950 dark:text-white">Three payments need a category</h2>
              <p className="mt-3 max-w-2xl text-pretty text-[14px] leading-6 text-slate-600 dark:text-slate-300">They total <Money value={PERIOD.unresolved} className="font-bold text-slate-900 dark:text-white" /> and are already included in Out. Placing them changes the category picture, not the total.</p>
              <button type="button" className={`mt-6 min-h-12 rounded-xl bg-indigo-600 px-5 text-[14px] font-semibold text-white active:scale-95 ${focusRing}`}>Place the first payment</button>
            </div>
          )}

          {destination === "all" && (
            <div>
              <p className="text-[12px] font-semibold text-slate-600 dark:text-slate-400">Complete evidence</p>
              <h2 className="mt-1 text-balance text-2xl font-bold tracking-[-0.025em] text-slate-950 dark:text-white">All spending, one register</h2>
              <div className="mt-5 divide-y divide-slate-200 dark:divide-slate-700">
                {ALL_CATEGORIES.map((item) => (
                  <button key={item.category} type="button" className={`flex min-h-[62px] w-full items-center gap-3 py-2 text-left active:opacity-70 ${focusRing}`}>
                    <CategoryMark category={item.category} size={32} />
                    <span className="min-w-0 flex-1">
                      <span className="block text-[13px] font-semibold text-slate-900 dark:text-white">{item.category}</span>
                      <span className="block text-[11px] text-slate-600 dark:text-slate-400">{item.payments ? `${item.payments} payments` : "Nothing yet"}</span>
                    </span>
                    {item.paceMultiple != null && <PaceBadge category={item} />}
                    <Money value={item.spent} className="shrink-0 text-[13px] font-bold text-slate-900 dark:text-white" />
                    <ChevronRight size={14} className="shrink-0 text-slate-400" aria-hidden="true" />
                  </button>
                ))}
              </div>
              <div className="mt-5 border-t border-slate-200 pt-5 dark:border-slate-700"><MoneyShape quiet /></div>
            </div>
          )}

          {destination === "moved" && (
            <div>
              <p className="text-[12px] font-semibold text-slate-600 dark:text-slate-400">Separate money route</p>
              <h2 className="mt-1 text-balance text-2xl font-bold tracking-[-0.025em] text-slate-950 dark:text-white"><Money value={MOVED_TOTAL} /> moved outside spending</h2>
              <p className="mt-3 max-w-2xl text-pretty text-[14px] leading-6 text-slate-600 dark:text-slate-300">Most of this moved between your own accounts. It is shown neutrally and never counted in Out.</p>
              <div className="mt-5 border-y border-slate-200 dark:border-slate-700"><MovementRows /></div>
            </div>
          )}

          {destination === "compare" && (
            <div>
              <p className="text-[12px] font-semibold text-slate-600 dark:text-slate-400">Across pay periods</p>
              <h2 className="mt-1 text-balance text-2xl font-bold tracking-[-0.025em] text-slate-950 dark:text-white">The change, without another dashboard</h2>
              <p className="mt-3 max-w-2xl text-pretty text-[14px] leading-6 text-slate-600 dark:text-slate-300">Recent periods stay a destination in the same page. Bills are the largest rise this time, up <Money value={1280} /> against their usual pace.</p>
              <div className="mt-5 border-y border-slate-200 dark:border-slate-700"><PeriodHistory /></div>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
