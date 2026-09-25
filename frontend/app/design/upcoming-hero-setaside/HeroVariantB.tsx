"use client";

// G162 variant B — "Two-line verdict" (impeccable skill).
//
// Instead of one figure that includes the set-aside deduction (and can go
// arithmetically negative on a day nothing is actually wrong), the
// headline becomes the figure the set-aside-only case is actually about:
// what's covered once bills are accounted for. A second, smaller line
// carries the unfilled set-aside remainder as its own fact, "£266 still
// to set aside", with a small amber dot doing the caution signalling per
// DESIGN.md's own escape valve ("when a sentence carries a caution and no
// other signifier is present, prepend a small leading amber dot rather
// than colouring the text") — the figure on that second line stays ink
// too, never amber. The payday-exclusion fact moves into the "Full
// calculation" disclosure's own summary label, since that's the natural
// place a user opens to ask "where does this number come from".
//
// A genuine bill gap is a different fact and gets a different headline:
// the pre-allocation figure itself goes negative and red, with "Short" as
// the status word — nothing here softens a real shortfall.
//
// Forked from components/upcoming/UpcomingHeroCard.tsx (the real
// production hero, prop-driven, not self-fetching — see this preview's
// page.tsx). The shortfall attribution and timing-risk block are
// unchanged production content.
import { useId, useState } from "react";
import { ChevronDown } from "lucide-react";
import type { RunwayScenario } from "./fixtures";
import { classify } from "./fixtures";
import { ShortfallAttribution, ShortfallBadge, fmt, sym } from "./heroShared";

export default function HeroVariantB({ scenario }: { scenario: RunwayScenario }) {
  const headingId = useId();
  const [open, setOpen] = useState(false);
  const { runway, runwayBeforeAllocations, billGap, setAsideOnly } = classify(scenario);
  const headline = runwayBeforeAllocations;
  const headlineNegative = headline < 0;
  const runwayNegative = runway < 0;
  const statusWord = billGap ? "Short" : "Covered";
  const showRemainder = scenario.allocationsRemainingTotal > 0;

  return (
    <div aria-labelledby={headingId} className="glass-hero rounded-3xl p-5 shadow-sm sm:p-6">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 id={headingId} className="mb-1 text-base font-bold text-slate-950 dark:text-white">
            {billGap
              ? scenario.isCalendarMonth
                ? "Short at month end"
                : "Short at payday"
              : scenario.isCalendarMonth
              ? "Covered at month end"
              : "Covered at payday"}
          </h2>
          <div className="flex items-baseline gap-2">
            <p
              aria-label={`${fmt(headline)} pounds ${statusWord}`}
              className={`font-mono text-[40px] font-bold leading-none tracking-[-0.04em] tabular-nums ${
                billGap ? "text-rose-600 dark:text-rose-400" : "text-slate-900 dark:text-slate-100"
              }`}
            >
              <span aria-hidden="true">
                {headlineNegative ? "−" : ""}
                {sym}
                {fmt(headline)}
              </span>
            </p>
            <span className={`text-sm font-semibold ${billGap ? "text-rose-600 dark:text-rose-400" : "text-slate-600 dark:text-slate-300"}`}>
              {statusWord}
            </span>
          </div>
          {showRemainder && (
            <p className="mt-1 flex items-center gap-1.5 text-[13px] leading-snug text-slate-600 dark:text-slate-300">
              {setAsideOnly && (
                <span aria-hidden className="inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500 dark:bg-amber-400" />
              )}
              <span className="font-mono tabular-nums font-semibold text-slate-900 dark:text-slate-100">
                {sym}
                {fmt(scenario.allocationsRemainingTotal)}
              </span>
              &nbsp;still to set aside
            </p>
          )}
          <p className="mt-1 text-xs leading-snug text-slate-500 dark:text-slate-400">
            {scenario.paydayLabel} &middot; {scenario.daysToPayday} {scenario.daysToPayday === 1 ? "day" : "days"}
          </p>
        </div>
        <ShortfallBadge genuineShortfalls={scenario.genuineShortfalls} timingShortfalls={scenario.timingShortfalls} />
      </div>

      <div className="group mt-4 border-t border-slate-200/80 dark:border-white/10">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="flex min-h-11 w-full cursor-pointer items-center justify-between gap-3 text-left text-[13px] font-semibold text-indigo-600 outline-none hover:text-indigo-700 focus-visible:ring-2 focus-visible:ring-indigo-500 dark:text-indigo-400 dark:hover:text-indigo-300"
        >
          <span>
            Full calculation
            <span className="ml-1.5 font-normal text-indigo-500 dark:text-indigo-300">
              &middot; {scenario.paydayLabel}&apos;s pay not counted yet
            </span>
          </span>
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
            <div className="flex items-center justify-between gap-4 py-1.5">
              <dt>Covered before set-asides</dt>
              <dd className={`font-mono tabular-nums ${billGap ? "text-rose-600 dark:text-rose-400" : "text-slate-900 dark:text-slate-100"}`}>
                {headlineNegative ? "−" : ""}
                {sym}
                {fmt(headline)}
              </dd>
            </div>
            {showRemainder && (
              <div className="flex items-center justify-between gap-4 py-1.5">
                <dt>Still to set aside</dt>
                <dd className="font-mono tabular-nums text-slate-900 dark:text-slate-100">
                  &minus;{sym}
                  {fmt(scenario.allocationsRemainingTotal)}
                </dd>
              </div>
            )}
            {/* The ledger's one derived total, closing the same way A and C
                close: a single row wearing the one total device (top rule +
                weight), never a second styled row above it (One Separator
                Per Ledger Boundary, DESIGN.md). This is `runway`, the same
                post-allocation figure A and C show as their headline — B's
                own headline leads on the pre-allocation figure instead, but
                the ledger still has to end on the real answer. */}
            <div className="mt-1 flex items-center justify-between gap-4 border-t border-slate-200/80 pt-2 font-semibold dark:border-white/10">
              <dt>{scenario.isCalendarMonth ? "Projected at month end" : "Projected at payday"}</dt>
              <dd className={`font-mono tabular-nums ${billGap ? "text-rose-600 dark:text-rose-400" : "text-slate-900 dark:text-slate-100"}`}>
                {runwayNegative ? "−" : ""}
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
