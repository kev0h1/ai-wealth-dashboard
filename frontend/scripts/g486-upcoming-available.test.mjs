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
console.log(`g486 ok: ${compared} accounts match`);
