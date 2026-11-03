import assert from "node:assert/strict";
import { ACCOUNT_IDS, FIXTURES, PAYMENT_METHODS, dueLabel, money, ordinal, paymentLabel, statementDatesPresent } from "./fixtures.ts";

assert.deepEqual(ACCOUNT_IDS, ["corporate", "ba", "natwest", "current", "savings", "offline"]);
for (const id of ACCOUNT_IDS) {
  const item = FIXTURES[id];
  assert.equal(item.id, id);
  assert.ok(Number.isFinite(item.balance));
  assert.doesNotMatch(money(item.balance, true), /\d/);
  assert.equal(money(item.balance, true).startsWith("−"), item.balance < 0);
  if (item.kind === "card") {
    assert.equal(statementDatesPresent(item.settings), true);
    assert.ok(item.statement);
    assert.equal(Math.round((item.statement.amount + item.statement.nextSpending) * 100), Math.round(Math.abs(item.balance) * 100));
  } else {
    assert.equal(statementDatesPresent(item.settings), false);
    assert.equal(item.statement, undefined);
  }
}
assert.equal(money(-2280.33, false), "−£2,280.33");
assert.equal(money(76.93, false), "£76.93");
assert.equal(money(-2280.33, true), "−£••••");
assert.equal(money(0, true), "£••••");
for (const [day, expected] of [[1,"1st"], [2,"2nd"], [3,"3rd"], [11,"11th"], [12,"12th"], [13,"13th"], [21,"21st"], [28,"28th"], [31,"31st"]]) assert.equal(ordinal(day), expected);
assert.equal(dueLabel(FIXTURES.corporate.settings), "12th of the month");
assert.equal(dueLabel(FIXTURES.ba.settings), "15 days after closing");
assert.equal(dueLabel(FIXTURES.natwest.settings), "33 days after closing");
for (const closeDay of [null, 28]) {
  const incomplete = { ...FIXTURES.corporate.settings, closeDay, dueDay: null };
  assert.equal(statementDatesPresent(incomplete), false);
  assert.equal(dueLabel(incomplete), "Not set");
}
assert.equal(statementDatesPresent({ ...FIXTURES.ba.settings, dueOffset: null }), false);
assert.equal(FIXTURES.corporate.statement.dueBeforePayday, true);
assert.equal(FIXTURES.natwest.statement.dueBeforePayday, false);
assert.equal(FIXTURES.corporate.settings.source, "Barclays · Everyday account");
assert.equal(FIXTURES.corporate.apr, "Not applicable to this charge card");
assert.equal(FIXTURES.current.lockedReason, "Included while this account is short after plans.");
for (const item of PAYMENT_METHODS) assert.equal(paymentLabel({ ...FIXTURES.ba.settings, method: item.value }), item.label);
console.log("G412 design fixtures: six account examples, date/fallback cases, statements separate from new spending, business funding and signed masking passed");
