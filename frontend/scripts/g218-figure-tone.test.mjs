// G218 server plans-only derivation and disclaimer contract.
// G287 E supersedes the old figure tints; production presentation is
// covered by check:g287-sts-tone. These financial and privacy checks remain.
//
// Run: npm run -s check:g218-figure-tone

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import React from "react";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime.js";
import { renderToStaticMarkup } from "react-dom/server";
import SafeToSpendCard from "../components/SafeToSpendCard.tsx";
import { FIGURE_DATA } from "../app/design/safe-to-spend-figure/fixtures.ts";
import { isPlansOnlyShort, deriveSafeToSpendHeadline, buildSafeToSpendView } from "../lib/pennyScreenViews.ts";

// 4. Plans-only derivation (client twin of net_position.plans_only_short_for).
const ok = { status: "ok", state: "short", short_reason: "bills", safe_to_spend: -250, safe_to_spend_cash: -250, buffer: 0, lowest_projected_balance: 0, commitments_reserved: 50, allocations_reserved: 200, next_payday: "2026-10-30T00:00:00" };
assert.equal(isPlansOnlyShort(ok), true, "£0 cash, £250 of set-asides");
assert.equal(isPlansOnlyShort({ ...ok, lowest_projected_balance: -86, commitments_reserved: 0, allocations_reserved: 0, safe_to_spend_cash: -86 }), false, "bills push cash negative");
assert.equal(isPlansOnlyShort({ ...ok, lowest_projected_balance: -1 }), false);
assert.equal(isPlansOnlyShort({ ...ok, buffer: 40 }), false, "buffer eats the headroom");
assert.equal(isPlansOnlyShort({ ...ok, buffer: 40, lowest_projected_balance: 40 }), true);
assert.equal(isPlansOnlyShort({ ...ok, commitments_reserved: 0, allocations_reserved: 0 }), false);
assert.equal(isPlansOnlyShort({ ...ok, lowest_projected_balance: undefined }), false);
assert.equal(isPlansOnlyShort({ ...ok, short_reason: "cards_unconfirmed" }), false);
assert.equal(isPlansOnlyShort({ ...ok, state: "tight", safe_to_spend_cash: 20 }), false);
// The server field wins when present.
assert.equal(isPlansOnlyShort({ ...ok, plans_only_short: false }), false);
assert.equal(isPlansOnlyShort({ ...ok, lowest_projected_balance: -50, plans_only_short: true }), true);

// 5. Penny's published view speaks the same reading.
assert.equal(deriveSafeToSpendHeadline(ok).plansOnly, true);
assert.equal(buildSafeToSpendView(ok, { hidden: false }).figures[0].label, "Short after plans and envelopes");
const cash = { ...ok, lowest_projected_balance: -86, commitments_reserved: 0, allocations_reserved: 0 };
assert.equal(buildSafeToSpendView(cash, { hidden: false }).figures[0].label, "Short before payday");

// 6. Source guard: no tone prop, masking defaults to production behaviour.
const src = readFileSync(new URL("../components/SafeToSpendCard.tsx", import.meta.url), "utf8");
assert.doesNotMatch(src, /\bfigureTone\b/, "one shipped look, no tone prop");
assert.match(src, /previewBalancesVisible = false/);
assert.match(src, /!previewBalancesVisible && \(hideNetWorth \|\| !preferencesReady\)/);
assert.doesNotMatch(readFileSync(new URL("../app/components/HomePage.tsx", import.meta.url), "utf8"), /previewBalancesVisible/, "Home must not opt in");

// 7. Hero disclaimer (Kevin 2026-10-06): one quiet line wherever a figure renders.
const DISCLAIMER = "An estimate from your bank data, not financial advice.";
const noop = () => {};
const router = { back: noop, forward: noop, refresh: noop, push: noop, replace: noop, prefetch: noop };
const render = (props) => renderToStaticMarkup(React.createElement(AppRouterContext.Provider, { value: router }, React.createElement(SafeToSpendCard, { loading: false, onRetry: noop, previewBalancesVisible: true, ...props })));
const hasLine = (html) => html.includes("data-sts-disclaimer") && html.includes(DISCLAIMER);
const fx = FIGURE_DATA;
assert.ok(hasLine(render({ data: fx["on-track"] })), "complete state shows the disclaimer");
assert.ok(hasLine(render({ data: fx["short-plans"] })), "plans-only state shows the disclaimer");
assert.ok(hasLine(render({ data: fx["short-cash"] })), "cash-short state shows the disclaimer");
const syncInfo = { kind: "refresh", bank: "Barclays", asOf: "2026-10-06T09:41:00" };
assert.ok(hasLine(render({ data: fx["on-track"], syncing: syncInfo })), "stale figure while syncing shows the disclaimer");
assert.ok(!hasLine(render({ data: null, error: true })), "error state has no disclaimer");
assert.ok(!hasLine(render({ data: null, loading: true })), "loading state has no disclaimer");
assert.ok(!hasLine(render({ data: fx.degraded })), "degraded state withholds the figure and the disclaimer");
const dis = src.match(/<p data-sts-disclaimer className="([^"]+)">([^<]+)<\/p>/);
assert.ok(dis, "disclaimer element present in source");
assert.equal(dis[1], "text-[11px] leading-snug text-slate-500 dark:text-slate-400");
assert.equal(dis[2], DISCLAIMER);
assert.doesNotMatch(dis[2], /—|!/);

console.log("g218-figure-tone: all assertions passed");
