import assert from "node:assert/strict";
import { planningCheckpointFigures } from "../lib/planningCheckpointFigures.ts";

const view = {
  surplus_monthly: 620,
  surplus_ledger: { income: 2520, spending: 1500, debt_deduction: 400, surplus: 620 },
  buffer: { current: 900, target: 9000, target_months: 6 },
  debt: { total: 9000, expensive_total: 2400, all_promo: false },
  invest: { portfolio_value: 8000, has_investments: true },
};
const result = planningCheckpointFigures(view);
assert.equal(result.essentials.amount, 1020, "Essentials is before debt repayments, not the hero's £620");
assert.equal(result.starter_buffer.amount, 900, "Savings are not capped to a target or invented");
assert.equal(result.full_fund.amount, 4500, "Three-month checkpoint does not use the configurable six-month buffer target");
assert.equal(result.expensive_debt.amount, 2400, "Zero-percent debt is not relabelled interest-bearing");
assert.equal(result.isa_invest.amount, 8000);
const negative = planningCheckpointFigures({ ...view, surplus_ledger: { income: 1000, spending: 1200 } });
assert.equal(negative.essentials.amount, -200, "The presentation retains the sign");
assert.equal(negative.essentials.label, "Monthly gap");
const missing = planningCheckpointFigures({ ...view, surplus_ledger: undefined });
assert.equal(missing.essentials, undefined);
assert.equal(missing.starter_buffer, undefined);
assert.equal(missing.full_fund, undefined, "An old payload cannot invent a checkpoint target");
const noData = planningCheckpointFigures({ ...view, surplus_ledger: { income: 0, spending: 0 }, invest: { portfolio_value: 0, has_investments: false } });
assert.equal(noData.essentials, undefined);
assert.equal(noData.full_fund, undefined);
assert.equal(noData.isa_invest, undefined);
const nonFinite = planningCheckpointFigures({ ...view, surplus_ledger: { income: NaN, spending: Infinity }, buffer: { current: NaN }, debt: { expensive_total: NaN } });
assert.equal(nonFinite.essentials, undefined);
assert.equal(nonFinite.full_fund, undefined);
assert.equal(nonFinite.expensive_debt, undefined);
console.log("G187 checkpoint figures preserve the server's financial lenses");
