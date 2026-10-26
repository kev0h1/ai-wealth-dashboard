// Run from frontend with --experimental-loader ./scripts/_tsx-loader.mjs.
import assert from "node:assert/strict";
import { fixture, TIMELINE } from "./fixtures.ts";
import { accountListModel, accountReason } from "./model.ts";
import { spendFromIsCombined } from "../../../lib/spendFromAccount.ts";

for (const scenario of ["third", "timing"]) {
  const f = fixture(scenario);
  const balances = [246, 154, 136];
  const lows = [...balances];
  let pooledLow = balances.reduce((a, b) => a + b, 0);
  for (const event of [...TIMELINE, { account: 2, amount: scenario === "timing" ? -136 : -100 }]) {
    balances[event.account] += event.amount;
    lows[event.account] = Math.min(lows[event.account], balances[event.account]);
    pooledLow = Math.min(pooledLow, balances.reduce((a, b) => a + b, 0));
  }
  assert.equal(pooledLow - f.data.buffer, 236);
  assert.deepEqual(lows, scenario === "timing" ? [146, 54, 0] : [146, 54, 36]);
  assert.equal(lows.reduce((a, b) => a + b, 0), scenario === "timing" ? 200 : 236);
  assert.equal(f.data.spendable_now - f.data.bills_total + f.data.income_before_payday, balances.reduce((a, b) => a + b, 0));
  const a = accountListModel(f.accounts, f.eligibility, "a");
  const b = accountListModel(f.accounts, f.eligibility, "b");
  assert.deepEqual(a.visible.map(e => e.headroom), [146, 54]);
  assert.equal(a.hasOtherRoom, scenario === "third");
  assert.equal(b.visible.length, scenario === "third" ? 3 : 2);
  if (scenario === "timing") assert.equal(b.others.find(e => e.account.id === "barclays").reason, "Nothing spare at its lowest point before payday.");
}
const all = fixture("all");
assert.equal(accountListModel(all.accounts, all.eligibility, "a").others.length, 0);
const uncertain = fixture("uncertain");
assert.match(accountListModel(uncertain.accounts, uncertain.eligibility, "b").others[0].reason, /could not be checked/);
assert.equal(accountReason(undefined), "Account check not available.");
const capped = fixture("combined");
const model = accountListModel(capped.accounts, capped.eligibility, "a");
assert.equal(spendFromIsCombined([...model.visible, ...model.others.flatMap(e => e.limit ? [e.limit] : [])], capped.pool), true);
for (const entry of [...model.visible, ...model.others.flatMap(e => e.limit ? [e.limit] : [])]) assert.ok(entry.headroom <= capped.pool);
const excluded = fixture("third");
const prototype = excluded.accounts[0];
excluded.accounts.push(
  { ...prototype, id: "saving", subtype: "SAVINGS" },
  { ...prototype, id: "excluded", include_in_safe_to_spend: false },
  { ...prototype, id: "card", cover_source_eligible: false },
  { ...prototype, id: "fx", currency: "EUR" },
);
for (const id of ["saving", "excluded", "card", "fx"]) excluded.eligibility[id] = { short: false, headroom: 999, spend_from_headroom: 999 };
assert.equal(accountListModel(excluded.accounts, excluded.eligibility, "b").visible.length, 3);
delete excluded.eligibility.barclays;
assert.equal(accountListModel(excluded.accounts, excluded.eligibility, "b").others[0].reason, "Account check not available.");
const move = fixture("move");
assert.equal(accountListModel(move.accounts, move.eligibility, "b").visible[0].headroom, 126);
console.log("G325 fixture arithmetic, disclosure, filters, unknown checks, pool cap and reserved move passed.");

const current = fixture("current");
const balances = [208,174,70], lows = [...balances];
let low = balances.reduce((a,b) => a+b,0);
for (const event of [...TIMELINE, {account:2, amount:-70}]) {
  balances[event.account] += event.amount;
  lows[event.account] = Math.min(lows[event.account], balances[event.account]);
  low = Math.min(low, balances.reduce((a,b) => a+b,0));
}
assert.deepEqual(lows,[108,74,0]);
assert.equal(low-current.data.allocations_reserved-current.data.buffer,current.pool);
assert.equal(current.data.spendable_now-current.data.bills_total+current.data.income_before_payday,balances.reduce((a,b)=>a+b,0));
assert.deepEqual(accountListModel(current.accounts,current.eligibility,"a").visible.map(e=>e.accountId),["barclays","starling"]);
assert.equal(current.data.pace.sustainable*current.data.pace.days_left,current.pool);
assert.equal(current.data.card_new_spend_total,2141);
console.log("G325 current-card walk, eligible rows, pace and independent card activity reconcile.");
