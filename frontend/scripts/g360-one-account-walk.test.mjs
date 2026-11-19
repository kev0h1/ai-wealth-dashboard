import assert from "node:assert/strict";
import { reconcileWithServerPosition, upcomingAccountWindow, buildUpcomingAccountSummaries } from "../lib/upcomingAccounts.ts";

// G360: the period always ends the day before payday, whatever the day count.
const end = Date.parse("2026-10-29");
for (const days of [undefined, 0, 1, 2, 15]) {
  assert.equal(upcomingAccountWindow(end, Date.parse("2026-10-29T10:00Z"), days), Date.parse("2026-10-30") - 1, `window for days=${days}`);
}

const bill = (o = {}) => ({ name: "Novuna", amount: 139.37, account_id: "h", account_bank: "HSBC", account_name: "Advance", account_balance: 150.76, expected_date: "2026-10-29", days_away: 0, kind: "commitment", ...o });
const summary = (bills, income = [], inflows = []) => buildUpcomingAccountSummaries({ upcoming_bills: bills, upcoming_income: income, internal_inflows: inflows }, end + 86400000 - 1);
const pos = (o = {}) => ({ afterPayments: 11.39, lowPoint: 11.39, plansReserved: 0, afterPaymentsAndPlans: 11.39, lowPointAndPlans: 11.39, spendFrom: null, uncertain: false, ...o });

// Verdict: server covered wins over a client walk that read short.
const shortWalk = summary([bill({ account_balance: 100 })])[0];
assert.equal(shortWalk.status, "short");
let r = reconcileWithServerPosition(shortWalk, pos());
assert.equal(r.status, "covered");
assert.equal(r.shortfall, 0);
assert.ok(r.position);

// Verdict: server short wins over a client walk that read covered; shortfall is the more negative server figure.
const coveredWalk = summary([bill()])[0];
assert.equal(coveredWalk.status, "covered");
r = reconcileWithServerPosition(coveredWalk, pos({ afterPayments: 344.09, lowPoint: -20 }));
assert.equal(r.status, "short");
assert.equal(r.shortfall, 20);
r = reconcileWithServerPosition(coveredWalk, pos({ afterPayments: -5, lowPoint: 3 }));
assert.equal(r.status, "short");
assert.equal(r.shortfall, 5);

// Server short with the client also short keeps the walk's named shortfall.
r = reconcileWithServerPosition(shortWalk, pos({ afterPayments: -39.37, lowPoint: -39.37 }));
assert.equal(r.status, "short");
assert.equal(r.shortFor?.label, shortWalk.shortFor?.label);

// Uncertain or absent position leaves the walk verdict alone.
assert.equal(reconcileWithServerPosition(shortWalk, undefined).status, "short");
assert.equal(reconcileWithServerPosition(shortWalk, pos({ uncertain: true })).status, "short");

// G479 (Kevin 2026-11-19, option 1): there is no inbound gate. A predicted own transfer counts on BOTH legs
// whether or not its source can fund it (this replaces the G360 funded-inflow rule, mirroring the backend).
const inflow = (o = {}) => ({ name: "Standing order", amount: 1886, account_id: "h", source_account_id: "b", expected_date: "2026-10-29", days_away: 0, ...o });
const move = (o = {}) => bill({ name: "To HSBC", amount: 1886, account_id: "b", account_bank: "Barclays", account_balance: 5000, kind: "movement", ...o });
const salary = (o = {}) => ({ name: "Pay", amount: 4800, account_id: "b", expected_date: "2026-10-29", days_away: 0, credit_basis: "steady", ...o });
const hsbc = (bills, income, inflows) => summary(bills, income, inflows).find((a) => a.id === "h");
const barclays = (bills, income, inflows) => summary(bills, income, inflows).find((a) => a.id === "b");
assert.equal(hsbc([bill(), move()], [], [inflow()]).closing, 1897.39, "covered source: the destination is credited");
assert.equal(hsbc([bill(), move({ account_balance: 0 })], [], [inflow()]).closing, 1897.39, "empty source: the destination is still credited, never flagged short for a transfer due to arrive");
assert.equal(barclays([bill(), move({ account_balance: 0 })], [], [inflow()]).closing, -1886, "the empty SOURCE carries the shortfall");
assert.equal(barclays([bill(), move({ account_balance: 0 })], [], [inflow()]).status, "short");
assert.equal(hsbc([bill(), move({ account_balance: 0 })], [salary({ credit_basis: null })], [inflow()]).closing, 1897.39, "uncredited income changes nothing for the destination");
assert.equal(hsbc([bill()], [], [inflow({ source_account_id: null })]).closing, 1897.39, "a transfer with an unknown source is still credited");
console.log("g360-one-account-walk ok");
