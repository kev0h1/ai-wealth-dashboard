import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import SafeToSpendDisclosures from "../components/SafeToSpendDisclosures.tsx";
import { IncomeEvidenceSheetBody } from "../components/IncomeEvidenceSheet.tsx";
import { isReconciledIncomeEvidence, isSafeIncomeTransactionsHref } from "../lib/incomeEvidence.ts";

const evidence = {
  total: 1800,
  status: "complete",
  transactions_href: "/transactions?transaction_id=income-1&transaction_id=income-2&txn_type=credit",
  transactions_scope: "sources",
  items: [
    { key: "salary", payer: "Extremely Long Employer Name With A Payroll Reference", amount: 900, expected_date: "2026-11-20", account_id: "a", account_name: "Everyday account ending 1234", account_bank: "Example", cadence: "weekly", occurrences: 4, last_received: "2026-11-13", confirmed: true, basis: "Confirmed income schedule.", transactions_href: "/transactions?transaction_id=income-1&txn_type=credit", transactions_scope: "sources" },
    { key: "salary", payer: "Extremely Long Employer Name With A Payroll Reference", amount: 900, expected_date: "2026-11-27", account_id: "a", account_name: "Everyday account ending 1234", account_bank: "Example", cadence: "weekly", occurrences: 4, last_received: "2026-11-13", confirmed: true, basis: "Confirmed income schedule.", transactions_href: "/transactions?transaction_id=income-2&txn_type=credit", transactions_scope: "sources" },
  ],
};
const renderBody = (group, scalar, hidden = false) => renderToStaticMarkup(React.createElement(IncomeEvidenceSheetBody, { group, scalar, kind: "before_payday", formatIncome: value => hidden ? "+£••••" : `+£${value.toFixed(2)}`, onRetry: () => {}, onOpenTransactions: () => {} }));

// Shared with the backend producer test: this catches wire-name, bounds and
// opaque-ID drift that isolated frontend-made fixtures cannot catch.
const backendCase = JSON.parse(readFileSync(new URL("../../shared/income-evidence-case.json", import.meta.url), "utf8"));
assert.equal(isReconciledIncomeEvidence(backendCase.before_payday, backendCase.before_payday.total), true);
assert.equal(isSafeIncomeTransactionsHref(backendCase.before_payday.transactions_href, "sources"), true);
assert.match(renderBody(backendCase.before_payday, 2850), /Alder Payroll/);
const wideSources = new URLSearchParams({ txn_type: "credit", label: "Source credits" });
for (let n = 0; n < 60; n++) wideSources.append("transaction_id", `opaque:receipt/${String(n).padStart(3, "0")}-${"x".repeat(20)}`);
assert.equal(isSafeIncomeTransactionsHref(`/transactions?${wideSources}`, "sources"), true);
assert.equal(isSafeIncomeTransactionsHref("/transactions?transaction_id=receipt&direction=credit", "sources"), false);

const reconciled = renderBody(evidence, 1800);
assert.match(reconciled, /2 expected payments before payday/);
assert.match(reconciled, /Extremely Long Employer Name/);
assert.match(reconciled, /20 Nov/);
assert.match(reconciled, /See these in transactions/);
assert.match(reconciled, /<a href="\/transactions\?transaction_id=income-1&amp;txn_type=credit"/, "source navigation retains a real link for keyboard and new-tab use");
assert.match(reconciled, /\+£900\.00/);
assert.match(reconciled, /confirmed income/);
assert.match(reconciled, /Example · Everyday account ending 1234/);
assert.equal((reconciled.match(/class="incomeItem"/g) ?? []).length, 2, "repeated series occurrences remain distinct rows");
assert.match(reconciled, /20 Nov/); assert.match(reconciled, /27 Nov/);

const periodHref = "/transactions?category=Income&txn_type=credit&from=2026-11-01&to=2026-11-30";
const periodFallback = renderBody({ ...evidence, transactions_scope: "income_period", transactions_href: periodHref }, 1800);
assert.match(periodFallback, /This opens all Income-category credits for this period/);

const unavailable = renderBody({ ...evidence, total: 1799 }, 1800);
assert.match(unavailable, /Source history is unavailable/);
assert.doesNotMatch(unavailable, /Extremely Long Employer Name/);

const empty = renderBody({ ...evidence, total: 0, items: [] }, 0);
assert.match(empty, /No predicted income is counted before payday/);

const masked = renderBody(evidence, 1800, true);
assert.doesNotMatch(masked, /900\.00|1,800/);
assert.match(masked, /Amount hidden/);

const zeroHistory = renderBody({ ...evidence, total: 900, items: [{ ...evidence.items[0], occurrences: 0, last_received: null, transactions_href: null, transactions_scope: "none" }] }, 900);
assert.match(zeroHistory, /Schedule: weekly\. No matching historical credits yet/);
assert.ok(!isReconciledIncomeEvidence({ ...evidence, items: [{ ...evidence.items[0], expected_date: "not-a-date" }] }, 900), "malformed dates fail closed");
assert.ok(!isReconciledIncomeEvidence({ ...evidence, transactions_href: "https://example.test/transactions?transaction_id=x&txn_type=credit" }, 1800), "unsafe links fail closed");
assert.equal(isSafeIncomeTransactionsHref("https://example.test/transactions?transaction_id=x&txn_type=credit", "sources"), false, "external transaction links fail closed");
assert.equal(isSafeIncomeTransactionsHref("/transactions?transaction_id=x&txn_type=credit", "sources"), true, "bounded local source links remain available");

const data = { status: "ok", safe_to_spend: 100, next_payday: "2026-12-01", days_until_payday: 22, bills_total: 500, income_before_payday: 1800, buffer: 0, state: "comfortable", estimated: false, payday_income: 2200, income_evidence: { as_of: "2026-11-09", before_payday: evidence, expected_pay: { ...evidence, total: 2200, items: [{ ...evidence.items[0], amount: 2200, expected_date: "2026-12-01" }] } } };
const additiveEvidence = { summaryLabel: "How we got", summaryAmount: 100, rows: [{ label: "Cash now", value: -1200 }, { label: "Income before payday", value: 1800 }, { label: "Left to spend", value: 100, total: true }], ledgerNote: null, dailyAmount: null, incomeBeforePayday: null };
const disclosure = renderToStaticMarkup(React.createElement(SafeToSpendDisclosures, { disclaimer: "Estimate.", data, evidence: additiveEvidence, format: value => `£${value}`, formatIncome: value => `+£${value.toFixed(2)}`, paydayLabel: "Tue 1 Dec", syncing: false, showCardsLink: false, reservationDetails: null }));
assert.equal((disclosure.match(/Income before payday/g) ?? []).length, 1, "the additive ledger row is the sole income-before-payday trigger");
assert.match(disclosure, /Expected pay/);

console.log("g446-income-evidence: reconciled, unavailable, empty, masked, and non-duplicated ledger income passed");
