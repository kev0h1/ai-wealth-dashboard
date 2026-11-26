// Cross-story financial truth, checked against the production presentation helpers.
import assert from "node:assert/strict";
import { C22_ACCOUNT_ELIGIBILITY, C22_ASIDE, C22_COVER, C22_CURRENT_ACCOUNTS, C22_PLANS, C22_PURPOSE_PROPOSAL, C22_SAFE_TO_SPEND, C22_SPEND, C22_SPEND_FROM, C22_UPCOMING, C22_UPCOMING_ACCOUNTS } from "../../frontend/app/design/marketing-phones/fixtures.ts";
import { buildLeftToSpendEvidence } from "../../frontend/lib/leftToSpendEvidence.ts";
import { accountActionReading } from "../../frontend/lib/upcomingAccountPresentation.ts";
import { C22_CLOSED_SHAPE } from "../../frontend/app/design/marketing-phones/shape-fixture.ts";
import { PACK_STORY_IDS, EXTRA_STORY_IDS, STORY_IDS, SCENARIO } from "../../frontend/app/design/marketing-phones/catalog.ts";
import { compareShape, guideFor } from "../../frontend/lib/paySplitReference.ts";

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
assert.equal(C22_CURRENT_ACCOUNTS.find(account => account.id === "c22-everyday").name, "Monzo current account");
assert.ok(prospective.proposal.after.includes("Monzo current account"));

assert.equal(PACK_STORY_IDS.length, 8);
assert.deepEqual(EXTRA_STORY_IDS, ["split"]);
assert.deepEqual(STORY_IDS, [...PACK_STORY_IDS, ...EXTRA_STORY_IDS]);
const shape = C22_CLOSED_SHAPE;
assert.deepEqual(shape.period, { start: "2026-09-30", end: "2026-10-29", label: "30 Sep to 29 Oct" });
assert.ok(shape.period.end < SCENARIO.periodStart && shape.period.end < SCENARIO.asOf);
assert.equal(shape.take_home, 1800);
assert.equal(sum(shape.jobs.filter(job => job.id !== "left").map(job => job.amount)), shape.total_out);
assert.equal(shape.take_home - shape.total_out, shape.jobs.find(job => job.id === "left").amount);
assert.ok(shape.jobs.every(job => sum(job.drivers.map(driver => driver.amount)) === job.amount));
assert.equal(sum(shape.jobs.map(job => job.share)), 100);
assert.deepEqual(shape.periods.map(period => [period.start, period.end]), [[shape.period.start, shape.period.end]]);
assert.deepEqual(shape.averages, []);
assert.equal(shape.trend_line, null);
const comparison = compareShape(shape, guideFor("50-30-20"));
assert.equal(comparison.available, true);
assert.equal(comparison.left, 150);
assert.equal(comparison.beyond, 0);
assert.deepEqual(comparison.rows.map(row => [row.id, row.actual, row.guide, row.delta]), [["fixed", 900, 900, 0], ["moved", 300, 360, -60], ["free", 450, 540, -90]]);
console.log("C22 fixture: current accounts, global buffer, payment/account views, cover, future one-off and completed-period 50/30/20 reconcile.");
