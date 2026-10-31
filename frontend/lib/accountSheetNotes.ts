// A175: copy and rules for the account sheet's honest empty state and the
// savings-pot line. Pure so the gate can assert them without rendering the page.
// British English, no em dashes.

import type { Account } from "@wealth/shared";

export const NO_BANK_TRANSACTIONS = "No transactions have arrived from this bank connection yet. The balance still updates.";
export const SAVINGS_NOT_COUNTED = "Savings are not counted in Left to spend.";

/** Matches "saving" in subtype or type. That is a superset of the backend's
 *  subtype rule (analytics._account_pool_kind); harmless because it only picks
 *  which line the sheet shows and never changes any stored value. Credit cards
 *  are never savings. */
export function isSavingsAccount(a: Pick<Account, "type" | "subtype">): boolean {
  const type = (a.type ?? "").toLowerCase();
  const sub = (a.subtype ?? "").toLowerCase();
  if (type.includes("credit") || sub.includes("credit")) return false;
  return sub.includes("saving") || type.includes("saving");
}

/** "Bank data updated 2 hours ago", or "Bank data updated 29 Oct" once a week old. */
export function bankDataUpdatedLine(iso: string | null | undefined, now: number = Date.now()): string | undefined {
  const t = iso ? Date.parse(iso) : NaN;
  if (Number.isNaN(t)) return undefined;
  const mins = Math.max(0, Math.floor((now - t) / 60_000));
  if (mins < 1) return "Bank data updated just now";
  if (mins < 60) return `Bank data updated ${mins} min ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `Bank data updated ${hours} ${hours === 1 ? "hour" : "hours"} ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return "Bank data updated yesterday";
  if (days < 7) return `Bank data updated ${days} days ago`;
  const date = new Date(t).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "Europe/London" });
  return `Bank data updated ${date}`;
}

export interface BankEmptyState {
  message: string;
  updated?: string;
}

/** The empty-state copy for a connected bank account with no transactions, or
 *  null when the diagnostics are absent and the plain "No transactions" stays. */
export function bankEmptyState(
  a: Pick<Account, "manual" | "transactions_last_count" | "transactions_synced_at">,
  now: number = Date.now(),
): BankEmptyState | null {
  if (a.manual || a.transactions_last_count !== 0) return null;
  return { message: NO_BANK_TRANSACTIONS, updated: bankDataUpdatedLine(a.transactions_synced_at, now) };
}
