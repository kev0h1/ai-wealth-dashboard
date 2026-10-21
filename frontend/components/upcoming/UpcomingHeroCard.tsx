"use client";

import { ChevronDown } from "lucide-react";
import { BALANCE_MASK, useBalancesHidden } from "@/lib/balancesHidden";
import PooledLedgerExplainer, { POOLED_PROJECTION_SENTENCE } from "@/components/PooledLedgerExplainer";
import ForecastStatusBadge from "@/components/ForecastStatusBadge";
import { FORECAST_INK, FORECAST_QUALIFIER, type UpcomingForecastPresentation } from "@/lib/cashForecastStatus";

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
  /** G227: goal contributions planned for this pay period (same figure as Home's Plans reserved). */
  plansReservedTotal?: number;
  /** G304: counts, so the release lines can say "envelopes"/"plans" when there is more than one. */
  allocationsCount?: number;
  plansCount?: number;
  /** The plans figure could not be read; say so instead of implying there are none. */
  plansUnavailable?: boolean;
  savingsNow: number;
  runway: number;
  /** "even" is a genuine third state (runway === 0 exactly), distinct from "left". */
  runwayStatus: "short" | "left" | "even";
  /** B55: Hide balances. Falls back to the page-level context (visible when absent). */
  balancesHidden?: boolean;
  /** G287: date-ordered forecast status, supplied by the planning surface. */
  presentation?: UpcomingForecastPresentation;
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
  plansReservedTotal = 0,
  allocationsCount,
  plansCount,
  plansUnavailable = false,
  savingsNow,
  runway,
  runwayStatus,
  balancesHidden,
  presentation,
}: UpcomingHeroCardProps) {
  const contextHidden = useBalancesHidden();
  const hidden = balancesHidden ?? contextHidden;
  // Whole-pound amount, masked when balances are hidden. Sign is kept by callers.
  const pounds = (v: number) => (hidden ? BALANCE_MASK : `${sym}${v.toLocaleString("en-GB", { maximumFractionDigits: 0 })}`);
  const runwayNegative = runwayStatus === "short";
  // Do not derive reassurance from the end-of-period balance here. The parent
  // has the dated forecast evidence needed to decide the semantic status.
  const forecastPresentation: UpcomingForecastPresentation = presentation ?? {
    status: { tone: "neutral", label: "Check forecast" },
    qualifierTone: "neutral",
  };

  return (
    <div
      data-tutorial-id="tutorial-planning-left"
      aria-labelledby="runway-heading"
      className="glass-hero rounded-2xl p-5 shadow-sm sm:p-6"
    >
      <div className="grid min-h-7 grid-cols-[minmax(0,1fr)_minmax(7rem,max-content)] items-center gap-3">
        <h2 id="runway-heading" className="min-w-0 text-base font-bold text-slate-950 dark:text-white">
          {isCalendarMonth ? "Projected at month end" : "Projected at payday"}
        </h2>
        <span className="flex justify-self-end">
          {forecastPresentation.pending
            ? <span data-forecast-pending aria-hidden="true" className="h-7 w-28" />
            : <ForecastStatusBadge status={forecastPresentation.status} />}
        </span>
      </div>
      <div className="mt-5 min-w-0">
        <div className="flex flex-wrap items-baseline gap-2">
          <p
            aria-label={hidden ? `Amount hidden, ${runwayStatus}` : `${Math.round(Math.abs(runway)).toLocaleString("en-GB")} pounds ${runwayStatus}`}
            className={`font-mono text-[30px] font-bold leading-[1.2] tracking-[-0.025em] tabular-nums ${FORECAST_INK}`}
          >
            <span aria-hidden="true">
              {runwayNegative ? "−" : ""}
              {pounds(Math.abs(runway))}
            </span>
          </p>
          <span className={`text-sm font-semibold ${FORECAST_QUALIFIER[forecastPresentation.qualifierTone]}`}>
            {runwayStatus}
          </span>
          {plansUnavailable && (
            <span className="text-xs font-medium text-slate-500 dark:text-slate-400">estimated</span>
          )}
        </div>
        <p className="mt-1 text-xs leading-snug text-slate-500 dark:text-slate-400">
          {isCalendarMonth
            ? `${daysToPayday} ${daysToPayday === 1 ? "day" : "days"} remaining`
            : `${paydayLabel} · ${daysToPayday} ${daysToPayday === 1 ? "day" : "days"}`}
        </p>
      </div>

      <details className="group mt-4 border-t border-slate-200/80 dark:border-white/10">
        <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 text-[13px] font-semibold text-slate-600 outline-none hover:text-slate-700 focus-visible:ring-2 focus-visible:ring-indigo-500 dark:text-slate-300 dark:hover:text-slate-200 [-webkit-tap-highlight-color:transparent] [&::-webkit-details-marker]:hidden">
          Full calculation
          <ChevronDown size={16} className="shrink-0 transition-transform group-open:rotate-180" aria-hidden="true" />
        </summary>
        <dl className="border-t border-slate-200/80 pb-1 pt-1 text-[13px] text-slate-600 dark:border-white/10 dark:text-slate-300">
          <div className="flex items-center justify-between gap-4 py-1.5">
            <dt>Available now</dt>
            <dd className="font-mono tabular-nums text-slate-900 dark:text-slate-100">
              {pounds(spendableNow)}
            </dd>
          </div>
          {runwayIncomeTotal > 0 && (
            <div className="flex items-center justify-between gap-4 py-1.5">
              <dt>{isCalendarMonth ? "Income before month end" : "Income before payday"}</dt>
              <dd className="font-mono tabular-nums text-slate-900 dark:text-slate-100">
                +{pounds(runwayIncomeTotal)}
              </dd>
            </div>
          )}
          <div className="flex items-center justify-between gap-4 py-1.5">
            <dt>{isCalendarMonth ? "Bills before month end" : "Bills before payday"}</dt>
            <dd className="font-mono tabular-nums text-slate-900 dark:text-slate-100">
              −{pounds(runwayBillsTotal)}
            </dd>
          </div>
          {allocationsRemainingTotal > 0 && (
            <div className="flex items-center justify-between gap-4 py-1.5">
              <dt>Still to set aside</dt>
              <dd className="font-mono tabular-nums text-slate-900 dark:text-slate-100">
                −{pounds(allocationsRemainingTotal)}
              </dd>
            </div>
          )}
          {(plansReservedTotal > 0 || plansUnavailable) && (
            <div className="flex items-center justify-between gap-4 py-1.5">
              <dt className="min-w-0">
                Plans this period
                <span className="block text-xs leading-snug text-slate-500 dark:text-slate-400">
                  {plansUnavailable
                    ? "Goal contributions could not be loaded, so this figure may be too high."
                    : "Goal contributions planned this pay period."}
                </span>
              </dt>
              <dd className="shrink-0 whitespace-nowrap font-mono tabular-nums text-slate-900 dark:text-slate-100">
                {plansUnavailable ? "Unavailable" : (
                  <>
                    −{pounds(plansReservedTotal)}
                  </>
                )}
              </dd>
            </div>
          )}
          <div className="mt-1 flex items-center justify-between gap-4 border-t border-slate-200/80 pt-2 font-semibold dark:border-white/10">
            <dt>Projected balance</dt>
            <dd className={`font-mono tabular-nums ${FORECAST_INK}`}>
              {runwayNegative ? "−" : ""}
              {pounds(Math.abs(runway))}
            </dd>
          </div>
        </dl>
        <div className="border-t border-slate-200/80 pb-2 dark:border-white/10">
          <PooledLedgerExplainer
            pooled
            poolingSentence={POOLED_PROJECTION_SENTENCE}
            envelope={{ amount: allocationsRemainingTotal, count: allocationsCount }}
            plan={plansUnavailable ? null : { amount: plansReservedTotal, count: plansCount }}
            format={pounds}
          />
        </div>
      </details>

      {savingsNow > 0 && (
        <div className="mt-2 flex items-center justify-between gap-3 text-xs text-slate-500 dark:text-slate-400">
          <span>Savings backup</span>
          <span>
            <span className="font-mono tabular-nums text-slate-700 dark:text-slate-300">
              {pounds(savingsNow)}
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
