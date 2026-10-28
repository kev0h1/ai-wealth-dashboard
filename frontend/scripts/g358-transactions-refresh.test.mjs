// G358: the Search screen updates every touched row and re-applies its filter.
// Run with: npm run -s check:g358-transactions-refresh
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { applyCategoryChange, matchesCategoryFilter } from "../lib/transactionsListUpdate.ts";

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
let n = 0;
const ok = (name, fn) => { fn(); n += 1; console.log(`ok - ${name}`); };

const rows = () => [
  { id: "a", category: "Other" },
  { id: "b", category: "Other" },
  { id: "c", category: "" },
  { id: "d", category: "Groceries" },
];

ok("change-all updates every id", () => {
  const r = applyCategoryChange(rows(), 4, { ids: ["a", "b"], category: "Eating Out" }, {});
  assert.deepEqual(r.items.filter((x) => x.category === "Eating Out").map((x) => x.id), ["a", "b"]);
  assert.equal(r.items.length, 4);
  assert.equal(r.total, 4);
  assert.deepEqual(r.removedIds, []);
});

ok("a filtered Other list drops rows now Eating Out and decrements total", () => {
  const r = applyCategoryChange(rows().slice(0, 3), 10, { ids: ["a", "b"], category: "Eating Out" }, { categories: ["Other"] });
  assert.deepEqual(r.items.map((x) => x.id), ["c"]);
  assert.equal(r.total, 8);
  assert.deepEqual(r.removedIds, ["a", "b"]);
});

ok("an unfiltered list keeps them", () => {
  const r = applyCategoryChange(rows(), 4, { ids: ["a"] , category: "Eating Out" }, { categories: null });
  assert.equal(r.items.length, 4);
  assert.equal(r.total, 4);
});

ok("Other matches empty and missing category, like the backend", () => {
  assert.equal(matchesCategoryFilter("", ["Other"]), true);
  assert.equal(matchesCategoryFilter(undefined, ["Other"]), true);
  assert.equal(matchesCategoryFilter("Travel", ["Other"]), false);
  assert.equal(matchesCategoryFilter("Travel", ["Other", "Travel"]), true);
});

ok("rows not in the list and untouched rows are left alone", () => {
  const r = applyCategoryChange(rows(), 4, { ids: ["zzz"], category: "Eating Out" }, { categories: ["Other"] });
  assert.equal(r.items.length, 4);
  assert.equal(r.total, 4);
});

ok("handleAlways passes affected ids to onUpdated on the success path", () => {
  const src = read("components/TeachingSheet.tsx");
  const fn = src.slice(src.indexOf("async function handleAlways"), src.indexOf("function handleJustThisOnce"));
  const after = fn.slice(fn.indexOf("await api.addRule"), fn.indexOf("} catch"));
  assert.match(after, /onUpdated\(/);
  assert.match(after, /saved\.affected_ids/);
  assert.match(after, /invalidateAfterTransactionCorrection\(/);
  const catchBlock = fn.slice(fn.indexOf("} catch"));
  assert.doesNotMatch(catchBlock, /onUpdated\(|invalidateAfterTransactionCorrection\(/);
  assert.match(src, /res\.affected_ids/);
});

ok("TransactionsPage listens to the event and reloads via a key in the fetch deps", () => {
  const src = read("app/transactions/TransactionsPage.tsx");
  assert.match(src, /addEventListener\(TRANSACTIONS_CHANGED_EVENT/);
  assert.match(src, /removeEventListener\(TRANSACTIONS_CHANGED_EVENT/);
  assert.match(src, /txnType, page, reloadKey\]\)/);
  assert.match(src, /applyCategoryChange\(/);
});

ok("confirmProposal invalidates and notifies on recategorise", () => {
  const src = read("components/PennyConversation.tsx");
  const fn = src.slice(src.indexOf("function confirmProposal"));
  assert.match(fn, /"recategorise_transaction"/);
  assert.match(fn, /invalidateAfterTransactionCorrection\(/);
  assert.match(fn, /notifyTransactionsChanged\(/);
});

ok("a category group change invalidates the transactions cache and notifies", () => {
  const src = read("components/CategoryGroupsSheet.tsx");
  assert.match(src, /invalidateTransactionsCache\(\);\s*notifyTransactionsChanged\(\)/);
});

console.log(`${n} passed`);
