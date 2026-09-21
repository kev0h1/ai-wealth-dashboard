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

// ── invalidation is awaitable, which is what closes the signup race ──────
//
// `PlanPicker` awaits this before advancing to the income step, which is one
// synchronous setStep and one tap from the bank step. If the returned promise
// resolved before the re-read landed, the bank step could still paint the
// pre-selection answer.

{
  await invalidateOpenBankingAccess();
  tier = "max";
  const seen = [];
  const stop = watchOpenBankingAccess((allowed) => seen.push(allowed));
  await settled();
  check("awaitable: reader starts on the paid plan", seen, [true]);

  tier = "statements";
  let release;
  api.getSubscription = () => new Promise((r) => { release = () => r(subscriptionFor(tier)); });
  const done = invalidateOpenBankingAccess();
  let resolved = false;
  void done.then(() => { resolved = true; });
  await settled();
  check("awaitable: does not resolve while the re-read is in flight", resolved, false);
  check("awaitable: and has not reported anything yet", seen, [true]);

  release();
  await done;
  check("awaitable: resolves only once the new answer has landed", seen, [true, false]);

  stop();
  api.getSubscription = async () => { calls += 1; return subscriptionFor(tier); };
}

// ── a read superseded mid-flight must not win, nor poison the cache ──────
//
// Invalidation nulls `inflight` while an earlier read is still in the air.
// Without a generation guard the winner is whichever promise RESOLVES last,
// not whichever was ISSUED last, and the stale answer then sits in the cache
// for the full TTL.

{
  await invalidateOpenBankingAccess();
  tier = "max";
  let releaseSlow;
  api.getSubscription = () => new Promise((r) => { releaseSlow = () => r(subscriptionFor("max")); });
  const seen = [];
  const stop = watchOpenBankingAccess((allowed) => seen.push(allowed));
  await settled();
  check("superseded: the slow first read has reported nothing yet", seen, []);

  // The plan changes and a second, fast read is issued.
  tier = "statements";
  api.getSubscription = async () => subscriptionFor("statements");
  await invalidateOpenBankingAccess();
  check("superseded: the fresh read reports the new plan", seen, [false]);

  // Only now does the original, superseded read come back.
  releaseSlow();
  await settled();
  check("superseded: the stale read does not report", seen, [false]);
  check(
    "superseded: nor does it overwrite the cache",
    (await getSubscriptionCached()).tier,
    "statements",
  );
  stop();
}

// ── a read still IN FLIGHT at unsubscribe must not report ────────────────
//
// Removing `readers.delete(read)` is caught by the "unsubscribed readers"
// case far above. This is the other half, and the one `cancelled` actually
// exists for: a request already in the air when React unmounts the
// component, whose `.then` would otherwise setState on an unmounted tree.

{
  await invalidateOpenBankingAccess();
  let release;
  api.getSubscription = () => new Promise((r) => { release = () => r(subscriptionFor("max")); });
  const seen = [];
  const stop = watchOpenBankingAccess((allowed) => seen.push(allowed));
  await settled();
  check("in-flight at unmount: nothing reported while pending", seen, []);
  stop();
  release();
  await settled();
  check("in-flight at unmount: a resolving read does not report", seen, []);
}

{
  await invalidateOpenBankingAccess();
  let fail;
  api.getSubscription = () => new Promise((_, reject) => { fail = () => reject(new Error("network down")); });
  const seen = [];
  const stop = watchOpenBankingAccess((allowed) => seen.push(allowed));
  await settled();
  stop();
  fail();
  await settled();
  check("in-flight at unmount: a REJECTING read does not report either", seen, []);
}

// ── a superseded read settling must not release the CURRENT request ──────
//
// `getSubscriptionCached` clears `inflight` through an ownership check
// (`if (inflight === pending)`) rather than a plain `.finally`. The
// difference only shows when a superseded promise settles while a newer one
// is still in the air: an unconditional clear nulls `inflight` that the
// newer read owns, so the next caller in that window starts a redundant
// third request instead of joining the second. Sibling of the `cancelled`
// guard above, and the last one in this module without a test.
//
// No readers are subscribed in this block, so every request counted here was
// issued by an explicit `getSubscriptionCached()` call and nothing else.

{
  await invalidateOpenBankingAccess();
  calls = 0;
  const release = [];
  api.getSubscription = () => {
    calls += 1;
    return new Promise((resolve) => { release.push(() => resolve(subscriptionFor("max"))); });
  };

  const superseded = getSubscriptionCached();
  check("ownership: the first read is one request", calls, 1);

  // The plan changes: this read is now stale, and the next caller starts a
  // second request rather than joining it.
  await invalidateOpenBankingAccess();
  const current = getSubscriptionCached();
  check("ownership: a read after invalidation is a second request", calls, 2);

  // The SUPERSEDED read now comes back, while the current one is still
  // pending. It must not hand `inflight` back.
  release[0]();
  await superseded;
  await settled();

  const joined = getSubscriptionCached();
  check("ownership: a read in that window joins the current request, not a third", calls, 2);

  // Release every outstanding deferred, not just the current one: if this
  // case ever regresses, a redundant third request would otherwise be left
  // pending and Node would exit on the unsettled await before the summary
  // printed, hiding the count.
  for (const settle of release) settle();
  await Promise.all([current, joined]);
  await settled();
  check("ownership: and the current read is what lands in the cache", calls, 2);
}

if (failures > 0) {
  console.error(`\nopen-banking-access.test.mjs: ${failures} failure(s)`);
  process.exit(1);
}
console.log("\nopen-banking-access.test.mjs: all checks passed");
