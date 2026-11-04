import assert from "node:assert/strict";
import React, { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { BalancesHiddenContext } from "../lib/balancesHidden.tsx";
import UpcomingAccountsCard from "../components/upcoming/UpcomingAccountsCard.tsx";
import UpcomingAccountDetails from "../components/upcoming/UpcomingAccountDetails.tsx";
import { suggestedMovesFor, withCoverSuggestions } from "../lib/coverSuggestion.ts";
import { accountReading, accountSummaryMoney } from "../lib/upcomingAccountPresentation.ts";
import { statusFor } from "../lib/upcomingAccountStatus.ts";
import { accounts, allocationTotal, plans, PERIOD } from "./fixtures/g416-upcoming-account.ts";

// G416: the suggestion ledger is an explanatory view of authoritative account
// positions. It must not change the payment forecast or turn it into an event.
const fixtureAccounts = accounts.map((account) => ({ ...account, position: account.position && { ...account.position } }));
const enriched = withCoverSuggestions(fixtureAccounts, []);
const source = enriched.find((account) => account.id === "source");
const destination = enriched.find((account) => account.id === "destination");
assert.ok(source && destination);

// A newer cover record must not hide a larger still-known payment-walk gap.
const earlierGap = withCoverSuggestions([{ ...destination, shortfall: 500 }], [])[0];
assert.equal(earlierGap.coverSuggestion.shortAfterCover, 225);
assert.equal(statusFor(earlierGap, []).signal, "risk");

assert.deepEqual(source.suggestedMoves?.map(({ counterpartId, counterpartName, amount, byDate }) => ({ counterpartId, counterpartName, amount, byDate })), [
  { counterpartId: "destination", counterpartName: "NatWest", amount: -275, byDate: "2026-11-06" },
], "source earmark is an outgoing suggestion, dated from its receiver");
assert.deepEqual(destination.suggestedMoves?.map(({ counterpartId, counterpartName, amount, byDate }) => ({ counterpartId, counterpartName, amount, byDate })), [
  { counterpartId: "source", counterpartName: "Barclays", amount: 275, byDate: "2026-11-06" },
], "covered destination receives the paired suggestion");
assert.equal(source.events.length, 3, "suggested moves never become editable payment events");
assert.equal(source.events.reduce((sum, event) => sum + event.amount, 0), -528.21, "the server payment baseline remains untouched");
assert.equal((source.suggestedMoves ?? []).reduce((sum, move) => sum + move.amount, 0) + (destination.suggestedMoves ?? []).reduce((sum, move) => sum + move.amount, 0), 0, "paired suggestions net to zero across accounts");

// Duplicate legs coalesce by counterpart, and absent modern earmarks are not
// replaced with old move-card values.
const duplicate = {
  ...source,
  position: { ...source.position, earmarksOut: [
    { toAccountId: "destination", toName: "Bills account", amount: 250 },
    { toAccountId: "destination", toName: "Bills account", amount: 25 },
  ] },
};
assert.deepEqual(suggestedMovesFor(duplicate).map(({ counterpartId, amount }) => ({ counterpartId, amount })), [{ counterpartId: "destination", amount: -275 }]);
const noModernMark = { ...source, position: { ...source.position, earmarksOut: [] } };
assert.deepEqual(suggestedMovesFor(noModernMark), [], "an authoritative modern position never falls back to stale move items");

// Suggested legs are canonical money values: fractional pennies never become
// a transfer, but a legitimate 29p mark remains evidence.
for (const amount of [1.001, 0.005]) {
  const fractional = { ...source, suggestedMoves: undefined, position: { ...source.position, earmarksOut: [{ toAccountId: "destination", toName: "Bills account", amount }] } };
  assert.deepEqual(suggestedMovesFor(fractional), [], `${amount}: fractional-penny modern leg is withheld`);
}
const pennyLeg = { ...source, suggestedMoves: undefined, position: { ...source.position, earmarksOut: [{ toAccountId: "destination", toName: "Bills account", amount: 0.29 }] } };
assert.deepEqual(suggestedMovesFor(pennyLeg).map(move => move.amount), [-0.29], "29p modern leg remains valid");
for (const malformed of [
  { toAccountId: {}, toName: "Bills account", amount: 275 },
  { toAccountId: "destination", toName: 4, amount: 275 },
  { toAccountId: null, toName: "Bills account", amount: 275 },
]) {
  const malformedSource = { ...source, suggestedMoves: undefined, position: { ...source.position, earmarksOut: [malformed] } };
  assert.doesNotThrow(() => suggestedMovesFor(malformedSource), "malformed outbound leg never throws");
  assert.deepEqual(suggestedMovesFor(malformedSource), [], "malformed outbound leg produces no suggested row");
}

// A fallback deadline belongs only to the matching live source-to-destination
// leg. A receiver's own first shortfall date wins when it exists.
const liveMove = (amount, byDate) => ({ type: "move", plan_dest: { account_id: "destination", needs_by_date: byDate }, moves: [{ amount, move_map: { from: { account_id: "source", name: "Current account" }, to: { account_id: "destination", name: "Bills account" } } }] });
const undatedDestination = { ...destination, firstShortDate: null, suggestedMoves: undefined };
const fallbackDated = withCoverSuggestions([source, undatedDestination], [liveMove(275, "2026-11-08")]);
assert.equal(fallbackDated.find(account => account.id === "source")?.suggestedMoves?.[0]?.byDate, "2026-11-08", "the matching live move supplies an otherwise unknown receiver deadline");
const wrongLeg = withCoverSuggestions([source, undatedDestination], [liveMove(274, "2026-11-08")]);
assert.equal(wrongLeg.find(account => account.id === "source")?.suggestedMoves?.[0]?.byDate, null, "a mismatched old amount cannot lend a deadline to a different move");
assert.equal(source.suggestedMoves?.[0]?.byDate, "2026-11-06", "receiver first shortfall remains the stronger deadline evidence");
const legacyDestination = { ...destination, position: undefined, suggestedMoves: undefined, coverSuggestion: undefined };
for (const amount of [1.001, 0.005]) {
  assert.equal(withCoverSuggestions([legacyDestination], [liveMove(amount, "2026-11-08")])[0].coverSuggestion, undefined, `${amount}: fractional-penny legacy leg is withheld`);
}
assert.equal(withCoverSuggestions([legacyDestination], [liveMove(0.29, "2026-11-08")])[0].coverSuggestion?.amount, 0.29, "29p legacy leg remains valid");

// Invalid modern data has no cover state or suggestion. Legacy Infinity is
// equally incapable of inventing a recommendation.
const invalidCovered = { ...destination, suggestedMoves: undefined, position: { ...destination.position, coveredByMove: { amount: Infinity, shortfall: 275, from: [{ accountId: "source", name: "Current account", amount: Infinity }] } } };
const inconsistentCovered = { ...destination, suggestedMoves: undefined, position: { ...destination.position, coveredByMove: { amount: 275, shortfall: 275, from: [{ accountId: "source", name: "Current account", amount: 274 }] } } };
for (const account of [invalidCovered, inconsistentCovered]) {
  const resolved = withCoverSuggestions([account], [])[0];
  assert.equal(resolved.coverSuggestion, undefined, "invalid or inconsistent modern cover data is not actionable");
  assert.deepEqual(resolved.suggestedMoves, [], "invalid or inconsistent modern cover data has no suggested row");
}
const legacyInfinity = { ...destination, position: undefined, suggestedMoves: undefined, coverSuggestion: undefined };
assert.equal(withCoverSuggestions([legacyInfinity], [liveMove(Infinity, "2026-11-08")])[0].coverSuggestion, undefined, "legacy Infinity cannot create a cover state");

const sourceReading = accountReading(source, plans, "ready");
const destinationReading = accountReading(destination, plans, "ready");
const monzoReading = accountReading(enriched.find((account) => account.id === "monzo"), plans, "ready");
assert.equal(sourceReading.available, 42503, "£722.29 less £22.26 plan and £275 earmark is conditional £425.03");
assert.equal(destinationReading.available, 0, "the incoming £275 neutralises the destination's £275 payment gap");
assert.equal(monzoReading.result.planGap, 7525, "plans-only Monzo gap retains exact pennies");
assert.equal(monzoReading.status.amount, 75.25, "the caution wording retains its signed-pounds amount");
assert.equal(enriched.reduce((sum, account) => sum + (accountReading(account, plans, "ready").available ?? 0), 0) / 100, allocationTotal, "all Available shares reconcile to £497.46");
assert.equal(enriched.reduce((sum, account) => sum + Math.round((account.position?.afterPaymentsAndPlans ?? 0) * 100), 0) / 100, allocationTotal, "authoritative after-plans positions also reconcile to £497.46 without deducting Monzo twice");
assert.equal(accountSummaryMoney(42503), "£425");
assert.equal(accountSummaryMoney(49), "£0.49", "a non-zero positive sub-pound keeps its sign in compact summaries");
assert.equal(accountSummaryMoney(-49), "−£0.49", "a non-zero negative sub-pound keeps its sign in compact summaries");
assert.equal(accountSummaryMoney(0), "£0");

const card = (hidden = false, plansStatus = "ready") => renderToStaticMarkup(h(BalancesHiddenContext.Provider, { value: hidden }, h(UpcomingAccountsCard, {
  accounts: enriched, plans, plansStatus, periodLabel: PERIOD, onOpen() {},
})));
const sourceSheet = (hidden = false, plansStatus = "ready") => renderToStaticMarkup(h(BalancesHiddenContext.Provider, { value: hidden }, h(UpcomingAccountDetails, {
  account: source, plans, plansStatus, periodLabel: PERIOD,
})));
const destinationSheet = (hidden = false) => renderToStaticMarkup(h(BalancesHiddenContext.Provider, { value: hidden }, h(UpcomingAccountDetails, {
  account: destination, plans, plansStatus: "ready", periodLabel: PERIOD,
})));

const text = (markup) => markup.replace(/<[^>]+>/g, "").replace(/&amp;/g, "&");
const row = (markup, id) => {
  const start = markup.indexOf(`data-account-row="${id}"`);
  const end = markup.indexOf('data-account-row="', start + 1);
  return markup.slice(start, end < 0 ? undefined : end);
};
let html = card();
assert.match(html, /data-g417-variant="a"/);
assert.match(text(row(html, "source")), /£700Left after plans/, "the list leads with the pre-move after-plans result, not its pooled allocation");
assert.match(row(html, "source"), /aria-label="[^"]*(suggested move|set aside)/i, "the detailed recommended debit remains available to assistive technology");
assert.doesNotMatch(html, /Available|Spend from/, "G417 removes pooled-availability language from Upcoming");
assert.ok(html.indexOf('data-account-row="destination"') < html.indexOf('data-account-row="monzo"'), "payment risk leads before the plans caution");
assert.match(html, /2 accounts are fine/, "two fine accounts remain in the remembered fold");
assert.match(html, /data-fine-region="true" inert="" class="grid[^\"]*grid-rows-\[0fr\]/, "the closed fine group stays inert at 0fr");

html = sourceSheet();
for (const label of ["After payments and plans", "Balance after the suggested move", "How this adds up", "Still to set aside", "Payments & income"]) assert.ok(text(html).includes(label), `sheet includes ${label}`);
assert.ok(html.indexOf("data-pre-move") < html.indexOf("data-after-move") && html.indexOf("data-after-move") < html.indexOf("data-g417-working") && html.indexOf("data-g417-working") < html.indexOf("Still to set aside") && html.indexOf("Still to set aside") < html.indexOf("Payments &amp; income"), "approved A reads the pre-move result, then the separate move effect and working");
assert.match(html, /data-g417-account/);
assert.doesNotMatch(html, /Spend from|Available/);
assert.match(html, /data-suggested-move=/, "suggested move has a separate non-payment row");
assert.match(html, /data-suggested-bridge=/, "the move effect is separately bridged before activity");
assert.doesNotMatch(html, /data-flow-focus="event-[^"]*suggest/, "suggested move never opens a payment editor");
assert.match(text(html), /£700\.03/, "the pre-move ledger retains exact authoritative pence");
assert.match(text(destinationSheet()), /Suggested/, "the receiver shows its corresponding Suggested row");
assert.ok(text(html).indexOf("After payments and plans£700.03") < text(html).indexOf("If you make the suggested move£425.03"), "conditional working starts from authoritative after-plans and applies the recommendation once");
const authoritativeDifference = { ...source, position: { ...source.position, afterPayments: 700, lowPoint: 700, afterPaymentsAndPlans: 677.74, lowPointAndPlans: 677.74, spendFrom: 402.74 } };
const differenceSheet = renderToStaticMarkup(h(BalancesHiddenContext.Provider, { value: false }, h(UpcomingAccountDetails, { account: authoritativeDifference, plans, plansStatus: "ready", periodLabel: PERIOD })));
assert.match(text(differenceSheet), /Forecast difference/, "the ledger names a disagreement between listed cashflow and authoritative After payments");
const cardRepaymentGap = { ...destination, shortfall: 25, shortFor: { label: "World Mastercard repayment", date: "2026-11-06", cardRepayment: true }, position: { ...destination.position, afterPayments: -80, lowPoint: -80, afterPaymentsAndPlans: -80, lowPointAndPlans: -80 } };
const cardRepaymentSheet = renderToStaticMarkup(h(BalancesHiddenContext.Provider, { value: false }, h(UpcomingAccountDetails, { account: cardRepaymentGap, plans: [], plansStatus: "ready", periodLabel: PERIOD })));
assert.match(text(cardRepaymentSheet), /£80 short for the World Mastercard repayment/, "card-repayment copy uses the larger authoritative payment gap");
assert.doesNotMatch(text(cardRepaymentSheet), /£25 short for/, "card-repayment copy never understates the authoritative gap");

for (const status of ["loading", "error"]) {
  const unavailableCard = card(false, status);
  assert.match(unavailableCard, /Figures show payments only/);
  assert.match(text(row(unavailableCard, "source")), /£722Left after payments/, `${status}: authoritative payment baseline remains visible`);
  assert.match(unavailableCard, /Figures show payments only/, `${status}: plans remain explicitly qualified outside the row`);
  assert.doesNotMatch(unavailableCard, /data-suggested-bridge|data-suggested-move/, `${status}: recommendation rows are suppressed`);
  const unavailableSheet = sourceSheet(false, status);
  assert.match(text(unavailableSheet), /After payments/, `${status}: the sheet retains the payment baseline`);
  assert.doesNotMatch(unavailableSheet, /data-suggested-bridge|data-suggested-move/, `${status}: the sheet suppresses recommendation rows`);
}

// The approved A sheet masks every money value, including actual events and
// accessible labels. The normal upcoming payment flows keep their B55 rule.
const hiddenSheet = sourceSheet(true);
assert.doesNotMatch(hiddenSheet, /£\d/, "hidden account sheet exposes no raw amount in visible or hidden DOM");
assert.match(hiddenSheet, /£••••/);
assert.doesNotMatch(hiddenSheet, /425\.03|722\.29|275\.00|22\.26/, "every new ledger, suggestion and event amount is masked");

const preciseMoveSource = { ...source, suggestedMoves: undefined, position: { ...source.position, earmarkedTotal: 13.49, earmarksOut: [{ toAccountId: "destination", toName: "NatWest", amount: 13.49 }] } };
const preciseMoveHtml = renderToStaticMarkup(h(BalancesHiddenContext.Provider, { value: false }, h(UpcomingAccountDetails, { account: preciseMoveSource, plans, plansStatus: "ready", periodLabel: PERIOD })));
const preciseActivity = preciseMoveHtml.match(/<li data-suggested-move[^>]*>([\s\S]*?)<\/li>/)?.[1] ?? "";
assert.match(text(preciseActivity), /−£13\.49/, "a transfer recommendation never rounds away pence needed to make the move");
console.log("G416 upcoming-account: authoritative suggestions, compact availability, sheet hierarchy and masking passed");
