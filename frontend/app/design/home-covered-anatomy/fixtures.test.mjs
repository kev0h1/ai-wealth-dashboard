import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime.js";
import { SearchParamsContext } from "next/dist/shared/lib/hooks-client-context.shared-runtime.js";
import { CelebrationCard } from "../../../components/HomeBrief.tsx";
import Preview from "./HomeCoveredAnatomyClient.tsx";
import { COVERED_ITEM, LONG_COVERED_ITEM, MASKED_COVERED_ITEM, MISSING_BODY_COVERED_ITEM, COVER_MOVE_ITEM, UNFUNDED_MOVE_ITEM, TIP } from "./fixtures.ts";

const noop=()=>{};
const router={push:noop,replace:noop,refresh:noop,hmrRefresh:noop,back:noop,forward:noop,prefetch:async()=>{}};
const maskAmounts=text=>text;
const money=text=>Number(text.replace(/[^\d.]/g,""));
for(const item of [COVERED_ITEM,LONG_COVERED_ITEM,MASKED_COVERED_ITEM,MISSING_BODY_COVERED_ITEM]) {
  const direct=renderToStaticMarkup(React.createElement(CelebrationCard,{item,router,maskAmounts,dismissible:true,onHomeDismiss:noop}));
  const state=item===COVERED_ITEM?"covered":item===LONG_COVERED_ITEM?"long":item===MASKED_COVERED_ITEM?"masked":"missing-body";
  for(const variant of ["a","b","c"]) {
    const html=renderToStaticMarkup(React.createElement(AppRouterContext.Provider,{value:router},React.createElement(SearchParamsContext.Provider,{value:new URLSearchParams({variant,state})},React.createElement(Preview))));
    assert.ok(html.includes(direct),`${variant}/${state}: exact production Covered markup, only surrounding presentation differs`);
    assert.equal((html.match(/aria-label="Hide on Home"/g)??[]).length,1,"one real V2 dismiss control");
  }
}
assert.equal(money(COVERED_ITEM.brief_lead.value),32);
assert.match(COVERED_ITEM.body,/3 payments/);
assert.equal(money(LONG_COVERED_ITEM.brief_lead.value),925+146,"long evidence and lead reconcile");
const legs=COVER_MOVE_ITEM.moves;
const total=legs.reduce((sum,leg)=>sum+leg.amount,0);
assert.equal(total,COVER_MOVE_ITEM.amount);
assert.equal(COVER_MOVE_ITEM.plan_dest.needs_total,COVER_MOVE_ITEM.plan_dest.bills.reduce((sum,bill)=>sum+bill.amount,0));
assert.equal(COVER_MOVE_ITEM.plan_dest.balance+total,COVER_MOVE_ITEM.plan_dest.needs_total,"suggested moves close exact account gap");
for(const leg of legs){assert.notEqual(leg.move_map.from.account_id,leg.move_map.to.account_id,"no self-transfer");assert.ok(leg.move_map.from.balance>=leg.amount,"source can fund fixture leg");}
const missing=UNFUNDED_MOVE_ITEM.moves[0];
assert.notEqual(missing.source_account_id,missing.suggested_sources[0].account_id);
assert.equal(missing.suggested_amount,total);
assert.doesNotMatch(TIP.title+TIP.body,/cheaper|could save|best|switch to|recommend/i,"tip stays facts-only");
for(const file of ["HomeCoveredAnatomyClient.tsx","fixtures.ts"]){const source=readFileSync(new URL(file,import.meta.url),"utf8");assert.doesNotMatch(source,/api\.|fetch\(|localStorage|sessionStorage|—/,"preview has no customer operation or forbidden copy");}
console.log("PASS G292: 3 presentations × 4 states retain exact production card content and V2 dismissal; long evidence, move legs and account gaps reconcile; no self-transfer or tip claims.");
