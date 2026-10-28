"use client";

import { useId, useState, type ReactNode } from "react";
import { Check, ChevronDown } from "lucide-react";
import MoneyText from "@/components/MoneyText";
import { useBalancesHidden } from "@/lib/balancesHidden";
import type { GoalSchedulePreview } from "@/lib/api";

export const scheduleMoney = (amount: number) => `${amount < 0 ? "−" : ""}£${Math.abs(amount).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
export function scheduleDate(value: string): string {
  const date = new Date(`${value.slice(0, 10)}T12:00:00Z`);
  return Number.isFinite(date.getTime()) ? date.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }) : "Date unavailable";
}
export function ScheduleRule({ text }: { text: string }) {
  const hidden = useBalancesHidden();
  if (hidden) return <>Amounts hidden. Show figures to read the contribution rule.</>;
  return <>{text.split(/(\b\d+p\b)/g).map((part, i) => /^\d+p$/.test(part) ? <span className="money" key={i}>{part}</span> : <MoneyText key={i} text={part} />)}</>;
}

/** Approved G351 B. A single border owns each side of the disclosure. No
 * space-y margin may sit between its lower edge and the source account. */
export function GoalScheduleDetails({ preview, name, progress, onEdit, children, paused = false }: {
  preview: GoalSchedulePreview;
  name?: string;
  progress?: number;
  onEdit?: () => void;
  children?: ReactNode;
  paused?: boolean;
}) {
  const hidden = useBalancesHidden();
  const [open, setOpen] = useState(false);
  const id = useId();
  const hasProgress = progress !== undefined;
  const onTrack = hasProgress && progress >= preview.planned_to_date;
  const percentage = preview.total > 0 ? Math.max(0, Math.min(100, (progress ?? 0) / preview.total * 100)) : 0;
  const quiet = "text-slate-600 dark:text-slate-300";
  const label = "text-[11px] font-semibold uppercase tracking-[0.05em] text-slate-500 dark:text-slate-400";
  return <div data-goal-schedule-details className="min-w-0 text-slate-900 dark:text-slate-100">
    {(name || hasProgress) && <div className="mb-5 flex items-start justify-between gap-3">
      {name && <h3 className="min-w-0 break-words text-base font-bold">{hidden ? "Savings goal" : name}</h3>}
      {hasProgress && <p className={`inline-flex shrink-0 items-center gap-1 text-xs ${paused ? quiet : onTrack ? "text-emerald-700 dark:text-emerald-300" : quiet}`}>
        {!paused && (onTrack ? <Check size={14} aria-hidden="true" /> : <span className="h-1.5 w-1.5 rounded-full bg-amber-500" aria-hidden="true" />)}
        {paused ? "Paused" : onTrack ? "On schedule" : "Below schedule"}
      </p>}
    </div>}
    <div>
      <p className={label}>{hasProgress ? "Saved so far" : preview.estimated ? "Estimated goal total" : "Goal total"}</p>
      <p className="mt-2 text-[30px] font-bold leading-tight tracking-tight"><MoneyText text={scheduleMoney(progress ?? preview.total)} /></p>
      <p className={`mt-1 text-xs ${quiet}`}>{hasProgress && <>of <MoneyText text={scheduleMoney(preview.total)} />{preview.estimated ? " estimated" : ""} · </>}By {scheduleDate(preview.end_date)}</p>
    </div>
    {hasProgress && <div className="mt-4">
      <div role="progressbar" aria-label="Goal progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={hidden ? undefined : Math.round(percentage)} aria-valuetext={hidden ? "Progress hidden" : undefined} className="h-1.5 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-700"><div className="h-full rounded-full bg-indigo-600 dark:bg-indigo-400" style={{ width: `${hidden ? 0 : percentage}%` }} /></div>
      <p className={`mt-3 text-xs leading-5 ${quiet}`}>Your schedule planned <MoneyText text={scheduleMoney(preview.planned_to_date)} /> by today{preview.estimated ? " · estimated" : ""}.</p>
    </div>}
    <p className={`mt-4 text-sm leading-6 ${quiet}`}><ScheduleRule text={preview.label} /></p>
    <p className={`mt-1 text-xs ${quiet}`}>Starts {scheduleDate(preview.start_date)}</p>
    <div className="mt-4 flex items-start justify-between gap-3 border-t border-slate-200 py-4 dark:border-slate-700">
      <div className="min-w-0"><p className={`text-sm ${quiet}`}>This pay period{preview.estimated ? " · estimated" : ""}</p><p className={`mt-0.5 text-xs ${quiet}`}>{scheduleDate(preview.current_period.start)} to {scheduleDate(preview.current_period.end)}</p>{paused && <p className={`mt-1 text-xs ${quiet}`}>Schedule paused in Sorted</p>}</div>
      <div className="shrink-0 text-right"><p className="text-sm font-semibold"><MoneyText text={scheduleMoney(preview.current_period.amount)} /></p><p className={`mt-0.5 text-xs ${quiet}`}>Planned</p></div>
    </div>
    <div data-schedule-disclosure className="border-y border-slate-200 dark:border-slate-700">
      <button type="button" aria-expanded={open} aria-controls={id} onClick={() => setOpen(v => !v)} className="flex min-h-12 w-full touch-manipulation items-center justify-center gap-2 rounded-sm px-2 py-3 text-sm font-semibold hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-500 active:opacity-70 dark:hover:bg-slate-700/40">
        {open ? "Hide full schedule" : "See full schedule"}<ChevronDown size={16} className={open ? "rotate-180" : ""} aria-hidden="true" />
      </button>
      {open && <div id={id} className="pb-3">
        <p className={`pb-2 text-xs leading-5 ${quiet}`}>{preview.estimated ? "Estimated contributions, not a record of payments." : "Planned contributions, not a record of payments."}</p>
        <dl className="max-h-72 overflow-y-auto overscroll-contain divide-y divide-slate-200 dark:divide-slate-700">
          {preview.periods.map(period => <div key={period.start} className="flex items-baseline justify-between gap-3 py-3 text-sm"><dt className={`min-w-0 ${quiet}`}>{scheduleDate(period.start)}<span className="block text-xs">to {scheduleDate(period.end)}</span></dt><dd className="shrink-0 font-semibold"><MoneyText text={scheduleMoney(period.amount)} /></dd></div>)}
        </dl>
        {preview.periods.length === 0 && <p className={`text-sm ${quiet}`}>No contributions in this schedule.</p>}
      </div>}
    </div>
    {children && <div className="pt-4">{children}</div>}
    {onEdit && <button type="button" onClick={onEdit} className="mt-4 min-h-11 w-full rounded-xl px-3 text-sm font-semibold text-indigo-700 hover:bg-indigo-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 active:opacity-70 dark:text-indigo-300 dark:hover:bg-indigo-400/10">Edit schedule</button>}
  </div>;
}
