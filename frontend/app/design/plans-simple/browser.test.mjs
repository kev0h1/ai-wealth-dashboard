import assert from "node:assert/strict";
import { openBrowser } from "./qa-browser.mjs";
const b=await openBrowser({origin:process.env.G291_TEST_ORIGIN||"http://127.0.0.1:3151",output:process.argv[2]});
const results=[];
const variants=process.env.G291_VARIANT?[process.env.G291_VARIANT]:["a","b"];
const phase=process.env.G291_PHASE||"all";
const selector=a=>`document.querySelector('[data-g291-action="${a}"]')`;
const step=s=>`document.querySelector('[data-g291-step="${s}"]')`;
// Respect the production sheet's intentional second-tap guard between steps.
const pauseBetweenTaps=()=>new Promise(resolve=>setTimeout(resolve,450));
const click=async a=>{await pauseBetweenTaps();await b.activate(selector(a));await b.settle();};
const expect=async s=>{await b.waitFor(step(s));await b.settle();};
const back=async()=>{await pauseBetweenTaps();await b.activate(`document.querySelector('[data-sheet-frame] header button[aria-label^="Back"]')`);await b.settle();};
const close=async()=>{await pauseBetweenTaps();await b.activate(`document.querySelector('[data-sheet-frame] header button[aria-label^="Close "]')`);await b.waitFor(`!document.querySelector('[data-sheet-frame]')`);await b.settle();};
const navigate=async(v,state,theme)=>b.navigate(`/design/plans-simple?${new URLSearchParams({variant:v,state,theme})}`,`document.querySelector('[data-g291-ready="true"]') && document.documentElement.classList.contains('dark')===${theme==="dark"}`);
async function measure(test){
  const r=await b.evaluate(`(()=>{const frame=document.querySelector('[data-sheet-frame]'),q=frame.getBoundingClientRect(),footer=frame.querySelector('[data-sheet-footer]');return{overflow:document.documentElement.scrollWidth>innerWidth+1,dialogs:document.querySelectorAll('[data-sheet-frame]').length,bounds:{left:q.left,right:q.right,bottom:q.bottom},width:innerWidth,height:innerHeight,footer:footer?footer.getBoundingClientRect().bottom:null,body:frame.innerText,fields:[...frame.querySelectorAll('input')].map(e=>({label:!!e.labels?.length,font:parseFloat(getComputedStyle(e).fontSize)}))}})()`);
  r.deleteContrast=await b.evaluate(`(()=>{
    const button=document.querySelector('[data-sheet-frame] [data-g291-action="delete"]');if(!button)return null;
    const canvas=document.createElement('canvas');canvas.width=canvas.height=1;const c=canvas.getContext('2d');
    const pixel=(colours)=>{c.clearRect(0,0,1,1);for(const colour of colours){c.fillStyle=colour;c.fillRect(0,0,1,1);}return [...c.getImageData(0,0,1,1).data].slice(0,3)};
    const style=getComputedStyle(button),panel=getComputedStyle(document.querySelector('[data-sheet-frame]'));
    const bg=pixel(['white',panel.backgroundColor,style.backgroundColor]),fg=pixel([style.color]);
    const luminance=rgb=>rgb.map(n=>{const v=n/255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4}).reduce((a,v,i)=>a+v*[.2126,.7152,.0722][i],0);
    const x=luminance(bg),y=luminance(fg);return (Math.max(x,y)+.05)/(Math.min(x,y)+.05);
  })()`);
  assert.ok(r.deleteContrast===null||r.deleteContrast>=4.5,'destructive action text contrast');
  assert.equal(r.overflow,false);assert.equal(r.dialogs,1);assert.ok(r.bounds.left>=-1&&r.bounds.right<=r.width+1&&r.bounds.bottom<=r.height+1);assert.ok(r.footer==null||r.footer<=r.height+1);assert.ok(r.fields.every(e=>e.label&&e.font>=16));results.push({...test,...r});return r;
}
try{
  if(phase!=="journeys")for(const variant of variants)for(const theme of ["light","dark"])for(const state of ["matched","no-history","one-account","many-accounts","short","offline","no-source"]){
    await b.viewport(390);await navigate(variant,state,theme);await click("open-view");await expect("view");
    await measure({variant,theme,state,step:"view"});
    if((state==="matched"||state==="short"||state==="offline")&&variant==="a")await b.shot(`view-${state}-${theme}`);
    await b.evaluate(`void(window.__g291Frame=document.querySelector('[data-sheet-frame]'))`);
    await click("edit");await expect("edit");assert.equal(await b.evaluate(`window.__g291Frame===document.querySelector('[data-sheet-frame]')`),true,"one physical sheet through edit");
    await measure({variant,theme,state,step:"edit"});
    if(state==="matched"&&variant==="b")await b.shot(`b-summary-${theme}`);
    if(variant==="b"&&["no-source","short"].includes(state))await b.shot(`${state}-${theme}`);
    if(state==="no-source")assert.equal(await b.evaluate(`${selector("save")}.disabled`),true);
    if(process.env.G291_CONFIRM==="1"&&(phase==="layouts"||state!=="matched")){await close();continue;}
    await click("edit-name");await expect("purpose");await b.type(`document.querySelector('[data-g291-field="name"]')`,"Changed draft");
    await click("next-purpose");await expect("edit");await back();await expect("view");
    assert.doesNotMatch(await b.evaluate(`document.querySelector('[data-sheet-frame]').innerText`),/Changed draft/,"Back discards visible unsaved changes");
    await click("pause");await expect("pause");await click("confirm-pause");await expect("result");await click("view-result");await expect("view");
    assert.match(await b.evaluate(`document.querySelector('[data-sheet-frame]').innerText`),/Paused/);await click("resume");await expect("result");await click("view-result");await expect("view");
    await click("delete");await expect("delete");await back();await expect("view");await click("delete");await expect("delete");await click("confirm-delete");await expect("result");
    assert.equal(await b.evaluate(`!!${selector("view-result")}`),false);await click("close");await b.waitFor(`!document.querySelector('[data-sheet-frame]')`);
    assert.equal(await b.evaluate(`document.querySelector('[data-g291-saved-status]').dataset.g291SavedStatus`),"deleted");
  }
  if(phase!=="layouts"){
  // Create a keep-here set-aside: one-account case must not demand a pot/rule.
  for(const variant of variants){
    await b.viewport(390);await navigate(variant,"one-account","dark");await click("start");await expect("purpose");await b.type(`document.querySelector('[data-g291-field="name"]')`,"School clothes");await click("next-purpose");await expect("kind");await click("choose-aside");
    if(variant==="a"){await expect("amount");await b.type(`document.querySelector('[data-g291-field="amount"]')`,"75.25");await click("next-details");await expect("source");assert.equal(await b.evaluate(`document.querySelectorAll('[role=radio]').length`),0);await click("confirm-source");}
    else{await expect("review");assert.equal(await b.evaluate(`${selector("save")}.disabled`),true);await click("edit-target");await expect("amount");await b.type(`document.querySelector('[data-g291-field="amount"]')`,"75.25");await click("next-details");await expect("review");await click("confirm-source");}
    await expect("review");await measure({variant,state:"one-account",step:"new-aside-review"});await b.shot(`${variant}-new-aside`);assert.doesNotMatch(await b.evaluate(`document.querySelector('[data-sheet-frame]').innerText`),/Tracking:/);await click("save");await expect("result");await click("view-result");await expect("view");assert.match(await b.evaluate(`document.querySelector('[data-sheet-frame]').innerText`),/75\.25/);await close();
  }
  // Goal creation, explicit source and suggested own-account payment confirmation.
  for(const variant of variants){
    await b.viewport(390);await navigate(variant,"matched","light");await click("start");await expect("purpose");await b.type(`document.querySelector('[data-g291-field="name"]')`,"Trip");await b.shot(`${variant}-question`);await click("next-purpose");await expect("kind");await click("choose-goal");
    if(variant==="a"){await expect("target");await b.shot("a-target");await click("next-details");await expect("source");await click("confirm-source");await expect("destination");await click("confirm-destination");await expect("tracking");await click("confirm-transfer");}
    else{await expect("review");await click("confirm-source");await click("edit-tracking");await expect("tracking");await click("confirm-transfer");}
    await expect("review");await b.shot(`${variant}-goal-review`);assert.match(await b.evaluate(`document.querySelector('[data-sheet-frame]').innerText`),/Payment confirmed/);await click("save");await expect("result");await click("view-result");await expect("view");assert.match(await b.evaluate(`document.querySelector('[data-sheet-frame]').innerText`),/£0 of £1,200/,"new goal does not inherit saved progress");await close();
  }
  // No-history disclosure, actionable shortfall, unknown quote and preserved saved progress.
  await navigate("b","many-accounts","dark");await click("open-view");await click("edit");await click("edit-destination");await expect("destination");
  await pauseBetweenTaps();await b.activate(`[...document.querySelectorAll('[data-sheet-frame] [role="radio"]')].find(e=>e.innerText.includes('Bills account'))`);await b.settle();await click("confirm-destination");await expect("edit");await click("edit-tracking");await expect("tracking");assert.match(await b.evaluate(`document.querySelector('[data-sheet-frame]').innerText`),/Suggested past payment/);await click("confirm-transfer");await expect("edit");await click("save");await expect("result");await click("view-result");await expect("view");assert.match(await b.evaluate(`document.querySelector('[data-sheet-frame]').innerText`),/Bills account/);await b.shot("optional-other-account");await close();
  await navigate("a","no-history","dark");await click("open-view");await click("edit");await click("edit-tracking");await expect("tracking");await b.shot("no-history");assert.match(await b.evaluate(`document.querySelector('[data-sheet-frame]').innerText`),/until we see a matching payment/);await click("skip-transfer");await expect("edit");await close();
  await navigate("b","short","light");await click("open-view");await click("edit");await expect("edit");await click("lower-target");await expect("target");assert.equal(await b.evaluate(`document.activeElement.id`),"target");await b.type(`document.querySelector('[data-g291-field="target"]')`,"1000");await click("next-details");await expect("edit");assert.doesNotMatch(await b.evaluate(`document.querySelector('[data-sheet-frame]').innerText`),/1,437 short/);await close();
  await navigate("b","matched","light");await click("open-view");await click("edit");await click("edit-target");await expect("target");await pauseBetweenTaps();await b.activate(`document.querySelector('#target-month')`);await b.waitFor(`document.querySelectorAll('[data-sheet-frame]').length===2`);await b.shot("month-picker");await b.key("Escape","Escape",27);await b.waitFor(`document.querySelectorAll('[data-sheet-frame]').length===1`);await expect("target");await close();
  // Narrow / desktop and keyboard native focus, no keyboard simulation claims.
  for(const width of [320,1280]){await b.viewport(width);await navigate("b","matched","dark");await click("open-view");await click("edit");await expect("edit");await measure({variant:"b",width,step:"edit"});await b.shot(width===320?"narrow":"desktop");await close();}
  await b.viewport(390);await navigate("a","matched","light");await b.evaluate(`${selector("open-view")}.focus()`);await b.key("Enter","Enter",13);await expect("view");await b.key("Tab","Tab",9);assert.equal(await b.evaluate(`document.querySelector('[data-sheet-frame]').contains(document.activeElement)`),true,"focus remains in sheet");
  }
  assert.deepEqual(b.exceptions,[]);assert.deepEqual(b.apiRequests,[]);await b.save(`results-${phase}-${process.env.G291_VARIANT||"both"}`,{phase,variants,layouts:results.length,results,interactions:phase==="layouts"?"view/edit, native touch, sheet identity and geometry passed":"create goal/set-aside, edit, unsaved Back, pause/resume/delete, source confirmation, known/no-history rule, affordability, month picker, touch and keyboard passed",exceptions:b.exceptions,apiRequests:b.apiRequests});console.log(JSON.stringify({phase,variants,layouts:results.length,interactions:"passed",output:b.output}));
}finally{b.close();}
