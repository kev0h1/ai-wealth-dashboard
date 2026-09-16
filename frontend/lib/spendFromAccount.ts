// G110 (Kevin's idea, 2026-09-16): "£46 safe overall" says nothing about
// whether the ONE account a user is about to tap has anything spare — they
// can be told the pooled figure is fine and still bounce a direct debit
// because the money sits in a different bank. This module SURFACES the
// answer, it does not compute a new one: `account_eligibility` (per-account
// `{short, headroom}`) already comes straight off `_account_headroom` in
// backend/app/services/companion.py, the one definition of what can leave
// an account without breaking its own obligations — the exact figure
// Settings' cover-plan sources card already shows via GET /today/cover-plan,
// now also returned by plain GET /today (see lib/api.ts's TodayResponse).
//
// Three things this file exists to get right (see the G110 backlog item):
//   1. A per-account headroom figure is NOT a slice of the pooled
//      Safe-to-Spend headline — the headline also deducts buffer, envelopes
//      and commitments across the WHOLE pool, this is one account's own
//      bills-and-buffer-only figure. The copy functions below always name
//      the account explicitly ("In X") rather than implying containment.
//   2. A credit card is never ranked here at all: `account_eligibility`
//      is built from backend `source_capacity`, which excludes every
//      credit card before this data even leaves the server (belt-and-
//      braces, `is_credit_card_account`) — reinforced here by also
//      requiring `cover_source_eligible !== false` (G55's own flag,
//      SettingsPage.tsx's established pattern) before an account is even
//      considered, and by only ever ranking accounts `sourceClass`
//      resolves to "current" or "savings".
//   3. When the best headroom sits in a savings pot, the honest answer is
//      to name it as something to MOVE, never as somewhere to tap a card —
//      `moveTo` names the best current account to move it into (the same
//      current-class ranking the cover-plan source finder itself uses,
//      current before savings — see companion.py's `_find_legs_for_destination`).

import type { Account, AccountEligibility } from "./api";
import { sourceClass } from "./coverPlanSourceClass";

// Mirrors `_account_usable_by_finder`'s own floor (AccountEligibility's doc
// comment in lib/api.ts): an account with less than this spare is never
// picked by the source finder in any combination, so it is not "the best
// account to spend from" either, however it ranks numerically.
export const SPEND_FROM_HEADROOM_FLOOR = 5;

export type SpendFromAccount = {
  accountId: string;
  name: string;
  provider: string;
  headroom: number;
};

export type SpendFromResult =
  | { kind: "unavailable" }
  | { kind: "none" }
  | { kind: "account"; best: SpendFromAccount; alternative: SpendFromAccount | null }
  | {
      kind: "savings_pot";
      best: SpendFromAccount;
      moveTo: SpendFromAccount | null;
      alternative: SpendFromAccount | null;
    };

function toSpendFromAccount(a: Account, headroom: number): SpendFromAccount {
  return { accountId: a.id, name: a.name, provider: a.provider, headroom };
}

function rankByHeadroom(
  accounts: Account[],
  eligibility: Record<string, AccountEligibility>,
): SpendFromAccount[] {
  return accounts
    .map((a) => toSpendFromAccount(a, eligibility[a.id]?.headroom ?? 0))
    .sort((a, b) => b.headroom - a.headroom);
}

/**
 * The best account to spend from right now, plus (for the disclosure) the
 * next alternative. `accountEligibility` is `TodayResponse.account_eligibility`
 * (or `CoverPlanResponse.account_eligibility`, same shape); `accounts` is
 * the user's full account list (`GET /accounts`, e.g. `getAccountsCached()`).
 */
export function bestSpendAccount(
  accountEligibility: Record<string, AccountEligibility> | null | undefined,
  accounts: Account[],
): SpendFromResult {
  if (!accountEligibility) return { kind: "unavailable" };

  // G55: trust the backend's own cover-plan-source flag rather than
  // re-deriving "is this a candidate at all" from type/subtype strings —
  // same reasoning SettingsPage.tsx already established. Also requires a
  // live eligibility entry to exist for the account (accounts the source
  // finder never considers, e.g. a different currency, have none).
  const candidates = accounts.filter(
    (a) => a.cover_source_eligible !== false && accountEligibility[a.id] != null,
  );

  const currentRanked = rankByHeadroom(
    candidates.filter((a) => sourceClass(a) === "current"),
    accountEligibility,
  );
  const savingsRanked = rankByHeadroom(
    candidates.filter((a) => sourceClass(a) === "savings"),
    accountEligibility,
  );

  const usableCurrent = currentRanked.filter((a) => a.headroom >= SPEND_FROM_HEADROOM_FLOOR);
  if (usableCurrent.length > 0) {
    const [best, next] = usableCurrent;
    const nextSavings = savingsRanked[0];
    const alternative =
      next ?? (nextSavings && nextSavings.headroom >= SPEND_FROM_HEADROOM_FLOOR ? nextSavings : null);
    return { kind: "account", best, alternative };
  }

  const usableSavings = savingsRanked.filter((a) => a.headroom >= SPEND_FROM_HEADROOM_FLOOR);
  if (usableSavings.length > 0) {
    return {
      kind: "savings_pot",
      best: usableSavings[0],
      // The natural place to move it into: the current account closest to
      // usable, even though (by construction of this branch) none clears
      // the floor — the same current-class ranking the cover-plan source
      // finder itself checks first, before ever reaching savings.
      moveTo: currentRanked[0] ?? null,
      alternative: usableSavings[1] ?? null,
    };
  }

  return { kind: "none" };
}

/** One quiet line under the Safe-to-Spend hero. Never implies the figure is
 * part of the pooled headline above it — always names the account. */
export function spendFromHeroLine(
  result: SpendFromResult,
  amount: (value: number) => string,
): string | null {
  switch (result.kind) {
    case "unavailable":
      return null;
    case "none":
      return "No single account has spare to spend from right now.";
    case "account":
      return `In ${result.best.name}: ${amount(result.best.headroom)} spare right now.`;
    case "savings_pot":
      return result.moveTo
        ? `${amount(result.best.headroom)} spare sits in ${result.best.name}. Move it to ${result.moveTo.name} before you spend it.`
        : `${amount(result.best.headroom)} spare sits in ${result.best.name}. Move it to a current account before you spend it.`;
  }
}

/** The next alternative, shown behind the existing "How we got £X"
 * disclosure rather than a new panel. Null when there is nothing more to
 * name (no second account, or the hero line itself has nothing to show). */
export function spendFromAlternativeLine(
  result: SpendFromResult,
  amount: (value: number) => string,
): string | null {
  if (result.kind !== "account" && result.kind !== "savings_pot") return null;
  if (!result.alternative) return null;
  return `Next best: ${result.alternative.name}, ${amount(result.alternative.headroom)} spare.`;
}
