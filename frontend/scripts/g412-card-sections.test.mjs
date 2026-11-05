// G419 B: Account details is a compact two-entry launcher, not a second bill view.
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import CardDetailsSections, { ordinal, paymentRuleLabels } from "../components/CardDetailsSections.tsx";

const h = React.createElement;
const noop = () => {};
const card = {
  account_id: "card", name: "Example Rewards Card", provider: "Example Bank", balance: -474,
  currency: "GBP", source: "finexer", ask_eligible: false, card_class: "credit_card",
  terms: { status: "confirmed", apr_pct: 24.9, promos: [{ kind: "purchases", apr_pct: 0, until: "2099-05-31" }], min_payment_note: null, bt_offers: [], confirmed_at: null, product_key: null, usage: "clear_monthly", statement_close_day: 3, payment_due_day: 28, payment_due_days_after_close: null, payment_method: "full", payment_account_id: "pay", fixed_payment_amount: null, payment_match: { kind: "contains", text: "20001" } },
  statement_bill: { statement_start: "2026-09-04", statement_close: "2026-10-03", payment_due: "2026-10-28", next_payment_due: "2026-11-28", estimated_bill: 412.5, payment_amount: 412.5, payment_remaining: 412.5, paid_since_close: 0, spending_since_close: 61.2, payment_method: "full", payment_account_id: "pay", status: "estimated", reason: null, estimated: true, next_payday: null },
};
const render = hiddenOverride => renderToStaticMarkup(h(CardDetailsSections, { card, hiddenOverride, onEditPayment: noop, onEditRates: noop }));

assert.equal(ordinal(1), "1st");
assert.equal(ordinal(11), "11th");
assert.deepEqual(paymentRuleLabels(undefined), { closes: "Not set", due: "Not set", method: "Not set" });
const shown = render(false);
assert.ok(shown.indexOf('data-card-entry="payment"') < shown.indexOf('data-card-entry="rates"'), "Payment leads Rates and deals");
assert.equal((shown.match(/data-card-entry=/g) ?? []).length, 2, "only two compact navigation entries");
assert.match(shown, /Payment/); assert.match(shown, /Rates and deals/);
assert.match(shown, /Paid in full by Direct Debit/); assert.match(shown, /24\.9% APR/);
assert.doesNotMatch(shown, /£412\.50|Current card bill|No payment matched/, "bill evidence and match states remain inside Payment");
assert.doesNotMatch(shown, /Contains 20001/, "the launcher does not expose the rule narrative");
assert.doesNotMatch(render(true), /£\d|474/, "Hide balances masks any visible money");
assert.doesNotMatch(shown, /—|!/, "copy uses neither an em dash nor an exclamation mark");
console.log("g412-card-sections: ok");
