import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { PlanRecordView } from "../components/plans/PlanRecordView.tsx";
import { PlanCategoryTracking } from "../components/plans/PlanCategoryTracking.tsx";
import { PlanTrackingMethod } from "../components/plans/PlanTrackingMethod.tsx";
import { BalancesHiddenContext } from "../lib/balancesHidden.tsx";
const noop = () => {};
const account = { id: "current", name: "An exceptionally long joint household current account", provider: "Monzo", type: "bank", subtype: "CURRENT_ACCOUNT", currency: "GBP", balance: 300, manual: false };
let cases = 0;
for (const kind of ["goal", "set-aside"]) for (const hidden of [false, true]) for (const paused of [false, true]) {
  const html = renderToStaticMarkup(React.createElement(BalancesHiddenContext.Provider, { value: hidden }, React.createElement(PlanRecordView, { kind, contribution: paused ? 0 : 100, cadence: "each pay period", target: kind === "goal" ? { amount: 1200, month: "December 2028" } : undefined, progress: 300, sourceAccount: account, destinationAccounts: kind === "goal" ? [{ ...account, id: "pot", name: "Holiday pot" }] : [], trackingLabel: "Groceries category", paused })));
  assert.match(html, /data-plan-record/);
  assert.doesNotMatch(html, /NaN|Infinity|—|<button/);
  assert.equal(html.includes('role="progressbar"'), kind === "goal");
  if (hidden) { assert.doesNotMatch(html, /£1,200|£300|£100|aria-valuenow="300"/); assert.match(html, /Amount hidden/); }
  if (kind === "set-aside") assert.match(html, /Check Upcoming to see if it fits before payday/);
  if (paused) assert.match(html, /Paused/);
  cases++;
}
for (const kind of ["goal", "set-aside"]) {
  const html = renderToStaticMarkup(React.createElement(PlanCategoryTracking, { kind, sourceAccountId: "current", value: { category: "Groceries" }, onChange: noop }));
  assert.doesNotMatch(html, /<select|<option|proposed/i);
  assert.match(html, /type="radio"/);
  assert.match(html, /Checking this pay period/);
  assert.match(html, /does not change the amount held back/);
  cases++;
}
for (const method of ["payment", "category", "none"]) {
  const html = renderToStaticMarkup(React.createElement(PlanTrackingMethod, { value: method, onChange: noop }));
  assert.equal((html.match(/type="radio"/g) || []).length, 3);
  assert.equal((html.match(/checked=""/g) || []).length, 1);
  assert.doesNotMatch(html, /aria-pressed|<button/);
  cases++;
}
const source = path => readFileSync(new URL(path, import.meta.url), "utf8");
assert.match(source("../components/CommitmentSheet.tsx"), /commitment \? "main" : "details"/);
assert.match(source("../components/CommitmentSheet.tsx"), /setCreateNameStep\(false\)/);
assert.match(source("../components/CommitmentSheet.tsx"), /event\.preventDefault\(\); createNext\(\)/, "Review navigation must not default-submit the newly rendered Save button");
assert.match(source("../components/SetAsideSheet.tsx"), /"purpose", "details", "source", "destination", "tracking", "review"/);
// G311's Upcoming chooser and both handoffs are exercised in the browser
// journey; it no longer preselects an envelope before asking the user.
assert.match(source("../components/AllocationPlanEditor.tsx"), /onEdit/);
assert.match(source("../components/upcoming/UpcomingDetailFlow.tsx"), /key=\{`view-\$\{plan.id\}`\} initialMode="view" onEdit=/);
assert.match(source("../components/plans/PlanCategoryTracking.tsx"), /if \(!disposed\)/, "obsolete evidence cannot replace the current route");
console.log(`g291 production plan journey: ${cases} render contracts, guided entry, inline categories, privacy and host navigation passed`);
