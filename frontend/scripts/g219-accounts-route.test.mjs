// G397 supersedes G219's standalone hero Accounts action. Account captions
// stay plain; the counted-account exception and shortfall recovery remain.
//
// Run: npm run -s check:g219-accounts-route

import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import React from "react";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime.js";
import { renderToStaticMarkup } from "react-dom/server";
import SafeToSpendCard from "../components/SafeToSpendCard.tsx";
import { FIGURE_DATA } from "../app/design/safe-to-spend-figure/fixtures.ts";
import { SPEND_FROM_NAMED, SPEND_FROM_RAIL, SYNCING_INFO } from "../app/design/sts-accounts-route/fixtures.ts";

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
// G304: the ledger explainer carries its own edit links (inside the closed Full calculation); this gate is about the action row.
const hrefs = (html) => [...html.replace(/<div data-g304-ledger-explainer[\s\S]*?<\/div>/g, "").matchAll(/<a [^>]*href="([^"]+)"/g)].map((m) => m[1]);
const count = (html, needle) => html.split(needle).length - 1;
const text = (html) => html.replace(/<[^>]+>/g, " ");

// 1. No standalone Accounts action or empty action row.
for (const key of ["on-track", "tight", "card", "short-cash", "short-plans"]) {
  const html = render({ data: FIGURE_DATA[key] });
  assert.doesNotMatch(html, /data-g219-accounts-link/);
  assert.ok(!hrefs(html).includes("/accounts"), `${key}: standalone Accounts link removed`);
  assert.equal(html.includes("data-g219-action-row"), ["card", "short-cash", "short-plans"].includes(key), `${key}: only recovery needs a hero action row`);
}
const syncing = render({ syncing: SYNCING_INFO });
assert.doesNotMatch(syncing, /data-g219-action-row|See your cards/);
assert.ok(!hrefs(syncing).includes("/accounts"));

// 2. None where no figure renders.
for (const [name, props] of [
  ["loading", { loading: true, data: null }],
  ["error", { error: true, data: null }],
  ["degraded", { data: FIGURE_DATA.degraded }],
]) {
  const html = render(props);
  assert.equal(count(html, "data-g219-accounts-link"), 0, `${name}: no Your accounts link`);
  assert.deepEqual(hrefs(html), [], `${name}: no anchors to /accounts`);
}

// 3. The separate, actionable counted-account exception stays.
const excluded = render({ data: FIGURE_DATA.excluded });
assert.equal(count(excluded, 'href="/accounts"'), 1);
assert.match(excluded, /data-g231-not-counting/);
assert.match(excluded, /Not counting 2 accounts/);

// 4. Copy: no em dash or exclamation mark in rendered text.
for (const key of ["on-track", "tight", "card", "short-cash", "short-plans"]) {
  assert.doesNotMatch(text(render({ data: FIGURE_DATA[key] })), /—|!/, `${key}: no em dash or "!"`);
}

// 5. Bank rail and name-row fallback carry no anchors of their own.
// G303: these fixture figures (£265 and up) only fit inside a pool this large;
// a smaller pool would (correctly) collapse them into one combined line.
const BIG_POOL = { data: { ...FIGURE_DATA["on-track"], safe_to_spend: 10000 } };
const rail = render(BIG_POOL);
assert.ok(rail.includes('data-g115-treatment="bank-rail"'), "bank rail renders");
assert.ok(!hrefs(rail).includes("/accounts"), "rail and caption remain plain");
assert.match(rail, /See all in Your accounts\./, "existing caption wording retained");
const named = render({ ...BIG_POOL, spendFrom: SPEND_FROM_NAMED });
assert.ok(named.includes('data-g115-treatment="name-fallback"'), "name fallback renders");
assert.ok(!hrefs(named).includes("/accounts"), "name rows are not links");

// 6. Genuine shortfall recovery still renders inside the hero.
const short = render({ data: FIGURE_DATA["short-cash"] });
const row = short.slice(short.indexOf("data-g219-action-row"));
assert.ok(row.includes("See what’s due"), "recovery button in the action row");
assert.equal(count(short, "<button"), count(short, "See what’s due"), "one primary button only");
assert.doesNotMatch(render({ data: FIGURE_DATA.card }), /Review card bill/, "G413: no card-bill recovery action");

// 7. The existing tight/high-card-debt route lives inside card evidence,
// including when repayments leave zero growth or there is no period activity.
const cardStyles=readFileSync(new URL('../components/SafeToSpendDisclosures.module.css',import.meta.url),'utf8');
assert.match(cardStyles,/\.cardsButton \{[^}]*min-height: 44px/);
assert.match(cardStyles,/\.cardsButton:focus-visible \{[^}]*outline: 2px/);
assert.match(cardStyles,/\.cardsButton \{[^}]*background: #4f46e5/);
const hero = html => html.slice(html.indexOf("data-g324-hero"), html.indexOf("data-g324-evidence"));
for (const patch of [
  { card_growth_total: 420, card_new_spend_total: 420 },
  { card_growth_total: 420, card_new_spend_total: 200 },
  { card_growth_total: 0, card_new_spend_total: 420 },
  { card_growth_total: 0, card_new_spend_total: 0 },
]) {
  const data = { ...FIGURE_DATA.tight, card_debt: 1800, ...patch };
  for (const hidden of [false, true]) {
    const html = render({ data, previewBalancesVisible: !hidden });
    assert.doesNotMatch(hero(html), /See your cards|data-g219-action-row/);
    const card = html.slice(html.indexOf("data-g324-card-activity"));
    assert.equal(count(card, 'href="/cards"'), 1, "one real Cards route within card evidence");
    assert.match(card, /class="[^"]*cardsButton[^"]*"[^>]*>See your cards/);
    assert.doesNotMatch(card, /Repayment not confirmed/);
    if (hidden) assert.doesNotMatch(html, /£\d/, "amounts remain masked in DOM and accessible names");
  }
  assert.doesNotMatch(render({ data, syncing: SYNCING_INFO }), /See your cards/, "sync does not offer a stale recovery action");
  assert.doesNotMatch(render({ data: { ...data, card_debt: 999 } }), /See your cards/, "existing debt threshold remains");
  assert.doesNotMatch(render({ data: { ...data, state: "comfortable" } }), /See your cards/, "existing tight-state gate remains");
}

console.log("G219/G397: quiet hero, account exception, card route placement/eligibility, shortfall recovery and masking passed");
