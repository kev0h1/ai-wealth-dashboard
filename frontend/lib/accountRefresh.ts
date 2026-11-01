// A179: copy and state rules for the account sheet's Refresh control. Pure so
// the gate can assert them without rendering the page. British English, no
// em dashes, no red: a refused or slow refresh is a neutral note.

import type { Account } from "@wealth/shared";

export const REFRESH_LABEL = "Refresh";
export const REFRESHING_LABEL = "Refreshing";
export const REFRESH_DONE = "Refreshed";
export const REFRESH_STILL_RUNNING = "Still refreshing. This can take a minute.";
export const REFRESH_FAILED = "We could not refresh this account just now. Try again in a moment.";

export interface AccountRefreshResult {
  refreshed: boolean;
  bank_synced_to?: string | null;
  next_allowed_at?: string | null;
  message?: string;
  in_progress?: boolean;
  paused?: boolean;
  reconnect?: boolean;
}

/** HH:mm in UK time, or undefined for a missing or unreadable time. */
export function refreshClock(iso: string | null | undefined): string | undefined {
  const t = iso ? Date.parse(iso) : NaN;
  if (Number.isNaN(t)) return undefined;
  return new Date(t).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Europe/London" });
}

/** True for a connected bank account that can be refreshed (not offline, not a statement). */
export function canRefreshAccount(a: Pick<Account, "id" | "manual" | "connection_id" | "paused">): boolean {
  return !a.manual && !a.id.startsWith("statement-") && !!a.connection_id && !a.paused;
}

export interface RefreshControlState {
  disabled: boolean;
  label: string;
  spinning: boolean;
}

/** The button: a spinner while running; "Next refresh from 14:05" while the
 *  bank's hourly rule holds; otherwise "Refresh". */
export function refreshControlState(opts: {
  refreshing: boolean;
  nextAllowedAt?: string | null;
  now?: number;
}): RefreshControlState {
  const now = opts.now ?? Date.now();
  if (opts.refreshing) return { disabled: true, label: REFRESHING_LABEL, spinning: true };
  const next = opts.nextAllowedAt ? Date.parse(opts.nextAllowedAt) : NaN;
  if (!Number.isNaN(next) && next > now) {
    const clock = refreshClock(opts.nextAllowedAt);
    if (clock) return { disabled: true, label: `Next refresh from ${clock}`, spinning: false };
  }
  return { disabled: false, label: REFRESH_LABEL, spinning: false };
}

/** The plain note under the control after an attempt, or undefined. */
export function refreshNote(r: AccountRefreshResult | null, failed: boolean): string | undefined {
  if (failed) return REFRESH_FAILED;
  if (!r) return undefined;
  if (r.in_progress) return REFRESH_STILL_RUNNING;
  if (r.refreshed) return undefined;
  return r.message;
}
