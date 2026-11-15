import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { register } from "node:module";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

const stub = new URL("./_sheetframe-stub.mjs", import.meta.url).href;
register("data:text/javascript," + encodeURIComponent(`export async function resolve(s,c,next){if(/(^|\\/)components\\/SheetFrame$/.test(s))return {url:${JSON.stringify(stub)},shortCircuit:true};return next(s,c);}`));
const { default: OfferCards, OfferAmount } = await import("../components/card-offers/OfferCards.tsx");
const { default: RatesSheet } = await import("../components/card-settings/RatesSheet.tsx");
const { preserveCardPromo, makeOfferDrafts } = await import("../lib/cardOfferReview.ts");

const first = { id:"first", kind:"balance_transfer", offer_type:"balance_transfer", apr_pct:0, until:"2027-07-24", balance:4812.80, revert_apr_pct:23.9, as_of:"2026-11-12" };
const second = { id:"second", kind:"balance_transfer", offer_type:"money_transfer", apr_pct:3.9, until:"2027-02-15", balance:860, revert_apr_pct:24.9, as_of:"2026-11-10" };
const terms = { apr_pct:23.9,cash_apr_pct:29.9,rates_as_of:"2026-11-12",promos:[first],bt_offers:[{ends:null,fee_pct:null,note:"Available to transfer £123.45"}],min_payment_note:null,status:"confirmed",confirmed_at:null,product_key:null,usage:null };
const card = { account_id:"harbour",name:"Harbour Platinum",provider:"Harbour",balance:-99999.99,currency:"GBP",source:"fixture",ask_eligible:false,card_class:"credit_card",terms };
const other = { ...card,account_id:"moorland",name:"Moorland Rewards",terms:{...terms,promos:[second],bt_offers:[]} };
const render = (cards,hidden=false) => renderToStaticMarkup(React.createElement(OfferCards,{cards,hidden,today:"2026-11-15"}));
const html=render([card,other]);
assert(html.indexOf("Moorland Rewards")<html.indexOf("Harbour Platinum"),"all-card offers stay in date order rather than account order");
assert.match(html,/£4,812\.80/); assert.match(html,/£602/); assert.match(html,/24 Jul 2027/); assert.match(html,/23\.9% APR/);
assert.doesNotMatch(html,/99,999\.99|99999\.99/,"whole-card balance never becomes an offer balance");
assert.match(html,/before the offer ends/); assert.match(html,/not a payment plan/);
assert.match(html,/interest-bearing offer/);
assert.doesNotMatch(render([card,other],true),/4,812|4812|£602|£860/,"hidden DOM and accessible text contain no offer amounts");
assert.match(render([card],true),/Amount hidden/);
const legacy = render([{...card,terms:{...terms,promos:[{kind:"both",apr_pct:0,until:"2027-07-24"}]}}]);
assert.match(legacy,/Not recorded/); assert.match(legacy,/Purchases and balance transfers/); assert.doesNotMatch(legacy,/£99,999|£602/);
const foreign=render([{...card,currency:"USD"}]);
assert.doesNotMatch(foreign,/4,812|4812|£602/); assert.match(foreign,/Not available for this currency/);
const signed=renderToStaticMarkup(React.createElement(OfferAmount,{value:-12.34,currency:"GBP",hidden:true}));
assert.match(signed,/−£••••/); assert.doesNotMatch(signed,/12\.34/);

const rates=renderToStaticMarkup(React.createElement(RatesSheet,{card,cards:[card,other],onClose(){},hiddenOverride:false}));
assert.match(rates,/23\.9% APR/); assert.match(rates,/29\.9% APR/); assert.match(rates,/statement or screenshot/);
assert.doesNotMatch(rates,/Moorland Rewards/,"per-card overview does not render offers from another card");
const hiddenRates=renderToStaticMarkup(React.createElement(RatesSheet,{card,onClose(){},hiddenOverride:true}));
assert.doesNotMatch(hiddenRates,/123\.45|4,812|4812|£602/,"unused-offer notes obey privacy alongside offer balances");

const retained=preserveCardPromo(first,{kind:first.kind,apr_pct:1.9,until:"2027-07-26"});
assert.deepEqual(retained,{...first,apr_pct:1.9,until:"2027-07-26"},"legacy walk edits retain every extended financial fact and stable id");
const changed=preserveCardPromo(first,{kind:"both",apr_pct:0,until:first.until});
assert.equal(changed.offer_type,undefined,"a changed legacy scope does not keep a contradictory detailed type");
assert.equal(changed.balance,first.balance); assert.equal(changed.id,first.id);
const extracted={offer_type:"balance_transfer",apr_pct:0,balance:150,ends:"2027-01-04",revert_apr_pct:24.9,match:"first"};
assert.equal(makeOfferDrafts([extracted],[null])[0].updateId,null,"an explicit new-card match choice overrides an old suggested id");
const legacySource=readFileSync(new URL("../components/CardTermsSheet.tsx",import.meta.url),"utf8");
assert.match(legacySource,/original: p/); assert.match(legacySource,/preserveCardPromo\(r\.original/);
console.log("g471-card-offers-render: financial detail, privacy, per-card scope and legacy retention passed");
