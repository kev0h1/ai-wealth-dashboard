import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { buildUpcomingAccountSummaries, upcomingAccountWindow } from "../lib/upcomingAccounts.ts";
import { upcomingDisplayName } from "../lib/upcomingDisplayName.ts";
import UpcomingAccountsCard from "../components/upcoming/UpcomingAccountsCard.tsx";
import UpcomingAccountDetails from "../components/upcoming/UpcomingAccountDetails.tsx";
import UpcomingHeroCard from "../components/upcoming/UpcomingHeroCard.tsx";
import { buildForecast, accountSummariesForForecast, SCENARIOS } from "../app/design/g176-upcoming-rows/fixtures.ts";

const bill = (overrides = {}) => ({ name: "Bill", amount: 80, account_id: "a", account_bank: "Barclays", account_name: "Household account", account_balance: 100, expected_date: "2026-10-02", days_away: 1, kind: "commitment", ...overrides });
const credit = (overrides = {}) => ({ name: "payer::opaque", display_name: "Example employer", amount: 100, account_id: "a", expected_date: "2026-10-02", days_away: 1, ...overrides });
const summary = (bills, income = [], inflows = [], cutoff = Date.parse("2026-10-29")) => buildUpcomingAccountSummaries({ upcoming_bills: bills, upcoming_income: income, internal_inflows: inflows }, cutoff);
let accounts = summary([bill(), bill({ account_id: "b", account_balance: 20 })]);
assert.deepEqual(accounts.map(({ status, closing, shortfall }) => ({ status, closing, shortfall })), [
  { status: "covered", closing: 20, shortfall: 0 }, { status: "short", closing: -60, shortfall: 60 },
]);
accounts = summary([bill({ amount: 200 })], [credit()]);
assert.equal(accounts[0].closing, 0, "Same-day named income funds the payment first");
assert.equal(accounts[0].status, "covered");
assert.equal(accounts[0].events[0].name, "Example employer");
assert.equal(summary([bill()], [], [credit({ source_account_name: "Everyday account" })])[0].closing, 120);
assert.equal(summary([bill({ account_balance: 20 })], [credit({ account_id: "b" })])[0].shortfall, 60, "Other-account income never funds this payment");
const lateIncome = credit({ expected_date: "2026-10-04", amount: 200 });
accounts = summary([bill({ amount: 130 }), bill({ amount: 50, expected_date: "2026-10-03" })], [lateIncome]);
assert.deepEqual([accounts[0].closing, accounts[0].shortfall, accounts[0].firstShortDate], [120, 80, "2026-10-02"], "Peak funding need and first gap are distinct evidence");
const detail = renderToStaticMarkup(React.createElement(UpcomingAccountDetails, { account: accounts[0], periodLabel: "Payments through Thu 29 Oct" }));
assert.match(detail, /Up to .*£80.*is needed to cover these payments/);
assert.match(detail, /first shortfall is on .*2 Oct/);
assert.doesNotMatch(detail, /short by.*on.*2 Oct/, "Never attribute the later maximum amount to the first gap date");
assert.equal(summary([bill({ account_balance: -10 })])[0].shortfall, 90, "Overdrawn opening cash is not omitted");
assert.equal(summary([bill({ amount: 0.2, account_balance: 0.3 })])[0].closing, 0.1, "Penny arithmetic");
assert.equal(summary([bill({ amount: 0.31, account_balance: 0.3 })])[0].shortfall, 0.01);
assert.equal(summary([bill({ amount: 180, kind: "movement" })])[0].status, "unfunded", "Optional moves never get genuine-risk red");
accounts = summary([bill({ amount: 150, kind: "movement" }), bill({ amount: 80, expected_date: "2026-10-03" })]);
assert.equal(accounts[0].shortfall, 130);
assert.equal(accounts[0].firstShortDate, "2026-10-03", "Bill risk date is not the earlier optional move");
for (const overrides of [{ account_balance: null }, { account_id: null }, { account_balance: NaN }]) {
  const account = summary([bill(overrides)])[0];
  assert.equal(account.status, "unknown"); assert.equal(account.closing, null);
}
assert.equal(summary([bill(), bill({ account_balance: 101 })])[0].status, "unknown", "Conflicting balances cannot prove coverage");
accounts = summary([bill(), bill({ account_id: "b", account_balance: 20 })], [credit({ account_id: null })]);
assert.equal(accounts[0].status, "covered", "Unassigned income cannot erase independently covered cash");
assert.equal(accounts[0].closing, 20, "Unassigned income is never duplicated across accounts");
assert.equal(accounts[1].status, "unknown", "Unassigned income leaves a possible deficit unverified");
for (const overrides of [{ is_credit_card: true }, { observed_pending: true }, { expected_date: "2026-10-30" }]) assert.equal(summary([bill(overrides)]).length, 0);
const end = Date.parse("2026-10-29");
assert.equal(upcomingAccountWindow(end, Date.parse("2026-10-28T23:50Z")), Date.parse("2026-10-30") - 1, "Two calendar days away must not start final-day lookahead");
assert.equal(upcomingAccountWindow(end, Date.parse("2026-10-29T10:00Z")), Date.parse("2026-11-04"));
assert.equal(summary([bill({ expected_date: "2026-10-30" })], [], [], upcomingAccountWindow(end, Date.parse("2026-10-28"))).length, 0, "Payday is outside the current period");

for (const scenario of SCENARIOS) {
  const forecast = buildForecast(scenario.id);
  const result = accountSummariesForForecast(forecast);
  assert.equal(result.reduce((sum, account) => sum + account.closing, 0), forecast.closing / 100);
  assert.equal(result.reduce((sum, account) => sum + account.shortfall, 0), forecast.shortfall / 100);
  const card = renderToStaticMarkup(React.createElement(UpcomingAccountsCard, { accounts: result, periodLabel: "Payments through Wed 30 Sept", onOpen() {} }));
  assert.match(card, /By account/); assert.match(card, /Open Barclays/); assert.match(card, /Tap an account for its working/);
  if (scenario.id === "moves") { assert.match(card, /unfunded/); assert.doesNotMatch(card, /bg-rose/); }
  if (scenario.id === "covered") assert.doesNotMatch(card, /bg-rose|bg-amber/);
}
const empty = renderToStaticMarkup(React.createElement(UpcomingAccountsCard, { accounts: [], periodLabel: "This period", onOpen() {} }));
assert.match(empty, /No account payments/); assert.doesNotMatch(empty, /<button/);
const unknown = renderToStaticMarkup(React.createElement(UpcomingAccountsCard, { accounts: summary([bill({ account_balance: null })]), periodLabel: "This period", onOpen() {} }));
assert.match(unknown, /Coverage unavailable/); assert.doesNotMatch(unknown, /£0/);

const opaque = { name: "goldman|sachs::opaque-account", display_name: "Goldman Sachs" };
assert.equal(upcomingDisplayName(opaque), "Goldman Sachs");
assert.equal(opaque.name, "goldman|sachs::opaque-account", "Presentation never mutates API identity");
assert.equal(upcomingDisplayName({ name: opaque.name }), "Expected income");
assert.equal(upcomingDisplayName({ name: "Council Tax" }), "Council Tax");
const hero = renderToStaticMarkup(React.createElement(UpcomingHeroCard, {
  isCalendarMonth: false, daysToPayday: 2, paydayLabel: "Fri 30 Oct", spendableNow: 1230,
  runwayIncomeTotal: 15, runwayBillsTotal: 1045, allocationsRemainingTotal: 100,
  savingsNow: 300, runway: 100, runwayStatus: "left",
}));
for (const label of ["Full calculation", "Available now", "Income before payday", "Bills before payday", "Still to set aside", "Projected balance", "Savings backup"]) assert.match(hero, new RegExp(label));
assert.match(hero, /Payments can take a day or two to appear, so a very recent one may not be counted yet\./);
assert.doesNotMatch(hero, /account short|accounts short|Barclays|HSBC|Review/);
console.log("G176 account summaries, shared views, income labels and hero invariants passed");
