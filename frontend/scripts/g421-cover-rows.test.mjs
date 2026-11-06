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
function render(hidden, account = two, sourceBanks) {
  return renderToStaticMarkup(h(BalancesHiddenContext.Provider, { value: hidden }, h(UpcomingAccountsCard, { accounts: [account], sourceBanks, periodLabel: "this pay period", onOpen() {}, plans, plansStatus: "ready" })));
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

// G429: metadata identifies sources absent from the account list, including
// savings. It never chooses, renames, reorders or recalculates a suggested move.
const decorated = render(false, two, { a: "Barclays", b: "Starling", unused: "Monzo" });
const sourceMarkup = markup => markup.slice(markup.indexOf("data-move-rows"));
const visibleText = markup => markup.replace(/<[^>]*>/g, "");
assert.equal(visibleText(decorated), visibleText(shown), "metadata adds marks, not financial content");
assert.equal(decorated.match(/aria-label="([^"]*)"/)[1], shown.match(/aria-label="([^"]*)"/)[1], "the complete account-button label is unchanged");
assert.match(sourceMarkup(decorated), /data-source-bank="Barclays"[\s\S]*?src="\/banks\/barclays.png"/);
assert.match(sourceMarkup(decorated), /data-source-bank="Starling"[\s\S]*?src="\/banks\/starling.png"/);
assert.equal((decorated.match(/data-account-row=/g) ?? []).length, 1, "metadata never adds a listed account");
assert.doesNotMatch(decorated, /data-account-row="unused"|data-source-bank="Monzo"/);

// The savings flag disambiguates equal names. Only the visible source name
// gets G282 formatting, leaving the canonical name and accessible copy intact.
const sharedName = withLegs([
  leg("current", 200, "BARCLAYS PERSONAL GBP"),
  { ...leg("savings", 70, "BARCLAYS PERSONAL GBP"), savings: true },
]);
const sharedMarkup = render(false, sharedName, { current: "HSBC", savings: "Barclays" });
const sharedSources = sourceMarkup(sharedMarkup);
assert.match(sharedSources, /data-source-bank="HSBC"[\s\S]*?src="\/banks\/hsbc.png"/);
assert.match(sharedSources, /data-source-bank="Barclays"[\s\S]*?src="\/banks\/barclays.png"/);
assert.equal((sharedSources.match(/data-source-name="true">Barclays Personal GBP</g) ?? []).length, 2);
assert.match(sharedSources, /From savings, a suggestion/);
assert.deepEqual(accountMoveRows(suggestedMovesFor(sharedName)), [
  { name: "BARCLAYS PERSONAL GBP", amount: "£200" },
  { name: "BARCLAYS PERSONAL GBP", amount: "£70", savings: true },
], "canonical names, source order and amounts stay intact");
assert.doesNotMatch(render(true, sharedName, { current: "HSBC", savings: "Barclays" }), /£\d/, "all money is masked, including new rows and accessible names");

// Ambiguous, missing and grouped metadata use a neutral fallback rather than
// guessing a brand from a displayed name or a combined amount.
const ambiguous = withLegs([leg("a", 200, "Same name"), leg("b", 70, "Same name")]);
assert.doesNotMatch(sourceMarkup(render(false, ambiguous, { a: "Barclays", b: "HSBC" })), /data-source-bank=/);
assert.doesNotMatch(sourceMarkup(render(false, two)), /data-source-bank=|src="\/banks\//);
const grouped = sourceMarkup(render(false, seven, Object.fromEntries(Array.from({ length: 7 }, (_, i) => [`s${i}`, "Barclays"]))));
assert.equal((grouped.match(/data-source-bank=/g) ?? []).length, 1, "only an individually identified source gets a brand");
assert.match(grouped, /6 other accounts/);

console.log("g421-cover-rows: ok");
