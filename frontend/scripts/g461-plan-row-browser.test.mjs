// Manual browser regression: mount the fixture at the temporary local route,
// run this script, then remove the route before submitting the branch.
import assert from "node:assert/strict";
import { openBrowser } from "./_plan-browser.mjs";
const b = await openBrowser({ origin: process.env.PLAN_QA_ORIGIN ?? "http://127.0.0.1:3381", output: process.env.PLAN_QA_OUTPUT ?? "/tmp/g461-evidence" });
const frame = "document.querySelector('[data-sheet-frame]')";
const buttons = `Array.from((${frame}??document).querySelectorAll('button'))`;
const button = label => `${buttons}.find(e=>e.textContent.trim()===${JSON.stringify(label)})`;
const writes = () => b.evaluate("JSON.parse(document.querySelector('#fixture-writes').textContent)");
const sheetText = () => b.evaluate(`${frame}?.textContent??''`);
let checks = 0;
const settleTap = () => new Promise(resolve => setTimeout(resolve, 350));
async function click(label) { await b.waitFor(button(label)); await b.activate(button(label)); await b.settle(); await settleTap(); }
async function activate(selector) { await b.waitFor(selector); await b.activate(selector); await b.settle(); await settleTap(); }
async function reset(width = 390, dark = false, flags = []) {
  await b.viewport(width, width === 320 ? 740 : 900);
  await b.navigate("/design/g461-production-qa", "document.documentElement?.dataset.g461Ready==='true'");
  await b.evaluate(`document.documentElement.classList.toggle('dark',${dark});const s=document.createElement('style');s.textContent='nextjs-portal{display:none}';document.head.append(s)`);
  for (const id of flags) await activate(`document.getElementById(${JSON.stringify(id)})`);
}
async function open(kind) {
  await click(kind); await b.waitFor(`${frame}?.querySelector('[data-plan-record]')`);
  if (kind === "scheduled") await activate(`${frame}.querySelector('summary')`);
}
async function edit(field) {
  await activate(`document.querySelector('[data-plan-edit=${field}]')`);
  await b.waitFor(`document.querySelector('[data-plan-editor-step]')?.dataset.planEditorStep===${JSON.stringify(field)}`);
}
async function method(name) {
  await activate(`Array.from(${frame}.querySelectorAll('label')).find(e=>e.querySelector('strong')?.textContent===${JSON.stringify(name)})`);
}
async function fit(name, shot = false) {
  const facts = await b.evaluate(`(()=>{const d=${frame},f=d.querySelector('[data-sheet-footer]'),r=d.getBoundingClientRect(),a=f.getBoundingClientRect();return {overflow:d.scrollWidth>d.clientWidth,left:r.left,right:r.right,width:innerWidth,top:a.top,bottom:a.bottom,height:innerHeight,targets:Array.from(d.querySelectorAll('[data-plan-edit]')).map(e=>e.getBoundingClientRect().height)}})()`);
  assert.equal(facts.overflow, false, name); assert.ok(facts.left >= -1 && facts.right <= facts.width + 1, name);
  assert.ok(facts.top >= 0 && facts.bottom <= facts.height + 1, name); assert.ok(facts.targets.every(height => height >= 44), name);
  if (shot) await b.shot(name); checks++;
}
async function review() { await click("Return to review"); await b.waitFor("document.querySelector('[data-plan-editor-step=review]')"); }
async function save(kind) {
  assert.equal((await writes()).length, 0, "draft navigation never writes");
  await click("Save changes");
  await b.waitFor(kind === "goal" || kind === "scheduled" ? `!${frame}` : "document.querySelector('[data-plan-record]')");
  assert.equal((await writes()).length, 1); checks++;
  return (await writes())[0];
}
async function pickPayment() {
  await method("A payment");
  await b.waitFor(`${frame}.querySelector('button[role=radio]')`);
  const choices = await b.evaluate(`Array.from(${frame}.querySelectorAll('button[role=radio]')).map(e=>e.textContent)`);
  assert.match(choices[0], /Saving Challenge/); assert.match(choices[0], /−£12\.00/);
  await activate(`Array.from(${frame}.querySelectorAll('button[role=radio]')).find(e=>e.textContent.includes('Saving Challenge'))`);
}
try {
  for (const width of [320, 390, 1280]) for (const dark of [false, true]) {
    await reset(width, dark); await open("allocation"); await fit(`view-${width}-${dark}`, true);
    await edit("source"); await fit(`source-${width}-${dark}`, width === 390);
    await click("Back to plan"); await b.waitFor("document.querySelector('[data-plan-record]')");
    assert.deepEqual(await writes(), []); checks++;
  }
  for (const kind of ["goal", "scheduled", "allocation", "upcoming-goal", "upcoming-allocation"]) {
    for (const field of ["source", "destination", "tracking"]) {
      await reset(); await open(kind); await edit(field);
      assert.deepEqual(await writes(), []); await click("Back to plan");
      await b.waitFor("document.querySelector('[data-plan-record]')"); assert.deepEqual(await writes(), []); checks++;
    }
  }
  for (const kind of ["goal", "allocation"]) {
    await reset(); await open(kind); await edit("source");
    await activate(`${buttons}.find(e=>e.getAttribute('role')==='radio'&&e.textContent.includes('Joint current account'))`);
    await review(); const source = await save(kind); assert.equal(source.source_account_id, "joint");
    assert.equal(source.fill_rule ?? null, null, "an untouched goal must not adopt a suggested payment");
    if (kind === "goal") assert.equal("funding_pots" in source, false, "unchanged baselines are not resent");
    await reset(); await open(kind); await edit("destination");
    await activate(`${buttons}.find(e=>['radio','checkbox'].includes(e.getAttribute('role'))&&e.textContent.includes('Holiday pot'))`);
    await review(); const destination = await save(kind);
    if (kind === "goal") assert.deepEqual(destination.funding_pots.map(pot=>pot.account_id), ["pot", "other-pot"]);
    else assert.equal(destination.destination_account_id, "other-pot");
    await reset(); await open(kind); await edit("tracking"); await pickPayment();
    const calls = await b.evaluate("JSON.parse(document.querySelector('#fixture-candidates').textContent)");
    assert.deepEqual(calls.at(-1), { source: "current", pots: ["pot"], includeSourcePayments: true });
    await review(); const payment = await save(kind); assert.equal(payment.fill_rule.match_value, "Saving Challenge");
    assert.equal(payment.category_tracking, null);
    if (kind === "allocation") assert.equal(payment.tracking_mode, "manual");
    await reset(); await open(kind); await edit("tracking"); await method("A category");
    await review(); const category = await save(kind); assert.equal(category.category_tracking.category, "Savings"); assert.equal(category.fill_rule, null);
    await reset(390, false, ["start-tracked"]); await open(kind); await edit("tracking"); await method("Not tracking");
    await review(); const cleared = await save(kind); assert.equal(cleared.fill_rule, null); assert.equal(cleared.category_tracking, null);
  }
  await reset(); await open("legacy"); assert.match(await sheetText(), /Incoming payment/);
  await edit("source"); await review(); const legacy = await save("allocation");
  assert.equal(legacy.tracking_mode, "existing_payment"); assert.equal(legacy.match_value, "SAVING CHALLENGE"); assert.equal("fill_rule" in legacy, false);
  for (const field of ["source", "tracking"]) {
    await reset(390, true, ["hidden"]); await open("allocation"); await edit(field);
    if (field === "tracking") { await method("A payment"); await b.waitFor(`${frame}.querySelector('button[role=radio]')`); }
    assert.doesNotMatch(await sheetText(), /£\d/); assert.match(await sheetText(), /−£••••/); await fit(`hidden-${field}`, true); checks++;
  }
  await reset(390, false, ["fail-candidates"]); await open("allocation"); await edit("tracking"); await method("A payment");
  await b.waitFor(`${button("Retry payments")}`); await click("Retry payments"); await b.waitFor(`${frame}.querySelector('button[role=radio]')`); assert.deepEqual(await writes(), []); checks++;
  await reset(390, false, ["empty"]); await open("allocation"); await edit("tracking"); await method("A payment");
  await b.waitFor(`${frame}.querySelector('input[aria-label="Payment description"]')`); await click("Return to review"); await b.waitFor(`${frame}.querySelector('[role=alert]')`);
  assert.deepEqual(await writes(), []); assert.match(await sheetText(), /Complete this step/); checks++;
  await reset(390, false, ["fail-save"]); await open("allocation"); await edit("tracking"); await review(); await click("Save changes");
  await b.waitFor(`${frame}.querySelector('[role=alert]')`); await click("Save changes"); await b.waitFor("document.querySelector('[data-plan-record]')"); assert.equal((await writes()).length, 2); checks++;
  await reset(390, false, ["fail-refresh"]); await open("allocation"); await edit("tracking"); await review(); await click("Save changes");
  await b.waitFor(`${button("Retry refresh")}`); assert.equal((await writes()).length, 1); await click("Retry refresh"); await b.waitFor("document.querySelector('[data-plan-record]')"); assert.equal((await writes()).length, 1); checks++;
  await reset(); await open("goal"); await b.evaluate("document.querySelector('[data-plan-edit=tracking]').focus()"); await b.key("Enter", "Enter", 13);
  await b.waitFor("document.querySelector('[data-plan-editor-step=tracking]')"); await b.key("Escape", "Escape", 27); await b.waitFor("document.querySelector('[data-plan-record]')"); assert.deepEqual(await writes(), []); checks++;
  await reset(); await open("upcoming-goal"); await edit("tracking");
  const history = await b.call("Page.getNavigationHistory"); await b.call("Page.navigateToHistoryEntry", { entryId: history.entries[history.currentIndex - 1].id });
  await b.waitFor("document.querySelector('[data-plan-record]')"); assert.deepEqual(await writes(), []); checks++;
  assert.deepEqual(b.exceptions, []); assert.deepEqual(b.apiRequests, []);
  await b.save("results", { checks, exceptions: b.exceptions, apiRequests: b.apiRequests }); console.log(JSON.stringify({ checks }));
} catch (error) { await b.shot("failure"); throw error; } finally { b.close(); }
