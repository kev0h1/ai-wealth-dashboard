// G389: pure facts and copy for the Accounts overview refresh.  A successful
// request only starts Finexer's asynchronous work: an updated bank as-of time
// is the sole proof that an account's data arrived.

import type { Account, SyncStatus } from "@/lib/api";

export const REFRESH_POLL_MS = 3_000;
export const REFRESH_TIMEOUT_MS = 120_000;
export const RATE_LIMIT_COOLDOWN_MS = 60_000;

export type RefreshBaseline = Map<string, number | null>;

export function isConnectedBankAccount(account: Pick<Account, "id" | "manual" | "connection_id">): boolean {
  return !account.manual && !account.id.startsWith("statement-") && !!account.connection_id;
}

export function isRefreshEligible(account: Pick<Account, "id" | "manual" | "connection_id" | "paused">): boolean {
  return isConnectedBankAccount(account) && !account.paused;
}

function time(iso: string | null | undefined): number | null {
  const value = iso ? Date.parse(iso) : NaN;
  return Number.isFinite(value) ? value : null;
}

function relativeTime(iso: string, now: number): string {
  const milliseconds = Math.max(0, now - Date.parse(iso));
  const minutes = Math.floor(milliseconds / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} ${hours === 1 ? "hour" : "hours"} ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return "yesterday";
  if (days < 7) return `${days} days ago`;
  return new Date(Date.parse(iso)).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "Europe/London" });
}

/** The oldest reported bank as-of time, including paused connections. */
export function accountsFreshness(accounts: readonly Account[], now = Date.now()): string {
  const banks = accounts.filter(isConnectedBankAccount);
  if (banks.length === 0) return "No connected bank data yet.";
  const reported = banks
    .map((account) => ({ account, at: time(account.bank_synced_to) }))
    .filter((entry): entry is { account: Account; at: number } => entry.at !== null);
  if (reported.length === 0) return "Bank data time not reported yet.";
  const oldest = reported.reduce((earliest, entry) => entry.at < earliest.at ? entry : earliest);
  const missing = reported.length !== banks.length;
  return `Oldest bank data from ${relativeTime(oldest.account.bank_synced_to!, now)}${missing ? ". Some bank times are not reported." : "."}`;
}

export function refreshBaseline(accounts: readonly Account[]): RefreshBaseline {
  return new Map(accounts.filter(isRefreshEligible).map((account) => [account.id, time(account.bank_synced_to)]));
}

export type RefreshProgress = "waiting" | "updated" | "partial";

/**
 * Compare only bank-owned as-of times. A missing baseline cannot be claimed as
 * an advance, even if it later gets a value, because there is no old time to
 * compare against.
 */
export function refreshProgress(accounts: readonly Account[], baseline: RefreshBaseline): RefreshProgress {
  if (baseline.size === 0) return "waiting";
  let advanced = 0;
  let unresolved = 0;
  const current = new Map(accounts.map((account) => [account.id, account]));
  for (const [id, before] of baseline) {
    const after = time(current.get(id)?.bank_synced_to);
    if (before !== null && before !== undefined && after !== null && after > before) advanced += 1;
    else unresolved += 1;
  }
  if (advanced > 0 && unresolved === 0) return "updated";
  return advanced > 0 ? "partial" : "waiting";
}

/** A stable record of the bank times that have genuinely advanced. */
export function advancedTimestampSignature(accounts: readonly Account[], baseline: RefreshBaseline): string {
  const current = new Map(accounts.map((account) => [account.id, account]));
  return [...baseline.entries()]
    .map(([id, before]) => {
      const after = time(current.get(id)?.bank_synced_to);
      return before !== null && after !== null && after > before ? `${id}:${after}` : null;
    })
    .filter((entry): entry is string => entry !== null)
    .sort()
    .join("|");
}

export function refreshCooldown(accounts: readonly Account[], now = Date.now()): number | null {
  const eligible = accounts.filter(isRefreshEligible);
  if (eligible.length === 0) return null;
  const future = eligible.map((account) => time(account.bank_next_refresh_at)).filter((at): at is number => at !== null && at > now);
  return future.length === eligible.length ? Math.min(...future) : null;
}

export function refreshCooldownMessage(nextAt: number): string {
  return `Refresh available from ${new Date(nextAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Europe/London" })}.`;
}

export function syncFailureMessage(status: SyncStatus | null): string | null {
  if (status?.state === "failed" || status?.connections?.some((connection) => connection.state === "failed" || !!connection.error)) {
    return "We could not refresh every bank. Your last known balances stay visible. Try again soon.";
  }
  return null;
}

/** Identifies a reported failure without relying on the client clock. */
export function syncFailureKey(status: SyncStatus | null): string | null {
  if (!syncFailureMessage(status)) return null;
  return [status?.state, ...(status?.connections ?? []).map((connection) => `${connection.connection_id ?? ""}:${connection.state ?? ""}:${connection.error ?? ""}`)].join("|");
}
