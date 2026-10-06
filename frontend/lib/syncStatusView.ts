// G214: pure helpers behind the sync-loading treatment. Kept free of React so
// node tests pin the kind derivation, the per-connection phases and the poll
// schedule. The server owns "stalled" and "failed" (GET /sync/status); the
// client never decides them from its own clock.

import type { SyncStatus } from "@/lib/api";
import type { SyncKind, SyncingInfo } from "@/components/SyncNote";

export const POLL_SYNCING_MS = 3000;
export const POLL_STALLED_MS = 15000;

type Conn = NonNullable<SyncStatus["connections"]>[number];

/** Next poll interval for a server state; null means nothing to poll
 * (idle, or failed: nothing is running, Try again restarts it). */
export function pollDelayMs(state: SyncStatus["state"] | null | undefined): number | null {
  if (state === "syncing") return POLL_SYNCING_MS;
  if (state === "stalled") return POLL_STALLED_MS;
  return null;
}

/** A tick runs only when the tab is visible and no request is in flight. */
export function shouldPollTick(o: { visible: boolean; inFlight: boolean; cancelled: boolean }): boolean {
  return o.visible && !o.inFlight && !o.cancelled;
}

/**
 * Which kind of sync this is. A connection the server reports as never
 * synced, for a user who has others, is a new bank. Otherwise a sync the user
 * started is a refresh, and anything else is a background sync.
 */
export function deriveSyncKind(o: { firstSync: boolean; hasUnsyncedConnection: boolean; userTriggered: boolean }): SyncKind {
  if (o.hasUnsyncedConnection && !o.firstSync) return "new-bank";
  if (o.userTriggered) return "refresh";
  return "background";
}

function connInfo(c: Conn, status: SyncStatus, asOf?: string | null): SyncingInfo {
  const phase = c.state ?? (c.error ? "failed" : status.state === "stalled" ? "stalled" : "syncing");
  return {
    kind: c.kind === "background"
      ? "background"
      : deriveSyncKind({ firstSync: status.first_sync === true, hasUnsyncedConnection: true, userTriggered: false }),
    bank: c.bank ?? undefined,
    failed: phase === "failed",
    stalled: phase === "stalled",
    asOf: asOf ?? null,
  };
}

/** One entry per connection the server says is not yet synced, keyed by connection id. */
export function connectionSyncInfos(status: SyncStatus | null | undefined, asOf?: string | null): Map<string, SyncingInfo> {
  const out = new Map<string, SyncingInfo>();
  if (!status || status.state === "idle") return out;
  for (const c of status.connections ?? []) {
    if (c.connection_id) out.set(c.connection_id, connInfo(c, status, asOf));
  }
  return out;
}

/**
 * What Home's hero says. Null means the hero renders normally: idle, or a
 * genuine first sync (FirstSyncCard owns that case). A user-started refresh
 * shows while it runs (or after it failed); a server-reported new bank shows
 * its own phase, with stalled/failed taken from the server.
 */
export function heroSyncingInfo(o: {
  status: SyncStatus | null | undefined;
  refreshing: boolean;
  refreshFailed: boolean;
  asOf?: string | null;
}): SyncingInfo | null {
  const { status } = o;
  if (status && status.first_sync === true && status.state !== "idle") return null;
  if (status && status.state !== "idle" && (status.connections ?? []).length > 0) {
    const conns = status.connections;
    const worst = conns.find((c) => c.state === "failed") ?? conns.find((c) => c.state === "stalled") ?? conns[0];
    const info = connInfo(worst, status, o.asOf);
    // A re-sync the user just asked for reads as a refresh, not a background one.
    if (info.kind === "background" && o.refreshing) info.kind = "refresh";
    if (!info.failed && !info.stalled && status.state === "stalled") info.stalled = true;
    if (!info.failed && !info.stalled && status.state === "failed") info.failed = true;
    return info;
  }
  if (o.refreshFailed) return { kind: "refresh", failed: true, asOf: o.asOf ?? null };
  if (o.refreshing) return { kind: "refresh", asOf: o.asOf ?? null };
  return null;
}

/** Connections the server reports as syncing that own no account yet. */
export function pendingConnectionInfos(
  infos: Map<string, SyncingInfo>,
  accounts: readonly { connection_id?: string }[],
): [string, SyncingInfo][] {
  const owned = new Set(accounts.map((a) => a.connection_id).filter(Boolean));
  return [...infos.entries()].filter(([id]) => !owned.has(id));
}
