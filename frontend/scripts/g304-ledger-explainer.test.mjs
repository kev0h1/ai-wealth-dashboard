// G304: the pooled Safe to Spend explainer inside both "Full calculation" ledgers.
// Run: npm run -s check:g304-ledger-explainer
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import React from "react";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime.js";
import SafeToSpendCard from "../components/SafeToSpendCard.tsx";
import { FIGURE_DATA } from "../app/design/safe-to-spend-figure/fixtures.ts";
import { SPEND_FROM_RAIL } from "../app/design/sts-accounts-route/fixtures.ts";
import PooledLedgerExplainer, { POOLED_SENTENCE, POOLED_PROJECTION_SENTENCE, ENVELOPE_EDIT_HREF, PLAN_EDIT_HREF } from "../components/PooledLedgerExplainer.tsx";

const fmt2 = (v) => `£${v.toFixed(2)}`;
const render = (props) => renderToStaticMarkup(createElement(PooledLedgerExplainer, { format: fmt2, ...props }));
const text = (html) => html.replace(/<[^>]+>/g, "").replace(/&#x27;/g, "'");

// Both reservations, multi-account (Kevin's live numbers).
const both = render({ pooled: true, envelope: { amount: 101.52, count: 1 }, plan: { amount: 100, count: 1 } });
const t = text(both);
assert.match(t, /This figure is shared by all your accounts\. Spend it from one of them, not from each\./);
assert.match(t, /Your envelope holds back £101\.52 until payday\. Edit it on Upcoming if you need some of that now\./);
assert.match(t, /Your plan holds back £100\.00\. Edit it on Planning if it can wait\./);
assert.ok(both.includes(`href="${ENVELOPE_EDIT_HREF}"`) && both.includes(`href="${PLAN_EDIT_HREF}"`), "both edit links present");
assert.equal(ENVELOPE_EDIT_HREF, "/upcoming#pay-period-plans");
assert.equal(PLAN_EDIT_HREF, "/planning#commitments");
assert.equal((both.match(/<a /g) ?? []).length, 2, "links only, no buttons");
assert.ok(!both.includes("<button"), "never a button");

// Zero reservation drops its line.
const envOnly = text(render({ pooled: false, envelope: { amount: 101.52 }, plan: { amount: 0 } }));
assert.match(envOnly, /Your envelope holds back/);
assert.ok(!/plan/i.test(envOnly) && !/shared by all/.test(envOnly), "no plan line, no pooling sentence");
const planOnly = text(render({ pooled: false, envelope: { amount: 0 }, plan: { amount: 100 } }));
assert.ok(!/envelope/i.test(planOnly) && /Your plan holds back £100\.00/.test(planOnly));

// Single account: pooling sentence absent; nothing at all when nothing to say.
assert.ok(!render({ pooled: false, envelope: { amount: 5 } }).includes("shared by all"));
assert.equal(render({ pooled: false, envelope: { amount: 0 }, plan: { amount: 0 } }), "");
assert.equal(render({ pooled: false }), "");

// Plurals.
const many = text(render({ pooled: false, envelope: { amount: 50, count: 2 }, plan: { amount: 60, count: 3 } }));
assert.match(many, /Your envelopes hold back £50\.00 until payday\. Edit them on Upcoming/);
assert.match(many, /Your plans hold back £60\.00\. Edit them on Planning if they can wait\./);

// Hidden balances stay hidden.
assert.match(text(render({ pooled: false, envelope: { amount: 9 }, format: () => "£••••" })), /holds back £••••/);

// Projection wording on Upcoming.
assert.match(text(render({ pooled: true, poolingSentence: POOLED_PROJECTION_SENTENCE })), /total across all your accounts/);

// Copy rules on every new string.
for (const s of [both, many, POOLED_SENTENCE, POOLED_PROJECTION_SENTENCE]) {
  assert.ok(!s.includes("!") && !s.includes("—") && !/saved|saving|free up|released/i.test(s), "copy rules");
}

// Whole production card (Home), through the real component.
const noop = () => {};
const router = { back: noop, forward: noop, refresh: noop, push: noop, replace: noop, prefetch: noop };
const card = (data, spendFrom) => text(renderToStaticMarkup(createElement(AppRouterContext.Provider, { value: router }, createElement(SafeToSpendCard, { loading: false, onRetry: noop, previewBalancesVisible: true, data, spendFrom }))));
const reserved = { ...FIGURE_DATA["on-track"], allocations_reserved: 101.52, allocations_count: 1, commitments_reserved: 100, commitments_count: 1 };
const multi = card(reserved, SPEND_FROM_RAIL);
assert.match(multi, /shared by all your accounts/);
assert.match(multi, /Your envelope holds back £101\.52 until payday\./);
assert.match(multi, /Your plan holds back £100\.00\./);
const single = card({ ...reserved, commitments_reserved: 0 }, { kind: "account", best: SPEND_FROM_RAIL.best, alternative: null });
assert.ok(!/Your plan holds back/.test(single), "zero plan: no plan line");
assert.ok(!/shared by all/.test(single), "single account: no pooling sentence");
assert.match(single, /Your envelope holds back/);
const noReserve = card({ ...reserved, allocations_reserved: 0, commitments_reserved: 0 }, SPEND_FROM_RAIL);
assert.ok(!/holds back/.test(noReserve), "no reservations: no release lines");

// Wiring: both ledgers render the shared component inside their expanded ledger.
const home = readFileSync(new URL("../components/SafeToSpendCard.tsx", import.meta.url), "utf8");
assert.match(home, /<PooledLedgerExplainer[\s\S]*?pooled=\{spendFromPlan\.entries\.length > 1\}/);
assert.ok(home.indexOf("<PooledLedgerExplainer") > home.indexOf("<details className=\"group\">"), "inside the details");
const up = readFileSync(new URL("../components/upcoming/UpcomingHeroCard.tsx", import.meta.url), "utf8");
assert.ok(up.indexOf("<PooledLedgerExplainer") > up.indexOf("<details"), "inside the details");
assert.ok(up.indexOf("<PooledLedgerExplainer") < up.indexOf("</details>"), "before details closes");
console.log("g304 ledger explainer: ok");
