// Plain-Node test for lib/homeCache.ts's shape guard (G148, 2026-09-23).
// Same framework-free pattern as scripts/account-mutations.test.mjs, which
// already loads this exact module directly.
//
// Run with:
//   node --no-warnings --experimental-strip-types --experimental-loader ./scripts/_ts-extensionless-loader.mjs scripts/home-cache-shape.test.mjs
// or:
//   npm run -s check:home-cache-shape
//
// What this guards. Home's warm-paint snapshot holds the `GET /today`
// payload alongside `companionItems`, including `accountEligibility` — the
// field the approved spend-from bank rail is built from. That field is
// legitimately `undefined` on a perfectly healthy snapshot (the request is
// still in flight), and it was ALSO undefined on Kevin's live Home because
// the payload genuinely carried no such field. A snapshot that stores the
// value without the outcome cannot tell those apart, so every warm remount
// inherited the silence, and `unavailable` was the one state the card
// rendered as nothing at all.
//
// The snapshot therefore now carries `todayStatus` with it, and the cache
// refuses any snapshot missing a key the current shape declares, in EITHER
// direction (a stale reader, a drifted writer) rather than handing HomePage
// a partial object it believes is complete.
//
// Deliberately NOT a version integer: this cache is module-scope memory that
// cannot outlive its own bundle, so reader and writer are always the same
// build and an integer could never disagree with itself. The persisted cache
// that genuinely does outlive its writer is the SERVER's
// (backend/app/services/response_cache.py), and that one is versioned with
// SHAPE_VERSION, proved by backend/tests/test_response_cache_shape_version.py.
//
// Invalidation is not re-invented here either: clearHomeCache() is wired into
// G138's single invalidator (lib/accountMutations.ts's
// invalidateAllAccountData), which scripts/check-account-cache-coverage.mjs
// enforces.

import {
  getHomeCache,
  setHomeCache,
  clearHomeCache,
  isCurrentHomeCacheShape,
} from "../lib/homeCache";

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

/** A snapshot in the CURRENT shape. */
function currentSnapshot(overrides = {}) {
  return {
    accounts: [],
    investmentAccounts: [],
    safeToSpend: null,
    companionItems: [],
    accountEligibility: { "acc-1": { short: false, headroom: 74.85 } },
    todayStatus: "ready",
    recentTxns: [],
    needle: null,
    needleStatus: "ready",
    ...overrides,
  };
}

/** The shape as it stood before G148: everything except `todayStatus`. */
function preG148Snapshot() {
  const snapshot = currentSnapshot();
  delete snapshot.todayStatus;
  return snapshot;
}

// ── The current shape round-trips ──────────────────────────────────────────
{
  clearHomeCache();
  const snapshot = currentSnapshot();
  setHomeCache(snapshot);
  check("a snapshot in the current shape is stored", getHomeCache() === snapshot, true);
  check("and it carries the request outcome alongside the value", getHomeCache()?.todayStatus, "ready");
}

// ── An old-shape snapshot is REJECTED, not used ────────────────────────────
// The headline guarantee, constructed exactly as the item asks: build a
// cached payload in the old shape and show it is refused rather than served.
{
  clearHomeCache();
  const stale = preG148Snapshot();
  check("the old shape is recognised as stale", isCurrentHomeCacheShape(stale), false);
  setHomeCache(stale);
  check(
    "writing an old-shape snapshot leaves the cache EMPTY rather than pinning a partial one",
    getHomeCache(),
    null,
  );
}

// ── A reader is protected too, not just the writer ─────────────────────────
// Covers the other direction: a snapshot that got in by some other route
// (a future writer, a hot-reloaded module) must still not be handed out.
{
  clearHomeCache();
  setHomeCache(currentSnapshot());
  // Mutate the stored object out from under the cache, simulating a snapshot
  // that was written before the key existed.
  const stored = getHomeCache();
  delete stored.todayStatus;
  check(
    "a stored snapshot that no longer matches the shape is dropped on read",
    getHomeCache(),
    null,
  );
}

// ── Legitimately absent values are NOT treated as a shape problem ──────────
// `accountEligibility` undefined, `safeToSpend` null and `needle` null are
// all normal. The guard asks whether the WRITER knew about the key, not
// whether the value is truthy — getting this wrong would throw away every
// cold-ish snapshot and defeat the cache entirely.
{
  clearHomeCache();
  const inFlight = currentSnapshot({ accountEligibility: undefined, todayStatus: "loading" });
  check("an undefined accountEligibility is still a valid shape", isCurrentHomeCacheShape(inFlight), true);
  setHomeCache(inFlight);
  check("and it is served back", getHomeCache()?.todayStatus, "loading");
  check("with the undefined value intact", getHomeCache()?.accountEligibility, undefined);

  clearHomeCache();
  const failedSnapshot = currentSnapshot({ accountEligibility: undefined, todayStatus: "failed" });
  setHomeCache(failedSnapshot);
  check(
    "a warm remount after a FAILED /today inherits the failure, not silence",
    getHomeCache()?.todayStatus,
    "failed",
  );
}

// ── Non-objects ────────────────────────────────────────────────────────────
check("null is not a valid shape", isCurrentHomeCacheShape(null), false);
check("undefined is not a valid shape", isCurrentHomeCacheShape(undefined), false);
check("a string is not a valid shape", isCurrentHomeCacheShape("warm"), false);

// ── Every declared key is required ─────────────────────────────────────────
// Not just `todayStatus`: dropping ANY key the shape declares must be
// refused, so the next field added to this snapshot inherits the guard for
// free instead of needing someone to remember it.
{
  for (const key of [
    "accounts",
    "investmentAccounts",
    "safeToSpend",
    "companionItems",
    "accountEligibility",
    "todayStatus",
    "recentTxns",
    "needle",
    "needleStatus",
  ]) {
    const partial = currentSnapshot();
    delete partial[key];
    check(`a snapshot missing '${key}' is rejected`, isCurrentHomeCacheShape(partial), false);
  }
}

clearHomeCache();

if (failures > 0) {
  console.error(`\n${failures} failure(s).`);
  process.exit(1);
}
console.log("\nAll home-cache shape (G148) checks passed.");
