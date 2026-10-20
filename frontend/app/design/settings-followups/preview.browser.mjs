// Isolated synthetic preview only. API and HTTPS requests are blocked by helper.
// Usage: node app/design/settings-followups/preview.browser.mjs [origin] [evidence-dir]
import assert from "node:assert/strict";
import { openBrowser } from "../../../scripts/g293-browser-helper.mjs";
const origin = process.argv[2] ?? "http://127.0.0.1:3159";
const output = process.argv[3] ?? "/tmp/g296-review";
const b = await openBrowser({ origin, output });
const results = [];
const findings = [];
const sw = "document.querySelector('[data-permission-switch]')";
const button = label => `[...document.querySelectorAll('button')].find(e=>e.textContent.trim()===${JSON.stringify(label)}&&e.getClientRects().length)`;
const ready = "document.querySelector('[data-g296-preview][data-ready=true]')";
const go = async (query = "", width = 390) => {
  await b.viewport(width, 844);
  await b.navigate(`/design/settings-followups?clean=1&${query}`, ready);
  await b.waitFor(`document.documentElement.classList.contains('dark')===${query.includes("mode=dark")}`);
};
const checked = async value => assert.equal(await b.evaluate(`${sw}.getAttribute('aria-checked')`), String(value));
const click = async label => {
  await b.evaluate("Promise.all(document.getAnimations().map(a=>a.finished.catch(()=>{}))).then(()=>true)");
  await b.activate(button(label));
};
const decision = variant => variant === "a" ? "document.querySelector('[data-inline-consent]')" : "document.querySelector('[data-sheet-consent]')";
const layout = async label => {
  const result = await b.evaluate(`(()=>{const root=document.querySelector('[data-sheet-frame]')??document.querySelector('[data-g296-preview]');const visible=e=>e.getClientRects().length&&getComputedStyle(e).visibility!=='hidden'&&!e.closest('details:not([open]) *:not(summary)');return {width:innerWidth,scrollWidth:document.documentElement.scrollWidth,overflow:[...root.querySelectorAll('button,input,p,h1,h2,h3')].filter(visible).filter(e=>{const r=e.getBoundingClientRect();return r.width>0&&(r.right>innerWidth+1||r.left< -1)}).map(e=>e.textContent.slice(0,90)),smallTargets:[...root.querySelectorAll('button,input')].filter(visible).filter(e=>{const r=e.getBoundingClientRect();return r.height<43.5}).map(e=>({text:e.textContent,height:e.getBoundingClientRect().height})),inputFonts:[...root.querySelectorAll('input')].filter(visible).map(e=>getComputedStyle(e).fontSize)};})()`);
  if (result.scrollWidth > result.width + 1 || result.overflow.length || result.smallTargets.length || !result.inputFonts.every(size => parseFloat(size) >= 16)) findings.push({ label, ...result });
  results.push({ label, ...result });
};
try {
  for (const variant of ["a", "b"]) for (const mode of ["light", "dark"]) {
    await go(`variant=${variant}&mode=${mode}`);
    await checked(false);
    await layout(`${variant}-${mode}-rest`);
    if (variant === "a") await b.shot(`mobile-${variant}-${mode}`, { full: true });
    await b.activate(sw); await b.waitFor(decision(variant)); await checked(false);
    assert.ok((await b.evaluate("document.body.innerText")).includes("confirm before anything happens"));
    await layout(`${variant}-${mode}-consent`);
    await b.shot(`consent-${variant}-${mode}`, { full: variant === "a" });
    await click("Not now"); await b.waitFor(`!(${decision(variant)})`); await checked(false);
    await b.settle();
    if (!(await b.evaluate(`document.activeElement===${sw}`))) findings.push({ label: `${variant}-${mode}: cancel did not restore switch focus` });
    await b.activate(sw); await b.waitFor(decision(variant)); await click("Yes, set things up");
    await b.waitFor(`${sw}.getAttribute('aria-checked')==='true'`);
    await b.activate(sw); await b.waitFor(decision(variant)); await checked(true);
    await click("Keep on"); await b.waitFor(`!(${decision(variant)})`); await checked(true);
    await b.activate(sw); await b.waitFor(decision(variant)); await click("Turn off");
    await b.waitFor(`${sw}.getAttribute('aria-checked')==='false'`);
    await go(`variant=${variant}&mode=${mode}&state=save-error`);
    await b.activate(sw); await b.waitFor(decision(variant)); await click("Yes, set things up");
    await b.waitFor("document.querySelector('[role=alert]')"); await checked(false);
    await click("Yes, set things up"); await b.waitFor(`${sw}.getAttribute('aria-checked')==='true'`);
  }
  for (const width of [320, 768, 1280]) for (const variant of ["a", "b"]) {
    await go(`variant=${variant}&state=long&mode=dark`, width); await layout(`${width}-${variant}-rest`);
    await b.activate(sw, width < 600); await b.waitFor(decision(variant)); await layout(`${width}-${variant}-consent`);
    if (width === 1280) await b.shot(`desktop-${variant}`, { full: variant === "a" });
    else await b.shot(`${width === 320 ? "narrow" : "tablet"}-${variant}`, { full: variant === "a" });
  }
  for (const state of ["loading", "unavailable"]) {
    await go(`state=${state}`); assert.equal(await b.evaluate(`${sw}.disabled`), true);
    assert.ok(!(await b.evaluate("document.querySelector('[data-permission-state]').textContent")).includes("Off"));
    await click("Try again"); await b.waitFor(`!${sw}.disabled`); await checked(false);
  }
  for (const platform of ["web", "ios", "android"]) {
    await go(`platform=${platform}&variant=b`); await b.activate(sw); await b.waitFor(decision("b"));
    await b.key("Escape", "Escape", 27); await b.waitFor(`!(${decision("b")})`); await checked(false);
    await b.activate(sw); await b.waitFor(decision("b"));
    await b.evaluate("history.back()"); await b.waitFor(`!(${decision("b")})`); await checked(false);
    await b.evaluate(`${sw}.focus()`); await b.key(" ", "Space", 32); await b.waitFor(decision("b")); await checked(false);
    await click("Not now"); await b.waitFor(`!(${decision("b")})`);
    await b.activate("document.querySelector('[data-proposed-plan] button')");
    await b.waitFor("document.querySelector('[data-plan-picker-preview]')");
    await layout(`${platform}-plan-picker`);
    await b.evaluate("Promise.all(document.getAnimations().map(a=>a.finished.catch(()=>{}))).then(()=>true)");
    const primary = "document.querySelector('[data-plan-picker-preview] button.bg-indigo-600.w-full.mt-3:not(:disabled)')";
    if (await b.evaluate(`!!(${primary})`)) {
      await b.activate(primary);
      await b.waitFor("document.querySelector('[data-plan-picker-preview] [role=alert]')?.textContent.includes('Preview only')");
    }
    const url = await b.evaluate("location.href");
    await b.activate("document.querySelector('[data-plan-picker-preview] a[href=\"/terms\"]')");
    assert.equal(await b.evaluate("location.href"), url, "policy link cannot leave preview");
    await b.key("Escape", "Escape", 27); await b.waitFor("!document.querySelector('[data-sheet-frame]')");
  }
  for (const state of ["free", "trial", "cancelled", "past-due", "checkout-closed", "loading", "error"]) {
    await go(`plan=${state}`); await layout(`plan-${state}`);
    if (state === "error") { await b.activate("document.querySelector('[data-proposed-plan] button')"); await b.waitFor("document.querySelector('[data-proposed-plan]').textContent.includes('Plus plan')"); }
  }
  for (const mode of ["light", "dark"]) {
    await go(`view=profile&state=save-error&mode=${mode}`);
    assert.equal(await b.evaluate("document.querySelectorAll('input').length"), 1);
    assert.ok(!(await b.evaluate("document.body.innerText")).toLowerCase().includes("postcode"));
    await b.type("document.querySelector('input')", "Alexandra Morgan-Worthington de Silva");
    await b.key("Enter", "Enter", 13); await b.waitFor("document.body.innerText.includes('Could not save profile')");
    await click("Save profile"); await b.waitFor("document.body.innerText.includes('Profile saved')");
    await layout(`profile-${mode}`); await b.shot(`profile-${mode}`, { full: true });
  }
  await b.viewport(390, 844);
  await b.navigate("/design/settings-followups", ready); await layout("preview-controls");
  await b.shot("preview-controls", { full: true });
  assert.deepEqual(b.exceptions, [], "no browser exceptions");
  assert.deepEqual(b.apiRequests, [], "no account API calls");
  const stored = await b.evaluate("({local:Object.keys(localStorage),session:Object.keys(sessionStorage).filter(k=>!k.startsWith('wd_scroll:/design/settings-followups'))})");
  assert.deepEqual(stored, { local: [], session: [] }, "no product storage changes");
  await b.save("checks", { results, findings, exceptions: b.exceptions, apiRequests: b.apiRequests, stored });
  assert.deepEqual(findings, [], "batched layout/focus findings");
  console.log(`G296: ${results.length} layout checks; consent, cancellation, retry, keyboard, Back, profile and guarded plan paths passed. Evidence: ${output}`);
} finally { b.close(); }
