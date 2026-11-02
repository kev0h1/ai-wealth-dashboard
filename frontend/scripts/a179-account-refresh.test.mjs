// A179: the account sheet's Refresh control: states, copy, wiring, no red.
import assert from "node:assert/strict";
import fs from "node:fs";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import AccountRefreshRow from "../components/AccountRefreshRow.tsx";
import {
  REFRESH_LABEL, REFRESHING_LABEL, REFRESH_STILL_RUNNING, REFRESH_FAILED,
  canRefreshAccount, refreshClock, refreshControlState, refreshNote,
} from "../lib/accountRefresh.ts";

const now = Date.parse("2026-11-01T12:00:00Z");
const render = (el) => renderToStaticMarkup(el);
const acct = (o = {}) => ({ id: "a", name: "A", type: "bank", subtype: "TRANSACTION", balance: 1, currency: "GBP", provider: "Monzo", connection_id: "c1", ...o });
const noop = async () => ({ refreshed: true });

// Copy.
assert.equal(REFRESH_LABEL, "Refresh");
assert.equal(REFRESHING_LABEL, "Refreshing");
assert.equal(REFRESH_STILL_RUNNING, "Still refreshing. This can take a minute.");
assert.equal(REFRESH_FAILED, "We could not refresh this account just now. Try again in a moment.");

// Clock in UK time (GMT in November, BST in summer).
assert.equal(refreshClock("2026-11-01T14:05:00Z"), "14:05");
assert.equal(refreshClock("2026-07-01T14:05:00Z"), "15:05");
assert.equal(refreshClock("nonsense"), undefined);

// States.
assert.deepEqual(refreshControlState({ refreshing: false, now }), { disabled: false, label: "Refresh", spinning: false });
assert.deepEqual(refreshControlState({ refreshing: true, now }), { disabled: true, label: "Refreshing", spinning: true });
assert.deepEqual(
  refreshControlState({ refreshing: false, nextAllowedAt: "2026-11-01T12:45:00Z", now }),
  { disabled: true, label: "Next refresh from 12:45", spinning: false },
);
assert.equal(refreshControlState({ refreshing: false, nextAllowedAt: "2026-11-01T11:00:00Z", now }).disabled, false, "a past time re-enables");
assert.equal(refreshControlState({ refreshing: true, nextAllowedAt: "2026-11-01T12:45:00Z", now }).label, "Refreshing");

// Notes.
assert.equal(refreshNote(null, true), REFRESH_FAILED);
assert.equal(refreshNote({ refreshed: false, in_progress: true }, false), REFRESH_STILL_RUNNING);
assert.equal(refreshNote({ refreshed: true }, false), undefined);
assert.equal(refreshNote({ refreshed: false, message: "Reconnect this bank to refresh it." }, false), "Reconnect this bank to refresh it.");

// Which accounts get the control.
assert.equal(canRefreshAccount(acct()), true);
assert.equal(canRefreshAccount(acct({ manual: true })), false);
assert.equal(canRefreshAccount(acct({ id: "statement-1" })), false);
assert.equal(canRefreshAccount(acct({ connection_id: undefined })), false);
assert.equal(canRefreshAccount(acct({ paused: true })), false);

// Rendering.
let html = render(React.createElement(AccountRefreshRow, { account: acct({ bank_synced_to: "2026-11-01T10:00:00Z" }), onRefresh: noop, now }));
assert.match(html, /Bank data from 2 hours ago/);
assert.match(html, /data-a179-refresh-button/);
assert.match(html, /<span>Refresh<\/span>/);
assert.doesNotMatch(html, /disabled=""/);
assert.match(html, /min-h-11/, "44px target");
html = render(React.createElement(AccountRefreshRow, { account: acct({ bank_synced_to: "2026-11-01T10:00:00Z", bank_next_refresh_at: "2026-11-01T12:45:00Z" }), onRefresh: noop, now }));
assert.match(html, /Next refresh from 12:45/);
assert.match(html, /disabled=""/);
html = render(React.createElement(AccountRefreshRow, { account: acct(), onRefresh: noop, now }));
assert.match(html, /Bank data time not reported yet/);
html = render(React.createElement(AccountRefreshRow, { account: acct({ transactions_synced_at: "2026-11-01T11:30:00Z" }), onRefresh: noop, now }));
assert.match(html, /Bank data updated 30 min ago/);

// Wiring, both themes and no red or em dashes in the new files.
const page = fs.readFileSync(new URL("../app/components/AccountsPage.tsx", import.meta.url), "utf8");
assert.match(page, /<AccountRefreshRow\s+key=\{selectedAccount\.id\}\s+account=\{selectedAccount\}/);
assert.match(page, /canRefreshAccount\(selectedAccount\)/);
assert.match(page, /api\.refreshAccount\(id\)/);
for (const f of ["../lib/accountRefresh.ts", "../components/AccountRefreshRow.tsx"]) {
  const src = fs.readFileSync(new URL(f, import.meta.url), "utf8");
  assert.doesNotMatch(src, /—/, `${f} has an em dash`);
  assert.doesNotMatch(src, /\b(?:red|rose)-\d{2,3}\b|#ef4444|#dc2626/i, `${f} uses red`);
  assert.doesNotMatch(src, /!"|! </, `${f} has an exclamation mark in copy`);
}
const row = fs.readFileSync(new URL("../components/AccountRefreshRow.tsx", import.meta.url), "utf8");
assert.match(row, /dark:text-slate-100/, "dark theme classes present");
const compact = render(React.createElement(AccountRefreshRow, { account: acct({ bank_synced_to: "2026-11-01T10:00:00Z", bank_next_refresh_at: "2026-11-01T12:45:00Z" }), onRefresh: noop, now, compact: true }));
assert.doesNotMatch(compact, /glass-card/, "G406 freshness is an unboxed facts row");
assert.match(compact, /Next refresh from/);
assert.match(compact, /disabled=""/, "compact mode preserves the hourly cooldown");
const facts = page.slice(page.indexOf("<div data-account-facts"), page.indexOf("{pinMsg &&"));
assert.match(facts, /<AccountRefreshRow[^>]+\bcompact\s*\/>/, "refresh lives with the account facts");
console.log("a179 account refresh: ok");
