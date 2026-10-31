// A175: honest empty state for a bank connection with no transactions, the
// bank-data time line, and no Left to spend switch on savings accounts.
import assert from "node:assert/strict";
import fs from "node:fs";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import AccountCountRow from "../components/AccountCountRow.tsx";
import AccountBankEmpty from "../components/AccountBankEmpty.tsx";
import { COUNT_TOWARDS_LABEL } from "../components/CountTowardsSafeToSpendRow.tsx";
import {
  NO_BANK_TRANSACTIONS, SAVINGS_NOT_COUNTED, bankDataUpdatedLine, bankDataFromLine, bankDataTimeLine, isSavingsAccount,
} from "../lib/accountSheetNotes.ts";

const now = Date.parse("2026-10-29T12:00:00Z");
const noop = () => {};
const render = (el) => renderToStaticMarkup(el);
const acct = (o = {}) => ({ id: "a", name: "A", type: "bank", subtype: "TRANSACTION", balance: 1, currency: "GBP", provider: "Monzo", ...o });

assert.equal(NO_BANK_TRANSACTIONS, "No transactions have arrived from this bank connection yet. The balance still updates.");
assert.equal(SAVINGS_NOT_COUNTED, "Savings are not counted in Left to spend.");

// Empty state: diagnostics present.
let html = render(React.createElement(AccountBankEmpty, {
  account: acct({ subtype: "SAVINGS", transactions_last_count: 0, transactions_synced_at: "2026-10-29T10:00:00Z" }), now,
}));
assert.match(html, /No transactions have arrived from this bank connection yet\. The balance still updates\./);
assert.match(html, /Bank data updated 2 hours ago/);
html = render(React.createElement(AccountBankEmpty, {
  account: acct({ transactions_last_count: 0, transactions_synced_at: "2026-10-20T10:00:00Z" }), now,
}));
assert.match(html, /Bank data updated 20 Oct/);
html = render(React.createElement(AccountBankEmpty, { account: acct({ transactions_last_count: 0 }), now }));
assert.match(html, /No transactions have arrived/);
assert.doesNotMatch(html, /Bank data updated/, "no time line without a timestamp");

// Empty state: diagnostics absent or non-zero count keeps the plain copy.
for (const account of [acct(), acct({ transactions_last_count: null }), acct({ transactions_last_count: 4 })]) {
  html = render(React.createElement(AccountBankEmpty, { account, now }));
  assert.match(html, />No transactions</);
  assert.doesNotMatch(html, /have arrived/);
}
assert.equal(bankDataUpdatedLine("not a date", now), undefined);
assert.equal(bankDataUpdatedLine("2026-10-29T11:59:30Z", now), "Bank data updated just now");

// A176: the bank's own time wins when present, else the A175 field.
assert.equal(bankDataFromLine("2026-10-29T09:00:00Z", now), "Bank data from 3 hours ago");
assert.equal(bankDataFromLine(null, now), undefined);
assert.equal(bankDataTimeLine({ bank_synced_to: "2026-10-29T11:00:00Z", transactions_synced_at: "2026-10-29T10:00:00Z" }, now), "Bank data from 1 hour ago");
assert.equal(bankDataTimeLine({ bank_synced_to: null, transactions_synced_at: "2026-10-29T10:00:00Z" }, now), "Bank data updated 2 hours ago");
html = render(React.createElement(AccountBankEmpty, {
  account: acct({ transactions_last_count: 0, bank_synced_to: "2026-10-29T11:30:00Z", transactions_synced_at: "2026-10-29T10:00:00Z" }), now,
}));
assert.match(html, /Bank data from 30 min ago/);
assert.doesNotMatch(html, /Bank data updated/);

// Savings: no switch, a plain line. Current: switch present.
assert.equal(isSavingsAccount({ type: "bank", subtype: "SAVINGS" }), true);
assert.equal(isSavingsAccount({ type: "Savings", subtype: undefined }), true);
assert.equal(isSavingsAccount({ type: "bank", subtype: "TRANSACTION" }), false);
assert.equal(isSavingsAccount({ type: "credit_card", subtype: "CREDIT_CARD" }), false);
const row = { counted: true, onChange: noop };
html = render(React.createElement(AccountCountRow, { account: { type: "bank", subtype: "SAVINGS" }, ...row }));
assert.match(html, /Savings are not counted in Left to spend\./);
assert.doesNotMatch(html, new RegExp(COUNT_TOWARDS_LABEL));
assert.doesNotMatch(html, /role="switch"|<button|checkbox/);
html = render(React.createElement(AccountCountRow, { account: { type: "bank", subtype: "SAVINGS" }, counted: false, onChange: noop }));
assert.match(html, new RegExp(COUNT_TOWARDS_LABEL), "savings already switched off keeps the switch");
assert.doesNotMatch(html, /Savings are not counted/);
html = render(React.createElement(AccountCountRow, { account: { type: "bank", subtype: "TRANSACTION" }, ...row }));
assert.match(html, new RegExp(COUNT_TOWARDS_LABEL));
assert.doesNotMatch(html, /Savings are not counted/);

// Wiring: the page uses both components and no em dashes slipped into the copy.
const page = fs.readFileSync(new URL("../app/components/AccountsPage.tsx", import.meta.url), "utf8");
assert.match(page, /<AccountCountRow\s+account=\{selectedAccount\}/);
assert.match(page, /<AccountBankEmpty account=\{selectedAccount\}/);
for (const f of ["../lib/accountSheetNotes.ts", "../components/AccountCountRow.tsx", "../components/AccountBankEmpty.tsx"]) {
  assert.doesNotMatch(fs.readFileSync(new URL(f, import.meta.url), "utf8"), /—/, `${f} has an em dash`);
}
console.log("a175 account empty state: ok");
