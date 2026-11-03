import assert from 'node:assert/strict';
import {coverMoveEvidence} from '../lib/coverMoveEvidence.ts';
import {renderCard} from './g408-disclosures.test.mjs';

const accounts=[{id:'payer',name:'Barclays everyday'}];
const positions={payer:{short:false,headroom:500,earmarked_total:275,
  earmarks_out:[{to_account_id:'bills',to_name:'NatWest bills',amount:275}]}};
const rows=coverMoveEvidence(accounts,positions,true,{payer:275});
assert.equal(rows.length,1);
assert.equal(rows[0].amount,275);
assert.deepEqual(coverMoveEvidence(accounts,positions,false,{payer:275}),[],'a hidden move has no remaining note');
assert.deepEqual(coverMoveEvidence(accounts,positions,true,{payer:274.99}),[],'do not join snapshots that differ by a penny');
assert.deepEqual(coverMoveEvidence([],positions,true,{payer:275}),[],'do not invent a source name');
assert.deepEqual(coverMoveEvidence(accounts,{payer:{...positions.payer,uncertain:true}},true,{payer:275}),[]);
assert.deepEqual(coverMoveEvidence(accounts,{payer:{...positions.payer,earmarks_out:[{to_account_id:'bills',to_name:'',amount:275}]}},true,{payer:275}),[]);
for(const hidden of [false,true]){
 const html=renderCard({hidden,props:{coverMoveVisible:true,earmarkedMoves:rows}});
 const start=html.indexOf('data-g412-earmarks');
 assert.ok(start>html.indexOf('data-g324-calculation'));
 assert.ok(start<html.indexOf('data-g324-card-activity'));
 assert.match(html,/moving from Barclays everyday to NatWest bills to cover its payments\. This does not change the total\./);
 assert.doesNotMatch(html,/earmarked|[Ee]mdash|—/);
 assert.match(html,/Barclays everyday/);
 if(hidden)assert.doesNotMatch(html,/£\d/,'no money in masked DOM or ARIA');
 else assert.match(html,/£275\.00/);
}
assert.doesNotMatch(renderCard({props:{coverMoveVisible:false,earmarkedMoves:rows}}),/data-g412-earmarks/);
assert.doesNotMatch(renderCard({state:'warm-sync',props:{coverMoveVisible:true,earmarkedMoves:rows}}),/data-g412-earmarks/);
console.log('G412 earmark evidence: same visible snapshot, exact pennies, missing metadata, dismissal, sync and masked production renders passed');
