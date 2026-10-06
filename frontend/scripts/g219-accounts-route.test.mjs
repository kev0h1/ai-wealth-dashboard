// G219 (design round): the optional `accountsRoute` prop on the production
// Safe to Spend card. Absent, the card is unchanged. Each variant adds exactly
// the links it promises, and none of the new copy carries an em dash or "!".
//
// Run: npm run -s check:g219-accounts-route

import assert from "node:assert/strict";
import React from "react";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime.js";
import { renderToStaticMarkup } from "react-dom/server";
import SafeToSpendCard, { accountDeepLink } from "../components/SafeToSpendCard.tsx";
import { FIGURE_DATA } from "../app/design/safe-to-spend-figure/fixtures.ts";
import { ALL_ACCOUNTS, ALL_ACCOUNTS_METRO, SPEND_FROM_NAMED, SPEND_FROM_RAIL } from "../app/design/sts-accounts-route/fixtures.ts";

const noop = () => {};
const router = { back: noop, forward: noop, refresh: noop, push: noop, replace: noop, prefetch: noop };
const render = (props) =>
  renderToStaticMarkup(
    React.createElement(
      AppRouterContext.Provider,
      { value: router },
      React.createElement(SafeToSpendCard, { loading: false, onRetry: noop, previewBalancesVisible: true, data: FIGURE_DATA["on-track"], spendFrom: SPEND_FROM_RAIL, ...props }),
    ),
  );
const hrefs = (html) => [...html.matchAll(/<a [^>]*href="([^"]+)"/g)].map((m) => m[1]);
const count = (html, needle) => html.split(needle).length - 1;

const rows = { kind: "rows", accountHref: accountDeepLink };
const link = { kind: "link", href: "/accounts" };
const strip = { kind: "strip", href: "/accounts", accounts: ALL_ACCOUNTS };

// 1. Absent prop: no anchors, none of the new markers, byte-stable twice over.
const base = render({});
assert.deepEqual(hrefs(base), [], "absent prop renders no link");
assert.ok(!base.includes("data-g219"), "absent prop renders no G219 marker");
assert.equal(render({ accountsRoute: undefined }), base);
assert.ok(base.includes("Spend from"), "today's rail still renders");

// 2. A: one link per Spend from row, account id in the href, both layouts.
const a = render({ accountsRoute: rows });
assert.deepEqual(hrefs(a), ["/accounts?id=g219-barclays", "/accounts?id=g219-natwest"]);
assert.equal(count(a, "data-g219-account-link"), 2);
assert.ok(a.includes("opens this account"), "sr-only label says it opens the account");
assert.ok(a.includes("<ul") && a.includes("<li"), "rail keeps list semantics");
assert.ok(!a.includes("contents"), "no display: contents on the rail (G171)");
assert.ok(a.includes("min-h-11"), "44px rows");
const aNamed = render({ accountsRoute: rows, spendFrom: SPEND_FROM_NAMED });
assert.ok(aNamed.includes('data-g115-treatment="name-fallback"'), "missing logo falls back to named rows");
assert.deepEqual(hrefs(aNamed), ["/accounts?id=g219-barclays", "/accounts?id=g219-metro"]);
assert.ok(!aNamed.includes("<dl><div"), "linked name rows are a list, not a dl");

// 3. B: exactly one "Your accounts" link, in every figure state, and beside the primary action.
for (const key of ["on-track", "tight", "card", "short-cash", "short-plans"]) {
  const b = render({ data: FIGURE_DATA[key], accountsRoute: link });
  assert.equal(count(b, "Your accounts<"), 1, `${key}: one Your accounts link`);
  assert.deepEqual(hrefs(b), ["/accounts"]);
}
const bShort = render({ data: FIGURE_DATA["short-cash"], accountsRoute: link });
assert.ok(bShort.includes("See what’s due") && bShort.includes("Your accounts"), "primary action and link share the row");
assert.equal(count(bShort, "<button"), count(render({ data: FIGURE_DATA["short-cash"] }), "<button"), "no second primary button");
assert.equal(count(render({ accountsRoute: link, syncing: { kind: "refresh", bank: "Barclays", asOf: "2026-10-06T09:41:00" } }), "Your accounts<"), 1, "link survives a stale-figure sync");

// 4. C: one link to /accounts with the count.
const c = render({ accountsRoute: strip });
assert.deepEqual(hrefs(c), ["/accounts"]);
assert.ok(c.includes(">3 accounts<"), "count is shown");
assert.equal(render({ accountsRoute: { ...strip, accounts: ALL_ACCOUNTS_METRO } }).includes(">3 accounts<"), true, "count does not depend on logos");
assert.ok(render({ accountsRoute: { ...strip, accounts: ALL_ACCOUNTS.slice(0, 1) } }).includes(">1 account<"), "singular");
assert.deepEqual(hrefs(render({ accountsRoute: { ...strip, accounts: [] } })), [], "no accounts, no strip");

// 5. Copy and tone: no em dash, no "!", no red or amber or gradient on the new controls.
const NEW_COPY = ["Your accounts", "opens this account", "open your accounts", "accounts"];
for (const text of NEW_COPY) assert.doesNotMatch(text, /—|!/);
for (const html of [a, aNamed, render({ accountsRoute: link }), c]) {
  const bits = [...html.matchAll(/<a [^>]*data-g219[^>]*class="([^"]+)"/g)].map((m) => m[1]).concat([...html.matchAll(/<a [^>]*class="([^"]+)"[^>]*data-g219/g)].map((m) => m[1]));
  assert.ok(bits.length > 0, "found the G219 anchors");
  for (const cls of bits) assert.doesNotMatch(cls, /red-|amber-|violet-|gradient|bg-indigo-(?!50)/, `no new colour meaning: ${cls}`);
}

console.log("g219-accounts-route: all assertions passed");
