"use client";

// G231: the account sheet's "Count towards Left to spend" row. A switch (default
// on), one helper line, and, when the server refuses because the account pays
// something this pay period, the reason inline under the helper. Presentational
// only: the page owns the request, so /design previews can render it with
// fixture props.

import { useId } from "react";
import Toggle from "@/components/Toggle";

export const COUNT_TOWARDS_LABEL = "Count towards Left to spend";
export const COUNT_TOWARDS_HELPER = "Turn off for accounts you do not spend from, like a joint bills account.";

export interface CountTowardsSafeToSpendRowProps {
  counted: boolean;
  onChange: (next: boolean) => void;
  busy?: boolean;
  /** The server's plain refusal reason, shown inline until the next attempt. */
  reason?: string | null;
  /** G406: part of the account facts, without a separate card surface. */
  compact?: boolean;
  calm?: boolean;
  lockedReason?: string;
}

export default function CountTowardsSafeToSpendRow({ counted, onChange, busy, reason, compact = false, calm = false, lockedReason }: CountTowardsSafeToSpendRowProps) {
  const helperId = useId();
  if (calm) {
    const label = "Include in estimated left to spend";
    const helper = lockedReason ?? (counted ? "Turn off for an account you do not spend from." : "Excluded from this estimate.");
    return <div data-g231-count-row data-g407-inclusion>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1 py-1"><p className="text-[13px] font-medium">{label}</p><p id={helperId} className="mt-1 text-[12px] leading-5 text-slate-600 dark:text-slate-300">{helper}</p></div>
        <button type="button" role="switch" aria-label={label} aria-describedby={`${helperId}${reason ? ` ${helperId}-reason` : ""}`} aria-checked={counted} disabled={busy || !!lockedReason} onClick={() => onChange(!counted)} className="grid h-11 min-w-12 shrink-0 touch-manipulation place-items-center rounded-lg enabled:hover:bg-slate-100 dark:enabled:hover:bg-slate-800 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500">
          <span aria-hidden="true" className={`relative h-6 w-12 rounded-full transition-colors ${counted ? "bg-indigo-600" : "bg-slate-300 dark:bg-slate-600"} ${busy || lockedReason ? "opacity-60" : ""}`}><span className={`absolute left-0.5 top-0.5 size-5 rounded-full bg-white shadow-sm transition-transform motion-reduce:transition-none ${counted ? "translate-x-6" : ""}`} /></span>
        </button>
      </div>
      {reason && <p id={`${helperId}-reason`} data-g231-count-reason role="alert" className="mt-2 text-[13px] text-slate-700 dark:text-slate-200">{reason}</p>}
    </div>;
  }
  return (
    <div data-g231-count-row className={compact ? "py-1" : "glass-card rounded-2xl px-4 py-2"}>
      <div className="flex min-h-11 items-center justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className={`${compact ? "text-[13px] font-medium" : "text-[15px] font-semibold"} text-slate-900 dark:text-slate-100`}>{COUNT_TOWARDS_LABEL}</p>
          <p className={`mt-0.5 text-[12.5px] leading-snug text-pretty ${compact ? "text-slate-600 dark:text-slate-300" : "text-slate-500 dark:text-slate-400"}`}>{COUNT_TOWARDS_HELPER}</p>
        </div>
        <Toggle checked={counted} disabled={busy} onChange={() => onChange(!counted)} label={COUNT_TOWARDS_LABEL} />
      </div>
      {reason ? (
        <p data-g231-count-reason role="alert" className="mb-1 mt-1 flex items-start gap-2 text-[13px] leading-snug text-slate-700 dark:text-slate-200 text-pretty">
          <span aria-hidden="true" className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-slate-400 dark:bg-slate-500" />
          {reason}
        </p>
      ) : null}
    </div>
  );
}
