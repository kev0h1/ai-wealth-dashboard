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

/**
 * How the per-account eligibility snapshot was (not) obtained. G148,
 * 2026-09-23: `unavailable` used to be a single opaque state that
 * SafeToSpendCard rendered as `null`, which meant a working feature and a
 * feature that never received its data looked EXACTLY the same on screen,
 * and did so on Kevin's live Home for a week. Splitting the reason is what
 * lets the card render something visible for the two states that are
 * genuinely wrong, while still staying quiet for the one that is merely
 * early.
 *
 * - `loading`: `GET /today` has not settled yet. Bounded by the request's
 *   own lifecycle (HomePage sets the status in `.then`/`.catch`), so this
 *   is the ONE reason that may render nothing: a placeholder here would
 *   flash on every cold load and say nothing true.
 * - `error`: the request failed. The caller swallowed the error (this is a
 *   supporting rail, not a blocking failure), so the absence of a rail is
 *   the only evidence the user has that anything went wrong.
 * - `missing`: the request SUCCEEDED and carried no `account_eligibility`.
 *   This is the G148 defect's own shape: a payload built by code, or served
 *   from a cache written by code, that predates the field. Distinct from
 *   `error` deliberately, because the two need different diagnostics and
 *   only one of them is worth retrying.
 */
export type SpendFromUnavailableReason = "loading" | "error" | "missing";

/** What the client knows about the `GET /today` request that carries
 *  `account_eligibility`. Same three-state shape HomePage already used
 *  elsewhere (`todayStatus`, `accountsStatus`) rather than inventing a
 *  second vocabulary. */
export type TodayRequestStatus = "loading" | "ready" | "failed";

export type SpendFromResult =
  | { kind: "unavailable"; reason: SpendFromUnavailableReason }
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
 *
 * `todayStatus` (G148) is what the caller knows about the request that was
 * supposed to deliver `accountEligibility`. It only ever changes which
 * `unavailable` reason comes back, never whether an account is picked: a
 * warm cache that already holds eligibility is used even while a refresh is
 * in flight or has just failed.
 *
 * `accountsStatus` (G148 re-review) is the separate question of what happened
 * to the request that was supposed to fill `accounts`. It is a status, not a
 * boolean, because an empty list has three different meanings and only one of
 * them is a statement about the user's money:
 *
 *   "ready"   the request succeeded. An empty list genuinely means no
 *             accounts, and `none` ("no current account has room") is true.
 *   "loading" not back yet. Say nothing.
 *   "failed"  the request errored. Say so, visibly and retryably. Never
 *             `none`: that would be a claim about the user's money made
 *             because a fetch broke.
 *
 * This is the ENFORCEMENT of something that used to be true only by luck.
 * On Home the false-`none` case was unreachable because HomePage hides this
 * whole card behind `!loadError`, a cross-component invariant this module
 * neither stated nor checked, and which does not hold on a warm remount
 * (where `loadError` is a fresh `useState` false while the cached snapshot
 * still holds the empty list from the failed cold load). Requiring the
 * caller to say "ready" before `none` can be produced moves the guarantee
 * inside the module.
 *
 * Defaults to "ready", because every caller that hands over a fixture list
 * already knows the list is settled.
 */
export function bestSpendAccount(
  accountEligibility: Record<string, AccountEligibility> | null | undefined,
  accounts: Account[],
  todayStatus: TodayRequestStatus = "ready",
  accountsStatus: TodayRequestStatus = "ready",
): SpendFromResult {
  if (!accountEligibility) {
    if (todayStatus === "failed") return { kind: "unavailable", reason: "error" };
    if (todayStatus === "loading") return { kind: "unavailable", reason: "loading" };
    // The request came back fine and simply had no `account_eligibility` on
    // it. Before G148 this fell into the same silent branch as "still
    // loading", which is precisely why nobody noticed the field had stopped
    // arriving.
    return { kind: "unavailable", reason: "missing" };
  }

  // An empty `accounts` means one of two completely different things, and
  // the difference has to come from the caller, not from the emptiness.
  //
  //  - NOT BACK yet: the account list is a separate request from the
  //    eligibility one and either can win the race. Ranking an empty list
  //    would return `none`, whose copy asserts "No current account has room
  //    to spend from right now" — a claim about the user's money made purely
  //    because a fetch had not landed. Stay quiet until it has.
  //
  //  - FAILED: the same falsehood, but permanent-looking rather than
  //    transient, and with a real cause worth reporting. Says so.
  //
  //  - SUCCEEDED and genuinely empty: a user with investment accounts but no
  //    bank accounts is NOT a fresh user (HomePage's `isFreshUser` requires
  //    both lists empty), so this card renders for them, and `none` is the
  //    literal truth: they have no current account with room. Falling
  //    through to the ranking below is what says so.
  //
  // The first version of this guard keyed on `accounts.length === 0` alone
  // and swallowed the third case into a permanent `pending`, which renders
  // nothing and does not even log — re-creating, for that user, the exact
  // silence this whole item exists to remove. The second version keyed on a
  // page-level loading flag, which a warm remount starts already false, so
  // it produced the false `none` for a user whose accounts request had
  // failed. Both caught in re-review.
  if (accounts.length === 0 && accountsStatus !== "ready") {
    const failed = accountsStatus === "failed" || todayStatus === "failed";
    return { kind: "unavailable", reason: failed ? "error" : "loading" };
  }

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

// ── Which treatment the card renders (G148, 2026-09-23) ─────────────────────
//
// The branch used to live inline in components/SafeToSpendCard.tsx's
// `approvedSpendFromTreatment`, which returns JSX and therefore cannot be
// imported by this repo's plain-Node test runner (`--experimental-strip-types`
// handles .ts but not .tsx — see scripts/purchase-availability-ssr.test.mjs's
// own note). That is a large part of why `if (result.kind === "unavailable")
// return null;` sat unexercised: there was nothing a test could reach.
//
// The DECISION now lives here, as a plain function over plain data, and the
// component is the thin renderer of whatever it returns. Bank-logo
// availability is injected as a predicate rather than imported, because the
// logo table lives in components/AccountMiniCard.tsx (.tsx again) and this
// module must stay JSX-free.

export type SpendFromTreatmentKind =
  /** Approved variant A: bank badges and amounts beside the hero figure. */
  | "bank-rail"
  /** At least one account has no bundled bank mark: named rows instead. */
  | "name-fallback"
  /** Eligibility is known and no current account clears the floor. */
  | "no-current"
  /** `GET /today` succeeded and carried no eligibility at all. */
  | "not-available"
  /** `GET /today` failed. */
  | "check-failed"
  /** Still in flight. The ONLY kind that renders nothing. */
  | "pending";

export type SpendFromTreatmentPlan = {
  kind: SpendFromTreatmentKind;
  /** Ranked accounts to render; empty for every non-account kind. */
  entries: SpendFromAccount[];
  /** The user-facing sentence for the kinds that have no rows of their own. */
  message: string | null;
  /** Whether to offer the card's existing retry control alongside `message`. */
  retryable: boolean;
  /**
   * A developer-facing line the card logs once per state. Non-null for every
   * kind that means the rail is absent for a reason the user cannot act on,
   * so "the feature quietly stopped arriving" leaves a trace somewhere even
   * when the UI copy is deliberately gentle. Null for the healthy kinds and
   * for `pending`, which is normal on every cold load.
   */
  diagnostic: string | null;
};

/**
 * Copy rules (DESIGN.md): British English, no em dashes, calm under bad
 * news. DESIGN.md's Safe-to-Spend section also puts error, unsupported and
 * degraded states in neutral ink "with no colour signal at all", so neither
 * of the two unavailable lines carries the amber dot the `no-current` line
 * uses: nothing here is a financial risk, it is a missing supporting figure.
 */
export function spendFromTreatmentPlan(
  result: SpendFromResult | null | undefined,
  hasBankMark: (account: Account) => boolean,
): SpendFromTreatmentPlan {
  // A caller that passes nothing at all knows as little as one whose
  // request failed, and must not be quieter about it.
  const resolved: SpendFromResult = result ?? { kind: "unavailable", reason: "missing" };

  if (resolved.kind === "unavailable") {
    switch (resolved.reason) {
      case "loading":
        return { kind: "pending", entries: [], message: null, retryable: false, diagnostic: null };
      case "error":
        return {
          kind: "check-failed",
          entries: [],
          message: "Spend from: we could not check your accounts just now.",
          retryable: true,
          diagnostic:
            "spend-from rail hidden: the GET /today request failed, so no account_eligibility was received.",
        };
      case "missing":
      default:
        return {
          kind: "not-available",
          entries: [],
          // Deliberately does not explain itself further. The honest
          // statement is that the account by account answer is not here;
          // anything more specific would be a claim about the user's banks
          // that the client has no evidence for.
          message: "Spend from: not available right now.",
          retryable: false,
          diagnostic:
            "spend-from rail hidden: GET /today succeeded but carried no account_eligibility field. "
            + "Expect a cached today payload written by code older than G110, or a server that predates it.",
        };
    }
  }

  if (resolved.kind === "none") {
    return { kind: "no-current", entries: [], message: null, retryable: false, diagnostic: null };
  }

  const entries = [resolved.best, resolved.alternative].filter(
    (entry): entry is SpendFromAccount => entry != null,
  );
  const kind: SpendFromTreatmentKind = entries.every((entry) => hasBankMark(entry.account))
    ? "bank-rail"
    : "name-fallback";
  return { kind, entries, message: null, retryable: false, diagnostic: null };
}
