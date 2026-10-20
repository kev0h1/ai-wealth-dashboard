// Builds a test-only host around actual production components and compiled
// Next CSS/fonts. It serves no product API and creates no retained UI route.
import assert from "node:assert/strict";
import { readFile, mkdtemp } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import { build } from "esbuild";
import { openBrowser } from "./g293-browser-helper.mjs";
const scratch = await mkdtemp("/tmp/g296-production-host-");
const html = await readFile(".next/server/app/design.html", "utf8");
const links = (html.match(/<link[^>]+>/g) ?? []).filter(link => /stylesheet|\.woff2/.test(link)).join("");
const htmlClass = html.match(/<html[^>]*class="([^"]*)"/)?.[1] ?? "";
const bodyClass = html.match(/<body[^>]*class="([^"]*)"/)?.[1] ?? "";
await build({ entryPoints: ["scripts/fixtures/g296-settings-browser.tsx"], outfile: path.join(scratch, "host.js"), bundle: true, platform: "browser", format: "iife", define: { "process.env.NODE_ENV": '"production"', "process.env": "{}" }, loader: { ".module.css": "local-css" } });
const server = createServer(async (req, res) => {
  try {
    const pathname = new URL(req.url, "http://localhost").pathname;
    if (pathname.startsWith("/_next/static/") && !pathname.includes("..")) {
      res.setHeader("Content-Type", pathname.endsWith(".css") ? "text/css" : "font/woff2");
      res.end(await readFile(path.join(".next/static", pathname.slice("/_next/static/".length))));
    } else if (pathname === "/host.js") { res.setHeader("Content-Type", "text/javascript"); res.end(await readFile(path.join(scratch, "host.js"))); }
    else { res.setHeader("Content-Type", "text/html"); res.end(`<!doctype html><html lang="en" class="${htmlClass}"><head><meta name="viewport" content="width=device-width,initial-scale=1">${links}</head><body class="${bodyClass}"><div id="root"></div><script src="/host.js"></script></body></html>`); }
  } catch { res.statusCode = 404; res.end("Not found"); }
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const b = await openBrowser({ origin: `http://127.0.0.1:${server.address().port}`, output: process.argv[2] });
const sw = "document.querySelector('[data-permission-switch]')";
const button = label => `[...document.querySelectorAll('button')].find(e=>e.textContent.trim()===${JSON.stringify(label)}&&e.getClientRects().length)`;
const region = "document.querySelector('[aria-label=\"Penny permission confirmation\"]')";
const results = [], findings = [];
const go = async (query = "", width = 390) => { await b.viewport(width, 844); await b.navigate(`/?${query}`, "document.querySelector('[data-g296-production]')"); };
const click = label => b.activate(button(label));
const checked = async value => assert.equal(await b.evaluate(`${sw}.getAttribute('aria-checked')`), String(value));
const layout = async label => {
  const result = await b.evaluate(`(()=>{const visible=e=>e.getClientRects().length&&getComputedStyle(e).visibility!=='hidden';return{width:innerWidth,overflow:document.documentElement.scrollWidth>innerWidth+1,small:[...document.querySelectorAll('main button,main input')].filter(visible).filter(e=>e.getBoundingClientRect().height<43.5).map(e=>e.textContent),inputs:[...document.querySelectorAll('input')].filter(visible).map(e=>getComputedStyle(e).fontSize)};})()`);
  results.push({label,...result}); if (result.overflow || result.small.length || result.inputs.some(size=>parseFloat(size)<16)) findings.push({label,...result});
};
try {
  for (const mode of ["light", "dark"]) {
    await go(`mode=${mode}`); await checked(false); await layout(`${mode}-rest`); await b.shot(`${mode}-rest`,{full:true});
    await b.activate(sw); await b.waitFor(region); await checked(false);
    assert.equal((await b.evaluate("g296Calls")).grant, 0, "request alone cannot grant consent");
    await layout(`${mode}-consent`); await b.shot(`${mode}-consent`,{full:true});
    await click("Not now"); await b.waitFor(`!(${region})`); await b.settle(); await checked(false);
    assert.equal(await b.evaluate(`document.activeElement===${sw}`),true,"cancel returns focus");
    await b.evaluate(`${sw}.focus()`); await b.key(" ","Space",32); await b.waitFor(region);
    await click("Yes, set things up"); await b.waitFor(`${sw}.getAttribute('aria-checked')==='true'`);
    await b.activate(sw); await b.waitFor(region); await checked(true); await click("Keep on"); await b.waitFor(`!(${region})`);
    await b.activate(sw); await b.waitFor(region); await click("Turn off"); await b.waitFor(`${sw}.getAttribute('aria-checked')==='false'`);
    assert.deepEqual(await b.evaluate("g296Calls"), {grant:1,revoke:1,refresh:2,profile:0});
  }
  for (const state of ["save-error","unknown","lost-response"]) {
    await go(`state=${state}`); await b.activate(sw); await b.waitFor(region); await click("Yes, set things up");
    if (state === "save-error") { await b.waitFor("document.querySelector('[role=alert]')"); await checked(false); await click("Yes, set things up"); }
    if (state === "unknown") { await b.waitFor(`${sw}.disabled&&document.body.innerText.includes('Unavailable')`); assert.equal(await b.evaluate(`${sw}.hasAttribute('aria-checked')`),false); await click("Try again"); }
    await b.waitFor(`${sw}.getAttribute('aria-checked')==='true'`);
  }
  await go("state=unavailable"); await click("Try again"); await b.waitFor(`${sw}.getAttribute('aria-checked')==='false'`);
  await b.activate("document.querySelector('main button')"); await b.waitFor("document.querySelector('[data-sheet-frame]')");
  await b.key("Escape","Escape",27); await b.waitFor("!document.querySelector('[data-sheet-frame]')");
  await go("plans=1"); await b.waitFor("document.querySelector('[data-sheet-frame]')");
  await b.key("Escape","Escape",27); await b.waitFor("!document.querySelector('[data-sheet-frame]')");
  for (const mode of ["light","dark"]) for (const width of [320,390,768,1280]) {
    await go(`mode=${mode}&state=on`,width); await b.activate(sw,width<600); await b.waitFor(region); await layout(`${mode}-${width}-revoke`);
    if(width===320||width===1280) await b.shot(`${mode}-${width}-revoke`,{full:true});
    await go(`view=profile&mode=${mode}`,width); await b.type("document.querySelector('input')","Alexandra Morgan-Worthington de Silva"); await b.key("Enter","Enter",13); await b.waitFor("document.body.innerText.includes('Profile saved')"); await layout(`${mode}-${width}-profile`);
    if(width===390) await b.shot(`${mode}-profile`,{full:true});
  }
  for (const state of ["free","trial","cancelled","past-due","checkout-closed","loading","error"]) { await go(`plan=${state}&mode=dark`); await layout(`plan-${state}`); }
  assert.deepEqual(b.apiRequests,[]); assert.deepEqual(b.exceptions,[]);
  await b.save("checks",{results,findings,exceptions:b.exceptions,apiRequests:b.apiRequests}); assert.deepEqual(findings,[]);
  console.log(`G296 production components: ${results.length} layouts, real inline consent/revoke/cancel/retry/unknown/lost response, Space/focus, real plan sheet and Profile Enter passed. ${b.output}`);
} finally { b.close(); await new Promise(resolve=>server.close(resolve)); }
