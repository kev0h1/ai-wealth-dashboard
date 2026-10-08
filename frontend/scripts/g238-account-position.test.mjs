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
  const plans = assessPlanOverlap(plansFromApi(c.plans), { upcoming_bills: bills }, end);
  for (const [id, want] of Object.entries(c.expected)) {
    // Client fallback (old API): same answer as the server for the same fixture.
    const fallback = accountPlan(summary(id, c.closing[id]), plans);
    assert.equal(fallback.uncertain, want.uncertain, `${c.name}: fallback uncertain`);
    assert.equal(fallback.afterPlans, pence(want.after_payments_and_plans), `${c.name}: fallback afterPlans`);
    assert.equal(fallback.reservedPence, pence(want.plans_reserved) , `${c.name}: fallback reserved`);

    // Server field present: the sheet shows it and ignores contradictory client inputs.
    const position = positionsFromToday({ [id]: { short: false, headroom: 0, after_payments: want.after_payments, plans_reserved: want.plans_reserved, after_payments_and_plans: want.after_payments_and_plans, uncertain: want.uncertain, estimated: want.estimated } })[id];
    const server = accountPlan({ ...summary(id, 999999), position }, []);
    assert.equal(server.afterPlans, pence(want.after_payments_and_plans), `${c.name}: server afterPlans wins`);
    assert.equal(server.afterPayments, pence(want.after_payments), `${c.name}: server afterPayments wins`);
    assert.equal(server.uncertain, want.uncertain, `${c.name}: server uncertain wins`);
  }
}

// Kevin's case: the sheet shows 6104 pence.
const kevin = fixture.cases.find((c) => c.name === "kevin_barclays_japan");
const kPos = positionsFromToday({ barclays: { short: false, headroom: 0, ...kevin.expected.barclays } }).barclays;
assert.equal(accountPlan({ ...summary("barclays", 141.04), position: kPos }, []).afterPlans, 6104);
// Contradictory client plans (a 500 pound goal) do not change the server figure.
const contradictory = plansFromApi([{ ...kevin.plans[0], remaining: 500, period_amount: 500 }]);
assert.equal(accountPlan({ ...summary("barclays", 141.04), position: kPos }, contradictory).afterPlans, 6104);
assert.equal(accountPlan({ ...summary("barclays", 141.04), position: kPos }, contradictory).reservedPence, 8000);
// An old API (no position fields) is skipped, not blanked.
assert.deepEqual(positionsFromToday({ barclays: { short: false, headroom: 10 } }), {});
console.log("g238-account-position ok");
