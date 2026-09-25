"use client";

// G162 variant A — "Set aside, not short" (impeccable skill).
//
// The status word moves off plain caution-coloured text and into a real
// signifier: a small pill chip above the figure, the same device Home's
// Safe-to-Spend hero already uses for its own verdict word (DESIGN.md,
// "The Safe-to-Spend hero"). Amber only ever colours that chip, never the
// £ figure itself (Figures Are Ink; Amber Lives In The Signifier) — the
// figure stays slate ink even when it is arithmetically negative, because
// a negative figure caused only by an unfilled set-aside is not the same
// fact as a bounced bill. Red is unchanged: a genuine bill gap still
// colours both the figure and the chip, and still earns the existing red
// "N accounts short" badge.
//
// Forked from components/upcoming/UpcomingHeroCard.tsx (the real
// production hero, prop-driven, NOT self-fetching or inline — see this
// preview's page.tsx for the correction). The ledger, shortfall
// attribution and timing-risk block below are unchanged production
// markup/content; only the status chip, the figure's colour rule and the
// new payday-exclusion caption are new.
import { useId, useState } from "react";
import { ChevronDown } from "lucide-react";
import type { RunwayScenario } from "./fixtures";
import { classify } from "./fixtures";
import { ShortfallAttribution, ShortfallBadge, PaydayExclusionNote, fmt, sym } from "./heroShared";

export default function HeroVariantA({ scenario }: { scenario: RunwayScenario }) {
  const headingId = useId();
  const [open, setOpen] = useState(false);
  const { runway, billGap, setAsideOnly, healthy } = classify(scenario);
  const negative = runway < 0;

  // The chip: red only for a genuine bill gap, amber only for the
  // set-aside-only case, neutral ink otherwise. This is the one place in
  // the card colour is allowed to speak — the figure below never repeats
  // it.
  const chipLabel = billGap ? "Short" : setAsideOnly ? "Set aside" : healthy ? "Covered" : "Even";
  const chipClass = billGap
    ? "bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300"
    : setAsideOnly
    ? "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300"
    : "bg-slate-100 text-slate-600 dark:bg-white/10 dark:text-slate-300";

  return (
    <div aria-labelledby={headingId} className="glass-hero rounded-3xl p-5 shadow-sm sm:p-6">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 id={headingId} className="mb-1 text-base font-bold text-slate-950 dark:text-white">
            {scenario.isCalendarMonth ? "Projected at month end" : "Projected at payday"}
          </h2>
          <div className="flex items-center gap-2">
            <span
              className={`inline-flex min-h-6 items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${chipClass}`}
            >
              {chipLabel}
            </span>
          </div>
          <p
            aria-label={`${fmt(runway)} pounds ${negative ? "negative" : "positive"}`}
            className={`mt-1.5 font-mono text-[40px] font-bold leading-none tracking-[-0.04em] tabular-nums ${
              billGap ? "text-rose-600 dark:text-rose-400" : "text-slate-900 dark:text-slate-100"
            }`}
          >
            <span aria-hidden="true">
              {negative ? "−" : ""}
              {sym}
              {fmt(runway)}
            </span>
          </p>
          <p className="mt-1 text-xs leading-snug text-slate-500 dark:text-slate-400">
            {scenario.paydayLabel} &middot; {scenario.daysToPayday} {scenario.daysToPayday === 1 ? "day" : "days"}
          </p>
          <PaydayExclusionNote paydayIncomeAmount={scenario.paydayIncomeAmount} paydayLabel={scenario.paydayLabel} />
        </div>
        <ShortfallBadge genuineShortfalls={scenario.genuineShortfalls} timingShortfalls={scenario.timingShortfalls} />
      </div>

      <div className="group mt-4 border-t border-slate-200/80 dark:border-white/10">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="flex min-h-11 w-full cursor-pointer items-center justify-between gap-3 text-[13px] font-semibold text-indigo-600 outline-none hover:text-indigo-700 focus-visible:ring-2 focus-visible:ring-indigo-500 dark:text-indigo-400 dark:hover:text-indigo-300"
        >
          Full calculation
          <ChevronDown size={16} className={`shrink-0 transition-transform ${open ? "rotate-180" : ""}`} aria-hidden="true" />
        </button>
        {open && (
          <dl className="border-t border-slate-200/80 pb-1 pt-1 text-[13px] text-slate-600 dark:border-white/10 dark:text-slate-300">
            <div className="flex items-center justify-between gap-4 py-1.5">
              <dt>Available now</dt>
              <dd className="font-mono tabular-nums text-slate-900 dark:text-slate-100">
                {sym}
                {fmt(scenario.spendableNow)}
              </dd>
            </div>
            {scenario.runwayIncomeTotal > 0 && (
              <div className="flex items-center justify-between gap-4 py-1.5">
                <dt>{scenario.isCalendarMonth ? "Income before month end" : "Income before payday"}</dt>
                <dd className="font-mono tabular-nums text-slate-900 dark:text-slate-100">
                  +{sym}
                  {fmt(scenario.runwayIncomeTotal)}
                </dd>
              </div>
            )}
            <div className="flex items-center justify-between gap-4 py-1.5">
              <dt>{scenario.isCalendarMonth ? "Bills before month end" : "Bills before payday"}</dt>
              <dd className="font-mono tabular-nums text-slate-900 dark:text-slate-100">
                &minus;{sym}
                {fmt(scenario.runwayBillsTotal)}
              </dd>
            </div>
            {scenario.allocationsRemainingTotal > 0 && (
              <div className="flex items-center justify-between gap-4 py-1.5">
                <dt className="flex items-center gap-1.5">
                  {setAsideOnly && (
                    <span aria-hidden className="inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500 dark:bg-amber-400" />
                  )}
                  Still to set aside
                </dt>
                <dd className="font-mono tabular-nums text-slate-900 dark:text-slate-100">
                  &minus;{sym}
                  {fmt(scenario.allocationsRemainingTotal)}
                </dd>
              </div>
            )}
            <div className="mt-1 flex items-center justify-between gap-4 border-t border-slate-200/80 pt-2 font-semibold dark:border-white/10">
              <dt>Projected balance</dt>
              <dd className={`font-mono tabular-nums ${billGap ? "text-rose-600 dark:text-rose-400" : "text-slate-900 dark:text-slate-100"}`}>
                {negative ? "−" : ""}
                {sym}
                {fmt(runway)}
              </dd>
            </div>
          </dl>
        )}
      </div>

      {scenario.savingsNow > 0 && (
        <div className="mt-2 flex items-center justify-between gap-3 text-xs text-slate-500 dark:text-slate-400">
          <span>Savings backup</span>
          <span>
            <span className="font-mono tabular-nums text-slate-700 dark:text-slate-300">
              {sym}
              {fmt(scenario.savingsNow)}
            </span>{" "}
            &middot; not included
          </span>
        </div>
      )}
      {scenario.genuineShortfalls.length === 0 && scenario.timingShortfalls.length === 0 && (
        <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">Predicted bills use your last 90 days.</p>
      )}

      <ShortfallAttribution genuineShortfalls={scenario.genuineShortfalls} onReview={() => {}} />
    </div>
  );
}
