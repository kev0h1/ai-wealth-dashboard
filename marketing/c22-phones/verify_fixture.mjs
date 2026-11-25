// Cross-story financial truth, checked against the production presentation helpers.
import assert from "node:assert/strict";
import { C22_ACCOUNT_ELIGIBILITY, C22_ASIDE, C22_COVER, C22_CURRENT_ACCOUNTS, C22_PLANS, C22_PURPOSE_PROPOSAL, C22_SAFE_TO_SPEND, C22_SPEND, C22_SPEND_FROM, C22_UPCOMING, C22_UPCOMING_ACCOUNTS } from "../../frontend/app/design/marketing-phones/fixtures.ts";
import { buildLeftToSpendEvidence } from "../../frontend/lib/leftToSpendEvidence.ts";
import { accountActionReading } from "../../frontend/lib/upcomingAccountPresentation.ts";

const sum = values => values.reduce((total, value) => total + value, 0);
const pennies = value => Math.round(value * 100);
const cash = sum(C22_CURRENT_ACCOUNTS.map(account => account.balance));
const due = sum(C22_UPCOMING.map(row => row.amount));
assert.equal(cash, 773);
assert.equal(due, 321);
assert.equal(cash - due, C22_SAFE_TO_SPEND.lowest_projected_balance);
assert.equal(C22_ASIDE.amountPerPeriod - C22_ASIDE.filledThisPeriod, 30);
assert.equal(cash - due - C22_ASIDE.remaining - C22_SAFE_TO_SPEND.buffer, C22_SAFE_TO_SPEND.safe_to_spend);
assert.equal(C22_SPEND_FROM.kind, "account");
assert.deepEqual(C22_SPEND_FROM.entries.map(entry => entry.headroom), [272, 150]);
// Available belongs to each account. A global buffer is never secretly split.
assert.equal(sum(C22_SPEND_FROM.entries.map(entry => entry.headroom)) - C22_SAFE_TO_SPEND.buffer, 312);
const evidence = buildLeftToSpendEvidence(C22_SAFE_TO_SPEND, 312);
assert.deepEqual(evidence.rows.map(row => row.value), [452, -110, -30, 312]);

for (const account of C22_UPCOMING_ACCOUNTS) {
  const position = C22_ACCOUNT_ELIGIBILITY[account.id];
  const reading = accountActionReading(account, C22_PLANS, "ready");
  assert.equal(reading.available, pennies(position.spend_from_headroom));
  assert.equal(account.opening - account.outgoing, account.closing);
  assert.equal(sum(account.events.map(event => -event.amount)), account.outgoing);
  assert.equal(account.position.availability.working.basis - account.position.availability.working.plans
    + sum(account.position.availability.working.movesIn.map(move => move.amount))
    - sum(account.position.availability.working.movesOut.map(move => move.amount)), position.spend_from_headroom);
}
const byAccountEvents = C22_UPCOMING_ACCOUNTS.flatMap(account => account.events);
assert.deepEqual(byAccountEvents.map(event => event.id).sort(), C22_UPCOMING.map(row => row.rowKey).sort());
assert.equal(sum(byAccountEvents.map(event => -event.amount)), due);
assert.equal(sum(C22_UPCOMING_ACCOUNTS.flatMap(account => account.suggestedMoves).map(move => move.amount)), 0);
assert.equal(C22_COVER.move_map.to.balance + C22_COVER.amount - 188, 0);
assert.equal(C22_COVER.move_map.from.balance - 133 - 30 - C22_COVER.amount, 272);
assert.equal(15 + C22_SPEND.pills.income - C22_SPEND.pills.spent - C22_SPEND.moved_total, C22_COVER.move_map.from.balance);

const prospective = C22_PURPOSE_PROPOSAL;
assert.equal(prospective.status, "pending");
assert.equal(prospective.proposal.kind, "add_planned");
assert.deepEqual(prospective.proposal.params, { name: "Car service", amount: 120, date: "2026-12-12", account_id: "c22-everyday" });
assert.ok(prospective.proposal.params.date > C22_SPEND.period.end);
assert.ok(!C22_UPCOMING.some(row => row.name === prospective.proposal.params.name));
console.log("C22 fixture: account Available, global buffer, payment/account views, cover and unsaved future one-off reconcile.");
