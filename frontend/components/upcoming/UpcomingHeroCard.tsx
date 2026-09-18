"use client";

import { ChevronDown, ChevronRight } from "lucide-react";

// The /upcoming runway hero (`app/planning/PlanningPage.tsx`), extracted so
// its design preview (`app/design/g124-upcoming-refine/`) can render the
// real production card against fixtures instead of a parallel
// reimplementation. Every string and figure here is the same content the
// page always showed; only the container, typography and colour rules
// below are new, per the g124/g127 design rounds (Kevin, 2026-09-18):
//
// G124 round one — the hero adopts a bounded-panel style (`glass-hero
// rounded-3xl p-5 shadow-sm sm:p-6`) in place of the old conditionally
// tinted card.
//
// G124 REVISION — "the red is too much ... maybe just highlights instead
// of the whole hero card being red": the panel's red tint on a genuine
// shortfall is gone. The panel is always the same neutral `glass-hero`
// surface, negative state included.
//
// G127 round three — "for the hero card only the figure of 184 and the 1
// account short but the other highlights don't need to be red": red now
// lives in exactly two places, the headline figure (`runwayStatus ===
// "short"`, whose "short" unit word and the identical "Projected balance"
// restatement inside Full calculation travel with it, since they're the
// same figure) and the "N accounts short" badge. The shortfall attribution
// paragraph, its border and the "Review" link are neutral, each reusing a
// colour already established elsewhere on this same card (row-name neutral
// for the sentence, the Full-calculation hairline for the border, the
// Full-calculation link colour for Review) rather than a new shade — per
// DESIGN.md's Red Is Risk Rule ("if everything is fine, a screen may
// contain no red at all") and Figures Are Ink; Amber Lives In The
// Signifier (the same reasoning extends to red: it marks the figure and
// its own small badge, never a whole panel or a run of prose).
//
// G127 round three also gave the "Projected at payday" micro-label a real
// heading (`text-base font-bold`, matching the codex reference's own H2),
// in place of the xs/uppercase eyebrow it replaces.
export interface UpcomingHeroShortfall {
  accountId: string;
  bank: string;
  shortfall: number;
  culprit?: { amount: number; expected_date: string };
}

export interface UpcomingHeroTimingRisk {
  accountId: string;
  bank: string;
  dueDate?: string | null;
}

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
  genuineShortfalls: UpcomingHeroShortfall[];
  timingShortfalls: UpcomingHeroTimingRisk[];
  /** Formats an ISO date the same way the page's own row dates render, e.g. "Fri 18 Sep". */
  formatDate: (iso: string) => string;
  /** Jumps/highlights the top genuinely at-risk row, same behaviour the old banner's Review button had. */
  onReview: () => void;
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
  genuineShortfalls,
  timingShortfalls,
  formatDate,
  onReview,
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
        {/* Genuine/timing split: counts genuine shortfalls only when there
            are any, and falls back to the amber timing-risk count (and
            colour) when that's all that's left. Never red for a same-day
            timing risk. */}
        {(genuineShortfalls.length > 0 || timingShortfalls.length > 0) && (
          <span
            className={`flex shrink-0 items-center gap-1 rounded-lg px-2 py-1 text-xs font-semibold ${
              genuineShortfalls.length > 0
                ? "bg-rose-100 text-rose-600 dark:bg-rose-900/40 dark:text-rose-400"
                : "bg-amber-100 text-amber-600 dark:bg-amber-900/40 dark:text-amber-400"
            }`}
          >
            {genuineShortfalls.length > 0
              ? `${genuineShortfalls.length} ${genuineShortfalls.length === 1 ? "account" : "accounts"} short`
              : `${timingShortfalls.length} timing ${timingShortfalls.length === 1 ? "risk" : "risks"}`}
          </span>
        )}
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
      {genuineShortfalls.length === 0 && timingShortfalls.length === 0 && (
        <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">Predicted bills use your last 90 days.</p>
      )}

      {/* The shortfall attribution — stated exactly once on the whole page.
          One sentence per genuinely short account, each naming its own
          culprit move where one was traced. Rows below don't repeat this,
          they carry a collapsed "Why? ›" toggle instead. Neutral now (G127):
          the border reuses the same hairline the timing-risk block below
          already uses, and the sentence reuses the row-name neutral ink —
          red stays on the figure and the badge only. */}
      {genuineShortfalls.length > 0 && (
        <div className="mt-3 border-t border-slate-200/70 pt-3 dark:border-white/10">
          {genuineShortfalls.map((a) => (
            <p key={a.accountId} className="text-[13px] leading-snug text-slate-800 dark:text-slate-100">
              <span className="font-semibold">{a.bank}</span> is short by{" "}
              <span className="font-mono tabular-nums font-semibold">
                {sym}
                {a.shortfall.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </span>{" "}
              before payday
              {a.culprit && (
                <>
                  , mostly the{" "}
                  <span className="font-mono tabular-nums">
                    {sym}
                    {a.culprit.amount.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </span>{" "}
                  move on {formatDate(a.culprit.expected_date)}
                </>
              )}
              .
            </p>
          ))}
          <div className="mt-2 flex items-center justify-between gap-3">
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Payments can take a day or two to appear, so a very recent one may not be counted yet.
            </p>
            {/* Neutral now (G127) — reuses the same indigo already used for
                the Full calculation link just above, not a new colour. */}
            <button
              type="button"
              onClick={onReview}
              className="flex min-h-[44px] shrink-0 items-center gap-0.5 px-2 -my-2.5 text-[13px] font-semibold text-indigo-600 underline-offset-2 hover:underline active:scale-95 transition-transform focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 rounded-lg dark:text-indigo-400"
            >
              Review <ChevronRight size={14} aria-hidden="true" />
            </button>
          </div>
        </div>
      )}

      {/* Timing-risk twin, never red (Red Is Risk Rule): the exact
          HSBC/NatWest/Monzo payday-STO case, an account only looks short
          because the conservative walk puts a payment before the same-day
          credit that's due in. */}
      {timingShortfalls.length > 0 && (
        <div className={`mt-3 ${genuineShortfalls.length === 0 ? "border-t border-slate-200/70 pt-3 dark:border-white/10" : ""}`}>
          {timingShortfalls.map((t) => (
            <p key={t.accountId} className="flex items-start gap-1.5 text-[12px] leading-snug text-slate-500 dark:text-slate-400">
              <span aria-hidden className="mt-[5px] inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500 dark:bg-amber-400" />
              Money&apos;s due into {t.bank}
              {t.dueDate ? ` on ${formatDate(t.dueDate)}` : ""}. If a payment leaves first, it could bounce.
            </p>
          ))}
        </div>
      )}
    </div>
  );
}
