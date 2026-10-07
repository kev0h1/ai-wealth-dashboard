import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Landmark } from "lucide-react";
import { buildUpcomingAccountSummaries, upcomingAccountWindow } from "../lib/upcomingAccounts.ts";
import { compareUpcomingEvents, upcomingAccountAssessment, walkUpcomingAccounts } from "../lib/upcomingAccountWalk.ts";
import { getUpcomingStatus } from "../lib/upcomingAttention.ts";
import { upcomingDisplayName } from "../lib/upcomingDisplayName.ts";
import UpcomingAttentionDay from "../components/upcoming/UpcomingAttentionDay.tsx";
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
assert.match(detail, /£80.*needed for payments/);
assert.match(detail, /First shortfall .*2 Oct/);
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

// Rejection regression: the actual row adapter and card must reconcile on
// the SAME payload, not separate hand-authored coverage in each component.
function assertAgreement(bills, income = [], inflows = [], cutoff = Date.parse("2026-10-29")) {
  const walk = walkUpcomingAccounts({ upcoming_bills: bills, upcoming_income: income, internal_inflows: inflows }, cutoff);
  const models = bills.map((item, index) => ({
    rowKey: `payment-${index}`, identity: `payment-${index}`, type: "bill",
    name: item.name, amount: item.amount, expectedDate: item.expected_date,
    accountLabel: item.account_name, isMovement: item.kind === "movement",
    pending: item.pending, daysPastDue: item.days_past_due, category: item.category,
    // Pooled risk is deliberately contradictory; it cannot replace named
    // account evidence, or make an unknown balance red/covered by accident.
    flagged: true, accountShort: true, atRisk: true, unfundedMovement: true,
    after: { kind: "balance", value: -9999 }, categoryColour: "#64748b", CategoryIcon: Landmark,
    ...upcomingAccountAssessment(item, walk),
  }));
  const statuses = models.map(getUpcomingStatus);
  for (const account of walk.accounts) {
    const indices = bills.flatMap((item, index) =>
      (item.account_id || "__unknown__") === account.id && Date.parse(item.expected_date) <= cutoff && !item.is_credit_card && !item.observed_pending ? [index] : []);
    const rows = indices.map((index) => models[index]);
    const risk = rows.filter((row) => !row.isMovement && (row.coverage?.shortfall ?? 0) > 0);
    if (account.status === "covered") {
      assert.ok(rows.every((row) => row.coverage?.shortfall === 0), "Covered account has only funded cash payments");
    } else if (account.status === "short") {
      assert.equal(Math.max(...risk.map((row) => row.coverage.shortfall)), account.shortfall, "Card bill-risk amount equals peak row deficit");
      assert.ok(risk.every((row) => getUpcomingStatus(row).tone === "risk"));
    } else if (account.status === "unfunded") {
      assert.equal(risk.length, 0, "Optional-move-only gaps are never bill risk");
      assert.equal(Math.max(...rows.map((row) => row.coverage.shortfall)), account.shortfall);
    } else {
      assert.ok(rows.some((row) => row.assessment === "unverified"), "Unknown account has unverified evidence, never invented funding");
      assert.equal(risk.length, 0);
    }
    indices.forEach((index, accountIndex) => {
      const row = models[index];
      const event = account.events.find((event) => event.id === `payment-${accountIndex}`);
      assert.ok(event);
      if (row.coverage) assert.equal(row.coverage.after, event.after, "Per-occurrence card working and row working are identical");
    });
    if (account.closing !== null) {
      assert.equal(Math.round((account.opening + account.income + account.transfersIn - account.outgoing) * 100), Math.round(account.closing * 100));
    }
  }
  return { walk, models, statuses };
}

let paired = assertAgreement([bill(), bill({ account_id: "b", account_balance: 20 })]);
assert.deepEqual(paired.statuses.map((status) => status.label), ["Covered", "short"]);
const mixedCard = renderToStaticMarkup(React.createElement(UpcomingAccountsCard, { accounts: paired.walk.accounts, periodLabel: "This period", onOpen() {} }));
const mixedRows = renderToStaticMarkup(React.createElement(UpcomingAttentionDay, { dayKeyIso: "2026-10-02", heading: "Fri 2 Oct", rows: paired.models, onOpen() {}, onDismiss() {} }));
assert.match(mixedCard, /£60\.00, short for payments/);
assert.match(mixedRows, /1 covered payment/);
assert.ok(mixedRows.indexOf('data-bill-key="payment-1"') < mixedRows.indexOf("<details"), "The short account's payment stays visible");

paired = assertAgreement([bill({ account_balance: -10 })]);
assert.equal(paired.models[0].isCreditCard, false, "A negative cash balance cannot silently become a credit card");
assert.equal(paired.statuses[0].shortfall, 90);

paired = assertAgreement([bill(), bill({ name: "Already settling", amount: 1000, observed_pending: true })]);
assert.equal(paired.walk.accounts[0].closing, 20);
assert.deepEqual(paired.statuses.map((status) => status.kind), ["covered", "settling"]);
assertAgreement([bill(), bill({ name: "Card purchase", amount: 1000, is_credit_card: true })]);

paired = assertAgreement([bill(), bill({ account_id: "b", account_balance: 20 })], [credit({ account_id: null, amount: 10000 })]);
assert.deepEqual(paired.statuses.map((status) => status.label), ["Covered", "Coverage unavailable"]);
assert.deepEqual(paired.walk.accounts.map((account) => account.income), [0, 0], "Unassigned income is never credited to multiple accounts");
for (const data of [{ account_balance: null }, { account_balance: NaN }, { amount: NaN }, { account_id: null }]) assertAgreement([bill(data)]);
assertAgreement([bill(), bill({ name: "Conflicting balance", account_balance: 101 })]);

const normalCutoff = upcomingAccountWindow(end, Date.parse("2026-10-28T23:50Z"));
paired = assertAgreement([bill({ expected_date: "2026-10-29", amount: 130 }), bill({ name: "Payday bill", expected_date: "2026-10-30" })], [credit({ expected_date: "2026-10-30" })], [], normalCutoff);
assert.deepEqual(paired.statuses.map((status) => status.label), ["short", "Next period"]);
assert.equal(paired.walk.accounts[0].shortfall, 30, "Payday income cannot cover the previous period");
const lookahead = upcomingAccountWindow(end, Date.parse("2026-10-29T10:00Z"));
paired = assertAgreement([bill({ expected_date: "2026-10-30" }), bill({ name: "Boundary", expected_date: "2026-11-04" }), bill({ name: "Outside", expected_date: "2026-11-05" })], [], [], lookahead);
assert.deepEqual(paired.statuses.map((status) => status.label), ["Covered", "short", "Next period"]);
assert.equal(paired.walk.accounts[0].shortfall, 60);

paired = assertAgreement([bill({ amount: 180 })], [credit()]);
assert.equal(paired.statuses[0].kind, "covered", "Same-day income arrives before cash debits in both views");
paired = assertAgreement([bill({ amount: 180 })], [credit({ expected_date: "2026-10-03" })]);
assert.equal(paired.walk.accounts[0].closing, 20);
assert.equal(paired.statuses[0].shortfall, 80, "A later credit cannot erase an earlier shortfall");
assertAgreement([bill({ account_balance: 20 })], [credit({ account_id: "b" })]);
assertAgreement([bill({ amount: 180 })], [], [credit({ source_account_name: "Savings" })]);
assertAgreement([bill({ amount: 0.31, account_balance: 0.3 })]);
assertAgreement([bill({ kind: "movement", amount: 180 })]);
assertAgreement([bill({ kind: "movement", amount: 150 }), bill({ name: "Later obligation", expected_date: "2026-10-03" })]);
paired = assertAgreement([bill({ pending: true })]);
assert.equal(paired.walk.accounts[0].status, "covered");
assert.equal(paired.statuses[0].label, "Not left yet", "Funded does not mean an overdue payment has left");

// Identical presentation fields do not identify an occurrence. Both predicted
// and planned payments can coexist; each must retain its own working.
for (const extra of [{}, { planned: true, planned_id: "planned-payment" }]) {
  const duplicates = [bill({ name: "Gym", amount: 60 }), bill({ name: "Gym", amount: 60, ...extra })];
  paired = assertAgreement(duplicates);
  assert.equal(paired.walk.coverage.size, 2);
  assert.deepEqual(paired.models.map((row) => [row.coverage.before, row.coverage.after]), [[100, 40], [40, -20]]);
  assert.deepEqual(paired.statuses.map((status) => status.label), ["Covered", "short"]);
}
const chronological = [bill({ name: "Later", expected_date: "2026-10-03", days_away: -1 }), bill({ name: "Earlier", expected_date: "2026-10-02", days_away: 100 })];
assert.deepEqual(chronological.map((item) => ({ ...item, type: "bill" })).sort(compareUpcomingEvents).map((item) => item.name), ["Earlier", "Later"], "Display and account walk share date ordering, not stale days-away offsets");
paired = assertAgreement(chronological);
assert.deepEqual(paired.statuses.map((status) => status.label), ["short", "Covered"]);

for (const scenario of SCENARIOS) {
  const forecast = buildForecast(scenario.id);
  const result = accountSummariesForForecast(forecast);
  assert.equal(result.reduce((sum, account) => sum + account.closing, 0), forecast.closing / 100);
  assert.equal(result.reduce((sum, account) => sum + account.shortfall, 0), forecast.shortfall / 100);
  const card = renderToStaticMarkup(React.createElement(UpcomingAccountsCard, { accounts: result, periodLabel: "Payments through Wed 30 Sept", onOpen() {} }));
  assert.match(card, /By account/); assert.match(card, /Open Barclays/); assert.match(card, /Tap an account for its working/);
  if (scenario.id === "moves") { assert.match(card, /Short for transfers/); assert.match(card, /data-status-signal="move"/); assert.doesNotMatch(card, /data-status-signal="risk"|text-rose|bg-rose/); }
  if (scenario.id === "covered") assert.doesNotMatch(card, /data-status-signal="(?:risk|move|plan)"|lucide-triangle-alert|lucide-info/);
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
assert.doesNotMatch(hero, /Plans this period/, "no plans, no plans row");
const heroPlans = renderToStaticMarkup(React.createElement(UpcomingHeroCard, {
  isCalendarMonth: false, daysToPayday: 2, paydayLabel: "Fri 30 Oct", spendableNow: 1230,
  runwayIncomeTotal: 15, runwayBillsTotal: 1045, allocationsRemainingTotal: 100, plansReservedTotal: 80,
  savingsNow: 300, runway: 20, runwayStatus: "left",
}));
assert.match(heroPlans, /Plans this period/);
assert.match(heroPlans, /Goal contributions you planned for this pay period\./);
assert.match(heroPlans, /−£80/);
assert.ok(heroPlans.indexOf("Still to set aside") < heroPlans.indexOf("Plans this period") && heroPlans.indexOf("Plans this period") < heroPlans.indexOf("Projected balance"), "plans row sits between set-aside and total");
const heroPlansDown = renderToStaticMarkup(React.createElement(UpcomingHeroCard, {
  isCalendarMonth: false, daysToPayday: 2, paydayLabel: "Fri 30 Oct", spendableNow: 1230,
  runwayIncomeTotal: 15, runwayBillsTotal: 1045, allocationsRemainingTotal: 100, plansUnavailable: true,
  savingsNow: 300, runway: 100, runwayStatus: "left",
}));
assert.match(heroPlansDown, /could not be loaded/);
assert.match(hero, /Payments can take a day or two to appear, so a very recent one may not be counted yet\./);
assert.doesNotMatch(hero, /account short|accounts short|Barclays|HSBC|Review/);
console.log("G176 account summaries, shared views, income labels and hero invariants passed");
