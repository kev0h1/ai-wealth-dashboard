// G428: when current accounts cannot cover a shortfall, one savings account is
// suggested for the rest, named in plain words (a recommendation, never an
// action), shown after the current sources; an uncovered remainder is stated
// plainly with the edit-a-plan and skip-a-payment options.
import assert from "node:assert/strict";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { accountActionNote, accountActionReading, accountCoverLine, accountMoveRows } from "../lib/upcomingAccountPresentation.ts";
import { suggestedMovesFor } from "../lib/coverSuggestion.ts";
import { coverSplitSentence, uncoveredSentence } from "../lib/coverNarrative.ts";
import { accountAvailability } from "../lib/accountAvailability.ts";
import { BalancesHiddenContext } from "../lib/balancesHidden.tsx";
import UpcomingAccountsCard from "../components/upcoming/UpcomingAccountsCard.tsx";
import { accounts, plans } from "./fixtures/g417-upcoming-shortfall.ts";

const base = accounts.find((a) => a.id === "natwest");
function withLegs(from, shortfall = 259) {
  const total = from.reduce((s, f) => s + f.amount, 0);
  return { ...base, suggestedMoves: undefined, position: { ...base.position, coveredByMove: { amount: total, shortfall, from }, shortAfterCover: Math.max(0, shortfall - total), earmarksOut: [] } };
}
const leg = (id, amount, label, savings = false) => ({ accountId: id, name: "RAW", amount, label, ...(savings ? { savings: true } : {}) });

// Shared sentences (mirror the engine's wording).
assert.equal(coverSplitSentence({ currentAmount: 140, savingsAmount: 1050, savingsName: "Meadow Savings" }, 0), "Your other accounts can cover £140. A move of £1,050 from Meadow Savings would cover the rest.");
assert.equal(coverSplitSentence({ currentAmount: 0, savingsAmount: 500, savingsName: "Meadow Savings" }, 0), "A move of £500 from Meadow Savings would cover it.");
assert.match(coverSplitSentence({ currentAmount: 140, savingsAmount: 800, savingsName: "Meadow Savings" }, 249), /but £249 is still uncovered\. You could edit a plan or skip a payment on Upcoming instead\.$/);
assert.equal(uncoveredSentence(1049), "£1,049 is still uncovered. You could edit a plan or skip a payment on Upcoming instead.");
for (const text of [coverSplitSentence({ currentAmount: 1, savingsAmount: 2, savingsName: "X" }, 5), uncoveredSentence(5)]) assert.doesNotMatch(text, /—|–/);

// Savings covers the rest: rows are current first, savings last and flagged; the note names it.
const covered = withLegs([leg("a", 100, "your Barclays account"), leg("sv", 170, "Meadow Savings", true)]);
const moves = suggestedMovesFor(covered);
assert.deepEqual(moves.map((m) => [m.counterpartName, m.savings === true]), [["your Barclays account", false], ["Meadow Savings", true]]);
const rows = accountMoveRows(moves);
assert.deepEqual(rows, [{ name: "Your Barclays account", amount: "£100" }, { name: "Meadow Savings", amount: "£170", savings: true }]);
const reading = accountActionReading(covered, plans, "ready");
assert.equal(accountCoverLine(reading), "Your other accounts can cover £100. A move of £170 from Meadow Savings would cover the rest.");
assert.equal(accountActionNote(covered, reading), accountCoverLine(reading));

// Savings not enough: the plain uncovered line with the options.
const short = withLegs([leg("a", 100, "your Barclays account"), leg("sv", 80, "Meadow Savings", true)]);
const shortReading = accountActionReading(short, plans, "ready");
assert.match(accountCoverLine(shortReading), /Your other accounts can cover £100\. A move of £80 from Meadow Savings would cover more, but £79 is still uncovered\. You could edit a plan or skip a payment on Upcoming instead\./);

// Current accounts only, partly covered: the existing note stays and the plain uncovered line follows.
const partial = withLegs([leg("a", 100, "your Barclays account")]);
const partialNote = accountActionNote(partial, accountActionReading(partial, plans, "ready"));
assert.match(partialNote, /after the move, still short\./);
assert.match(partialNote, /£159 is still uncovered\. You could edit a plan or skip a payment/);

// The card renders the savings row flagged in the watch tone, and masks amounts when hidden.
function render(hidden) {
  return renderToStaticMarkup(h(BalancesHiddenContext.Provider, { value: hidden }, h(UpcomingAccountsCard, { accounts: [covered], periodLabel: "this pay period", onOpen() {}, plans, plansStatus: "ready" })));
}
const shown = render(false);
assert.match(shown, /data-savings-source/);
assert.match(shown, /From savings, a suggestion/);
assert.match(shown, /text-amber-800/);
assert.ok(shown.indexOf("Your Barclays account") < shown.lastIndexOf("Meadow Savings"), "savings listed after current accounts");
const masked = render(true);
const rowsMarkup = masked.slice(masked.indexOf("data-move-rows"), masked.indexOf("data-move-rows") + 1200);
assert.doesNotMatch(rowsMarkup, /£100|£170/, "row amounts are masked");

// Account sheet and Accounts list: the engine's split drives the note (server position shape).
const position = {
  after_payments: -259, low_point: -259, after_payments_and_plans: -259, low_point_and_plans: -259, plans_reserved: 0,
  uncertain: false, estimated: false, spend_from_headroom: 0, short_after_cover: 0,
  covered_by_move: { amount: 270, shortfall: 259, savings_amount: 170, current_amount: 100, from: [
    { account_id: "a", name: "Barclays Current", amount: 100 },
    { account_id: "sv", name: "Meadow Savings", amount: 170, source_kind: "savings" },
  ] },
};
const reading2 = accountAvailability(
  { id: "x", kind: "current", name: "Salary Current", status: "connected", currency: "GBP", subtype: "TRANSACTION", type: "bank", balance: 0, include_in_safe_to_spend: true },
  { status: "ready", positions: { x: position } },
);
assert.equal(reading2?.kind, "ready", JSON.stringify(reading2));
{
  assert.match(reading2.note, /Your other accounts can cover £100\. A move of £170 from Meadow Savings would cover the rest\./);
  assert.equal(reading2.coveredByMove.split.savingsName, "Meadow Savings");
}

console.log("g428-savings-cover: ok");
