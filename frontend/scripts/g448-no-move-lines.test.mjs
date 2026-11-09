import assert from 'node:assert/strict';
import fs from 'node:fs';
import {renderCard} from './g408-disclosures.test.mjs';

// G448: the Left to spend "How we got" working carries no suggested-move lines.
const banned=/moving from|to cover its payments|This does not change the total\.|data-g412-earmarks/;
for(const hidden of [false,true]){
 for(const state of ['tight','warm-sync']){
  const html=renderCard({hidden,state,props:{coverMoveVisible:true,earmarkedMoves:[{sourceId:'a',sourceName:'Barclays everyday',destinationId:'b',destinationName:'NatWest bills',amount:275}]}});
  assert.match(html,/data-g324-calculation/,'the working is still rendered');
  assert.doesNotMatch(html,banned,`no move line in How we got (hidden=${hidden}, ${state})`);
 }
}
// Kept: plan note and fact rows.
const kept=renderCard({});
assert.match(kept,/Daily amount/);
assert.match(kept,/Expected pay/);
// Moves live on in the cover plan card and account pages.
const read=p=>fs.readFileSync(new URL(p,import.meta.url),'utf8');
assert.match(read('../lib/upcomingAccountStatus.ts'),/a move would cover it/,'account pages still show moves');
assert.match(read('../components/CoverPlanSourcesCard.tsx'),/export default function CoverPlanSourcesCard/,'cover plan card still exists');
for(const f of ['../components/SafeToSpendDisclosures.tsx','../components/SafeToSpendCard.tsx'])assert.doesNotMatch(read(f),/earmarkedMoves|moving from/,f);
console.log('G448: How we got renders no move line; cover plan and account pages keep theirs');
