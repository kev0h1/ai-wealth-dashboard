// B55: Upcoming honours Hide balances. Raw props, server-rendered, with and
// without the page-level BalancesHiddenContext (PlanningPage provides it from
// the same preference Home reads). Bill, income and payment amounts are
// deliberately not balances and stay visible; they are excluded below.
import assert from "node:assert/strict";
import React, { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { BalancesHiddenContext } from "../lib/balancesHidden.tsx";
import UpcomingAccountsCard from "../components/upcoming/UpcomingAccountsCard.tsx";
import UpcomingAccountDetails from "../components/upcoming/UpcomingAccountDetails.tsx";
import UpcomingRow from "../components/upcoming/UpcomingRow.tsx";
import UpcomingRowDetails from "../components/upcoming/UpcomingRowDetails.tsx";
import { PlanRecordView } from "../components/plans/PlanRecordView.tsx";
import UnlinkedGoalPlans from "../components/upcoming/UnlinkedGoalPlans.tsx";
import { planConfirmMessage } from "../components/PlanOneOffSheet.tsx";
import { maskMoneyText } from "../lib/balancesHidden.tsx";
import { Landmark } from "../lib/phosphorIcons.tsx";
import SetAsideList from "../components/upcoming/SetAsideList.tsx";
import UpcomingPlansCard from "../components/upcoming/UpcomingPlansCard.tsx";
import { ACCOUNTS, SCENARIOS, PERIOD, plansFor, forecastFor } from "../app/design/g176-account-plans/fixtures.ts";

const RAW = /£\d/;
const wrap = (hidden, el) => renderToStaticMarkup(h(BalancesHiddenContext.Provider, { value: hidden }, el));
let renders = 0;

// By account rows and account sheet, across the scenario fixtures.
for (const { id } of SCENARIOS) {
  const plans = plansFor(id);
  const accounts = forecastFor(id).accounts;
  const card = (hidden) => wrap(hidden, h(UpcomingAccountsCard, { accounts, plans, plansStatus: "ready", periodLabel: PERIOD, onOpen() {} }));
  assert.doesNotMatch(card(true), RAW, `${id}: By account card masked`);
  for (const account of accounts) {
    const detail = (hidden) => wrap(hidden, h(UpcomingAccountDetails, { account, periodLabel: PERIOD, plans, plansStatus: "ready" }));
    // G416 approved A: this account-sheet view masks every figure, including
    // ordinary event amounts and their accessible labels. Payment detail and
    // timeline flows retain their established visible-transaction rule.
    const hiddenHtml = detail(true);
    assert.doesNotMatch(hiddenHtml, RAW, `${id}/${account.id}: whole account sheet masked`);
    renders++;
  }
  if (id === "gap") {
    assert.match(card(false), /£\d/, "gap: By account amounts visible when balances shown");
    const shownSheet = wrap(false, h(UpcomingAccountDetails, { account: accounts[0], periodLabel: PERIOD, plans, plansStatus: "ready" }));
    const planFigure = shownSheet.slice(shownSheet.indexOf("data-account-plan-figure"), shownSheet.indexOf("data-verdict"));
    assert.match(planFigure.replace(/<[^>]+>/g, ""), /£\d/, "gap: sheet figure visible");
  }
  renders++;
}

// Native account button names retain privacy even when an account is named with money.
{
  const sample=forecastFor("gap").accounts[0];
  const named={...sample,name:"Bills £1,200"};
  assert.doesNotMatch(wrap(true,h(UpcomingAccountsCard,{accounts:[named],plans:[],plansStatus:"ready",periodLabel:PERIOD,onOpen(){}})),RAW);
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

// G489 masks the actual combined card, including monetary names and source labels.
{
 const source={...ACCOUNTS[0],id:"payer",name:"Reserve £200"};
 const allocation={id:"b55-allocation",name:"Annual costs £100",amount_per_period:100,period_amount:100,filled_this_period:40,remaining:60,source_account_id:null,fill_account_id:"receiving-pot",fill_display_name:"Annual costs",match_type:"description_equals",match_value:"Annual costs",recurrence:"every_period",active:true,pending:false,completed:false,period_start:"2026-11-01",period_end:"2026-11-26",effective_from:"2026-11-01"};
 const overlay={id:"allocation:b55-allocation",recordId:allocation.id,kind:"allocation",name:allocation.name,sourceId:source.id,evidence:"recent-transfers",destination:"Annual pot",periodPence:10000,filledPence:4000,remainingPence:6000,active:true};
 const goal={...overlay,id:"goal:b55",recordId:"b55",kind:"goal",name:"Trip £336.56",periodPence:33656,filledPence:0,remainingPence:33656,fulfilment:{state:"partial",expected_pence:33656,matched_pence:10000,unmet_pence:23656,seen_in_sink:false,matched:[]}};
 const combined=hidden=>wrap(hidden,h(UpcomingPlansCard,{allocations:[allocation],allocationsError:false,plans:[overlay,goal],plansStatus:"ready",accounts:[source],onAdd(){},onEditAllocation(){},onPlan(){},onRetryAllocations(){},onRetryPlans(){}}));
 assert.doesNotMatch(combined(true),RAW,"G489 masks amounts, names, payer identities and accessible content");
 const shown=combined(false).replace(/<[^>]+>/g,"");
 assert.match(shown,/£60/);assert.match(shown,/£40 of £100 set aside/);assert.match(shown,/£100 of £336.56 paid/);assert.match(shown,/estimated from recent transfers/);renders+=2;
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

console.log(`PASS B55: ${renders} Upcoming renders, By account rows, account sheets and envelope rows masked when hidden and restored when shown.`);
