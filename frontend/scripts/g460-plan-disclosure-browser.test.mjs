// Mount fixtures/g460-plan-disclosure.tsx at temporary /design/g460-qa.
import assert from "node:assert/strict";
import { openBrowser } from "./_plan-browser.mjs";
const b = await openBrowser({ origin: process.env.PLAN_QA_ORIGIN ?? "http://127.0.0.1:3380", output: "/tmp/g460-return-evidence" });
const button = text => `Array.from(document.querySelectorAll('button')).find(e=>e.textContent.trim()===${JSON.stringify(text)})`;
async function activate(selector) { await b.waitFor(selector); await b.activate(selector); await b.settle(); await new Promise(resolve => setTimeout(resolve, 400)); }
try {
  await b.viewport(390, 900);
  await b.navigate("/design/g460-qa", "document.documentElement?.dataset.g460Ready==='true'");
  await activate(button("View plan"));
  for (const [entry, back] of [["Edit plan", "Back to plan"], ["Change this period’s contribution", "Back to plan"], ["Edit schedule", "Cancel"]]) {
    await activate("document.querySelector('summary')");
    assert.equal(await b.evaluate("document.querySelector('summary').getAttribute('aria-expanded')"), "true");
    await activate(button(entry)); await activate(button(back));
    await b.waitFor("document.querySelector('summary')");
    const result = await b.evaluate("({open:document.querySelector('details').open,expanded:document.querySelector('summary').getAttribute('aria-expanded')})");
    assert.deepEqual(result, { open: false, expanded: "false" }, entry);
  }
  assert.deepEqual(b.apiRequests, []); assert.deepEqual(b.exceptions, []);
  console.log("G460: disclosure state resets after plan, contribution and schedule editing");
} finally { b.close(); }
