// G392: run TransactionsPage in a real browser with native history and
// deliberately out-of-order search responses.
import assert from "node:assert/strict";
import { build } from "esbuild";
import { createServer } from "node:http";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { openBrowser } from "./_plan-browser.mjs";

const out = await mkdtemp(path.join(tmpdir(), "g392-navigation-"));
const entry = `import React from'react';import{createRoot}from'react-dom/client';import TransactionsPage from './app/transactions/TransactionsPage';
window.route='q=direct&page=3&category=Food';window.requests=[];Object.defineProperty(window,'bookedRequests',{get:()=>window.requests.filter(r=>!r.args.pending_page)});window.listeners=new Set();window.notify=()=>window.listeners.forEach(f=>f());history.replaceState(null,'','/?'+window.route);const replace=history.replaceState.bind(history);history.replaceState=(state,title,url)=>{replace(state,title,url);window.route=location.search.slice(1);window.notify()};window.addEventListener('popstate',()=>{window.route=location.search.slice(1);window.notify()});window.pushRoute=query=>{history.pushState(null,'','/?'+query);window.route=query;window.notify()};
const root=createRoot(document.getElementById('root'));root.render(<TransactionsPage/>);`;
const mock = (pathName) => {
  if (pathName === "next/navigation") return `import{useMemo,useSyncExternalStore}from'react';export const useSearchParams=()=>{const route=useSyncExternalStore(f=>{window.listeners.add(f);return()=>window.listeners.delete(f)},()=>window.route);return useMemo(()=>new URLSearchParams(route),[route])};`;
  if (pathName === "next/link") return `export default function Link(p){return <a {...p}/>}`;
  if (pathName === "@/lib/api") return `export const api={transactionsSearch:args=>new Promise(resolve=>window.requests.push({args,resolve})),getSavingsInsights:async()=>[]};`;
  if (pathName === "@/components/PreferencesContext") return `export const usePreferences=()=>({showTips:false});`;
  if (pathName === "@/components/TransactionRow") return `export default function Row({transaction}){return <div data-row={transaction.description}>{transaction.description}</div>}`;
  if (pathName === "@/components/TipsLine") return `export const TipsLine=()=>null;`;
  if (pathName === "@/components/PendingPaymentsGroup") return `export default function Group({items,total,onLoadMore,error}){return items.length?<section aria-label="Pending payments"><p>{total} pending</p>{items.map(item=><div key={item.id} data-pending-row={item.id}>{item.description}</div>)}{onLoadMore&&<button onClick={onLoadMore}>{error?'Try pending again':'Show more pending payments'}</button>}</section>:null}`;
  if (pathName === "@/components/TeachingSheet" || pathName === "@/components/Spinner" || pathName === "@/components/HubAim") return `export default function Stub(){return null}`;
  if (pathName === "@/components/TransactionFilterChips") return `export const FilterChips=()=>null;export const FilterTrigger=({onOpen})=><button onClick={onOpen}>Filter</button>;`;
  if (pathName === "@/components/TransactionFilterSheet") return `export const draftFromFilters=x=>x;export default function Sheet({onApply}){return <button onClick={()=>onApply({categories:['Bills'],merchant:'',from:null,to:null,txnType:null})}>Apply filter</button>}`;
  if (pathName === "@/lib/accountsCache") return `export const getAccountsCached=async()=>[];`;
  if (pathName === "@/lib/spendTips") return `export const insightsForDisplay=()=>[];export const openTipsFor=()=>[];export const tipsForMerchants=()=>[];`;
  if (pathName === "@/lib/transactionGrouping") return `export const groupByDay=items=>items.length?[{key:'today',heading:'Today',rows:items}]:[];`;
  if (pathName === "@/lib/transactionsListUpdate") return `export const applyCategoryChange=(items,total)=>({items,total});`;
  if (pathName === "@/lib/cacheInvalidation") return `export const TRANSACTIONS_CHANGED_EVENT='changed';`;
  if (pathName === "@/lib/transactionActivity") return `export const transactionActivityDate=x=>x.date;`;
  return null;
};
await build({stdin:{contents:entry,resolveDir:process.cwd(),loader:'tsx'},bundle:true,outfile:path.join(out,'bundle.js'),jsx:'automatic',define:{'process.env':'{}'},plugins:[{name:'g392-mocks',setup(b){b.onResolve({filter:/^(next\/navigation|next\/link|@\/)/},a=>mock(a.path)?{path:a.path,namespace:'g392'}:undefined);b.onLoad({filter:/.*/,namespace:'g392'},a=>({loader:'tsx',contents:mock(a.path),resolveDir:process.cwd()}));}}]});
await writeFile(path.join(out,'index.html'),'<div id="root"></div><script src="/bundle.js"></script>');
const server=createServer(async(req,res)=>res.end(await readFile(path.join(out,req.url==='/bundle.js'?'bundle.js':'index.html'))));
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const browser=await openBrowser({origin:`http://127.0.0.1:${server.address().port}`,output:out});
const wait = browser.waitFor;
const response=(description)=>({items:[{id:description,description,date:'2026-11-01',amount:1,currency:'GBP',account_id:'a',transaction_type:'debit'}],pages:4,total:61,pending_items:[],pending_total:0});
try {
  await browser.navigate("/", "document.querySelector('#transactions-search')");
  await wait(`document.querySelector('#transactions-search')?.value==='direct'`);
  await wait(`window.bookedRequests.length===1`);
  assert.deepEqual(await browser.evaluate(`window.bookedRequests[0].args`), {q:'direct',category:'Food',page:3,page_size:20,activity_order:true}, 'a cold page-three deep link fetches its exact query and filters');
  assert.equal(await browser.evaluate('window.requests.length'),1,'later pages make no pending first-page request');
  await new Promise(r=>setTimeout(r,350));
  assert.equal(await browser.evaluate(`window.bookedRequests[0].args.page`),3,'the initial draft commit does not reset a deep-linked page');

  // Type rapidly, including a trailing space. The local history write is
  // synchronous and must never rewrite the raw input draft.
  await browser.type(`document.querySelector('#transactions-search')`, 'coffee');
  await new Promise(r=>setTimeout(r,320));
  await browser.type(`document.querySelector('#transactions-search')`, 'coffee shop ');
  await new Promise(r=>setTimeout(r,320));
  assert.equal(await browser.evaluate(`document.querySelector('#transactions-search').value`),'coffee shop ','the draft keeps its trailing space while URL state is trimmed');
  assert.equal(await browser.evaluate(`location.search`),'?category=Food&q=coffee+shop','the committed query is written to native history without its draft-only trailing space');

  await wait(`window.bookedRequests.length>=2`);
  const last=await browser.evaluate(`window.bookedRequests.length-1`);
  await browser.evaluate(`window.bookedRequests[${last}].resolve(${JSON.stringify(response('new result'))})`);
  await browser.evaluate(`window.bookedRequests[0].resolve(${JSON.stringify(response('old result'))})`);
  await wait(`document.querySelector('[data-row="new result"]')`);
  assert.equal(await browser.evaluate(`!!document.querySelector('[data-row="old result"]')`),false,'an old response cannot replace newer search results');

  await browser.activate(`Array.from(document.querySelectorAll('button')).find(x=>x.textContent==='Filter')`);
  await browser.activate(`Array.from(document.querySelectorAll('button')).find(x=>x.textContent==='Apply filter')`);
  await wait(`location.search.includes('category=Bills')`);
  assert.equal(await browser.evaluate(`location.search.includes('page=')`),false,'a changed filter resets pagination once');

  await browser.evaluate(`window.pushRoute('q=direct&page=3&category=Food')`);
  await wait(`document.querySelector('#transactions-search').value==='direct'`);
  await wait(`window.bookedRequests.at(-1).args.page===3`);
  // A real history navigation cancels an uncommitted draft.
  await browser.type(`document.querySelector('#transactions-search')`, 'draft to abandon');
  await browser.evaluate(`window.pushRoute('q=history&page=3&category=Food')`);
  await wait(`document.querySelector('#transactions-search').value==='history'`);
  await new Promise(r=>setTimeout(r,350));
  assert.equal(await browser.evaluate(`document.querySelector('#transactions-search').value`),'history','external history navigation cancels the draft timer');
  assert.equal(await browser.evaluate(`window.bookedRequests.at(-1).args.page`),3,'external history preserves page three');

  await browser.evaluate(`window.pushRoute('q=forward&page=3&category=Food')`);
  await wait(`document.querySelector('#transactions-search').value==='forward'`);
  await browser.evaluate('history.back()');
  await wait(`document.querySelector('#transactions-search').value==='history'`);
  await browser.evaluate(`history.forward()`);
  await wait(`document.querySelector('#transactions-search').value==='forward'`);

  await browser.activate(`document.querySelector('[aria-label="Clear search"]')`);
  assert.equal(await browser.evaluate(`document.activeElement?.id`),'transactions-search','clearing search restores focus');


  // G454: pending belongs to page one. Late load-more replies must stay
  // hidden when the person has already moved to another booked page.
  const resolveRequest = (index, payload) => browser.evaluate(
    `window.requests[${index}].resolve(${JSON.stringify(payload)})`,
  );
  await browser.evaluate(`window.pushRoute('q=coffee')`);
  await wait(`window.requests.at(-1).args.q==='coffee'&&window.requests.at(-1).args.page===1`);
  const firstIndex = await browser.evaluate('window.requests.length-1');
  const firstResponse = {
    ...response('booked first'),
    pending_items: [{ id: 'pending-first', description: 'Coffee authorisation' }],
    pending_total: 2,
    pending_page: 1,
    pending_pages: 2,
  };
  await resolveRequest(firstIndex, firstResponse);
  await wait(`document.querySelector('[data-pending-row="pending-first"]')`);
  await browser.activate(`Array.from(document.querySelectorAll('button')).find(x=>x.textContent==='Show more pending payments')`);
  await wait(`window.requests.length===${firstIndex + 2}`);
  const moreIndex = firstIndex + 1;
  assert.equal(await browser.evaluate(`window.requests[${moreIndex}].args.pending_page`), 2);

  await browser.activate(`Array.from(document.querySelectorAll('button')).find(x=>x.textContent.includes('Next'))`);
  await wait(`window.requests.length===${moreIndex + 2}`);
  const secondIndex = moreIndex + 1;
  assert.equal(await browser.evaluate(`window.requests[${secondIndex}].args.page`), 2);
  await resolveRequest(secondIndex, {
    ...response('booked second'),
    pending_items: [{ id: 'bad-page-two', description: 'Should stay hidden' }],
  });
  await wait(`document.querySelector('[data-row="booked second"]')`);
  await resolveRequest(moreIndex, {
    ...firstResponse,
    pending_items: [{ id: 'stale-pending', description: 'Obsolete pending response' }],
    pending_page: 2,
  });
  await browser.settle();
  assert.equal(await browser.evaluate(`!!document.querySelector('[aria-label="Pending payments"]')`), false,
    'pending stays absent on page two after late and malformed responses');
  assert.equal(await browser.evaluate('window.requests.length'), secondIndex + 1,
    'next page makes one booked request');

  await browser.activate(`Array.from(document.querySelectorAll('button')).find(x=>x.textContent.includes('Prev'))`);
  await wait(`window.requests.length===${secondIndex + 2}`);
  const backIndex = secondIndex + 1;
  await resolveRequest(backIndex, firstResponse);
  await wait(`document.querySelector('[data-pending-row="pending-first"]')`);
  await browser.activate(`Array.from(document.querySelectorAll('button')).find(x=>x.textContent==='Show more pending payments')`);
  await wait(`window.requests.length===${backIndex + 2}`);
  await resolveRequest(backIndex + 1, {
    ...firstResponse,
    pending_items: [firstResponse.pending_items[0], { id: 'pending-second', description: 'Coffee second authorisation' }],
    pending_page: 2,
  });
  await wait(`document.querySelectorAll('[data-pending-row]').length===2`);
  assert.equal(await browser.evaluate(`document.querySelectorAll('[data-row="booked first"]').length`), 1,
    'pending paging does not append or change booked rows');
  assert.equal(await browser.evaluate(`document.querySelectorAll('[data-pending-row="pending-first"]').length`), 1,
    'pending paging deduplicates exact IDs');

  await browser.type(`document.querySelector('#transactions-search')`, 'no match');
  await wait(`!document.querySelector('[aria-label="Pending payments"]')`);
  await wait(`window.requests.at(-1).args.q==='no match'`);
  const emptyIndex = await browser.evaluate('window.requests.length-1');
  await resolveRequest(emptyIndex, { ...response('unused'), items: [], total: 0, pages: 1 });
  await wait(`document.body.textContent.includes('No payments matching')`);
  assert.equal(await browser.evaluate(`!!document.querySelector('[aria-label="Pending payments"]')`), false,
    'empty filtered pages do not retain the old pending group');
  assert.equal(browser.exceptions.length, 0);
  console.log('G392 transaction navigation browser regression passed');
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
