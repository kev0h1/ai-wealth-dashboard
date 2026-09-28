// Plain-Node test for lib/setAsideDisplay.ts (G131) — same framework-free
// pattern as scripts/cash-walk.test.mjs: imports the REAL production
// module (the exact humanizeRaw/titleFor/fmtC/cadenceLabel/statusFor
// functions components/upcoming/SetAsideList.tsx imports, and its design
// preview at app/design/g124-upcoming-refine/ imports the same way), not a
// hand-copied re-implementation.
//
// Run with:
//   node --no-warnings --experimental-strip-types scripts/set-aside-display.test.mjs
// or:
//   npm run -s check:set-aside-display
//
// Covers the independent-review finding (2026-09-19): toTitleCase's
// capitaliser used `.replace(/^[a-z]/, ...)`, an ASCII-only character
// class, so a word starting with an accented capital ("ÜBER TAXI LONDON")
// was never matched and stayed lower-cased ("über Taxi London") instead of
// title-cased ("Über Taxi London"). Fixed by capitalising the first code
// point via toLocaleUpperCase instead of an ASCII regex class. This test
// pins the accented case alongside the plain-ASCII cases and the curated
// acronym list (HSBC, ISA, RBS, VAT) so a future edit can't silently
// regress either.

import { humanizeRaw, titleFor, fmtC, cadenceLabel, statusFor } from "../lib/setAsideDisplay.ts";

let failures = 0;

function checkEq(label, actual, expected) {
  if (actual !== expected) {
    failures += 1;
    console.error(`FAIL: ${label} — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  } else {
    console.log(`PASS: ${label}`);
  }
}

// ── Unicode-aware title casing (the confirmed defect) ──────────────────────
checkEq(
  "an accented capital word title-cases correctly, not left lower-cased",
  humanizeRaw("ÜBER TAXI LONDON"),
  "Über Taxi London",
);
checkEq(
  "a plain-ASCII shouty string still title-cases as before",
  humanizeRaw("PAID SOMEONE ELSE DIRECTLY"),
  "Paid Someone Else Directly",
);

// ── Plain-ASCII regressions from the round's own flagged examples ─────────
checkEq(
  "the shouty ISA-reward string word-safe truncates without cutting mid-word",
  humanizeRaw("INTEREST PAID GROSS FOR PERIOD 3 TO 05 09 2026 ISA REWARD"),
  "Interest Paid Gross For…",
);
checkEq(
  "a card-like descriptor collapses to brand + last 4",
  humanizeRaw("AMERICAN EXPRESS 3751-4360-XXXXXX PAYMENT REF 88213"),
  "American Express •• 4360",
);

// ── Curated acronym list survives title-casing (HSBC, ISA, RBS, VAT) ──────
checkEq("HSBC survives as an acronym, not \"Hsbc\"", humanizeRaw("HSBC CURRENT ACCOUNT"), "HSBC Current Account");
checkEq("ISA survives as an acronym mid-string", humanizeRaw("MONTHLY ISA TOP UP"), "Monthly ISA Top Up");
checkEq("RBS survives as an acronym", humanizeRaw("RBS SAVINGS TRANSFER"), "RBS Savings Transfer");
checkEq("VAT survives as an acronym", humanizeRaw("MONTHLY VAT RETURN"), "Monthly VAT Return");

// ── titleFor: bare-number name still tags correctly with a humanised title ─
checkEq(
  "a bare-number name with a feed derives a humanised primary + #tag",
  JSON.stringify(titleFor({ name: "50", feedLabel: "INTEREST PAID GROSS FOR PERIOD 3 TO 05 09 2026 ISA REWARD" })),
  JSON.stringify({ primary: "Interest Paid Gross For…", tag: "#50" }),
);
checkEq(
  "a bare-number name with NO feed shows the bare number, no invented label",
  JSON.stringify(titleFor({ name: "50", feedLabel: null })),
  JSON.stringify({ primary: "50", tag: null }),
);
checkEq(
  "a non-numeric name is never touched by humanising or tagged",
  JSON.stringify(titleFor({ name: "Portugal trip", feedLabel: "SOME RAW STRING" })),
  JSON.stringify({ primary: "Portugal trip", tag: null }),
);

// ── statusFor: every content line still shows, including the pending date ──
checkEq(
  "fmtC formats whole pounds with thousands separators",
  fmtC(1234.6),
  "£1,235",
);
checkEq("cadenceLabel: once", cadenceLabel({ recurrence: "once" }), "this period only");
checkEq("cadenceLabel: every_period", cadenceLabel({ recurrence: "every_period" }), "every pay period");
checkEq(
  "a pending set-aside with a starts-label keeps that fact, not just the bare line",
  statusFor({
    name: "Car insurance renewal", feedLabel: "HSBC current account",
    amountPerPeriod: 480, filledThisPeriod: 0, remaining: 480,
    recurrence: "once", pending: true, completed: false, pendingStartsLabel: "5 Oct",
  }).detail,
  "Starts 5 Oct · nothing reserved yet",
);
checkEq(
  "a pending set-aside with NO starts-label falls back to the bare line",
  statusFor({
    name: "Car insurance renewal", feedLabel: "HSBC current account",
    amountPerPeriod: 480, filledThisPeriod: 0, remaining: 480,
    recurrence: "once", pending: true, completed: false,
  }).detail,
  "nothing reserved yet",
);
checkEq(
  "a completed set-aside reads Fully set aside with a zero amount",
  JSON.stringify(statusFor({
    name: "Card repayment", feedLabel: "AMEX", amountPerPeriod: 350, filledThisPeriod: 350,
    remaining: 0, recurrence: "every_period", pending: false, completed: false,
  })),
  JSON.stringify({ detail: "Fully set aside · every pay period", amount: "£0" }),
);
checkEq(
  "an in-progress set-aside states filled-of-target and the unfilled remainder",
  JSON.stringify(statusFor({
    name: "50", feedLabel: "INTEREST", amountPerPeriod: 200, filledThisPeriod: 120,
    remaining: 80, recurrence: "every_period", pending: false, completed: false,
  })),
  JSON.stringify({ detail: "£120 of £200 set aside · every pay period", amount: "−£80" }),
);

if (failures > 0) {
  console.error(`\n${failures} failure(s).`);
  process.exit(1);
}
console.log("\nAll set-aside-display (G131) checks passed.");
