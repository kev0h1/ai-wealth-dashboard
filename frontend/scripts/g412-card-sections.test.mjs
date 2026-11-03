// G412 variant A in production: the card sections of Account details.
// Invented card names and figures only. Run: npm run -s check:g412-card-sections
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import CardDetailsSections, { ordinal, paymentRuleLabels } from "../components/CardDetailsSections.tsx";

const h = React.createElement;
const noop = () => {};
const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const bill = { statement_start: "2026-09-04", statement_close: "2026-10-03", payment_due: "2026-10-28", next_payment_due: "2026-11-28",
  estimated_bill: 412.5, payment_amount: 412.5, payment_remaining: 412.5, paid_since_close: 0, spending_since_close: 61.2,
  payment_method: "full", payment_account_id: "pay", status: "estimated", reason: null, estimated: true, next_payday: "2026-11-01", due_before_payday: true };
const dated = { account_id: "c1", name: "Example Rewards Card", provider: "Example Bank", balance: -474, currency: "GBP", source: "finexer", ask_eligible: false, statement_bill: bill,
  terms: { status: "confirmed", apr_pct: 24.9, promos: [{ kind: "purchases", apr_pct: 0, until: "2099-05-31" }], bt_offers: [{ ends: "2099-08-31", fee_pct: 2.5, note: null }],
    bt_offer_note: null, min_payment_note: null, confirmed_at: null, product_key: null, usage: "clear_monthly",
    statement_close_day: 3, payment_due_day: 28, payment_due_days_after_close: null, payment_method: "full", payment_account_id: "pay", fixed_payment_amount: null } };
const undated = { ...dated, statement_bill: null, terms: { ...dated.terms, statement_close_day: null, payment_due_day: null, payment_method: null, payment_account_id: null } };
const render = (card, hiddenOverride) => renderToStaticMarkup(h(CardDetailsSections, { card, hiddenOverride, paymentAccounts: [{ id: "pay", name: "Example Current" }], onEditPayment: noop, onEditRates: noop }));

assert.equal(ordinal(1), "1st"); assert.equal(ordinal(2), "2nd"); assert.equal(ordinal(11), "11th"); assert.equal(ordinal(22), "22nd"); assert.equal(ordinal(28), "28th");
assert.deepEqual(paymentRuleLabels(undefined), { closes: "Not set", due: "Not set", method: "Not set" });

const shown = render(dated, false);
assert.ok(shown.indexOf('data-g412-section="payment"') < shown.indexOf('data-g412-section="rates"'), "payment leads, rates follow");
assert.match(shown, /Payment due 28 October 2026/);
assert.match(shown, /£412\.50/);
assert.match(shown, /Statement closes/); assert.match(shown, /3rd of each month/); assert.match(shown, /28th of each month/);
assert.match(shown, /Paid in full by Direct Debit/); assert.match(shown, /Example Current/);
assert.match(shown, /belongs to the next bill/);
assert.match(shown, /24\.9% APR/); assert.match(shown, /Unused 0% offer/); assert.match(shown, /2\.5% fee/);
assert.match(shown, /aria-label="Edit how this card is paid"/); assert.match(shown, /aria-label="Edit rates and deals"/);
assert.doesNotMatch(shown, /—|!/, "no em dash or exclamation mark in copy");

const hidden = render(dated, true);
assert.doesNotMatch(hidden, /£\d|412\.50|61\.20/, "masked DOM and ARIA carry no bill figures");
assert.match(hidden, /£••••/);

// Kevin 2026-11-03: no dates means no estimate, no prompt, no nudge.
const quiet = render(undated, false);
assert.doesNotMatch(quiet, /data-g412-estimate/);
assert.doesNotMatch(quiet, /Add statement|add its statement|statement dates/i);
assert.match(quiet, /Statement closes[\s\S]*Not set/);

// A settled bill reads Paid, never "due" with the amount still owing; a part-paid bill shows what is left.
const paid = render({ ...dated, statement_bill: { ...bill, status: "paid", payment_remaining: 0, paid_since_close: 412.5 } }, false);
assert.match(paid, />Paid</); assert.doesNotMatch(paid, /Payment due 28 October/);
const part = render({ ...dated, statement_bill: { ...bill, payment_remaining: 112.5, paid_since_close: 300 } }, false);
assert.match(part, /Payment due 28 October 2026/); assert.match(part, /£112\.50/); assert.match(part.replace(/<[^>]+>/g, ""), /£300\.00 of £412\.50 already paid\./);
assert.match(shown, /-mr-2/, "Edit aligns with the value column");

// A charge card is the stored bank class, never the name (Charge in a credit card's name proves nothing).
const named = { ...dated, name: "Example Charge Rewards", card_class: "credit_card" };
assert.match(render(named, false), /Standard purchase rate/, "a card named charge but classed credit keeps its rates");
assert.doesNotMatch(render({ ...dated, name: "Example Gold", card_class: "charge_card" }, false), /Standard purchase rate|aria-label="Edit rates and deals"/, "a charge-class card has no rates row or Edit");
assert.match(render({ ...dated, card_class: null }, false), /Standard purchase rate/, "unknown class is treated as an ordinary card");

// Wiring: one entry for the record, no loose pill in the sheet, no stray rules.
const accounts = read("app/components/AccountsPage.tsx");
assert.match(accounts, /onDetails=\{\(\) => setAccountDetailsFor\(selectedAccount\.id\)\}/, "cards open the one Account details sheet");
assert.match(accounts, /<CardDetailsSections/);
assert.match(accounts, /divide-y divide-slate-200/, "single dividers between sections");
assert.doesNotMatch(accounts, /aria-label=\{`\$\{termsPill\.label\}, edit this card's rates`\}/, "the loose APR pill is folded into Rates and deals");
assert.match(accounts, /onTermsClick: pill \? \(\) => openCardDetails\(row\.id\)/, "a row pill opens Account details, not a second sheet");
console.log("g412-card-sections: ok");
