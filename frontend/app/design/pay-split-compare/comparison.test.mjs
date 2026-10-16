import assert from "node:assert/strict";
import { compareShape, differenceLabel, guideFor, GUIDES, money, signedMoney } from "./comparison.ts";
import { SCENARIOS, scenarioFor } from "./fixtures.ts";

const guide = guideFor("50-30-20");
for (const fixture of SCENARIOS.filter(item => item.id !== "thin")) {
  for (const reference of GUIDES) {
    const result = compareShape(fixture.shape, reference);
    assert.equal(result.available, true);
    assert.equal(result.totalOut, fixture.shape.total_out);
    assert.equal(result.beyond, fixture.shape.beyond);
    for (const row of result.rows) {
      assert.ok(Math.abs(fixture.drivers[row.id].reduce((sum, driver) => sum + driver.amount, 0) - row.actual) < .005, `${fixture.id}/${row.id} illustrative evidence reconciles`);
      assert.equal(row.aboveCost, row.id !== "moved" && row.delta !== null && row.delta > 0);
    }
    if (reference.shares) {
      assert.equal(Math.round(result.rows.reduce((sum, row) => sum + row.guide, 0) * 100), Math.round(result.income * 100));
      assert.equal(Math.round(result.rows.reduce((sum, row) => sum + row.delta, 0) * 100), Math.round(result.netDifference * 100), "all differences reconcile to outgoings minus income");
    } else {
      assert.equal(result.netDifference, null);
      assert.equal(result.largestOver, null);
      for (const row of result.rows) {
        assert.equal(row.guide, null);
        assert.equal(row.delta, null);
        assert.equal(differenceLabel(row), "No fixed percentage");
      }
    }
  }
}

const beyond = compareShape(scenarioFor("beyond").shape, guide);
assert.equal(beyond.income, 4844);
assert.equal(beyond.totalOut, 5351);
assert.equal(beyond.beyond, 507);
assert.equal(beyond.netDifference, 507);
assert.deepEqual(beyond.rows.map(row => [row.id, row.actual, row.guide, row.delta]), [
  ["fixed", 2836, 2422, 414], ["moved", 963, 968.8, -5.8], ["free", 1552, 1453.2, 98.8],
]);
assert.equal(beyond.largestOver.id, "fixed");
assert.equal(Math.round(scenarioFor("beyond").shape.jobs.find(job => job.id === "fixed").share), 53);
assert.equal(Math.round(beyond.rows[0].incomeShare), 59, "income comparison is recalculated from exact amounts, never the outgoings percentage");
const nonsenseShares = structuredClone(scenarioFor("beyond").shape);
nonsenseShares.jobs.forEach(job => { job.share = 7; });
assert.deepEqual(compareShape(nonsenseShares, guide), beyond, "reference arithmetic never reads rounded displayed shares");
assert.equal(compareShape(scenarioFor("under").shape, guide).largestOver, null);
assert.equal(compareShape(scenarioFor("fixed").shape, guide).largestOver.id, "fixed");
assert.equal(compareShape(scenarioFor("free").shape, guide).largestOver.id, "free");
const moved = compareShape(scenarioFor("under").shape, guide).rows.find(row => row.id === "moved");
assert.ok(moved.delta > 0);
assert.equal(moved.aboveCost, false, "movement above a reference is not a cost warning");
assert.equal(differenceLabel(moved), "More moved than this reference");

for (const income of [0, -1, NaN, Infinity]) assert.equal(compareShape({ ...scenarioFor("beyond").shape, take_home: income }, guide).available, false);
assert.equal(compareShape(scenarioFor("thin").shape, guide).available, false);
assert.equal(compareShape({ ...scenarioFor("under").shape, jobs: [] }, guide).available, false);
assert.equal(compareShape({ ...scenarioFor("under").shape, total_out: 1 }, guide).available, false, "inconsistent totals do not produce an authoritative comparison");
const invalid = structuredClone(scenarioFor("under").shape);
invalid.jobs[0].amount = NaN;
assert.equal(compareShape(invalid, guide).available, false);
for (const income of [.01, 1.01, 4844.01, 99999999.99]) {
  const result = compareShape({ ...scenarioFor("under").shape, take_home: income }, guide);
  assert.equal(Math.round(result.rows.reduce((sum, row) => sum + row.guide, 0) * 100), Math.round(income * 100), "reference rounding neither loses nor invents pennies");
}
assert.equal(guideFor("bad-value").id, "50-30-20");
assert.equal(guideFor(null).id, "50-30-20");
assert.equal(money(1453.2), "£1,453.20");
assert.equal(signedMoney(-5.8), "−£5.80");
assert.equal(signedMoney(414), "+£414");
assert.equal(signedMoney(0), "£0");
assert.equal(signedMoney(-.001), "£0", "no negative zero");
assert.equal(signedMoney(-.005), "−£0.01", "negative half-pennies keep their sign and magnitude");
console.log("PASS G279: exact income-based reference math, original bar shares untouched, reconciled illustrative drivers/deltas, neutral movement, principle-only reference, thin/malformed cases and penny-safe rounding.");
