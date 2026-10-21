// Optional real-hook/browser regression, using deferred synthetic reads.
// Run after npm run build. No app route, auth bypass or customer API is used.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { openBrowser } from "./_plan-browser.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const output = process.argv[2] ?? "/tmp/g287-status-loading";
const css = (await readdir(path.join(root, ".next/static/chunks"))).filter(name => name.endsWith(".css"));
const page = await readFile(path.join(root, ".next/server/app/design.html"), "utf8");
const bodyClass = page.match(/<body[^>]*class="([^"]*)"/)?.[1] ?? "";
const htmlClass = page.match(/<html[^>]*class="([^"]*)"/)?.[1] ?? "";
const bundle = await build({
  stdin: { resolveDir: root, loader: "tsx", contents: `
    import React, {useLayoutEffect, useState} from 'react';
    import {createRoot} from 'react-dom/client';
    import UpcomingHeroCard from './components/upcoming/UpcomingHeroCard';
    import {useForecastContext} from './lib/useForecastContext';
    import {upcomingForecastPresentation} from './lib/cashForecastStatus';
    import {deriveSafeToSpendHeadline} from './lib/pennyScreenViews';
    import {G287_SCENARIOS,g287UpcomingProps} from './scripts/fixtures/g287-forecast';
    const requests=[];
    const load=()=>new Promise((resolve,reject)=>requests.push({resolve,reject}));
    const scenario=new URLSearchParams(location.search).get('state')||'plans';
    window.statusTrace=[];
    function Fixture(){
      const [forecast,replace]=useState(()=>({scenario}));
      const context=useForecastContext(forecast,load);
      const data=G287_SCENARIOS[forecast.scenario].data;
      const props=g287UpcomingProps(data);
      const presentation=upcomingForecastPresentation({
        runway:props.runway,lowestCash:data.lowest_projected_balance,evidenceCurrent:true,
        nextPayday:Date.parse(data.next_payday),isCalendarMonth:false,metadata:context.data,
        headline:context.data?.status==='ok'?deriveSafeToSpendHeadline(context.data):null,
        metadataPending:context.pending,plansAvailable:true,
      });
      useLayoutEffect(()=>{
        window.statusTrace.push({scenario:forecast.scenario,pending:presentation.pending??false,
          label:document.querySelector('[data-forecast-tone]')?.textContent??null});
        window.fixture={replace:scenario=>replace({scenario}),requests,
          resolve:(index,scenario)=>requests[index].resolve(G287_SCENARIOS[scenario].data),
          reject:index=>requests[index].reject(new Error('Synthetic unavailable context'))};
      });
      return <UpcomingHeroCard {...props} presentation={presentation}/>;
    }
    createRoot(document.getElementById('fixture')).render(<Fixture/>);
  ` },
  bundle: true, write: false, format: "iife", platform: "browser", tsconfig: path.join(root, "tsconfig.json"),
  define: { "process.env.NODE_ENV": '"production"', "process.env": "{}" },
});
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://localhost");
    if (url.pathname === "/fixture.js") { res.setHeader("Content-Type", "text/javascript"); res.end(bundle.outputFiles[0].contents); return; }
    if (url.pathname.startsWith("/_next/static/")) {
      const base = path.join(root, ".next/static");
      const file = path.resolve(base, url.pathname.slice("/_next/static/".length));
      if (!file.startsWith(base + path.sep)) { res.writeHead(404).end(); return; }
      res.setHeader("Content-Type", file.endsWith(".css") ? "text/css" : "font/woff2"); res.end(await readFile(file)); return;
    }
    res.setHeader("Content-Type", "text/html");
    res.end(`<!doctype html><html class="${htmlClass} ${url.searchParams.get("mode") === "dark" ? "dark" : ""}"><head><meta name="viewport" content="width=device-width, initial-scale=1">${css.map(name => `<link rel="stylesheet" href="/_next/static/chunks/${name}">`).join("")}</head><body class="${bodyClass}" style="margin:0;padding:20px;background:${url.searchParams.get("mode") === "dark" ? "#0f172a" : "#f0f2f7"}"><main id="fixture" style="max-width:560px;margin:auto"></main><script src="/fixture.js"></script></body></html>`);
  } catch { res.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
let browser;
const facts = [];
try {
  browser = await openBrowser({ origin: `http://127.0.0.1:${server.address().port}`, output });
  const reset = async (state, width = 390, mode = "dark") => {
    await browser.viewport(width, 900);
    await browser.navigate(`/?state=${state}&mode=${mode}`, "window.fixture?.requests?.length===1");
  };
  const metrics = () => browser.evaluate(`(()=>{const card=document.querySelector('.glass-hero'),h=card.firstElementChild.getBoundingClientRect(),a=card.querySelector('p[aria-label]').getBoundingClientRect();return{grid:getComputedStyle(card.firstElementChild).gridTemplateColumns,badgeWidth:document.querySelector('[data-forecast-tone]')?.getBoundingClientRect().width,bodyFont:getComputedStyle(document.body).fontFamily,statusFont:document.querySelector('[data-forecast-tone]')?getComputedStyle(document.querySelector('[data-forecast-tone]')).fontSize:null,width:innerWidth,amountTop:a.top,headerHeight:h.height,gap:a.top-h.bottom,overflow:document.documentElement.scrollWidth>innerWidth+1,badge:document.querySelector('[data-forecast-tone]')?.textContent??null,pending:!!document.querySelector('[data-forecast-pending]')}})()`);
  for (const width of [320, 390, 1280]) for (const mode of ["light", "dark"]) for (const [state, label] of [["plans", "Plans gap"], ["comfortable", "On track"], ["card-check", "Check card bill"]]) {
    await reset(state, width, mode);
    const before = await metrics();
    assert.equal(before.width, width); assert.equal(before.pending, true); assert.equal(before.badge, null); assert.equal(before.overflow, false);
    assert.equal(await browser.evaluate("document.querySelectorAll('[role=status]').length"), 0, "no provisional live-region announcement");
    await browser.evaluate("new Promise(resolve=>setTimeout(resolve,250))");
    assert.equal((await metrics()).badge, null, "a delayed response never shows the default icon");
    if (width === 390 && state === "plans") await browser.shot(`${mode}-pending`);
    await browser.evaluate(`window.fixture.resolve(0,${JSON.stringify(state)})`);
    await browser.waitFor(`document.querySelector('[data-forecast-tone]')?.textContent===${JSON.stringify(label)}`);
    const after = await metrics();
    assert.equal(after.pending, false); assert.equal(after.overflow, false);
    assert.ok(Math.abs(after.amountTop - before.amountTop) < 1, JSON.stringify({ state, width, mode, before, after }));
    assert.ok(Math.abs(after.gap - 20) < 1);
    assert.deepEqual(await browser.evaluate("window.statusTrace.map(s=>s.label).filter(Boolean)"), [label], "first visible status is the actual settled verdict");
    if (width === 390 && state === "plans") await browser.shot(`${mode}-settled`);
    facts.push({ state, width, mode, before, after });
  }
  await reset("plans"); await browser.evaluate("window.fixture.reject(0)");
  await browser.waitFor("document.querySelector('[data-forecast-tone]')?.textContent==='Check forecast'");
  assert.equal((await metrics()).pending, false, "a failed read settles rather than leaving a blank status forever");
  await reset("habitual");
  assert.equal((await metrics()).badge, "Short", "proved payment risk is immediate, before optional context");
  await reset("comfortable");
  await browser.evaluate("window.fixture.replace('plans')"); await browser.waitFor("window.fixture.requests.length===2");
  assert.equal((await metrics()).badge, null);
  await browser.evaluate("window.fixture.resolve(0,'comfortable')"); await browser.settle();
  assert.equal((await metrics()).badge, null, "late old metadata cannot colour the new forecast");
  await browser.evaluate("window.fixture.resolve(1,'plans')"); await browser.waitFor("document.querySelector('[data-forecast-tone]')?.textContent==='Plans gap'");
  await browser.evaluate("window.fixture.replace('comfortable')"); await browser.waitFor("window.fixture.requests.length===3");
  assert.equal((await metrics()).badge, null, "a refresh clears the previous settled status immediately");
  await browser.evaluate("window.fixture.reject(2)"); await browser.waitFor("document.querySelector('[data-forecast-tone]')?.textContent==='Check forecast'");
  assert.deepEqual(browser.exceptions, []); assert.deepEqual(browser.apiRequests, []);
  await browser.save("results", { layouts: facts.length, delayedReads: "passed", failure: "passed", immediateRisk: "passed", staleAndRefresh: "passed", facts });
  console.log(JSON.stringify({ layouts: facts.length, delayedReads: "passed", failure: "passed", immediateRisk: "passed", staleAndRefresh: "passed", output }));
} catch (error) {
  if (browser) await browser.save("failure", { error: String(error), exceptions: browser.exceptions, apiRequests: browser.apiRequests });
  throw error;
} finally { browser?.close(); await new Promise(resolve => server.close(resolve)); }
