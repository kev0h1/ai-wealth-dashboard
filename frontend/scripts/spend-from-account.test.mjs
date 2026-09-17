// Plain-Node test for lib/spendFromAccount.ts (G110, then G111) — same
// framework-free pattern as scripts/cash-walk.test.mjs et al: imports the
// REAL production module (the exact functions components/SafeToSpendCard.tsx
// and app/components/HomePage.tsx use), not a hand-copied re-implementation.
//
// Run with:
//   node --no-warnings --experimental-strip-types --experimental-loader ./scripts/_ts-extensionless-loader.mjs scripts/spend-from-account.test.mjs
// or:
//   npm run -s check:spend-from-account
//
// The loader (scripts/_ts-extensionless-loader.mjs, see accounts-pinned's
// own test for the original precedent) is needed because lib/spendFromAccount.ts
// itself imports lib/coverPlanSourceClass.ts with an extensionless relative
// specifier, this repo's normal style, which plain Node's ESM resolver
// cannot follow on its own.
//
// G111 (Kevin's decision, 2026-09-16): variant A (bank badge + bank name
// inline on the primary line, resolved by the caller and threaded in as
// spendFromHeroLine's optional third argument, kept out of this JSX-free
// module) and current accounts ONLY. A savings account is now excluded
// from the ranking structurally, the same spirit as the credit-card
// exclusion: never admitted to the candidate list, not merely scored low
// and passed over. The old "savings_pot" result kind, its "move it" copy,
// and its own second line are gone from production, not dormant — this
// file proves that with a case where a savings pot holds MORE than every
// current account and the result still either names a current account or
// says nothing has spare, never the pot.
//
// Covers the G110/G111 backlog items' hard cases: a good current account
// (now with its bank name threaded through), a savings pot that would have
// won under the old rule but must never be surfaced at all, no account
// having spare, and credit cards being excluded from the ranking
// regardless of any headroom data attached to them (defence in depth: the
// backend already never emits a credit card in account_eligibility at
// all, this proves the frontend does not quietly re-admit one via a
// stale/malformed payload either).

import { bestSpendAccount, spendFromHeroLine, spendFromAlternativeLine, SPEND_FROM_HEADROOM_FLOOR } from "../lib/spendFromAccount";

let failures = 0;

function check(label, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) {
    failures += 1;
    console.error(`FAIL: ${label}\n  expected: ${e}\n  actual:   ${a}`);
  } else {
    console.log(`PASS: ${label}`);
  }
}

function amount(value) {
  return `£${Math.abs(value).toLocaleString("en-GB", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

function account(overrides) {
  return {
    id: "acc", name: "Account", type: "TRANSACTION", subtype: "", balance: 100,
    currency: "GBP", provider: "Bank", status: "active", cover_source_eligible: true,
    ...overrides,
  };
}

// ── Case 1: a good current account, bank name threaded through ─────────────
{
  const accounts = [
    account({ id: "barclays", name: "Barclays Current", subtype: "CURRENT", cover_source_eligible: true }),
    account({ id: "hsbc", name: "HSBC Current", subtype: "CURRENT", cover_source_eligible: true }),
    account({ id: "isa", name: "ISA Saver", subtype: "SAVINGS", cover_source_eligible: true }),
  ];
  const eligibility = {
    barclays: { short: false, headroom: 142 },
    hsbc: { short: false, headroom: 38 },
    isa: { short: false, headroom: 340 },
  };
  const result = bestSpendAccount(eligibility, accounts);
  check("a good current account is picked over a higher-headroom savings pot", result.kind, "account");
  check("the best current account is named", result.best?.name, "Barclays Current");
  check("the full account is carried through for the caller to resolve a bank badge", result.best?.account?.id, "barclays");
  check("the alternative is the next current account, not the savings pot", result.alternative?.name, "HSBC Current");
  check(
    "hero line names the account and its own headroom, distinct from any pooled figure (no bank label passed)",
    spendFromHeroLine(result, amount),
    "In Barclays Current: £142 spare right now. This account only, not your full Safe to Spend.",
  );
  check(
    "hero line folds a caller-resolved bank label into the same sentence, variant A's shape",
    spendFromHeroLine(result, amount, "Barclays"),
    "In Barclays Current (Barclays): £142 spare right now. This account only, not your full Safe to Spend.",
  );
  check(
    "alternative line names the second account",
    spendFromAlternativeLine(result, amount),
    "Next best: HSBC Current, £38 spare in that account.",
  );
}

// ── Case 2 (G111): a savings pot holding MORE than every current account is
//    never surfaced, not as the source, not as a "move it" line — it is not
//    a candidate at all. Structural exclusion, proven two ways. ───────────
{
  // 2a. A qualifying current account exists alongside a much bigger savings
  //     pot: the current account must still lead, the savings pot must be
  //     invisible in the result (not even as "alternative").
  const accountsWithCurrent = [
    account({ id: "barclays", name: "Barclays Current", subtype: "CURRENT", cover_source_eligible: true }),
    account({ id: "isa", name: "ISA Saver", subtype: "SAVINGS", cover_source_eligible: true }),
  ];
  const eligibilityWithCurrent = {
    barclays: { short: false, headroom: 25 },
    isa: { short: false, headroom: 340 },
  };
  const resultWithCurrent = bestSpendAccount(eligibilityWithCurrent, accountsWithCurrent);
  check("a qualifying current account leads even when a savings pot holds far more", resultWithCurrent.kind, "account");
  check("the current account is named, not the savings pot", resultWithCurrent.best?.name, "Barclays Current");
  check("the savings pot is not surfaced as the alternative either", resultWithCurrent.alternative, null);
  check(
    "the copy names the current account only, no mention of the savings pot",
    spendFromHeroLine(resultWithCurrent, amount),
    "In Barclays Current: £25 spare right now. This account only, not your full Safe to Spend.",
  );

  // 2b. No current account qualifies at all, but the savings pot has plenty:
  //     the honest answer is "none", never a "move it" line naming the pot.
  const accountsNoCurrent = [
    account({ id: "barclays", name: "Barclays Current", subtype: "CURRENT", cover_source_eligible: true }),
    account({ id: "isa", name: "ISA Saver", subtype: "SAVINGS", cover_source_eligible: true }),
  ];
  const eligibilityNoCurrent = {
    barclays: { short: true, headroom: -12 },
    isa: { short: false, headroom: 340 },
  };
  const resultNoCurrent = bestSpendAccount(eligibilityNoCurrent, accountsNoCurrent);
  check("no current account qualifying means 'none', never the savings pot", resultNoCurrent.kind, "none");
  check(
    "the copy says nothing has spare, it does not name the savings pot or suggest moving it",
    spendFromHeroLine(resultNoCurrent, amount),
    "No single account has spare to spend from right now. Checked account by account, not against your full Safe to Spend.",
  );
}

// ── Case 3: no account has spare ────────────────────────────────────────────
{
  const accounts = [
    account({ id: "barclays", name: "Barclays Current", subtype: "CURRENT", cover_source_eligible: true }),
    account({ id: "isa", name: "ISA Saver", subtype: "SAVINGS", cover_source_eligible: true }),
  ];
  const eligibility = {
    barclays: { short: true, headroom: -12 },
    isa: { short: true, headroom: 2 },
  };
  const result = bestSpendAccount(eligibility, accounts);
  check("neither a current nor a savings account clears the floor", result.kind, "none");
  check(
    "the copy is honest that nothing is currently reachable",
    spendFromHeroLine(result, amount),
    "No single account has spare to spend from right now. Checked account by account, not against your full Safe to Spend.",
  );
}

// ── Credit cards are excluded from the ranking ──────────────────────────────
{
  const accounts = [
    account({ id: "amex", name: "Amex", type: "CREDIT_CARD", subtype: "CREDIT_CARD", cover_source_eligible: false }),
    account({ id: "hsbc", name: "HSBC Current", subtype: "CURRENT", cover_source_eligible: true }),
  ];
  // Malformed/stale payload defence: even if a headroom entry somehow
  // exists for the credit card (which the real backend never emits, since
  // it is excluded from source_capacity before account_eligibility is even
  // built), cover_source_eligible === false must still keep it out.
  const eligibility = {
    amex: { short: false, headroom: 9999 },
    hsbc: { short: false, headroom: 38 },
  };
  const result = bestSpendAccount(eligibility, accounts);
  check("a credit card is never named as the best account regardless of its headroom figure", result.kind, "account");
  check("the real current account is picked instead", result.best?.name, "HSBC Current");
}

// ── Floor threshold: matches the backend's own £5 gate ──────────────────────
check("SPEND_FROM_HEADROOM_FLOOR mirrors _account_usable_by_finder's own floor", SPEND_FROM_HEADROOM_FLOOR, 5);
{
  const accounts = [account({ id: "hsbc", name: "HSBC Current", subtype: "CURRENT", cover_source_eligible: true })];
  const belowFloor = bestSpendAccount({ hsbc: { short: true, headroom: 4.99 } }, accounts);
  check("headroom just under the floor does not count as usable", belowFloor.kind, "none");
  const atFloor = bestSpendAccount({ hsbc: { short: false, headroom: 5 } }, accounts);
  check("headroom exactly at the floor counts as usable", atFloor.kind, "account");
}

// ── No data yet ──────────────────────────────────────────────────────────────
check("missing eligibility data renders nothing rather than a false 'none'", bestSpendAccount(undefined, []).kind, "unavailable");
check("hero line is omitted (not a fallback sentence) while data is unavailable", spendFromHeroLine({ kind: "unavailable" }, amount), null);

// ── Scope qualifier: the G110 review defect, as a rule not two strings ─────
// Per-account headroom is structurally UNBOUNDED relative to the pooled
// headline (it deducts only that account's own bills and a flat buffer,
// the headline deducts buffer, envelopes and commitments across the whole
// pool), so "£120 spare" will routinely sit under "£46 safe". EVERY branch
// that renders a figure must therefore say so in words, not leave the
// account name and the word "spare" to imply it. Asserted over every
// reachable SpendFromResult kind (G111: "unavailable" | "none" | "account"
// only, "savings_pot" is gone), so a new branch added later cannot ship an
// unqualified figure just because nobody added a string check for it.
{
  const cases = [
    ["account", { kind: "account", best: { accountId: "a", name: "A", provider: "p", headroom: 120, account: account({ id: "a" }) }, alternative: null }],
    ["none", { kind: "none" }],
  ];
  for (const [label, result] of cases) {
    const line = spendFromHeroLine(result, amount);
    check(`${label}: hero line is rendered`, typeof line, "string");
    check(
      `${label}: hero line states its scope against the pooled headline by name`,
      /not (your full|against your full) Safe to Spend/.test(line ?? ""),
      true,
    );
    check(`${label}: hero line uses no em dash (DESIGN.md)`, (line ?? "").includes("—"), false);
  }
  // Same rule with the variant A bank label threaded through: the scope
  // qualifier must survive the parenthetical bank name, not be crowded out
  // by it.
  const withBank = spendFromHeroLine(
    { kind: "account", best: { accountId: "a", name: "A", provider: "p", headroom: 120, account: account({ id: "a" }) }, alternative: null },
    amount,
    "Chase",
  );
  check("bank-qualified account line still states its scope", /not your full Safe to Spend/.test(withBank ?? ""), true);
  check("bank-qualified account line names the bank in parentheses", withBank, "In A (Chase): £120 spare right now. This account only, not your full Safe to Spend.");
  check("bank-qualified account line uses no em dash (DESIGN.md)", (withBank ?? "").includes("—"), false);

  const alt = spendFromAlternativeLine(
    { kind: "account", best: { accountId: "a", name: "A", provider: "p", headroom: 120, account: account({ id: "a" }) }, alternative: { accountId: "b", name: "B", provider: "p", headroom: 38, account: account({ id: "b" }) } },
    amount,
  );
  check(
    "the disclosure's alternative line scopes its figure to one account too",
    /spare in that account/.test(alt ?? ""),
    true,
  );
}

// ── G114 (2026-09-17): ranking reads spend_from_headroom, not the standing
// headroom, so an account a live cover-plan move is already drawing from is
// never offered back to the user. Reproduces Kevin's real shape: Monzo has
// £23.74 standing headroom (ranks #1) but a live move needs £20 out of it,
// leaving £3.74 spend-from headroom, below the £5 floor. ──────────────────
{
  const accounts = [
    account({ id: "monzo", name: "Kevin Mbithi Maingi", subtype: "CURRENT", cover_source_eligible: true }),
    account({ id: "natwest", name: "The Number One", subtype: "CURRENT", cover_source_eligible: true }),
  ];
  const eligibility = {
    // Monzo's live move card is already taking £20 out of its £23.74
    // standing headroom (spend_from_headroom = 3.74, below the floor).
    monzo: { short: false, headroom: 23.74, spend_from_headroom: 3.74 },
    natwest: { short: true, headroom: 2.68, spend_from_headroom: 2.68 },
  };
  const result = bestSpendAccount(eligibility, accounts);
  check(
    "G114: an account whose live move leg drops it below the floor is not offered, even though its standing headroom clears it",
    result.kind,
    "none",
  );
  check(
    "G114: the honest 'nothing spare' line is shown rather than naming Monzo off its standing £23.74",
    spendFromHeroLine(result, amount),
    "No single account has spare to spend from right now. Checked account by account, not against your full Safe to Spend.",
  );
}

// A second current account with real spend-from headroom still ranks
// normally once the reserved account is excluded — G114 only removes what a
// live move already claims, it does not suppress the rest of the ranking.
{
  const accounts = [
    account({ id: "monzo", name: "Kevin Mbithi Maingi", subtype: "CURRENT", cover_source_eligible: true }),
    account({ id: "hsbc", name: "HSBC Current", subtype: "CURRENT", cover_source_eligible: true }),
  ];
  const eligibility = {
    // Monzo standing headroom (90) would rank #1, but a live £88 move leaves
    // only £2 spend-from headroom — below the floor, so HSBC's real £30
    // spend-from headroom must win instead.
    monzo: { short: false, headroom: 90, spend_from_headroom: 2 },
    hsbc: { short: false, headroom: 30, spend_from_headroom: 30 },
  };
  const result = bestSpendAccount(eligibility, accounts);
  check("G114: the account with real spend-from headroom wins over one whose standing figure is higher but already claimed", result.kind, "account");
  check("G114: HSBC is named, not Monzo's higher but already-claimed standing headroom", result.best?.name, "HSBC Current");
  check("G114: the figure shown is the spend-from figure (£30), not any standing figure", result.best?.headroom, 30);
}

// Backward compatibility: a payload predating G114 (no spend_from_headroom
// key at all, e.g. a stale cached /today response) must fall back to the
// standing headroom rather than treating the account as having nothing.
{
  const accounts = [account({ id: "hsbc", name: "HSBC Current", subtype: "CURRENT", cover_source_eligible: true })];
  const eligibility = { hsbc: { short: false, headroom: 38 } };
  const result = bestSpendAccount(eligibility, accounts);
  check("G114: a pre-G114 payload with no spend_from_headroom field falls back to headroom", result.best?.headroom, 38);
}

if (failures > 0) {
  console.error(`\n${failures} failure(s).`);
  process.exit(1);
}
console.log("\nAll spend-from-account (G110/G111/G114) checks passed.");
