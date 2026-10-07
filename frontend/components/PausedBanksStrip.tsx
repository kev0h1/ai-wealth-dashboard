"use client";

// B45: shown on Accounts when the plan has no open banking (Statements,
// after a cancelled or lapsed subscription or a trial that did not convert).
// The accounts and everything already synced stay readable; only the live
// sync has stopped. Neutral ink with a pause glyph, not amber or red: this
// is a plan state the user can fix, not a financial risk (DESIGN.md: red
// means genuine risk only). Presentational, copy lives in lib/billingCopy.ts.

import Link from "next/link";
import { Pause } from "lucide-react";
import { pausedBanksBody, PAUSED_BANKS_TITLE, RESUBSCRIBE_HREF, RESUBSCRIBE_LABEL } from "@/lib/billingCopy";

export default function PausedBanksStrip({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <div role="status" className="glass-card rounded-2xl px-4 py-3">
      <p className="flex items-center gap-2 text-sm font-semibold text-slate-800 dark:text-slate-100">
        <Pause size={14} aria-hidden="true" className="shrink-0 text-slate-500 dark:text-slate-400" />
        {PAUSED_BANKS_TITLE}
      </p>
      <p className="mt-1 text-xs leading-relaxed text-slate-600 dark:text-slate-300">{pausedBanksBody(count)}</p>
      <Link
        href={RESUBSCRIBE_HREF}
        className="mt-2 inline-flex min-h-11 items-center rounded-xl px-3 text-sm font-medium text-indigo-600 outline-none transition-colors hover:bg-indigo-50 active:scale-[0.98] focus-visible:ring-2 focus-visible:ring-indigo-500 dark:text-indigo-400 dark:hover:bg-indigo-900/10"
      >
        {RESUBSCRIBE_LABEL}
      </Link>
    </div>
  );
}
