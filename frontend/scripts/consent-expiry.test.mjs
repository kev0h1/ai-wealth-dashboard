// Plain-Node test for lib/consentExpiry.ts (A113) — same framework-free
// pattern as scripts/accounts-pinned.test.mjs et al: imports the REAL
// production module, not a re-implementation.
//
// What this guards. A109 (Terms/Privacy v1.1) was rejected because the
// promise "the Service shows when your current consent ends" wasn't true:
// no frontend file read `consent_expires_at`/`expires_at`. This is the
// deterministic half of making it true, so it is the case most likely to
// ship broken if the degrade-to-nothing paths are wrong — a missing expiry
// rendering as "Invalid Date", or an already-expired connection still
// claiming a (past) end date, would make the Terms/Privacy sentence false
// again in a different way.
//
// Run with:
//   node --no-warnings --experimental-strip-types scripts/consent-expiry.test.mjs
// or:
//   npm run -s check:consent-expiry

import { formatConsentExpiry } from "../lib/consentExpiry.ts";

let failures = 0;

function check(label, cond) {
  if (!cond) {
    failures += 1;
    console.error(`FAIL: ${label}`);
  } else {
    console.log(`PASS: ${label}`);
  }
}

const NOW = new Date("2026-09-23T12:00:00Z");

// 1. Expiry known (a genuine future date) — renders the promised line, in
// British long-date format, no em dash.
const known = formatConsentExpiry("2026-12-14T00:00:00Z", NOW);
check("a future expiry renders 'Connected until <date>'", known === "Connected until 14 December 2026");
check("the rendered line never contains an em dash", !known?.includes("—"));

// 2. Expiry unknown/absent — undefined and null must both degrade to
// nothing, never a label implying a date that isn't known.
check("undefined expires_at renders nothing", formatConsentExpiry(undefined, NOW) === null);
check("null expires_at renders nothing", formatConsentExpiry(null, NOW) === null);
check("empty-string expires_at renders nothing", formatConsentExpiry("", NOW) === null);

// 3. An unparseable string must never surface as "Invalid Date" — the
// exact regression CLAUDE.md's brief calls out by name.
const garbage = formatConsentExpiry("not-a-date", NOW);
check("an unparseable expiry renders nothing, not 'Invalid Date'", garbage === null);
check("an unparseable expiry never contains the literal 'Invalid'", !String(garbage).includes("Invalid"));

// 4. Already expired — this is no longer the CURRENT consent, so the
// promise doesn't apply; the caller's own ReconnectStrip/banner owns that
// story instead. A past expiry must not render a stale "Connected until"
// line, and the exact boundary (expiry == now) counts as already ended.
check(
  "a past expiry renders nothing (not a stale 'Connected until' claim)",
  formatConsentExpiry("2026-01-01T00:00:00Z", NOW) === null
);
check(
  "an expiry exactly equal to now counts as already ended",
  formatConsentExpiry(NOW.toISOString(), NOW) === null
);

// 5. Manual/non-bank accounts carry no consent at all — the caller passes
// undefined for these (no connection_id to join against), which is already
// covered by case 2 above; asserting it again here pins the specific
// wording a caller would use for "no consent to speak of".
check(
  "a manual account's 'no connection' case (undefined) reads the same as unknown",
  formatConsentExpiry(undefined, NOW) === formatConsentExpiry(null, NOW)
);

if (failures > 0) {
  console.error(`\n${failures} check(s) failed.`);
  process.exit(1);
} else {
  console.log("\nAll checks passed.");
}
