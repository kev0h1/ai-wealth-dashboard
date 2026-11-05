// G412/G419: card facts remain server-derived while their editor has moved.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const oldSheet = readFileSync(new URL("../components/CardTermsSheet.tsx", import.meta.url), "utf8");
const payment = readFileSync(new URL("../components/card-settings/PaymentSheet.tsx", import.meta.url), "utf8");
const accounts = readFileSync(new URL("../app/components/AccountsPage.tsx", import.meta.url), "utf8");
const api = readFileSync(new URL("../lib/api.ts", import.meta.url), "utf8");

assert.match(payment, /\bbill\s*=\s*card\.statement_bill/, "Payment renders the server bill directly");
assert.match(payment, /bill\?\.status\s*===\s*"paid"\s*\?\s*bill\.payment_amount/, "a paid bill retains its actual amount, never £0");
assert.match(payment, /hasAmount\(amount\)/, "unknown money is not fabricated as zero");
assert.match(payment, /spending_since_close/, "post-close spending remains separate from the bill");
assert.match(payment, /data-edit-schedule/, "date and method editor is reachable from Payment");
assert.match(payment, /data-edit-rule/, "match-rule editor is reachable from Payment");
assert.match(payment, /data-save-payment/, "only the root Payment sheet persists its draft");
assert.doesNotMatch(oldSheet, /Which payment is this bill\?|payment_match: paymentMatch|getCardPayerPayments/, "the legacy rates walk has no competing payment editor");
assert.match(accounts, /<CardPaymentSheet/, "Account details opens the dedicated Payment sheet");
assert.match(accounts, /<CardRatesSheet/, "rates and deals has its own sheet");
assert.match(accounts, /account\.status !== "expired"/, "only connected payment accounts can be selected");
assert.match(accounts, /accountKind\(account\) === "Current"\)/, "savings cannot pay a card");
assert.doesNotMatch(accounts, /\["Current", "Savings"\]/, "no savings payer is offered");
assert.match(accounts, /isCountedInLeftToSpend\(account\)/, "excluded accounts cannot be selected");
assert.match(api, /export type CardStatementBill/, "the API documents server bill evidence");
assert.match(api, /statement_bill\?: CardStatementBill \| null/, "older cached card responses remain valid");
assert.match(api, /payment_match\?: CardPaymentMatch \| null/, "the API carries payment matching");
assert.match(api, /saveCardPayment/, "payment has a scoped save endpoint");
assert.match(api, /saveCardRates/, "rates have a scoped save endpoint");
console.log("g412-card-details: ok");
