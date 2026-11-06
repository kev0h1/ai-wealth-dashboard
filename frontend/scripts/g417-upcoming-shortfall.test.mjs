import assert from "node:assert/strict";
import React, { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { accountActionNote, accountActionReading } from "../lib/upcomingAccountPresentation.ts";
import { withCoverSuggestions } from "../lib/coverSuggestion.ts";
import { BalancesHiddenContext } from "../lib/balancesHidden.tsx";
import UpcomingAccountsCard from "../components/upcoming/UpcomingAccountsCard.tsx";
import UpcomingAccountDetails from "../components/upcoming/UpcomingAccountDetails.tsx";
import { accounts, plans, PRE_AND_POST_MOVE_TOTAL_PENCE } from "./fixtures/g417-upcoming-shortfall.ts";

const enriched = withCoverSuggestions(accounts.map(account => ({ ...account, position: { ...account.position } })), []);
const reading = (id, status = "ready") => accountActionReading(enriched.find(account => account.id === id), plans, status);

// The headline is the pre-move account gap, not Home's pooled Spend from.
const natwest = reading("natwest");
const barclays = reading("barclays");
const hsbc = reading("hsbc");
const monzo = reading("monzo");
assert.equal(natwest.headline, -25900, "NatWest shows its signed £259 payment gap, never its positive £11 spend allocation");
assert.equal(natwest.gap, 25900);
assert.equal(natwest.afterPlans, -25900);
assert.equal(natwest.afterMove, 1100, "the £270 recommendation is applied once to the authoritative baseline");
assert.equal(barclays.headline, 58200, "Barclays shows £582 after its £22.26 plan, never the pool-capped £312");
assert.equal(barclays.afterPayments, 60426);
assert.equal(barclays.afterPlans, 58200);
assert.equal(barclays.afterMove, 31200, "the paired £270 debit is applied exactly once");
assert.equal(hsbc.headline, -4500, "uncovered payment risk stays visible");
assert.equal(monzo.headline, -4649, "plans-only gap keeps its 49p");
assert.equal(monzo.paymentGap, 0);
assert.equal(monzo.caption, "Short");

assert.equal(enriched.reduce((sum, account) => sum + (accountActionReading(account, plans, "ready").afterPlans ?? 0), 0), PRE_AND_POST_MOVE_TOTAL_PENCE, "authoritative pre-move account figures reconcile");
assert.equal(enriched.reduce((sum, account) => sum + (accountActionReading(account, plans, "ready").afterMove ?? accountActionReading(account, plans, "ready").afterPlans ?? 0), 0), PRE_AND_POST_MOVE_TOTAL_PENCE, "paired recommendations preserve the total after moves");
assert.equal(natwest.incoming, 27000);
assert.equal(barclays.outgoing, 27000);
assert.deepEqual(natwest.moves.map(move => move.amount), [270]);
assert.deepEqual(barclays.moves.map(move => move.amount), [-270]);
assert.equal(enriched.find(account => account.id === "barclays").events.reduce((sum, event) => sum + event.amount, 0), -528.21, "recommendations remain outside editable payment events");

// A payment deadline can be earlier than a positive closing balance. That risk
// must lead, and partial cover must not erase it.
const earlier = {
  ...accounts[0], shortfall: 64, firstShortDate: "2026-11-06", closing: 90,
  position: { ...accounts[0].position, afterPayments: 90, lowPoint: -64, afterPaymentsAndPlans: 90, lowPointAndPlans: -64, coveredByMove: { amount: 150, shortfall: 64, from: [{ accountId: "barclays", name: "Current account", amount: 150 }] } },
};
const earlierReading = accountActionReading(withCoverSuggestions([earlier], [])[0], [], "ready");
assert.equal(earlierReading.headline, -6400);
assert.equal(earlierReading.earlierGap, true);
assert.equal(earlierReading.caption, "Short before payday");
const partial = {
  ...accounts[0],
  position: { ...accounts[0].position, coveredByMove: { amount: 150, shortfall: 259, from: [{ accountId: "barclays", name: "Current account", amount: 150 }] }, shortAfterCover: 109 },
};
const partialReading = accountActionReading(withCoverSuggestions([partial], [])[0], [], "ready");
assert.equal(partialReading.remainingGap, 10900, "a £150 move leaves the £109 payment gap explicit");
assert.equal(partialReading.signal, "risk");

// Uncertain plan overlap with a known negative payment position stays unknown
// as a combined total but must retain the concrete payment warning.
const overlap = { ...accounts[3], status: "short", shortfall: 45, firstShortDate: "2026-11-08", position: { ...accounts[3].position, afterPayments: -45, lowPoint: -45, uncertain: true, afterPaymentsAndPlans: null, lowPointAndPlans: null, spendFrom: null } };
const overlapReading = accountActionReading(overlap, plans, "ready");
assert.equal(overlapReading.afterPlans, null);
assert.equal(overlapReading.headline, -4500);
assert.equal(overlapReading.paymentGap, 4500);
assert.equal(overlapReading.signal, "risk");

// Server positions decide all headline arithmetic even where the event walk
// disagrees. Loading and error retain that payment baseline but omit plan and
// recommendation conclusions.
const disagreement = { ...accounts[1], closing: 999, position: { ...accounts[1].position, afterPayments: 500, lowPoint: 500, afterPaymentsAndPlans: 477.74, lowPointAndPlans: 477.74, spendFrom: 1 } };
assert.equal(accountActionReading(disagreement, plans, "ready").headline, 47774);
for (const status of ["loading", "error"]) {
  const pending = accountActionReading(enriched.find(account => account.id === "barclays"), plans, status);
  assert.equal(pending.headline, 60426, `${status}: authoritative payment baseline remains`);
  assert.equal(pending.afterPlans, null, `${status}: no plan result is asserted`);
  assert.deepEqual(pending.moves, [], `${status}: no recommendation row is asserted`);
}

// An old cover sentence is not authority on its own: a healthy legacy account
// must not acquire a fabricated recommendation, adjusted total, or move copy.
const staleLegacyCover = {
  ...accounts[4], position: undefined, coverSuggestion: { amount: 20, shortfall: 20, fromName: "Old account", fromCount: 1, shortAfterCover: 0 },
};
const staleReading = accountActionReading(staleLegacyCover, [], "ready");
assert.deepEqual(staleReading.moves, []);
assert.equal(staleReading.afterMove, null);
assert.equal(staleReading.headline, 3203);
assert.doesNotMatch(accountActionNote(staleLegacyCover, staleReading), /move|set aside/i, "a stale healthy legacy sentence cannot promote itself into an action");

// The same guard applies to modern positions: an incoming leg cannot create a
// move for an account whose full pre-move result is already healthy. Outgoing
// earmarks remain a separate, real commitment (covered above).
const staleModernCover = {
  ...accounts[4],
  position: { ...accounts[4].position, coveredByMove: { amount: 20, shortfall: 20, from: [{ accountId: "barclays", name: "Current account", amount: 20 }] }, shortAfterCover: 0 },
};
const staleModernReading = accountActionReading(staleModernCover, [], "ready");
assert.deepEqual(staleModernReading.moves, []);
assert.equal(staleModernReading.afterMove, null);

// A positive payment close does not suppress a genuine plans-only gap. Its
// incoming modern cover remains visible and reaches a valid conditional total.
const plansOnlyCover = {
  ...accounts[3],
  position: { ...accounts[3].position, coveredByMove: { amount: 50, shortfall: 46.49, from: [{ accountId: "barclays", name: "Current account", amount: 50 }] }, shortAfterCover: 0 },
};
const plansOnlyReading = accountActionReading(withCoverSuggestions([plansOnlyCover], [])[0], plans, "ready");
assert.deepEqual(plansOnlyReading.moves.map(move => move.amount), [50]);
assert.equal(plansOnlyReading.afterPlans, -4649);
assert.equal(plansOnlyReading.afterMove, 351);

const wrap = (hidden, view) => renderToStaticMarkup(h(BalancesHiddenContext.Provider, { value: hidden }, view));
const card = wrap(false, h(UpcomingAccountsCard, { accounts: enriched, plans, plansStatus: "ready", periodLabel: "Payments through Sun 29 Nov", onOpen() {} }));
const sheet = (account, hidden = false, status = "ready") => wrap(hidden, h(UpcomingAccountDetails, {
  account, plans, plansStatus: status, periodLabel: "Payments through Sun 29 Nov", onPlan() {}, onEvent() {}, editableEventIds: new Set(account.events.map(event => event.id)),
}));
const text = (markup) => markup.replace(/<[^>]+>/g, "").replace(/&amp;/g, "&");
const row = (markup, id) => {
  const start = markup.indexOf(`data-account-row="${id}"`);
  const end = markup.indexOf("data-account-row=", start + 1);
  return markup.slice(start, end < 0 ? undefined : end);
};

// Rendered A makes the account's action gap visible before any move, while
// leaving Home's spend allocation out of both list and sheet.
assert.match(card, /data-g417-variant="a"/);
assert.match(text(row(card, "natwest")), /−£259Short/);
assert.match(text(row(card, "barclays")), /£582Left after plans/);
assert.doesNotMatch(card, /Available|Spend from/);
const natwestSheet = sheet(enriched.find(account => account.id === "natwest"));
const barclaysSheet = sheet(enriched.find(account => account.id === "barclays"));
assert.match(natwestSheet, /data-g417-account="natwest"/);
assert.match(natwestSheet, /data-pre-move[^>]*>.*?−£259/s);
assert.match(natwestSheet, /data-after-move[^>]*>.*?£11/s);
assert.match(barclaysSheet, /data-pre-move[^>]*>.*?£582/s);
assert.match(barclaysSheet, /data-after-move[^>]*>.*?£312/s);
assert.doesNotMatch(barclaysSheet, /data-suggested-bridge=/, "G427 keeps the move in activity without a duplicate beneath the balance");
assert.match(barclaysSheet, /<li data-suggested-move=/);
assert.doesNotMatch(barclaysSheet, /data-flow-focus="event-[^"]*suggest/, "recommendations never become editable payment events");
assert.match(barclaysSheet, /data-flow-focus="event-council"/, "actual payment callbacks remain available");
assert.match(barclaysSheet, /data-flow-focus="plan-barclays-plan"/, "actual plan callbacks remain available");

// Pending states preserve the server payment baseline and risk, but withhold
// full-plan and recommendation conclusions.
for (const status of ["loading", "error"]) {
  const pendingCard = wrap(false, h(UpcomingAccountsCard, { accounts: enriched, plans, plansStatus: status, periodLabel: "Payments through Sun 29 Nov", onOpen() {} }));
  const pendingSheet = sheet(enriched.find(account => account.id === "natwest"), false, status);
  assert.match(text(row(pendingCard, "natwest")), /−£259Short/);
  assert.doesNotMatch(pendingCard, /data-suggested-bridge|data-suggested-move/);
  assert.doesNotMatch(pendingSheet, /data-suggested-bridge|data-suggested-move/);
  assert.match(text(pendingSheet), /After payments/);
}

// Account-sheet hiding covers balances, event figures, recommendations, and
// their accessible labels, retaining the signed mask rather than a raw amount.
const hiddenBarclays = sheet(enriched.find(account => account.id === "barclays"), true);
assert.doesNotMatch(hiddenBarclays, /£\d/, "no account-sheet currency leaks when balances are hidden");
assert.match(hiddenBarclays, /−£••••/, "outgoing recommendation retains its masked sign");
assert.match(hiddenBarclays, /£••••/, "every account figure uses the balance mask");

// Inference remains visible in an otherwise fine account after its group is
// expanded. An accessible label alone must not imply a certain paying account.
const inferredFine = { ...accounts[1], position: { ...accounts[1].position, earmarksOut: [], earmarkedTotal: 0 } };
const inferredPlans = plans.map(plan => plan.sourceId === "barclays" ? { ...plan, evidence: "recent-transfers" } : plan);
assert.equal(accountActionReading(inferredFine, inferredPlans, "ready").signal, null);
const inferredCard = wrap(false, h(UpcomingAccountsCard, { accounts: [inferredFine], plans: inferredPlans, plansStatus: "ready", periodLabel: "This period", onOpen() {} }));
assert.match(text(inferredCard.replace(/\saria-label="[^"]*"/g, "")), /Paying account based on recent transfers\./, "the fine-row estimate qualifier exists in rendered content, not only aria");

console.log("G417: action-reading financial baselines, deadlines, uncertainty and paired moves passed");
