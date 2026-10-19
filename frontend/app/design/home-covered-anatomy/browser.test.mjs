import assert from "node:assert/strict";
import { openBrowser } from "./qa-browser.mjs";
const b=await openBrowser({origin:process.env.G292_TEST_ORIGIN||"http://127.0.0.1:3149",output:process.argv[2]});
const results=[];
const navigate=async(variant,state,mode,masked=false)=>b.navigate(`/design/home-covered-anatomy?${new URLSearchParams({variant,state,mode,masked:masked?"1":"0"})}`,`document.querySelector('[data-g292-ready="true"][data-g292-variant="${variant}"][data-g292-state="${state}"]') && document.documentElement.classList.contains('dark') === ${mode==="dark"}`);
try {
  const cases=[];
  for(const variant of ["a","b","c"])for(const mode of ["light","dark"]){for(const state of ["covered","family","long","masked","missing-body"])cases.push({variant,mode,state,width:390});cases.push({variant,mode,state:"long",width:320},{variant,mode,state:"family",width:1280});}
  cases.push({variant:"a",mode:"dark",state:"family",width:390,masked:true});
  for(const test of cases){
    const{variant,state,mode,width,masked=false}=test;await b.viewport(width);await navigate(variant,state,mode,masked);
    const m=await b.evaluate(`(()=>{
      const card=document.querySelector('[data-g292-card="covered"] > div'),head=card.firstElementChild;
      const lead=card.querySelector('[data-brief-lead]'),body=[...card.children].find(e=>e.tagName==='P'&&!e.hasAttribute('data-brief-lead'));
      const title=head.querySelector('p'),dismiss=card.querySelector('button[aria-label="Hide on Home"]');
      const r=card.getBoundingClientRect(),d=dismiss.getBoundingClientRect(),t=title.getBoundingClientRect();
      const bounds=e=>{const q=e.getBoundingClientRect();return{x:q.x,right:q.right,width:q.width,height:q.height}};
      const count=[...head.querySelectorAll('svg')].filter(e=>e.getBoundingClientRect().height>0).length;
      return{width:innerWidth,overflow:document.documentElement.scrollWidth>innerWidth+1,card:bounds(card),title:bounds(title),lead:lead?bounds(lead):null,body:body?bounds(body):null,marks:count,dismiss:bounds(dismiss),overlap:t.right>d.x+.5&&t.y<d.bottom&&t.bottom>d.y,
        family:[...document.querySelectorAll('[data-g292-card]')].map(e=>({kind:e.dataset.g292Card,...bounds(e)})),
        text:document.querySelector('#g292-preview-cards').innerText};})()`);
    assert.equal(m.width,width);assert.equal(m.overflow,false,JSON.stringify({test,m}));assert.equal(m.overlap,false,`${variant}/${state}: dismiss clear of title`);
    assert.equal(m.marks,variant==="c"?0:1,"one visual signifier, or word-only");
    assert.ok(m.dismiss.width>=44&&m.dismiss.height>=44);
    for(const part of [m.lead,m.body].filter(Boolean))assert.ok(Math.abs(part.x-m.title.x)<1,`${variant}/${width}/${state}: consistent text edge: ${JSON.stringify(m)}`);
    assert.ok(m.family.every(r=>r.x>=0&&r.right<=width+1),"family fits viewport");
    if(state==="family")assert.deepEqual(m.family.map(x=>x.kind),["covered","cover","move","tip"]);
    if(state==="masked"||masked)assert.doesNotMatch(m.text,/£[\d,]+/,"masked figures don't leak in card text");
    if(width===390&&state==="covered")await b.shot(`${variant}-${mode}-covered`,{full:true});
    if(variant==="a"&&mode==="dark"&&state==="family"&&width===390&&!masked)await b.shot("mobile",{full:true});
    if(variant==="a"&&mode==="light"&&state==="family"&&width===1280)await b.shot("desktop",{full:true});
    if(variant==="b"&&mode==="dark"&&state==="long"&&width===320)await b.shot("user-320",{full:true});
    if(masked)await b.shot("masked-family",{full:true});
    results.push({...test,...m});
  }
  await b.viewport(390);await navigate("a","family","dark");
  await b.activate(`document.querySelector('[data-g292-card="covered"] > div')`);
  await b.waitFor(`document.querySelector('[data-g292-destination="/upcoming"]')`);
  await b.activate(`document.querySelector('[data-g292-card="tip"] button:not([aria-label="Dismiss insight"])')`);
  await b.waitFor(`document.querySelector('[data-g292-destination]').dataset.g292Destination.includes('transactions')`);
  assert.equal(await b.evaluate("location.pathname"),"/design/home-covered-anatomy");
  await b.activate(`document.querySelector('[data-g292-card="covered"] button[aria-label="Hide on Home"]')`);
  await b.waitFor(`!document.querySelector('[data-g292-card="covered"] > div')`);
  await b.activate(`[...document.querySelectorAll('button')].find(e=>e.textContent==='Reset')`);
  await b.waitFor(`document.querySelector('[data-g292-card="covered"] > div')`);
  await b.activate(`document.querySelector('[data-g292-card="tip"] button[aria-label="Dismiss insight"]')`);
  await b.waitFor(`!document.querySelector('[data-g292-card="tip"] button')`);
  await navigate("b","covered","light");
  await b.evaluate(`document.querySelector('[data-g292-card="covered"] > div').focus()`);
  await b.key("Enter","Enter",13);await b.waitFor(`document.querySelector('[data-g292-destination="/upcoming"]')`);
  assert.notEqual(await b.evaluate(`getComputedStyle(document.querySelector('[data-g292-card="covered"] > div')).boxShadow`),"none","keyboard focus visible");
  assert.deepEqual(b.exceptions,[],"no page exceptions");assert.deepEqual(b.apiRequests,[],"no customer API attempts");
  await b.save("results",{layouts:results.length,interactions:"real touch/keyboard open routes, both local dismiss paths and Reset",exceptions:b.exceptions,apiRequests:b.apiRequests,results});
  console.log(JSON.stringify({layouts:results.length,interactions:"passed",output:b.output}));
} finally {b.close();}
