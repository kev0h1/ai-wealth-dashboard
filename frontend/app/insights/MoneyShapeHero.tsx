"use client";

// Insights tab hero, production — Variant A ("one bar", Kevin's pick
// 2026-09-02 from /design/insights-shape's three-variant comparison).
// Replaces the old InsightsHero (kept exported from InsightsPage.tsx for
// the design twin, no longer rendered on the real page — see
// SavingsInsightsSection). Ported from the approved wireframe
// (app/design/insights-full/sections.tsx's TappableHero) onto the real
// GET /money-shape contract instead of static fixtures.
//
// Extended 2026-09-02, Kevin's redirect: "select a pay period and it gives
// the breakdown, or specify an average over a certain number of months, on
// the main card, not additional cards." Retired the separate "Over time"
// block (see git history / the design twin's own header comments for that
// short-lived attempt) in favour of a period/average PICKER built into
// this same hero — the static "YOUR MONEY SHAPE · LAST PAY PERIOD" label
// row becomes a control (prev/next chevrons either side of a tappable
// pill) that drives everything below it: the bar, the four job rows (incl.
// their transaction links), the verdict, and — period mode at index 0
// only — the trend line. A bottom sheet (same glass-sheet primitive as
// SpendHeader.tsx's own PeriodSheet — DESIGN.md: bottom sheets are the
// signature, never a native picker) lists recent periods and available
// averages for direct selection.
//
// Colour semantics are fixed and named nowhere but here: Fixed = slate-600
// (dark: slate-400), Moved = emerald-500, Free = sky-500, Left over =
// slate-200 (dark: slate-700). No red, no amber, no indigo/violet — this
// card is informational, not Penny, so it never borrows a grading or
// advice colour (DESIGN.md: red means genuine risk only, the indigo→violet
// gradient belongs to Penny alone).

import { useState } from "react";
import Link from "next/link";
import { ChevronRight, ChevronLeft, ChevronDown, Check, X } from "lucide-react";
import MoneyText from "@/components/MoneyText";
import { useLockBodyScroll } from "@/lib/useLockBodyScroll";
import { useSheetA11y } from "@/lib/useSheetA11y";
import type { MoneyShape, MoneyShapeJob } from "@/lib/api";

export const JOB_COLOR: Record<MoneyShapeJob["id"], { bg: string; text: string }> = {
  fixed: { bg: "bg-slate-600 dark:bg-slate-400", text: "text-slate-600 dark:text-slate-400" },
  moved: { bg: "bg-emerald-500", text: "text-emerald-500" },
  free: { bg: "bg-sky-500", text: "text-sky-500" },
  left: { bg: "bg-slate-200 dark:bg-slate-700", text: "text-slate-400 dark:text-slate-500" },
};

const JOB_ORDER: MoneyShapeJob["id"][] = ["fixed", "moved", "free", "left"];

// Fallback ONLY — used when a job carries no `categories` (an older
// backend payload predating that field). Kevin's phone feedback
// (2026-09-02): tapping a job row should show the transactions behind it,
// not jump to Planning, so there is deliberately no Planning link left
// here any more (PlanningPage.tsx's own `id="commitments"` anchor still
// exists, just unreferenced from here now — harmless to leave).
const JOB_HREF: Record<MoneyShapeJob["id"], string> = {
  fixed: "/transactions",
  moved: "/penny",
  free: "/spend",
  left: "/",
};

/** Where tapping a job's legend row hands off to. Primary path: the real
 *  transactions behind that job the SELECTED period/average (`categories`
 *  + that entry's own from/to, `label` for the removable filter chip,
 *  `txn_type` when the job carries one — see
 *  app/transactions/TransactionsPage.tsx's `categories`/`from`/`to`/
 *  `label`/`txn_type` query handling). The left/"Left over" job is credits
 *  (what came in), not a spend category, so it gets its own label ("What
 *  came in") instead of the row's own display label. `overspent` (true
 *  only for the "left" job when the selected entry's own `overspent > 0`
 *  — see the "Beyond take-home" row below) is a distinct case: it must NOT
 *  link to income, since there's genuinely nothing left over to show — it
 *  filters on every debit in that entry's range instead, no `categories`,
 *  since the evidence for overspend is the whole outflow, not a category
 *  slice. Falls back to JOB_HREF entirely when the payload has no
 *  `categories` field at all (an older backend predating this feature);
 *  falls back per-job when `categories` is present but empty (the backend
 *  genuinely found nothing to link this period — e.g. "moved" with no
 *  movement-kind categories) rather than build a link with an empty
 *  filter, which the transactions hub would read as "no filter"
 *  (everything), not "nothing"). `range` takes just the two date strings a
 *  period OR an average entry both carry — this file's own view-model, not
 *  MoneyShape["period"] itself, since an average has no `label`. */
function jobHref(job: MoneyShapeJob, range: { start: string; end: string } | null, overspent: boolean): string {
  if (!job.categories) {
    return JOB_HREF[job.id];
  }

  if (job.id === "left" && overspent) {
    const params = new URLSearchParams();
    if (range) {
      params.set("from", range.start);
      params.set("to", range.end);
    }
    params.set("txn_type", "debit");
    params.set("label", "Everything that went out");
    return `/transactions?${params.toString()}`;
  }

  if (job.categories.length === 0) {
    return JOB_HREF[job.id];
  }

  const params = new URLSearchParams();
  for (const category of job.categories) params.append("categories", category);
  if (range) {
    params.set("from", range.start);
    params.set("to", range.end);
  }
  params.set("label", job.id === "left" ? "What came in" : job.label);
  if (job.txn_type) params.set("txn_type", job.txn_type);
  return `/transactions?${params.toString()}`;
}

/** Colour dot identity marker — reused by SavingsInsightsSection's own
 *  per-job group headers below the hero, so the hero's legend and the tip
 *  list's group headers can never drift to a second colour source. */
export function JobDot({ id, className }: { id: MoneyShapeJob["id"]; className?: string }) {
  return <span className={`inline-block rounded-full flex-shrink-0 ${JOB_COLOR[id].bg} ${className ?? "h-2.5 w-2.5"}`} aria-hidden="true" />;
}

function SectionLabel({ children, estimateText }: { children: React.ReactNode; estimateText?: string }) {
  return (
    <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
      {children}
      {estimateText && <span className="normal-case font-normal italic"> · {estimateText}</span>}
    </p>
  );
}

type PeriodEntry = NonNullable<MoneyShape["periods"]>[number];
type AverageEntry = NonNullable<MoneyShape["averages"]>[number];
type Scope = { kind: "period"; index: number } | { kind: "average"; months: AverageEntry["months"] };

/** The one thing the bar/rows/verdict/hrefs below actually read — sourced
 *  from `periods[index]` or `averages.find(...)` when the new payload
 *  fields are present, else straight off `shape`'s own top-level fields
 *  (today's behaviour, unchanged) when they're not — see this file's
 *  `hasControl` gate. */
function currentEntry(
  shape: MoneyShape,
  periods: PeriodEntry[],
  averages: AverageEntry[],
  scope: Scope,
  hasControl: boolean
): { start: string; end: string; take_home: number; overspent: number; jobs: MoneyShapeJob[]; verdict: string | null } {
  if (hasControl) {
    if (scope.kind === "period" && periods.length > 0) {
      const p = periods[Math.min(scope.index, periods.length - 1)];
      return { start: p.start, end: p.end, take_home: p.take_home, overspent: p.overspent, jobs: p.jobs, verdict: p.verdict };
    }
    if (scope.kind === "average") {
      const a = averages.find((x) => x.months === scope.months);
      if (a) return { start: a.start, end: a.end, take_home: a.take_home, overspent: a.overspent, jobs: a.jobs, verdict: a.verdict };
    }
  }
  return {
    start: shape.period?.start ?? "",
    end: shape.period?.end ?? "",
    take_home: shape.take_home,
    overspent: shape.overspent,
    jobs: shape.jobs ?? [],
    verdict: shape.verdict,
  };
}

function pillText(scope: Scope, periods: PeriodEntry[], averages: AverageEntry[]): string {
  if (scope.kind === "period") {
    const p = periods[Math.min(scope.index, Math.max(0, periods.length - 1))];
    if (!p) return "";
    return scope.index === 0 ? `Last pay period · ${p.label}` : `Pay period · ${p.label}`;
  }
  const a = averages.find((x) => x.months === scope.months);
  if (!a) return "";
  return `Average · last ${a.months} months · ${a.period_count} pay period${a.period_count === 1 ? "" : "s"}`;
}

// ── Period/average picker sheet — same glass-sheet primitive and a11y
// contract (useLockBodyScroll + useSheetA11y) as SpendHeader.tsx's own
// PeriodSheet; DESIGN.md calls bottom sheets the signature, never a native
// picker. ─────────────────────────────────────────────────────────────
function PeriodPickerSheet({
  periods,
  averages,
  scope,
  onSelectPeriod,
  onSelectAverage,
  onClose,
}: {
  periods: PeriodEntry[];
  averages: AverageEntry[];
  scope: Scope;
  onSelectPeriod: (index: number) => void;
  onSelectAverage: (months: AverageEntry["months"]) => void;
  onClose: () => void;
}) {
  useLockBodyScroll();
  const panelRef = useSheetA11y<HTMLDivElement>(onClose);
  const visiblePeriods = periods.slice(0, 12);

  return (
    <>
      <div className="fixed inset-0 bg-black/40 z-[65]" onClick={onClose} aria-hidden="true" />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="Pay periods and averages"
        className="fixed bottom-0 left-1/2 -translate-x-1/2 w-full max-w-[430px] glass-sheet rounded-t-3xl z-[70] overflow-y-auto max-h-[80dvh]"
        style={{ paddingBottom: "max(16px, env(safe-area-inset-bottom, 0px))" }}
      >
        <div className="flex items-center justify-between px-4 pt-4 pb-2">
          <p className="text-sm font-bold text-slate-900 dark:text-slate-100">Your money shape</p>
          <button
            onClick={onClose}
            aria-label="Close"
            className="w-11 h-11 -mr-2 flex items-center justify-center rounded-full active:bg-slate-100 dark:active:bg-slate-700/60 transition-colors"
          >
            <X size={18} className="text-slate-500 dark:text-slate-400" />
          </button>
        </div>

        {visiblePeriods.length > 0 && (
          <div className="px-2 pb-2">
            <p className="px-3 pt-1 pb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
              Pay periods
            </p>
            {visiblePeriods.map((p, idx) => {
              const fixedJob = p.jobs.find((j) => j.id === "fixed");
              const selected = scope.kind === "period" && scope.index === idx;
              return (
                <button
                  key={`${p.start}-${p.end}`}
                  type="button"
                  onClick={() => onSelectPeriod(idx)}
                  className="w-full min-h-[44px] flex items-center justify-between gap-2 px-3 rounded-xl active:opacity-70 transition-opacity text-left"
                >
                  <span className="min-w-0">
                    <span className="block text-sm font-medium text-slate-800 dark:text-slate-100 truncate">{p.label}</span>
                    {fixedJob && (
                      <span className="block text-[11px] text-slate-500 dark:text-slate-400">
                        fixed {Math.round(fixedJob.share)}%
                      </span>
                    )}
                  </span>
                  {selected && <Check size={16} className="flex-shrink-0 text-indigo-600 dark:text-indigo-400" aria-hidden="true" />}
                </button>
              );
            })}
          </div>
        )}

        {averages.length > 0 && (
          <div className="px-2 pb-2 border-t border-slate-100 dark:border-slate-700 pt-2">
            <p className="px-3 pt-1 pb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
              Averages
            </p>
            {averages.map((a) => {
              const selected = scope.kind === "average" && scope.months === a.months;
              return (
                <button
                  key={a.months}
                  type="button"
                  onClick={() => onSelectAverage(a.months)}
                  className="w-full min-h-[44px] flex items-center justify-between gap-2 px-3 rounded-xl active:opacity-70 transition-opacity text-left"
                >
                  <span className="text-sm font-medium text-slate-800 dark:text-slate-100">
                    {`Last ${a.months} months · ${a.period_count} pay period${a.period_count === 1 ? "" : "s"}`}
                  </span>
                  {selected && <Check size={16} className="flex-shrink-0 text-indigo-600 dark:text-indigo-400" aria-hidden="true" />}
                </button>
              );
            })}
          </div>
        )}
      </div>
    </>
  );
}

export default function MoneyShapeHero({ shape }: { shape: MoneyShape }) {
  const [scope, setScope] = useState<Scope>({ kind: "period", index: 0 });
  const [sheetOpen, setSheetOpen] = useState(false);

  if (shape.status === "thin") {
    return (
      <section className="glass-hero rounded-3xl p-4" data-tutorial-id="tutorial-insights-hero">
        <SectionLabel>YOUR MONEY SHAPE</SectionLabel>
        <p className="mt-2 text-[15px] leading-relaxed text-slate-700 dark:text-slate-300 text-pretty">
          Your first full pay period will draw this. Nothing to do.
        </p>
      </section>
    );
  }

  const periods = shape.periods ?? [];
  const averages = shape.averages ?? [];
  // Tolerate a payload without `periods`/`averages` (an older backend, or
  // this specific fetch predating the reshape) — render exactly as today,
  // no control, sourced straight off shape's own top-level fields.
  const hasControl = periods.length > 0;

  const entry = currentEntry(shape, periods, averages, scope, hasControl);
  const showTrendLine = hasControl ? scope.kind === "period" && scope.index === 0 : true;
  const atOldest = scope.kind === "period" && scope.index >= periods.length - 1;
  const atNewest = scope.kind === "period" && scope.index <= 0;

  function goPrev() {
    if (scope.kind !== "period") return;
    setScope({ kind: "period", index: Math.min(scope.index + 1, periods.length - 1) });
  }
  function goNext() {
    if (scope.kind !== "period") return;
    setScope({ kind: "period", index: Math.max(scope.index - 1, 0) });
  }

  // Defensive against payload order — the contract doesn't promise
  // fixed/moved/free/left wire order, only that shares sum to 100, so the
  // bar/legend order is pinned here rather than trusting `entry.jobs` as
  // given.
  const orderedJobs = JOB_ORDER
    .map((id) => entry.jobs.find((j) => j.id === id))
    .filter((j): j is MoneyShapeJob => !!j);

  return (
    <section className="glass-hero rounded-3xl p-4" data-tutorial-id="tutorial-insights-hero">
      {hasControl ? (
        <>
          <div className="flex items-center justify-between gap-1">
            {scope.kind === "period" ? (
              <button
                type="button"
                onClick={goPrev}
                disabled={atOldest}
                aria-label="Earlier pay period"
                className="h-10 w-7 flex-shrink-0 flex items-center justify-center active:opacity-60 transition-opacity disabled:opacity-30"
              >
                <ChevronLeft size={16} className="text-slate-500 dark:text-slate-400" />
              </button>
            ) : (
              <span className="w-7 flex-shrink-0" aria-hidden="true" />
            )}

            <button
              type="button"
              onClick={() => setSheetOpen(true)}
              className="min-h-[40px] flex-1 min-w-0 flex items-center justify-center gap-1 px-2 rounded-full active:opacity-70 transition-opacity"
            >
              <span className="text-[13px] font-semibold text-slate-700 dark:text-slate-300 truncate">
                {pillText(scope, periods, averages)}
              </span>
              <ChevronDown size={14} className="flex-shrink-0 text-slate-400 dark:text-slate-500" aria-hidden="true" />
            </button>

            {scope.kind === "period" ? (
              <button
                type="button"
                onClick={goNext}
                disabled={atNewest}
                aria-label="More recent pay period"
                className="h-10 w-7 flex-shrink-0 flex items-center justify-center active:opacity-60 transition-opacity disabled:opacity-30"
              >
                <ChevronRight size={16} className="text-slate-500 dark:text-slate-400" />
              </button>
            ) : (
              <span className="w-7 flex-shrink-0" aria-hidden="true" />
            )}
          </div>
          <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">From your transactions</p>
          {scope.kind === "average" && (
            <p className="mt-3 text-[11px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
              AVERAGE PER PAY PERIOD
            </p>
          )}
        </>
      ) : (
        <SectionLabel estimateText={shape.period ? `${shape.period.label}, from your transactions` : undefined}>
          YOUR MONEY SHAPE · LAST PAY PERIOD
        </SectionLabel>
      )}

      {orderedJobs.length > 0 && (
        <div className="mt-3 flex w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800 h-2">
          {orderedJobs.map((job) => (
            <div key={job.id} className={JOB_COLOR[job.id].bg} style={{ width: `${Math.max(0, job.share)}%` }} aria-hidden="true" />
          ))}
        </div>
      )}

      <div className="mt-3 space-y-1">
        {orderedJobs.map((job) => {
          // Overspent takes over the "Left over" row honestly, rather than
          // showing a 0/negative figure the user's own numbers don't back
          // up — ink colour, never red (DESIGN.md: red means genuine risk
          // only, and this card never grades).
          const overspentHere = job.id === "left" && entry.overspent > 0;
          const label = overspentHere ? "Beyond take-home" : job.label;
          const amount = overspentHere ? entry.overspent : job.amount;
          return (
            <Link
              key={job.id}
              href={jobHref(job, { start: entry.start, end: entry.end }, overspentHere)}
              className="flex min-h-[40px] items-center gap-2.5 -mx-1 px-1 rounded-lg active:scale-[0.98] transition-transform"
            >
              <JobDot id={job.id} />
              <span className="flex-1 min-w-0 text-[13px] font-medium text-slate-700 dark:text-slate-300 truncate">
                {label}
              </span>
              <MoneyText
                text={`£${Math.round(Math.abs(amount)).toLocaleString("en-GB")}`}
                className="text-[14px] font-semibold text-slate-900 dark:text-slate-100 flex-shrink-0"
              />
              <span className="w-9 flex-shrink-0 text-right text-[12px] text-slate-500 dark:text-slate-400">
                {Math.round(job.share)}%
              </span>
              <ChevronRight size={14} className="flex-shrink-0 text-slate-400 dark:text-slate-500" aria-hidden="true" />
            </Link>
          );
        })}
      </div>

      <p className="mt-2 text-[11px] text-slate-500 dark:text-slate-400">Tap a job to see the transactions behind it.</p>

      {entry.verdict && (
        <MoneyText
          text={entry.verdict}
          className="mt-3 block text-[15px] leading-relaxed text-slate-700 dark:text-slate-300 text-pretty"
        />
      )}
      {shape.trend_line && showTrendLine && (
        <p className="mt-2 text-[12px] italic text-slate-500 dark:text-slate-400 text-pretty">{shape.trend_line}</p>
      )}

      {sheetOpen && hasControl && (
        <PeriodPickerSheet
          periods={periods}
          averages={averages}
          scope={scope}
          onSelectPeriod={(index) => { setScope({ kind: "period", index }); setSheetOpen(false); }}
          onSelectAverage={(months) => { setScope({ kind: "average", months }); setSheetOpen(false); }}
          onClose={() => setSheetOpen(false)}
        />
      )}
    </section>
  );
}
