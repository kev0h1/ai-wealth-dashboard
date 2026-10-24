import assert from 'node:assert/strict';
import { renderScenario } from './g324-home-declutter.test.mjs';
import { deriveSafeToSpendHeadline, buildSafeToSpendView } from '../lib/pennyScreenViews.ts';
import { FORECASTS } from './fixtures/g324-home-declutter.ts';
const zero = { ...FORECASTS.tight, safe_to_spend: 0, safe_to_spend_cash: 0, lowest_projected_balance: 0, spendable_now: 0, bills_total: 0, income_before_payday: 0, buffer: 0, allocations_reserved: 0, commitments_reserved: 0, card_growth_reserved: 0, state: 'short', short_reason: 'bills' };
const text = html => html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ');
for (const hidden of [false,true]) {
 const html = renderScenario({patch:zero,hidden,props:{spendFrom:{kind:'none'}}});
 assert.match(text(html), /Nothing left to spend before/);
 assert.match(text(html), /How we worked this out/);
 assert.doesNotMatch(text(html), /£0 short|you are short|Looks on track/);
 if(hidden) assert.doesNotMatch(html,/£\d/);
 const headline=deriveSafeToSpendHeadline(zero);
 assert.equal(headline.state,'tight');
 const view=buildSafeToSpendView(zero,{hidden});
 assert.equal(view.verdict,'No headroom');
 assert.equal(view.figures.length,hidden?0:1);
}
for(const deficit of [-0.01,-0.42,-0.99,-573]) {
 const patch={...zero,safe_to_spend:deficit,safe_to_spend_cash:deficit,lowest_projected_balance:deficit};
 const html=text(renderScenario({patch}));
 const value=Math.abs(deficit)<1?`£${Math.abs(deficit).toFixed(2)}`:'£573';
 assert.ok(html.includes(`−${value}`),`signed ${deficit} visible`);
 assert.ok(html.includes(`How we got ${value} short`));
 assert.doesNotMatch(html,/How we got £0 short/);
 assert.equal(buildSafeToSpendView(patch,{hidden:false}).figures[0].value,`−${value}`);
 assert.doesNotMatch(renderScenario({patch,hidden:true}),/£\d/);
}
const smallPositive={...zero,safe_to_spend:0.42,safe_to_spend_cash:0.42,lowest_projected_balance:0.42,state:'tight'};
assert.match(text(renderScenario({patch:smallPositive})),/£0\.42/);
for(const state of ['degraded','cold-sync','error','loading'])assert.doesNotMatch(text(renderScenario({state})),/How we got £0 short/);
console.log('G330: neutral zero, signed penny gaps, positive pennies, masking and unavailable states passed');

const pennyReserve={...zero,safe_to_spend:-0.10,safe_to_spend_cash:0.32,lowest_projected_balance:0.32,short_reason:'cards_unconfirmed',card_growth_reserved:0.42,card_growth_total:0.42,card_new_spend_total:0.42};
assert.match(text(renderScenario({patch:pennyReserve})), /£0\.42 held while a card bill is unconfirmed, leaving a £0\.10 safety shortfall/);
assert.doesNotMatch(renderScenario({patch:pennyReserve,hidden:true}),/£\d/);
