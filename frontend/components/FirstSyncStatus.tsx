"use client";

import { Secondary, Ring } from "@/components/ProgressLedger";

/** Unknown status must not turn into a zero or an all-clear message. */
export default function FirstSyncStatus({ error, figuresError = false, onRetry }: { error: boolean; figuresError?: boolean; onRetry: () => void }) {
  return (
    <div className="space-y-3 py-8" role="status">
      <p className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
        {error ? null : <Ring />}
        {error ? figuresError ? "Couldn’t load your figures. Try again." : "Couldn’t check your bank sync. Try again to load your figures." : "Checking your bank sync…"}
      </p>
      {error ? <Secondary onClick={onRetry}>Try again</Secondary> : null}
    </div>
  );
}
