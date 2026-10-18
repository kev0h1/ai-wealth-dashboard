import assert from "node:assert/strict";
import { fullRange, periodDays, SCENARIOS, shortRange, verdictFor, yearContext } from "./fixtures.ts";

assert.equal(shortRange(SCENARIOS.monthly.periods[0]), "25 Sep to 29 Oct");
assert.equal(fullRange(SCENARIOS.monthly.periods[0]), "25 September 2026 to 29 October 2026");
assert.equal(yearContext(SCENARIOS.monthly.periods[0]), null);
assert.equal(yearContext(SCENARIOS.year.periods[0]), "2026 to 2027");
for (const scenario of Object.values(SCENARIOS)) {
  for (const [index, period] of scenario.periods.entries()) {
    const verdict = verdictFor(period, index);
    assert.equal(verdict.period.days_elapsed + verdict.period.days_left, periodDays(period));
    assert.equal(verdict.period.closed, index > 0);
    assert.equal(verdict.majority.reduce((sum, item) => sum + item.spent, 0), verdict.pills.spent);
    assert.equal(verdict.pills.net, verdict.pills.income - verdict.pills.spent);
    assert.equal(verdict.moved_total, verdict.moved.reduce((sum, item) => sum + item.amount, 0));
    assert.ok(!shortRange(period).includes("…"));
    assert.ok(!shortRange(period).includes("—"));
  }
}
assert.equal(periodDays(SCENARIOS.monthly.periods[0]), 35);
assert.equal(periodDays(SCENARIOS.year.periods[0]), 35);
assert.equal(periodDays(SCENARIOS.weekly.periods[0]), 7);
console.log("G285 fixtures: full range, September, year boundary, exact period lengths and unchanged hero reconciliation pass.");
