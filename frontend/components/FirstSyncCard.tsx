"use client";

// G210: what Home says while a first bank sync is running, stuck or failed.
// Reuses the G202 progress ledger so first-run loading reads the same as the
// sign-in panel. No red anywhere (The Red Is Risk Rule: a sync that has not
// finished is not financial risk), no gradient (that belongs to Penny).
// Props-driven so /design/first-sync renders this exact component.

import type { ReactNode } from "react";
import { Check, Hollow, Primary, Ring, Row, Secondary, Status, ledger } from "@/components/ProgressLedger";

export type FirstSyncConnection = {
  provider: string;
  connection_id?: string | null;
  bank?: string | null;
  started_at?: string | null;
  error?: string | null;
};

export type FirstSyncState = "syncing" | "stalled" | "failed";

// Provider ids come through as slugs ("ob-barclays"); show them as a name.
export function bankLabel(raw?: string | null): string {
  const cleaned = (raw ?? "").replace(/^ob-/i, "").replace(/[-_]+/g, " ").trim();
  if (!cleaned) return "Your bank";
  return cleaned.replace(/\b\w/g, (c) => c.toUpperCase());
}

export function firstSyncCopy(state: FirstSyncState, bank: string): { title: string; line: string } {
  if (state === "stalled") {
    return {
      title: `Still fetching from ${bank}`,
      line: "This is taking longer than usual. You can wait, or try again.",
    };
  }
  if (state === "failed") {
    return {
      title: "We couldn’t finish the first sync",
      line: "Your bank connected, but we couldn’t bring your transactions across. Try again, or connect a different bank.",
    };
  }
  return {
    title: `Fetching from ${bank}`,
    line: "This usually takes a minute or two.",
  };
}

export default function FirstSyncCard({
  state,
  connections = [],
  onRetry,
  onConnect,
  retrying = false,
}: {
  state: FirstSyncState;
  connections?: FirstSyncConnection[];
  onRetry?: () => void;
  onConnect?: () => void;
  retrying?: boolean;
  nowMs?: number;
}) {
  const bank = bankLabel(connections.find((c) => c.bank)?.bank ?? null);
  const c = firstSyncCopy(state, bank);
  const rows: ReactNode =
    state === "failed" ? (
      <>
        <Row icon={<Check />} label={`${bank} connected`} value="Done" />
        <Row icon={<Hollow />} label="Fetching transactions" value="Stopped" />
        <Row icon={<Hollow />} label="Working out your figures" value="Next" />
      </>
    ) : (
      <>
        <Row icon={<Check />} label={`${bank} connected`} value="Done" />
        <Row icon={<Ring />} label="Fetching transactions" value={state === "stalled" ? "Slow" : "Fetching"} />
        <Row icon={<Hollow />} label="Working out your figures" value="Next" />
      </>
    );
  return (
    <section
      aria-label="First bank sync"
      aria-busy={state !== "failed"}
      data-first-sync-state={state}
      className="glass-card space-y-5 rounded-2xl p-5"
    >
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
