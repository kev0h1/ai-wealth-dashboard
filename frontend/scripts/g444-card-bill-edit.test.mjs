// G444: Edit on a defined card bill opens the statement amount entry (prefilled with the
// estimate), the Payment sheet shows the same field and how the estimate was made, and the
// working is hidden when balances are hidden.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { register } from "node:module";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

const stub = new URL("./_sheetframe-stub.mjs", import.meta.url).href;
register("data:text/javascript," + encodeURIComponent(`export async function resolve(s,c,next){if(/(^|\\/)components\\/SheetFrame$/.test(s))return {url:${JSON.stringify(stub)},shortCircuit:true};return next(s,c);}`));
const { default: PaymentSheet } = await import("../components/card-settings/PaymentSheet.tsx");
const entry = await import("../components/card-settings/StatementAmountEntry.tsx");

const noop = () => {};
const plain = (html) => html.replace(/<[^>]+>/g, "");
const terms = { status: "confirmed", apr_pct: null, promos: [], min_payment_note: null, bt_offers: [], confirmed_at: null, product_key: null, usage: "clear_monthly", statement_close_day: 22, payment_due_day: 9, payment_due_days_after_close: null, payment_method: "full", payment_account_id: "payer", fixed_payment_amount: null, payment_match: { kind: "contains", text: "32000" } };
const working = { balance_owed: 2000, balance_as_of: "2026-11-08T09:00:00+00:00", spent_since_close: 117.49, credits_since_close: 20, pending_excluded: 0, stale_excluded: 0, stale_excluded_count: 0, card_estimate: 1902.51 };
const bill = { statement_start: "2026-09-23", statement_close: "2026-10-22", payment_due: "2026-11-09", next_payment_due: "2026-12-09", estimated_bill: 1902.51, payment_amount: 1902.51, payment_remaining: 1902.51, paid_since_close: 0, spending_since_close: 117.49, payment_method: "full", payment_account_id: "payer", status: "estimated", reason: null, estimated: true, next_payday: null, working };
const card = { account_id: "card", name: "Example card", provider: "Example", balance: -2000, currency: "GBP", source: "finexer", ask_eligible: false, card_class: "credit_card", terms, statement_bill: bill };
const services = { saveCardStatementAmount: async () => ({ status: "ok", terms }), clearCardStatementAmount: async () => ({ status: "ok", terms }), getCardPaymentAccounts: async () => ({ status: "ok", accounts: [] }), getCardPaymentHistory: async () => ({ status: "ok", payments: [], next_offset: null, from: "", through: "", history_from: null, history_complete: false }), previewCardPaymentMatch: async () => ({ status: "ok", rule: null, match_count: 0, latest: null, from: "", through: "", history_from: null, history_complete: false, ambiguous: false, reason: null }), saveCardPayment: async () => ({ status: "ok", terms }) };
const sheet = (c, hidden = false) => renderToStaticMarkup(React.createElement(PaymentSheet, { card: c, hiddenOverride: hidden, onClose: noop, services }));

// The Payment sheet: field, label, helper, prefill, working.
const html = sheet(card);
assert.match(html, /data-statement-amount-entry/);
assert.match(html, /Estimated from your card/);
assert.match(html, /You can enter the exact amount from your statement/);
assert.match(html, /value="1902\.51"/, "prefilled with the estimate");
assert.match(html, /data-save-statement-amount/);
assert.match(html, /How this was estimated/);
assert.match(plain(html), /Card balance £2,000\.00 on 8 Nov, less £117\.49 spent since 22 Oct, plus £20\.00 paid or refunded\./);
assert.doesNotMatch(html, /—|!/, "no em dashes or exclamation marks");

// Every full status shows it; other methods keep their own editor.
for (const status of ["amount_unknown", "incomplete_history"]) {
  const c = { ...card, statement_bill: { ...bill, status, estimated_bill: null, payment_amount: null, payment_remaining: null, working: { ...working, card_estimate: null }, reason: "Not known." } };
  const out = sheet(c);
  assert.match(out, /data-statement-amount-entry/, status);
  assert.match(out, /Enter this statement&#x27;s amount/, "no estimate to prefill, so the plain label");
  assert.doesNotMatch(out, /value="1902/);
}
for (const method of ["fixed", "minimum", "manual"]) {
  assert.doesNotMatch(sheet({ ...card, statement_bill: { ...bill, payment_method: method } }), /data-statement-amount-entry/, method);
}
assert.doesNotMatch(sheet({ ...card, statement_bill: { ...bill, status: "paid" } }), /data-statement-amount-entry/, "a paid bill has nothing to correct");

// An entered amount: the field shows it, the estimate stays visible in the working.
const entered = { ...card, terms: { ...terms, statement_amount_override: { close_date: "2026-10-22", amount: 2640.78 } }, statement_bill: { ...bill, user_entered: true, estimated_bill: 2640.78, payment_amount: 2640.78, payment_remaining: 2640.78 } };
const enteredHtml = sheet(entered);
assert.match(enteredHtml, /Your statement amount/); assert.match(enteredHtml, /value="2640\.78"/); assert.match(enteredHtml, /Entered by you/);

// Hidden balances: no figures in the working, no value in the field.
const hiddenHtml = sheet(card, true);
assert.match(hiddenHtml, /Hidden while balances are hidden/);
assert.doesNotMatch(hiddenHtml, /Card balance/); assert.doesNotMatch(hiddenHtml, /2,000\.00|117\.49/);
assert.match(hiddenHtml, /Amount hidden/);

// The working line, late and pending rows included.
assert.match(entry.workingLine({ ...bill, working: { ...working, pending_excluded: 60, stale_excluded: 648.19, stale_excluded_count: 1 } }), /£60\.00 still pending is not counted\. £648\.19 first seen after that balance was read is not counted\./);
assert.equal(entry.workingLine({ ...bill, working: null }), null);
assert.equal(entry.parseStatementAmount("£2,640.78"), 2640.78); assert.equal(entry.parseStatementAmount("0"), null); assert.equal(entry.parseStatementAmount("100000.01"), null);

// Upcoming: Edit on a defined card bill routes to the statement amount editor, saves through
// the existing endpoint, and refreshes the money views.
const flow = readFileSync(new URL("../components/upcoming/UpcomingDetailFlow.tsx", import.meta.url), "utf8");
assert.match(flow, /payment\.cardId && !payment\.planned/);
assert.ok(flow.indexOf("<CardBillAmountEdit") < flow.indexOf("<UpcomingEditForm"), "the card bill editor is chosen before the generic prediction editor");
const planning = readFileSync(new URL("../app/planning/PlanningPage.tsx", import.meta.url), "utf8");
assert.match(planning, /cardId: item\.type === "bill" && !isPlanned && item\.is_card_repayment && item\.card_dest_account_id/);
for (const basis of ["statement_estimate", "user_entered", "statement_unknown"]) assert.ok(planning.includes(`item.amount_basis === "${basis}"`), basis);
assert.ok(!planning.includes('item.amount_basis === "fixed_payment"'), "a fixed payment keeps the prediction editor");
const edit = readFileSync(new URL("../components/upcoming/CardBillAmountEdit.tsx", import.meta.url), "utf8");
assert.match(edit, /services\.saveCardStatementAmount\(cardId, value\)/);
assert.match(edit, /invalidateVerdictCache\(\)/);
assert.match(edit, /await onSaved\(\)/, "the Upcoming refresh is awaited after the save");
assert.match(edit, /StatementWorking bill=\{bill\} hidden=\{hidden\}/);
assert.doesNotMatch(edit, /—|!"|!</, "no em dashes or exclamation marks");

const { CardBillAmountEdit } = await import("../components/upcoming/CardBillAmountEdit.tsx");
const renderEdit = (props) => renderToStaticMarkup(React.createElement(CardBillAmountEdit, { cardId: "card", onCancel: noop, onSaved: noop, services: { getCardTerms: async () => ({ status: "ok", cards: [card], rate_note: "" }), saveCardStatementAmount: async () => ({ status: "ok", terms }), clearCardStatementAmount: async () => ({ status: "ok", terms }) }, hiddenOverride: false, ...props }));
assert.match(renderEdit({}), /Loading the card bill/, "the card is loaded before the field shows");
const upcoming = renderEdit({ initialBill: bill });
assert.match(upcoming, /data-statement-amount-entry/); assert.match(upcoming, /Estimated from your card/);
assert.match(upcoming, /You can enter the exact amount from your statement/); assert.match(upcoming, /value="1902\.51"/);
assert.match(upcoming, /How this was estimated/); assert.match(plain(upcoming), /Card balance £2,000\.00/);
assert.match(upcoming, /Save changes/, "saved from the sheet footer");
assert.doesNotMatch(upcoming, /Expected date|Skip this month|Not a bill/, "none of the generic prediction controls");
assert.doesNotMatch(renderEdit({ initialBill: bill, hiddenOverride: true }), /Card balance|2,000\.00/);
assert.match(renderEdit({ initialBill: { ...bill, user_entered: true } }), /Clear my amount/);
assert.match(renderEdit({ initialBill: { ...bill, payment_method: "fixed" } }), /not paid in full/);
assert.match(renderEdit({ initialBill: null }), /could not load this card bill/);
console.log("g444-card-bill-edit: ok");
