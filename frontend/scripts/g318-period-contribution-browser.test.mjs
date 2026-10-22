// Optional production-component QA. Mount fixtures/g318-period-contribution.tsx
// under /design/g318-production-qa, then remove that temporary route.
import assert from "node:assert/strict";
import { openBrowser } from "./_plan-browser.mjs";

const b = await openBrowser({ origin: process.env.PLAN_QA_ORIGIN ?? "http://127.0.0.1:3181", output: process.env.PLAN_QA_OUTPUT ?? "/tmp/g318-qa" });
const button = label => `Array.from(document.querySelectorAll('button')).find(e=>e.textContent.trim()===${JSON.stringify(label)})`;
const sheet = "document.querySelector('[data-sheet-frame]')";
const body = () => b.evaluate(`${sheet}?.textContent??''`);
const writes = () => b.evaluate("JSON.parse(document.querySelector('#writes').textContent)");
const record = () => b.evaluate("JSON.parse(document.querySelector('#record').textContent)");
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
let checks = 0;

// The Upcoming history guard ignores taps made immediately after navigation.
async function click(label) { await b.waitFor(`Boolean(${button(label)})`); await delay(550); await b.activate(button(label)); await b.settle(); }
async function reset(width = 390, dark = false) {
  await b.viewport(width, width === 320 ? 740 : 900);
  await b.navigate("/design/g318-production-qa", "document.documentElement?.dataset.g318Ready==='true'");
  await b.evaluate(`document.documentElement.classList.toggle('dark',${dark})`);
}
async function open(host) { await click(host); await b.waitFor("document.querySelector('[data-plan-record]')"); }
async function toggle(id) { await delay(550); await b.activate(`document.querySelector(${JSON.stringify(id)})`); await b.settle(); }
async function fit(name, capture = false) {
  const result = await b.evaluate(`(()=>{const d=${sheet},r=d.getBoundingClientRect(),f=d.querySelector('[data-sheet-footer]').getBoundingClientRect();return{dialogs:document.querySelectorAll('[data-sheet-frame]').length,overflow:d.scrollWidth>d.clientWidth,left:r.left,right:r.right,width:innerWidth,footer:f.top>=r.top&&f.bottom<=innerHeight+1}})()`);
  assert.equal(result.dialogs, 1, `${name}: one sheet`);
  assert.equal(result.overflow, false, `${name}: no horizontal overflow`);
  assert.ok(result.left >= 0 && result.right <= result.width + 1, `${name}: sheet fits viewport`);
  assert.ok(result.footer, `${name}: footer stays in the sheet`);
  if (capture) await b.shot(name);
  checks++;
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
  for (const host of ["Home", "Upcoming"]) {
    for (const [width, dark] of [[320, true], [390, false], [1280, true]]) {
      await reset(width, dark); await open(host);
      assert.match(await body(), /Rainy day/);
      await fit(`${host}-${width}-view`, width === 320 || width === 1280);
      await click("Change this period’s contribution");
      await b.waitFor(`${sheet}?.textContent.includes('This is already your amount for this pay period.')`);
      assert.equal(await b.evaluate(`${button("Review changes")}.disabled`), true, `${host}: no-op cannot review`);
      assert.equal((await writes()).length, 0, `${host}: no-op has no write`);
      await fit(`${host}-${width}-amount`); checks++;
      await b.type("document.querySelector('#goal-contribution-amount')", "100.25");
      await b.waitFor(`${button("Review changes")}?.disabled===false`); await click("Review changes");
      await fit(`${host}-${width}-review`, true);
      assert.equal((await writes()).length, 0);
    }
  }

  for (const host of ["Home", "Upcoming"]) {
    await reset(); await open(host); await contribution("100.25");
    assert.match(await body(), /£100\.25/); assert.match(await body(), /Next pay period returns to £79\.24\./);
    assert.equal(await b.evaluate(`Array.from(document.querySelectorAll('button')).filter(e=>e.textContent.trim()==='Change amount').length`), 1);
    assert.equal((await writes()).length, 0); await click("Save changes"); await b.waitFor("document.querySelector('[data-plan-record]')");
    assert.equal((await writes()).length, 1); assert.match(await body(), /Rainy day/);
    assert.equal(await b.evaluate(`${sheet}?.querySelector('h2')?.textContent`), "Rainy day", `${host}: returns to its saved view title`);
    const saved = await record(); assert.equal(saved.current_period_contribution.contribution, 100.25); assert.equal(saved.period_amount, 100.25); assert.equal(saved.amount_per_period, 79.24); assert.equal(saved.remaining, 100.25);
    await click("Change this period’s contribution"); await b.waitFor("document.querySelector('#goal-contribution-amount')");
    await b.type("document.querySelector('#goal-contribution-amount')", "50"); await click("Back to plan"); await b.waitFor("document.querySelector('[data-plan-record]')");
    assert.equal((await writes()).length, 1, `${host}: Back discards re-edit`);
    await click("Change this period’s contribution"); await b.waitFor("document.querySelector('#goal-contribution-amount')");
    await b.evaluate("history.back()"); await b.waitFor("document.querySelector('[data-plan-record]')"); checks++;

    await reset(); await open(host); await contribution("50"); assert.match(await body(), /£50/); assert.match(await body(), /£79\.24/); assert.equal((await writes()).length, 0); await click("Back to plan");
    await b.waitFor("document.querySelector('[data-plan-record]')"); await contribution("0"); assert.match(await body(), /£0/); assert.match(await body(), /£79\.24/); assert.equal((await writes()).length, 0); checks++;

    await reset(); await toggle("#fail-refresh"); await open(host); await contribution("50"); await click("Save changes");
    await b.waitFor(`${button("Retry refresh")}!==undefined`); assert.equal((await writes()).length, 1, `${host}: mutation committed once`);
    assert.equal(await b.evaluate(`Array.from(${sheet}?.querySelectorAll('button[aria-label^="Close"],button[aria-label^="Back"]')??[]).every(button=>button.disabled)`), true, `${host}: sheet navigation is fenced while refresh is pending`);
    await click("Retry refresh"); await b.waitFor("document.querySelector('[data-plan-record]')"); assert.equal((await writes()).length, 1, `${host}: refresh retry does not repeat save`); checks++;

    await reset(); await toggle("#fail-preview"); await open(host); await click("Change this period’s contribution");
    await b.waitFor(`${sheet}?.textContent.includes('We could not check this contribution')`); await click("Retry check");
    await b.waitFor(`${button("Review changes")}?.disabled===true`); await b.type("document.querySelector('#goal-contribution-amount')", "50");
    await b.waitFor(`${button("Review changes")}?.disabled===false`); assert.equal((await writes()).length, 0); checks++;

    await reset(); await toggle("#fail-save"); await open(host); await contribution("50"); await click("Save changes");
    await b.waitFor(`${sheet}?.textContent.includes('Your changes could not be saved')`); assert.equal((await writes()).length, 0, `${host}: failed save was not recorded`);
    await click("Recheck contribution"); await b.waitFor("document.querySelector('#goal-contribution-amount')"); await b.waitFor(`${button("Review changes")}?.disabled===false`); await click("Review changes"); await click("Save changes");
    await b.waitFor("document.querySelector('[data-plan-record]')"); assert.equal((await writes()).length, 1, `${host}: recheck can save once`); checks++;

    await reset(); await toggle("#matched"); await open(host); await contribution("100.25");
    assert.match(await body(), /£20\.10 is already matched\. £80\.15 is still to set aside\./); checks++;
  }

  for (const state of ["#paused", "#pending", "#once"]) for (const host of ["Home", "Upcoming"]) {
    await reset(); await toggle(state); await open(host);
    assert.equal(await b.evaluate(`Boolean(${button("Change this period’s contribution")})`), false, `${host} ${state} has no contribution action`); checks++;
  }

  for (const host of ["Home", "Upcoming"]) {
    await reset(); await toggle("#hide"); await open(host); await contribution("100.25");
    assert.doesNotMatch(await body(), /£100\.25|£79\.24|£20\.10|£80\.15/);
    assert.match(await body(), /£••••/); checks++;
  }
  assert.deepEqual(b.exceptions, []); assert.deepEqual(b.apiRequests, []);
  await b.save("results", { checks, exceptions: b.exceptions, apiRequests: b.apiRequests });
  console.log(JSON.stringify({ checks, exceptions: b.exceptions, apiRequests: b.apiRequests }));
} finally { b.close(); }
