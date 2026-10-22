// B55: Upcoming honours Hide balances. Raw props, server-rendered, with and
// without the page-level BalancesHiddenContext (PlanningPage provides it from
// the same preference Home reads). Bill, income and payment amounts are
// deliberately not balances and stay visible; they are excluded below.
import assert from "node:assert/strict";
import React, { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { BalancesHiddenContext } from "../lib/balancesHidden.tsx";
import UpcomingHeroCard from "../components/upcoming/UpcomingHeroCard.tsx";
import UpcomingAccountsCard from "../components/upcoming/UpcomingAccountsCard.tsx";
import UpcomingAccountDetails from "../components/upcoming/UpcomingAccountDetails.tsx";
import UpcomingRow from "../components/upcoming/UpcomingRow.tsx";
import UpcomingRowDetails from "../components/upcoming/UpcomingRowDetails.tsx";
import { PlanRecordView } from "../components/plans/PlanRecordView.tsx";
import UnlinkedGoalPlans from "../components/upcoming/UnlinkedGoalPlans.tsx";
import { planConfirmMessage } from "../components/PlanOneOffSheet.tsx";
import { maskMoneyText } from "../lib/balancesHidden.tsx";
import { Landmark } from "lucide-react";
import SetAsideList from "../components/upcoming/SetAsideList.tsx";
import { ACCOUNTS, SCENARIOS, PERIOD, plansFor, forecastFor } from "../app/design/g176-account-plans/fixtures.ts";

const RAW = /£\d/;
const wrap = (hidden, el) => renderToStaticMarkup(h(BalancesHiddenContext.Provider, { value: hidden }, el));
const heroProps = {
  isCalendarMonth: false, daysToPayday: 9, paydayLabel: "Fri 30 Oct", spendableNow: 1234.56,
  runwayIncomeTotal: 2100, runwayBillsTotal: 876, allocationsRemainingTotal: 300, plansReservedTotal: 150,
  allocationsCount: 2, plansCount: 1, savingsNow: 4321, runway: -1234, runwayStatus: "short",
};
let renders = 0;

// Hero: context-driven and prop-driven, both signs.
for (const [label, build] of [
  ["context", (hidden, extra) => wrap(hidden, h(UpcomingHeroCard, { ...heroProps, ...extra }))],
  ["prop", (hidden, extra) => wrap(false, h(UpcomingHeroCard, { ...heroProps, ...extra, balancesHidden: hidden }))],
]) {
  for (const extra of [{}, { runway: 980, runwayStatus: "left" }]) {
    const hiddenHtml = build(true, extra);
    assert.doesNotMatch(hiddenHtml, RAW, `hero ${label}: no raw amount in text or aria`);
    assert.match(hiddenHtml, /£••••/, `hero ${label}: mask shown`);
    assert.match(hiddenHtml, /aria-label="Amount hidden, (short|left)"/, `hero ${label}: aria-label masked`);
    assert.match(hiddenHtml, /Savings backup/, `hero ${label}: savings line present but masked`);
    const shown = build(false, extra);
    assert.match(shown, /£1,235/, `hero ${label}: spendable now visible`);
    assert.match(shown, /£4,321/, `hero ${label}: savings visible`);
    assert.match(shown, /pounds (short|left)"/, `hero ${label}: aria-label restored`);
    assert.doesNotMatch(shown, /£••••/, `hero ${label}: nothing masked when visible`);
    renders += 2;
  }
}
// G304 explainer receives the mask-aware formatter.
{
  const html = wrap(true, h(UpcomingHeroCard, heroProps));
  assert.match(html, /£••••/);
  assert.doesNotMatch(html.replace(/<[^>]+>/g, ""), RAW, "explainer text masked");
}

// By account rows and account sheet, across the scenario fixtures.
for (const { id } of SCENARIOS) {
  const plans = plansFor(id);
  const accounts = forecastFor(id).accounts;
  const card = (hidden) => wrap(hidden, h(UpcomingAccountsCard, { accounts, plans, plansStatus: "ready", periodLabel: PERIOD, onOpen() {} }));
  assert.doesNotMatch(card(true), RAW, `${id}: By account card masked`);
  for (const account of accounts) {
    const detail = (hidden) => wrap(hidden, h(UpcomingAccountDetails, { account, periodLabel: PERIOD, plans, plansStatus: "ready" }));
    // Payments & income lines are payment amounts, not balances: they stay visible.
    const hiddenHtml = detail(true).split(/<section aria-labelledby="[^"]*-events">/)[0];
    assert.doesNotMatch(hiddenHtml, RAW, `${id}/${account.id}: account sheet figures masked`);
    renders++;
  }
  if (id === "gap") {
    assert.match(card(false), /£\d/, "gap: By account amounts visible when balances shown");
    assert.match(wrap(false, h(UpcomingAccountDetails, { account: accounts[0], periodLabel: PERIOD, plans, plansStatus: "ready" })), /data-account-plan-figure[^>]*>[^<]*£\d/, "gap: sheet figure visible");
  }
  renders++;
}

// Envelope rows.
{
  const items = [{ id: "a", name: "Savings challenge", feedLabel: "Challenge pot", amountPerPeriod: 360, filledThisPeriod: 60, remaining: 300, recurrence: "every_period", pending: false, completed: false }];
  const hiddenHtml = wrap(true, h(SetAsideList, { items, onEdit() {} }));
  assert.doesNotMatch(hiddenHtml, RAW, "set-aside rows masked, aria included");
  assert.match(hiddenHtml, /£••••/);
  const shown = wrap(false, h(SetAsideList, { items, onEdit() {} }));
  assert.match(shown, /£300 still to reserve/);
  assert.match(shown.replace(/<[^>]+>/g, ""), /£60 of £360 set aside/);
  renders += 2;
}

// Row, payment sheet, plan sheet, unlinked goals, confirmation message, mask regex.
{
  const model = {
    rowKey: "bill-b55", type: "bill", name: "Example payment", amount: 80.5, expectedDate: "2026-09-30",
    accountLabel: "Household account", category: "Bills", categoryColour: "#64748b", CategoryIcon: Landmark,
    after: { kind: "balance", value: -234 }, accountShort: true, accountBalance: 1234, flagged: true, atRisk: true,
    coverage: { before: 40, after: -40, shortfall: 40 }, why: { open: true, culprit: { amount: 321.5, expectedDate: "2026-09-29" } },
  };
  const BILL = /£80\.50/;
  for (const treatment of ["current", "needs-attention", "account-coverage"]) {
    const html = wrap(true, h(UpcomingRow, { model, treatment, onOpen() {}, onDismiss() {} }));
    // The bill's own amount is not a balance; strip it, then nothing else may show a figure.
    const rest = html.replace(/£80\.50/g, "BILL");
    assert.doesNotMatch(rest, RAW, `row ${treatment}: only the bill amount stays visible`);
    assert.match(html, BILL, `row ${treatment}: bill amount stays visible`);
    const shown = wrap(false, h(UpcomingRow, { model, treatment, onOpen() {}, onDismiss() {} }));
    assert.match(shown, /£\d/, `row ${treatment}: figures visible when shown`);
    assert.doesNotMatch(shown, /£••••/, `row ${treatment}: nothing masked when shown`);
    renders += 2;
  }
  const sheet = (hidden) => wrap(hidden, h(UpcomingRowDetails, { model: { ...model, amountBasis: undefined } }));
  const hiddenSheet = sheet(true).replace(/£80\.50/g, "BILL");
  assert.doesNotMatch(hiddenSheet, RAW, "payment sheet: shortfall, culprit and ledger masked");
  assert.match(sheet(true), /£80\.50/, "payment sheet: headline and This payment line stay visible");
  assert.match(sheet(false), /£321\.50/, "payment sheet: culprit visible when shown");
  renders += 3;
  const goalView = (hidden) => wrap(hidden, h(PlanRecordView, { kind: "goal", contribution: 65, cadence: "each pay period", target: { amount: 2000, month: "August 2027" }, progress: 320, sourceAccount: ACCOUNTS[0], destinationAccounts: [ACCOUNTS[2]], trackingLabel: "Not linked yet" }));
  assert.doesNotMatch(goalView(true), RAW, "canonical goal View masks contribution, target and progress");
  assert.match(goalView(true), /£••••/, "canonical goal View displays the mask");
  assert.match(goalView(false), /£65/, "canonical goal View restores contribution");
  assert.match(goalView(false), /£320 of £2,000/, "canonical goal View restores progress");
  renders += 2;
  const unlinked = plansFor("unassigned").map((plan) => ({ ...plan, sourceId: null, evidence: "unknown" }));
  assert.doesNotMatch(wrap(true, h(UnlinkedGoalPlans, { plans: unlinked, onPlan() {} })), RAW, "unlinked goals masked");
  assert.match(wrap(false, h(UnlinkedGoalPlans, { plans: unlinked, onPlan() {} })), /£\d/, "unlinked goals visible when shown");
  const impact = (v) => ({ safe_to_spend_after: v });
  for (const v of [250, -80]) {
    assert.doesNotMatch(planConfirmMessage(impact(v), true), RAW, "confirm message masked");
    assert.match(planConfirmMessage(impact(v), false), /£\d/, "confirm message visible when shown");
  }
  assert.equal(maskMoneyText("£1.2k and £3m and £4,500.50", true), "£•••• and £•••• and £••••", "k/m suffixes mask fully");
  renders += 6;
}

console.log(`PASS B55: ${renders} Upcoming renders, hero (text, aria, explainer, savings), By account rows, account sheets and envelope rows masked when hidden and restored when shown.`);
