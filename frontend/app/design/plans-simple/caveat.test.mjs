import assert from "node:assert/strict";
import {openBrowser} from "./qa-browser.mjs";
const b=await openBrowser({origin:process.env.G291_TEST_ORIGIN||"http://127.0.0.1:3155",output:process.argv[2]});
const results=[];
const pause=()=>new Promise(r=>setTimeout(r,450));
async function click(selector){await pause();await b.activate(selector);await b.settle();}
async function check(variant,theme,state,step){
  const row=await b.evaluate(`(()=>{const f=document.querySelector('[data-sheet-frame]'),r=f.getBoundingClientRect();return{text:f.innerText,overflow:document.documentElement.scrollWidth>innerWidth+1,right:r.right,width:innerWidth,footer:f.querySelector('[data-sheet-footer]')?.getBoundingClientRect().bottom??0,height:innerHeight,save:f.querySelector('[data-g291-action="save"]')?.disabled??null,optional:[...f.querySelectorAll('button')].some(e=>e.innerText==='Use another account instead')}})()`);
  assert.match(row.text,/Check Upcoming to see if it fits before payday/);assert.equal(row.overflow,false);assert.ok(row.right<=row.width+1);assert.ok(row.footer<=row.height+1);
  if(state==="no-source"){assert.equal(row.optional,false);if(step==="edit")assert.equal(row.save,true);else {assert.match(row.text,/planned each pay period/);assert.match(row.text,/Choose a paying account before this amount is held back/);assert.doesNotMatch(row.text,/£100 held back/);}}
  if(state==="many-accounts"&&step==="edit")assert.equal(row.optional,true);
  if(variant==="b")await b.shot(`${state}-${theme}-${step}`);
  results.push({variant,theme,state,step,...row});
}
try{
  await b.viewport(390);
  for(const variant of ["a","b"])for(const theme of ["light","dark"])for(const state of ["one-account","many-accounts","no-source"]){
    await b.navigate(`/design/plans-simple?${new URLSearchParams({variant,theme,state})}`,`document.querySelector('[data-g291-ready="true"]')`);
    await click(`document.querySelector('[data-g291-action="open-view"]')`);await b.waitFor(`document.querySelector('[data-g291-step="view"]')`);await check(variant,theme,state,"view");
    await click(`document.querySelector('[data-g291-action="edit"]')`);await b.waitFor(`document.querySelector('[data-g291-step="edit"]')`);await check(variant,theme,state,"edit");
    await click(`document.querySelector('[data-sheet-frame] header button[aria-label^="Close "]')`);await b.waitFor(`!document.querySelector('[data-sheet-frame]')`);await pause();
  }
  assert.deepEqual(b.exceptions,[]);assert.deepEqual(b.apiRequests,[]);
  await b.save("results",{layouts:results.length,results,exceptions:b.exceptions,apiRequests:b.apiRequests});console.log(JSON.stringify({layouts:results.length,checks:"Upcoming cue, source-only plan amount, missing-source blocking, optional route, themes, geometry and zero APIs passed"}));
}finally{b.close();}
