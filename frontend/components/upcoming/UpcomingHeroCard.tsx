"use client";

import { ChevronDown } from "lucide-react";

// Shared production/preview runway. G176 keeps the existing headline,
// calculation and payments caveat, with account-specific evidence now in
// the separate By account card. None of its figures are computed here.
export interface UpcomingHeroCardProps {
  isCalendarMonth: boolean;
  daysToPayday: number;
  paydayLabel: string;
  spendableNow: number;
  runwayIncomeTotal: number;
  runwayBillsTotal: number;
  allocationsRemainingTotal: number;
  savingsNow: number;
  runway: number;
  /** "even" is a genuine third state (runway === 0 exactly), distinct from "left". */
  runwayStatus: "short" | "left" | "even";
}

const sym = "£";

export default function UpcomingHeroCard({
  isCalendarMonth,
  daysToPayday,
  paydayLabel,
  spendableNow,
  runwayIncomeTotal,
  runwayBillsTotal,
  allocationsRemainingTotal,
  savingsNow,
  runway,
  runwayStatus,
}: UpcomingHeroCardProps) {
  const runwayNegative = runwayStatus === "short";

  return (
    <div
      data-tutorial-id="tutorial-planning-left"
      aria-labelledby="runway-heading"
      className="glass-hero rounded-3xl p-5 shadow-sm sm:p-6"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 id="runway-heading" className="mb-1 text-base font-bold text-slate-950 dark:text-white">
            {isCalendarMonth ? "Projected at month end" : "Projected at payday"}
          </h2>
          <div className="flex items-baseline gap-2">
            <p
              aria-label={`${Math.round(Math.abs(runway)).toLocaleString("en-GB")} pounds ${runwayStatus}`}
              className={`font-mono text-[40px] font-bold leading-none tracking-[-0.04em] tabular-nums ${
                runwayNegative ? "text-rose-600 dark:text-rose-400" : "text-slate-900 dark:text-slate-100"
              }`}
            >
              <span aria-hidden="true">
                {runwayNegative ? "−" : ""}
                {sym}
                {Math.abs(runway).toLocaleString("en-GB", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
              </span>
            </p>
            <span
              className={`text-sm font-semibold ${
                runwayNegative ? "text-rose-600 dark:text-rose-400" : "text-slate-600 dark:text-slate-300"
              }`}
            >
              {runwayStatus}
            </span>
          </div>
          <p className="mt-1 text-xs leading-snug text-slate-500 dark:text-slate-400">
            {isCalendarMonth
              ? `${daysToPayday} ${daysToPayday === 1 ? "day" : "days"} remaining`
              : `${paydayLabel} · ${daysToPayday} ${daysToPayday === 1 ? "day" : "days"}`}
          </p>
        </div>
      </div>

      <details className="group mt-4 border-t border-slate-200/80 dark:border-white/10">
        <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 text-[13px] font-semibold text-indigo-600 outline-none hover:text-indigo-700 focus-visible:ring-2 focus-visible:ring-indigo-500 dark:text-indigo-400 dark:hover:text-indigo-300 [&::-webkit-details-marker]:hidden">
          Full calculation
          <ChevronDown size={16} className="shrink-0 transition-transform group-open:rotate-180" aria-hidden="true" />
        </summary>
        <dl className="border-t border-slate-200/80 pb-1 pt-1 text-[13px] text-slate-600 dark:border-white/10 dark:text-slate-300">
          <div className="flex items-center justify-between gap-4 py-1.5">
            <dt>Available now</dt>
            <dd className="font-mono tabular-nums text-slate-900 dark:text-slate-100">
              {sym}
              {spendableNow.toLocaleString("en-GB", { maximumFractionDigits: 0 })}
            </dd>
          </div>
          {runwayIncomeTotal > 0 && (
            <div className="flex items-center justify-between gap-4 py-1.5">
              <dt>{isCalendarMonth ? "Income before month end" : "Income before payday"}</dt>
              <dd className="font-mono tabular-nums text-slate-900 dark:text-slate-100">
                +{sym}
                {runwayIncomeTotal.toLocaleString("en-GB", { maximumFractionDigits: 0 })}
              </dd>
            </div>
          )}
          <div className="flex items-center justify-between gap-4 py-1.5">
            <dt>{isCalendarMonth ? "Bills before month end" : "Bills before payday"}</dt>
            <dd className="font-mono tabular-nums text-slate-900 dark:text-slate-100">
              −{sym}
              {runwayBillsTotal.toLocaleString("en-GB", { maximumFractionDigits: 0 })}
            </dd>
          </div>
          {allocationsRemainingTotal > 0 && (
            <div className="flex items-center justify-between gap-4 py-1.5">
              <dt>Still to set aside</dt>
              <dd className="font-mono tabular-nums text-slate-900 dark:text-slate-100">
                −{sym}
                {allocationsRemainingTotal.toLocaleString("en-GB", { maximumFractionDigits: 0 })}
              </dd>
            </div>
          )}
          <div className="mt-1 flex items-center justify-between gap-4 border-t border-slate-200/80 pt-2 font-semibold dark:border-white/10">
            <dt>Projected balance</dt>
            <dd className={`font-mono tabular-nums ${runwayNegative ? "text-rose-600 dark:text-rose-400" : "text-slate-900 dark:text-slate-100"}`}>
              {runwayNegative ? "−" : ""}
              {sym}
              {Math.abs(runway).toLocaleString("en-GB", { maximumFractionDigits: 0 })}
            </dd>
          </div>
        </dl>
      </details>

      {savingsNow > 0 && (
        <div className="mt-2 flex items-center justify-between gap-3 text-xs text-slate-500 dark:text-slate-400">
          <span>Savings backup</span>
          <span>
            <span className="font-mono tabular-nums text-slate-700 dark:text-slate-300">
              {sym}
              {savingsNow.toLocaleString("en-GB", { maximumFractionDigits: 0 })}
            </span>{" "}
            · not included
          </span>
        </div>
      )}
      <p className="mt-3 border-t border-slate-200/70 pt-3 text-xs leading-5 text-slate-500 dark:border-white/10 dark:text-slate-400">
        Payments can take a day or two to appear, so a very recent one may not be counted yet.
      </p>
    </div>
  );
}
