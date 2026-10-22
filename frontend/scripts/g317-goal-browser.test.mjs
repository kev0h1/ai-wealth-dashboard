// Optional production-component QA. Mount fixtures/g317-goal-flow.tsx under a
// temporary /design/g317-production-qa route, then remove that route.
import assert from "node:assert/strict";
import { openBrowser } from "./_plan-browser.mjs";
const b = await openBrowser({ origin: process.env.PLAN_QA_ORIGIN ?? "http://127.0.0.1:3171", output: process.env.PLAN_QA_OUTPUT ?? "/tmp/g317-qa" });
const button = label => `Array.from(document.querySelectorAll('button')).find(e=>e.textContent.trim()===${JSON.stringify(label)})`;
const sheet = "document.querySelector('[data-sheet-frame]')";
const body = () => b.evaluate(`${sheet}?.textContent??''`);
const writes = () => b.evaluate("JSON.parse(document.querySelector('#writes').textContent)");
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
let checks = 0;
async function click(label) { await b.waitFor(`Boolean(${button(label)})`); await delay(550); await b.activate(button(label)); await b.settle(); }
async function reset(width = 390, dark = false) {
  await b.viewport(width, width === 320 ? 740 : 900);
  await b.navigate("/design/g317-production-qa", "document.documentElement?.dataset.g317Ready==='true'");
  await b.evaluate(`document.documentElement.classList.toggle('dark',${dark})`);
}
async function open(host) { await click(host); await b.waitFor("document.querySelector('[data-plan-record]')"); }
async function fit(name, capture = false) {
  const result = await b.evaluate(`(()=>{const d=${sheet},r=d.getBoundingClientRect(),f=d.querySelector('[data-sheet-footer]').getBoundingClientRect();return{dialogs:document.querySelectorAll('[data-sheet-frame]').length,overflow:d.scrollWidth>d.clientWidth,left:r.left,right:r.right,width:innerWidth,footer:f.top>=r.top&&f.bottom<=innerHeight+1}})()`);
  assert.equal(result.dialogs, 1); assert.equal(result.overflow, false); assert.ok(result.left >= 0 && result.right <= result.width + 1); assert.ok(result.footer, name);
  if (capture) await b.shot(name); checks++;
}
async function contribution(amount) {
  await click("Change this period’s contribution");
  await b.waitFor("document.querySelector('#goal-contribution-amount')");
  await b.type("document.querySelector('#goal-contribution-amount')", amount);
  await b.waitFor(`${button("Review changes")}?.disabled===false`);
  await click("Review changes");
  await b.waitFor(`${sheet}?.textContent.includes('Review · 2 of 2')`);
}
try {
  for (const host of ["Planning", "Upcoming"]) for (const [width, dark] of [[320, true], [390, false], [1280, true]]) {
    await reset(width, dark); await open(host);
    assert.match(await body(), /Everyday account/); assert.doesNotMatch(await body(), /Joint current account|Link goal to an account/);
    assert.match(await body(), /Suggested from recent transfers/); assert.match(await body(), /Not tracking a payment/);
    await fit(`${host}-${width}-view`, width === 320); checks++;
    await click("Change this period’s contribution");
    await b.waitFor(`${sheet}?.textContent.includes('This is already your amount for this pay period.')`);
    assert.equal(await b.evaluate(`${button("Review changes")}.disabled`), true);
    assert.equal((await writes()).length, 0); checks++;
    await click("Back to plan"); await b.waitFor("document.querySelector('[data-plan-record]')");
    await click("Edit plan"); await b.waitFor("document.querySelector('[data-plan-editor-step]')?.dataset.planEditorStep==='purpose'");
    await b.type("document.querySelector('#commitment-name')", "Discard this draft"); await click("Back to plan");
    await b.waitFor("document.querySelector('[data-plan-record]')"); assert.doesNotMatch(await body(), /Discard this draft/); assert.equal((await writes()).length, 0); checks++;
    await contribution("100.25"); await fit(`${host}-${width}-review`, width !== 390);
    assert.match(await body(), /£100\.25/); assert.match(await body(), /If you set aside.*later periods would be about.*£100/); assert.match(await body(), /January 2027/);
    assert.equal((await writes()).length, 0); await click("Save changes"); await b.waitFor("document.querySelector('[data-plan-record]')");
    assert.equal((await writes()).length, 1); const record = await b.evaluate("JSON.parse(document.querySelector('#record').textContent)");
    assert.equal(record.progress, 0); assert.equal(record.target_date, "2027-01-01"); assert.equal(record.per_period_slice, 100.25); checks++;
    await click("Change this period’s contribution"); await b.waitFor("document.querySelector('#goal-contribution-amount')");
    await b.evaluate("history.back()"); await b.waitFor("document.querySelector('[data-plan-record]')"); await fit(`${host}-${width}-history`);
  }
  for (const host of ["Planning", "Upcoming"]) {
    await reset(); await b.activate("document.querySelector('#fail-refresh')"); await open(host); await contribution("0");
    assert.match(await body(), /£150/); await click("Save changes"); await b.waitFor(`${button("Retry refresh")}!==undefined`);
    assert.equal((await writes()).length, 1, `${host}: write committed`); await click("Retry refresh"); await b.waitFor("document.querySelector('[data-plan-record]')"); assert.equal((await writes()).length, 1, `${host}: refresh must not repeat the mutation`); checks++;
    await reset(); await open(host); await contribution("999"); assert.match(await body(), /£300/); assert.match(await body(), /Later periods would be.*£0/); assert.match(await body(), /not cash already saved/); checks++;
    await click("Back to plan"); await b.waitFor("document.querySelector('[data-plan-record]')"); assert.equal((await writes()).length, 0);
    await reset(); await b.activate("document.querySelector('#no-later')"); await open(host); await contribution("0"); assert.match(await body(), /no later pay periods/); assert.equal(await b.evaluate(`${button("Save changes")}.disabled`), true); await click("Change target date"); await b.waitFor("document.querySelector('[data-plan-editor-step]')?.dataset.planEditorStep==='details'"); assert.equal((await writes()).length, 0); await click("Back to plan"); await b.waitFor("document.querySelector('[data-plan-record]')"); checks++;
    await reset(); await b.activate("document.querySelector('#fail-refresh')"); await open(host); await click("Edit plan");
    for (let i=0; i<4; i++) await click("Continue"); await click("Review changes"); assert.equal((await writes()).length,0);
    await click("Save changes"); await b.waitFor(`${button("Retry refresh")}!==undefined`); assert.equal((await writes()).length,1);
    await click("Retry refresh"); await b.waitFor(host==="Planning" ? `!${sheet}` : "document.querySelector('[data-plan-record]')"); assert.equal((await writes()).length,1); checks++;
    await reset(); await b.activate("document.querySelector('#fail-refresh')"); await open(host); await click("Delete plan"); await click("Delete plan");
    await b.waitFor(`${button("Retry refresh")}!==undefined`); assert.equal((await writes()).length,1); await click("Retry refresh"); await b.waitFor(`!${sheet}`); assert.equal((await writes()).length,1); checks++;
    await reset(); await b.activate("document.querySelector('#fail-refresh')"); await open(host); await click("Pause plan"); await b.waitFor(`${button("Retry refresh")}!==undefined`); assert.equal((await writes()).length, 1); await click("Retry refresh"); await b.waitFor(`!${sheet}`); assert.equal((await writes()).length, 1); checks++;
  }
  await reset(); await b.activate("document.querySelector('#fail-lookup')"); await click("Upcoming"); await b.waitFor(`${sheet}?.textContent.includes('could not load this goal')`); assert.equal(await b.evaluate("document.querySelector('[data-plan-record]')===null"), true); assert.equal((await writes()).length, 0); await click("Try again"); await b.waitFor("document.querySelector('[data-plan-record]')"); checks++;
  await reset(); await b.activate("document.querySelector('#hide')"); await open("Planning"); assert.doesNotMatch(await body(), /£300|£100/); checks++;
  assert.deepEqual(b.exceptions, []); assert.deepEqual(b.apiRequests, []);
  await b.save("results", { checks, exceptions: b.exceptions, apiRequests: b.apiRequests });
  console.log(JSON.stringify({ checks, exceptions: b.exceptions, apiRequests: b.apiRequests }));
} finally { b.close(); }
