import type { SyncStatus } from "@/lib/api";

/** An empty accounts snapshot alone cannot prove that no bank is connected.
 * During first sync the connection and transactions can precede that list. */
export function hasHomeConnectionEvidence(o: {
  status: SyncStatus | null;
  bankConnectionCount: number;
  recentCount: number;
  pendingCount: number;
}): boolean {
  return o.status?.has_connections === true
    || (o.status?.connections.length ?? 0) > 0
    || o.bankConnectionCount > 0
    || o.recentCount > 0
    || o.pendingCount > 0;
}
