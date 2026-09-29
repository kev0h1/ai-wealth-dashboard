import assert from "node:assert/strict";
import { buildForecast, money } from "../app/design/g176-upcoming-rows/fixtures.ts";

const mixed = buildForecast("mixed");
assert.equal(mixed.cash, 123000);
assert.equal(mixed.outgoing, 104500);
assert.equal(mixed.closing, 18500);
assert.equal(mixed.shortfall, 20000, "Positive pooled cash must not hide account shortfalls");
assert.equal(mixed.shortAccounts, 2);
assert.deepEqual(mixed.accounts.map((item) => item.closing), [-8000, 38500, -12000]);
assert.deepEqual(mixed.accounts[0].payments.map((item) => item.shortfall), [0, 0, 8000], "Earlier Barclays payments are covered before the energy bill runs short");
assert.equal(buildForecast("short").shortfall, 26500);
assert.equal(buildForecast("short").shortAccounts, 3);
assert.equal(buildForecast("covered").shortfall, 0);
assert.equal(buildForecast("covered").payments.every((item) => item.shortfall === 0), true);
assert.equal(buildForecast("moves").payments.every((item) => item.model.flagged === false && item.model.coverage.optionalMove), true, "Optional own moves never inherit bill-risk flags");
assert.equal(buildForecast("moves", new Set(["mortgage"])).shortfall, 8000, "Dismissing a move recomputes its source account and total");
assert.equal(money(-8000), "−£80", "Negative account forecast keeps its minus sign");

// Every possible combination of locally dismissed fixtures must continue to
// reconcile. The individual row status follows that account, never the pool.
const ids = mixed.payments.map((item) => item.id);
for (const scenario of ["mixed", "short", "covered", "moves"]) {
  for (let mask = 0; mask < 2 ** ids.length; mask++) {
    const dismissed = new Set(ids.filter((_, index) => mask & (1 << index)));
    const forecast = buildForecast(scenario, dismissed);
    assert.equal(forecast.closing, forecast.cash - forecast.outgoing);
    assert.equal(forecast.payments.length, ids.length - dismissed.size);
    for (const account of forecast.accounts) {
      let cash = account.opening;
      for (const payment of account.payments) {
        assert.equal(payment.before, cash);
        cash -= payment.pence;
        assert.equal(payment.after, cash);
        assert.equal(payment.shortfall, Math.max(0, -cash));
        assert.equal(payment.model.coverage.shortfall, payment.shortfall / 100);
      }
      assert.equal(account.closing, cash);
      assert.equal(account.shortfall, Math.max(0, -cash));
    }
    assert.equal(forecast.shortfall, forecast.accounts.reduce((sum, account) => sum + Math.max(0, -account.closing), 0));
  }
}
console.log("G176 preview: four scenarios and all 256 dismissal combinations reconcile.");
