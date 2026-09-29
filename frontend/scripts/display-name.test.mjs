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

import { resolveDisplayName, resolveFullName, firstNameOf, initialsOf } from "../lib/displayName.ts";

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

// ── resolveDisplayName: profile full name present ───────────────────────
// A saved profile name wins even when the session name looks fine too,
// because the profile is what the user actually told us, not a provider's
// guess — and the greeting only ever wants the first word of it.
check(
  "resolveDisplayName: profile full name beats a real session name, first word only",
  resolveDisplayName({
    fullName: "Kevin Maingi",
    sessionName: "Kevin",
    email: "kevin@example.com",
  }),
  "Kevin"
);

// ── resolveDisplayName / resolveFullName: priority order, non-colliding ──
// The check above is a weak witness of "profile beats session": its
// session name ("Kevin") happens to equal the email's local part, so it
// would ALSO be rejected (and fall through to the profile name) if the
// priority order were flipped to check the session first — the assertion
// would pass either way. This uses a session name that is itself a
// perfectly usable, unrelated real name, so only true profile-first
// priority makes it come out as "Kevin"/"Kevin Maingi" rather than
// "Someone"/"Someone Else".
check(
  "resolveDisplayName: profile name wins even over a session name that is itself a valid, different real name",
  resolveDisplayName({
    fullName: "Kevin Maingi",
    sessionName: "Someone Else",
    email: "kevin@example.com",
  }),
  "Kevin"
);
check(
  "resolveFullName: profile name wins even over a session name that is itself a valid, different real name",
  resolveFullName({
    fullName: "Kevin Maingi",
    sessionName: "Someone Else",
    email: "kevin@example.com",
  }),
  "Kevin Maingi"
);

// ── resolveDisplayName: local-part rejection isolated from the digit ────
// heuristic — "kevin" contains no digit at all, so this can only be
// caught by the exact-local-part-match rule, not by
// looksLikeEmailShapedPlaceholder. Without this, a mutation that removed
// the local-part check but left the digit heuristic in place would still
// pass every other check in this file.
check(
  "resolveDisplayName: rejects an exact email-local-part match with no digits involved",
  resolveDisplayName({
    fullName: null,
    sessionName: "kevin",
    email: "kevin@gmail.com",
  }),
  null
);

// ── resolveDisplayName: only a real session name ────────────────────────
// No profile saved yet, but the session carries a genuine display name
// (e.g. a Google account with a display name set) — use it.
check(
  "resolveDisplayName: falls back to a real session name when there is no profile name",
  resolveDisplayName({
    fullName: null,
    sessionName: "Kevin Maingi",
    email: "kevin@example.com",
  }),
  "Kevin"
);

// ── resolveDisplayName: session name is an email local part ─────────────
// The exact shape of the reported bug: no profile name yet, and the
// session name is just the local part of the user's own email (the
// pre-D7 auth.py fallback for a repeat Apple sign-in, or any other path
// that ever lands the local part in the name claim).
check(
  "resolveDisplayName: rejects a session name that is exactly the email's local part",
  resolveDisplayName({
    fullName: null,
    sessionName: "jjdk4",
    email: "jjdk4@privaterelay.appleid.com",
  }),
  null
);

// ── resolveDisplayName: Apple relay placeholder shape, different email ──
// Guards the case where the `email` passed in doesn't byte-for-byte match
// whatever address a stale session token's name was derived from — the
// name is still an opaque, digit-bearing token, not a real name, so it
// must be rejected on shape alone, not just on an exact local-part match.
check(
  "resolveDisplayName: rejects an email-shaped placeholder even when it doesn't match the given email's local part",
  resolveDisplayName({
    fullName: null,
    sessionName: "ab3fk9",
    email: "kevin.maingi12@gmail.com",
  }),
  null
);
check(
  "resolveDisplayName: rejects another opaque digit-bearing token shape",
  resolveDisplayName({
    fullName: null,
    sessionName: "user12345",
    email: "kevin.maingi12@gmail.com",
  }),
  null
);

// ── resolveDisplayName: a real name that happens to contain a digit ─────
// False-positive guard: the placeholder heuristic must key off the opaque
// *shape* (single lowercase-alnum token, 5+ chars), not "contains any
// digit" — a real name like "Dan2" must not be rejected just because it
// has one.
check(
  "resolveDisplayName: keeps a real session name that contains a digit but isn't opaque-token-shaped",
  resolveDisplayName({
    fullName: null,
    sessionName: "Dan2",
    email: "dan@example.com",
  }),
  "Dan2"
);

// ── resolveDisplayName: session name is the full relay email address ────
// A relay email leaking into the name field whole (not just its local
// part) must be rejected too — it is even less name-shaped than the local
// part alone.
check(
  "resolveDisplayName: rejects a session name that is the full relay email address",
  resolveDisplayName({
    fullName: null,
    sessionName: "jjdk4@privaterelay.appleid.com",
    email: "jjdk4@privaterelay.appleid.com",
  }),
  null
);

// ── resolveDisplayName: both empty ───────────────────────────────────────
// Neither source has a real name — greet without one rather than with a
// fragment of an address.
check(
  "resolveDisplayName: returns null when profile and session both have no real name",
  resolveDisplayName({
    fullName: "",
    sessionName: "",
    email: "jjdk4@privaterelay.appleid.com",
  }),
  null
);

// ── resolveDisplayName: a real single-word session name with no digits ──
// Sanity check that the digit-shaped-placeholder rule doesn't reject an
// ordinary first-name-only session claim (e.g. a Google account whose
// display name is just "Kevin").
check(
  "resolveDisplayName: accepts a real single-word session name with no digits",
  resolveDisplayName({
    fullName: null,
    sessionName: "Kevin",
    email: "kevin.maingi12@gmail.com",
  }),
  "Kevin"
);

// ── resolveDisplayName: profile name is whitespace-only ─────────────────
// A profile full_name of "" or whitespace must not win over a real,
// usable session name — it is not "present", just empty after trimming.
check(
  "resolveDisplayName: whitespace-only profile name falls through to the session name",
  resolveDisplayName({
    fullName: "   ",
    sessionName: "Kevin Maingi",
    email: "kevin@example.com",
  }),
  "Kevin"
);

// ── resolveFullName: mirrors the same rules but keeps the whole name ────
// Used by Settings (full name in the header) and the avatar initials,
// which need more than just the first word.
check(
  "resolveFullName: profile name present, kept in full",
  resolveFullName({ fullName: "Kevin Maingi", sessionName: "Kevin", email: "kevin@example.com" }),
  "Kevin Maingi"
);
check(
  "resolveFullName: real session name kept in full when there is no profile name",
  resolveFullName({ fullName: null, sessionName: "Kevin Maingi", email: "kevin@example.com" }),
  "Kevin Maingi"
);
check(
  "resolveFullName: rejects an email-local-part session name just like resolveDisplayName",
  resolveFullName({ fullName: null, sessionName: "jjdk4", email: "jjdk4@privaterelay.appleid.com" }),
  null
);
check(
  "resolveFullName: a profile name is trusted even if it happens to contain a digit",
  // Onboarding collects free-text name fields — a user is free to type a
  // name that contains a digit (e.g. "Neo2"); only the session-name
  // fallback is subjected to the email-shaped-placeholder heuristic.
  resolveFullName({ fullName: "Neo2 Anderson", sessionName: null, email: "neo@example.com" }),
  "Neo2 Anderson"
);

// ── firstNameOf / initialsOf ─────────────────────────────────────────────
check("firstNameOf takes the first word", firstNameOf("Kevin Maingi"), "Kevin");
check("firstNameOf of undefined is undefined", firstNameOf(undefined), undefined);
check("firstNameOf of null is undefined", firstNameOf(null), undefined);
check("initialsOf takes up to two initials", initialsOf("Kevin Maingi"), "KM");
check("initialsOf of a single word is one initial", initialsOf("Kevin"), "K");
check("initialsOf of undefined is undefined", initialsOf(undefined), undefined);
check("initialsOf of null is undefined", initialsOf(null), undefined);

if (failures > 0) {
  console.error(`\n${failures} failure(s).`);
  process.exit(1);
}
console.log("\nAll display-name checks passed.");
