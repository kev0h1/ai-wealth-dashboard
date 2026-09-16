// G111 fixtures — illustrative only, modeled on the shape of Kevin's real
// Home figures (hero £226, "In Main G: £25 spare right now", next best
// "Kevin Mbithi Maingi, £24 spare"; Main G is Chase, Kevin Mbithi Maingi is
// Monzo) so this round is judged against something recognisable. None of
// this is live data: no fetch, no api.* call, nothing server-rendered.
//
// Four states, matching the four things the ticket requires every variant
// to handle:
//   leads      — a good current account leads, no conflict (Kevin's real
//                shape, reused verbatim).
//   conflict   — the interesting case: the shipped cash-led rule picks a
//                current account (Main G, £25) because current accounts
//                rank before savings, but a savings pot (House deposit,
//                Monzo) actually holds more (£180). The honest answer when
//                savings holds the most is to move it first, not spend
//                from it, so this is a genuine disagreement the variants
//                must surface rather than silently resolve.
//   none       — nothing has spare anywhere, the sharpest version of the
//                pooled-vs-per-account confusion (hero can read positive
//                while no single account clears its own bills).
//   unbundled  — the leading account's bank has no bundled logo (G107
//                bundled nine providers; this one, "Metro Bank", is a real
//                UK bank that isn't one of them), so accountBrand() falls
//                through to the initials chip. Proves the honest fallback
//                still identifies SOMETHING rather than silently going
//                blank.

import type { Account } from "@/lib/api";
import type { SpendFromAccount, SpendFromResult } from "@/lib/spendFromAccount";

export const ACCOUNTS = {
  mainG: {
    id: "fx-main-g",
    name: "Main G",
    type: "transaction",
    subtype: "current",
    balance: 412,
    currency: "GBP",
    provider: "Chase",
    provider_id: "chase_uk",
    status: "AUTHORIZED",
    cover_source_eligible: true,
  } satisfies Account,
  kevinMbithi: {
    id: "fx-kmm",
    name: "Kevin Mbithi Maingi",
    type: "transaction",
    subtype: "current",
    balance: 268,
    currency: "GBP",
    provider: "Monzo",
    provider_id: "monzo",
    status: "AUTHORIZED",
    cover_source_eligible: true,
  } satisfies Account,
  houseDeposit: {
    id: "fx-house-deposit",
    name: "House deposit",
    type: "savings",
    subtype: "savings",
    balance: 4120,
    currency: "GBP",
    provider: "Monzo",
    provider_id: "monzo",
    status: "AUTHORIZED",
    cover_source_eligible: true,
  } satisfies Account,
  // Deliberately NOT in components/AccountMiniCard.tsx's BANK_META — a real
  // UK current account provider, chosen so accountBrand() takes its honest
  // "no curated entry, no logo_url, no bg_colors" path to the neutral
  // gradient + initials chip, the same path any as-yet-uncurated bank takes
  // today. No logo_url/bg_colors set, so this never attempts an image
  // request of any kind, bundled or remote.
  metroBank: {
    id: "fx-metro",
    name: "Household spends",
    type: "transaction",
    subtype: "current",
    balance: 96,
    currency: "GBP",
    provider: "Metro Bank",
    status: "AUTHORIZED",
    cover_source_eligible: true,
  } satisfies Account,
} as const;

export type StateSlug = "leads" | "conflict" | "none" | "unbundled";

export type SpendFromFixture = {
  slug: StateSlug;
  label: string;
  /** Illustrative Safe-to-Spend hero figure for this state. */
  hero: number;
  /** The account the shipped cash-led rule (current before savings, then
   *  headroom) would name as best, or null when nothing clears the floor. */
  best: { account: Account; headroom: number } | null;
  /** Next current-class account, shown in the existing "How we got £X"
   *  disclosure exactly as it ships today. Null in the conflict state so
   *  the conflict callout is the only new information on screen, not
   *  duplicated with the ordinary alternative row. */
  alternative: { account: Account; headroom: number } | null;
  /** Only set in the conflict state: a savings pot that holds MORE than
   *  `best`, which the shipped rule does not currently compare against or
   *  mention. This is the new information every variant must decide how
   *  to surface. */
  conflict: { account: Account; headroom: number } | null;
};

export const STATES: Record<StateSlug, SpendFromFixture> = {
  leads: {
    slug: "leads",
    label: "Current account leads",
    hero: 226,
    best: { account: ACCOUNTS.mainG, headroom: 25 },
    alternative: { account: ACCOUNTS.kevinMbithi, headroom: 24 },
    conflict: null,
  },
  conflict: {
    slug: "conflict",
    label: "Savings holds more",
    hero: 226,
    best: { account: ACCOUNTS.mainG, headroom: 25 },
    alternative: null,
    conflict: { account: ACCOUNTS.houseDeposit, headroom: 180 },
  },
  none: {
    slug: "none",
    label: "Nothing has spare",
    // Reuses the exact £46 example lib/spendFromAccount.ts's own doc
    // comment uses for this case, so the fixture matches the code that
    // motivated it: the pool can read "£46 safe" while no single account
    // clears its own bills.
    hero: 46,
    best: null,
    alternative: null,
    conflict: null,
  },
  unbundled: {
    slug: "unbundled",
    label: "Bank has no logo",
    hero: 226,
    best: { account: ACCOUNTS.metroBank, headroom: 32 },
    alternative: { account: ACCOUNTS.kevinMbithi, headroom: 24 },
    conflict: null,
  },
};

export const STATE_ORDER: StateSlug[] = ["leads", "conflict", "none", "unbundled"];

function toSpendFromAccount(entry: { account: Account; headroom: number }): SpendFromAccount {
  return {
    accountId: entry.account.id,
    name: entry.account.name,
    provider: entry.account.provider,
    headroom: entry.headroom,
    account: entry.account,
  };
}

/** The production SpendFromResult this fixture would collapse to today,
 *  BEFORE any of this round's changes — used to render the "current"
 *  (shipped) baseline variant exactly as it ships, including the fact
 *  that in the conflict state the disclosure's "Next best" line does not
 *  exist here (alternative is null by construction, see above), so the
 *  baseline variant shows only "In Main G: £25 spare right now" with
 *  nothing hinting that House deposit holds more. That silence is the
 *  thing every other variant fixes.
 */
export function toBaselineResult(fixture: SpendFromFixture): SpendFromResult {
  if (!fixture.best) return { kind: "none" };
  return {
    kind: "account",
    best: toSpendFromAccount(fixture.best),
    alternative: fixture.alternative ? toSpendFromAccount(fixture.alternative) : null,
  };
}
