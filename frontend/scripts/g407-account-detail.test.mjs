// G407 C: the approved account detail puts the account judgement in one card,
// with actions in a separate Account details sheet and one joined activity surface.
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import AccountDetailLayout from "../components/AccountDetailLayout.tsx";
import AccountAvailabilityDetail from "../components/AccountAvailabilityDetail.tsx";
import CountTowardsSafeToSpendRow from "../components/CountTowardsSafeToSpendRow.tsx";
import AccountCountRow from "../components/AccountCountRow.tsx";

const h = React.createElement;
const noop = () => {};
const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const account = { id: "current", name: "Household account", type: "bank", subtype: "TRANSACTION", balance: 1453, currency: "GBP", provider: "Monzo", status: "connected" };
const layout = (props = {}) => renderToStaticMarkup(h(AccountDetailLayout, {
  account, accountName: account.name, providerLabel: "Monzo", balance: h("span", { className: "money" }, "£1,453.00"),
  forecast: h("p", null, "Forecast evidence"), activity: h("section", { "data-activity": true }, "Activity"), onDetails: noop, ...props,
}));
const availability = (reading, position, hidden = false) => renderToStaticMarkup(h(AccountAvailabilityDetail, { reading, position, hidden, layout: "calm" }));

// The approved C hierarchy is one bounded account card with a named native Details control.
const card = layout();
assert.match(card, /data-g407-variant="c"/);
assert.match(card, /data-account-facts/);
assert.match(card, /Bank balance/);
assert.match(card, /data-account-detail-heading/);
assert.match(card, /Household account/);
assert.match(card, /aria-label="Account details"/);
assert.match(card, /Forecast evidence/);
assert.match(card, /data-activity/);
assert.ok(card.indexOf("Forecast evidence") < card.indexOf("Activity"), "summary precedes activity");

// Real availability states, no re-calculation. A plans shortfall can have a
// positive closing-after-payments value; the stored lowest-after-plans wins.
const normal = availability({ kind: "ready", value: 170 }, { after_payments: 310, plans_reserved: 140, after_payments_and_plans: 170, low_point: 170, low_point_and_plans: 170 });
assert.match(normal, /Available to spend/);
assert.match(normal, /£170/);
assert.doesNotMatch(normal, /Projected shortfall/);
const payments = availability({ kind: "ready", value: 0, warning: "payments" }, { after_payments: -289, plans_reserved: 0, after_payments_and_plans: -289, low_point: -289 });
assert.match(payments, /£289.*short for payments/);
assert.match(payments, /text-rose-700/, "payment risk colours only its alert icon");
assert.match(payments, /Scheduled payments take the forecast below zero/);
const plans = availability({ kind: "ready", value: 0, warning: "plans" }, { after_payments: 40, plans_reserved: 65, after_payments_and_plans: -25, low_point: 40, low_point_and_plans: -25 });
assert.match(plans, /£25.*short after plans/);
assert.match(plans, /text-amber-800/, "plans alert stays amber");
assert.match(plans, /After scheduled payments.*£40/);
assert.match(plans, /Lowest after plans.*−£25/);
const noStoredShort = availability({ kind: "ready", value: 0, warning: "payments" }, {});
assert.match(noStoredShort, /Short for payments/);
assert.doesNotMatch(noStoredShort, /£0 short/, "never fabricates a shortfall amount");
assert.equal(availability({ kind: "checking" }, {}, false).includes("Checking availability…"), true);
const unknown = availability({ kind: "unavailable" }, {}, false);
assert.match(unknown, /Availability unavailable/);
assert.doesNotMatch(unknown, /£0|<details/, "unknown availability does not become a zero or evidence disclosure");
const hidden = availability({ kind: "ready", value: 0, warning: "plans" }, { after_payments: 40, after_payments_and_plans: -25, low_point_and_plans: -25 }, true);
assert.match(hidden, /−£••••/, "hidden evidence retains the negative sign");
assert.doesNotMatch(hidden, /25|40/, "hidden DOM does not leak stored figures");
const hiddenBalance = layout({ balance: h("span", { className: "money" }, "−£••••") });
assert.match(hiddenBalance, /−£••••/, "masked balance retains direction");

// The sheet owns the count setting. It remains visible when locked, excluded,
// refused or busy, and A175 savings semantics continue to suppress a switch.
const locked = renderToStaticMarkup(h(CountTowardsSafeToSpendRow, { counted: true, onChange: noop, calm: true, lockedReason: "Included while this account is short for payments." }));
assert.match(locked, /Include in estimated left to spend/);
assert.match(locked, /aria-checked="true"/);
assert.match(locked, /disabled=""/);
assert.match(locked, /Included while this account is short for payments/);
const excluded = renderToStaticMarkup(h(CountTowardsSafeToSpendRow, { counted: false, onChange: noop, calm: true }));
assert.match(excluded, /aria-checked="false"/);
assert.match(excluded, /Excluded from this estimate/);
const refusedBusy = renderToStaticMarkup(h(CountTowardsSafeToSpendRow, { counted: true, onChange: noop, calm: true, busy: true, reason: "This account pays an upcoming item." }));
assert.match(refusedBusy, /disabled=""/);
assert.match(refusedBusy, /data-g231-count-reason/);
const savings = renderToStaticMarkup(h(AccountCountRow, { account: { type: "bank", subtype: "SAVINGS" }, counted: true, onChange: noop, calm: true }));
assert.match(savings, /Savings are not counted in Left to spend/);
assert.doesNotMatch(savings, /role="switch"/, "A175 savings semantics remain unchanged");

// Production wiring: C owns the summary/activity only. Secondary and destructive
// actions are behind Account details and use closeThen before another surface/action.
const page = read("app/components/AccountsPage.tsx");
assert.match(page, /<AccountDetailLayout[\s\S]*?forecast=\{/);
assert.match(page, /layout="calm"/);
assert.match(page, /className=\{detailStyles\.activity\}/);
assert.match(page, /className=\{detailStyles\.activityTabs\}/);
assert.match(page, /className=\{detailStyles\.search\}/);
assert.match(page, /className=\{detailStyles\.rows\}/);
const sheet = page.slice(page.indexOf("accountDetailsFor === selectedAccount.id"), page.indexOf("{/* Transaction sheet"));
assert.match(sheet, /<AccountCountRow[\s\S]*?calm/);
assert.match(sheet, /lockedReason=\{available\?\.kind === "ready" && available\.warning/, "real shortfalls lock the inclusion switch");
assert.match(sheet, /<AccountRefreshRow[\s\S]*?compact/);
assert.match(sheet, /Unpin from Home|Pin to Home/);
assert.match(sheet, /Remove account/);
for (const action of ["handleReconnect", "openEditManual", "setShowStatementUpload", "openCardTermsAt", "handleDeleteAccount", "deleteManualAccount"]) assert.match(sheet, new RegExp(`closeThen\\(\\(\\) =>[\\s\\S]*?${action}`), `${action} closes Account details first`);
assert.match(page, /hideNetWorth && detailBalanceReady \? \(balance < 0 \? "Negative balance hidden" : "Balance hidden"\) : detailBalanceText/, "masked balance has a matching masked spoken value");

// G411: Account details opens full height in the same frame as "Tell me what this was" (focused variant),
// keeping every row, and the bank data line falls back to the last sync time.
assert.match(sheet, /<SheetFrame title="Account details"[^>]*variant="focused"/, "details sheet uses the full-height focused frame");
assert.doesNotMatch(sheet, /variant="compact"/, "details sheet is no longer the short compact sheet");
assert.doesNotMatch(readFileSync(new URL("../components/TeachingSheet.tsx", import.meta.url), "utf8").slice(0, 200000), /<SheetFrame[^>]*variant="compact"/, "the transaction sheet frame stays focused");
assert.match(sheet, /Include in estimated left to spend|<AccountCountRow/, "inclusion row kept");
assert.match(sheet, /consentExpiry/, "Connected until row kept");
{
  const { bankDataTimeLine } = await import("../lib/accountSheetNotes.ts");
  const now = Date.parse("2026-11-03T12:00:00Z");
  assert.equal(bankDataTimeLine({ bank_synced_to: null, transactions_synced_at: "2026-11-03T10:00:00Z" }, now), "Bank data updated 2 hours ago", "last sync is shown when Finexer reported no synced_to");
  assert.equal(bankDataTimeLine({ bank_synced_to: "2026-11-03T11:00:00Z", transactions_synced_at: "2026-11-03T10:00:00Z" }, now), "Bank data from 1 hour ago");
  assert.equal(bankDataTimeLine({ bank_synced_to: null, transactions_synced_at: null }, now), undefined);
  const { createElement: h } = await import("react");
  const { renderToStaticMarkup } = await import("react-dom/server");
  const { default: Row } = await import("../components/AccountRefreshRow.tsx");
  const html = renderToStaticMarkup(h(Row, { account: { id: "a", bank_synced_to: null, transactions_synced_at: "2026-11-03T10:00:00Z" }, onRefresh: async () => ({}), now, compact: true }));
  assert.match(html, /Bank data updated 2 hours ago/);
  assert.doesNotMatch(html, /not reported yet/, "never says not reported when a last-sync time exists");
}

console.log("g407 account detail C: ok");
