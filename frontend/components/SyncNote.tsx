"use client";

// G214 (approved B, stale-marked figure): what Home's hero and the Accounts page say while a bank sync is
// running that is NOT a first sync (manual refresh, a new bank for an
// established user, a background sync). Built from the G202/G210 progress
// ledger primitives so loading reads the same everywhere. The last known
// figures stay on screen and go neutral ink: no blanking, and no stale red or
// green verdict flashing (The Red Is Risk Rule: a sync is never risk). No
// gradient (The Penny Gradient Rule). Only the ring animates, and it goes
// static under reduced motion. A stall or failure ends in plain words with a
// retry, never an endless spinner.
// Props-driven so /design/sync-loading renders the production components.

import { Hollow, Ring } from "@/components/ProgressLedger";
import { bankLabel } from "@/lib/bankLabel";

export type SyncKind = "refresh" | "new-bank" | "background";
export type SyncPhase = "syncing" | "stalled" | "failed";

export type SyncingInfo = {
  kind: SyncKind;
  /** Bank name or provider slug; absent reads as "your bank". */
  bank?: string;
  /** Epoch ms the sync started; past 10 minutes counts as stalled. */
  startedAt?: number;
  stalled?: boolean;
  failed?: boolean;
  /** When the figures on screen were last good (ISO). */
  asOf?: string | null;
};

export const SYNC_STALL_MS = 10 * 60 * 1000;

export function syncPhase(info: SyncingInfo, now: number = Date.now()): SyncPhase {
  if (info.failed) return "failed";
  if (info.stalled) return "stalled";
  if (info.startedAt != null && now - info.startedAt > SYNC_STALL_MS) return "stalled";
  return "syncing";
}

export function syncBank(info: SyncingInfo): string {
  return info.bank ? bankLabel(info.bank) : "your bank";
}

export function asOfLabel(iso?: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
}

/** The one sentence a sync says, for the hero and the rows. */
export function syncLine(info: SyncingInfo): string {
  const bank = syncBank(info);
  const phase = syncPhase(info);
  const saved = info.kind === "new-bank" ? "No figures received yet." : "Showing saved figures.";
  if (phase === "failed") return `Could not update ${bank}. ${saved}`;
  if (phase === "stalled") return `${bank[0].toUpperCase()}${bank.slice(1)} is taking longer than usual. ${saved}`;
  if (info.kind === "new-bank") return `Fetching from ${bank}. Not in your figure yet.`;
  return `Updating from ${bank}`;
}

export function syncChipLabel(info: SyncingInfo): string {
  const phase = syncPhase(info);
  return phase === "failed" ? "Not updated" : phase === "stalled" ? "Update delayed" : "Updating";
}

export const syncChipClass = "bg-slate-100 text-slate-600 dark:bg-slate-700/70 dark:text-slate-300";

export function SyncGlyph({ phase }: { phase: SyncPhase }) {
  return phase === "syncing" ? <Ring /> : <Hollow />;
}

const retryClass =
  "min-h-11 shrink-0 rounded-lg px-2 text-[13px] font-semibold text-indigo-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:text-indigo-400";

export function SyncRetry({ onRetry }: { onRetry?: () => void }) {
  if (!onRetry) return null;
  return (
    <button type="button" onClick={onRetry} className={retryClass}>
      Try again
    </button>
  );
}

/** One line: glyph, words, and a retry once it has stopped. */
export function SyncLine({ info, onRetry, className = "mt-3" }: { info: SyncingInfo; onRetry?: () => void; className?: string }) {
  const phase = syncPhase(info);
  return (
    <div role="status" aria-live="polite" data-sync-phase={phase} className={`flex items-center gap-2 ${className}`}>
      <SyncGlyph phase={phase} />
      <p className="min-w-0 flex-1 text-[13px] leading-snug text-slate-600 dark:text-slate-300 text-pretty">{syncLine(info)}</p>
      {phase !== "syncing" ? <SyncRetry onRetry={onRetry} /> : null}
    </div>
  );
}

function pageTitle(phase: SyncPhase): string {
  return phase === "failed" ? "Some bank data could not be updated" : phase === "stalled" ? "Some bank data is delayed" : "Updating bank data";
}

/** Page-level banner for Accounts (G214 approved B): ring plus words, and a
 * retry once a sync has stopped. The worst phase speaks for the page. */
export function AccountsSyncBanner({ connections, onRetry }: { connections: SyncingInfo[]; onRetry?: () => void }) {
  const phases = connections.map((c) => syncPhase(c));
  const phase: SyncPhase = phases.includes("failed") ? "failed" : phases.includes("stalled") ? "stalled" : "syncing";
  const asOf = asOfLabel(connections.find((c) => c.asOf)?.asOf);
  return (
    <div data-sync-phase={phase} data-sync-banner className="px-1">
      <div className="flex items-center gap-2">
        <SyncGlyph phase={phase} />
        <p role="status" aria-live="polite" className="min-w-0 flex-1 text-[13px] font-medium text-slate-700 dark:text-slate-200">
          {pageTitle(phase)}
          {asOf && phase !== "syncing" ? <span className="font-normal text-slate-600 dark:text-slate-300">{` · saved figures as of ${asOf}`}</span> : null}
        </p>
        {phase !== "syncing" ? <SyncRetry onRetry={onRetry} /> : null}
      </div>
    </div>
  );
}
