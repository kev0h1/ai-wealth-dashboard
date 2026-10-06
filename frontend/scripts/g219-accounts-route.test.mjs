// G219 (approved B, folded in): the quiet "Your accounts" link ships by default
// in the Safe to Spend action row. One link to /accounts in every state that
// renders a figure (including syncing), none on loading, error or degraded.
//
// Run: npm run -s check:g219-accounts-route

import assert from "node:assert/strict";
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
const hrefs = (html) => [...html.matchAll(/<a [^>]*href="([^"]+)"/g)].map((m) => m[1]);
const count = (html, needle) => html.split(needle).length - 1;
const text = (html) => html.replace(/<[^>]+>/g, " ");

// 1. Exactly one link to /accounts wherever a figure renders, syncing included.
for (const key of ["on-track", "tight", "card", "short-cash", "short-plans"]) {
  const html = render({ data: FIGURE_DATA[key] });
  assert.equal(count(html, "Your accounts<"), 1, `${key}: one Your accounts link`);
  assert.deepEqual(hrefs(html), ["/accounts"], `${key}: it points at /accounts`);
  assert.ok(html.includes("data-g219-action-row"), `${key}: link sits in the action row`);
}
const syncing = render({ syncing: SYNCING_INFO });
assert.equal(count(syncing, "Your accounts<"), 1, "syncing: one link");
assert.deepEqual(hrefs(syncing), ["/accounts"]);
const stale = render({ syncing: SYNCING_INFO });
assert.equal(count(stale, "Your accounts<"), 1, "stale figure while syncing: one link");

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

// 3. The link carries no colour meaning: no indigo fill, red, amber or gradient.
for (const key of ["on-track", "short-cash"]) {
  const html = render({ data: FIGURE_DATA[key] });
  const cls = [...html.matchAll(/<a [^>]*data-g219-accounts-link[^>]*class="([^"]+)"/g)].map((m) => m[1])
    .concat([...html.matchAll(/<a [^>]*class="([^"]+)"[^>]*data-g219-accounts-link/g)].map((m) => m[1]));
  assert.equal(cls.length, 1, `${key}: found the link anchor`);
  assert.doesNotMatch(cls[0], /bg-indigo|red-|amber-|violet-|gradient/, `no new colour meaning: ${cls[0]}`);
  assert.ok(cls[0].includes("min-h-11"), "44px target");
  assert.ok(cls[0].includes("text-slate-600"), "secondary slate ink");
  assert.match(html, /<svg[^>]*aria-hidden="true"[^>]*>(?:(?!<\/a>).)*<\/svg><\/a>/s, "arrow is aria-hidden");
}

// 4. Copy: no em dash or exclamation mark in rendered text.
for (const key of ["on-track", "tight", "card", "short-cash", "short-plans"]) {
  assert.doesNotMatch(text(render({ data: FIGURE_DATA[key] })), /—|!/, `${key}: no em dash or "!"`);
}

// 5. Bank rail and name-row fallback carry no anchors of their own.
const rail = render({});
assert.ok(rail.includes('data-g115-treatment="bank-rail"'), "bank rail renders");
assert.deepEqual(hrefs(rail), ["/accounts"], "rail rows are not links");
const named = render({ spendFrom: SPEND_FROM_NAMED });
assert.ok(named.includes('data-g115-treatment="name-fallback"'), "name fallback renders");
assert.deepEqual(hrefs(named), ["/accounts"], "name rows are not links");

// 6. The recovery button still renders in its state, with the link beside it in one row.
const short = render({ data: FIGURE_DATA["short-cash"] });
const row = short.slice(short.indexOf("data-g219-action-row"));
assert.ok(row.includes("See what’s due"), "recovery button in the action row");
assert.ok(row.indexOf("See what’s due") < row.indexOf("Your accounts<"), "primary action precedes the link");
assert.equal(count(short, "<button"), count(short, "See what’s due"), "one primary button only");

console.log("g219-accounts-route: all assertions passed");
