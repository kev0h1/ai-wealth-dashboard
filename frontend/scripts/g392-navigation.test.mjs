// Run with:
// node --no-warnings --experimental-strip-types scripts/g392-navigation.test.mjs
//
// This exercises the real route-state helper used by TransactionsPage. The
// small Spend assertion protects the recovery contract whose UI is owned by
// MiscategorisedReviewSheet: a settled zero or failed preliminary count must
// still open that sheet, never replace the requested route with Search.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { readTransactionSearchRoute, writeTransactionSearchRoute } from "../lib/transactionSearchRoute.ts";

const restored = readTransactionSearchRoute(new URLSearchParams("q=coffee&page=3&category=Food&from=2026-10-01"));
assert.deepEqual(restored, { query: "coffee", page: 3 }, "a reopened search restores its query and page");

const malformed = readTransactionSearchRoute(new URLSearchParams("q=%20tea%20&page=0"));
assert.deepEqual(malformed, { query: "tea", page: 1 }, "invalid pages normalise safely without losing the query");

const changedCriteria = writeTransactionSearchRoute(
  new URLSearchParams("category=Food&from=2026-10-01&q=coffee&page=3"),
  { query: "tea", page: 1 },
);
assert.equal(changedCriteria.toString(), "category=Food&from=2026-10-01&q=tea", "a changed criterion resets only pagination and retains filters");

const restoredAfterBack = writeTransactionSearchRoute(
  new URLSearchParams("category=Food&q=coffee&page=3"),
  { query: "coffee", page: 3 },
);
assert.equal(restoredAfterBack.toString(), "category=Food&q=coffee&page=3", "restoring a browser history entry is idempotent");

const spend = readFileSync(new URL("../app/components/SpendPage.tsx", import.meta.url), "utf8");
const reviewEffect = spend.slice(spend.indexOf("// Penny's spend chip"), spend.indexOf("useEffect(() => {\n    // \"statements\""));
assert.match(reviewEffect, /setReviewOpen\(true\)/, "a settled review link opens the review sheet");
assert.doesNotMatch(reviewEffect, /router\.replace\("\/transactions"/, "zero or failed preliminary counts do not redirect a review request to Search");

console.log("G392 navigation checks passed");
