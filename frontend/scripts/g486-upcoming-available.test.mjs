// G486: Upcoming's By account row and the account page's "Available to spend" read one stored figure,
// through one reading, with one label and one working, for real engine payloads (committed H140 snapshots).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import React, { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { accountAvailability, availabilityLabel, formatAvailabilityAmount } from "../lib/accountAvailability.ts";
import { positionsFromToday } from "../lib/upcomingAccounts.ts";
import { accountActionReading, accountSummaryMoney } from "../lib/upcomingAccountPresentation.ts";
import { BalancesHiddenContext } from "../lib/balancesHidden.tsx";
import UpcomingAccountsCard from "../components/upcoming/UpcomingAccountsCard.tsx";
import UpcomingAccountDetails from "../components/upcoming/UpcomingAccountDetails.tsx";

const OUT = new URL("../../backend/tests/scenarios/out/", import.meta.url);
const SCENARIOS = {
  covered: "g481-kevins-shape-money-in-offsets-the-bill-and-is-not-short",
  short: "g481-kevins-shape-without-the-income-is-short",
  "cover move or earmark": "g481-one-account-is-short-another-has-room-the-move-covers-it",
  goal: "g465-daily-goal-counts-only-payments-from-its-start",
};
const text = (markup) => markup.replace(/<[^>]+>/g, "").replace(/&amp;/g, "&");
const wrap = (view) => renderToStaticMarkup(h(BalancesHiddenContext.Provider, { value: false }, view));
const rowOf = (markup, id) => { const a = markup.indexOf(`data-account-row="${id}"`); const b = markup.indexOf("data-account-row=", a + 1); return markup.slice(a, b < 0 ? undefined : b); };

let compared = 0;
for (const [kind, file] of Object.entries(SCENARIOS)) {
  const snap = JSON.parse(readFileSync(new URL(`${file}.json`, OUT), "utf8"));
  const positions = positionsFromToday(snap.account_eligibility, snap.accounts);
  const summaries = Object.entries(positions).filter(([, p]) => p.availability).map(([id, p]) => {
    const a = snap.accounts.find((x) => x.id === id);
    return { id, bank: a.provider, name: a.name, opening: a.balance, income: 0, transfersIn: 0, outgoing: 0, closing: a.balance, shortfall: 0, status: "covered", firstShortDate: null, hasUnassignedIncome: false, events: [], position: p };
  });
  assert.ok(summaries.length > 0, `${kind}: at least one current account carries Available`);
  const card = wrap(h(UpcomingAccountsCard, { accounts: summaries, plans: [], plansStatus: "ready", periodLabel: "Payments through Fri 27 Nov", onOpen() {} }));
  for (const summary of summaries) {
    const account = snap.accounts.find((x) => x.id === summary.id);
    // The account page's own reading of the same payload.
    const page = accountAvailability(account, { status: "ready", positions: snap.account_eligibility });
    assert.equal(page.kind, "ready", `${kind}: ${summary.id} page reading`);
    assert.equal(page.value, snap.account_eligibility[summary.id].spend_from_headroom, `${kind}: page reads spend_from_headroom`);
    const reading = accountActionReading(summary, [], "ready");
    assert.equal(reading.available, Math.round(page.value * 100), `${kind}: ${summary.id} Upcoming reads the same stored figure`);
    assert.equal(reading.availableLabel, availabilityLabel(page), `${kind}: same label`);
    const row = text(rowOf(card, summary.id));
    assert.ok(row.includes(accountSummaryMoney(reading.available)), `${kind}: row renders ${accountSummaryMoney(reading.available)}`);
    assert.equal(accountSummaryMoney(reading.available), formatAvailabilityAmount(page.value), `${kind}: both surfaces format alike`);
    assert.ok(row.includes(page.requiresMove ? "Available after suggested move" : "Available to spend"), `${kind}: row label`);
    assert.doesNotMatch(row, /Left after (payments|plans)/, `${kind}: no closing projection label on the row`);
    // Tapped: the same working component and rows as the account page.
    const sheet = text(wrap(h(UpcomingAccountDetails, { account: summary, plans: [], plansStatus: "ready", periodLabel: "Payments through Fri 27 Nov" })));
    assert.ok(sheet.includes(availabilityLabel(page)), `${kind}: sheet carries the label`);
    if (page.working) assert.ok(sheet.includes("After payments and money in"), `${kind}: sheet carries the working`);
    compared += 1;
  }
}
assert.ok(compared >= 5, "several accounts compared");
// One source of truth for Short: the stored Available decides the caption, signal, grouping, fold count and all-clear.
const load = (file) => JSON.parse(readFileSync(new URL(`${file}.json`, OUT), "utf8"));
const build = (snap, tweak, status = "ready", legacyStatus = "covered") => {
  const eligibility = JSON.parse(JSON.stringify(snap.account_eligibility));
  tweak(eligibility);
  const positions = positionsFromToday(eligibility, snap.accounts, status);
  return Object.entries(positions).filter(([, p]) => p.availability || p.availabilityPending).map(([id, p]) => {
    const a = snap.accounts.find((x) => x.id === id);
    return { id, bank: a.provider, name: a.name, opening: a.balance, income: 0, transfersIn: 0, outgoing: 0, closing: a.balance, shortfall: 0, status: legacyStatus, firstShortDate: null, hasUnassignedIncome: false, events: [], position: p };
  });
};
const cardOf = (accounts, plansStatus = "ready") => wrap(h(UpcomingAccountsCard, { accounts, plans: [], plansStatus, periodLabel: "Payments through Fri 27 Nov", onOpen() {} }));

// Contradiction 1: the client walk says covered and the closing is positive, but the stored Available is negative.
{
  const snap = load(SCENARIOS.covered);
  const accounts = build(snap, (e) => { e["acc-hb"].spend_from_headroom = -10; e["acc-hb"].after_payments_and_money_in = -10; });
  const reading = accountActionReading(accounts[0], [], "ready");
  assert.ok(reading.gap > 0 && reading.signal === "risk" && reading.caption === "Short", "negative Available is Short");
  const markup = cardOf(accounts);
  const outside = markup.slice(0, markup.indexOf("data-fine-group") < 0 ? undefined : markup.indexOf("data-fine-group"));
  assert.ok(outside.includes('data-account-row="acc-hb"'), "a negative Available is never in fine");
  assert.doesNotMatch(markup, /data-fine-fold|data-all-clear/, "no fine count and no all-clear beside a negative Available");
  assert.match(text(rowOf(markup, "acc-hb")), /−£10.*short/i);
}
// Contradiction 2: the client walk says short, but the stored Available is positive.
{
  const snap = load(SCENARIOS.short);
  const accounts = build(snap, (e) => { e["acc-hb"].spend_from_headroom = 5; e["acc-hb"].after_payments_and_money_in = 5; }, "ready", "short")
    .map((a) => ({ ...a, shortfall: 72.86, firstShortDate: "2026-11-23", position: { ...a.position, afterPayments: -72.86, lowPoint: -72.86 } }));
  const reading = accountActionReading(accounts[0], [], "ready");
  assert.ok(reading.gap === 0 && reading.signal !== "risk" && !/short/i.test(reading.caption), "a positive Available never says short");
  const markup = cardOf(accounts);
  assert.match(markup, /data-all-clear/, "all clear");
  assert.match(markup, /data-fine-fold/, "the account is counted fine");
  assert.doesNotMatch(text(rowOf(markup, "acc-hb")), /short/i);
}
// Stale copy: plan-loading notes only for rows that fall back to the closing figure.
{
  const snap = load(SCENARIOS.covered);
  const accounts = build(snap, () => {});
  const markup = cardOf(accounts, "loading");
  assert.doesNotMatch(markup, /payments only|for payments|Plans are still to be checked/i, "Available rows carry no payments-only copy");
  assert.ok(!/data-fine-fold[^>]*>.*for payments/s.test(markup));
}
// Readiness: while a sync runs or fails the account page shows checking or unavailable, so Upcoming shows no figure.
for (const [status, word] of [["loading", /Checking availability/], ["failed", /Availability unavailable/]]) {
  const snap = load(SCENARIOS.covered);
  const accounts = build(snap, () => {}, status);
  assert.ok(accounts.length > 0 && accounts[0].position.availabilityPending, `${status}: pending state recorded`);
  const row = text(rowOf(cardOf(accounts), "acc-hb"));
  assert.match(row, word);
  assert.doesNotMatch(row, /£\d/, `${status}: no figure while the account page shows none`);
}
// Sheet: the closing projection is labelled as the projection, distinct from Available.
{
  const snap = load(SCENARIOS.covered);
  const [account] = build(snap, () => {});
  const sheet = text(wrap(h(UpcomingAccountDetails, { account, plans: [], plansStatus: "ready", periodLabel: "Payments through Fri 27 Nov" })));
  assert.ok(sheet.includes("Projected at payday") && sheet.includes("Available to spend"));
}
console.log(`g486 ok: ${compared} accounts match`);
