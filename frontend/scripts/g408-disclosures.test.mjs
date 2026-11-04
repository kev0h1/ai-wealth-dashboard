import assert from 'node:assert/strict';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {AppRouterContext} from 'next/dist/shared/lib/app-router-context.shared-runtime.js';
import SafeToSpendCard from '../components/SafeToSpendCard.tsx';
import {BalancesHiddenContext} from '../lib/balancesHidden.tsx';
import {buildLeftToSpendEvidence} from '../lib/leftToSpendEvidence.ts';
import {deriveSafeToSpendHeadline,homeForecastPresentation} from '../lib/pennyScreenViews.ts';
import {FORECASTS,STATES,accountEntries,COLD_SYNC,DEGRADED,WARM_SYNC,isReady} from './fixtures/g324-home-declutter.ts';
const noop=()=>{};
const router={back:noop,forward:noop,refresh:noop,push:noop,replace:noop,prefetch:noop};
export function renderCard({state='tight',hidden=false,accountExample='standard',patch={},props={}}={}){
 let data=isReady(state)?FORECASTS[state]:state==='cold-sync'?COLD_SYNC:state==='warm-sync'?FORECASTS.tight:state==='degraded'?DEGRADED:state==='unsupported'?{status:'insufficient_data'}:null;
 if(data?.status==='ok')data={...data,...patch};
 const entries=accountEntries(accountExample,data?.safe_to_spend??261);
 const spendFrom=state==='no-account'?{kind:'none'}:{kind:'account',best:entries[0],alternative:entries[1]??null};
 return renderToStaticMarkup(React.createElement(AppRouterContext.Provider,{value:router},React.createElement(BalancesHiddenContext.Provider,{value:hidden},React.createElement(SafeToSpendCard,{data,spendFrom,previewBalancesVisible:!hidden,loading:state==='loading',error:state==='error',onRetry:noop,onSyncRetry:noop,syncing:state==='warm-sync'?WARM_SYNC:undefined,coverMoveVisible:state==='tight'&&accountExample==='standard',coverMoveReserves:{'g324-natwest':25},coverMoveDestinations:{'g324-natwest':['Barclays Bills account']},...props}))));
}
const cents=n=>Math.round(n*100);
const plain=html=>html.replace(/<[^>]+>/g,' ').replace(/&#x27;/g,"'").replace(/\s+/g,' ');
const evidence=data=>{const h=deriveSafeToSpendHeadline(data),p=homeForecastPresentation(data,h);return buildLeftToSpendEvidence(data,p.signed?-h.heroAmount:Math.abs(h.heroAmount));};
const reference={...FORECASTS.tight,safe_to_spend:2002,safe_to_spend_cash:2002,lowest_projected_balance:2102,spendable_now:3402,bills_total:1300,buffer:100,allocations_reserved:0,commitments_reserved:0,card_growth_total:108,card_new_spend_total:183};
const earlier={...reference,safe_to_spend:-400,safe_to_spend_cash:-400,lowest_projected_balance:-400,spendable_now:600,bills_total:1000,income_before_payday:1300,buffer:0,state:'short',short_reason:'bills'};
for(const data of [...Object.values(FORECASTS),reference,earlier]){
 const e=evidence(data);let running=0;
 for(const row of e.rows){if(row.total){if(e.rows.length>1)assert.equal(cents(running),cents(row.value),row.label);}else running+=row.value;}
 assert.equal(cents(e.rows.at(-1).value),cents(data.safe_to_spend));
}
const earlierEvidence=evidence(earlier);
assert.deepEqual(earlierEvidence.rows,[{label:'Left to spend at the cash low point',value:-400,total:true,detail:'Across counted current accounts.'}]);
assert.equal(earlierEvidence.incomeBeforePayday,1300);
assert.match(earlierEvidence.ledgerNote,/lowest cash forecast/);
assert.ok(!earlierEvidence.rows.some(r=>r.label==='Income before payday'),'do not put whole-period income into an invented prefix walk');
assert.equal(evidence(FORECASTS['card-reserve']).rows.at(-1).value,252,'G413: card growth never changes the ledger total');
assert.ok(!evidence(FORECASTS['card-reserve']).rows.some(r=>/card/i.test(r.label)),'G413: no card hold row');
const mixed=evidence({...reference,safe_to_spend:2003});
assert.equal(mixed.rows.length,1,'a stale/inconsistent payload never manufactures a reconciling operand');
assert.match(mixed.ledgerNote,/detailed working is not available/);
const missingLow=evidence({...reference,lowest_projected_balance:undefined});
assert.equal(missingLow.rows[0].value,2002);assert.match(missingLow.ledgerNote,/dated breakdown is not available/);
const pennyMismatch=evidence({...reference,spendable_now:3402.01});
assert.equal(pennyMismatch.rows[0].label,'Lowest cash before payday','one penny mismatch cannot be presented as an additive endpoint ledger');
assert.ok(!pennyMismatch.rows.some(r=>r.label==='Cash now'));
for(const hidden of [false,true])for(const state of STATES.map(x=>x.id)){
 const html=renderCard({state,hidden});
 if(hidden)assert.doesNotMatch(html,/£\d/,'DOM and accessible names stay masked');
 if(isReady(state)||state==='warm-sync'){
  assert.match(html,/data-g408-disclosures/);
  assert.match(html,/data-sts-caveat/);
  assert.match(html,/data-g324-calculation/);
  const evidenceHtml=html.slice(html.indexOf('data-g324-evidence'));
  assert.doesNotMatch(evidenceHtml,/<\/details>\s*<p/,'no explanation leaks outside its disclosure');
 }
}
const html=renderCard({patch:reference});
const cardSummary=html.slice(html.indexOf('data-g324-card-activity')).split('</summary>')[0];
assert.match(cardSummary,/Card spending this pay period/);assert.match(cardSummary,/£183/);assert.doesNotMatch(cardSummary,/£108/);
assert.match(plain(html),/Known card repayments due before payday are included in your estimate/);
assert.doesNotMatch(plain(html),/already held back|Repayment not confirmed/);
assert.match(plain(html),/£2,002\.00/);
const missingPurchases=renderCard({patch:{...reference,card_new_spend_total:undefined}});
const missingSummary=missingPurchases.slice(missingPurchases.indexOf('data-g324-card-activity')).split('</summary>')[0];
assert.match(missingSummary,/Unavailable/,'absent purchases are unknown, not zero');
assert.doesNotMatch(missingSummary,/£0/);
assert.doesNotMatch(plain(missingPurchases),/already held back/,'G413: nothing is ever held for cards');
assert.doesNotMatch(plain(html),/Safety position|Card safety check/,'working has one explanation rather than duplicate safety blocks');
const sync=renderCard({state:'warm-sync',patch:reference});
assert.doesNotMatch(sync,/role="img" aria-label="Repayment not confirmed"|See your cards/,'stale card data offers no caution dot or navigation');
assert.match(sync,/Last known card figures/);
const holdHtml=plain(renderCard({state:'card-reserve'}));
assert.doesNotMatch(holdHtml,/card hold|gap\.|held while/);
const lowHtml=plain(renderCard({patch:earlier}));assert.match(lowHtml,/Income before payday.*£1,300\.00/);
for(const n of [-0.1,-0.49,-0.51,0,0.42]){
 const data={...FORECASTS['no-account'],safe_to_spend:n,safe_to_spend_cash:n,lowest_projected_balance:n,state:n<0?'short':'tight',short_reason:n<0?'bills':null};
 assert.equal(evidence(data).rows.at(-1).value,n);
}
console.log('G408: reconciled ledgers, supplied low points, holds/gaps, short/penny states, disclosure eligibility and masked DOM passed');
