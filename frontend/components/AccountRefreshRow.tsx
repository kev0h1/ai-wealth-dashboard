"use client";

// A179: the account sheet's bank data line with a Refresh control beside it.
// The line is A176's "Bank data from ..." (the bank's own as-of time). The
// control is disabled with "Next refresh from {time}" while the bank's
// once-an-hour rule holds, shows a spinner while running, and then the
// updated as-of time. Calm, never red. The page owns the request; this only
// holds the control's own state, so /design previews can render it.

import { useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { bankDataTimeLine } from "@/lib/accountSheetNotes";
import {
  refreshControlState, refreshNote, type AccountRefreshResult,
} from "@/lib/accountRefresh";
import type { Account } from "@wealth/shared";

export interface AccountRefreshRowProps {
  account: Account;
  /** POST /accounts/{id}/refresh; the page also reloads the accounts after. */
  onRefresh: (id: string) => Promise<AccountRefreshResult>;
  now?: number;
  /** G406: quiet account-facts row, retaining the same refresh lifecycle. */
  compact?: boolean;
}

export default function AccountRefreshRow({ account, onRefresh, now, compact = false }: AccountRefreshRowProps) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<AccountRefreshResult | null>(null);
  const [failed, setFailed] = useState(false);
  const [tick, setTick] = useState(() => now ?? Date.now());

  // Re-enable the button when the hourly window passes, without a reload.
  const nextIso = result?.next_allowed_at ?? account.bank_next_refresh_at ?? null;
  useEffect(() => {
    if (now !== undefined || !nextIso) return;
    const ms = Date.parse(nextIso) - Date.now();
    if (Number.isNaN(ms) || ms <= 0) return;
    const id = setTimeout(() => setTick(Date.now()), Math.min(ms + 500, 2_147_000_000));
    return () => clearTimeout(id);
  }, [nextIso, now]);

  const state = refreshControlState({ refreshing: busy, nextAllowedAt: nextIso, now: now ?? tick });
  const asOf = result?.bank_synced_to
    ? bankDataTimeLine({ bank_synced_to: result.bank_synced_to, transactions_synced_at: account.transactions_synced_at }, now ?? tick)
    : bankDataTimeLine(account, now ?? tick);
  const note = refreshNote(result, failed);

  async function run() {
    setBusy(true);
    setFailed(false);
    try {
      const r = await onRefresh(account.id);
      setResult(r);
      setTick(Date.now());
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div data-a179-refresh-row className={compact ? "" : "glass-card rounded-2xl px-4 py-2"}>
      <div className={`flex min-h-11 items-center justify-between gap-x-3 ${compact ? "flex-wrap" : ""}`}>
        <p data-a179-asof className={`${compact ? "basis-40" : ""} min-w-0 flex-1 text-[13px] leading-snug text-slate-600 dark:text-slate-300`}>
          {asOf ?? "Bank data time not reported yet"}
        </p>
        <button
          type="button"
          data-a179-refresh-button
          onClick={() => void run()}
          disabled={state.disabled}
          aria-busy={state.spinning}
          className="inline-flex min-h-11 shrink-0 items-center gap-2 rounded-xl px-3 text-[13px] font-semibold text-slate-800 transition-colors hover:bg-slate-900/5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-slate-500 disabled:cursor-not-allowed disabled:text-slate-500 dark:text-slate-100 dark:hover:bg-white/10 dark:disabled:text-slate-400"
        >
          <RefreshCw size={14} aria-hidden="true" className={state.spinning ? "animate-spin" : undefined} />
          <span>{state.label}</span>
        </button>
      </div>
      <p role="status" aria-live="polite" data-a179-refresh-note className={note ? "mb-1 mt-0.5 text-[12.5px] leading-snug text-slate-600 dark:text-slate-300 text-pretty" : "sr-only"}>
        {note ?? ""}
      </p>
    </div>
  );
}
