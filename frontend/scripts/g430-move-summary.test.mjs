// G430: By account shows one honest aggregate move summary. Account details
// remain the place for individual suggested sources and amounts.
import assert from "node:assert/strict";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { withCoverSuggestions } from "../lib/coverSuggestion.ts";
import { accountActionReading } from "../lib/upcomingAccountPresentation.ts";
import { accountMoveSummary, summaryDeadline } from "../lib/upcomingMoveSummary.ts";
import { BalancesHiddenContext } from "../lib/balancesHidden.tsx";
import UpcomingAccountsCard from "../components/upcoming/UpcomingAccountsCard.tsx";
import UpcomingAccountDetails from "../components/upcoming/UpcomingAccountDetails.tsx";
import { accounts, plans } from "./fixtures/g417-upcoming-shortfall.ts";

const enriched = withCoverSuggestions(accounts.map(account => ({ ...account, position: { ...account.position } })), []);
const byId = id => enriched.find(account => account.id === id);
const read = (id, status = "ready") => accountActionReading(byId(id), plans, status);
const render = (hidden, listed = enriched, status = "ready") => renderToStaticMarkup(
  h(BalancesHiddenContext.Provider, { value: hidden }, h(UpcomingAccountsCard, {
    accounts: listed, plans, plansStatus: status, periodLabel: "Payments through Sun 29 Nov", onOpen() {},
  })),
);
const row = (markup, id) => {
  const start = markup.indexOf(`data-account-row="${id}"`);
  const end = markup.indexOf("data-account-row=", start + 1);
  return markup.slice(start, end < 0 ? undefined : end);
};
const text = markup => markup.replace(/<[^>]+>/g, "").replace(/&amp;/g, "&");
const move = (id, amount, byDate) => ({ id, counterpartId: id, counterpartName: id, amount, byDate });
// Feed authoritative position legs through the real reading. Cached moves
// supply dates only; they cannot invent or change a live recommendation.
const withMoves = moves => {
  const base = byId("natwest");
  const incoming = moves.filter(item => item.amount > 0);
  const outgoing = moves.filter(item => item.amount < 0);
  return accountActionReading({
    ...base, firstShortDate: null,
    suggestedMoves: moves.map(item => ({ ...item, id: item.amount > 0 ? `suggested:${item.counterpartId}:${base.id}` : `suggested:${base.id}:${item.counterpartId}` })),
    position: {
      ...base.position, shortAfterCover: undefined,
      coveredByMove: incoming.length ? {
        amount: incoming.reduce((sum, item) => sum + item.amount, 0),
        from: incoming.map(item => ({ accountId: item.counterpartId, name: item.counterpartName, amount: item.amount })),
      } : undefined,
      earmarksOut: outgoing.map(item => ({ toAccountId: item.counterpartId, toName: item.counterpartName, amount: -item.amount })),
      earmarkedTotal: outgoing.reduce((sum, item) => sum - item.amount, 0),
    },
  }, plans, "ready");
};

// A cover's incoming total is the recommendation, not the pre-move headline
// gap. The card keeps the signed gap leading and names neither source.
const natwest = read("natwest");
assert.equal(natwest.headline, -25900);
assert.equal(natwest.incoming, 27000);
assert.equal(accountMoveSummary(byId("natwest"), natwest), "£270 to move in by 6 Nov");
const card = render(false);
const splitGroups = markup => {
  const at = markup.indexOf("data-fine-group");
  return at < 0 ? { lead: markup, folded: "" } : { lead: markup.slice(0, at), folded: markup.slice(at) };
};
const rowIds = markup => [...markup.matchAll(/data-account-row="([^"]+)"/g)].map(match => match[1]);
const groups = splitGroups(card);
assert.deepEqual(rowIds(groups.lead), ["hsbc", "natwest", "monzo"], "only real gaps lead, with payment risk first");
assert.deepEqual(rowIds(groups.folded), ["barclays", "fine-a", "fine-b"], "a healthy funding source folds with the other accounts");
assert.match(groups.folded, /3 accounts are fine/);
assert.match(groups.folded, /aria-expanded="false"/);
assert.match(groups.folded, /data-fine-region="true" inert="" class="grid[^\"]*grid-rows-\[0fr\]/);
assert.equal(natwest.remainingGap, 0, "even a fully suggested cover keeps its actual pre-move shortfall visible");
const natwestRow = row(card, "natwest");
assert.match(natwestRow, /−£259/);
assert.match(natwestRow, /data-account-summary/);
assert.match(text(natwestRow), /£270 to move in by 6 Nov/);
assert.doesNotMatch(natwestRow, /Current account|data-move-rows|data-source-bank|data-source-name|data-savings-source/);
const natwestLabel = natwestRow.match(/aria-label="([^"]*)"/)[1];
assert.match(natwestLabel, /£270 to move in by 6 Nov/);
assert.doesNotMatch(natwestLabel, /Current account|Move in:/, "the row's accessible name keeps the aggregate without source details");

// Meaningful pence survive in the single summary, and masking covers the
// summary and its canonical accessible row label.
const pence = withMoves([move("one", 140.29, "2026-11-09")]);
assert.equal(accountMoveSummary(byId("natwest"), pence), "£140.29 to move in by 9 Nov · £118.71 still uncovered");

// One shared valid incoming deadline is shown. Missing, mixed and invalid
// values withhold it; outgoing dates and account.firstShortDate do not supply
// an aggregate deadline.
const dateReading = withMoves([move("one", 140, "2026-11-09"), move("two", 35, "2026-11-09"), move("out", -20, "2026-11-28")]);
assert.equal(summaryDeadline(dateReading), "2026-11-09");
assert.match(accountMoveSummary(byId("natwest"), dateReading), /by 9 Nov/);
assert.equal(summaryDeadline({ ...natwest, moves: [move("invalid", 1, "2026-02-30")] }), null, "the presentation guard independently rejects rolled-over dates");
for (const dates of [[null, null], ["2026-11-09", null], ["2026-11-09", "2026-11-11"], ["2026-02-30", "2026-02-30"]]) {
  const candidate = withMoves([move("one", 140, dates[0]), move("two", 35, dates[1])]);
  assert.equal(summaryDeadline(candidate), null);
  assert.doesNotMatch(accountMoveSummary({ ...byId("natwest"), firstShortDate: "2026-12-25" }, candidate), /\bby\b/);
}

// Partial cover remains explicit after a paired outgoing earmark. A healthy
// source account carries no duplicated source or set-aside explanation.
const partial = withMoves([move("one", 140, "2026-11-09"), move("out", -20, "2026-11-30")]);
assert.equal(partial.remainingGap, 13900);
assert.equal(accountMoveSummary(byId("natwest"), partial), "£140 to move in by 9 Nov · £139 still uncovered");
const barclays = read("barclays");
assert.equal(barclays.outgoing, 27000);
assert.equal(accountMoveSummary(byId("barclays"), barclays), null);
assert.doesNotMatch(row(card, "barclays"), /data-account-summary|set aside for|Bills account/);
const sourceOnly = render(false, [byId("barclays")]);
assert.deepEqual(rowIds(splitGroups(sourceOnly).lead), [], "a source-only card has no short accounts to lead");
assert.deepEqual(rowIds(splitGroups(sourceOnly).folded), ["barclays"]);
assert.match(sourceOnly, /Every account covers its payments and linked plans\./);
assert.match(sourceOnly, /Suggested moves are for you to make\. Nothing has been moved\./, "the reminder still applies when suggestions sit in the fold");

// Unknown, payment-only and estimated readings retain their honest existing
// qualifications. No plan or cover total is presented while plans are absent.
const unknown = { ...byId("natwest"), opening: null, closing: null, shortfall: null, status: "unknown", position: undefined, events: [] };
const unknownReading = accountActionReading(unknown, plans, "ready");
assert.equal(accountMoveSummary(unknown, unknownReading), "This account’s balance needs checking.");
assert.deepEqual(rowIds(splitGroups(render(false, [unknown])).lead), ["natwest"], "an unknown balance is never hidden as fine");
const unknownPlans = { ...byId("barclays"), position: { ...byId("barclays").position, uncertain: true, afterPaymentsAndPlans: null, lowPointAndPlans: null, spendFrom: null } };
assert.ok(accountActionReading(unknownPlans, plans, "ready").headline > 0);
assert.deepEqual(rowIds(splitGroups(render(false, [unknownPlans])).lead), ["barclays"], "a positive payment balance cannot make uncertain plans fine");
assert.doesNotMatch(render(false, [unknownPlans]), /data-all-clear/);
const uncertain = { ...byId("natwest"), position: { ...byId("natwest").position, uncertain: true } };
assert.equal(accountMoveSummary(uncertain, accountActionReading(uncertain, plans, "ready")), "Payments only. Plans need checking.");
for (const status of ["loading", "error"]) {
  const pending = read("natwest", status);
  assert.equal(accountMoveSummary(byId("natwest"), pending), "Payments only. Plans are still to be checked.");
  assert.match(text(row(render(false, enriched, status), "natwest")), /Payments only\. Plans are still to be checked\./);
}
const estimatedPlans = plans.map(plan => plan.sourceId === "barclays" ? { ...plan, evidence: "recent-transfers" } : plan);
const estimated = accountActionReading(byId("barclays"), estimatedPlans, "ready");
assert.match(accountMoveSummary(byId("barclays"), estimated) ?? "", /Paying account based on recent transfers\./);

const hidden = render(true);
assert.doesNotMatch(hidden, /£\d/, "hidden balances cover summaries and row labels");
assert.match(hidden, /−£••••/);
assert.doesNotMatch(row(hidden, "natwest"), /aria-label="[^"]*(?:£259|£270|Current account)/, "hidden accessible labels contain no raw source or money");

// Source-level recommendation details remain in the account sheet exactly once.
const detail = renderToStaticMarkup(h(BalancesHiddenContext.Provider, { value: false }, h(UpcomingAccountDetails, {
  account: byId("natwest"), plans, plansStatus: "ready", periodLabel: "Payments through Sun 29 Nov", onPlan() {}, onEvent() {}, editableEventIds: new Set(),
})));
assert.match(detail, /data-suggested-move/);
assert.equal((detail.match(/data-suggested-move=/g) ?? []).length, 1, "the full source detail occurs exactly once");
assert.match(detail, /Move from Barclays/);
assert.match(detail, /£270/);

console.log("g430-move-summary: aggregate wording, deadlines, privacy and detail boundaries passed");
