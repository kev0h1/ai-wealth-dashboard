import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Landmark } from "lucide-react";
import { getUpcomingStatus, upcomingMoney, upcomingPaymentKey, canDismissUpcomingOccurrence } from "../lib/upcomingAttention.ts";
import { walkUpcomingAccounts } from "../lib/upcomingAccountWalk.ts";
import UpcomingAttentionDay from "../components/upcoming/UpcomingAttentionDay.tsx";
import UpcomingRowDetails from "../components/upcoming/UpcomingRowDetails.tsx";

const base = {
  rowKey: "bill-test-2026-09-30", type: "bill", name: "Example payment", amount: 80,
  expectedDate: "2026-09-30", accountLabel: "Household account", category: "Bills",
  after: { kind: "balance", value: 200 }, categoryColour: "#64748b", CategoryIcon: Landmark,
  coverage: { before: 100, after: 20, shortfall: 0 },
};
const model = (changes = {}) => ({ ...base, ...changes });
const status = (changes) => getUpcomingStatus(model(changes));
assert.equal(status({ atRisk: true, flagged: true, after: { kind: "balance", value: -50 } }).kind, "covered", "Healthy source account is not a pooled shortfall");
assert.deepEqual(status({ coverage: { before: 40, after: -40, shortfall: 40 } }), { kind: "issue", label: "short", tone: "risk", shortfall: 40 });
assert.equal(status({ coverage: { shortfall: 0.01 } }).shortfall, 0.01, "A penny short is not rounded away");
assert.equal(status({ isMovement: true, coverage: { shortfall: 40 }, flagged: true }).tone, "caution", "Own moves never earn bill-risk red");
assert.equal(status({ isMovement: true, coverage: { shortfall: 0 }, unfundedMovement: true }).kind, "covered", "Verified source cash outranks legacy pooled movement warning");
for (const changes of [{ pending: true }, { daysPastDue: 2 }]) assert.equal(status(changes).label, "Not left yet");
assert.equal(status({ pending: true, category: "Debt", daysPastDue: 5 }).tone, "risk");
assert.equal(status({ timingRisk: true }).label, "Money due in");
assert.equal(status({ accountTiming: true }).kind, "issue");
assert.equal(status({ coverage: undefined }).label, "Coverage unavailable");
assert.equal(status({ assessment: "unverified" }).kind, "issue", "Absence of a risk flag never proves coverage");
assert.equal(status({ coverage: { shortfall: NaN } }).kind, "issue");
assert.equal(status({ assessment: "future", flagged: true }).kind, "future");
assert.equal(status({ assessment: "future", pending: true }).kind, "issue", "Overdue never disappears into a later-period disclosure");
assert.equal(status({ isCreditCard: true, flagged: true }).kind, "card");
assert.equal(status({ isCreditCard: true, pending: true }).kind, "issue");
assert.equal(status({ isSettling: true, pending: true, flagged: true, coverage: { shortfall: 100 } }).kind, "settling");
assert.equal(status({ type: "income" }).kind, "income");
assert.equal(status({ type: "income", pending: true }).label, "Not arrived yet");
assert.equal(canDismissUpcomingOccurrence(model({ pending: true, daysPastDue: 5, isPlanned: true })), true, "Existing planned pending dismissal survives the fold-in");
assert.equal(canDismissUpcomingOccurrence(model({ pending: true, daysPastDue: 4 })), false);
assert.equal(canDismissUpcomingOccurrence(model({ pending: true, isMovement: true, coverage: { shortfall: 40 } })), true);
assert.equal(canDismissUpcomingOccurrence(model({ pending: true, daysPastDue: 9, isSettling: true })), false);
assert.equal(canDismissUpcomingOccurrence(model({ type: "income", pending: true, daysPastDue: 9 })), false);
assert.equal(upcomingMoney(-1.25), "−£1.25");

// Explicit account-walk cases pin the existing ordering and risk semantics,
// rather than deriving expected results through a second copy of the walk.
const bill = (changes = {}) => ({ name: "Bill", amount: 80, account_id: "a", account_balance: 100, expected_date: "2026-09-30", days_away: 0, kind: "commitment", ...changes });
const cutoff = Date.parse("2026-10-02");
const walk = (bills, income = [], inflows = []) => walkUpcomingAccounts({ upcoming_bills: bills, upcoming_income: income, internal_inflows: inflows }, cutoff);
const credit = (changes = {}) => ({ amount: 100, account_id: "a", expected_date: "2026-09-30", days_away: 0, ...changes });
const first = bill({ name: "First", amount: 180 });
const second = bill({ name: "Second", amount: 30 });
let result = walk([first, second], [credit()]);
assert.deepEqual(result.coverage.get(upcomingPaymentKey(first)), { before: 200, after: 20, shortfall: 0 }, "Same-day income is credited first");
assert.deepEqual(result.coverage.get(upcomingPaymentKey(second)), { before: 20, after: -10, shortfall: 10 });
assert.deepEqual(result.atRisk.map((item) => item.name), ["Second"]);
assert.equal(walk([first], [], [credit({ destination_spendable: false })]).atRisk.length, 0, "Source-account coverage includes internal inflow even into savings");
assert.equal(walk([first], [credit({ account_id: "b" })]).atRisk.length, 1, "Another account's income cannot cover this one");
result = walk([first], [credit({ account_id: null })]);
assert.equal(result.atRisk.length, 0, "Legacy unidentified-income risk treatment stays unchanged");
assert.equal(result.coverage.size, 0, "But unidentified income cannot verify a particular account for Covered");
assert.equal(walk([bill({ account_id: null })]).coverage.size, 0, "Unidentified paying account is not verified");
for (const excluded of [{ account_balance: -10 }, { account_balance: null }, { is_credit_card: true }, { expected_date: "2026-10-03" }]) {
  const excludedWalk = walk([bill(excluded)]);
  assert.equal(excludedWalk.coverage.size, 0);
  assert.equal(excludedWalk.atRisk.length, 0, "Existing walk scope stays unchanged");
}
assert.equal(walk([first], [credit({ expected_date: "2026-10-03" })]).atRisk.length, 1, "Future credits beyond cutoff do not cover current bills");
const sameNameOtherAccount = bill({ name: "First", amount: 180, account_id: "b", account_balance: 300 });
result = walk([first, second, sameNameOtherAccount]);
assert.deepEqual(result.atRisk.map((item) => item.name), ["First", "Second"], "Deficit cascades on its own account only");
assert.equal(result.coverage.get(upcomingPaymentKey(sameNameOtherAccount)).after, 120);
assert.equal(result.coverage.get(upcomingPaymentKey(second)).shortfall, 110);

const largeMove = bill({ name: "Savings", kind: "movement", amount: 90 });
const smallMove = bill({ name: "Pot", kind: "movement", amount: 20 });
result = walk([largeMove, smallMove, second]);
assert.equal(result.atRisk.length, 1, "Unfunded moves are never in the genuine bill-risk set");
assert.equal(result.atRisk[0].movementCulprit.name, "Savings", "Largest move since last credit explains the risk");
assert.equal(result.coverage.get(upcomingPaymentKey(smallMove)).shortfall, 10);
const later = bill({ name: "Later", amount: 200, expected_date: "2026-10-01", days_away: 1 });
result = walk([largeMove, later], [credit({ expected_date: "2026-10-01", days_away: 1 })]);
assert.equal(result.atRisk[0].movementCulprit, undefined, "A later credit resets movement attribution");
assert.deepEqual(result.coverage.get(upcomingPaymentKey(later)), { before: 110, after: -90, shortfall: 90 });
const pennies = bill({ amount: 0.2, account_balance: 0.3 });
result = walk([pennies]);
assert.deepEqual(result.coverage.get(upcomingPaymentKey(pennies)), { before: 0.3, after: 0.1, shortfall: 0 });

// Actual production rendering, not a parallel preview implementation.
const rows = [
  model({ rowKey: "covered", name: "Covered debit", amount: 12.34 }),
  model({ rowKey: "income", name: "Salary", type: "income", amount: 1000 }),
  model({ rowKey: "short", name: "Short debit", coverage: { shortfall: 40 } }),
  model({ rowKey: "late", name: "Late but funded", pending: true }),
  model({ rowKey: "unknown", name: "Unknown account", coverage: undefined }),
  model({ rowKey: "card", name: "Card charge", isCreditCard: true }),
  model({ rowKey: "future", name: "Later bill", assessment: "future" }),
  model({ rowKey: "settling", name: "Settling debit", isSettling: true }),
];
const markup = renderToStaticMarkup(React.createElement(UpcomingAttentionDay, { dayKeyIso: "2026-09-30", heading: "Today", rows, onOpen() {}, onDismiss() {} }));
assert.match(markup, /1 covered payment · <span[^>]+>£12\.34/);
assert.match(markup, /1 card charge/);
assert.match(markup, /1 later payment/);
assert.match(markup, /Open details for Salary into Household account, \+£1,000.00/);
assert.equal((markup.match(/<details/g) ?? []).length, 3);
assert.doesNotMatch(markup, /<details[^>]* open=/, "Routine groups default closed");
for (const key of ["income", "short", "late", "unknown"]) assert.ok(markup.indexOf(`data-bill-key="${key}"`) < markup.indexOf("<details"), `${key} stays visible above disclosures`);
assert.ok(markup.indexOf('data-bill-key="settling"') > markup.lastIndexOf("</details>"), "Settling remains in its quiet trailing block");
assert.doesNotMatch(markup, /Why\?|Dismiss for this month/, "Supporting actions are no longer inline");
const detail = renderToStaticMarkup(React.createElement(UpcomingRowDetails, { model: model({ amount: 80.25, coverage: { before: 40, after: -40.25, shortfall: 40.25 }, amountBasis: "balance_estimate" }) }));
for (const text of ["−£80.25", "£40.25", "−£40.25", "£200", "Before, in Household account", "After, in Household account", "Projected cash overall after this", "Estimated amount"]) assert.ok(detail.includes(text), text);
const settledDetail = renderToStaticMarkup(React.createElement(UpcomingRowDetails, { model: model({ isSettling: true, after: { kind: "settling" } }) }));
assert.match(settledDetail, /not deducted again/);
assert.doesNotMatch(settledDetail, /Before, in/);
console.log("G176 attention: status precedence, dismissal gates, account-walk semantics, real grouping and signed detail working pass.");
