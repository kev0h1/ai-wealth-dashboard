// Canonical account-kind classifier — the single source of truth for
// "what kind of account is this" across the accounts estate (rows, groups,
// lenses, badges). Mirrors the substring rules already in
// components/AccountMiniCard.tsx's local `typeLabel`/`ACCOUNT_KIND_COLOUR`
// (kept private there for the mini-card's own styling) so the two never
// drift into a third, slightly-different classification.
//
// Note: real bank `Account` objects from Open Banking practically never
// carry investment subtypes (isa/sipp/pension/invest/stocks) — investments
// live in the separate `InvestmentAccount` type and reach "Investment" kind
// via `investmentToRow` in accountsEstate.ts, not through this function.
// The investment branch here exists defensively (manual/edge-case accounts).

import type { Account } from "@wealth/shared";

export type AccountKind = "Current" | "Savings" | "Credit" | "Investment" | "Offline";

export function accountKind(a: Account): AccountKind {
  if (a.manual) return "Offline";
  const type = (a.type ?? "").toLowerCase();
  const sub = (a.subtype ?? "").toLowerCase();
  if (type.includes("credit") || sub.includes("credit")) return "Credit";
  if (
    sub.includes("isa") ||
    sub.includes("sipp") ||
    sub.includes("pension") ||
    sub.includes("invest") ||
    sub.includes("stocks")
  ) {
    return "Investment";
  }
  if (type.includes("saving") || sub.includes("saving")) return "Savings";
  return "Current";
}

export function accountKindLabel(kind: AccountKind): string {
  switch (kind) {
    case "Current":
      return "Current";
    case "Savings":
      return "Savings";
    case "Credit":
      return "Credit card";
    case "Investment":
      return "Investment";
    case "Offline":
      return "Offline";
  }
}

export function isCredit(a: Account): boolean {
  return accountKind(a) === "Credit";
}

export function isSavings(a: Account): boolean {
  return accountKind(a) === "Savings";
}

/** A £0 credit card is PAID OFF, not dormant. A £0 current/savings account
 *  with no balance is dormant — likely unused/kept around for records. */
export function isDormant(a: Account): boolean {
  return a.balance === 0 && !isCredit(a);
}

export function needsAttention(a: Account): boolean {
  return a.status === "expired";
}
