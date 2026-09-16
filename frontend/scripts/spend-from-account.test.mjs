// Plain-Node test for lib/spendFromAccount.ts (G110) — same framework-free
// pattern as scripts/cash-walk.test.mjs et al: imports the REAL production
// module (the exact functions components/SafeToSpendCard.tsx and
// app/components/HomePage.tsx use), not a hand-copied re-implementation.
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
// Covers the G110 backlog item's three hard cases: a good current account,
// the best spare sitting in a savings pot (must read as "move it", never
// "spend from"), and no account having spare at all — plus credit cards
// being excluded from the ranking regardless of any headroom data attached
// to them (defence in depth: the backend already never emits a credit
// card in account_eligibility at all, this proves the frontend does not
// quietly re-admit one via a stale/malformed payload either).

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

// ── Case 1: a good current account ─────────────────────────────────────────
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
  check("the alternative is the next current account, not the savings pot", result.alternative?.name, "HSBC Current");
  check(
    "hero line names the account and its own headroom, distinct from any pooled figure",
    spendFromHeroLine(result, amount),
    "In Barclays Current: £142 spare right now.",
  );
  check(
    "alternative line names the second account",
    spendFromAlternativeLine(result, amount),
    "Next best: HSBC Current, £38 spare.",
  );
}

// ── Case 2: the only spare sits in a savings pot ────────────────────────────
{
  const accounts = [
    account({ id: "barclays", name: "Barclays Current", subtype: "CURRENT", cover_source_eligible: true }),
    account({ id: "isa", name: "ISA Saver", subtype: "SAVINGS", cover_source_eligible: true }),
  ];
  const eligibility = {
    barclays: { short: true, headroom: -12 },
    isa: { short: false, headroom: 340 },
  };
  const result = bestSpendAccount(eligibility, accounts);
  check("the savings pot is surfaced as its own kind, never as a current account", result.kind, "savings_pot");
  check("the savings pot itself is named as the source", result.best?.name, "ISA Saver");
  check("the natural current-account destination is named", result.moveTo?.name, "Barclays Current");
  check(
    "the copy says move it, never spend from it",
    spendFromHeroLine(result, amount),
    "£340 spare sits in ISA Saver. Move it to Barclays Current before you spend it.",
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
    "No single account has spare to spend from right now.",
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

if (failures > 0) {
  console.error(`\n${failures} failure(s).`);
  process.exit(1);
}
console.log("\nAll spend-from-account (G110) checks passed.");
