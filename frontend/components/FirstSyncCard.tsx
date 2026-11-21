"use client";

// G210: what Home says while a first bank sync is running, stuck or failed.
// Reuses the G202 progress ledger so first-run loading reads the same as the
// sign-in panel. No red anywhere (The Red Is Risk Rule: a sync that has not
// finished is not financial risk), no gradient (that belongs to Penny).
// G214 (approved B): in the same grammar as the Safe to Spend hero while it
// syncs, so the first sign-up and every later sync read as one system: the
// "Safe to Spend" label with the chip-and-ring, a figure slot that says "No
// figure yet" in secondary ink (never an amount, never a verdict), then the
// ledger. Props-driven so /design renders this exact component.

import type { ReactNode } from "react";
import { Check, Hollow, Primary, Ring, Row, Secondary, Status, ledger } from "@/components/ProgressLedger";
import { bankLabel } from "@/lib/bankLabel";
import { syncChipClass } from "@/components/SyncNote";

export type FirstSyncConnection = {
  provider: string;
  connection_id?: string | null;
  bank?: string | null;
  started_at?: string | null;
  error?: string | null;
  phase?: "fetching" | "computing";
};

export type FirstSyncState = "syncing" | "stalled" | "failed";

export { bankLabel };

export function firstSyncCopy(state: FirstSyncState, bank: string, computing = false): { title: string; line: string } {
  if (state === "stalled") {
    return {
      title: computing ? "Still working out your figures" : `Still fetching from ${bank}`,
      line: "This is taking longer than usual. You can wait, or try again.",
    };
  }
  if (state === "failed") {
    return {
      title: "We couldn’t finish the first sync",
      line: computing ? "Your transactions arrived, but we couldn’t finish working out your figures. Try again." : "Your bank connected, but we couldn’t bring your transactions across. Try again, or connect a different bank.",
    };
  }
  return {
    title: computing ? "Working out your figures" : `Fetching from ${bank}`,
    line: "This usually takes a minute or two.",
  };
}

const chipLabel: Record<FirstSyncState, string> = { syncing: "Updating", stalled: "Update delayed", failed: "Not updated" };

export default function FirstSyncCard({
  state,
  connections = [],
  onRetry,
  onConnect,
  retrying = false,
  surface = "home",
}: {
  state: FirstSyncState;
  connections?: FirstSyncConnection[];
  onRetry?: () => void;
  onConnect?: () => void;
  retrying?: boolean;
  surface?: "home" | "spend" | "upcoming";
}) {
  const bank = bankLabel(connections.find((c) => c.bank)?.bank ?? null);
  const computing = connections.length > 0 && connections.every((c) => c.phase === "computing");
  const c = firstSyncCopy(state, bank, computing);
  const label = { home: "Estimated left to spend", spend: "Spending this pay period", upcoming: "Before payday" }[surface];
  const waitingFor = bank === "Your bank" ? "your bank" : bank;
  const explanation = surface === "spend"
    ? `We will show your spending once ${waitingFor} has synced and your figures are ready`
    : surface === "upcoming"
      ? `We will show what is expected once ${waitingFor} has synced and your figures are ready`
      : `We will show your estimated left to spend once ${waitingFor} has synced`;
  const rows: ReactNode =
    state === "failed" ? (
      <>
        <Row icon={<Check />} label={`${bank} connected`} value="Done" />
        <Row icon={computing ? <Check /> : <Hollow />} label="Fetching transactions" value={computing ? "Done" : "Stopped"} />
        <Row icon={<Hollow />} label="Working out your figures" value={computing ? "Stopped" : "Next"} />
      </>
    ) : (
      <>
        <Row icon={<Check />} label={`${bank} connected`} value="Done" />
        <Row icon={computing ? <Check /> : state === "stalled" ? <Hollow /> : <Ring />} label="Fetching transactions" value={computing ? "Done" : state === "stalled" ? "Slow" : "Fetching"} />
        <Row icon={computing ? state === "stalled" ? <Hollow /> : <Ring /> : <Hollow />} label="Working out your figures" value={computing ? state === "stalled" ? "Slow" : "Updating" : "Next"} />
      </>
    );
  return (
    <section
      aria-label="First bank sync"
      aria-busy={state !== "failed"}
      data-first-sync-state={state}
      className="glass-hero space-y-5 rounded-3xl p-5 [overflow-wrap:anywhere]"
    >
      <div>
        <div className="flex items-center justify-between gap-3">
          <p className="min-w-0 text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">{label}</p>
          <span data-sync-chip={state} className={`inline-flex min-h-7 shrink-0 items-center gap-1.5 rounded-full px-2.5 text-[11px] font-semibold ${syncChipClass}`}>
            {state === "syncing" ? <Ring /> : <Hollow />}
            {chipLabel[state]}
          </span>
        </div>
        <p data-first-sync-slot className="mt-5 text-[38px] font-bold leading-none tracking-[-0.05em] text-slate-500 dark:text-slate-400">No figure yet</p>
        <p className="mt-2 text-[15px] font-semibold text-slate-700 dark:text-slate-200">
          {explanation}
        </p>
      </div>
      <Status title={c.title} line={c.line} />
      <ol aria-label="Sync stages" className={ledger}>
        {rows}
      </ol>
      {state === "stalled" && onRetry ? (
        <Secondary onClick={retrying ? undefined : onRetry}>{retrying ? "Trying again" : "Try again"}</Secondary>
      ) : null}
      {state === "failed" ? (
        <div className="space-y-3">
          {onRetry ? <Primary onClick={retrying ? undefined : onRetry}>{retrying ? "Trying again" : "Try again"}</Primary> : null}
          {onConnect ? <Secondary onClick={onConnect}>Connect a different bank</Secondary> : null}
        </div>
      ) : null}
    </section>
  );
}
