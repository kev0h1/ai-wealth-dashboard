// G441: a defined card bill whose amount cannot be estimated says so, in the
// Payment sheet and on the Upcoming row, and never reads as a confirmed amount.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { register } from "node:module";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

const stub = new URL("./_sheetframe-stub.mjs", import.meta.url).href;
register("data:text/javascript," + encodeURIComponent(`export async function resolve(s,c,next){if(/(^|\\/)components\\/SheetFrame$/.test(s))return {url:${JSON.stringify(stub)},shortCircuit:true};return next(s,c);}`));
const { default: PaymentSheet } = await import("../components/card-settings/PaymentSheet.tsx");

const noop = () => {};
const terms = { status: "confirmed", apr_pct: null, promos: [], min_payment_note: null, bt_offers: [], confirmed_at: null, product_key: null, usage: "clear_monthly", statement_close_day: 22, payment_due_day: 9, payment_due_days_after_close: null, payment_method: "full", payment_account_id: "payer", fixed_payment_amount: null, payment_match: { kind: "contains", text: "32000" } };
const card = { account_id: "card", name: "Example card", provider: "Example", balance: -100, currency: "GBP", source: "finexer", ask_eligible: false, card_class: "credit_card", terms, statement_bill: { statement_start: "2026-09-23", statement_close: "2026-10-22", payment_due: "2026-11-09", next_payment_due: "2026-12-09", estimated_bill: null, payment_amount: null, payment_remaining: null, paid_since_close: 0, spending_since_close: 20, payment_method: "full", payment_account_id: "payer", status: "amount_unknown", reason: "Amount not known yet. Your usual payment from past months is used until this statement can be read.", estimated: true, next_payday: null } };
const services = { getCardPaymentAccounts: async () => ({ status: "ok", accounts: [] }), getCardPaymentHistory: async () => ({ status: "ok", payments: [], next_offset: null, from: "", through: "", history_from: null, history_complete: false }), previewCardPaymentMatch: async () => ({ status: "ok", rule: null, match_count: 0, latest: null, from: "", through: "", history_from: null, history_complete: false, ambiguous: false, reason: null }), saveCardPayment: async () => ({ status: "ok", terms }) };
const html = renderToStaticMarkup(React.createElement(PaymentSheet, { card, hiddenOverride: false, onClose: noop, services }));
assert.match(html, /Amount not known yet/);
assert.doesNotMatch(html, /not enough settled card history/);
assert.doesNotMatch(html, /data-estimated-bill/, "no bill figure is invented");
assert.doesNotMatch(html, /—/, "no em dashes");

const row = readFileSync(new URL("../components/upcoming/UpcomingRow.tsx", import.meta.url), "utf8");
assert.match(row, /statement_unknown/);
assert.match(row, /amount not known yet/);
const details = readFileSync(new URL("../components/upcoming/UpcomingRowDetails.tsx", import.meta.url), "utf8");
assert.match(details, /Amount not known yet/);
console.log("g441-card-bill-unknown: ok");
