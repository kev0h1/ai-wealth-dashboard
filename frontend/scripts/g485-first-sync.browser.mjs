// Production pages and sync hook with deferred in-memory APIs. No customer API,
// authenticated route, database write or retained design preview is involved.
import assert from "node:assert/strict";
import { build } from "esbuild";
import { createServer } from "node:http";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import postcss from "postcss";
import tailwind from "@tailwindcss/postcss";
import { openBrowser } from "./_plan-browser.mjs";

const out = await mkdtemp(path.join(tmpdir(), "g485-first-sync-"));
const output = process.argv[2] ?? path.resolve("../.impeccable/review/g485");
const entry = `
import React, {useState} from 'react';
import {createRoot} from 'react-dom/client';
import HomePage from './app/components/HomePage';
import SpendPage from './app/components/SpendPage';
import UpcomingPage from './app/planning/PlanningPage';
import FirstSyncCard from './components/FirstSyncCard';
import FirstSyncStatus from './components/FirstSyncStatus';
import {useFirstSync} from './lib/useFirstSync';
import {cachedEndpoint,ENDPOINT,invalidateAllEndpoints} from './lib/endpointCache';
import {invalidateAllAccountData} from './lib/accountMutations';
import {spacingFixture} from './scripts/fixtures/g293-spend-spacing';
import {G287_SCENARIOS} from './scripts/fixtures/g287-forecast';
import {DEFAULT_PAY_PERIOD_CONFIG} from './lib/payPeriod';
window.requests=[];window.figureRequests=[];window.apiCalls=[];window.readyCalls=0;window.syncCalls=0;window.penny={};window.tutorial={};
window.prefs={payPeriodConfig:DEFAULT_PAY_PERIOD_CONFIG,rawPrefs:{},preferencesReady:true,hideNetWorth:false,homePinnedWidget:null,spendWidgets:[],showTips:false,setPayPeriodConfig:()=>{}};
window.verdict=spacingFixture('empty');window.safe=G287_SCENARIOS.comfortable.data;window.accounts=[];window.recent=[];
window.cashflow={upcoming_income:[],upcoming_bills:[],available_balance:1000,spendable_balance:1000,savings_balance:0,forecast:window.safe};
function HookView(){const [figure,setFigure]=useState('');const sync=useFirstSync(async()=>{window.readyCalls++;const value=await new Promise((resolve,reject)=>window.figureRequests.push({resolve,reject}));setFigure(value)});return <main className='mx-auto max-w-xl p-4'><h1 className='mb-5 text-xl font-bold'>Spend</h1>{sync.pending?<FirstSyncStatus error={sync.error} onRetry={()=>void sync.refresh()}/>:sync.active?<FirstSyncCard surface='spend' state={sync.status.state} connections={sync.status.connections} retrying={sync.retrying} onRetry={()=>void sync.retry()}/>:<p data-figure>{figure||'Ready'}</p>}</main>}
const root=createRoot(document.getElementById('root'));let serial=0;
window.render=async(surface='hook',cache=null)=>{root.render(null);await new Promise(r=>setTimeout(r,0));invalidateAllAccountData();window.requests=[];window.figureRequests=[];window.apiCalls=[];window.readyCalls=0;window.syncCalls=0;if(cache)await cachedEndpoint(ENDPOINT.syncStatus.key,()=>Promise.resolve(cache),{force:true});const Page={home:HomePage,spend:SpendPage,upcoming:UpcomingPage,hook:HookView}[surface];root.render(<Page key={++serial}/>)};
window.render(new URLSearchParams(location.search).get('surface')||'hook');`;

const mocks = {
  "next/link": `import React from 'react';export default function Link({children,href,...p}){return <a href={href} {...p}>{children}</a>}`,
  "next/navigation": `const router={push(v){window.destination=v},replace(){},prefetch(){},back(){}};const params=new URLSearchParams();export const useRouter=()=>router;export const useSearchParams=()=>params;export const usePathname=()=>'/';`,
  "next/dynamic": `export default ()=>()=>null`,
  "@/components/PreferencesContext": `export const usePreferences=()=>window.prefs`,
  "@/components/ColourProvider": `const colours={};export const useColours=()=>({colours})`,
  "@/components/IconProvider": `const icons={};export const useCategoryIcons=()=>({icons})`,
  "@/components/CategoriesContext": `export const useCategories=()=>({categories:[],refreshCategories:async()=>{}})`,
  "@/components/AuthProvider": `export const useAuth=()=>({user:{email:'g485-fixture@example.invalid',name:'Alex Example'},loading:false})`,
  "@/components/TutorialContext": `export const useTutorialReady=(key,value)=>{window.tutorial[key]=value}`,
  "@/components/PennySheetProvider": `export const setPennyScreenView=(key,value)=>{window.penny[key]=value};export const usePennySheet=()=>({openPenny(){}})`,
  "@/components/BiometricLock": `export const APP_LOCK_UNLOCKED_EVENT='fixture-unlocked'`,
  "@/components/ConfirmSheet": `export const noticeSheet=async()=>{};export const confirmSheet=async()=>false`,
  "@/lib/useProviderHealth": `export const useProviderHealth=()=>null`,
  "@/lib/useHomePinnedCards": `export const useHomePinnedCards=()=>({pinned:[]})`,
  "@/lib/homePinnedAccounts": `export const useHomePinnedAccounts=()=>[];export const invalidateHomePinnedAccounts=()=>{}`,
  "@/lib/openBankingAccess": `export const useOpenBankingAccess=()=>true;export const invalidateOpenBankingAccess=()=>{}`,
  "@/lib/api": `
export const API_BASE='/never-live-api';export const providerLogoUrl=()=>undefined;export const logoUrl=()=>undefined;
export class ApiError extends Error{constructor(status){super('Synthetic failure');this.status=status}}
export const api=new Proxy({getSyncStatus:()=>new Promise((resolve,reject)=>window.requests.push({resolve,reject})),syncAccounts:async()=>{window.syncCalls++},
accounts:async()=>window.accounts,getInvestmentAccounts:async()=>[],safeToSpend:async()=>window.safe,getToday:async()=>({items:[],account_eligibility:{}}),transactionsSearch:async()=>({items:window.recent,total:window.recent.length,pending_items:[],pending_total:0}),
getProfile:async()=>({full_name:'Alex Example'}),getSubscription:async()=>({tier:'plus'}),connections:async()=>[],oldestTransaction:async()=>({date:null}),getMirror:async()=>({status:'empty',traits:[]}),getSavingsInsights:async()=>[],getMoneyShape:async()=>null,
spendVerdict:async()=>window.verdict,spendingSignals:async()=>({}),getMiscategorisedCount:async()=>({count:0,pair_count:0,review_total:0,ids:[]}),cashflowWithForecast:async()=>window.cashflow,
listAllocations:async()=>[],listAccountPlans:async()=>[],dismissedSeries:async()=>({user:[],engine:[]}),allTransactions:async()=>[]},
{get(o,k){if(k in o)return (...args)=>{window.apiCalls.push(String(k));return o[k](...args)};return async()=>{window.apiCalls.push('UNEXPECTED:'+String(k));return []}}});`,
};
// Unrelated self-fetching Home children are isolated so this check drives the
// production Home state machine without permissions, advice or billing APIs.
const leaves = ["TeachingSheet", "HomeInsightSpotlight", "OfferCard", "UpcomingBillsStrip", "FuelSavingsCard", "GroceryBasketCard", "HomeTransfersCheck", "ReconfirmPrompt", "BankPickerSheet"];
for (const name of leaves) mocks[`@/components/${name}`] = `import {useEffect} from 'react';export default function Fixture({onReady}){useEffect(()=>{onReady?.()},[onReady]);return null}`;
mocks["@/components/notifications/NotificationPermissionProvider"] = `export const HomeNotificationPermission=()=>null`;
mocks["@/components/HomeBrief"] = `import React from 'react';import HomeGreetingHeader from '@/components/HomeGreetingHeader';export default function Fixture({banner}){return <><HomeGreetingHeader greeting='Hi, Alex' avatarInitials='AE'/>{banner}</>};export const HomeBriefClearedRow=()=>null`;

await build({
  stdin: { contents: entry, resolveDir: process.cwd(), loader: "tsx" },
  bundle: true, outfile: path.join(out, "bundle.js"), jsx: "automatic",
  define: { "process.env.NODE_ENV": '"production"', "process.env": "{}" },
  plugins: [{ name: "fixture-boundaries", setup(b) {
    b.onResolve({ filter: /^(next\/|@\/)/ }, (a) => a.path in mocks ? { path: a.path, namespace: "fixture" } : undefined);
    b.onLoad({ filter: /.*/, namespace: "fixture" }, (a) => ({ contents: mocks[a.path], loader: "tsx", resolveDir: process.cwd() }));
  } }],
});
const css = (await postcss([tailwind({ base: process.cwd() })]).process(await readFile("app/globals.css", "utf8"), { from: path.resolve("app/globals.css") })).css;
await writeFile(path.join(out, "styles.css"), css);
const html = `<!doctype html><html lang="en-GB"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/styles.css"><style>@font-face{font-family:Figtree;src:url(/fonts/Figtree.ttf)}@font-face{font-family:JetBrains;src:url(/fonts/JetBrainsMono.ttf)}:root{--font-figtree:Figtree;--font-jbmono:JetBrains}body{background:#f0f2f7}.dark body{background:#0f172a}</style></head><body><div id="app-shell"><div id="root"></div></div><script src="/bundle.js"></script></body></html>`;
const server = createServer(async (req, res) => {
  try {
    if (req.url === "/bundle.js" || req.url === "/styles.css") { res.setHeader("Content-Type", req.url.endsWith("css") ? "text/css" : "application/javascript"); return res.end(await readFile(path.join(out, req.url.slice(1)))); }
    if (req.url.startsWith("/fonts/")) return res.end(await readFile(path.join(process.cwd(), "public/design-media/c22/crafted/fonts", path.basename(req.url))));
    res.setHeader("Content-Type", "text/html; charset=utf-8");res.end(html);
  } catch { res.writeHead(404).end(); }
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
let browser;
const status = (state = "syncing", phase = "fetching", first = true) => ({ state, first_sync: first, has_connections: true, connections: state === "idle" ? [] : [{ provider: "finexer", connection_id: "fictional-g485", bank: "Barclays Personal", kind: first ? "new-bank" : "background", state, phase }] });
const facts = [];
try {
  browser = await openBrowser({ origin: `http://127.0.0.1:${server.address().port}`, output });
  const b = browser;
  const shot = (...args) => process.env.G485_CAPTURE === "0" ? Promise.resolve() : b.shot(...args);
  const text = () => b.evaluate("document.body.innerText");
  const render = async (surface, cache = null) => { await b.evaluate(`window.render(${JSON.stringify(surface)},${JSON.stringify(cache)})`); await b.waitFor("window.requests.length===1"); };
  const answer = async (value, index = 0) => { await b.evaluate(`window.requests[${index}].resolve(${JSON.stringify(value)})`); await b.settle(); };
  const visible = "[...document.querySelectorAll('[data-first-sync-state]')].filter(e=>e.getClientRects().length)";
  await b.viewport(390,844);await b.navigate("/", "window.requests?.length===1");

  // A stale idle cache never releases the initial status gate.
  await render("hook", status("idle", "fetching", false));
  assert.match(await text(), /Checking your bank sync/);
  assert.doesNotMatch(await text(), /Ready/);
  await answer(status());assert.match(await text(), /Fetching from Barclays Personal/);
  // Poll once through the actual visibility listener, with delayed fresh data.
  await b.evaluate("document.dispatchEvent(new Event('visibilitychange'))");await b.waitFor("window.requests.length===2");
  await answer(status("idle", "computing", false),1);await b.waitFor("window.figureRequests.length===1");
  assert.match(await text(), /No figure yet/);
  await b.evaluate("window.figureRequests[0].reject(new Error('Synthetic failed figure read'))");await b.waitFor("document.body.innerText.includes('Couldn’t check')");
  await b.activate("document.querySelector('button')");await b.waitFor("window.requests.length===3");
  await answer(status("idle", "computing", false),2);await b.waitFor("window.figureRequests.length===2");
  assert.doesNotMatch(await text(), /Ready/);
  await b.evaluate("window.figureRequests[1].resolve('Fresh figures')");await b.waitFor("document.body.innerText.includes('Fresh figures')");
  assert.equal(await b.evaluate("window.syncCalls"),0,"a failed figure read retries the read, not the bank sync");

  // A cold idle response after sync also waits for fresh figures.
  await render("hook");await answer(status("idle", "computing", false));await b.waitFor("window.figureRequests.length===1");
  assert.match(await text(), /Checking your bank sync/);
  await b.evaluate("window.figureRequests[0].resolve('Fresh initial figures')");await b.waitFor("document.body.innerText.includes('Fresh initial figures')");
  await render("hook");await b.evaluate("window.requests[0].reject(new Error('Synthetic offline'))");await b.waitFor("document.body.innerText.includes('Couldn’t check')");
  assert.doesNotMatch(await text(), /£|Ready/);

  // Full production page gates, including the no-account/transactions race.
  for (const surface of ["home","spend","upcoming"]) {
    for (const state of ["syncing","stalled","failed"]) {
      for (const phase of ["fetching","computing"]) {
        await render(surface);await answer(status(state,phase));await b.waitFor(`${visible}.length===1`);
        assert.doesNotMatch(await text(), /£0\.00|Nothing more expected|no spending to compare|Connect your first bank/);
        if(surface!=="home")assert.equal(await b.evaluate(`window.penny[${JSON.stringify(surface)}]??null`),null);
        if(state!=="syncing")assert.match(await text(),/Try again/);
        if(state==="failed")assert.equal(await b.evaluate(`${visible}[0].querySelectorAll('button').length>0`),true);
        if(state!=="syncing"){
          if(phase==="computing")for(const mode of ["light","dark"]){await b.viewport(390,844);await b.evaluate(`document.documentElement.classList.toggle('dark',${mode==="dark"})`);await shot(`${surface}-${state}-${mode}-390`);}
          continue;
        }
        for (const mode of ["light","dark"]) for (const width of [390,1280]) {
          await b.viewport(width,844);await b.evaluate(`document.documentElement.classList.toggle('dark',${mode==="dark"})`);await b.settle();
          const metrics=await b.evaluate(`(()=>{const card=${visible}[0],ol=card.querySelector('ol'),slot=card.querySelector('[data-first-sync-slot]'),status=card.querySelector('[role=status]');return{width:innerWidth,overflow:document.documentElement.scrollWidth>innerWidth,rows:[...ol.children].map(row=>{const r=row.getBoundingClientRect(),c=[...row.children].map(e=>e.getBoundingClientRect()),top=Math.min(...c.map(v=>v.top)),bottom=Math.max(...c.map(v=>v.bottom)),s=getComputedStyle(row);return{top:top-r.top-parseFloat(s.borderTopWidth),bottom:r.bottom-bottom-parseFloat(s.borderBottomWidth)}}),headerGap:slot.getBoundingClientRect().top-card.firstElementChild.firstElementChild.getBoundingClientRect().bottom,supportGap:slot.nextElementSibling.getBoundingClientRect().top-slot.getBoundingClientRect().bottom,statusGap:status.getBoundingClientRect().top-card.firstElementChild.getBoundingClientRect().bottom,ledgerGap:ol.getBoundingClientRect().top-status.getBoundingClientRect().bottom}})()`);
          assert.equal(metrics.width,width);assert.equal(metrics.overflow,false);assert.equal(metrics.headerGap,20);assert.equal(metrics.supportGap,8);assert.equal(metrics.statusGap,20);assert.equal(metrics.ledgerGap,20);
          metrics.rows.forEach(row=>assert.ok(Math.abs(row.top-row.bottom)<=1,JSON.stringify(row)));
          facts.push({surface,state,phase,mode,...metrics});await shot(`${surface}-${phase}-${mode}-${width}`);
        }
      }
    }
  }
  await b.viewport(390,844);await render("spend");await answer(status("failed"));
  await b.activate("[...document.querySelectorAll('button')].find(e=>e.textContent==='Try again')");await b.waitFor("window.syncCalls===1 && window.requests.length===2");
  await answer(status(),1);await b.waitFor("document.querySelector('[data-first-sync-state=syncing]')");
  await b.evaluate("window.recent=[{id:'fictional-salary',account_id:'fictional-account',date:'2026-11-21',amount:1200,currency:'GBP',description:'Example salary',category:'Income',transaction_type:'credit'}]");await render("home");
  await answer(status("idle","computing",false));await b.waitFor("document.body.innerText.includes('Example salary')");
  assert.doesNotMatch(await text(),/Connect your first bank/);
  assert.match(await text(),/left to spend/i);
  await shot("home-ready-race-390");
  await b.viewport(320,844);await render("spend");await answer({...status(),connections:[{...status().connections[0],bank:'VeryLongBankName'.repeat(12)}]});
  await b.waitFor("document.querySelector('[data-first-sync-state]')");
  assert.equal(await b.evaluate("document.documentElement.scrollWidth>innerWidth"),false,"long provider names wrap at the narrow viewport");
  assert.deepEqual(b.exceptions,[]);assert.deepEqual(b.apiRequests,[]);
  await b.save("results",{passed:true,facts,coverage:"production first-sync gates, fetch/compute/stall/failure, stale idle, delayed figures, read retry, cold idle, bank retry, Home empty accounts with activity"});
  console.log(JSON.stringify({passed:true,layouts:facts.length,output}));
} catch(error) {
  if(browser)await browser.save("failure",{error:String(error),exceptions:browser.exceptions,apiRequests:browser.apiRequests});
  throw error;
} finally {browser?.close();await new Promise(r=>server.close(r));}
