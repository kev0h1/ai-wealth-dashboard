// G266: a card repayment that will fail is a payment at risk ("short"), never
// a calm unfunded move. A true own-account move stays "unfunded".
//
// Run: npm run -s check:g266-card-repayment
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { walkUpcomingAccounts, upcomingAccountAssessment } from "../lib/upcomingAccountWalk.ts";
import { cardRepaymentShortCopy } from "../lib/upcomingAccountStatus.ts";
import { withCoverSuggestions, coverSuggestionSentence } from "../lib/coverSuggestion.ts";
import UpcomingAccountDetails from "../components/upcoming/UpcomingAccountDetails.tsx";

const END = Date.parse("2026-11-05T00:00:00Z");
const bill = (over) => ({
  name: "x", amount: 10, expected_date: "2026-10-15", days_away: 2, account_id: "cur", account_name: "THE NUMBER ONE",
  account_bank: "NatWest", account_balance: 93.49, is_credit_card: false, category: "Bills", kind: "commitment",
  pending: false, observed_pending: false, ...over,
});
const gym = bill({ name: "THE GYM LTD", amount: 22.99, expected_date: "2026-10-15" });
const other = bill({ name: "A/C 76526682", amount: 22, expected_date: "2026-10-19" });
const repay = (over = {}) => bill({ name: "NW WORLD MASTERCAR", display_name: "NW World Mastercard", amount: 62.22, expected_date: "2026-10-28", category: "Debt", kind: "movement", is_card_repayment: true, ...over });
const flow = (bills) => ({ upcoming_bills: bills, upcoming_income: [], internal_inflows: [] });

// 1. Kevin's case: -13.72 is short, and names the repayment.
{
  const walk = walkUpcomingAccounts(flow([gym, other, repay()]), END);
  const account = walk.accounts[0];
  assert.equal(account.status, "short");
  assert.equal(account.shortfall, 13.72);
  assert.equal(account.shortFor.cardRepayment, true);
  assert.equal(cardRepaymentShortCopy(account), "£13.72 short for the NW World Mastercard repayment on 28 Oct");
  assert.ok(walk.atRisk.length === 1, "the repayment is at risk");
  const row = upcomingAccountAssessment(walk.atRisk[0], walk);
  assert.equal(row.accountShort, true);
  assert.equal(row.unfundedMovement, false);
  assert.equal(row.coverage.optionalMove, false);
  const html = renderToStaticMarkup(React.createElement(UpcomingAccountDetails, { account, periodLabel: "x", plans: [], plansStatus: "ready" }));
  assert.match(html, /data-card-repayment-short/);
  assert.doesNotMatch(html, /may stay put/);
  assert.ok(!html.includes("—") && !html.includes("!"), "copy rules");
}

// 2. Same shape without the flag (an old cached payload) keeps the old read; with a savings transfer it stays unfunded.
{
  const saving = bill({ name: "Savings pot", amount: 120, category: "Savings", kind: "movement", expected_date: "2026-10-20" });
  const account = walkUpcomingAccounts(flow([saving]), END).accounts[0];
  assert.equal(account.status, "unfunded");
  assert.equal(account.shortFor, null);
  const html = renderToStaticMarkup(React.createElement(UpcomingAccountDetails, { account, periodLabel: "x", plans: [], plansStatus: "ready" }));
  assert.match(html, /may stay put, with no fee/);
}

// 3. A covered repayment stays covered.
assert.equal(walkUpcomingAccounts(flow([repay({ amount: 10 })]), END).accounts[0].status, "covered");

// 4. Non-repayment payment short names the payment but is not a card repayment.
{
  const account = walkUpcomingAccounts(flow([bill({ amount: 120 })]), END).accounts[0];
  assert.equal(account.status, "short");
  assert.equal(account.shortFor.cardRepayment, false);
}

// 5. Cover suggestion is a sentence from the engine's move item.
{
  const account = walkUpcomingAccounts(flow([gym, other, repay()]), END).accounts[0];
  const items = [{ type: "move", moves: [{ amount: 14, move_map: { from: { account_id: "sav", name: "Easy Saver" }, to: { account_id: "cur" } } }] }];
  const [withMove] = withCoverSuggestions([account], items);
  assert.equal(coverSuggestionSentence(withMove.coverSuggestion), "Moving £14 in from Easy Saver would cover it.");
  const html = renderToStaticMarkup(React.createElement(UpcomingAccountDetails, { account: withMove, periodLabel: "x", plans: [], plansStatus: "ready" }));
  assert.match(html, /Moving £14 in from Easy Saver would cover it\./);
  assert.ok(!/<button/.test(html.split("Moving £14")[0].slice(-200)), "a sentence, not a button");
}
console.log("g266-card-repayment: ok");
