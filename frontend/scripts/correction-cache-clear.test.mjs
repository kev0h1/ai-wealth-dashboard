// G146: a transaction correction (re-categorising a row via TeachingSheet.tsx,
// or confirming a transfer pair via MiscategorisedReviewSheet.tsx) never
// cleared any client-side cache — the server side was already correct
// (routers/transactions.py's update_transaction invalidates the whole
// response cache on every write), but lib/homeCache.ts's companionItems
// warm-paint snapshot (the Home brief) and lib/signalsCache.ts's per-period
// category multiples (the spending-pattern card's "x usual" figures) had no
// way to know a correction had happened at all, and kept painting
// pre-correction data until a hard refresh.
//
// Two halves, same as scripts/account-mutations.test.mjs and
// scripts/check-account-cache-coverage.mjs combined:
//
//   1. A dynamic proof against the REAL lib/cacheInvalidation.ts module (no
//      network, no Mongo, no React renderer — stub `api.*`, same pattern as
//      every other cache test in this file's own family): every affected
//      cache is empty after a call, every unaffected cache is untouched.
//
//   2. A static proof read straight off the REAL production source of
//      components/TeachingSheet.tsx and components/MiscategorisedReviewSheet.
//      tsx (not a reimplementation of their logic — both are hook-bound
//      React components with no plain-function seam a Node script could
//      call directly, the same reason check-account-cache-coverage.mjs reads
//      lib/accountMutations.ts as text instead of executing it): the shared
//      invalidator is called from the SUCCESS path of every write, and NEVER
//      from a catch block — "a failed correction clears nothing" is a
//      structural guarantee here, not something that can be executed and
//      observed without a renderer.
//
// Run with:
//   npm run -s check:correction-cache-clear
// or:
//   node --no-warnings --experimental-strip-types --experimental-loader ./scripts/_ts-extensionless-loader.mjs scripts/correction-cache-clear.test.mjs

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { api } from "../lib/api";
import { invalidateAfterTransactionCorrection } from "../lib/cacheInvalidation";
import { getHomeCache, setHomeCache, clearHomeCache } from "../lib/homeCache";
import { fetchVerdictData, invalidateVerdictCache } from "../lib/verdictCache";
import { fetchSignals, invalidateSignalsCache } from "../lib/signalsCache";
import { getAllTransactionsCached, invalidateTransactionsCache } from "../lib/useAllTransactions";
import { getAccountsCached, invalidateAccounts } from "../lib/accountsCache";
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

// ═══════════════════════════════════════════════════════════════════════════
// Part 1 — invalidateAfterTransactionCorrection clears exactly the right
// caches (real module, stubbed api, no network).
// ═══════════════════════════════════════════════════════════════════════════

// ── clears the 365-day transactions cache (SpendTrends + the Accounts
//    rule-builder's match-preview pool both read off this) ─────────────────
{
  invalidateTransactionsCache();
  let calls = 0;
  api.allTransactions = async () => { calls += 1; return [{ id: `t${calls}` }]; };

  const before = await getAllTransactionsCached();
  await getAllTransactionsCached();
  check("transactions cache genuinely warm before the correction (no second call yet)", calls, 1);

  invalidateAfterTransactionCorrection("txn1", { oldCategory: "Old", newCategory: "New" });

  const after = await getAllTransactionsCached();
  check("invalidateAfterTransactionCorrection forces the transactions cache to refetch", calls, 2);
  check("the refetched list is NOT the pre-correction one", after[0].id !== before[0].id, true);
}

// ── clears the Spend verdict cache (notable/majority/unresolved) ───────────
{
  invalidateVerdictCache();
  let calls = 0;
  api.spendVerdict = async () => { calls += 1; return { tag: `v${calls}`, reading: "r", pace_series: [], notables: [], majority: [] }; };

  const before = await fetchVerdictData(0);
  await fetchVerdictData(0);
  check("verdict cache genuinely warm before the correction (no second call yet)", calls, 1);

  invalidateAfterTransactionCorrection("txn1", { oldCategory: "Old", newCategory: "New" });

  const after = await fetchVerdictData(0);
  check("invalidateAfterTransactionCorrection forces the verdict cache to refetch", calls, 2);
  check("the refetched verdict is NOT the pre-correction one", after.tag !== before.tag, true);
}

// ── clears the category-signals cache (the spending-pattern card's "x
//    usual" figures — the exact symptom G146 was filed for) ───────────────
{
  invalidateSignalsCache();
  let calls = 0;
  api.categorySignals = async () => { calls += 1; return { signals: { Padel: { multiple: calls } } }; };

  const before = await fetchSignals(0);
  await fetchSignals(0);
  check("signals cache genuinely warm before the correction (no second call yet)", calls, 1);

  invalidateAfterTransactionCorrection("txn1", { oldCategory: "Old", newCategory: "New" });

  const after = await fetchSignals(0);
  check("invalidateAfterTransactionCorrection forces the signals cache to refetch", calls, 2);
  check("the refetched multiple is NOT the pre-correction one", after.Padel.multiple !== before.Padel.multiple, true);
}

// ── clears the Home warm-paint cache (companionItems — the Home brief,
//    the other exact symptom G146 was filed for) ───────────────────────────
{
  clearHomeCache();
  setHomeCache({
    accounts: [],
    investmentAccounts: [],
    safeToSpend: null,
    companionItems: [{ id: "brief-padel-6x" }],
    accountEligibility: undefined,
    todayStatus: "ready",
    accountsStatus: "ready",
    recentTxns: [],
  });
  check("Home cache warmed with the pre-correction companionItems", getHomeCache()?.companionItems[0].id, "brief-padel-6x");

  invalidateAfterTransactionCorrection("txn1", { oldCategory: "Old", newCategory: "New" });

  check("invalidateAfterTransactionCorrection clears the Home cache back to null", getHomeCache(), null);
}

// ── does NOT touch the accounts cache — a category correction adds/removes
//    no account, unlike the account mutations lib/accountMutations.ts
//    covers ─────────────────────────────────────────────────────────────────
{
  invalidateAccounts();
  let calls = 0;
  api.accounts = async () => { calls += 1; return [{ id: `a${calls}` }]; };

  await getAccountsCached();
  check("accounts cache genuinely warm before the correction", calls, 1);

  invalidateAfterTransactionCorrection("txn1", { oldCategory: "Old", newCategory: "New" });

  await getAccountsCached();
  check("invalidateAfterTransactionCorrection leaves the accounts cache untouched", calls, 1);
}

// ── does NOT touch the money-shape cache — only a category KIND edit
//    invalidates it (see lib/categoryMutations.ts's own comment), never a
//    single transaction's category value ───────────────────────────────────
{
  invalidateMoneyShapeCache();
  let calls = 0;
  api.getMoneyShape = async () => { calls += 1; return { tag: `s${calls}`, periods: [], averages: [], what_works: [] }; };

  await loadMoneyShape();
  check("money-shape cache genuinely warm before the correction", calls, 1);

  invalidateAfterTransactionCorrection("txn1", { oldCategory: "Old", newCategory: "New" });

  await loadMoneyShape();
  check("invalidateAfterTransactionCorrection leaves the money-shape cache untouched", calls, 1);
}

// ═══════════════════════════════════════════════════════════════════════════
// Part 2 — static proof against the REAL production source: the shared
// invalidator is wired into every success path and NEVER a catch block.
// ═══════════════════════════════════════════════════════════════════════════

const frontendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const teachingSheetSrc = readFileSync(path.join(frontendRoot, "components/TeachingSheet.tsx"), "utf8");
const miscategorisedSrc = readFileSync(path.join(frontendRoot, "components/MiscategorisedReviewSheet.tsx"), "utf8");

/** Brace-counting body extractor — every catch/finish body in both files is
 *  brace-free internally (verified by eye against the source this was
 *  written against), so a naive `[^}]*` regex is exact here, but this walks
 *  real braces instead of assuming that stays true forever. */
function extractBody(src, signatureRegex) {
  const m = signatureRegex.exec(src);
  if (!m) return null;
  const openIdx = src.indexOf("{", m.index + m[0].length);
  if (openIdx === -1) return null;
  let depth = 0;
  for (let i = openIdx; i < src.length; i++) {
    if (src[i] === "{") depth += 1;
    else if (src[i] === "}") {
      depth -= 1;
      if (depth === 0) return src.slice(openIdx + 1, i);
    }
  }
  return null;
}

/** Every failure body in the file, in source order — both shapes this
 *  codebase actually writes: the `try`/`catch` keyword form TeachingSheet.tsx
 *  uses (`catch { ... }`, `catch (e) { ... }`) and the Promise `.catch(() =>
 *  { ... })` method-call form MiscategorisedReviewSheet.tsx uses instead
 *  (async/await vs. `.then()/.catch()` chains — the two are NOT
 *  interchangeable text patterns: `.catch(` is a method name followed by an
 *  arrow function, not the `catch` keyword, so a regex written for one shape
 *  silently finds zero matches against the other rather than erroring, which
 *  is exactly the false-negative failure mode this comment exists to head
 *  off). This is the thing every "a failed write clears nothing" claim below
 *  is actually checked against. */
function catchBodies(src) {
  const keywordForm = [...src.matchAll(/catch\s*(?:\([^)]*\))?\s*\{([^{}]*)\}/g)].map((m) => m[1]);
  const promiseForm = [...src.matchAll(/\.catch\(\s*\(\)\s*=>\s*\{([^{}]*)\}\s*\)/g)].map((m) => m[1]);
  return [...keywordForm, ...promiseForm];
}

function countOccurrences(haystack, needle) {
  return haystack == null ? 0 : (haystack.match(new RegExp(needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g")) || []).length;
}

// ── TeachingSheet.tsx ────────────────────────────────────────────────────

const notifyUpdatedBody = extractBody(teachingSheetSrc, /function notifyUpdated\([^)]*\)\s*/);
check("TeachingSheet.tsx's notifyUpdated exists", notifyUpdatedBody !== null, true);
check(
  "notifyUpdated calls the shared G146 invalidator exactly once",
  countOccurrences(notifyUpdatedBody, "invalidateAfterTransactionCorrection("),
  1,
);
check(
  "notifyUpdated no longer calls the old narrow invalidateVerdictCache() directly (regression guard: the old fix this item replaces)",
  countOccurrences(notifyUpdatedBody, "invalidateVerdictCache("),
  0,
);

const teachingSheetCatches = catchBodies(teachingSheetSrc);
check("TeachingSheet.tsx has catch blocks to check (regex sanity)", teachingSheetCatches.length > 0, true);
check(
  "no catch block in TeachingSheet.tsx calls the invalidator or notifyUpdated — a failed PATCH/resolve-movement write must leave every cache untouched",
  teachingSheetCatches.every((b) => !b.includes("invalidateAfterTransactionCorrection(") && !b.includes("notifyUpdated(")),
  true,
);

// Every commit/undo function's try block calls notifyUpdated on its success
// path at least once (commitSpend has two MUTUALLY EXCLUSIVE branches, one
// ending in an early `return` before the other can run, so 2 occurrences in
// its body is "exactly once per execution", not a double-invalidate).
const FUNCTIONS_CALLING_NOTIFY_ONCE = [
  ["commitMovement", /async function commitMovement\(\s*resolution: "mine-here" \| "mine-goal" \| "mine-offline",[\s\S]*?successMessage: string,\s*\)\s*/],
  ["undoMovement", /async function undoMovement\(\)\s*/],
  ["commitCreditMovement", /async function commitCreditMovement\(category: "Transfer" \| "Income"\)\s*/],
  ["undoCreditMovement", /async function undoCreditMovement\(\)\s*/],
  ["undoToSpend", /async function undoToSpend\(_appliedCategory: string\)\s*/],
];
for (const [fnName, sig] of FUNCTIONS_CALLING_NOTIFY_ONCE) {
  const body = extractBody(teachingSheetSrc, sig);
  check(`${fnName} extracted (regex still matches the real source)`, body !== null, true);
  check(`${fnName} calls notifyUpdated exactly once on its success path`, countOccurrences(body, "notifyUpdated("), 1);
}
{
  const body = extractBody(teachingSheetSrc, /async function commitSpend\(category: string\)\s*/);
  check("commitSpend extracted (regex still matches the real source)", body !== null, true);
  check(
    "commitSpend calls notifyUpdated exactly twice in source, once per MUTUALLY EXCLUSIVE branch (movement branch returns before the plain-PATCH branch can run)",
    countOccurrences(body, "notifyUpdated("),
    2,
  );
  check("commitSpend's movement branch returns before falling through to the PATCH branch", /notifyUpdated\([^)]*\);\s*finish\([^;]*;\s*return;/.test(body), true);
}

const handleAlwaysBody = extractBody(teachingSheetSrc, /async function handleAlways\(\)\s*/);
check("handleAlways extracted (regex still matches the real source)", handleAlwaysBody !== null, true);
check(
  "handleAlways calls the shared invalidator exactly once, for the sibling bulk-recategorise wave, only after addRule's await succeeds",
  countOccurrences(handleAlwaysBody, "invalidateAfterTransactionCorrection("),
  1,
);

// ── MiscategorisedReviewSheet.tsx ────────────────────────────────────────

const misCatches = catchBodies(miscategorisedSrc);
check("MiscategorisedReviewSheet.tsx has catch blocks to check (regex sanity)", misCatches.length > 0, true);
check(
  "no catch block in MiscategorisedReviewSheet.tsx calls the invalidator — a failed confirm-transfer-pair write must leave every cache untouched",
  misCatches.every((b) => !b.includes("invalidateAfterTransactionCorrection(")),
  true,
);

const handleConfirmPairBody = extractBody(miscategorisedSrc, /function handleConfirmPair\(pair: TransferPairSuggestion\)\s*/);
check("handleConfirmPair extracted (regex still matches the real source)", handleConfirmPairBody !== null, true);
check(
  "handleConfirmPair calls the invalidator exactly once, inside confirmTransferPair's .then() (the success branch)",
  countOccurrences(handleConfirmPairBody, "invalidateAfterTransactionCorrection("),
  1,
);
const thenBody = handleConfirmPairBody != null ? extractBody(handleConfirmPairBody, /\.then\(\(res\)\s*=>\s*/) : null;
check("handleConfirmPair's .then((res) => ...) body extracted", thenBody !== null, true);
check(
  "the invalidator call sits inside the SUCCESS .then(), not the outer .catch()",
  countOccurrences(thenBody, "invalidateAfterTransactionCorrection("),
  1,
);

if (failures > 0) {
  console.error(`\n${failures} failure(s).`);
  process.exit(1);
}
console.log("\nAll correction-cache-clear (G146) checks passed.");
