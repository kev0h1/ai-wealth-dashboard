"use client";

import Link from "next/link";
import { ChevronDown } from "@/lib/phosphorIcons";
import { useState } from "react";
import MoneyText from "@/components/MoneyText";
import { SheetFrame } from "@/components/SheetFrame";
import { spendHeroModel } from "@/lib/spendHero";
import type { Overspending, SpendVerdict } from "@/lib/api";

const money = (value: number) => `${value < 0 ? "−" : ""}£${Math.abs(value).toLocaleString("en-GB", {
  minimumFractionDigits: Number.isInteger(value) ? 0 : 2,
  maximumFractionDigits: 2,
})}`;
const list = new Intl.ListFormat("en-GB", { style: "long", type: "conjunction" });

function nextDay(end: string) {
  const date = new Date(`${end}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }).format(date);
}

export const hasReadableOverspending = (value: Overspending | null | undefined): value is Overspending =>
  !!value && value.display_ready === true;

export const hasProjectedOverspending = (value: Overspending | null | undefined): value is Overspending =>
  hasReadableOverspending(value) && !value.crossed && !value.acknowledged
  && value.on_course.available && value.on_course.on_course_to_cross === true
  && value.on_course.predicted_income != null && value.on_course.projected_gap != null
  && value.on_course.projected_gap > 0;

export function overspendingMatchesVerdict(value: Overspending | null | undefined, verdict: SpendVerdict | null): value is Overspending {
  return hasReadableOverspending(value) && !!verdict && verdict.period.offset === 0
    && verdict.period.start === value.period.start && verdict.period.end === value.period.end
    && verdict.pills.spent === value.out && verdict.pills.income === value.in;
}

export function overspendingCategoryHref(category: string, period: Overspending["period"]) {
  return `/transactions?${new URLSearchParams({ category, from: period.start, to: period.end })}`;
}

const focus = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:focus-visible:ring-indigo-300";
const press = "touch-manipulation active:scale-95 motion-reduce:active:scale-100";

export function OverspendingHomeAlert({ overspending, onOneOff }: {
  overspending: Overspending;
  onOneOff: () => Promise<void>;
}) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const gap = overspending.on_course.projected_gap!;
  const drivers = overspending.on_course.drivers.slice(0, 2).map(driver => driver.category);
  async function acknowledge() {
    setSaving(true);
    setError(null);
    try { await onOneOff(); }
    catch { setError("We could not save that. Try again."); }
    finally { setSaving(false); }
  }
  return (
    <section className="glass-card rounded-2xl p-4" aria-labelledby="overspending-home-title">
      <p className="flex items-center gap-2 text-[11px] font-semibold text-slate-600 dark:text-slate-300">
        <span className="size-1.5 shrink-0 rounded-full bg-amber-500" aria-hidden="true" />Ahead of payday
      </p>
      <h2 id="overspending-home-title" className="mt-2 text-pretty text-[17px] font-bold text-slate-950 dark:text-white">
        At this pace, spending may pass income
      </h2>
      <p className="mt-3 flex flex-wrap items-baseline gap-x-2 gap-y-1 text-sm leading-5 text-slate-600 dark:text-slate-300">
        <MoneyText text={money(gap)} className="text-xl font-bold text-slate-950 dark:text-white" />
        <span>more out than in · estimated</span>
      </p>
      <p className="mt-3 text-sm leading-5 text-slate-600 dark:text-slate-300">
        By {nextDay(overspending.period.end)}, if this pace continues.{drivers.length ? ` Mostly ${list.format(drivers)}.` : ""}
      </p>
      <p className="mt-3 text-xs leading-5 text-slate-600 dark:text-slate-400">You will only see this heads-up once this pay period.</p>
      <div className="mt-4 space-y-2">
        <Link href="/spend?overspending=1" className={`inline-flex min-h-11 w-full items-center justify-center rounded-xl bg-indigo-600 px-3 text-[13px] font-semibold text-white hover:bg-indigo-700 ${press} ${focus} focus-visible:ring-offset-2 dark:focus-visible:ring-offset-slate-900`}>
          Show me where
        </Link>
        <button type="button" onClick={() => { void acknowledge(); }} disabled={saving} className={`min-h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-[13px] font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700 ${press} ${focus}`}>
          {saving ? "Saving…" : "Expected, it’s a one-off"}
        </button>
      </div>
      <p className="mt-2 text-xs leading-5 text-slate-600 dark:text-slate-400">Choosing one-off silences overspending heads-ups for this pay period.</p>
      {error && <p role="alert" className="mt-2 flex items-start gap-2 text-xs leading-5 text-slate-700 dark:text-slate-200">
        <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-amber-500" aria-hidden="true" />{error}
      </p>}
    </section>
  );
}

export function OverspendingDetailsSheet({ overspending, verdict, id, onClose, onOpenCategory }: {
  overspending: Overspending;
  verdict: SpendVerdict;
  id: string;
  onClose: () => void;
  onOpenCategory: (category: string) => void;
}) {
  const projected = hasProjectedOverspending(overspending);
  const crossed = overspending.crossed;
  const pace = spendHeroModel(verdict);
  const funding = [
    overspending.funded_by.cards > 0 ? `${money(overspending.funded_by.cards)} went onto cards` : null,
    overspending.funded_by.savings > 0 ? `${money(overspending.funded_by.savings)} came from savings` : null,
    overspending.funded_by.current_account > 0 ? `${money(overspending.funded_by.current_account)} came from current accounts` : null,
  ].filter((part): part is string => part != null);
  const usual = pace.direction === "above" ? "Spending is above your usual pace."
    : pace.direction === "below" ? "Spending is below your usual pace."
      : pace.direction === "level" ? "Spending is in line with your usual pace."
        : verdict.state === "early" ? "A reliable pace comparison appears later in the pay period."
          : "We need more spending history before showing your usual pace.";
  return (
    <SheetFrame title={crossed ? "More out than in" : projected ? "May pass income" : "Spending details"} description="This compares money in and out separately from your usual spending pace." onClose={onClose}>
      {({ closeThen }) => <div id={id} className="space-y-4">
        {crossed ? <>
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">This pay period</p>
            <p className="mt-1 text-[20px] font-bold leading-snug text-slate-950 dark:text-white"><MoneyText text={`${money(overspending.gap)} more out than in`} /></p>
            <dl className="mt-4 space-y-2 text-[13px] text-slate-600 dark:text-slate-300">
              {[{ label: "Out", amount: overspending.out }, { label: "In", amount: overspending.in }].map(row => <div key={row.label} className="flex items-baseline justify-between gap-4">
                <dt>{row.label}</dt><dd className="font-semibold text-slate-950 dark:text-white"><MoneyText text={money(row.amount)} /></dd>
              </div>)}
            </dl>
          </div>
          {funding.length > 0 && <p className="text-sm leading-5 text-slate-600 dark:text-slate-300"><MoneyText text={`About ${list.format(funding)}.`} /></p>}
          {overspending.trend.periods_considered > 0 && <p className="border-t border-slate-200 pt-4 text-sm leading-5 text-slate-600 dark:border-slate-700 dark:text-slate-300">
            <span className="block" data-overspending-divider-content>Savings covered part of the gap in {overspending.trend.dipped_count} of the last {overspending.trend.periods_considered} completed pay periods.</span>
          </p>}
        </> : projected ? <>
          <p className="text-sm leading-5 text-slate-600 dark:text-slate-300"><MoneyText text={`At this pace, Out may be ${money(overspending.on_course.projected_gap!)} more than In by ${nextDay(overspending.period.end)} · estimated.`} /></p>
          {overspending.on_course.drivers.length > 0 && <div>
            <p className="text-sm font-semibold text-slate-950 dark:text-white">Where it is showing up</p>
            <div className="mt-2 divide-y divide-slate-100 dark:divide-slate-700">
              {overspending.on_course.drivers.slice(0, 2).map(driver => <a key={driver.category} href={overspendingCategoryHref(driver.category, overspending.period)}
                onClick={event => {
                  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
                  event.preventDefault();
                  closeThen(() => onOpenCategory(driver.category));
                }}
                className={`flex min-h-11 w-full items-center justify-between gap-3 py-2 text-left text-sm font-semibold text-indigo-700 hover:underline dark:text-indigo-300 ${focus}`}>
                <span className="min-w-0 break-words">{driver.category}</span>
                <span className="shrink-0 text-right"><MoneyText text={money(driver.excess)} /><span className="block text-[11px] font-normal text-slate-600 dark:text-slate-300">above usual</span></span>
              </a>)}
            </div>
          </div>}
        </> : <p className="text-sm leading-5 text-slate-600 dark:text-slate-300">Out remains within income for this pay period.</p>}
        <div className="border-t border-slate-200 pt-4 dark:border-slate-700">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Usual pace</p>
          <p className="mt-1 text-sm leading-5 text-slate-600 dark:text-slate-300">{pace.status}. {usual}</p>
        </div>
      </div>}
    </SheetFrame>
  );
}

export function OverspendingStatusPill({ label, caution, controls, expanded, onOpen }: {
  label: string;
  caution: boolean;
  controls: string;
  expanded: boolean;
  onOpen: () => void;
}) {
  return <button type="button" onClick={onOpen} aria-haspopup="dialog" aria-expanded={expanded} aria-controls={controls} aria-label={`${label}. Open spending details.`}
    className={`inline-flex min-h-11 touch-manipulation items-center gap-0.5 rounded-full px-1 py-1 text-[11px] font-semibold transition-colors ${press} ${focus} min-[360px]:gap-1 min-[360px]:px-2 motion-reduce:transition-none ${caution ? "bg-amber-50 text-slate-700 hover:bg-amber-100 dark:bg-amber-400/10 dark:text-slate-100 dark:hover:bg-amber-400/20" : "bg-slate-100 text-slate-700 hover:bg-slate-200 dark:bg-slate-700 dark:text-slate-200 dark:hover:bg-slate-600"}`}>
    {caution && <span className="size-1.5 shrink-0 rounded-full bg-amber-500" aria-hidden="true" />}<span>{label}</span><ChevronDown size={13} aria-hidden="true" />
  </button>;
}
