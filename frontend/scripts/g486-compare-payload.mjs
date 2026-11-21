// G486 helper (run by backend/tests/test_g486_upcoming_available.py, not a check:* script).
// Reads {accounts, account_eligibility} produced by the real engine and compares, per account, the figure
// Upcoming's By account row renders with the figure the account page renders from the same payload.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import React, { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { accountAvailability, availabilityLabel, formatAvailabilityAmount } from "../lib/accountAvailability.ts";
import { positionsFromToday } from "../lib/upcomingAccounts.ts";
import { accountActionReading } from "../lib/upcomingAccountPresentation.ts";
import { BalancesHiddenContext } from "../lib/balancesHidden.tsx";
import UpcomingAccountsCard from "../components/upcoming/UpcomingAccountsCard.tsx";

const payload = JSON.parse(readFileSync(process.argv[2], "utf8"));
const positions = positionsFromToday(payload.account_eligibility, payload.accounts);
const summaries = Object.entries(positions).filter(([, p]) => p.availability).map(([id, p]) => {
  const a = payload.accounts.find((x) => x.id === id);
  return { id, bank: a.provider, name: a.name, opening: a.balance, income: 0, transfersIn: 0, outgoing: 0, closing: a.balance, shortfall: 0, status: "covered", firstShortDate: null, hasUnassignedIncome: false, events: [], position: p };
});
const markup = renderToStaticMarkup(h(BalancesHiddenContext.Provider, { value: false }, h(UpcomingAccountsCard, { accounts: summaries, plans: [], plansStatus: "ready", periodLabel: "Payments through Fri 30 Oct", onOpen() {} })));
const text = (m) => m.replace(/<[^>]+>/g, "");
let n = 0;
for (const summary of summaries) {
  const account = payload.accounts.find((x) => x.id === summary.id);
  const page = accountAvailability(account, { status: "ready", positions: payload.account_eligibility });
  assert.equal(page.kind, "ready");
  const reading = accountActionReading(summary, [], "ready");
  assert.equal(reading.available, Math.round(page.value * 100), `${summary.id}: figure`);
  assert.equal(reading.availableLabel, availabilityLabel(page), `${summary.id}: label`);
  const a = markup.indexOf(`data-account-row="${summary.id}"`);
  const b = markup.indexOf("data-account-row=", a + 1);
  const row = text(markup.slice(a, b < 0 ? undefined : b));
  assert.ok(row.includes(formatAvailabilityAmount(page.value)), `${summary.id}: row shows ${formatAvailabilityAmount(page.value)} in ${row}`);
  assert.equal(reading.gap > 0, page.value < 0, `${summary.id}: Short agrees with the figure`);
  n += 1;
}
console.log(`compared ${n}`);
