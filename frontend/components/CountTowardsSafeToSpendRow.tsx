"use client";

// G231: the account sheet's "Count towards Safe to Spend" row. A switch (default
// on), one helper line, and, when the server refuses because the account pays
// something this pay period, the reason inline under the helper. Presentational
// only: the page owns the request, so /design previews can render it with
// fixture props.

import Toggle from "@/components/Toggle";

export const COUNT_TOWARDS_LABEL = "Count towards Safe to Spend";
export const COUNT_TOWARDS_HELPER = "Turn off for accounts you do not spend from, like a joint bills account.";

export interface CountTowardsSafeToSpendRowProps {
  counted: boolean;
  onChange: (next: boolean) => void;
  busy?: boolean;
  /** The server's plain refusal reason, shown inline until the next attempt. */
  reason?: string | null;
}

export default function CountTowardsSafeToSpendRow({ counted, onChange, busy, reason }: CountTowardsSafeToSpendRowProps) {
  return (
    <div data-g231-count-row className="glass-card rounded-2xl px-4 py-2">
      <div className="flex min-h-11 items-center justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-[15px] font-semibold text-slate-900 dark:text-slate-100">{COUNT_TOWARDS_LABEL}</p>
          <p className="mt-0.5 text-[12.5px] leading-snug text-slate-500 dark:text-slate-400 text-pretty">{COUNT_TOWARDS_HELPER}</p>
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
