// G426: an unfunded own-savings standing order is handled whether or not other
// items on its account are short, and whether it is due yet or not. The card
// names the savings transfer separately from the payments, offers "Let it skip
// this month", and the generic "may stay put" line is left for a move into
// another own spendable account. Amber, hedged, no em dashes, British English.
import assert from "node:assert/strict";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Landmark } from "lucide-react";
import { MoveCard } from "../components/HomeBrief.tsx";
import UpcomingRow from "../components/upcoming/UpcomingRow.tsx";
import UpcomingRowDetails from "../components/upcoming/UpcomingRowDetails.tsx";
import { canDismissUpcomingOccurrence } from "../lib/upcomingAttention.ts";
import { accountActionNote } from "../lib/upcomingAccountPresentation.ts";
import { walkUpcomingAccounts, upcomingAccountAssessment } from "../lib/upcomingAccountWalk.ts";
import { getUpcomingStatus } from "../lib/upcomingAttention.ts";
import { BalancesHiddenContext } from "../lib/balancesHidden.tsx";

const NOTE = "Savings at risk. A suggested move from Monzo Current would cover it. Nothing has been moved.";
const render = (node, hidden = false) => renderToStaticMarkup(h(BalancesHiddenContext.Provider, { value: hidden }, node));

// 1. Combined card: one payment and one savings transfer share one move; the savings row can be let skip.
const item = {
  id: "plan-bc", type: "move", headline: "Move £260 to Barclays", amount: 260, covered: true, sources_safe: true,
  savings_at_risk: { amount: 250, covered: 250, no_cover: false, note: NOTE, orders: [{ name: "STO SAVER", label: "Saver", amount: 300, expected_date: "2026-11-26", to_name: "Saver" }] },
  moves: [{ amount: 260, headline: "Move £260", move_map: { from: { account_id: "mz", name: "Monzo", provider: "monzo", balance: 500 }, to: { account_id: "bc", name: "Barclays", provider: "barclays", balance: 150 } } }],
  plan_dest: {
    account_id: "bc", name: "Barclays", provider: "barclays", balance: 150, needs_total: 400, needs_by: "Tue 24 Nov",
    bills: [
      { label: "Phone", amount: 100, expected_date: "2026-11-28" },
      { label: "Saver", amount: 300, expected_date: "2026-11-26", key: "STO SAVER", can_skip: true, savings: true },
    ],
  },
};
const html = render(h(MoveCard, { item, hideNetWorth: false, maskAmounts: t => t, previewMode: true }));
assert.ok(html.includes("includes savings"), "the card says savings are in the move");
assert.ok(html.includes("Covers the payments and the savings transfer"));
assert.ok(html.includes("Let it skip this month"), "the savings row offers the skip");
assert.ok(html.includes("Protects 1 payment and a savings transfer"), "payments and savings are named separately");
assert.ok(!html.includes("Protects 2 payments"));
assert.ok(!/text-red-/.test(html), "never red");
assert.ok(!/stay put/.test(html));

// 2. Savings only: the one order is a "Savings transfer", skippable.
const only = { ...item, plan_dest: { ...item.plan_dest, bills: [item.plan_dest.bills[1]] } };
const onlyHtml = render(h(MoveCard, { item: only, hideNetWorth: false, maskAmounts: t => t, previewMode: true }));
assert.ok(onlyHtml.includes("Savings transfer due") || onlyHtml.includes("Savings transfer was due"));
assert.ok(onlyHtml.includes("Let it skip this month"));
assert.ok(onlyHtml.includes("For savings this pay period"));

// 3. The Upcoming row sheet uses the plain wording; the generic line stays for another case.
const model = {
  rowKey: "bill-sto", type: "bill", name: "Saver", amount: 300, expectedDate: "2026-11-26", accountLabel: "Barclays",
  category: "Transfer", categoryColour: "#64748b", CategoryIcon: Landmark, isMovement: true,
  after: { kind: "balance", value: -150 }, movementCalm: true, unfundedMovement: true, savingsNote: NOTE,
};
const sheet = render(h(UpcomingRowDetails, { model }));
assert.ok(sheet.includes(NOTE));
assert.doesNotMatch(sheet, /may stay put/);
const generic = render(h(UpcomingRowDetails, { model: { ...model, savingsNote: undefined } }));
assert.match(generic, /may stay put/, "a move into another own account keeps the generic line");

// 4. A not-yet-due savings row can be let skip; an ordinary not-yet-due movement cannot.
assert.equal(canDismissUpcomingOccurrence(model), true);
assert.equal(canDismissUpcomingOccurrence({ ...model, savingsNote: undefined }), false);

// 5. The account list note carries the engine sentence, not "may stay put".
const reading = { result: { assigned: [] }, ready: true, combinedKnown: true, headline: -15000, gap: 150, paymentGap: 0, earlierGap: false, moves: [], incoming: 0, outgoing: 0, signal: "move", futureIncome: false, transferGap: 150 };
const note = accountActionNote({ position: { savingsAtRisk: { note: NOTE } } }, reading);
assert.equal(note, NOTE);
assert.match(accountActionNote({}, reading), /may stay put/);

// 6. Review fixes: a bill that bounces only because the savings order went first is amber, not at risk.
const END = Date.parse("2026-11-27T00:00:00Z");
const bill = (over) => ({
  name: "x", amount: 10, expected_date: "2026-11-24", days_away: 1, account_id: "cur", account_name: "Current", account_bank: "Barclays",
  account_balance: 150, is_credit_card: false, category: "Bills", kind: "commitment", pending: false, observed_pending: false, ...over,
});
const order = bill({ name: "STO SAVER", amount: 300, expected_date: "2026-11-24", kind: "movement", category: "Transfer", dest_account_id: "sav", dest_account_spendable: false });
const phone = bill({ name: "PHONE", amount: 100, expected_date: "2026-11-25" });
const gas = bill({ name: "GAS", amount: 200, expected_date: "2026-11-26" });
{
  // 150 - 300 = -150, -250 after Phone: Phone clears on its own (150 - 100), so it is savings at risk.
  const walk = walkUpcomingAccounts({ upcoming_bills: [order, phone], upcoming_income: [], internal_inflows: [] }, END);
  assert.equal(walk.atRisk.length, 0, "a cascaded bill is not at risk");
  assert.equal(walk.accounts[0].status, "unfunded", "the account reads amber, not short");
  const row = upcomingAccountAssessment(phone, walk);
  assert.equal(row.atRisk, false);
  assert.equal(row.accountShort, false);
  assert.equal(row.coverage.savingsOnly, true);
  const status = getUpcomingStatus({ type: "bill", name: "PHONE", amount: 100, expectedDate: "2026-11-25", ...row });
  assert.equal(status.tone, "caution");
  assert.equal(status.label, "short if the savings transfer leaves first");
  // With Gas too: Gas is 150 - 100 - 200 = -150 on its own, so it is a payment at risk; Phone is still amber.
  const both = walkUpcomingAccounts({ upcoming_bills: [order, phone, gas], upcoming_income: [], internal_inflows: [] }, END);
  assert.deepEqual(both.atRisk.map((b) => b.name), ["GAS"]);
  assert.equal(both.accounts[0].status, "short");
  // A card repayment is never exempted.
  const repay = bill({ name: "CARD", amount: 100, expected_date: "2026-11-25", kind: "movement", is_card_repayment: true });
  const rw = walkUpcomingAccounts({ upcoming_bills: [order, repay], upcoming_income: [], internal_inflows: [] }, END);
  assert.equal(rw.atRisk.length, 1);
}

// 7. The skip hint and the pending-row wording.
assert.ok(html.includes("Only stops Sorted planning for it this month. Your bank still decides."));
assert.ok(sheet.includes("Only stops Sorted planning for it this month. Your bank still decides."));
const pendingRow = render(h(UpcomingRow, { model: { ...model, pending: true, expectedDate: "2026-11-20" }, treatment: "current", onOpen() {}, onDismiss() {}, onSkipOccurrence() {} }));
assert.ok(pendingRow.includes("Let it skip this month"));
assert.ok(!pendingRow.includes("may not have the funds"), "no duplicate amber line when the savings note is present");

for (const line of [NOTE]) assert.doesNotMatch(line, /[–—]/);
console.log("g426 savings order any shape: ok");
