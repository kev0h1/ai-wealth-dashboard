"use client";

// G162 variant C — "Ledger-led" (impeccable skill).
//
// The quietest of the three. The headline keeps today's shape (the same
// post-allocation projected figure production already shows) but the
// status word leads with what it is actually reporting on: whether bills
// are covered, since that is the genuinely risky fact. "Bills covered"
// stays neutral ink even when the set-aside-only figure below it is
// arithmetically negative — the set-aside gap itself is folded entirely
// into the "Full calculation" disclosure, where an amber dot marks the
// "Still to set aside" row and the disclosure's own closed-state summary,
// so the caution is visible without expanding but never spoken in prose
// or figure colour outside that one small dot (Figures Are Ink; Amber
// Lives In The Signifier). A genuine bill gap still turns the headline
// word to "Bills at risk", the figure red, and keeps the red "N accounts
// short" badge — the ledger-led framing only changes which case gets to
// stay quiet, not the red rule itself.
//
// Forked from components/upcoming/UpcomingHeroCard.tsx (the real
// production hero, prop-driven, not self-fetching — see this preview's
// page.tsx). The shortfall attribution and timing-risk block are
// unchanged production content.
import { useId, useState } from "react";
import { ChevronDown } from "lucide-react";
import type { RunwayScenario } from "./fixtures";
import { classify } from "./fixtures";
import { ShortfallAttribution, ShortfallBadge, PaydayExclusionNote, fmt, sym } from "./heroShared";

export default function HeroVariantC({ scenario }: { scenario: RunwayScenario }) {
  const headingId = useId();
  const [open, setOpen] = useState(false);
  const { runway, billGap, setAsideOnly } = classify(scenario);
  const negative = runway < 0;
  const statusWord = billGap ? "Bills at risk" : "Bills covered";

  return (
    <div aria-labelledby={headingId} className="glass-hero rounded-3xl p-5 shadow-sm sm:p-6">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 id={headingId} className="mb-1 text-base font-bold text-slate-950 dark:text-white">
            {scenario.isCalendarMonth ? "Projected at month end" : "Projected at payday"}
          </h2>
          <div className="flex items-baseline gap-2">
            <p
              aria-label={`${fmt(runway)} pounds, ${statusWord}`}
              className={`font-mono text-[40px] font-bold leading-none tracking-[-0.04em] tabular-nums ${
                billGap ? "text-rose-600 dark:text-rose-400" : "text-slate-900 dark:text-slate-100"
              }`}
            >
              <span aria-hidden="true">
                {negative ? "−" : ""}
                {sym}
                {fmt(runway)}
              </span>
            </p>
            <span className={`text-sm font-semibold ${billGap ? "text-rose-600 dark:text-rose-400" : "text-slate-600 dark:text-slate-300"}`}>
              {statusWord}
            </span>
          </div>
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
          className="flex min-h-11 w-full cursor-pointer items-center gap-2 text-[13px] font-semibold text-indigo-600 outline-none hover:text-indigo-700 focus-visible:ring-2 focus-visible:ring-indigo-500 dark:text-indigo-400 dark:hover:text-indigo-300"
        >
          {setAsideOnly && (
            <span aria-hidden className="inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500 dark:bg-amber-400" />
          )}
          <span className="flex-1 text-left">Full calculation</span>
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
