// G422: an own-savings standing order its account cannot fund. Amber, never a
// payment shortfall, never red; the engine's own sentence says what would cover
// it or that nothing can. Recommendation in words only (the app never moves,
// pauses or cancels anything). No em dashes in the copy.
import assert from "node:assert/strict";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Landmark } from "lucide-react";
import { accountPaymentGap, positionsFromToday, reconcileWithServerPosition } from "../lib/upcomingAccounts.ts";
import { withCoverSuggestions } from "../lib/coverSuggestion.ts";
import { statusFor } from "../lib/upcomingAccountStatus.ts";
import { accountAvailability } from "../lib/accountAvailability.ts";
import { BalancesHiddenContext } from "../lib/balancesHidden.tsx";
import UpcomingAccountDetails from "../components/upcoming/UpcomingAccountDetails.tsx";
import UpcomingRow from "../components/upcoming/UpcomingRow.tsx";

const NO_COVER = "There may not be enough to fund this savings transfer this period. You could pause or cancel the standing order with your bank for this month.";
const COVERED = "Savings at risk. A suggested move from Monzo Current would cover it. Nothing has been moved.";

const order = { name: "SAVER STANDING ORDER", label: "Saver Standing Order", amount: 250, expected_date: "2026-11-26", to_name: "Barclays Saver" };
const eligibility = (extra) => ({
  "acc-bc": { short: true, headroom: -210, spend_from_headroom: 10, uncertain: false, plans_reserved: 0, after_payments: -200, low_point: -200, after_payments_and_plans: -200, low_point_and_plans: -200, ...extra },
});
const accountsMeta = [{ id: "acc-bc", type: "BANK", subtype: "TRANSACTION" }];

// The client walk already calls an own-savings order that cannot be funded "unfunded", not "short".
const walk = {
  id: "acc-bc", bank: "Barclays", name: "Current", opening: 50, income: 0, transfersIn: 0, outgoing: 250, closing: -200, shortfall: 200,
  status: "unfunded", firstShortDate: "2026-11-26", hasUnassignedIncome: false,
  events: [{ id: "sto", name: "Saver Standing Order", date: "2026-11-26", kind: "movement", amount: -250, after: -200 }],
};

function summaryFor(extra) {
  const positions = positionsFromToday(eligibility(extra), accountsMeta);
  return withCoverSuggestions([reconcileWithServerPosition(walk, positions["acc-bc"])], [])[0];
}

// 1. No cover anywhere: never a payment gap, never risk (red), the plain line is shown.
const none = summaryFor({ savings_at_risk: { amount: 200, covered: 0, no_cover: true, note: NO_COVER, orders: [order] } });
assert.equal(none.status, "unfunded", "reconcile keeps an own-savings gap out of the payment shortfall");
assert.equal(accountPaymentGap(none), null, "a savings gap is not a payment gap");
assert.notEqual(statusFor(none, []).signal, "risk", "never red");
assert.equal(statusFor(none, []).signal, "move");
assert.equal(none.position.savingsAtRisk.noCover, true);

const readingNone = accountAvailability({ id: "acc-bc", type: "BANK", subtype: "TRANSACTION", currency: "GBP", status: "connected", name: "Current", balance: 50, include_in_safe_to_spend: true },
  { status: "ready", positions: eligibility({ spend_from_headroom: 0, savings_at_risk: { amount: 200, covered: 0, no_cover: true, note: NO_COVER, orders: [order] } }) });
if (readingNone && readingNone.kind === "ready") {
  assert.equal(readingNone.warning, undefined, "no red payments warning on the Accounts list");
  assert.equal(readingNone.note, NO_COVER);
}

// 2. Covered by a suggested move: amber, named.
const covered = summaryFor({
  spend_from_requires_move: true,
  covered_by_move: { amount: 210, shortfall: 200, from: [{ account_id: "acc-mz", name: "Monzo Current", amount: 210 }] }, short_after_cover: 0,
  savings_at_risk: { amount: 200, covered: 210, no_cover: false, note: COVERED, orders: [order] },
});
assert.equal(accountPaymentGap(covered), null);
const coveredStatus = statusFor(covered, []);
assert.equal(coveredStatus.signal, "move");
assert.equal(coveredStatus.label, "Short for transfers, a move would cover it");

// 3. A genuine payment gap on the same account is still a payment gap (red stays earned).
const mixed = reconcileWithServerPosition({ ...walk, status: "short", shortfall: 260 }, positionsFromToday(eligibility({ after_payments: -260, low_point: -260, after_payments_and_plans: -260, low_point_and_plans: -260, savings_at_risk: { amount: 200, covered: 0, no_cover: true, note: NO_COVER, orders: [order] } }), accountsMeta)["acc-bc"]);
assert.equal(mixed.status, "short");
assert.equal(accountPaymentGap(mixed), 260, "the client walk's own bill shortfall is never reduced by a savings fact");

// 4. The account sheet says it in the engine's words.
const sheet = (account, hidden = false) => renderToStaticMarkup(h(BalancesHiddenContext.Provider, { value: hidden }, h(UpcomingAccountDetails, { account, periodLabel: "this pay period", plans: [], plansStatus: "ready" })));
const noneHtml = sheet(none);
assert.match(noneHtml, /A savings transfer is not fully funded/);
assert.ok(noneHtml.includes(NO_COVER), "account sheet carries the no-cover line");
assert.doesNotMatch(noneHtml, /Payments need more money/);
assert.ok(sheet(covered).includes(COVERED));

// 5. The Upcoming row shows the line instead of the generic calm one, and no red.
const model = {
  rowKey: "bill-sto", type: "bill", name: "Saver Standing Order", amount: 250, expectedDate: "2026-11-26",
  accountLabel: "Barclays", category: "Transfer", categoryColour: "#64748b", CategoryIcon: Landmark, isMovement: true,
  after: { kind: "balance", value: -200 }, movementCalm: true, unfundedMovement: true, savingsNote: NO_COVER,
};
const rowHtml = renderToStaticMarkup(h(BalancesHiddenContext.Provider, { value: false }, h(UpcomingRow, { model, treatment: "current", onOpen() {}, onDismiss() {} })));
assert.ok(rowHtml.includes(NO_COVER), "Upcoming row carries the no-cover line");
assert.doesNotMatch(rowHtml, /May not go through if the balance is tight/);
const calm = renderToStaticMarkup(h(BalancesHiddenContext.Provider, { value: false }, h(UpcomingRow, { model: { ...model, savingsNote: undefined }, treatment: "current", onOpen() {}, onDismiss() {} })));
assert.match(calm, /May not go through if the balance is tight/, "without the engine fact the existing calm line is unchanged");

// 6. Copy rules: no em or en dashes, British English, hedged, no button language.
for (const line of [NO_COVER, COVERED]) {
  assert.doesNotMatch(line, /[–—]/);
  assert.doesNotMatch(line, /\b(cancelled for you|paused for you|Move now|Pause it|Cancel it)\b/);
}
assert.match(NO_COVER, /pause or cancel the standing order with your bank for this month/);
console.log("g422 savings at risk: ok");
