// Plain-Node test for G83: lib/verdictCache.ts and lib/moneyShape.ts must
// reuse a warm (TTL-fresh) cache instead of refetching on every call — the
// in-flight dedup they already had only ever collapsed CONCURRENT calls,
// not sequential ones a few seconds apart (HomePage's idle warm-up, then
// SpendPage.tsx's own mount effect a moment later, hit /spend/verdict
// twice for data that could not possibly have changed; the equivalent
// SpendPage.tsx/ShapePage.tsx pair did the same to /money-shape).
//
// Same framework-free pattern as scripts/spend-from-account.test.mjs:
// imports the REAL production modules, not a hand-copied re-implementation,
// and stubs `api.spendVerdict`/`api.getMoneyShape` in place (the `api`
// object in lib/api.ts is a plain, unfrozen object literal, so overwriting
// a method on it after import affects every module that already imported
// the same `api` singleton — including verdictCache.ts/moneyShape.ts under
// test here). No network, no Mongo, no real account.
//
// Requires scripts/_ts-extensionless-loader.mjs's G83 addition (rewriting
// the `@/*` tsconfig path alias to a real file URL) — plain Node has no
// notion of that alias, and both modules under test import `@/lib/api` at
// their top, which the loader's original extensionless-relative-only retry
// could not have resolved.
//
// Run with:
//   npm run -s check:verdict-cache
// or:
//   node --no-warnings --experimental-strip-types --experimental-loader ./scripts/_ts-extensionless-loader.mjs scripts/verdict-cache.test.mjs

import { api } from "../lib/api";
import {
  fetchVerdictData,
  cachedVerdict,
  invalidateVerdictCache,
  VERDICT_TTL_MS,
} from "../lib/verdictCache";
import {
  loadMoneyShape,
  peekMoneyShape,
  invalidateMoneyShapeCache,
  MONEY_SHAPE_TTL_MS,
} from "../lib/moneyShape";

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

// Freeze/advance time deterministically rather than sleeping for real —
// every module under test calls the global `Date.now`, so patching it here
// moves both the cache's own "at" stamps and its freshness checks in
// lockstep, without a real 90-second wait in a test.
const realDateNow = Date.now;
let fakeNow = realDateNow();
Date.now = () => fakeNow;
function advance(ms) { fakeNow += ms; }

function fakeVerdict(offset, tag) {
  return { offset, tag, reading: `reading-${tag}`, pace_series: [], notables: [], majority: [] };
}

// ── verdictCache.ts ──────────────────────────────────────────────────────

{
  invalidateVerdictCache();
  let calls = 0;
  api.spendVerdict = async (offset = 0) => { calls += 1; return fakeVerdict(offset, `call${calls}`); };

  await fetchVerdictData(0);
  check("first fetch for offset 0 hits the network once", calls, 1);

  await fetchVerdictData(0);
  check("G83: a second sequential call within the TTL reuses the cache, no second network call", calls, 1);
  check("cachedVerdict reflects the same cached value", cachedVerdict(0)?.tag, "call1");

  advance(VERDICT_TTL_MS + 1);
  check("cachedVerdict returns null once the TTL has actually elapsed", cachedVerdict(0), null);

  await fetchVerdictData(0);
  check("a call past the TTL DOES hit the network again (this is not a forever-cache)", calls, 2);
}

{
  // In-flight dedup for genuinely concurrent calls must still work — G83's
  // fix must not regress this pre-existing behaviour.
  invalidateVerdictCache();
  let calls = 0;
  let resolveFetch;
  api.spendVerdict = async (offset = 0) => {
    calls += 1;
    return new Promise((resolve) => { resolveFetch = () => resolve(fakeVerdict(offset, "concurrent")); });
  };
  const p1 = fetchVerdictData(3);
  const p2 = fetchVerdictData(3);
  resolveFetch();
  const [v1, v2] = await Promise.all([p1, p2]);
  check("two concurrent calls for the same offset hit the network once", calls, 1);
  check("both concurrent callers resolve to the same data", v1.tag === v2.tag, true);
}

{
  // Different offsets (closed prior periods) are cached independently — a
  // fresh entry for offset 0 must not suppress a fetch for offset -1.
  invalidateVerdictCache();
  let calls = 0;
  api.spendVerdict = async (offset = 0) => { calls += 1; return fakeVerdict(offset, `o${offset}`); };
  await fetchVerdictData(0);
  await fetchVerdictData(-1);
  check("distinct offsets are cached independently, both fetched", calls, 2);
  await fetchVerdictData(0);
  await fetchVerdictData(-1);
  check("both stay warm on a repeat visit, no further fetches", calls, 2);
}

{
  invalidateVerdictCache();
  let calls = 0;
  api.spendVerdict = async (offset = 0) => { calls += 1; return fakeVerdict(offset, "inv"); };
  await fetchVerdictData(0);
  invalidateVerdictCache();
  await fetchVerdictData(0);
  check("invalidateVerdictCache forces the next call back to the network", calls, 2);
}

// ── moneyShape.ts ────────────────────────────────────────────────────────

function fakeShape(tag) {
  return { tag, periods: [], averages: [], what_works: [] };
}

{
  invalidateMoneyShapeCache();
  let calls = 0;
  api.getMoneyShape = async () => { calls += 1; return fakeShape(`call${calls}`); };

  await loadMoneyShape();
  check("first loadMoneyShape call hits the network once", calls, 1);

  await loadMoneyShape();
  check("G83: a second sequential call within the TTL reuses the cache, no second network call", calls, 1);
  check("peekMoneyShape reflects the same cached value with no fetch", peekMoneyShape()?.tag, "call1");

  advance(MONEY_SHAPE_TTL_MS + 1);
  await loadMoneyShape();
  check("a call past the TTL DOES hit the network again (this is not a forever-cache)", calls, 2);
}

{
  invalidateMoneyShapeCache();
  let calls = 0;
  let resolveFetch;
  api.getMoneyShape = async () => {
    calls += 1;
    return new Promise((resolve) => { resolveFetch = () => resolve(fakeShape("concurrent")); });
  };
  const p1 = loadMoneyShape();
  const p2 = loadMoneyShape();
  resolveFetch();
  const [s1, s2] = await Promise.all([p1, p2]);
  check("two concurrent loadMoneyShape calls hit the network once", calls, 1);
  check("both concurrent callers resolve to the same data", s1.tag === s2.tag, true);
}

{
  check("peekMoneyShape returns null before anything has ever loaded", (invalidateMoneyShapeCache(), peekMoneyShape()), null);
}

{
  invalidateMoneyShapeCache();
  let calls = 0;
  api.getMoneyShape = async () => { calls += 1; return fakeShape("inv"); };
  await loadMoneyShape();
  invalidateMoneyShapeCache();
  await loadMoneyShape();
  check("invalidateMoneyShapeCache forces the next call back to the network", calls, 2);
}

Date.now = realDateNow;

if (failures > 0) {
  console.error(`\n${failures} failure(s).`);
  process.exit(1);
}
console.log("\nAll verdict-cache/money-shape TTL (G83) checks passed.");
