// G339: the account row keeps its existing balance and adds one conservative
// Available caption when the server has supplied the spend-from limit.
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import AccountLedgerRow from "../components/AccountLedgerRow.tsx";
import HomeEstateSection from "../components/HomeEstateSection.tsx";
import { bankToRow } from "../lib/accountsEstate.ts";
import { accountAvailability, formatAvailabilityAmount } from "../lib/accountAvailability.ts";
import { BalancesHiddenContext } from "../lib/balancesHidden.tsx";

const h = React.createElement;
const noop = () => {};
const account = (extra = {}) => ({
  id: "barclays", name: "Premier Current Account", type: "Current", subtype: "CURRENT",
  balance: 108, currency: "GBP", provider: "Barclays", status: "connected", ...extra,
});
const position = (extra = {}) => ({
  spend_from_headroom: 8, after_payments_and_plans: 18, low_point: 58,
  after_payments: 68, low_point_and_plans: 8, estimated: false,
  spend_from_capped: false, account_headroom_raw: 8, ...extra,
});
const snap = (extra = {}) => ({ status: "ready", positions: { barclays: position() }, ...extra });
const row = (acc = account()) => bankToRow(acc, []);
const renderRow = (props = {}) => renderToStaticMarkup(h(AccountLedgerRow, { row: row(), onClick: noop, ...props }));
const textOf = (html) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
const renderHome = (extra = {}, hidden = false) => renderToStaticMarkup(
  h(BalancesHiddenContext.Provider, { value: hidden }, h(HomeEstateSection, {
    loading: false, accountCount: 1, topPickAccounts: [account()], totalAccountCount: 1,
    pinnedIds: [], onOpenAccount: noop, onOpenInvestments: noop, onViewAll: noop,
    emptyState: null, availabilitySnapshot: snap(), ...extra,
  })),
);

// The server-provided Spend from limit wins over the larger payday closing number.
const normal = accountAvailability(account(), snap());
assert.equal(normal.kind, "ready"); assert.equal(normal.value, 8); assert.equal(normal.warning, undefined);
assert.equal(normal.note, "Estimated limit after known payments and plans this pay period. Separate account limits, not amounts to add together.");
assert.equal(accountAvailability(account(), snap({ positions: { barclays: position({ spend_from_headroom: 4, after_payments_and_plans: 99 }) } })).value, 4);
assert.equal(accountAvailability(account(), snap({ positions: { barclays: position({ spend_from_headroom: 4, spend_from_capped: true, account_headroom_raw: 99 }) } })).value, 4);
assert.equal(accountAvailability(account(), snap({ positions: { barclays: position({ spend_from_headroom: 0, low_point: -2, after_payments: -1 }) } })).warning, "payments");
assert.equal(accountAvailability(account(), snap({ positions: { barclays: position({ spend_from_headroom: 0, low_point_and_plans: -2, after_payments_and_plans: -1 }) } })).warning, "plans");

assert.equal(accountAvailability(account(), snap({ positions: {} })).kind, "unavailable");
for (const bad of [
  { uncertain: true }, { spend_from_headroom: undefined }, { spend_from_headroom: NaN },
  { spend_from_headroom: -1 }, { after_payments_and_plans: undefined }, { after_payments_and_plans: Infinity },
]) assert.equal(accountAvailability(account(), snap({ positions: { barclays: position(bad) } })).kind, "unavailable");
assert.equal(accountAvailability(account(), { status: "loading", positions: { barclays: position() } }).kind, "checking");
assert.equal(accountAvailability(account(), { status: "failed", positions: { barclays: position() } }).kind, "unavailable");
for (const extra of [
  { include_in_safe_to_spend: false }, { manual: true }, { currency: "USD" }, { type: "Savings" },
]) assert.equal(accountAvailability(account(extra), snap()), undefined);
for (const extra of [{ paused: true }, { status: "expired" }]) assert.equal(accountAvailability(account(extra), snap()).kind, "unavailable");
assert.equal(formatAvailabilityAmount(8.25), "£8.25");
assert.equal(formatAvailabilityAmount(-8.25), "−£8.25");

// The actual row preserves its old output when the prop is absent or undefined.
assert.equal(renderRow(), renderRow({ availability: undefined }));
const ready = renderRow({ availability: accountAvailability(account(), snap()) });
assert.match(ready, /£108/); assert.match(textOf(ready), /Available £8/); assert.match(ready, /available £8/);
assert.match(ready, /data-g339-availability/);
const hidden = renderRow({ availability: accountAvailability(account(), snap()), hideAmount: true });
assert.match(hidden, /available amount hidden/); assert.match(hidden, /Amount hidden|amount hidden/); assert.ok(!hidden.includes("£108") && !hidden.includes("£8"));
assert.match(textOf(renderRow({ availability: { kind: "ready", value: 0 } })), /Available £0/);
for (const reading of [{ kind: "checking" }, { kind: "unavailable" }]) {
  const html = renderRow({ availability: reading });
  assert.match(html, new RegExp(reading.kind === "checking" ? "Checking…" : "Unavailable"));
  assert.ok(!html.includes("£0"));
}
const syncing = renderRow({ availability: { kind: "ready", value: 8 }, sync: { kind: "refresh", phase: "syncing", asOf: "2026-10-26T10:00:00Z", bank: "Barclays" } });
assert.ok(!syncing.includes("data-g339-availability") && syncing.includes("Updating from Barclays"));
assert.ok(!renderRow({ row: row(account({ type: "Savings" })), availability: { kind: "ready", value: 8 } }).includes("Available"));
const overdrawn = renderRow({ row: row(account({ balance: -20 })), availability: { kind: "ready", value: 8 } });
assert.match(overdrawn, /overdrawn/); assert.ok(!textOf(overdrawn).match(/overdrawn\s*$/));

const paymentsRow = renderRow({ availability: accountAvailability(account(), snap({ positions: { barclays: position({ spend_from_headroom: 0, low_point: -2 }) } })) });
const plansRow = renderRow({ availability: accountAvailability(account(), snap({ positions: { barclays: position({ spend_from_headroom: 0, low_point_and_plans: -2 }) } })) });
assert.match(paymentsRow, /text-rose-700/); assert.match(plansRow, /text-amber-800/); assert.doesNotMatch(plansRow, /text-rose-/);

// Home wires the same exact server value into the real row and masks it with the balance provider.
const home = renderHome();
assert.match(home, /£108/); assert.match(textOf(home), /Available £8/); assert.match(home, /available £8/);
const homeHidden = renderHome({}, true);
assert.ok(!/£\d/.test(homeHidden) && homeHidden.includes("available amount hidden"));
const homeAbsent = renderHome({ availabilitySnapshot: undefined });
assert.ok(!homeAbsent.includes("data-g339-availability"));

console.log("g339 account availability tests passed");
