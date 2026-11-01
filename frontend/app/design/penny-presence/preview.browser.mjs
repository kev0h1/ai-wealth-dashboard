// Synthetic-only browser QA. Never imported by the design route.
import assert from "node:assert/strict";
import { openBrowser } from "../../../scripts/_plan-browser.mjs";

const output = process.argv[2];
const browser = await openBrowser({ origin: process.env.G388_TEST_ORIGIN || "http://127.0.0.1:3188", output });
const { evaluate, waitFor, navigate, viewport, activate, key, shot, save, settle } = browser;
const results = [];
const variants = ["a", "b", "c", "current"];
const states = ["stack", "card-detail", "cover-plan", "payday-plan", "covered"];
const route = (variant, state, mode, options = {}) => `/design/penny-presence?${new URLSearchParams({ variant, state, mode, clean: "1", ...options })}`;
const ready = variant => `document.querySelector('[data-g388-ready="true"][data-g388-variant="${variant}"]')`;

async function measure() {
  return evaluate(`(() => {
    const root=document.querySelector('#presence-example');
    const cards=[...root.querySelectorAll('[data-g388-card]')];
    const nav=root.querySelector('[data-g388-nav]');
    const door=nav?.querySelector('button[aria-label="Ask Penny"]');
    const rect=e=>{const r=e.getBoundingClientRect();return {x:r.x,y:r.y,right:r.right,bottom:r.bottom,width:r.width,height:r.height}};
    const rgb=colour=>{const c=document.createElement('canvas');c.width=c.height=1;const ctx=c.getContext('2d');ctx.fillStyle=colour;ctx.fillRect(0,0,1,1);return [...ctx.getImageData(0,0,1,1).data].slice(0,3)};
    const luminance=colour=>rgb(colour).map(v=>v/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4).reduce((sum,v,i)=>sum+v*[.2126,.7152,.0722][i],0);
    const contrast=(a,b)=>{const x=luminance(a),y=luminance(b);return(Math.max(x,y)+.05)/(Math.min(x,y)+.05)};
    const primaries=[...root.querySelectorAll('button.bg-indigo-600,a.bg-indigo-600')];
    const badges=[...root.querySelectorAll('[data-g388-card] span[style*="linear-gradient"]')];
    const visible=e=>{const r=e.getBoundingClientRect();return r.width>0&&r.height>0&&getComputedStyle(e).display!=='none'};
    return {width:innerWidth,overflow:document.documentElement.scrollWidth>innerWidth+1,root:rect(root),cards:cards.map(e=>({kind:e.dataset.g388Card,...rect(e)})),nav:nav?rect(nav):null,door:door?rect(door):null,
      primary:primaries.map(e=>({label:e.textContent.trim(),...rect(e),radius:getComputedStyle(e).borderRadius,background:getComputedStyle(e).backgroundColor,colour:getComputedStyle(e).color,contrast:contrast(getComputedStyle(e).color,getComputedStyle(e).backgroundColor)})),
      badges:badges.map(e=>({text:e.textContent.trim(),visible:visible(e),background:getComputedStyle(e).backgroundImage,colour:getComputedStyle(e).color})),
      covered:cards.find(e=>e.dataset.g388Card==='covered')?.textContent??null};
  })()`);
}

try {
  const matrix=[];
  for(const mode of ["light","dark"]) for(const variant of variants) {
    for(const state of states) matrix.push({mode,variant,state,width:390});
    if(variant!=="current") for(const width of [320,1280]) matrix.push({mode,variant,state:"stack",width});
    matrix.push({mode,variant,state:"stack",width:390,masked:true});
  }
  for(const test of matrix) {
    const {variant,state,mode,width,masked=false}=test;
    await viewport(width,900);
    await navigate(route(variant,state,mode,{masked:masked?"1":"0",clean:width>=900?"0":"1"}),ready(variant));
    const result=await measure();
    assert.equal(result.width,width);
    assert.equal(result.overflow,false,JSON.stringify({test,result}));
    assert.equal(result.cards.length,state==="stack"?4:1,JSON.stringify(test));
    assert.ok(result.root.x>=0&&result.root.right<=width+1,"working column stays inside viewport");
    assert.ok(result.nav&&result.door,"Penny navigation is rendered");
    assert.ok(result.door.width>=44&&result.door.height>=44,"Penny door has a thumb target");
    assert.ok(result.door.y>=0&&result.door.bottom<=900,"Penny door is visible in the initial viewport");
    assert.ok(result.nav.x>=result.root.x-1&&result.nav.right<=result.root.right+1,"navigation stays within its phone column");
    if(result.covered) assert.doesNotMatch(result.covered,/Penny/,'Covered remains an unbranded financial verdict');
    for(const primary of result.primary) {
      assert.ok(primary.height>=44&&primary.width>=44,JSON.stringify({test,primary}));
      if(variant!=="current") assert.ok(primary.contrast>=4.5,JSON.stringify({test,primary}));
    }
    if(variant!=="current") assert.ok(result.badges.every(b=>!b.visible||b.background==="none"),"no proposal puts the gradient on passive card attribution");
    if(variant==="c") assert.ok(result.badges.every(b=>!b.visible),"C removes repeated attribution badges");
    if(masked) {
      const markup=await evaluate("document.querySelector('#presence-example').outerHTML");
      assert.doesNotMatch(markup,/£\\?\d/,"money stays hidden in DOM and accessible names");
    }
    const capture=!masked&&state==="stack"&&(width===390||width===1280||(width===320&&mode==="dark"));
    if(capture) {
      await evaluate("scrollTo(0,0)");
      await settle();
      await shot(`${variant}-${mode}-${width}-stack`,{full:true});
    }
    results.push({...test,...result});
  }
  await save("matrix",results);

  // Touch the actual production-shaped actions and ordinary nav slots.
  await viewport(390,900);
  for(const variant of ["a","b","c"]) {
    for(const state of ["card-detail","cover-plan","payday-plan"]) {
      await navigate(route(variant,state,"dark"),ready(variant));
      await activate("document.querySelector('[data-g388-card] button.bg-indigo-600, [data-g388-card] a.bg-indigo-600')",true);
      await waitFor("document.querySelector('[data-g388-action]').textContent.startsWith('Preview only:')");
      assert.equal(await evaluate("location.pathname"),"/design/penny-presence");
      if(state==="cover-plan") {
        // Clicking the card's recommendation body must not bypass interception.
        const roleButton=await evaluate("!!document.querySelector('[data-g388-card] [role=button]')");
        if(roleButton) await activate("document.querySelector('[data-g388-card] [role=button]')",true);
        assert.equal(await evaluate("location.pathname"),"/design/penny-presence");
      }
    }
    await navigate(route(variant,"stack","dark"),ready(variant));
    for(const label of ["Home","Spend","Upcoming","Planning"]) {
      await activate(`[...document.querySelectorAll('[data-g388-nav] a')].find(e=>e.textContent.trim()==='${label}')`,true);
      await waitFor(`document.querySelector('[data-g388-action]').textContent.includes('${label}')`);
      assert.equal(await evaluate("location.pathname"),"/design/penny-presence");
    }
    await activate("document.querySelector('[data-g388-nav] button[aria-label=\"Ask Penny\"]')",true);
    await waitFor("!![...document.querySelectorAll('[role=dialog]')].find(e=>e.textContent.includes('Penny preview'))");
    await shot(`${variant}-dark-390-adviser`);
    assert.match(await evaluate("document.body.innerText"),/does not read your accounts or send a message/);
    await key("Escape","Escape",27);
    await waitFor("![...document.querySelectorAll('[role=dialog]')].some(e=>e.textContent.includes('Penny preview'))");
    await settle();
    assert.equal(await evaluate("document.activeElement?.getAttribute('aria-label')"),"Ask Penny","focus returns to the adviser door");
  }

  // Real keyboard activation, and reversible review controls.
  await navigate(route("a","card-detail","light",{clean:"0"}),ready("a"));
  await evaluate("document.querySelector('[data-g388-nav] button').focus()");
  await key("Enter","Enter",13);
  await waitFor("[...document.querySelectorAll('[role=dialog]')].some(e=>e.textContent.includes('Penny preview'))");
  await activate("[...document.querySelectorAll('button')].find(e=>e.textContent.trim()==='Back to the example')",false);
  await waitFor("![...document.querySelectorAll('[role=dialog]')].some(e=>e.textContent.includes('Penny preview'))");
  await activate("document.querySelector('summary')",true);
  await waitFor("document.querySelector('details').open");
  await activate("[...document.querySelectorAll('a')].find(e=>e.textContent.trim()==='Hide example figures')",true);
  await waitFor("location.search.includes('masked=1')&&document.querySelector('[data-g388-ready=\"true\"]')");
  await activate("document.querySelector('summary')",true);
  await activate("[...document.querySelectorAll('a')].find(e=>e.textContent.trim()==='Show example figures')",true);
  await waitFor("location.search.includes('masked=0')&&document.querySelector('[data-g388-ready=\"true\"]')");
  await navigate(route("invalid","invalid","invalid"),ready("a"));
  assert.equal((await measure()).cards.length,4,"malformed knobs fall back to the normal stack");
  assert.deepEqual(browser.exceptions,[],"no page exceptions");
  assert.deepEqual(browser.apiRequests,[],"no customer API attempts");
  await save("results",{layouts:results.length,interactions:"card/nav touch, role-button interception, adviser open/close, keyboard, focus, masking and parameter fallback",exceptions:browser.exceptions,apiRequests:browser.apiRequests});
  console.log(JSON.stringify({layouts:results.length,interactions:"passed",output}));
} finally { browser.close(); }
