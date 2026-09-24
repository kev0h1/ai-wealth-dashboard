// Plain-Node regression test for the G122 independent-review findings
// against lib/transactionGrouping.ts, the shared grouping helper behind
// both app/transactions/TransactionsPage.tsx and the g119-transactions-live
// preview's Variant A (see that file's own header for why they share one
// implementation rather than the preview staying a copy production can
// drift from).
//
// Two defects, both reproduced by the reviewer on the version of this file
// that shipped before this fix:
//
//   1. An unparseable/missing `date` (dateToUTCDay's own numeric fallback
//      is NaN for anything it can't parse) produced a heading that rendered
//      literally as "NaN undefined NaN". `Transaction.date` is a required
//      Pydantic field so a well-formed API response cannot hit this today,
//      but this code used to run only against trusted preview fixtures and
//      now runs against live production data, so the blast radius changed.
//
//   2. groupByDay() had no sort of its own and silently trusted the caller
//      to hand it date-descending order. Out-of-order input (e.g. a day
//      revisited later in the list) fragmented one calendar day into two
//      non-adjacent headings instead of merging into one.
//
// Same framework-free pattern as scripts/transaction-filter-chips.test.mjs:
// imports the REAL production module, no React, no JSX. Needs the `@/*`
// alias loader because transactionGrouping.ts imports `@/lib/payPeriod`
// (real, executed) and `@/lib/api` (type-only, erased by
// --experimental-strip-types, never actually loaded at runtime).
//
// Run with:
//   npm run -s check:transaction-grouping
// or:
//   node --no-warnings --experimental-strip-types --experimental-loader ./scripts/_ts-extensionless-loader.mjs scripts/transaction-grouping.test.mjs

import { dayKey, formatDayHeading, groupByDay } from "../lib/transactionGrouping.ts";

let failures = 0;

function check(label, cond) {
  if (!cond) {
    failures += 1;
    console.error(`FAIL: ${label}`);
  } else {
    console.log(`PASS: ${label}`);
  }
}

function checkEq(label, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  check(`${label} (actual: ${a}, expected: ${e})`, a === e);
}

// Minimal transaction-shaped objects — groupByDay only ever reads `.date`
// off each row, everything else just needs to round-trip untouched.
function tx(id, date) {
  return { id, date, amount: 10, category: "Other", merchant_name: `M${id}`, transaction_type: "debit" };
}

// ── 1. Malformed dates never render a garbage heading ──────────────────

// dayKey's sentinel for an unparseable date is deliberately -Infinity (so
// it always sorts after every real day, see transactionGrouping.ts) — that
// is a real, comparable number, just not a *finite* one, so the property
// under test is "never NaN" (a real number a comparator can order),
// not "finite".
check(
  "dayKey(undefined) is a real, comparable number, never NaN",
  !Number.isNaN(dayKey(undefined)),
);
check(
  "dayKey('not-a-date') is a real, comparable number, never NaN",
  !Number.isNaN(dayKey("not-a-date")),
);
check(
  "formatDayHeading(undefined) never contains 'NaN'",
  !formatDayHeading(undefined).includes("NaN"),
);
check(
  "formatDayHeading('not-a-date') never contains 'NaN'",
  !formatDayHeading("not-a-date").includes("NaN"),
);
check(
  "formatDayHeading(undefined) is not a jokey label, just 'Date unknown'",
  formatDayHeading(undefined) === "Date unknown",
);

{
  const items = [
    tx(1, "2024-01-17T00:00:00"),
    tx(2, undefined),
    tx(3, "not-a-date"),
    tx(4, "2024-01-01T00:00:00"),
  ];
  const groups = groupByDay(items);
  const totalRows = groups.reduce((n, g) => n + g.rows.length, 0);
  checkEq("malformed-date input: no row is lost", totalRows, items.length);
  check(
    "malformed-date input: no heading contains 'NaN'",
    groups.every((g) => !g.heading.includes("NaN")),
  );
  const unknownGroups = groups.filter((g) => g.heading === "Date unknown");
  checkEq("malformed-date input: exactly one 'Date unknown' group", unknownGroups.length, 1);
  checkEq(
    "malformed-date input: both malformed rows land in that one group",
    unknownGroups[0]?.rows.map((r) => r.id).sort(),
    [2, 3],
  );
  checkEq("malformed-date input: 'Date unknown' sorts after every real day", groups[groups.length - 1].heading, "Date unknown");
}

// ── 2. groupByDay sorts defensively, regardless of input order ─────────

{
  // Out of order on purpose: 1 Jan, then 17 Jan, then 1 Jan again — the
  // reviewer's repro shape ([1 Sep, 17 Sep, 1 Sep] gave three headings
  // instead of two). Fixed 2024 dates (not "today"/"yesterday") keep the
  // assertion independent of whatever day this test happens to run on.
  const items = [
    tx(1, "2024-01-01T00:00:00"),
    tx(2, "2024-01-17T00:00:00"),
    tx(3, "2024-01-01T00:00:00"),
  ];
  const groups = groupByDay(items);
  checkEq("out-of-order input: merges into exactly two day groups, not three", groups.length, 2);
  checkEq("out-of-order input: newest day heads the list", groups[0].heading, "17 January 2024");
  checkEq("out-of-order input: both 1 Jan rows land in the same, single group", groups[1].heading, "1 January 2024");
  checkEq(
    "out-of-order input: the 1 Jan group holds both rows in original relative order (stable sort)",
    groups[1].rows.map((r) => r.id),
    [1, 3],
  );
  const totalRows = groups.reduce((n, g) => n + g.rows.length, 0);
  checkEq("out-of-order input: no row is lost", totalRows, items.length);
}

{
  // Already-sorted input (the real-world shape every backend query path
  // produces today) must still behave exactly as before: one group per
  // day, newest first.
  const items = [
    tx(1, "2024-01-17T00:00:00"),
    tx(2, "2024-01-01T00:00:00"),
    tx(3, "2024-01-01T00:00:00"),
  ];
  const groups = groupByDay(items);
  checkEq("already-sorted input: unchanged behaviour, two groups", groups.length, 2);
  checkEq("already-sorted input: newest day still first", groups[0].heading, "17 January 2024");
  checkEq(
    "already-sorted input: same-day rows keep their original order",
    groups[1].rows.map((r) => r.id),
    [2, 3],
  );
}

if (failures > 0) {
  console.error(`\n${failures} check(s) failed.`);
  process.exit(1);
} else {
  console.log("\nAll transaction-grouping (G122 review) checks passed.");
}
