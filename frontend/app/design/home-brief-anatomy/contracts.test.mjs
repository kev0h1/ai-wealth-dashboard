import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime.js";
import { SearchParamsContext } from "next/dist/shared/lib/hooks-client-context.shared-runtime.js";
import { PreviewCard, ProductionCard, examplesFor } from "./PreviewCards.tsx";
import Client from "./HomeBriefAnatomyClient.tsx";
import * as F from "./fixtures.ts";

const noop = () => {};
const router = { push: noop, replace: noop, refresh: noop, back: noop, forward: noop, prefetch: async () => {} };
const render = element => renderToStaticMarkup(h(AppRouterContext.Provider, { value: router }, element));
// React hoists image resource hints ahead of the render root. Their placement
// changes with a wrapper; the actual image, bank identity and card do not.
const stripIds = html => html.replace(/<link\b[^>]*\/>/g, "").replace(/\s(?:id|aria-controls)="[^"]*"/g, "");
let renders = 0;
for (const view of ["focus", "family", "edges", "hidden"]) for (const example of examplesFor(view)) {
  const props = { example, hidden: view === "hidden", tell: noop, hide: noop };
  const actual = stripIds(render(h(ProductionCard, props)));
  for (const variant of ["a", "b", "reference"]) {
    const html = stripIds(render(h(PreviewCard, { ...props, variant })));
    assert.ok(html.includes(actual), `${view}/${example.key}/${variant}: unchanged actual production-card markup`);
    if (view === "hidden") assert.doesNotMatch(html, /£[\d,]+/, `${example.key} supports masked props without pre-masked fixture data`);
    if (["ask", "ask-payday", "move", "unfunded", "payday"].includes(example.kind)) assert.match(html, /Penny/, "Penny attribution remains");
    if (["fact", "covered", "move", "unfunded", "rhythm", "pace", "allocation", "goal"].includes(example.kind) && example.key !== "deferred") assert.match(html, /(?:h-11 w-11|w-11 h-11)/, "V2 dismiss hit target survives");
    renders++;
  }
}
for (const variant of ["a", "b", "reference"]) for (const view of ["focus", "family", "edges", "hidden", "empty"]) {
  const html = render(h(SearchParamsContext.Provider, { value: new URLSearchParams({ variant, state: view, mode: "dark" }) }, h(Client)));
  assert.ok(html.includes(`data-view="${view}"`), "design index's state deep-link selects the intended state");
  assert.ok(html.includes("A · Quiet spine") && html.includes("B · Inline cues"));
}
const payday = F.PAYDAY_PLAN_ITEM;
assert.equal(payday.dests.reduce((sum, d) => sum + d.move, 0), payday.total);
assert.equal(payday.total + payday.salary.stays, payday.salary.amount);
for (const d of payday.dests) assert.equal(d.balance + d.move, d.target);
assert.equal(F.ALLOCATION_ITEM.allocation_shortfall.moves.reduce((sum, m) => sum + m.amount, 0), F.ALLOCATION_ITEM.allocation_shortfall.shortfall);
assert.equal(2100 + 504, 2604, "synthetic zero-rate and unclear balances reconcile");
assert.match(F.TRAJECTORY_ITEM.brief_lead.companion, /more owed than three months ago/, "flow leads, not a stock balance");
assert.equal(F.PLAN_EASING_DEFERRED_ITEM.plan_easing.eased_this_period, 70, "deferred figure is the contribution, not the reduction");
assert.equal(F.PLAN_EASING_DEFERRED_ITEM.plan_easing.later_slice % 5, 0);
assert.equal(F.SPOTLIGHT_TIP.triggered_by.reduce((sum, t) => sum + t.monthly_amount, 0), 31);
const css = readFileSync(new URL("anatomy.module.css", import.meta.url), "utf8");
assert.doesNotMatch(css, /!important|font-size|font-family|data-brief-lead|data-move-lead|data-total-moving/);
for (const file of ["PreviewCards.tsx", "HomeBriefAnatomyClient.tsx", "fixtures.ts"]) {
  const source = readFileSync(new URL(file, import.meta.url), "utf8");
  assert.doesNotMatch(source, /\bapi\.|\bfetch\(|localStorage|sessionStorage|—/);
}
assert.equal(examplesFor("empty").length, 0);
console.log(`PASS G295: ${renders} unchanged production-component render contracts, five deep-linked states, semantic identity, supported masking and synthetic financial reconciliation.`);
