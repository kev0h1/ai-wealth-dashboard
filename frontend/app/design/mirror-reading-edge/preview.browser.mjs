// Local fixture preview only; API and external requests are blocked.
import assert from "node:assert/strict";
import { openBrowser } from "../../../scripts/g293-browser-helper.mjs";
const b = await openBrowser({ origin: process.argv[2] ?? "http://127.0.0.1:3162", output: process.argv[3] ?? "/tmp/g302-review" });
const results = [], findings = [];
const ready = "document.querySelector('[data-g302-preview][data-ready=true]')";
const card = id => `document.querySelector('[data-preview-trait="${id}"]')`;
const button = (label, scope = "document") => `[...(${scope}).querySelectorAll('button')].find(e=>e.textContent.trim()===${JSON.stringify(label)}&&e.getClientRects().length)`;
const go = async (query = "", width = 390) => { await b.viewport(width, 844); await b.navigate(`/design/mirror-reading-edge?clean=1&${query}`, ready); await b.waitFor(`document.documentElement.classList.contains('dark')===${query.includes("mode=dark")}`); };
const click = async (label, scope) => {
  await b.evaluate("Promise.all(document.getAnimations().map(animation=>animation.finished.catch(()=>{}))).then(()=>true)");
  await b.activate(button(label, scope));
};
const layout = async label => {
  const m = await b.evaluate(`(()=>{
    const visible=e=>e.getClientRects().length&&getComputedStyle(e).visibility!=='hidden';
    const box=e=>{const r=e.getBoundingClientRect();return{x:r.x,y:r.y,right:r.right,width:r.width,height:r.height}};
    const lum=rgb=>{const a=rgb.match(/[\\d.]+/g).slice(0,3).map(Number).map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4});return .2126*a[0]+.7152*a[1]+.0722*a[2]};
    return {width:innerWidth,overflow:document.documentElement.scrollWidth>innerWidth+1,cards:[...document.querySelectorAll('[data-preview-trait]')].filter(visible).map(root=>{
      const header=root.querySelector(':scope>section>header'),title=header.querySelector('h2');
      const narrative=header.querySelector('h2+p'),facts=header.querySelector(':scope>div:not(:first-child):not([aria-label])');
      const grid=header.querySelector('[aria-label]'),icon=root.querySelector('[data-pattern-icon]'),footer=root.querySelector('footer');
      const background=getComputedStyle(root).backgroundColor;
      return{id:root.dataset.previewTrait,root:box(root),title:box(title),narrative:box(narrative),facts:facts?[...facts.children].map(box):[],grid:box(grid),footer:box(footer),visibleHeaderIcons:[...header.querySelectorAll('span[aria-hidden=true]')].filter(visible).length,icon:icon?{...box(icon),background:getComputedStyle(icon).backgroundColor,hidden:icon.getAttribute('aria-hidden'),svg:box(icon.querySelector('svg'))}:null,
        contrast:[...root.querySelectorAll('h2,p,button')].filter(visible).filter(e=>!e.disabled).map(e=>{const color=getComputedStyle(e).color;const l1=lum(color),l2=lum(getComputedStyle(e).backgroundColor==='rgba(0, 0, 0, 0)'?background:getComputedStyle(e).backgroundColor);return{text:e.textContent.slice(0,40),ratio:(Math.max(l1,l2)+.05)/(Math.min(l1,l2)+.05)}})};
    }),small:[...document.querySelectorAll('button,input,a')].filter(visible).filter(e=>e.getBoundingClientRect().height<43.5).map(e=>({text:e.textContent,height:e.getBoundingClientRect().height})),explanations:document.querySelectorAll('[data-coaching-explanation]').length,body:document.body.innerText};
  })()`);
  const errors=[];
  if(m.overflow)errors.push("page overflow");
  if(m.small.length)errors.push("small touch targets");
  for(const item of m.cards){
    const edge=item.root.x+17;
    for(const [part,x] of [["title",item.title.x],["narrative",item.narrative.x],["choices",item.grid.x],...item.facts.map((f,i)=>["fact"+i,f.x])])if(Math.abs(x-edge)>1.1)errors.push(item.id+": "+part+" lost the reading edge");
    if(!item.icon||item.icon.width!==16||item.icon.svg.width!==16||item.icon.svg.height!==16||item.icon.background!=="rgba(0, 0, 0, 0)"||item.icon.hidden!=="true")errors.push(item.id+": missing or inconsistent pattern icon");
    if(item.visibleHeaderIcons)errors.push(item.id+": duplicated category icon");
    if(item.icon&&(Math.abs(item.icon.right-(item.root.right-17))>1.1||Math.abs(item.icon.y-(item.root.y+17))>1.1))errors.push(item.id+": pattern icon lost its shared position");
    if(item.contrast.some(c=>c.ratio<4.5))errors.push(item.id+": text contrast");
  }
  if(m.body.includes("Choose what feels right for this trait."))errors.push("repeated idle help is visible");
  if(m.cards.length&&m.explanations!==1)errors.push("coaching explanation is not shown once");
  results.push({label,...m});if(errors.length)findings.push({label,errors,...m});
};
try{
  for(const variant of ["a","b"])for(const mode of ["light","dark"]){
    await go(`variant=${variant}&mode=${mode}`);await layout(`${variant}-${mode}-all`);await b.shot(`${variant}-${mode}-all`,{full:true});
    await click("Keep this trait",card("orchestrator"));await b.waitFor(`${card("orchestrator")}.textContent.includes('no coaching on this trait')`);
    await click("Change this trait",card("signature_pleasure"));await b.waitFor(`${card("signature_pleasure")}.textContent.includes('Set an aim for Eating Out')`);
    assert.equal(await b.evaluate("!!document.querySelector('[data-sheet-frame]')"),false,"choosing change never auto-opens an aim editor");
    await click("Set an aim for Eating Out",card("signature_pleasure"));await b.waitFor("document.querySelector('[data-sheet-frame]')");
    await b.evaluate("Promise.all(document.getAnimations().map(animation=>animation.finished.catch(()=>{}))).then(()=>true)");
    await b.type("document.querySelector('input[name=aim_amount]')","120.50");await b.settle();await click("Save aim");await b.waitFor("document.body.innerText.includes('Aim set, Penny will track it with you.')");await click("Done");await b.waitFor("!document.querySelector('[data-sheet-frame]')");
    await b.waitFor(`${card("signature_pleasure")}.textContent.includes('£120.50')`);
    await b.activate(`(${card("signature_pleasure")}).querySelector('footer button')`);await b.waitFor(`document.querySelector('[data-primary-pattern] [data-preview-trait=signature_pleasure]')`);await b.settle();
    assert.equal(await b.evaluate("document.activeElement===document.querySelector('[data-primary-pattern]')"),true,"evidence promotion retains G286 primary-card focus");
    await layout(`${variant}-${mode}-active`);await b.shot(`${variant}-${mode}-active`,{full:true});
    await click("Stop checking this aim",card("signature_pleasure"));await b.waitFor("document.body.innerText.includes('Confirm stop')");await click("Keep checking");
    await click("Stop checking this aim",card("signature_pleasure"));await click("Confirm stop");await b.waitFor(`${card("signature_pleasure")}.textContent.includes('Set an aim for Eating Out')`);
    await go(`variant=${variant}&mode=${mode}&state=completed`);await click("Keep this pace",card("signature_pleasure"));await b.waitFor(`${card("signature_pleasure")}.textContent.includes('Your chosen pace is being checked')`);
    await go(`variant=${variant}&mode=${mode}&state=save-error`);await click("Keep this trait",card("saving_habit"));await b.waitFor("document.body.innerText.includes('That did not save')");
    await click("Keep this trait",card("saving_habit"));await b.waitFor(`${card("saving_habit")}.textContent.includes('no coaching on this trait')`);
    await go(`variant=${variant}&mode=${mode}&state=error`);await click("Try again",card("signature_pleasure"));await b.waitFor(`${card("signature_pleasure")}.textContent.includes('Set an aim for Eating Out')`);
  }
  for(const variant of ["a","b"])for(const width of [320,768,1280]){
    await go(`variant=${variant}&mode=dark&state=long`,width);await layout(`${variant}-${width}-long`);
    if(width===320||width===1280)await b.shot(`${variant}-${width}-long`,{full:true});
  }
  for(const variant of ["a","b"])for(const state of ["active","completed","kept","loading","error","hidden","single","hygiene-clear","empty","insufficient"]){
    await go(`variant=${variant}&state=${state}&mode=dark`);await layout(`${variant}-${state}`);
    if(state==="hidden")assert.ok(!/£[0-9]/.test(await b.evaluate("document.querySelector('[data-g302-preview]').innerHTML")),"hidden amounts do not leak through accessible attributes");
    if(state==="hygiene-clear"){await click("Payment-related records");await b.waitFor("document.body.innerText.includes('No connected-bank records are loaded')");}
  }
  await go("variant=b");await b.evaluate(`(${card("signature_pleasure")}).querySelector('footer button').focus()`);await b.key("Enter","Enter",13);await b.waitFor("document.querySelector('[data-primary-pattern] [data-preview-trait=signature_pleasure]')");
  await b.viewport(390,844);await b.navigate("/design/mirror-reading-edge?variant=b",ready);await layout("preview-controls");await b.shot("preview-controls",{full:true});
  assert.deepEqual(b.exceptions,[]);assert.deepEqual(b.apiRequests,[]);
  const storage=await b.evaluate("({local:Object.keys(localStorage),session:Object.keys(sessionStorage).filter(key=>!key.startsWith('wd_scroll:/design/mirror-reading-edge'))})");assert.deepEqual(storage,{local:[],session:[]});
  await b.save("checks",{results,findings,exceptions:b.exceptions,apiRequests:b.apiRequests,storage});assert.deepEqual(findings,[]);
  console.log(`G302: ${results.length} layout/contrast checks; real keep/change/aim/stop/completion/retry, evidence focus/keyboard and no API/storage writes. ${b.output}`);
}catch(error){await b.shot("failed-view",{full:true});await b.save("checks-incomplete",{results,findings,exceptions:b.exceptions,apiRequests:b.apiRequests,error:error.message});throw error;}finally{b.close();}
