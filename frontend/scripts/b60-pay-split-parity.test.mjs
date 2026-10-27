// The comparison shown by Sorted and spoken by Penny must use identical bounds.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {GUIDES,compareShape} from '../lib/paySplitReference.ts';
const backend=fileURLToPath(new URL('../../backend',import.meta.url));
const cases=[];
for(const income of [.01,1.01,1000,4844.01,99999999.99])for(const fixedShare of [.49999,.5,.6,.60001])for(const guide of GUIDES){
 const jobs=[{id:'fixed',amount:Math.round(income*fixedShare*100)/100},{id:'moved',amount:Math.round(income*.15*100)/100},{id:'free',amount:Math.round(income*.35*100)/100}];
 cases.push({guide:guide.id,shape:{status:'ok',take_home:income,total_out:jobs.reduce((s,j)=>s+j.amount,0),jobs}});
}
// Exclusions retain their signed cash effect without becoming money left.
for(const not_counted of [50, -25]) for(const guide of GUIDES) {
 cases.push({guide:guide.id,shape:{status:'ok',take_home:1000,not_counted,total_out:450+not_counted,jobs:[{id:'fixed',amount:200},{id:'moved',amount:100},{id:'free',amount:150}]}});
}
const py=`import json,sys\nsys.path.insert(0,sys.argv[1])\nfrom app.services.penny_pay_split import GUIDES,compare_shape\ncases=json.load(sys.stdin)\nprint(json.dumps({'guides':GUIDES,'results':[compare_shape(c['shape'],c['guide']) for c in cases]}))`;
const response=JSON.parse(execFileSync(backend+'/.venv/bin/python',['-c',py,backend],{input:JSON.stringify(cases),encoding:'utf8'}));
assert.equal(Object.keys(response.guides).length,GUIDES.length);
for(const guide of GUIDES){
 const other=response.guides[guide.id];assert.equal(other.name,guide.name);assert.equal(other.short_name,guide.shortName);assert.deepEqual(other.shares,guide.shares);assert.deepEqual(other.ranges??null,guide.ranges??null);
}
const fields={actual:'actual',guide:'guide',delta:'delta',incomeShare:'income_share',guideShare:'guide_share',guideMin:'guide_min',guideMax:'guide_max',guideShareMin:'guide_share_min',guideShareMax:'guide_share_max',position:'position'};
for(let i=0;i<cases.length;i++){
 const actual=compareShape(cases[i].shape,GUIDES.find(g=>g.id===cases[i].guide)),other=response.results[i];assert.equal(actual.available,other.available);
 if(cases[i].shape.not_counted !== undefined) { assert.equal(actual.totalOut,450+cases[i].shape.not_counted); assert.equal(actual.left,550-cases[i].shape.not_counted); }
 for(let j=0;j<actual.rows.length;j++)for(const [ts,py] of Object.entries(fields)){
  const a=actual.rows[j][ts],b=other.rows[j][py];
  if(typeof a==='number'&&typeof b==='number')assert.ok(Math.abs(a-b)<1e-8,`${i}/${j}/${ts}: ${a} != ${b}`);else assert.equal(a,b,`${i}/${j}/${ts}`);
 }
}
console.log(`B60/G341: ${GUIDES.length} guides and ${cases.length} penny-exact boundary comparisons match Penny`);
