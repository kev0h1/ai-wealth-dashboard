// G421: a suggested cover reads as short rows (name and amount, at most two),
// never an and-chain, uses the engine's G337 labels, and masks under Hide balances.
import assert from "node:assert/strict";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { accountActionNote, accountActionReading, accountMoveRows } from "../lib/upcomingAccountPresentation.ts";
import { suggestedMovesFor } from "../lib/coverSuggestion.ts";
import { BalancesHiddenContext } from "../lib/balancesHidden.tsx";
import UpcomingAccountsCard from "../components/upcoming/UpcomingAccountsCard.tsx";
import { accounts, plans } from "./fixtures/g417-upcoming-shortfall.ts";

const base = accounts.find((a) => a.id === "natwest");
function withLegs(from) {
  const total = from.reduce((s, f) => s + f.amount, 0);
  return { ...base, suggestedMoves: undefined, position: { ...base.position, coveredByMove: { amount: total, shortfall: total, from }, shortAfterCover: 0, earmarksOut: [] } };
}
const leg = (id, amount, label, name = "RAW HOLDER NAME") => ({ accountId: id, name, amount, ...(label ? { label } : {}) });

// Two sources, engine labels used and raw holder text never shown.
const two = withLegs([leg("a", 200, "your Barclays account"), leg("b", 70, "Starling Personal")]);
const moves = suggestedMovesFor(two);
assert.deepEqual(moves.map((m) => m.counterpartName), ["your Barclays account", "Starling Personal"]);
const rows = accountMoveRows(moves);
assert.deepEqual(rows, [{ name: "Your Barclays account", amount: "£200" }, { name: "Starling Personal", amount: "£70" }]);

// An older payload with seven sources: the largest plus one combined row, never seven.
const seven = withLegs(Array.from({ length: 7 }, (_, i) => leg(`s${i}`, 10 + i, `Bank ${i} account`)));
const sevenRows = accountMoveRows(suggestedMovesFor(seven));
assert.equal(sevenRows.length, 2);
assert.equal(sevenRows[1].name, "6 other accounts");
assert.equal(sevenRows[0].amount, "£16");

// The note has no and-chain of sources.
const reading = accountActionReading(two, plans, "ready");
const note = accountActionNote(two, reading);
assert.doesNotMatch(note, / and /, note);
assert.doesNotMatch(note, /RAW HOLDER NAME/);
assert.match(note, /^A £270 move covers it\./);

// G430 keeps all source working in the account sheet. By account now has one
// quiet aggregate summary, never source names, amounts or bank marks.
function render(hidden, account = two) {
  return renderToStaticMarkup(h(BalancesHiddenContext.Provider, { value: hidden }, h(UpcomingAccountsCard, { accounts: [account], periodLabel: "this pay period", onOpen() {}, plans, plansStatus: "ready" })));
}
const shown = render(false);
assert.match(shown, /data-account-summary/);
assert.match(shown.replace(/<[^>]+>/g, ""), /£270 to move in/);
assert.doesNotMatch(shown, /data-move-rows|data-source-bank|data-source-name|data-savings-source/);
assert.doesNotMatch(shown, /Your Barclays account|Starling Personal/);
assert.doesNotMatch(shown, /RAW HOLDER NAME/);
const masked = render(true);
assert.match(masked, /data-account-summary/);
assert.doesNotMatch(masked, /£270|£200|£70/, "the aggregate summary is masked");

// The engine's source rows remain available to the detail sheet, but not to
// this compact account card. This preserves the canonical engine detail while
// preventing a source-account breakdown from leaking back into By account.
const sharedName = withLegs([
  leg("current", 200, "BARCLAYS PERSONAL GBP"),
  { ...leg("savings", 70, "BARCLAYS PERSONAL GBP"), savings: true },
]);
const sharedMarkup = render(false, sharedName);
assert.match(sharedMarkup, /data-account-summary/);
assert.doesNotMatch(sharedMarkup, /data-move-rows|data-source-bank|data-source-name|data-savings-source|From savings, a suggestion/);
assert.doesNotMatch(sharedMarkup, /Barclays Personal GBP/);
assert.deepEqual(accountMoveRows(suggestedMovesFor(sharedName)), [
  { name: "BARCLAYS PERSONAL GBP", amount: "£200" },
  { name: "BARCLAYS PERSONAL GBP", amount: "£70", savings: true },
], "canonical names, source order and amounts stay intact");
assert.doesNotMatch(render(true, sharedName), /£\d/, "all card money and accessible labels are masked");

console.log("g421-cover-rows: ok");
