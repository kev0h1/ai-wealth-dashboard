// G452 exercises the real transactions hub in Chrome with only its API and
// surrounding app services fixed. Run with:
// node scripts/g452-transactions-series.browser.mjs
import assert from "node:assert/strict";
import { build } from "esbuild";
import { createServer } from "node:http";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { openBrowser } from "./_plan-browser.mjs";

const out = await mkdtemp(path.join(tmpdir(), "g452-transactions-series-"));
const evidence = await mkdtemp(path.join(tmpdir(), "g452-transactions-evidence-"));
const entry = `
import React,{useEffect,useState}from 'react';
import {createRoot} from 'react-dom/client';
import TransactionsPage from './app/transactions/TransactionsPage';
const fire=()=>dispatchEvent(new PopStateEvent('popstate'));
const push=history.pushState.bind(history),replace=history.replaceState.bind(history);
history.pushState=(...args)=>{push(...args);fire()};history.replaceState=(...args)=>{replace(...args);fire()};
window.__g452={requests:[],go(query){history.pushState(null,'','/transactions'+query)}};
createRoot(document.getElementById('root')).render(<TransactionsPage/>);
`;
const stubs = {
  "next/navigation": `import React,{useEffect,useState}from'react';export const useSearchParams=()=>{const[,tick]=useState(0);useEffect(()=>{const update=()=>tick(x=>x+1);addEventListener('popstate',update);return()=>removeEventListener('popstate',update)},[]);return new URLSearchParams(location.search)};`,
  "next/link": `export default function Link({href,children,...props}){return <a href={href} {...props}>{children}</a>}`,
  "@/lib/api": `export const api={transactionsSearch(args){return new Promise((resolve,reject)=>window.__g452.requests.push({args,resolve,reject}))},getSavingsInsights:async()=>[],markInsightOpened:async()=>{}};`,
  "@/components/TransactionRow": `export default function TransactionRow({transaction,onClick}){return <button type='button' onClick={onClick}>{transaction.description}</button>}`,
  "@/components/TeachingSheet": `export default function TeachingSheet(){return null}`,
  "@/components/Spinner": `export default function Spinner(){return <span>Loading</span>}`,
  "@/components/TipsLine": `export function TipsLine(){return null}`,
  "@/components/HubAim": `export default function HubAimSection(){return null}`,
  "@/components/PreferencesContext": `export const usePreferences=()=>({showTips:false});`,
  "@/lib/spendTips": `export const insightsForDisplay=x=>x;export const openTipsFor=()=>[];export const tipsForMerchants=()=>[];`,
  "@/lib/accountsCache": `export const getAccountsCached=async()=>[];`,
  "@/components/TransactionFilterChips": `export function FilterChips({filters,onClearAll}){const active=Boolean(filters.category||filters.categories?.length||filters.merchants?.length||filters.from||filters.to||filters.txnType);return active?<button type='button' data-clear-all onClick={onClearAll}>Clear all</button>:null}export function FilterTrigger({onOpen}){return <button type='button' onClick={onOpen}>Open filters</button>}`,
  "@/components/TransactionFilterSheet": `export const draftFromFilters=f=>f;export default function FilterSheet({onApply,onClearAll}){return <div><button type='button' data-apply-filter onClick={()=>onApply({categories:['Bills'],merchant:'',from:null,to:null,txnType:null})}>Apply fixture filter</button><button type='button' onClick={onClearAll}>Clear filter sheet</button></div>}`,
  "@/lib/cacheInvalidation": `export const TRANSACTIONS_CHANGED_EVENT='sorted:transactions-changed';`,
  "@/components/PendingPaymentsGroup": `export default function PendingPaymentsGroup(){return <div>Pending fixture activity</div>}`,
};
await build({stdin:{contents:entry,resolveDir:process.cwd(),loader:'tsx'},bundle:true,outfile:path.join(out,'bundle.js'),jsx:'automatic',define:{'process.env':'{}'},plugins:[{name:'g452-fixtures',setup(build){build.onResolve({filter:/^(next\/navigation|next\/link|@\/)/},args=>stubs[args.path]?{path:args.path,namespace:'g452'}:null);build.onLoad({filter:/.*/,namespace:'g452'},args=>({contents:stubs[args.path],loader:'jsx',resolveDir:process.cwd()}));}}]});
const html='<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div><script src="/bundle.js"></script>';
const server=createServer(async(req,res)=>{if(req.url==='/bundle.js'){res.setHeader('Content-Type','application/javascript');return res.end(await readFile(path.join(out,'bundle.js')))}res.setHeader('Content-Type','text/html');res.end(html)});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const browser=await openBrowser({origin:`http://127.0.0.1:${server.address().port}`,output:evidence});
const result=(label,page=1)=>({items:[{id:label,date:'2026-11-10',description:label,amount:12,transaction_type:'debit'}],total:40,pages:2,page,pending_items:[{id:'pending',date:'2026-11-10',description:'pending row'}],pending_total:1,pending_pages:2});
const resolve=(index,label,page=1)=>browser.evaluate(`window.__g452.requests[${index}].resolve(${JSON.stringify(result(label,page))})`);
try {
  await browser.viewport(390,844);
  await browser.navigate('/transactions?filed_series=opaque-series-a',"window.__g452?.requests.length===1");
  assert.equal(await browser.evaluate("window.__g452.requests[0].args.filed_series"),'opaque-series-a');
  assert.equal(await browser.evaluate("document.body.innerText.includes('opaque-series-a')"),false);
  assert.equal(await browser.evaluate("document.body.innerText.includes('Filed transfer series')"),true);
  await resolve(0,'A first');await browser.waitFor("document.body.innerText.includes('A first')");
  assert.equal(await browser.evaluate("document.body.innerText.includes('Pending fixture activity')"),false);

  // Typing survives debounce, pagination sends the exact scope, and this
  // historical route does not make the otherwise-normal pending page-one call.
  await browser.type("document.querySelector('#transactions-search')",'tea');
  await browser.waitFor("window.__g452.requests.length===2");
  assert.equal(await browser.evaluate("window.__g452.requests[1].args.q"),'tea');
  assert.equal(await browser.evaluate("window.__g452.requests[1].args.filed_series"),'opaque-series-a');
  assert.equal(await browser.evaluate("location.search.includes('filed_series=opaque-series-a')&&location.search.includes('q=tea')"),true);
  await resolve(1,'A search');await browser.waitFor("document.body.innerText.includes('A search')");
  await browser.activate("[...document.querySelectorAll('button')].find(e=>e.textContent.includes('Next'))");
  await browser.waitFor("window.__g452.requests.length===3");
  assert.equal(await browser.evaluate("window.__g452.requests[2].args.filed_series"),'opaque-series-a');
  assert.equal(await browser.evaluate("window.__g452.requests.length"),3,'no pending page-one refresh for filed history');
  await resolve(2,'A page two',2);await browser.waitFor("document.body.innerText.includes('A page two')");

  // A filter edit retains the scope and URL. Leave this request unresolved so
  // the next route proves a stale reply cannot paint over it.
  await browser.activate("[...document.querySelectorAll('button')].find(e=>e.textContent==='Open filters')");
  await browser.activate("document.querySelector('[data-apply-filter]')");
  await browser.waitFor("window.__g452.requests.length===4");
  assert.equal(await browser.evaluate("window.__g452.requests[3].args.filed_series"),'opaque-series-a');
  assert.equal(await browser.evaluate("location.search.includes('category=Bills')&&location.search.includes('filed_series=opaque-series-a')"),true);

  // Same-mounted route replacement and native Back/Forward always derive
  // scope from the new address before effects can issue a global request.
  await browser.evaluate("window.__g452.go('?filed_series=opaque-series-b&q=tea&category=Bills')");
  await browser.waitFor("window.__g452.requests.length===5");
  assert.equal(await browser.evaluate("window.__g452.requests[4].args.filed_series"),'opaque-series-b');
  await resolve(4,'B current');await browser.waitFor("document.body.innerText.includes('B current')");
  await resolve(3,'A stale');await browser.settle();
  assert.equal(await browser.evaluate("document.body.innerText.includes('B current')&&!document.body.innerText.includes('A stale')"),true);
  await browser.evaluate('history.back()');await browser.waitFor("window.__g452.requests.length===6");
  assert.equal(await browser.evaluate("window.__g452.requests[5].args.filed_series"),'opaque-series-a');
  await resolve(5,'A back');await browser.waitFor("document.body.innerText.includes('A back')");
  await browser.evaluate('history.forward()');await browser.waitFor("window.__g452.requests.length===7");
  assert.equal(await browser.evaluate("window.__g452.requests[6].args.filed_series"),'opaque-series-b');
  await resolve(6,'B forward');await browser.waitFor("document.body.innerText.includes('B forward')");

  // Corrections use the same reload path as the visible list and retain the
  // precise history scope instead of widening as they settle authoritatively.
  await browser.evaluate("dispatchEvent(new CustomEvent('sorted:transactions-changed',{detail:{ids:['B forward'],category:'Groceries'}}))");
  await browser.waitFor("window.__g452.requests.length===8");
  assert.equal(await browser.evaluate("window.__g452.requests[7].args.filed_series"),'opaque-series-b');
  await resolve(7,'B corrected');await browser.waitFor("document.body.innerText.includes('B corrected')");

  // Clearing the named chip and clear-all intentionally widen only then.
  await browser.activate("document.querySelector('[aria-label=\"Clear filed transfer series filter\"]')");
  await browser.waitFor("window.__g452.requests.length===9");
  assert.equal(await browser.evaluate("window.__g452.requests[8].args.filed_series===undefined"),true);
  assert.equal(await browser.evaluate("!location.search.includes('filed_series')&&!document.body.innerText.includes('Filed transfer series')"),true);
  await resolve(8,'unscoped');await browser.waitFor("document.body.innerText.includes('unscoped')");

  await browser.evaluate("window.__g452.go('?filed_series=opaque-series-b&q=tea&category=Bills')");await browser.waitFor("window.__g452.requests.length===10");await resolve(9,'B again');await browser.waitFor("document.body.innerText.includes('B again')");
  await browser.activate("document.querySelector('[data-clear-all]')");await browser.waitFor("window.__g452.requests.length===11");
  assert.equal(await browser.evaluate("window.__g452.requests[10].args.filed_series===undefined&&window.__g452.requests[10].args.category===undefined"),true);

  // An explicitly empty scope remains present on the request. The API
  // serialiser is covered by the real api unit path, while this verifies the
  // component does not turn malformed route input into global history.
  await browser.evaluate("window.__g452.go('?filed_series=&q=tea')");await browser.waitFor("window.__g452.requests.length===12");
  assert.equal(await browser.evaluate("window.__g452.requests[11].args.filed_series===''"),true);
  assert.equal(await browser.evaluate("document.body.innerText.includes('Filed transfer series')"),true);
  assert.deepEqual(browser.exceptions,[]);assert.deepEqual(browser.apiRequests,[]);
  await browser.save('result',{passed:true,coverage:['initial scope','debounce','pagination','filter URL','route switch','Back/Forward','stale response','category correction','clear','clear all','empty scope']});
  console.log('G452 transactions series browser checks passed');
} finally { browser.close();await new Promise(resolve=>server.close(resolve)); }
