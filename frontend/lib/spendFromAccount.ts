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
// G111 (Kevin's decision, 2026-09-16, variant A + current accounts only):
// this line now considers CURRENT accounts only. A savings pot, however
// much headroom it carries, is never a candidate here at all — it is
// filtered out of the pool before ranking even starts, the same structural
// spirit as the credit-card exclusion below (never entered into the
// candidate list, not merely scored low). Excluding savings removes the
// ordering conflict the G111 design round was built to expose (current
// accounts rank before savings, but a savings pot can hold more), so the
// old `savings_pot` result kind, its `moveTo` field, and the "move it"
// copy branch are gone, not dormant. The deliberate consequence, which
// Kevin has been told: when no current account has spare but a savings pot
// does, this line says nothing has spare while money sits in savings. That
// silence is intentional — moving money out of savings is handled by the
// cover-plan move card on a different surface, not here.
//
// Two things this file exists to get right (see the G110/G111 backlog
// items):
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
//      considered, and (as of G111) by only ever ranking accounts
//      `sourceClass` resolves to "current" — a savings account is excluded
//      the same way a credit card is: never admitted to the candidate list.

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
  // The full account, carried through so the render layer (SafeToSpendCard,
  // the /design preview) can resolve a bank badge/name via
  // components/AccountMiniCard.tsx's accountBrand() without this plain
  // (non-JSX) module importing that component itself.
  account: Account;
};

export type SpendFromResult =
  | { kind: "unavailable" }
  | { kind: "none" }
  | { kind: "account"; best: SpendFromAccount; alternative: SpendFromAccount | null };

function toSpendFromAccount(a: Account, headroom: number): SpendFromAccount {
  return { accountId: a.id, name: a.name, provider: a.provider, headroom, account: a };
}

function rankByHeadroom(
  accounts: Account[],
  eligibility: Record<string, AccountEligibility>,
): SpendFromAccount[] {
  // G114 (2026-09-17): rank on `spend_from_headroom`, not the standing
  // `headroom` — a live cover-plan move card can already be claiming part
  // of an account's standing headroom, and this line answers "how much may
  // I spend from this account right now" which must net that out. Falls
  // back to `headroom` only for an entry that predates the field (a stale
  // cached response), never silently drops the account.
  return accounts
    .map((a) => {
      const entry = eligibility[a.id];
      const headroom = entry?.spend_from_headroom ?? entry?.headroom ?? 0;
      return toSpendFromAccount(a, headroom);
    })
    .sort((a, b) => b.headroom - a.headroom);
}

/**
 * The best account to spend from right now, plus (for the disclosure) the
 * next alternative. `accountEligibility` is `TodayResponse.account_eligibility`
 * (or `CoverPlanResponse.account_eligibility`, same shape); `accounts` is
 * the user's full account list (`GET /accounts`, e.g. `getAccountsCached()`).
 *
 * Current accounts only (G111): a savings account never enters `candidates`
 * in the first place, so it can never be `best`, `alternative`, or any other
 * part of the result, regardless of how much headroom it carries.
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
  // finder never considers, e.g. a different currency, have none). G111:
  // also requires `sourceClass` to resolve to "current" — a savings
  // account is filtered out right here, structurally, the same gate that
  // keeps a credit card out (never in `candidates` at all, not scored and
  // discarded later).
  const candidates = accounts.filter(
    (a) =>
      a.cover_source_eligible !== false &&
      accountEligibility[a.id] != null &&
      sourceClass(a) === "current",
  );

  const currentRanked = rankByHeadroom(candidates, accountEligibility);

  const usableCurrent = currentRanked.filter((a) => a.headroom >= SPEND_FROM_HEADROOM_FLOOR);
  if (usableCurrent.length > 0) {
    const [best, next] = usableCurrent;
    return { kind: "account", best, alternative: next ?? null };
  }

  return { kind: "none" };
}

/** One quiet line under the Safe-to-Spend hero. Never implies the figure is
 * part of the pooled headline above it: it names the account AND states the
 * difference in scope outright.
 *
 * G110 review, 2026-09-16: naming the account was not enough. Per-account
 * headroom deducts only that account's own bills and a flat buffer
 * (`_account_headroom`, backend/app/services/companion.py), while the
 * headline above also deducts buffer, envelopes and commitments across the
 * WHOLE pool, so the per-account figure is structurally UNBOUNDED relative
 * to the headline and will routinely exceed it ("£120 spare" sitting under
 * "£46 safe"). Leaving the account name and the word "spare" to carry that
 * distinction is implication, not statement, and it recreates exactly the
 * figure inconsistencies the item was written to avoid. Every branch below
 * therefore carries a plain qualifier naming the narrower scope and the
 * headline it is NOT part of, in the headline's own words ("Safe to
 * Spend", matching the card's label). No em dashes, per DESIGN.md.
 *
 * G111, variant A: the bank identity is now part of the same sentence
 * ("In Main G (Chase): ..."), not left for the reader to infer from the
 * account name alone. `bankLabel` is optional and resolved by the caller
 * (accountBrand(result.best.account).label) so this module stays free of
 * any JSX/React import; when omitted the parenthetical is simply left out
 * rather than the sentence breaking.
 */
export function spendFromHeroLine(
  result: SpendFromResult,
  amount: (value: number) => string,
  bankLabel?: string | null,
): string | null {
  switch (result.kind) {
    case "unavailable":
      return null;
    case "none":
      // The sharpest version of the same confusion: the headline can read
      // "£46 safe" while no single account has anything spare. Says which
      // question was asked rather than leaving the two to collide. This is
      // also, as of G111, what the line says when the only spare money
      // sits in a savings pot: deliberate, see this file's header comment.
      return "No single account has spare to spend from right now. Checked account by account, not against your full Safe to Spend.";
    case "account": {
      const bank = bankLabel ? ` (${bankLabel})` : "";
      return `In ${result.best.name}${bank}: ${amount(result.best.headroom)} spare right now. This account only, not your full Safe to Spend.`;
    }
  }
}

/** The next alternative, shown behind the existing "How we got £X"
 * disclosure rather than a new panel. Null when there is nothing more to
 * name (no second account, or the hero line itself has nothing to show). */
export function spendFromAlternativeLine(
  result: SpendFromResult,
  amount: (value: number) => string,
): string | null {
  if (result.kind !== "account") return null;
  if (!result.alternative) return null;
  // Same scope qualifier as the hero line, in its shortest honest form:
  // this line sits inside the "How we got £X" ledger, which itemises the
  // POOLED calculation, so an unqualified "£38 spare" reads as one of that
  // ledger's own rows.
  return `Next best: ${result.alternative.name}, ${amount(result.alternative.headroom)} spare in that account.`;
}
