// Plain-Node test for lib/displayName.ts (D7), same framework-free pattern
// as scripts/serial-queue.test.mjs et al. Pins the greeting/display-name
// rule against the exact bug Kevin reported: Home greeted a new user "Good
// evening, jjdk4..." (an Apple Hide My Email relay address's local part)
// after they had already entered their real name in onboarding.
//
// Run with:
//   node --no-warnings --experimental-strip-types scripts/display-name.test.mjs
// or:
//   npm run -s check:display-name

import { resolveDisplayName, firstNameOf, initialsOf } from "../lib/displayName.ts";

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

// ── profile name present ────────────────────────────────────────────────
// Onboarding has saved a real full_name — it wins even when the session
// name looks fine too, because the profile is what the user actually told
// us, not a provider's guess.
check(
  "profile name present beats a real session name",
  resolveDisplayName({
    profileName: "Kevin Maingi",
    sessionName: "Kevin",
    email: "kevin@example.com",
  }),
  "Kevin Maingi"
);

// ── only a real session name ────────────────────────────────────────────
// No profile saved yet, but the session carries a genuine display name
// (e.g. a Google account with a display name set) — use it.
check(
  "falls back to a real session name when there is no profile name",
  resolveDisplayName({
    profileName: null,
    sessionName: "Kevin Maingi",
    email: "kevin@example.com",
  }),
  "Kevin Maingi"
);

// ── session name is an email local part ─────────────────────────────────
// The exact shape of the reported bug: no profile name yet, and the
// session name is just the local part of the user's own email (the
// pre-D7 auth.py fallback for a repeat Apple sign-in, or any other path
// that ever lands the local part in the name claim).
check(
  "rejects a session name that is exactly the email's local part",
  resolveDisplayName({
    profileName: null,
    sessionName: "jjdk4",
    email: "jjdk4@privaterelay.appleid.com",
  }),
  undefined
);

// ── Apple relay placeholder ──────────────────────────────────────────────
// A relay email leaking into the name field whole (not just its local
// part) must be rejected too — it is even less name-shaped than the local
// part alone.
check(
  "rejects a session name that is the full relay email address",
  resolveDisplayName({
    profileName: null,
    sessionName: "jjdk4@privaterelay.appleid.com",
    email: "jjdk4@privaterelay.appleid.com",
  }),
  undefined
);

// ── both empty ───────────────────────────────────────────────────────────
// Neither source has a real name — greet without one rather than with a
// fragment of an address.
check(
  "returns undefined when profile and session both have no real name",
  resolveDisplayName({
    profileName: "",
    sessionName: "",
    email: "jjdk4@privaterelay.appleid.com",
  }),
  undefined
);

// ── firstNameOf / initialsOf ─────────────────────────────────────────────
check("firstNameOf takes the first word", firstNameOf("Kevin Maingi"), "Kevin");
check("firstNameOf of undefined is undefined", firstNameOf(undefined), undefined);
check("initialsOf takes up to two initials", initialsOf("Kevin Maingi"), "KM");
check("initialsOf of a single word is one initial", initialsOf("Kevin"), "K");
check("initialsOf of undefined is undefined", initialsOf(undefined), undefined);

if (failures > 0) {
  console.error(`\n${failures} failure(s).`);
  process.exit(1);
}
console.log("\nAll display-name checks passed.");
