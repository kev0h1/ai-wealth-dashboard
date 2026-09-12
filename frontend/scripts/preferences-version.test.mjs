// Plain-Node test for the version-freshness rule (G45, second re-review).
// No frontend test harness exists in this repo (no jest/vitest/testing-
// library) — this follows the same pattern as scripts/legal-content.test.mjs
// and scripts/check-design-index.mjs: a framework-free script that imports
// the REAL production module and asserts against it, exiting non-zero on
// failure.
//
// Run with:
//   node --no-warnings --experimental-strip-types scripts/preferences-version.test.mjs
// or:
//   npm run -s check:preferences-version
//
// --experimental-strip-types is Node 22.6+ built-in TypeScript support
// (type-stripping only, no type-checking) — it lets this script import
// lib/preferencesVersion.ts directly, so there is no risk of the test
// drifting from a hand-copied re-implementation of the rule.

import { shouldAcceptPreferencesSnapshot as shouldAccept } from "../lib/preferencesVersion.ts";

let failures = 0;

function check(label, actual, expected) {
  if (actual !== expected) {
    failures += 1;
    console.error(`FAIL: ${label} — expected ${expected}, got ${actual}`);
  } else {
    console.log(`PASS: ${label}`);
  }
}

// A snapshot strictly older than the last accepted version must be rejected
// — this is the exact shape of the stale-GET-outlasts-a-PATCH race.
check("older snapshot is rejected", shouldAccept(3, 5), false);

// Equal is accepted (idempotent to re-apply the same data).
check("equal snapshot is accepted", shouldAccept(5, 5), true);

// Newer is accepted, regardless of who produced it (Penny vs Settings —
// there is no notion of "caller" in this rule at all, only version order).
check("newer snapshot is accepted", shouldAccept(6, 5), true);

// A version far ahead (e.g. several Penny writes while Settings was
// backgrounded) is still just "newer" — accepted.
check("much newer snapshot is accepted", shouldAccept(100, 5), true);

// No version on the incoming snapshot (back-compat / an old cached
// response) — nothing to compare against, so accept rather than wedge.
check("missing version is accepted", shouldAccept(undefined, 5), true);
check("null version is accepted", shouldAccept(null, 5), true);
check("NaN version is accepted", shouldAccept(Number.NaN, 5), true);

// A brand new session (never accepted anything) starts at -1 in
// PreferencesContext.tsx — the very first real GET (version 0 for a user
// with no document at all, or >= 1 for one with a document) must be
// accepted.
check("first-ever snapshot (version 0) is accepted from a fresh session", shouldAccept(0, -1), true);
check("first-ever snapshot (version 1) is accepted from a fresh session", shouldAccept(1, -1), true);

// Zero is a real version (a user's first document defaults to 0 in
// GET /preferences before any PATCH has ever happened) — must not be
// treated as "missing" and auto-accepted once something real has been seen.
check("version 0 is rejected once something newer has been accepted", shouldAccept(0, 2), false);

if (failures > 0) {
  console.error(`\n${failures} failure(s).`);
  process.exit(1);
}
console.log("\nAll preferences-version checks passed.");
