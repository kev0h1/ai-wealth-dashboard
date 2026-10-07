// G229: the production By account card leads with accounts that need attention
// and folds the rest. Server-renders the real card for each preview fixture.
// The collapsed fold is the grid-template-rows 0fr convention (rows stay in the
// DOM, wrapped in a grid-rows-[0fr] inert region), so "not shown" is asserted as
// "inside the 0fr inert region", never as absent from the markup.
//
// Run: npm run -s check:g229-by-account
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import UpcomingAccountsCard from "../components/upcoming/UpcomingAccountsCard.tsx";
import { fixtureFor, PERIOD } from "../app/design/upcoming-by-account/fixtures.ts";

const render = (id) => {
  const fixture = fixtureFor(id);
  const html = renderToStaticMarkup(React.createElement(UpcomingAccountsCard, { accounts: fixture.accounts, plans: fixture.plans, plansStatus: fixture.plansStatus, periodLabel: PERIOD, onOpen() {} }));
  return { fixture, html };
};
const split = (html) => {
  const at = html.indexOf("data-fine-region");
  return at < 0 ? { lead: html, region: "" } : { lead: html.slice(0, at), region: html.slice(at) };
};
const rows = (html) => [...html.matchAll(/data-account-row="([^"]+)"/g)].map((m) => m[1]);
const captions = (html) => [...html.matchAll(/data-status-caption[^>]*>([^<]+)</g)].map((m) => m[1]);

for (const id of ["long", "watch", "clear", "all"]) {
  const { html } = render(id);
  assert.ok(!html.includes("—"), `${id}: no em dash`);
  assert.ok(!html.includes("!"), `${id}: no exclamation mark`);
  assert.match(html, /By account/, `${id}: heading kept`);
}

// Long: 20 accounts, 2 lead in the specified order, 18 fold.
{
  const { fixture, html } = render("long");
  assert.equal(fixture.accounts.length, 20);
  const { lead, region } = split(html);
  assert.deepEqual(captions(lead), ["Short for payments", "Short for plans"], "attention order");
  assert.equal(rows(lead).length, 2, "only attention rows before the fold region");
  assert.equal(rows(region).length, 18, "fine rows sit inside the fold region");
  assert.match(html, /18 accounts are fine/);
  assert.match(html, /aria-expanded="false"/);
  assert.match(region, /^data-fine-region="true" inert="" class="grid[^"]*grid-rows-\[0fr\]/, "collapsed via grid 0fr + inert");
  assert.ok(!html.includes("data-all-clear"), "no all-clear line");
}

// Watch: one watch row leads, 5 fine fold.
{
  const { html } = render("watch");
  const { lead, region } = split(html);
  assert.equal(rows(lead).length, 1);
  assert.equal(rows(region).length, 5);
  assert.match(html, /5 accounts are fine/);
  assert.ok(!html.includes("data-all-clear"));
}

// Clear: the calm line, no attention rows, an "All 6 accounts" fold row.
{
  const { html } = render("clear");
  const { lead, region } = split(html);
  assert.match(html, /Every paying account covers its payments and plans this period\./);
  assert.equal(rows(lead).length, 0);
  assert.equal(rows(region).length, 6);
  assert.match(html, /All 6 accounts/);
}

// All short: every row visible, no fold row at all.
{
  const { html } = render("all");
  assert.equal(rows(html).length, 3);
  assert.ok(!html.includes("data-fine-fold") && !html.includes("data-fine-region"), "no fold row");
  assert.ok(!html.includes("data-all-clear"));
}

// Plans unavailable: the fold label must not claim plans were checked.
for (const plansStatus of ["loading", "error"]) {
  const fixture = fixtureFor("long");
  const html = renderToStaticMarkup(React.createElement(UpcomingAccountsCard, { accounts: fixture.accounts, plans: fixture.plans, plansStatus, periodLabel: PERIOD, onOpen() {} }));
  assert.match(html, /accounts are fine for payments/, `${plansStatus}: fold label scoped to payments`);
  assert.ok(!/accounts are fine</.test(html), `${plansStatus}: no unqualified fine label`);
}
{
  const fixture = fixtureFor("clear");
  const html = renderToStaticMarkup(React.createElement(UpcomingAccountsCard, { accounts: fixture.accounts, plans: [], plansStatus: "loading", periodLabel: PERIOD, onOpen() {} }));
  assert.match(html, /Every paying account covers its payments this period\./);
}

// Ordering of all tiers on a synthetic mix: payments, plans, watch.
{
  const base = (id, status, shortfall = null) => ({ id, bank: "Barclays", name: id, opening: 100, income: 0, transfersIn: 0, outgoing: 10, closing: 90, shortfall, status, firstShortDate: null, hasUnassignedIncome: false, events: [] });
  const accounts = [base("watch", "unknown"), base("fine", "covered"), base("move", "unfunded", 5), base("pay", "short", 20)];
  const html = renderToStaticMarkup(React.createElement(UpcomingAccountsCard, { accounts, plans: [], periodLabel: PERIOD, onOpen() {} }));
  assert.deepEqual(rows(split(html).lead), ["pay", "watch", "move"], "payments first, then watch states in list order");
}

console.log("g229-by-account: ok");
