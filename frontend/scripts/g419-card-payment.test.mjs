// Production G419 regressions. Uses the real sheets with only SheetFrame stubbed.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { register } from "node:module";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

const stub = new URL("./_sheetframe-stub.mjs", import.meta.url).href;
register("data:text/javascript," + encodeURIComponent(`export async function resolve(s,c,next){if(/(^|\\/)components\\/SheetFrame$/.test(s))return {url:${JSON.stringify(stub)},shortCircuit:true};return next(s,c);}`));
const { default: PaymentSheet } = await import("../components/card-settings/PaymentSheet.tsx");
const { default: RatesSheet } = await import("../components/card-settings/RatesSheet.tsx");
const { draftFromTerms, ruleFor, saveBody } = await import("../components/card-settings/paymentDraft.ts");

const noop = () => {};
const exact = { kind: "exact", text: "AMERICAN EXPRESS …20001", fingerprint: "a".repeat(64), salt: "b".repeat(32) };
const terms = { status: "confirmed", apr_pct: 24.9, promos: [{ kind: "purchases", apr_pct: 4.9, until: "2027-06-14" }], min_payment_note: "Keep this note", bt_offers: [{ ends: null, fee_pct: null, note: "Available if needed" }], confirmed_at: null, product_key: "product", usage: "clear_monthly", statement_close_day: 9, payment_due_day: 24, payment_due_days_after_close: null, payment_method: "full", payment_account_id: "payer", fixed_payment_amount: null, payment_match: exact };
const card = { account_id: "card", name: "Example card", provider: "Example", balance: -100, currency: "GBP", source: "finexer", ask_eligible: false, card_class: "credit_card", terms, statement_bill: { statement_start: "2026-10-10", statement_close: "2026-11-09", payment_due: "2026-11-24", next_payment_due: "2026-12-24", estimated_bill: 99.8, payment_amount: 99.8, payment_remaining: 0, paid_since_close: 99.8, spending_since_close: 20, payment_method: "full", payment_account_id: "payer", status: "paid", reason: null, estimated: true, next_payday: null } };

const exactDraft = draftFromTerms(terms);
assert.deepEqual(ruleFor(exactDraft), exact, "unchanged opaque exact identity survives the child draft");
const legacy = draftFromTerms({ ...terms, payment_match: { kind: "payment", series_key: "legacy-series" } });
assert.deepEqual(ruleFor(legacy), { kind: "payment", series_key: "legacy-series" }, "legacy recurring rule remains a distinct supported rule without a label");
const body = saveBody({ ...exactDraft, statementCloseDay: null, dueDay: null, dueMode: "day", method: "", fixed: "", payerId: "", ruleOn: false, rule: null, ruleText: "" });
assert.deepEqual(Object.keys(body).sort(), ["fixed_payment_amount", "payment_account_id", "payment_due_day", "payment_due_days_after_close", "payment_match", "payment_method", "statement_close_day"], "payment body is scoped to seven payment fields");
assert.deepEqual(body, { statement_close_day: null, payment_due_day: null, payment_due_days_after_close: null, payment_method: null, fixed_payment_amount: null, payment_account_id: null, payment_match: null }, "explicit nulls clear only those settings");

const services = { getCardPaymentAccounts: async () => ({ status: "ok", accounts: [] }), getCardPaymentHistory: async () => ({ status: "ok", payments: [], next_offset: null, from: "", through: "", history_from: null, history_complete: false }), previewCardPaymentMatch: async () => ({ status: "ok", rule: null, match_count: 0, latest: null, from: "", through: "", history_from: null, history_complete: false, ambiguous: false, reason: null }), saveCardPayment: async () => ({ status: "ok", terms }) };
const paymentHtml = renderToStaticMarkup(React.createElement(PaymentSheet, { card, hiddenOverride: false, onClose: noop, services }));
assert.match(paymentHtml, />Paid</); assert.match(paymentHtml, /£99\.80/); assert.doesNotMatch(paymentHtml, /£0\.00/);
const hiddenHtml = renderToStaticMarkup(React.createElement(PaymentSheet, { card, hiddenOverride: true, onClose: noop, services }));
assert.doesNotMatch(hiddenHtml, /99\.80|£99\.80|20\.00/, "hidden markup and accessible text contain no real amounts");
assert.match(hiddenHtml, /£••••/);
const ratesSource = readFileSync(new URL("../components/card-settings/RatesSheet.tsx", import.meta.url), "utf8");
assert.match(ratesSource, /String\(promo\.apr_pct\)/, "stored nonzero promo rate is retained");
assert.match(ratesSource, /note: row\.note\.trim\(\) \|\| null/, "offer notes remain in the rates draft");
assert.match(ratesSource, /ends: row\.ends === monthValue/, "dateless offers remain representable");
assert.doesNotMatch(ratesSource, /payment_account_id|payment_match|statement_close_day/, "rates payload cannot include payment fields");
const ratesHtml = renderToStaticMarkup(React.createElement(RatesSheet, { card, hiddenOverride: false, onClose: noop, services: { saveCardRates: async () => ({ status: "ok", terms }) } }));
assert.match(ratesHtml, /4\.9/); assert.match(ratesHtml, /Available if needed/);
console.log("g419-card-payment: ok");
