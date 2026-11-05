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

// The card renders the rows and masks the amounts under Hide balances.
function render(hidden) {
  return renderToStaticMarkup(h(BalancesHiddenContext.Provider, { value: hidden }, h(UpcomingAccountsCard, { accounts: [two], periodLabel: "this pay period", onOpen() {}, plans, plansStatus: "ready" })));
}
const shown = render(false);
assert.match(shown, /data-move-rows/);
assert.match(shown, /Your Barclays account/);
assert.match(shown, /Starling Personal/);
assert.doesNotMatch(shown, /RAW HOLDER NAME/);
const masked = render(true);
assert.match(masked, /data-move-rows/);
const rowsMarkup = masked.slice(masked.indexOf("data-move-rows"), masked.indexOf("data-move-rows") + 900);
assert.doesNotMatch(rowsMarkup, /£200|£70/, "row amounts are masked");

console.log("g421-cover-rows: ok");
