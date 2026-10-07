// G230 (2026-10-07): a goal plan's paying account. Pins the Edit plan "Paid
// from" field (counted current accounts only, inferred hedge, Not set, write
// only when picked) against the production CommitmentSheet, the account view's
// arithmetic and its footnote.
//
// Run: npm run -s check:g230-plan-source
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import React from "react";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime.js";
import { renderToStaticMarkup } from "react-dom/server";
import CommitmentSheet from "../components/CommitmentSheet.tsx";
import { accountPlan, hasPlanSource, plansFromApi } from "../lib/upcomingPlans.ts";

const noop = () => {};
const router = { back: noop, forward: noop, refresh: noop, push: noop, replace: noop, prefetch: noop };
const acct = (id, name, extra = {}) => ({ id, provider: "Bank", name, balance: 500, type: "bank", subtype: "CURRENT_ACCOUNT", currency: "GBP", status: "active", manual: false, ...extra });
const accounts = [
  acct("monzo", "Monzo Current"),
  acct("joint", "Joint bills", { include_in_safe_to_spend: false }),
  acct("amex", "Amex Gold", { type: "credit_card", subtype: "CREDIT_CARD" }),
  acct("pot", "Japan pot", { subtype: "SAVINGS_ACCOUNT" }),
];
const goal = (extra = {}) => ({
  id: "g", name: "Japan", amount: 1500, target_date: "2099-06-01",
  funding_pots: [{ account_id: "pot", name: "Japan pot", kind: "connected", count_existing: false, contributing_balance: 0 }],
  funding_account_id: "pot", funding_account_name: "Japan pot", source: "manual", status: "active",
  progress: 0, remaining: 1500, periods_left: 8, per_period_slice: 110, on_track: true, shared_pot_goals: [], ...extra,
});
const ops = { accounts: async () => accounts, previewCommitment: async () => null, createCommitment: async () => ({}), updateCommitment: async () => ({}), cancelCommitment: async () => {} };
const render = (commitment) => renderToStaticMarkup(React.createElement(AppRouterContext.Provider, { value: router }, React.createElement(CommitmentSheet, { accounts, commitment, operations: ops, onClose: noop })));

// The sheet renders in a portal after mount, so pin the source as well as the
// markup that SSR can reach.
const sheetSrc = readFileSync(new URL("../components/CommitmentSheet.tsx", import.meta.url), "utf8");
assert.match(sheetSrc, /label="Paid from"/, "Paid from field");
assert.match(sheetSrc, /unsetLabel="Not set"/, "Not set keeps the plan pooled-only");
assert.match(sheetSrc, /Based on recent transfers\./, "inferred hedge");
assert.match(sheetSrc, /include_in_safe_to_spend !== false/, "excluded accounts are omitted");
assert.match(sheetSrc, /saving\|isa/, "savings accounts are omitted");
assert.match(sheetSrc, /if \(sourceTouched\) \{ body\.source_account_id = sourceId \|\| null; body\.source_unset = !sourceId; \}/, "edit writes only when picked, Not set sends source_unset");
assert.match(sheetSrc, /\.\.\.\(sourceTouched \? \{ source_account_id: sourceId \|\| null, source_unset: !sourceId \} : \{\}\)/, "create writes only when picked");
assert.match(sheetSrc, /source_inferred\) && !sourceTouched/, "hedge drops once the user picks");
const markup = render(goal({ source_account_id: "monzo", source_inferred: true }));
for (const text of [sheetSrc]) {
  assert.ok(!text.includes("Paid from") || !/Paid from[^\n]*—/.test(text), "no em dash in the field copy");
}
assert.ok(typeof markup === "string");

// Account view arithmetic: the slice leaves its source account only.
const items = [
  { id: "goal:g", record_id: "g", kind: "goal", name: "Japan", destination: "Japan pot", destination_account_ids: ["pot"], source_account_id: "monzo", source_basis: "recent-transfers", inferred: true, period_amount: 80, filled_amount: null, remaining: 80, active: true },
  { id: "goal:h", record_id: "h", kind: "goal", name: "Car", destination: "Car pot", destination_account_ids: ["car"], source_account_id: null, source_basis: "unknown", inferred: false, period_amount: 50, filled_amount: null, remaining: 50, active: true },
];
const plans = plansFromApi(items);
assert.ok(hasPlanSource(plans[0]), "an inferred goal source counts as an estimate");
assert.ok(!hasPlanSource(plans[1]), "no source stays pooled-only");
const monzo = accountPlan({ id: "monzo", closing: 300 }, plans);
const premier = accountPlan({ id: "premier", closing: 300 }, plans);
assert.equal(monzo.goalPence, 8000);
assert.equal(monzo.afterPlans, 30000 - 8000);
assert.equal(monzo.estimated, true, "inferred slice is labelled estimated");
assert.equal(premier.goalPence, 0, "other accounts are untouched");
assert.equal(premier.afterPlans, 30000);
assert.equal(monzo.unassigned.length, 1, "the unsourced plan is listed as unassigned");

// Footnote.
const details = readFileSync(new URL("../components/upcoming/UpcomingAccountDetails.tsx", import.meta.url), "utf8");
assert.match(details, /Goal contributions count in the payday figure above\. This account view includes the plans paid from this account\./);
assert.doesNotMatch(details, /shows only the plans linked/);
console.log("g230-plan-source: ok");
