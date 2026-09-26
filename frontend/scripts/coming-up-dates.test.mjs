// Plain-Node test for the G170 date-with-ordinal form on the Coming Up
// tile — same framework-free pattern as scripts/cash-walk.test.mjs et al,
// imports the REAL production modules (lib/dates.ts, lib/comingUp.tsx),
// never a hand-copied re-implementation.
//
// Run with:
//   node --no-warnings --experimental-loader ./scripts/_tsx-loader.mjs scripts/coming-up-dates.test.mjs
// or:
//   npm run -s check:coming-up-dates
//
// comingUp.tsx has JSX (DropSentence, HeadsUpSentence render markup), so
// this needs the tsx-loader rather than plain --experimental-strip-types
// (see _tsx-loader.mjs's own header for why type-stripping alone can't
// handle JSX). It transitively resolves lib/dates.ts too, so one loader
// covers both modules under test.
//
// Kevin's decided form (G170, supersedes the earlier no-ordinal
// recommendation): short weekday, day WITH ordinal suffix, short month,
// e.g. "Wed 19th Aug", "Thu 1st Oct". today/tomorrow keep their word with
// the date after: "tomorrow, Sat 27th Sep". No year anywhere on this tile.

import { ordinalDay, shortDateWithOrdinal } from "../lib/dates.ts";
import { nextPaymentWhen, computeDrop } from "../lib/comingUp.tsx";

let failures = 0;

function check(label, actual, expected) {
  if (actual !== expected) {
    failures += 1;
    console.error(`FAIL: ${label} — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  } else {
    console.log(`PASS: ${label}`);
  }
}

function bill(overrides) {
  return {
    name: "Test bill",
    amount: 10,
    daysAway: 5,
    date: "Wed 19 Aug",
    kind: "commitment",
    ...overrides,
  };
}

// ── ordinalDay: the exact exception set Kevin named ───────────────────────
check("ordinalDay(1)", ordinalDay(1), "1st");
check("ordinalDay(2)", ordinalDay(2), "2nd");
check("ordinalDay(3)", ordinalDay(3), "3rd");
check("ordinalDay(4)", ordinalDay(4), "4th");
check("ordinalDay(11) is 11th, not 11st", ordinalDay(11), "11th");
check("ordinalDay(12) is 12th, not 12nd", ordinalDay(12), "12th");
check("ordinalDay(13) is 13th, not 13rd", ordinalDay(13), "13th");
check("ordinalDay(21)", ordinalDay(21), "21st");
check("ordinalDay(22)", ordinalDay(22), "22nd");
check("ordinalDay(23)", ordinalDay(23), "23rd");
check("ordinalDay(31)", ordinalDay(31), "31st");
// Plain "th" days not otherwise named, for coverage of the default branch.
check("ordinalDay(5)", ordinalDay(5), "5th");
check("ordinalDay(20)", ordinalDay(20), "20th");
check("ordinalDay(30)", ordinalDay(30), "30th");

// ── shortDateWithOrdinal: the same set embedded in a "Xxx N Mon" string ───
check("shortDateWithOrdinal 1st", shortDateWithOrdinal("Sun 1 Feb"), "Sun 1st Feb");
check("shortDateWithOrdinal 2nd", shortDateWithOrdinal("Mon 2 Feb"), "Mon 2nd Feb");
check("shortDateWithOrdinal 3rd", shortDateWithOrdinal("Tue 3 Feb"), "Tue 3rd Feb");
check("shortDateWithOrdinal 4th", shortDateWithOrdinal("Wed 4 Feb"), "Wed 4th Feb");
check("shortDateWithOrdinal 11th", shortDateWithOrdinal("Wed 11 Feb"), "Wed 11th Feb");
check("shortDateWithOrdinal 12th", shortDateWithOrdinal("Thu 12 Feb"), "Thu 12th Feb");
check("shortDateWithOrdinal 13th", shortDateWithOrdinal("Fri 13 Feb"), "Fri 13th Feb");
check("shortDateWithOrdinal 21st", shortDateWithOrdinal("Mon 21 Feb"), "Mon 21st Feb");
check("shortDateWithOrdinal 22nd", shortDateWithOrdinal("Tue 22 Feb"), "Tue 22nd Feb");
check("shortDateWithOrdinal 23rd", shortDateWithOrdinal("Wed 23 Feb"), "Wed 23rd Feb");
check("shortDateWithOrdinal 31st", shortDateWithOrdinal("Sat 31 Jan"), "Sat 31st Jan");

// ── Fallback: an unparseable label degrades to the original text ─────────
check("shortDateWithOrdinal falls back on a non-date string", shortDateWithOrdinal("Whenever"), "Whenever");
check("shortDateWithOrdinal falls back on an empty string", shortDateWithOrdinal(""), "");
check(
  "shortDateWithOrdinal does not double-ordinal an already-suffixed string",
  shortDateWithOrdinal("Wed 19th Aug"),
  "Wed 19th Aug",
);

// ── nextPaymentWhen: today/tomorrow keep the word, date after ─────────────
check(
  "nextPaymentWhen: today keeps the word with the date after",
  nextPaymentWhen(bill({ daysAway: 0, date: "Sat 26 Sep" })),
  "today, Sat 26th Sep",
);
check(
  "nextPaymentWhen: tomorrow keeps the word with the date after",
  nextPaymentWhen(bill({ daysAway: 1, date: "Sun 27 Sep" })),
  "tomorrow, Sun 27th Sep",
);
check(
  "nextPaymentWhen: any other day is short weekday + ordinal day + short month, no word",
  nextPaymentWhen(bill({ daysAway: 5, date: "Wed 19 Aug" })),
  "Wed 19th Aug",
);

// ── Month boundary: Sat 26 Sep 2026 -> Thu 1 Oct 2026 ─────────────────────
check(
  "nextPaymentWhen across the Sep/Oct month boundary (26th)",
  nextPaymentWhen(bill({ daysAway: 4, date: "Sat 26 Sep" })),
  "Sat 26th Sep",
);
check(
  "nextPaymentWhen across the Sep/Oct month boundary (1st, new month)",
  nextPaymentWhen(bill({ daysAway: 5, date: "Thu 1 Oct" })),
  "Thu 1st Oct",
);

// ── computeDrop end to end: the fields the tile actually renders ─────────
// A fortnight where the only bill lands on a single future day past the
// window's first half (daysAway > 6, so computeDrop's "spread out" branch,
// not "concentrated", is the one under test) — the "calm" runway branch,
// crossing Sep into Oct. Exercises heavyWhen through the real computeDrop
// path, not just the label helper in isolation.
{
  const bills = [bill({ name: "Broadband", amount: 32, daysAway: 9, date: "Thu 1 Oct", kind: "commitment" })];
  const insight = computeDrop(bills);
  check("computeDrop month-boundary scenario reaches the calm branch", insight.kind, "calm");
  if (insight.kind === "calm") {
    check("computeDrop calm heavyWhen crosses into October correctly", insight.heavyWhen, "Thu 1st Oct");
  }
}

// A same-day case: a small bill due today, with the fortnight's real
// weight sitting later (daysAway > 6) so the cumulative 50% crossing day
// falls outside the front-loaded window and computeDrop reaches "landing"
// rather than "concentrated" — exercises the `when` field end to end.
{
  const bills = [
    bill({ name: "Netflix", amount: 15.99, daysAway: 0, date: "Sat 26 Sep", kind: "discretionary" }),
    bill({ name: "Council Tax", amount: 200, daysAway: 10, date: "Tue 6 Oct", kind: "commitment" }),
  ];
  const insight = computeDrop(bills);
  check("computeDrop same-day scenario reaches the landing branch", insight.kind, "landing");
  if (insight.kind === "landing") {
    check("computeDrop landing.when for today", insight.when, "today, Sat 26th Sep");
  }
}

// A tomorrow case, same shape.
{
  const bills = [
    bill({ name: "Spotify", amount: 11.99, daysAway: 1, date: "Sun 27 Sep", kind: "discretionary" }),
    bill({ name: "Council Tax", amount: 200, daysAway: 10, date: "Tue 6 Oct", kind: "commitment" }),
  ];
  const insight = computeDrop(bills);
  check("computeDrop tomorrow scenario reaches the landing branch", insight.kind, "landing");
  if (insight.kind === "landing") {
    check("computeDrop landing.when for tomorrow", insight.when, "tomorrow, Sun 27th Sep");
  }
}

// ── Never twice, never a year ─────────────────────────────────────────────
const ALL_LABELS = [
  nextPaymentWhen(bill({ daysAway: 0, date: "Sat 26 Sep" })),
  nextPaymentWhen(bill({ daysAway: 1, date: "Sun 27 Sep" })),
  nextPaymentWhen(bill({ daysAway: 5, date: "Wed 19 Aug" })),
  nextPaymentWhen(bill({ daysAway: 5, date: "Thu 1 Oct" })),
];
for (const label of ALL_LABELS) {
  const ordinalMatches = label.match(/\d+(st|nd|rd|th)/g) ?? [];
  check(`"${label}" carries exactly one ordinal`, ordinalMatches.length, 1);
  check(`"${label}" carries no 4-digit year`, /\b\d{4}\b/.test(label), false);
}

if (failures > 0) {
  console.error(`\n${failures} failure(s).`);
  process.exit(1);
}
console.log("\nAll coming-up-dates (G170) checks passed.");
