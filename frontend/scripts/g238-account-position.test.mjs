import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { accountPlan, assessPlanOverlap, plansFromApi } from "../lib/upcomingPlans.ts";
import { positionsFromToday } from "../lib/upcomingAccounts.ts";

// One fixture, shared with backend/tests/test_account_position.py, so the
// server arithmetic and the sheet's client fallback cannot drift.
const fixture = JSON.parse(readFileSync(new URL("../../backend/tests/fixtures/g238_account_position.json", import.meta.url), "utf8"));
const end = Date.parse("2026-10-29T23:59:59Z");
const pence = (pounds) => (pounds === null ? null : Math.round(pounds * 100));
const summary = (id, closing, extra = {}) => ({ id, bank: id, name: id, opening: null, income: 0, transfersIn: 0, outgoing: 0, closing, shortfall: 0, status: "covered", firstShortDate: null, hasUnassignedIncome: false, events: [], ...extra });

for (const c of fixture.cases) {
  const bills = c.movements.map((m) => ({ name: "Move", expected_date: "2026-10-16", days_away: 8, is_credit_card: false, observed_pending: false, ...m, kind: "movement" }));
  const creditAccounts = (c.credit_account_ids ?? []).map((id) => ({ id, type: "credit", subtype: "credit_card" }));
  const plans = assessPlanOverlap(plansFromApi(c.plans), { upcoming_bills: bills }, end, creditAccounts);
  for (const [id, want] of Object.entries(c.expected)) {
    // Client fallback (old API): same answer as the server for the same fixture.
    const fallback = accountPlan(summary(id, c.closing[id], { opening: c.low_point[id] }), plans);
    assert.equal(fallback.uncertain, want.uncertain, `${c.name}: fallback uncertain`);
    assert.equal(fallback.afterPlans, pence(want.after_payments_and_plans), `${c.name}: fallback afterPlans`);
    const wantPre = want.uncertain ? null : pence(Math.min(want.after_payments_and_plans, want.low_point_and_plans));
    assert.equal(fallback.spendFromPence, wantPre, `${c.name}: fallback Spend from (pre pool cap)`);
    assert.equal(fallback.reservedPence, pence(want.plans_reserved) , `${c.name}: fallback reserved`);

    // Server field present: the sheet shows it and ignores contradictory client inputs.
    const position = positionsFromToday({ [id]: { short: false, headroom: 0, after_payments: want.after_payments, plans_reserved: want.plans_reserved, after_payments_and_plans: want.after_payments_and_plans, uncertain: want.uncertain, estimated: want.estimated, low_point: want.low_point, low_point_and_plans: want.low_point_and_plans, spend_from_headroom: want.spend_from } }, [{ id, type: "bank", subtype: "TRANSACTION" }])[id];
    const server = accountPlan({ ...summary(id, 999999), position }, []);
    assert.equal(server.afterPlans, pence(want.after_payments_and_plans), `${c.name}: server afterPlans wins`);
    assert.equal(server.afterPayments, pence(want.after_payments), `${c.name}: server afterPayments wins`);
    assert.equal(server.uncertain, want.uncertain, `${c.name}: server uncertain wins`);
    assert.equal(server.spendFromPence, want.uncertain ? null : pence(want.spend_from), `${c.name}: server Spend from wins`);
  }
}

// Kevin's case: the sheet shows 6104 pence.
const kevin = fixture.cases.find((c) => c.name === "kevin_barclays_japan");
const kPos = positionsFromToday({ barclays: { short: false, headroom: 0, ...kevin.expected.barclays } }, [{ id: "barclays", type: "bank", subtype: "TRANSACTION" }]).barclays;
assert.equal(accountPlan({ ...summary("barclays", 141.04), position: kPos }, []).afterPlans, 6104);
// Contradictory client plans (a 500 pound goal) do not change the server figure.
const contradictory = plansFromApi([{ ...kevin.plans[0], remaining: 500, period_amount: 500 }]);
assert.equal(accountPlan({ ...summary("barclays", 141.04), position: kPos }, contradictory).afterPlans, 6104);
assert.equal(accountPlan({ ...summary("barclays", 141.04), position: kPos }, contradictory).reservedPence, 8000);
// Dip case: the clamp holds Spend from at the low point (50), not the closing balance (1050).
const dip = fixture.cases.find((c) => c.name.startsWith("dip_lower"));
assert.equal(dip.expected.acc.spend_from, 50);
// Savings pots and ISAs get no Spend from (same sourceClass as Home, G111); unknown accounts neither.
const savingsEntry = { short: false, headroom: 0, ...kevin.expected.barclays };
for (const [label, account] of [["savings", { id: "pot", type: "savings", subtype: "SAVINGS" }], ["isa", { id: "pot", type: "bank", subtype: "CASH_ISA" }]]) {
  const pos = positionsFromToday({ pot: savingsEntry }, [account]).pot;
  assert.equal(pos.spendFrom, null, `${label}: no Spend from`);
  assert.equal(accountPlan({ ...summary("pot", 141.04), position: pos }, []).spendFromPence, null);
  assert.equal(pos.afterPaymentsAndPlans, 61.04, `${label}: the position itself is still shared`);
}
assert.equal(positionsFromToday({ pot: savingsEntry }, []).pot.spendFrom, null, "unknown account: not shown");
// An old API (no position fields) is skipped, not blanked.
assert.deepEqual(positionsFromToday({ barclays: { short: false, headroom: 10 } }, []), {});
console.log("g238-account-position ok");
