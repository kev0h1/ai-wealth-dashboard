// Approved G324 B2: exercise the production card, not retired preview markup.
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AppRouterContext } from 'next/dist/shared/lib/app-router-context.shared-runtime.js';
import SafeToSpendCard from '../components/SafeToSpendCard.tsx';
import { BriefBody, PaydayPlanSection } from '../components/HomeBrief.tsx';
import { BalancesHiddenContext } from '../lib/balancesHidden.tsx';
import { ACCOUNT_EXAMPLES, accountEntries, COLD_SYNC, DEGRADED, FORECASTS, STATES, WARM_SYNC, isReady } from './fixtures/g324-home-declutter.ts';

const noop=()=>{};
const router={back:noop,forward:noop,refresh:noop,push:noop,replace:noop,prefetch:noop};
export function renderScenario({state='tight',accountExample='standard',hidden=false,patch={},props={}}={}) {
  let data=isReady(state)?FORECASTS[state]:state==='cold-sync'?COLD_SYNC:state==='warm-sync'?FORECASTS.tight:state==='degraded'?DEGRADED:state==='unsupported'?{status:'insufficient_data'}:null;
  if(data?.status==='ok')data={...data,...patch};
  const entries=accountEntries(accountExample,data?.safe_to_spend??261);
  const spendFrom=state==='no-account'?{kind:'none'}:{kind:'account',best:entries[0],alternative:entries[1]??null};
  const card=React.createElement(SafeToSpendCard,{
    data,spendFrom,previewBalancesVisible:!hidden,loading:state==='loading',error:state==='error',onRetry:noop,onSyncRetry:noop,
    syncing:state==='warm-sync'?WARM_SYNC:undefined,
    coverMoveVisible:state==='tight'&&accountExample==='standard',coverMoveReserves:{'g324-natwest':25},coverMoveDestinations:{'g324-natwest':['Barclays Bills account']},...props,
  });
  return renderToStaticMarkup(React.createElement(AppRouterContext.Provider,{value:router},React.createElement(BalancesHiddenContext.Provider,{value:hidden},card)));
}
const plain=html=>html.replace(/<[^>]+>/g,' ').replace(/&#x27;/g,"'").replace(/\s+/g,' ');
let cases=0;
for(const state of STATES.map(s=>s.id))for(const hidden of [false,true]){
  const html=renderScenario({state,hidden});
  if(hidden)assert.doesNotMatch(html,/£\d[\d,.]*/u,`${state}: money stays masked in DOM and ARIA`);
  if(!isReady(state)&&state!=='warm-sync'){
    assert.doesNotMatch(html,/data-spend-from-account=|data-g219-accounts-link/,'no false account guidance or figure action in unresolved states');
  }else{
    const hero=html.slice(html.indexOf('data-g324-hero'),html.indexOf('data-g324-evidence'));
    assert.match(hero,/Based on your connected current accounts and the bills Sorted knows about\./);
    assert.doesNotMatch(hero,/payments still pending|How we got|Card balances this pay period|Card spending/,'evidence stays below the hero');
    assert.match(hero,/data-g219-action-row/,'next actions stay in the hero');
    const caveat=html.slice(html.indexOf('data-sts-caveat'),html.indexOf('</details>',html.indexOf('data-sts-caveat')));
    assert.match(caveat,/What this estimate counts/);assert.match(plain(caveat),/It doesn't include other accounts, payments still pending, or bills Sorted hasn't spotted yet\./);assert.match(caveat,/It can be wrong/);
    const working=html.slice(html.indexOf('data-g324-calculation'),html.indexOf('</details>',html.indexOf('data-g324-calculation')));
    if((FORECASTS[state]?.payday_income??0)>0)assert.match(working,/Pay of about.*due/,'expected pay explicitly labelled inside working');
    if(['payments-short','plans-only','card-reserve','no-account'].includes(state))assert.doesNotMatch(hero,/data-spend-from-account=/,'no positive account guidance with no cash to spend');
    if(!hidden&&state==='card-reserve'){assert.match(plain(hero),/£325 held/);assert.match(plain(hero),/£73 safety shortfall/);assert.match(working,/Safety position/);assert.match(working,/−£73\.00/);}
  }
  cases++;
}
for(const example of ACCOUNT_EXAMPLES){
  const html=renderScenario({accountExample:example.id});
  const hero=html.slice(html.indexOf('data-g324-hero'),html.indexOf('data-g324-evidence'));
  assert.match(hero,/data-spend-from-layout="account-list"/,'accounts always visible within the hero');
  if(example.id==='whole')assert.doesNotMatch(hero,/£261 held/,'whole estimate never repeated as an account amount');
  if(example.id==='same-bank'||example.id==='long')assert.match(hero,/Bills account|Joint household bills/,'same-bank accounts remain identifiable');
  if(example.id==='standard'){assert.match(plain(hero),/Each amount is the most that account could cover\. Don't add them together/);assert.match(plain(hero),/Showing your top 2 accounts/);assert.doesNotMatch(plain(hero),/already held back|for the move/);assert.match(plain(hero),/up to £146/);}
  assert.doesNotMatch(hero,/<a[^>]+data-spend-from-account/,'bank rows are plain, not extra links');
  cases++;
}
const flat=renderScenario({patch:{card_growth_total:0,card_new_spend_total:1947}});
assert.match(flat,/Card spending this pay period/,'card purchases remain present when repayments leave net growth at zero');
assert.match(flat,/£1,947/);assert.match(plain(flat),/Card purchases aren't deducted again/);
const maskedPace=renderScenario({hidden:true,patch:{pace:{state:'on_pace',sustainable:37.29}}});
assert.doesNotMatch(maskedPace,/£\d/);
const pace=plain(renderScenario({patch:{pace:{state:'on_pace',sustainable:37.29}}}));
assert.match(pace,/About £37 a day/,'pace uses server-authored sustainable amount');
const hiddenMove=renderScenario({props:{coverMoveVisible:false}});
assert.doesNotMatch(hiddenMove,/already held back in NatWest/,'a dismissed move adds no repeated reserve copy');
assert.match(hiddenMove,/£146/);
for(const reason of ['error','missing','loading']){
  const html=renderScenario({props:{spendFrom:{kind:'unavailable',reason}}});
  assert.doesNotMatch(html,/data-spend-from-account=/,'unavailable account evidence never becomes a positive recommendation');
}
console.log(`G324 B2: ${cases} production state/account/masking contracts plus card-purchase, pace, dismissal and unavailable checks passed`);

// G340: card purchases, cash forecasts and fallback reserves remain distinct.
for (const [options, expected] of [
  [{}, /You've spent £1,947 on credit cards/],
  [{patch:{safe_to_spend:0,safe_to_spend_cash:0}}, /Known card repayments due before payday are included in your estimate/],
  [{state:'payments-short'}, /Card purchases aren't deducted again/],
  [{state:'card-monthly'}, /Due around .* Its repayment is forecast separately/],
  [{state:'card-reserve'}, /£200 on credit cards.*separate figure from the £325 already held back above/],
]) {
  const html=renderScenario(options), text=plain(html);
  assert.match(text,expected);
  if(options.state==='card-reserve') {
    assert.match(text,/£73 safety shortfall/);
    assert.doesNotMatch(text,/Known card repayments due before payday/,'fallback reserve is already deducted');
  } else {
    assert.match(text,/Known card repayments due before payday are included in your estimate/);
    assert.match(text,/Purchases only\. Balance transfers and repayments are not counted here/);
  }
  assert.doesNotMatch(renderScenario({...options,hidden:true}),/£\d/,'new explanatory amounts obey masking');
}
console.log('G340: dynamic cash, zero, shortfall, known repayment and reserve copy/masking passed');

const homeCopy = (Component,data) => plain(renderToStaticMarkup(React.createElement(AppRouterContext.Provider,{value:router},React.createElement(Component,{items:[],safeToSpend:data,router}))));
for(const days_until_payday of [1,5]) {
  const copy=homeCopy(BriefBody,{...FORECASTS.tight,days_until_payday});
  assert.match(copy,/bills Sorted knows about are covered so far/);
  assert.doesNotMatch(copy,/mapped/);
}
assert.doesNotMatch(homeCopy(BriefBody,FORECASTS['payments-short']),/bills .*covered/,'a payment gap must never claim covered bills');
assert.match(homeCopy(BriefBody,FORECASTS['plans-only']),/plans and set-asides you chose/);
for (const offset of [0,1,4,10]) {
  const date=new Date();date.setDate(date.getDate()+offset);
  const copy=homeCopy(PaydayPlanSection,{...FORECASTS.tight,next_payday:date.toISOString()});
  assert.match(copy,/See how I.*split your next pay/);
  assert.doesNotMatch(copy,/pay cheque/);
}
console.log('G340: Home coverage qualifiers and payday date branches passed');
