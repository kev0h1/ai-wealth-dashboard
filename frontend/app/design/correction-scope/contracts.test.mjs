import assert from "node:assert/strict";
import { applyScope, fixturePayments, protectedPayments, scopeOptions, scopePayments } from "./model.ts";

const rows = fixturePayments("savings");
const snapshot = JSON.stringify(rows);
assert.equal(protectedPayments(rows).length, 3);
for (const [scope, expected] of [["one", 1], ["history", 24], ["history-future", 24]]) {
  const result = applyScope(rows, scope, "Savings");
  assert.equal(result.changed, expected);
  assert.equal(result.rows.filter(row => row.customCategory === "Savings" && rows.find(old => old.id === row.id).customCategory === null).length, expected);
  for (const row of rows.filter(row => row.customCategory !== null || row.user !== "preview-owner" || row.currency !== "GBP" || row.direction !== "debit" || row.payeeKey !== "saving-challenge" || row.pending)) {
    assert.deepEqual(result.rows.find(next => next.id === row.id), row, row.id);
  }
}
assert.equal(JSON.stringify(rows), snapshot, "planning and applying must not mutate their source snapshot");
assert.deepEqual(scopePayments(rows, "one").map(row => row.id), ["current"]);

const older = fixturePayments("older");
assert.equal(scopePayments(older, "history").length, 24);
assert.equal(scopePayments(older, "history-future").length, 26);
assert.ok(scopePayments(older, "history").every(row => row.date <= "2026-11-08"));
assert.deepEqual(scopePayments(older, "history-future").filter(row => row.date > "2026-11-08").map(row => row.id), ["later-1", "later-2"]);

const protectedRows = fixturePayments("protected");
assert.equal(protectedPayments(protectedRows).length, 26);
assert.equal(applyScope(protectedRows, "history-future", "Investment").changed, 1);
const unavailable = scopeOptions(rows, false);
assert.equal(unavailable[0].count, 1);
assert.ok(unavailable.slice(1).every(option => option.count === null && option.disabled));
assert.equal(scopeOptions(fixturePayments("empty"), true)[1].disabled, true);
console.log("G453 fixture scope counts and protected payments passed");
