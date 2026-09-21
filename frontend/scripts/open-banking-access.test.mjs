// Plain-Node test for lib/openBankingAccess.ts (A67) — same framework-free
// pattern as scripts/verdict-cache.test.mjs et al: imports the REAL
// production module (via the @/ alias loader), not a re-implementation.
//
// Run with:
//   node --no-warnings --experimental-strip-types --experimental-loader ./scripts/_ts-extensionless-loader.mjs scripts/open-banking-access.test.mjs
// or:
//   npm run -s check:open-banking-access
//
// What this guards, and why it exists at all. The first version of this
// module was a plain cache: `invalidateOpenBankingAccess()` cleared it and
// nothing re-read it, because the hook's effect had an empty dependency
// array. That is inert for the one caller that actually needs it.
// `AuthProvider` mounts `Onboarding` ONCE and every signup step after that is
// a `setStep` inside the same instance, so the plan step and the bank step
// share a mount. On today's configuration a new user reads tier "max" at
// mount, accepts the free Statements plan one screen later, and still meets
// "Connect your first bank" on the next — then gets a 402 from
// `GET /auth/finexer/link`. The screen looked right; the value feeding it
// was stale.
//
// So the assertion that matters is the SEQUENCE: read, plan changes,
// invalidate, the SAME already-subscribed reader is told the new answer. A
// test that only proves `invalidateOpenBankingAccess` can be called, or that
// a fresh read after invalidation returns the new value, passes against the
// inert code and is worthless here.
//
// No test seam in the production module: `api` is a plain object literal, so
// its `getSubscription` is simply reassigned below. Nothing is mocked beyond
// that one network call.

import { api } from "../lib/api.ts";
import {
  watchOpenBankingAccess,
  invalidateOpenBankingAccess,
  getSubscriptionCached,
  openBankingAllowed,
} from "../lib/openBankingAccess.ts";

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

// The shape GET /subscription returns, narrowed to what this module reads.
let tier = "max";
let calls = 0;
function subscriptionFor(t) {
  return {
    tier: t,
    status: "active",
    limits: { open_banking: t !== "statements", max_banks: null, max_accounts: null },
  };
}
api.getSubscription = async () => {
  calls += 1;
  return subscriptionFor(tier);
};

const settled = () => new Promise((r) => setTimeout(r, 0));

// ── the rule itself ──────────────────────────────────────────────────────

check("max allows open banking", openBankingAllowed(subscriptionFor("max")), true);
check("statements does not", openBankingAllowed(subscriptionFor("statements")), false);
check("limits wins over tier when present",
  openBankingAllowed({ tier: "max", limits: { open_banking: false } }), false);
check("falls back to tier when limits is absent",
  openBankingAllowed({ tier: "statements" }), false);

// ── the signup sequence, which is the whole point of this file ───────────

{
  invalidateOpenBankingAccess();
  tier = "max";
  const seen = [];
  const stop = watchOpenBankingAccess((allowed) => seen.push(allowed));
  await settled();
  check("signup: mounts on the paid plan and is allowed", seen, [true]);

  // The user accepts the free plan. This is what PlanPicker does.
  tier = "statements";
  invalidateOpenBankingAccess();
  await settled();
  check(
    "signup: the SAME already-mounted reader is told the plan changed",
    seen,
    [true, false],
  );

  stop();
  tier = "max";
  invalidateOpenBankingAccess();
  await settled();
  check("unsubscribed readers are not called again", seen, [true, false]);
}

// ── caching and dedupe still work ────────────────────────────────────────

{
  invalidateOpenBankingAccess();
  tier = "max";
  calls = 0;
  const [a, b] = await Promise.all([getSubscriptionCached(), getSubscriptionCached()]);
  check("concurrent reads are deduped into one request", calls, 1);
  check("both callers get the same answer", [a.tier, b.tier], ["max", "max"]);
  await getSubscriptionCached();
  check("a later read inside the TTL is served from cache", calls, 1);
  invalidateOpenBankingAccess();
  await getSubscriptionCached();
  check("invalidation forces the next read to refetch", calls, 2);
}

// ── a failed read must not lock a paying user out ────────────────────────

{
  invalidateOpenBankingAccess();
  api.getSubscription = async () => { throw new Error("network down"); };
  const seen = [];
  const stop = watchOpenBankingAccess((allowed) => seen.push(allowed));
  await settled();
  check("an unreachable subscription endpoint settles to allowed", seen, [true]);
  stop();
}

if (failures > 0) {
  console.error(`\nopen-banking-access.test.mjs: ${failures} failure(s)`);
  process.exit(1);
}
console.log("\nopen-banking-access.test.mjs: all checks passed");
