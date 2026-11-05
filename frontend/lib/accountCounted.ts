// A192: one client-side answer to "does this account count towards Left to
// spend?". The API derives `counted_in_left_to_spend` from the user's own G231
// choice and from an ended bank connection (status expired); the other two
// fields are read too so an older payload degrades the same way. British
// English, no em dashes, no red: this is a quiet fact, not a risk.

import type { Account } from "@wealth/shared";

type CountedFields = Pick<Account, "include_in_safe_to_spend" | "counted_in_left_to_spend" | "status">;

/** The bank connection behind this account has ended (revoked or expired). */
export function connectionEnded(a: Pick<Account, "status">): boolean {
  return a.status === "expired";
}

/** True when the account feeds Left to spend, Spend from and plan sources. */
export function isCountedInLeftToSpend(a: Partial<CountedFields>): boolean {
  return a.counted_in_left_to_spend !== false && a.include_in_safe_to_spend !== false && a.status !== "expired";
}

/** Shown beside the last balance of an account whose connection has ended. */
export const CONNECTION_ENDED_NOT_COUNTED = "Connection ended, not counted in Left to spend";
/** Short tag for a ledger row. */
export const CONNECTION_ENDED_TAG = "Connection ended";
