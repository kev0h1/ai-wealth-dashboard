"use client";

// G124 ask #1 — the hero adopts G90's (app/design/upcoming-canvas-before-
// cards) bounded-panel styling; every piece of CONTENT below is the live
// PlanningPage.tsx hero's content verbatim: "Projected at payday/month
// end", the figure + status word, the date/days line, "Full calculation",
// the savings-backup line, the 90-days note, and the genuine/timing
// shortfall attribution. Nothing here is reworded, reordered or restated —
// only the container, spacing and figure size change, matching
// UpcomingCanvasClient.tsx's own `rounded-3xl p-5 shadow-sm sm:p-6` panel
// and `text-[40px]` figure (itself precedented by Home's Safe-to-Spend hero,
// components/SafeToSpendCard.tsx, which already runs its own figure at
// text-[38px] — a bespoke hero-figure size is established practice on this
// app's single "the one big number" surfaces, not a new liberty taken here).
//
// JUDGEMENT CALL (the one the brief asked to make deliberately, see the
// G124 report for the full reasoning): the live PlanningPage.tsx today
// tints the WHOLE panel red only when `genuineShortfalls.length > 0` (a
// specific account is genuinely short), while the headline FIGURE itself
// already turns rose independently whenever `runwayNegative` (the pooled
// projection crosses zero) — two related but not identical triggers that
// can disagree. G90 collapses this to one signal: the panel reddens exactly
// when the figure is negative. This preview follows G90's simpler, single
// signal (`negative` prop below, driven by the same runway-crosses-zero
// test) because a negative pooled projection at payday IS itself a genuine
// financial risk per the Red Is Risk Rule, independent of whether any one
// account's own walk also flags short — and because keeping the panel and
// the figure in visual agreement (both red, or neither) reads more honestly
// than a rose figure sitting inside an otherwise-neutral panel. The
// separate "N accounts short / N timing risks" badge, which is the more
// granular per-account signal, is preserved completely unchanged as its own
// small signifier — this decision only changes what colours the big panel,
// never removes the account-level detail.
export interface HeroScenario {
  isCalendarMonth: boolean;
  daysToPayday: number;
  paydayLabel: string;
  spendableNow: number;
  runwayIncomeTotal: number;
  runwayBillsTotal: number;
  allocationsRemainingTotal: number;
  savingsNow: number;
  genuineShortfalls: { accountId: string; bank: string; shortfall: number }[];
  timingShortfalls: { accountId: string; bank: string; dueDate?: string }[];
}

const sym = "£";
function fmt(n: number) {
  return n.toLocaleString("en-GB", { maximumFractionDigits: 0 });
}
function fmt2(n: number) {
  return n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function HeroCard({ scenario, runway }: { scenario: HeroScenario; runway: number }) {
  const {
    isCalendarMonth, daysToPayday, paydayLabel, spendableNow,
    runwayIncomeTotal, runwayBillsTotal, allocationsRemainingTotal,
    savingsNow, genuineShortfalls, timingShortfalls,
  } = scenario;
  const negative = runway < 0;

  return (
    <div
      data-tutorial-id="tutorial-planning-left"
      className={`rounded-3xl p-5 shadow-sm sm:p-6 ${
        negative
          ? "border border-rose-200 bg-rose-50/80 dark:border-rose-800 dark:bg-rose-950/25"
          : "glass-hero"
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
            {isCalendarMonth ? "Projected at month end" : "Projected at payday"}
          </p>
          <div className="flex items-baseline gap-2">
            <p
              aria-label={`${Math.round(Math.abs(runway)).toLocaleString("en-GB")} pounds ${negative ? "short" : "left"}`}
              className={`font-mono text-[40px] font-bold leading-none tracking-[-0.04em] tabular-nums ${
                negative ? "text-rose-600 dark:text-rose-400" : "text-slate-950 dark:text-white"
              }`}
            >
              <span aria-hidden="true">{negative ? "−" : ""}{sym}{fmt(Math.abs(runway))}</span>
            </p>
            <span className={`text-sm font-semibold ${negative ? "text-rose-600 dark:text-rose-400" : "text-slate-600 dark:text-slate-300"}`}>
              {negative ? "short" : "left"}
            </span>
          </div>
          <p className="mt-1 text-xs leading-snug text-slate-500 dark:text-slate-400">
            {isCalendarMonth
              ? `${daysToPayday} ${daysToPayday === 1 ? "day" : "days"} remaining`
              : `${paydayLabel} · ${daysToPayday} ${daysToPayday === 1 ? "day" : "days"}`}
          </p>
        </div>
        {(genuineShortfalls.length > 0 || timingShortfalls.length > 0) && (
          <span className={`flex shrink-0 items-center gap-1 rounded-lg px-2 py-1 text-xs font-semibold ${
            genuineShortfalls.length > 0
              ? "bg-rose-100 text-rose-600 dark:bg-rose-900/40 dark:text-rose-400"
              : "bg-amber-100 text-amber-600 dark:bg-amber-900/40 dark:text-amber-400"
          }`}>
            {genuineShortfalls.length > 0
              ? `${genuineShortfalls.length} ${genuineShortfalls.length === 1 ? "account" : "accounts"} short`
              : `${timingShortfalls.length} timing ${timingShortfalls.length === 1 ? "risk" : "risks"}`}
          </span>
        )}
      </div>

      <details className="group mt-4 border-t border-slate-200/80 dark:border-white/10">
        <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 text-[13px] font-semibold text-indigo-600 outline-none hover:text-indigo-700 focus-visible:ring-2 focus-visible:ring-indigo-500 dark:text-indigo-400 dark:hover:text-indigo-300 [&::-webkit-details-marker]:hidden">
          Full calculation
          <ChevronDownIcon />
        </summary>
        <dl className="border-t border-slate-200/80 pb-1 pt-1 text-[13px] text-slate-600 dark:border-white/10 dark:text-slate-300">
          <div className="flex items-center justify-between gap-4 py-1.5">
            <dt>Available now</dt>
            <dd className="font-mono tabular-nums text-slate-900 dark:text-slate-100">{sym}{fmt(spendableNow)}</dd>
          </div>
          {runwayIncomeTotal > 0 && (
            <div className="flex items-center justify-between gap-4 py-1.5">
              <dt>{isCalendarMonth ? "Income before month end" : "Income before payday"}</dt>
              <dd className="font-mono tabular-nums text-slate-900 dark:text-slate-100">+{sym}{fmt(runwayIncomeTotal)}</dd>
            </div>
          )}
          <div className="flex items-center justify-between gap-4 py-1.5">
            <dt>{isCalendarMonth ? "Bills before month end" : "Bills before payday"}</dt>
            <dd className="font-mono tabular-nums text-slate-900 dark:text-slate-100">−{sym}{fmt(runwayBillsTotal)}</dd>
          </div>
          {allocationsRemainingTotal > 0 && (
            <div className="flex items-center justify-between gap-4 py-1.5">
              <dt>Still to set aside</dt>
              <dd className="font-mono tabular-nums text-slate-900 dark:text-slate-100">−{sym}{fmt(allocationsRemainingTotal)}</dd>
            </div>
          )}
          <div className="mt-1 flex items-center justify-between gap-4 border-t border-slate-200/80 pt-2 font-semibold dark:border-white/10">
            <dt>Projected balance</dt>
            <dd className={`font-mono tabular-nums ${negative ? "text-rose-600 dark:text-rose-400" : "text-slate-900 dark:text-slate-100"}`}>
              {negative ? "−" : ""}{sym}{fmt(Math.abs(runway))}
            </dd>
          </div>
        </dl>
      </details>

      {savingsNow > 0 && (
        <div className="mt-2 flex items-center justify-between gap-3 text-xs text-slate-500 dark:text-slate-400">
          <span>Savings backup</span>
          <span><span className="font-mono tabular-nums text-slate-700 dark:text-slate-300">{sym}{fmt(savingsNow)}</span> · not included</span>
        </div>
      )}
      {genuineShortfalls.length === 0 && timingShortfalls.length === 0 && (
        <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
          Predicted bills use your last 90 days.
        </p>
      )}

      {genuineShortfalls.length > 0 && (
        <div className="mt-3 border-t border-rose-200/70 pt-3 dark:border-rose-800/60">
          {genuineShortfalls.map((a) => (
            <p key={a.accountId} className="text-[13px] leading-snug text-rose-900 dark:text-rose-100">
              <span className="font-semibold">{a.bank}</span> is short by{" "}
              <span className="font-mono tabular-nums font-semibold">{sym}{fmt2(a.shortfall)}</span> before payday.
            </p>
          ))}
          <div className="mt-2 flex items-center justify-between gap-3">
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Payments can take a day or two to appear, so a very recent one may not be counted yet.
            </p>
            <span className="flex min-h-[44px] shrink-0 items-center gap-0.5 px-2 -my-2.5 text-[13px] font-semibold text-rose-600 dark:text-rose-400">
              Review <ChevronRightIcon />
            </span>
          </div>
        </div>
      )}

      {timingShortfalls.length > 0 && (
        <div className={`mt-3 ${genuineShortfalls.length === 0 ? "border-t border-slate-200/70 pt-3 dark:border-white/10" : ""}`}>
          {timingShortfalls.map((t) => (
            <p key={t.accountId} className="flex items-start gap-1.5 text-[12px] leading-snug text-slate-500 dark:text-slate-400">
              <span aria-hidden className="mt-[5px] inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500 dark:bg-amber-400" />
              Money&apos;s due into {t.bank}{t.dueDate ? ` on ${t.dueDate}` : ""}. If a payment leaves first, it could bounce.
            </p>
          ))}
        </div>
      )}
    </div>
  );
}

// Local, dependency-free icon glyphs (matching lucide-react's ChevronDown /
// ChevronRight strokes) so this preview doesn't need to import lucide for
// two static marks — the exact geometry doesn't matter for a design round.
function ChevronDownIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="shrink-0 transition-transform group-open:rotate-180">
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}
function ChevronRightIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="9 18 15 12 9 6" />
    </svg>
  );
}
