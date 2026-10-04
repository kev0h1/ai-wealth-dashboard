import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import FirstSyncCard from "../components/FirstSyncCard.tsx";

const conns = [{ provider: "finexer", bank: "ob-barclays" }];
const render = (state, extra = {}) =>
  renderToStaticMarkup(
    React.createElement(FirstSyncCard, { state, connections: conns, onRetry: () => {}, onConnect: () => {}, ...extra }),
  );

const syncing = render("syncing");
assert.match(syncing, /Barclays connected/);
assert.match(syncing, /Fetching transactions/);
assert.match(syncing, /Working out your figures/);
assert.match(syncing, /This usually takes a minute or two\./);
assert.doesNotMatch(syncing, /Try again/, "syncing offers no retry");

const stalled = render("stalled");
assert.match(stalled, /Still fetching from Barclays/);
assert.match(stalled, /This is taking longer than usual\. You can wait, or try again\./);
assert.match(stalled, /Try again/);
assert.doesNotMatch(stalled, /Connect a different bank/);

const failed = render("failed", { connections: [{ provider: "finexer", bank: "ob-barclays", error: "Traceback secret boom" }] });
assert.match(failed, /We couldn’t finish the first sync/);
assert.match(failed, /Try again/);
assert.match(failed, /Connect a different bank/);
assert.doesNotMatch(failed, /secret boom/, "raw error text is never rendered");

for (const html of [syncing, stalled, failed]) {
  assert.doesNotMatch(html, /\b(red|rose)-\d|text-red|bg-red|border-red/, "no red classes");
  assert.doesNotMatch(html, /—/, "no em dashes");
  assert.doesNotMatch(html, /role="alert"/, "a sync is not an error alert");
}
assert.match(render("syncing", { connections: [] }), /Your bank connected/);

// Source guards.
const home = readFileSync(new URL("../app/components/HomePage.tsx", import.meta.url), "utf8");
assert.match(home, /firstSyncActive && \(/, "HomePage renders FirstSyncCard under the sync condition");
assert.match(home, /<FirstSyncCard/);
assert.match(home, /api\.getSyncStatus\(\)/);
assert.match(home, /invalidateAllAccountData\(\);\s*await loadData\(\)/, "idle transition reloads Home once");

const sts = readFileSync(new URL("../components/SafeToSpendCard.tsx", import.meta.url), "utf8");
const iSync = sts.indexOf('data.calculation_status === "syncing") {\n    // G210');
const iDegraded = sts.indexOf('if (data.calculation_status === "degraded") {\n    return');
assert.ok(iSync > 0 && iDegraded > 0 && iSync < iDegraded, "syncing branch precedes degraded branch");
const block = sts.slice(iSync, iDegraded);
assert.doesNotMatch(block, /role="alert"/);
assert.match(block, /aria-busy="true"/);

const brief = readFileSync(new URL("../components/HomeBrief.tsx", import.meta.url), "utf8");
const iBriefSync = brief.indexOf('safeToSpend.calculation_status === "syncing"');
const iHeadroom = brief.indexOf("You've got headroom");
assert.ok(iBriefSync > 0 && iHeadroom > iBriefSync, "HomeBrief handles syncing before the headroom fallback");
assert.match(brief.slice(iBriefSync, iBriefSync + 300), /first sync is still running/);
const views = readFileSync(new URL("../lib/pennyScreenViews.ts", import.meta.url), "utf8");
assert.match(views, /calculation_status === "syncing"/, "Penny view builder guards syncing");
console.log("first-sync-card: ok");
