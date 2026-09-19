// Plain-Node test for the G83 rejection-round fix: a category add/delete
// must invalidate BOTH the verdict cache and the money-shape cache, not
// just leave them to expire on their own 90s TTL (lib/verdictCache.ts,
// lib/moneyShape.ts).
//
// The review that rejected G83's first pass found this exact gap by
// inspection: invalidateMoneyShapeCache had exactly ONE caller in the whole
// frontend (AuthProvider's logout) — nothing called it from
// CategoriesContext, even though lib/moneyShape.ts's own comment already
// named category-kind edits as the trigger the SERVER cache reacts to. This
// test proves the gap mechanically rather than by inspection: reclassify a
// category, then read straight off the cache (no component, no render) and
// assert it does NOT still hand back the pre-edit value.
//
// Same framework-free pattern as scripts/verdict-cache.test.mjs: imports
// the REAL production modules — lib/categoryMutations.ts (the
// write-plus-invalidate body CategoriesContext.tsx's addCategory/
// deleteCategory now delegate to, extracted for exactly this reason),
// lib/verdictCache.ts and lib/moneyShape.ts — and stubs `api.addCategory`/
// `api.deleteCategory`/`api.spendVerdict`/`api.getMoneyShape` in place. No
// network, no Mongo, no real account, no React renderer (this repo's test
// toolchain has none, and CategoriesContext.tsx is a React component — the
// extraction into lib/categoryMutations.ts is what makes this testable at
// all without one).
//
// Run with:
//   npm run -s check:category-mutations
// or:
//   node --no-warnings --experimental-strip-types --experimental-loader ./scripts/_ts-extensionless-loader.mjs scripts/category-mutations.test.mjs

import { api } from "../lib/api";
import { addCategoryAndInvalidate, deleteCategoryAndInvalidate } from "../lib/categoryMutations";
import { fetchVerdictData, invalidateVerdictCache } from "../lib/verdictCache";
import { loadMoneyShape, invalidateMoneyShapeCache } from "../lib/moneyShape";

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

function fakeVerdict(tag) {
  return { tag, reading: `reading-${tag}`, pace_series: [], notables: [], majority: [] };
}
function fakeShape(tag) {
  return { tag, periods: [], averages: [], what_works: [] };
}

// ── addCategoryAndInvalidate drops a warm verdict cache ─────────────────────
{
  invalidateVerdictCache();
  let verdictCalls = 0;
  api.spendVerdict = async () => { verdictCalls += 1; return fakeVerdict(`v${verdictCalls}`); };
  api.addCategory = async (name, kind) => ({
    all: ["Other", name], custom: [name], kinds: { [name]: kind ?? "discretionary" },
  });

  // Warm the cache the way a normal Spend visit would.
  const before = await fetchVerdictData(0);
  check("verdict cache warmed with the pre-edit value", before.tag, "v1");
  const stillWarm = await fetchVerdictData(0);
  check("cache genuinely warm (no second network call yet)", verdictCalls, 1);

  // The actual mutation under test: reclassify (add) a category.
  await addCategoryAndInvalidate("Streaming", "discretionary");

  // The bug this proves: WITHOUT the fix, fetchVerdictData(0) would still
  // be within the 90s TTL and hand back the stale `before` value — this
  // call would return tag "v1" again with verdictCalls staying at 1.
  const after = await fetchVerdictData(0);
  check("a category add forces the verdict cache to refetch, not serve the pre-edit value", verdictCalls, 2);
  check("the refetched verdict is NOT the pre-edit one", after.tag !== before.tag, true);
}

// ── addCategoryAndInvalidate drops a warm money-shape cache ─────────────────
{
  invalidateMoneyShapeCache();
  let shapeCalls = 0;
  api.getMoneyShape = async () => { shapeCalls += 1; return fakeShape(`s${shapeCalls}`); };
  api.addCategory = async (name, kind) => ({
    all: ["Other", name], custom: [name], kinds: { [name]: kind ?? "discretionary" },
  });

  const before = await loadMoneyShape();
  check("money-shape cache warmed with the pre-edit value", before.tag, "s1");
  await loadMoneyShape();
  check("cache genuinely warm (no second network call yet)", shapeCalls, 1);

  await addCategoryAndInvalidate("Streaming", "discretionary");

  const after = await loadMoneyShape();
  check("a category add forces the money-shape cache to refetch, not serve the pre-edit value", shapeCalls, 2);
  check("the refetched shape is NOT the pre-edit one", after.tag !== before.tag, true);
}

// ── deleteCategoryAndInvalidate does the same for both caches ───────────────
{
  invalidateVerdictCache();
  invalidateMoneyShapeCache();
  let verdictCalls = 0;
  let shapeCalls = 0;
  api.spendVerdict = async () => { verdictCalls += 1; return fakeVerdict(`dv${verdictCalls}`); };
  api.getMoneyShape = async () => { shapeCalls += 1; return fakeShape(`ds${shapeCalls}`); };
  api.deleteCategory = async () => ({ deleted: "Streaming" });

  await fetchVerdictData(0);
  await loadMoneyShape();
  check("both caches warmed before the delete", [verdictCalls, shapeCalls], [1, 1]);

  await deleteCategoryAndInvalidate("Streaming");

  await fetchVerdictData(0);
  await loadMoneyShape();
  check("a category delete forces BOTH caches to refetch", [verdictCalls, shapeCalls], [2, 2]);
}

if (failures > 0) {
  console.error(`\n${failures} failure(s).`);
  process.exit(1);
}
console.log("\nAll category-mutations cache-invalidation checks passed.");
