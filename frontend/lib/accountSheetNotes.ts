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

/** The relative phrase shared by both bank data lines: "just now", "5 min ago",
 *  "2 hours ago", "yesterday", "3 days ago", or "29 Oct" once a week old. */
function relativeBankTime(iso: string | null | undefined, now: number): string | undefined {
  const t = iso ? Date.parse(iso) : NaN;
  if (Number.isNaN(t)) return undefined;
  const mins = Math.max(0, Math.floor((now - t) / 60_000));
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} ${hours === 1 ? "hour" : "hours"} ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return "yesterday";
  if (days < 7) return `${days} days ago`;
  return new Date(t).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "Europe/London" });
}

/** "Bank data updated 2 hours ago", or "Bank data updated 29 Oct" once a week old. */
export function bankDataUpdatedLine(iso: string | null | undefined, now: number = Date.now()): string | undefined {
  const when = relativeBankTime(iso, now);
  return when === undefined ? undefined : `Bank data updated ${when}`;
}

/** A176: "Bank data from 2 hours ago", the bank's own as-of time. */
export function bankDataFromLine(iso: string | null | undefined, now: number = Date.now()): string | undefined {
  const when = relativeBankTime(iso, now);
  return when === undefined ? undefined : `Bank data from ${when}`;
}

/** The one line the sheet shows: the bank's own time when Finexer reported it,
 *  otherwise our own transaction sync time (A175). */
export function bankDataTimeLine(
  a: Pick<Account, "bank_synced_to" | "transactions_synced_at">,
  now: number = Date.now(),
): string | undefined {
  return bankDataFromLine(a.bank_synced_to, now) ?? bankDataUpdatedLine(a.transactions_synced_at, now);
}

export interface BankEmptyState {
  message: string;
  updated?: string;
}

/** The empty-state copy for a connected bank account with no transactions, or
 *  null when the diagnostics are absent and the plain "No transactions" stays. */
export function bankEmptyState(
  a: Pick<Account, "manual" | "transactions_last_count" | "transactions_synced_at" | "bank_synced_to">,
  now: number = Date.now(),
): BankEmptyState | null {
  if (a.manual || a.transactions_last_count !== 0) return null;
  return { message: NO_BANK_TRANSACTIONS, updated: bankDataTimeLine(a, now) };
}
