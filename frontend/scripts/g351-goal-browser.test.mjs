// Mount fixtures/g351-goal-flow.tsx at temporary /design/g351-production-qa.
import assert from 'node:assert/strict';
import { openBrowser } from './_plan-browser.mjs';
const b=await openBrowser({origin:process.env.PLAN_QA_ORIGIN??'http://127.0.0.1:3371',output:'/tmp/g351-fold-evidence'});
const delay=ms=>new Promise(r=>setTimeout(r,ms));
const button=label=>`Array.from((document.querySelector('[data-sheet-frame]')??document).querySelectorAll('button')).find(e=>e.textContent.trim()===${JSON.stringify(label)})`;
async function click(label){await b.waitFor(button(label));await b.evaluate(`${button(label)}.scrollIntoView({block:'center',behavior:'instant'})`);await delay(250);await b.activate(button(label));await b.settle();}
async function reset(width=390,dark=true){await b.viewport(width,width===320?740:900);await b.navigate('/design/g351-production-qa',"document.documentElement?.dataset.g351Ready==='true'");await b.evaluate(`document.documentElement.classList.toggle('dark',${dark});const style=document.createElement('style');style.textContent='nextjs-portal{display:none}';document.head.append(style)`);}
const editor="document.querySelector('section[aria-label=\"Edit schedule\"]')";
let checks=0;
try{
 for(const [width,dark] of [[320,true],[390,false],[1440,true]]){
  await reset(width,dark);
  assert.equal(await b.evaluate('document.documentElement.scrollWidth>innerWidth'),false);
  const spacing=await b.evaluate(`(()=>{const d=document.querySelector('[data-schedule-disclosure]'),button=d.querySelector('button'),r=button.getBoundingClientRect();const node=button.firstChild,range=document.createRange();range.selectNodeContents(node);const t=range.getBoundingClientRect();return {above:t.top-r.top,below:r.bottom-t.bottom};})()`);
  assert.ok(Math.abs(spacing.above-spacing.below)<=2,JSON.stringify(spacing));checks++;
  await b.shot(`confirm-${width}-${dark?'dark':'light'}`,{full:true});
  await click('See full schedule');assert.equal(await b.evaluate("document.querySelector('[data-schedule-disclosure] button').getAttribute('aria-expanded')"),'true');
  assert.match(await b.evaluate("document.querySelector('[data-schedule-disclosure]').textContent"),/434\.00/);checks++;
  await click('Hide full schedule');await click('Hide figures');assert.doesNotMatch(await b.evaluate("document.querySelector('[aria-label=\"Goal proposal\"]').textContent"),/£\d|4p/);checks++;
  await click('Edit schedule');assert.match(await b.evaluate(`${editor}.textContent`),/Show figures/);await click('Back');await click('Hide figures');
 }
 await reset();await click('Change');await b.waitFor("document.querySelector('[role=\"radiogroup\"]')");
 assert.doesNotMatch(await b.evaluate('document.body.textContent'),/Saving Challenge pot/);
 await b.evaluate("Array.from(document.querySelectorAll('button')).find(e=>e.textContent.includes('Joint current account')).click()");
 await click('Update proposal');await b.waitFor("document.querySelector('#proposal-id').textContent.startsWith('revision-')");assert.equal(await b.evaluate("document.querySelector('#writes').textContent"),'0');checks++;
 await click('Edit schedule');await b.waitFor(`${button('Update proposal')}?.disabled===false`);
 const first=`Array.from(${editor}.querySelectorAll('input')).find(e=>e.inputMode==='decimal')`;
 await b.type(first,'0.12');await delay(400);await b.type(first,'0.08');await delay(1400);
 assert.match(await b.evaluate(`${editor}.textContent`),/£5,343\.6/);assert.doesNotMatch(await b.evaluate(`${editor}.textContent`),/£8,015/);checks++;
 await click('Update proposal');await b.waitFor("document.querySelector('[aria-label=\"Goal proposal\"]')");assert.match(await b.evaluate('document.body.textContent'),/£5,343\.60/);assert.equal(await b.evaluate("document.querySelector('#writes').textContent"),'0');checks++;
 await click('Create goal');assert.equal(await b.evaluate("document.querySelector('#writes').textContent"),'1');checks++;
 await reset();await click('View plan');await b.waitFor("document.querySelector('[data-sheet-frame] [data-goal-schedule-details]')");await b.shot('plan-390-dark');
 await click('Edit schedule');await b.waitFor(`${button('Save changes')}?.disabled===false`);await click('Save changes');await b.waitFor("document.querySelector('[data-sheet-frame] [data-goal-schedule-details]')");assert.equal(await b.evaluate("document.querySelector('#writes').textContent"),'1');checks++;
 await reset();await b.evaluate("document.querySelector('#fail-save').click()");await click('View plan');await click('Edit schedule');await b.waitFor(`${button('Save changes')}?.disabled===false`);await click('Save changes');await b.waitFor("document.querySelector('[role=alert]')");assert.equal(await b.evaluate("document.querySelector('#writes').textContent"),'0');checks++;
 await reset();await b.evaluate("document.querySelector('#fail-refresh').click()");await click('View plan');await click('Edit schedule');await b.waitFor(`${button('Save changes')}?.disabled===false`);await click('Save changes');await b.waitFor(button('Retry refresh'));assert.equal(await b.evaluate("document.querySelector('#writes').textContent"),'1');await click('Retry refresh');await b.waitFor("document.querySelector('[data-sheet-frame] [data-goal-schedule-details]')");assert.equal(await b.evaluate("document.querySelector('#writes').textContent"),'1');checks++;
 assert.deepEqual(b.exceptions,[]);assert.deepEqual(b.apiRequests,[]);await b.save('results',{checks});console.log(`G351: ${checks} browser checks passed`);
}finally{b.close();}
