// Optional real-component browser gate. Mount the g312 fixture in a temporary
// /design/g312-production-qa local route; remove that route before delivery.
import assert from "node:assert/strict";
import { openBrowser } from "./_plan-browser.mjs";
const browser = await openBrowser({ origin: process.env.PLAN_QA_ORIGIN ?? "http://127.0.0.1:3164", output: process.env.PLAN_QA_OUTPUT ?? "/tmp/g312-editor-qa" });
const button = text => `Array.from(document.querySelectorAll('button')).find(e=>e.textContent.trim()===${JSON.stringify(text)})`;
const writes = () => browser.evaluate("JSON.parse(document.querySelector('#fixture-writes').textContent)");
const text = () => browser.evaluate("document.querySelector('[data-sheet-frame]')?.textContent??''");
let checks = 0, capturedCopy = false;
async function click(name) { if(!await browser.evaluate(`Boolean(${button(name)})`)) { await browser.shot('failure'); throw Error(`Missing ${name}: ${await text()}; writes=${JSON.stringify(await writes())}`); } await browser.activate(button(name)); await browser.settle(); await new Promise(resolve=>setTimeout(resolve,450)); }
async function fit(name, capture = false) {
  const facts = await browser.evaluate(`(()=>{const d=document.querySelector('[data-sheet-frame]');const r=d.getBoundingClientRect(),f=d.querySelector('[data-sheet-footer]')?.getBoundingClientRect();return{dialogs:document.querySelectorAll('[role=dialog]:not([aria-label="Ask Penny"])').length,overflow:d.scrollWidth>d.clientWidth,left:r.left,right:r.right,width:innerWidth,footerTop:f?.top,footerBottom:f?.bottom,height:innerHeight,native:d.querySelectorAll('select,input[type=date],input[type=month],details').length}})()`);
  assert.equal(facts.dialogs, 1, name); assert.equal(facts.overflow, false, name); assert.equal(facts.native, 0, name);
  assert.ok(facts.left>=-1&&facts.right<=facts.width+1,name); assert.ok(facts.footerTop>=0&&facts.footerBottom<=facts.height+1,`${name}: footer ${JSON.stringify(facts)}`);
  if (capture) await browser.shot(name);
  checks++;
}
async function open(host, scenario) { await click(`${host}-${scenario}`); await browser.waitFor("document.querySelector('[data-plan-record]')"); }
async function close() { await browser.activate("document.querySelector('[data-sheet-frame] [aria-label^=\"Close \"]')"); await browser.waitFor("!document.querySelector('[data-sheet-frame]')"); }
async function reset(width=390, mode="light") { await browser.viewport(width, width===320?740:900); await browser.navigate('/design/g312-production-qa',"document.documentElement?.dataset.g312Ready==='true'"); await browser.evaluate(`document.documentElement.classList.toggle('dark',${mode==="dark"})`); }
async function review() { for(let i=0;i<4;i++) await click('Continue'); if(process.env.PLAN_QA_FUNCTIONAL_ONLY && !capturedCopy) { await fit('tracking-copy-390-light',true); await browser.evaluate("document.documentElement.classList.add('dark')"); await fit('tracking-copy-390-dark',true); await browser.evaluate("document.documentElement.classList.remove('dark')"); capturedCopy=true; } await click('Review changes'); }
try {
  for (const width of (process.env.PLAN_QA_FUNCTIONAL_ONLY ? [] : [320,390,1280])) for(const mode of ['light','dark']) for(const host of ['allocation','upcoming']) {
    await reset(width,mode); await open(host,'payment'); await fit(`${host}-view-${width}-${mode}`,[390,1280].includes(width)&&host==='upcoming');
    await click('Edit plan'); assert.doesNotMatch(await text(), /More options|How we recognise it|Save changes|Pause plan|Delete plan/);
    for (const step of ['purpose','details','source','destination','tracking','review']) {
      await fit(`${host}-${step}-${width}-${mode}`,host==='upcoming'&&(width===390||(width===1280&&['details','review'].includes(step))));
      if(step==='details') { assert.doesNotMatch(await text(), /28 Aug|25 Sept?/); assert.match(await text(), /1 Oct/); assert.equal(await browser.evaluate("document.querySelector('input[name=plan-amount]').value"),'376.60'); }
      if(step==='review') break;
      await click(step==='tracking'?'Review changes':'Continue');
    }
    assert.deepEqual(await writes(),[],'navigation never writes');
    await click('Back to plan'); await browser.waitFor("document.querySelector('[data-plan-record]')");
    assert.deepEqual(await writes(),[],'discard does not write');
    await click('Edit plan'); await browser.type("document.querySelector('input[name=plan-name]')",'Unsaved draft');
    const history=await browser.call('Page.getNavigationHistory'); await browser.call('Page.navigateToHistoryEntry',{entryId:history.entries[history.currentIndex-1].id}); await browser.waitFor("document.querySelector('[data-plan-record]')");
    assert.doesNotMatch(await text(),/Unsaved draft/); await close();
  }
  await reset(); await open('allocation','manual'); await click('Edit plan'); await browser.type("document.querySelector('input[name=plan-name]')",'Keyboard edit'); await browser.key('Enter','Enter',13); await browser.waitFor("document.querySelector('input[name=plan-amount]')"); assert.deepEqual(await writes(),[]); await click('Back to plan'); await browser.waitFor("document.querySelector('[data-plan-record]')"); assert.doesNotMatch(await text(),/Keyboard edit/); checks++; await close();
  await open('upcoming','suggested'); assert.match(await text(),/Suggested from recent transfers/); assert.doesNotMatch(await text(),/Paying account not linked/);
  await click('Edit plan'); await review(); assert.deepEqual(await writes(),[]); await click('Save changes'); await browser.waitFor("document.querySelector('[data-plan-record]')");
  const confirmed=await writes(); assert.equal(confirmed.length,1); assert.equal(confirmed[0].source_account_id,'current'); assert.equal('effective_from' in confirmed[0],false,'historic date unchanged'); checks++;
  await close(); await open('allocation','manual'); await click('Edit plan'); await review();
  await browser.activate("Array.from(document.querySelectorAll('button')).find(e=>e.textContent.startsWith('Details'))"); await browser.settle();
  await browser.type("document.querySelector('input[name=plan-amount]')",'401.235'); await click('Return to review'); assert.match(await text(),/Enter an amount/); assert.equal(await browser.evaluate(`${button('Save changes')}===undefined`),true);
  await browser.type("document.querySelector('input[name=plan-amount]')",'401.25'); await click('Return to review');
  await click('Save changes'); await browser.waitFor("document.querySelector('[data-plan-record]')"); const manual=await writes(); assert.equal(manual[0].amount_per_period,401.25); assert.equal(manual[0].tracking_mode,'manual'); assert.equal(manual[0].fill_account_id,''); checks++; await close();
  await open('allocation','category'); await click('Edit plan'); await click('Continue'); await click('Continue');
  await browser.activate("Array.from(document.querySelectorAll('button')).find(e=>e.textContent.includes('Joint Current Account'))"); await browser.settle();
  await click('Continue'); await click('Continue'); assert.match(await text(),/Not now/); assert.equal(await browser.evaluate("Array.from(document.querySelectorAll('label')).find(e=>e.textContent.includes('Not now')).querySelector('input').checked"),true);
  await click('Review changes'); await click('Save changes'); await browser.waitFor("document.querySelector('[data-plan-record]')"); const cleared=await writes(); assert.equal(cleared[0].category_tracking,null); assert.equal(cleared[0].match_value,''); assert.equal(cleared[0].source_account_id,'joint'); checks++; await close();
  await browser.activate("document.querySelector('#fail-save')"); await open('allocation','payment'); await click('Edit plan'); await review(); await click('Save changes'); await browser.waitFor("document.querySelector('[role=alert]')"); assert.equal((await writes()).length,1); await click('Save changes'); await browser.waitFor("document.querySelector('[data-plan-record]')"); assert.equal((await writes()).length,2); checks++; await close();
  await browser.activate("document.querySelector('#fail-refresh')"); await open('allocation','payment'); await click('Edit plan'); await review(); await click('Save changes'); await browser.waitFor("document.querySelector('[role=alert]')?.textContent.includes('will not be sent again')");
  assert.equal((await writes()).length,1); assert.equal(await browser.evaluate(`${button('Retry refresh')}.disabled`),false); await click('Retry refresh'); await browser.waitFor("document.querySelector('[data-plan-record]')"); assert.equal((await writes()).length,1); checks++; await close();
  await browser.activate("document.querySelector('#slow')"); await open('allocation','payment'); await click('Edit plan'); await review();
  await browser.evaluate(`${button('Save changes')}.click();${button('Save changes')}?.click()`); await browser.waitFor("document.querySelector('[data-plan-record]')"); assert.equal((await writes()).length,1); checks++; await close();
  await open('allocation','payment'); await click('Pause plan'); await browser.waitFor("!document.querySelector('[data-sheet-frame]')"); assert.deepEqual(await writes(),[{active:false}]); await open('allocation','payment'); await click('Delete plan'); assert.equal(await browser.evaluate("document.querySelector('#fixture-deletes').textContent"),'0'); await click('Keep plan'); assert.equal(await browser.evaluate("document.querySelector('#fixture-deletes').textContent"),'0'); await click('Delete plan'); await click('Delete plan'); await browser.waitFor("!document.querySelector('[data-sheet-frame]')"); assert.equal(await browser.evaluate("document.querySelector('#fixture-deletes').textContent"),'1'); checks++;
  await open('allocation','unavailable'); await click('Edit plan'); await click('Continue'); await click('Continue'); await click('Continue'); await click('Continue'); assert.match(await text(),/Complete this step/); assert.deepEqual(await writes(),[]); checks++; await close();
  assert.deepEqual(browser.exceptions,[]); assert.deepEqual(browser.apiRequests,[],'fixture must never attempt customer APIs');
  await browser.save('results',{checks,exceptions:browser.exceptions,apiRequests:browser.apiRequests}); console.log(JSON.stringify({checks,exceptions:browser.exceptions,apiRequests:browser.apiRequests}));
} finally { browser.close(); }
