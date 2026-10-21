// Optional browser gate. Mount scripts/fixtures/g291-plan-journey.tsx in a
// temporary auth-exempt local route; never retain that route after fold-in.
import assert from "node:assert/strict";
import { openBrowser } from "./_plan-browser.mjs";
const browser = await openBrowser({ origin: process.env.PLAN_QA_ORIGIN ?? "http://127.0.0.1:3163", output: process.env.PLAN_QA_OUTPUT ?? "/tmp/g291-production-qa" });
const button = text => `(Array.from(document.querySelectorAll('button')).find(e=>e.textContent.trim()===${JSON.stringify(text)})??Array.from(document.querySelectorAll('label')).find(e=>e.querySelector('strong')?.textContent.trim()===${JSON.stringify(text)}))`;
let checks = 0;
async function click(text) { await browser.activate(button(text)); await browser.settle(); }
async function browserBack() {
  const history = await browser.call("Page.getNavigationHistory");
  await browser.call("Page.navigateToHistoryEntry", { entryId: history.entries[history.currentIndex - 1].id });
  await browser.settle();
}
async function fit(name) {
  const facts = await browser.evaluate(`(()=>{const d=document.querySelector('[data-plan-record]')?.closest('[role=dialog]')??document.querySelector('[role=dialog]:not([aria-label="Ask Penny"])');return{dialogs:Array.from(document.querySelectorAll('[role=dialog]:not([aria-label="Ask Penny"])')).map(e=>({id:e.id,label:e.getAttribute('aria-label'),text:e.textContent.slice(0,80)})), width:innerWidth, left:d?.getBoundingClientRect().left,right:d?.getBoundingClientRect().right,overflow:d?d.scrollWidth>d.clientWidth:false,nativeSelect:d?.querySelectorAll('select').length, height:innerHeight, footerTop:d?.querySelector('[data-sheet-footer]')?.getBoundingClientRect().top, footerBottom:d?.querySelector('[data-sheet-footer]')?.getBoundingClientRect().bottom}})()`);
  await browser.shot(name); await browser.save(name, facts);
  assert.equal(facts.dialogs.length, 1, JSON.stringify(facts)); assert.equal(facts.overflow, false, name); assert.ok(facts.left >= -1 && facts.right <= facts.width + 1, name); assert.equal(facts.nativeSelect, 0, name);
  checks++;
  assert.ok(facts.footerTop >= 0 && facts.footerBottom <= facts.height + 1, JSON.stringify(facts));
}
try {
  for (const width of [390, 320, 1280]) for (const mode of ["light", "dark"]) {
    await browser.viewport(width, width === 320 ? 800 : 900);
    await browser.navigate("/design/g291-production-qa", "document.documentElement?.dataset.planFixtureReady==='true'");
    await browser.evaluate(`document.documentElement.classList.toggle('dark', ${mode === "dark"})`);
    for (const kind of ["view-goal", "view-aside"]) {
      await click(kind); await browser.waitFor("document.querySelector('[data-plan-record]')"); await fit(`${kind}-${width}-${mode}`);
      await click("Edit plan"); assert.equal(await browser.evaluate("document.querySelectorAll('[role=dialog]:not([aria-label=\"Ask Penny\"])').length"), 1);
      await browserBack();
      await browser.waitFor("document.querySelector('[data-plan-record]')");
      await browser.activate("document.querySelector('[data-sheet-frame] [aria-label^=\"Close \"]')"); await browser.waitFor("!document.querySelector('[data-sheet-frame]')");
    }
  }
  await browser.viewport(390, 900);
  await browser.navigate("/design/g291-production-qa", "document.documentElement?.dataset.planFixtureReady==='true'");
  await browser.activate("document.querySelector('main label input[type=checkbox]')");
  await click("aside"); await click("One-off payment"); await click("Continue"); await browser.waitFor("document.querySelector('[data-fixture-result]')?.textContent==='One-off selected'"); checks++;
  await browser.waitFor("document.querySelector('[data-sheet-frame]')?.textContent.includes('Plan a one-off')");
  await browser.activate("document.querySelector('[data-sheet-frame] [aria-label^=\"Close \"]')"); await browser.waitFor("!document.querySelector('[data-sheet-frame]')");
  await click("aside"); await click("Set aside"); await click("Continue"); await click("Back"); await browser.waitFor("document.querySelector('input[name=upcoming-plan-kind]:checked')?.value==='envelope'"); await click("Continue"); await browser.type("document.querySelector('#set-aside-name')", "Groceries"); await click("Continue");
  await browser.type("document.querySelector('#set-aside-amount')", "300"); await click("Continue"); await click("Continue"); await click("Continue");
  await click("A category"); await browser.waitFor("document.querySelector('input[type=radio]')");
  assert.equal(await browser.evaluate("document.querySelectorAll('select').length"), 0);
  await fit("aside-category"); await click("Review set-aside"); await fit("aside-review"); await click("Save set-aside");
  await browser.waitFor("document.querySelector('[role=alert]')?.textContent.includes('Fixture save failure')");
  assert.match(await browser.evaluate("document.querySelector('[data-sheet-frame]').textContent"), /Groceries/);
  await click("Save set-aside"); await browser.waitFor("document.querySelector('[data-fixture-result]')?.textContent==='Set-aside saved'"); checks++;
  await click("goal"); await browser.type("document.querySelector('#commitment-name')", "Japan trip"); await click("Continue");
  await browser.type("document.querySelector('#commitment-amount')", "2000"); await browser.settle(); await click("Continue");
  // Explicit confirmation of the sole eligible source is still a journey step.
  const chosen = await browser.evaluate("document.querySelector('input[type=radio]:checked')!==null");
  if (!chosen) await browser.activate("Array.from(document.querySelectorAll('button')).find(e=>e.textContent.includes('Everyday account'))");
  await click("Continue");
  await browser.activate("Array.from(document.querySelectorAll('button')).find(e=>e.textContent.includes('Holiday pot'))"); await click("Continue");
  await fit("goal-tracking"); await click("A payment");
  assert.equal(await browser.evaluate(`${button("Review goal")}.disabled`), true, "Payment choice requires a rule");
  await click("Not now"); await click("Review goal"); await fit("goal-review"); await click("Save goal");
  await browser.waitFor("document.querySelector('[data-fixture-result]')?.textContent==='Goal saved'"); checks++;
  assert.deepEqual(browser.exceptions, []);
  await browser.save("results", { checks, exceptions: browser.exceptions });
  console.log(JSON.stringify({ checks, exceptions: browser.exceptions }));
} finally { browser.close(); }
