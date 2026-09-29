// Plain-Node test for A121 (pentest IOS-07/IOS-03, HIGH): the iOS biometric
// lock overlay painted over a still-live app — the bottom nav and Penny's
// suggestion chips kept accepting taps behind it, and a tapped chip fired a
// real authenticated call and rendered live safe-to-spend/upcoming-bills
// figures on a locked screen. The fix has three parts; this file proves the
// two that do not require a real device or a browser DOM:
//
//   1. lib/appLock.ts — the shared lock signal's set/get/subscribe contract.
//   2. lib/api.ts — the request gate: an authenticated call issues NO fetch
//      and rejects with AppLockedError while locked, then succeeds once
//      unlocked. Exercises both an api.* method that goes through the
//      shared get<T> helper AND one of the ~65 hand-rolled
//      `fetch(...).then(...)` call sites, because those are plain,
//      non-`async` arrow functions — if the gate ever regressed to a
//      synchronous throw instead of a promise rejection (see api.ts's own
//      comment on why `fetch` is shadowed as a lazy wrapper returning
//      Promise.reject rather than throwing), it would escape THOSE call
//      sites as an uncaught exception at the call site rather than
//      something `.catch()` can see, which is the specific regression this
//      file is here to catch.
//
// What this file does NOT prove, because neither jsdom nor any other DOM
// implementation is installed in this repo's node_modules (checked:
// no jsdom, happy-dom or linkedom package present) — see
// scripts/app-lock-inert.test.mjs instead, which tests the DOM gate's
// attribute-tracking logic as a pure function against fake elements, per
// the same constraint. Neither file can exercise a real MutationObserver,
// real `inert` focus/hit-testing behaviour, or the WebKit stacking question
// this item was filed over — those need the device retest.
//
// Run with:
//   npm run -s check:app-lock
// or:
//   node --no-warnings --experimental-strip-types --experimental-loader ./scripts/_ts-extensionless-loader.mjs scripts/app-lock.test.mjs

import { isAppLocked, setAppLocked, subscribeAppLock, getAppLockSnapshot } from "../lib/appLock";
import { api, AppLockedError, gatedFetch } from "../lib/api";

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

function ok(label, cond) {
  check(label, !!cond, true);
}

// ── 1. lib/appLock.ts store ────────────────────────────────────────────

ok("appLock: starts unlocked", !isAppLocked());
ok("appLock: getAppLockSnapshot agrees with isAppLocked at start", !getAppLockSnapshot());

{
  let calls = 0;
  const unsubscribe = subscribeAppLock(() => { calls += 1; });

  setAppLocked(true);
  ok("appLock: isAppLocked() true after setAppLocked(true)", isAppLocked());
  ok("appLock: getAppLockSnapshot() agrees", getAppLockSnapshot());
  check("appLock: subscriber notified exactly once on true->false-style change", calls, 1);

  setAppLocked(true); // no-op: already true
  check("appLock: setting the SAME value again does not notify", calls, 1);

  setAppLocked(false);
  ok("appLock: isAppLocked() false after setAppLocked(false)", !isAppLocked());
  check("appLock: subscriber notified again on the real flip back", calls, 2);

  unsubscribe();
  setAppLocked(true);
  check("appLock: unsubscribed listener is not called again", calls, 2);
  setAppLocked(false); // leave state clean for the next section
}

// ── 2. lib/api.ts request gate ─────────────────────────────────────────

function fakeOkResponse(body) {
  return { ok: true, status: 200, json: async () => body };
}

async function withStubbedFetch(run) {
  const realFetch = globalThis.fetch;
  let callCount = 0;
  globalThis.fetch = async () => {
    callCount += 1;
    return fakeOkResponse([]);
  };
  try {
    return await run(() => callCount);
  } finally {
    globalThis.fetch = realFetch;
  }
}

await withStubbedFetch(async (getCallCount) => {
  ok("request gate: starts unlocked for this section", !isAppLocked());

  // A call that goes through the shared get<T> helper (get/post/del cover
  // most of `api`).
  const before = await api.getInvestmentAccounts();
  check("request gate: unlocked get<T>-backed call issues a fetch", getCallCount(), 1);
  check("request gate: unlocked call resolves with the stubbed body", before, []);

  setAppLocked(true);

  let rejectedWith = null;
  try {
    await api.getInvestmentAccounts();
  } catch (e) {
    rejectedWith = e;
  }
  ok("request gate: get<T>-backed call while locked rejects", rejectedWith != null);
  ok("request gate: rejection is an AppLockedError", rejectedWith instanceof AppLockedError);
  check("request gate: no NEW fetch was issued while locked", getCallCount(), 1);

  // A hand-rolled, non-async, `.then()`-chained call site (bypasses
  // get/post/del entirely) — the pattern most exposed to a synchronous-throw
  // regression, since a synchronous throw during evaluation of its fetch()
  // call's arguments would escape the call itself, not a `.catch()`.
  let threwSynchronously = false;
  let maybeRejected;
  try {
    maybeRejected = api.deleteYapilyConnection("fake-consent-token");
  } catch {
    threwSynchronously = true;
  }
  check("request gate: hand-rolled call site does not throw synchronously while locked", threwSynchronously, false);
  let rawRejectedWith = null;
  if (!threwSynchronously) {
    try {
      await maybeRejected;
    } catch (e) {
      rawRejectedWith = e;
    }
  }
  ok("request gate: hand-rolled call site rejects with AppLockedError instead", rawRejectedWith instanceof AppLockedError);
  check("request gate: still no NEW fetch from the hand-rolled call site either", getCallCount(), 1);

  setAppLocked(false);

  const after = await api.getInvestmentAccounts();
  check("request gate: same call after unlock issues a fresh fetch", getCallCount(), 2);
  check("request gate: post-unlock call resolves normally", after, []);
});

// ── /auth/logout exemption (independent review of A121, closing an A118
//    dependency: A118's api.logout() call must revoke the server session
//    even if it happens to run while the app is locked) ──────────────────
//
// A118 (sibling branch, not merged here) is what actually adds an
// api.logout() caller — this tests lib/api.ts's `gatedFetch` (the same
// function every api.* method funnels through as `fetch`) directly with raw
// URLs instead, since the exemption is matched by REQUEST PATH, not by
// which api.* method issued it — it holds regardless of which of
// A118/A121 lands first.
await withStubbedFetch(async (getCallCount) => {
  setAppLocked(true);
  ok("auth/logout exemption: locked for this section", isAppLocked());

  let resolved;
  try {
    resolved = await gatedFetch("/api/auth/logout", { method: "POST" });
  } catch (e) {
    resolved = e;
  }
  ok("auth/logout exemption: plain path is NOT refused while locked", !(resolved instanceof AppLockedError));
  check("auth/logout exemption: plain path DOES reach the stubbed fetch", getCallCount(), 1);

  let rejected = null;
  try {
    await gatedFetch("/api/accounts");
  } catch (e) {
    rejected = e;
  }
  ok("auth/logout exemption: an unrelated path is still refused while locked", rejected instanceof AppLockedError);
  check("auth/logout exemption: unrelated path issues no NEW fetch", getCallCount(), 1);

  try {
    await gatedFetch("/api/auth/logout?x=1");
  } catch { /* should not reject */ }
  check("auth/logout exemption: a query string on the real path still passes through", getCallCount(), 2);

  try {
    await gatedFetch(new Request("https://example.com/api/auth/logout", { method: "POST" }));
  } catch { /* should not reject */ }
  check("auth/logout exemption: a Request object for the real path also passes through", getCallCount(), 3);

  let spoofRejected = null;
  try {
    await gatedFetch("/api/auth/logout-not-really");
  } catch (e) {
    spoofRejected = e;
  }
  ok("auth/logout exemption: a similarly-named path is NOT exempted", spoofRejected instanceof AppLockedError);
  check("auth/logout exemption: the lookalike path issues no NEW fetch", getCallCount(), 3);

  let queryClaimRejected = null;
  try {
    await gatedFetch("/api/foo?next=/auth/logout");
  } catch (e) {
    queryClaimRejected = e;
  }
  ok("auth/logout exemption: /auth/logout inside a QUERY STRING does not spoof the exemption", queryClaimRejected instanceof AppLockedError);
  check("auth/logout exemption: the query-spoof attempt issues no NEW fetch", getCallCount(), 3);

  setAppLocked(false);
});

// ── /auth/session/validate exemption (A125, closing the structural gap the
//    A121 review raised: components/AuthProvider.tsx's mount-time check and
//    its A124 focus/visibilitychange/resume revalidate now both call this
//    file's `gatedFetch` instead of the raw global `fetch`, so a locked
//    device still discovers a session revoked elsewhere — see this
//    exemption's own comment above `APP_LOCK_EXEMPT_PATHS` for the full
//    reasoning) ───────────────────────────────────────────────────────────
await withStubbedFetch(async (getCallCount) => {
  setAppLocked(true);
  ok("session/validate exemption: locked for this section", isAppLocked());

  let resolved;
  try {
    resolved = await gatedFetch("/api/auth/session/validate", { method: "POST" });
  } catch (e) {
    resolved = e;
  }
  ok("session/validate exemption: plain path is NOT refused while locked", !(resolved instanceof AppLockedError));
  check("session/validate exemption: plain path DOES reach the stubbed fetch", getCallCount(), 1);

  let spoofRejected = null;
  try {
    await gatedFetch("/api/auth/session/validate-not-really");
  } catch (e) {
    spoofRejected = e;
  }
  ok("session/validate exemption: a similarly-named path is NOT exempted", spoofRejected instanceof AppLockedError);
  check("session/validate exemption: the lookalike path issues no NEW fetch", getCallCount(), 1);

  let rejected = null;
  try {
    await gatedFetch("/api/accounts");
  } catch (e) {
    rejected = e;
  }
  ok("session/validate exemption: an unrelated path is still refused while locked", rejected instanceof AppLockedError);
  check("session/validate exemption: unrelated path issues no NEW fetch", getCallCount(), 1);

  setAppLocked(false);
});

if (failures > 0) {
  console.error(`\n${failures} check(s) failed.`);
  process.exit(1);
} else {
  console.log("\nAll checks passed.");
}
