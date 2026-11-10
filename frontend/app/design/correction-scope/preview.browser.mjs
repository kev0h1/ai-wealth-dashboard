import assert from "node:assert/strict";
import { build } from "esbuild";
import { createServer } from "node:http";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import postcss from "postcss";
import tailwind from "@tailwindcss/postcss";
import { openBrowser } from "../../../scripts/_plan-browser.mjs";

const out = await mkdtemp(path.join(tmpdir(), "g453-preview-"));
const evidence = path.resolve("../.impeccable/review/g453");
await mkdir(evidence, { recursive: true });
await build({ stdin: { contents: "import React from 'react';import{createRoot}from'react-dom/client';import Client from'./app/design/correction-scope/CorrectionScopeClient';createRoot(document.getElementById('root')).render(<Client/>);", resolveDir: process.cwd(), loader: "tsx" }, bundle: true, outfile: path.join(out, "bundle.js"), loader: { ".css": "local-css" }, jsx: "automatic", define: { "process.env": "{}" }, plugins: [{ name: "g453-query", setup(build) { build.onResolve({ filter: /^next\/navigation$/ }, () => ({ path: "query", namespace: "fixture" })); build.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({ contents: "export const useSearchParams=()=>new URLSearchParams(location.search)", loader: "js" })); } }] });
const css = (await postcss([tailwind({ base: process.cwd() })]).process(await readFile("app/globals.css", "utf8"), { from: path.resolve("app/globals.css") })).css + "\n" + await readFile(path.join(out, "bundle.css"), "utf8");
await writeFile(path.join(out, "styles.css"), css);
const html = '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/styles.css"><style>@font-face{font-family:Figtree;src:url(/fonts/Figtree.ttf)}@font-face{font-family:JetBrains;src:url(/fonts/JetBrainsMono.ttf)}:root{--font-figtree:Figtree;--font-jbmono:JetBrains}body{margin:0}</style></head><body><div id="root"></div><script src="/bundle.js"></script></body></html>';
const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url, "http://local.test");
    if (url.pathname === "/bundle.js" || url.pathname === "/styles.css") { response.setHeader("Content-Type", url.pathname.endsWith(".css") ? "text/css" : "application/javascript"); return response.end(await readFile(path.join(out, url.pathname.slice(1)))); }
    if (url.pathname.startsWith("/fonts/")) { response.setHeader("Content-Type", "font/ttf"); return response.end(await readFile(path.join(process.cwd(), "public/design-media/c22/crafted/fonts", path.basename(url.pathname)))); }
    response.setHeader("Content-Type", "text/html"); response.end(html);
  } catch { response.statusCode = 404; response.end("missing"); }
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const browser = await openBrowser({ origin: `http://127.0.0.1:${server.address().port}`, output: evidence });
let checks = 0;
const expect = (value, message) => { assert.equal(value, true, message); checks += 1; };
const button = text => `[...(document.querySelectorAll('[role=dialog]')[document.querySelectorAll('[role=dialog]').length-1]||document).querySelectorAll('button')].find(e=>e.textContent.trim()===${JSON.stringify(text)}||e.querySelector('strong')?.textContent.trim()===${JSON.stringify(text)})`;
const visit = async (variant = "a", state = "savings", mode = "light", width = 390) => { await browser.viewport(width, 844); await browser.navigate(`/?variant=${variant}&state=${state}&mode=${mode}`, "Boolean(document.querySelector('[role=dialog]'))"); await browser.settle(); };
const chooseScope = async value => { await browser.activate(`document.querySelector('input[value="${value}"]')`, false); await browser.settle(); };
try {
  for (const variant of ["a", "b"]) {
    for (const resolution of ["Another of my accounts", "Paying off a card", "Savings", "Investments", "A goal", "An account Sorted cannot see", "Spending"]) {
      await visit(variant, "start"); await browser.activate(button(resolution), false);
      if (resolution === "A goal") { await browser.waitFor("document.body.innerText.includes('Which goal?')"); await browser.activate(button("Holiday"), false); }
      if (resolution === "An account Sorted cannot see") { await browser.waitFor("Boolean(document.querySelector('#g453-offline-name'))"); await browser.activate(button("Use this account"), false); }
      if (resolution === "Spending") { await browser.waitFor("document.body.innerText.includes('Which category?')"); await browser.activate(button("Shopping"), false); }
      await browser.waitFor("document.querySelectorAll('input[type=radio]').length===3");
      expect(await browser.evaluate("document.querySelector('input[value=one]').checked"), "smallest scope defaults");
      expect(await browser.evaluate("!document.body.innerText.includes('Name this savings')&&!document.body.innerText.includes('Name this investment')"), "no redundant naming");
    }
    for (const [scope, count] of [["one", 1], ["history", 24], ["history-future", 24]]) {
      await visit(variant); await chooseScope(scope); await browser.activate(button(`Update ${count} ${count === 1 ? "payment" : "payments"}`), false);
      await browser.waitFor(`document.body.innerText.includes('Updated ${count} ${count === 1 ? "payment" : "payments"}')`);
      expect(await browser.evaluate("document.body.innerText.includes('3 payments you already categorised were not changed.')"), "protected count");
      expect(await browser.evaluate("document.body.innerText.includes('New matching outgoing payments will be filed as Savings.')") === (scope === "history-future"), "explicit future scope");
      if (scope === "history-future") {
        await browser.activate(button("View future rule"), false); await browser.waitFor("document.querySelectorAll('[role=dialog]').length===2"); await browser.settle();
        await browser.activate(button("Remove future rule"), false); await browser.waitFor("document.body.innerText.includes('Future rule removed')");
        expect(await browser.evaluate("document.body.innerText.includes('Existing payments are unchanged.')"), "rule removal keeps history");
        await browser.activate(button("Undo rule removal"), false); await browser.waitFor("document.body.innerText.includes('File new outgoing payments as Savings')");
        await browser.key("Escape", "Escape", 27); await browser.waitFor("document.querySelectorAll('[role=dialog]').length===1");
      }
      await browser.activate(button("Undo correction"), false); await browser.waitFor("document.querySelectorAll('input[type=radio]').length===3");
      expect(await browser.evaluate("document.querySelector('input[value=one]').checked"), "Undo restores one-off default");
    }
    await visit(variant, "count-error");
    expect(await browser.evaluate("document.querySelector('input[value=history]').disabled&&document.querySelector('input[value=history-future]').disabled"), "unknown counts disable broader scope");
    await browser.activate(button("Try checking again"), false); await browser.waitFor("!document.querySelector('input[value=history]').disabled");
    await visit(variant, "save-error"); await chooseScope("history"); await browser.activate(button("Update 24 payments"), false); await browser.waitFor("Boolean(document.querySelector('[role=alert]'))");
    expect(await browser.evaluate("!document.querySelector('[data-correction-saved]')"), "failed save is not reported committed");
    await browser.activate(button("Update 24 payments"), false); await browser.waitFor("Boolean(document.querySelector('[data-correction-saved]'))");
    await visit(variant, "refresh-error"); await chooseScope("history"); await browser.activate(button("Update 24 payments"), false); await browser.waitFor("document.body.innerText.includes('Your changes are saved, but the figures have not refreshed.')");
    await browser.activate(button("Refresh figures"), false); await browser.waitFor("document.body.innerText.includes('The payment list and figures are refreshed.')");
    expect(await browser.evaluate("document.body.innerText.includes('Updated 24 payments')&&!document.body.innerText.includes('Update 24 payments')"), "refresh does not resubmit");
    await visit(variant, "protected"); expect(await browser.evaluate("document.querySelector('input[value=history]').disabled&&document.body.innerText.includes('26 payments you already categorised')"), "all earlier manual choices protected");
    await visit(variant, "older"); await chooseScope("history-future"); expect(await browser.evaluate(`Boolean(${button("Update 26 payments")})`), "older selection shows later booked matches explicitly");
    for (const [mode, width, state] of [["light",390,"savings"],["dark",390,"savings"],["light",1440,"savings"],["dark",1440,"savings"],["light",390,"hidden"],["dark",390,"hidden"],["light",320,"long"]]) {
      await visit(variant, state, mode, width); await chooseScope("history");
      expect(await browser.evaluate("document.documentElement.scrollWidth<=innerWidth"), "no horizontal page overflow");
      expect(await browser.evaluate("[...document.querySelectorAll('[role=dialog] fieldset label')].every(e=>e.getBoundingClientRect().right<=innerWidth)"), "scope choices fit");
      if (state === "hidden") expect(await browser.evaluate("document.body.innerText.includes('−£••••')&&!document.body.innerText.includes('£11.92')"), "monetary privacy");
      await browser.evaluate("document.querySelector('[data-sheet-body]').scrollTop=0");
      await browser.shot(`${variant}-${mode}-${width}-${state}`);
    }
    await visit(variant); await browser.activate("document.querySelector('input[value=one]')", false); await browser.key("ArrowDown", "ArrowDown", 40); expect(await browser.evaluate("document.querySelector('input[value=history]').checked"), "native radio keyboard");
    await browser.key("Escape", "Escape", 27); await browser.waitFor("!document.querySelector('[role=dialog]')");
  }
  assert.deepEqual(browser.exceptions, []); assert.deepEqual(browser.apiRequests, []);
  await browser.save("result", { passed: true, checks, variants: ["a","b"], widths: [320,390,1440], themes: ["light","dark"], APIRequests: 0 });
  console.log(`G453 browser: ${checks} checks passed`);
} finally { browser.close(); await new Promise(resolve => server.close(resolve)); }
