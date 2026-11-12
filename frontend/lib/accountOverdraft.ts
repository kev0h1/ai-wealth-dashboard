// G463: intentionally unused. The "Available with overdraft" line is hidden everywhere until it has a correct rule; kept so it can return.
// A181: what a current account can reach with its arranged overdraft, for
// display only. The balance stays the headline and the only figure Left to
// spend uses; this is never added to cash anywhere.

import type { Account } from "@wealth/shared";

export const AVAILABLE_WITH_OVERDRAFT = "Available with overdraft";

type OverdraftFields = Pick<Account, "overdraft_limit" | "available" | "balance" | "manual" | "type" | "subtype">;

/** The bank's available figure when it is above zero, otherwise current plus
 *  the overdraft limit, never below zero. Null when the account has no
 *  non-credit overdraft limit, or is a card, offline account or loan. */
export function overdraftAvailable(a: OverdraftFields): number | null {
  if (a.manual) return null;
  const limit = a.overdraft_limit;
  if (typeof limit !== "number" || !Number.isFinite(limit) || limit <= 0) return null;
  const kind = `${a.type ?? ""} ${a.subtype ?? ""}`.toLowerCase();
  if (kind.includes("credit") || kind.includes("debt") || kind.includes("loan") || kind.includes("mortgage")) return null;
  if (typeof a.available === "number" && Number.isFinite(a.available) && a.available > 0) return a.available;
  const derived = a.balance + limit;
  return Number.isFinite(derived) && derived > 0 ? derived : null;
}

/** Hedged copy: the bank's figure is an estimate, so it reads "about". */
export function availableWithOverdraftText(amount: string): string {
  return `${AVAILABLE_WITH_OVERDRAFT} about ${amount}`;
}
