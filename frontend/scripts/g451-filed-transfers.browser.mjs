// G451 is deliberately a real-component browser regression. It uses a local
// API fixture only: no route, auth exemption or production request is added.
import assert from "node:assert/strict";
import { build } from "esbuild";
import { createServer } from "node:http";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import postcss from "postcss";
import tailwind from "@tailwindcss/postcss";
import { openBrowser } from "./_plan-browser.mjs";

const out = await mkdtemp(path.join(tmpdir(), "g451-filed-transfers-"));
const evidence = path.resolve("../.impeccable/review/g451");
await mkdir(evidence, { recursive: true });

const entry = `
import React,{useState}from'react';import{createRoot}from'react-dom/client';
import FiledTransfersSheet from './components/FiledTransfersSheet';
const item={series_key:'sorted:series001',actor:'sorted',kind:'own_transfer',from_account:{id:'current',name:'MONZO CURRENT',bank:'MONZO'},to_account:{id:'pot',name:'SAVING CHALLENGE POT',bank:'MONZO'},description:'SAVING CHALLENGE 09/11/26 0630 RP123',total_amount:822.48,currency:'GBP',count:69,first_date:'2026-01-01',last_date:'2026-11-09',cadence:'Daily',amount_pattern:'Rising £0.04 a day',reason:'Matched the same accounts and normalised transfer description.',can_undo:true,undo_count:69,history_complete:true,all_time_count:69,transactions_href:'/transactions?filed_series=sorted%3Aseries001',occurrences:[{date:'2026-11-09',amount:11.88,currency:'GBP',debit:{id:'d1',account_id:'current',account_name:'Monzo Current',account_bank:'Monzo',date:'2026-11-09',amount:11.88,currency:'GBP',transaction_type:'debit'},credit:{id:'c1',account_id:'pot',account_name:'Saving Challenge Pot',account_bank:'Monzo',date:'2026-11-09',amount:11.88,currency:'GBP',transaction_type:'credit'}}]};
item.occurrences=Array.from({length:69},(_,index)=>{const date=new Date(Date.UTC(2026,10,9-index)).toISOString().slice(0,10),amount=(1188-index*4)/100;const template=item.occurrences[0];return{date,amount,currency:'GBP',debit:{...template.debit,id:'d'+index,date,amount},credit:{...template.credit,id:'c'+index,date,amount}}});item.first_date=item.occurrences.at(-1).date;item.total_amount=Math.round(item.occurrences.reduce((sum,row)=>sum+row.amount,0)*100)/100;
const second={...item,series_key:'user:series002',actor:'user',all_time_count:2,transactions_href:'/transactions?filed_series=user%3Aseries002',from_account:{id:'reserve',name:'MONZO RESERVE',bank:'MONZO'},to_account:{id:'main',name:'MONZO CURRENT',bank:'MONZO'},total_amount:42,count:2,undo_count:2,first_date:'2026-10-01',last_date:'2026-11-01',cadence:'Monthly',amount_pattern:'£21.00 each',occurrences:['2026-11-01','2026-10-01'].map((date,index)=>({date,amount:21,currency:'GBP',debit:{...item.occurrences[0].debit,id:'ud'+index,date,amount:21,account_id:'reserve',account_name:'Monzo Reserve'},credit:{...item.occurrences[0].credit,id:'uc'+index,date,amount:21,account_id:'main',account_name:'Monzo Current'}}))};
const response=(items=[item],source='all',extra={})=>({items,total_series:items.length,page:1,page_size:10,pages:items.length?1:0,scope:null,scope_total:null,scope_currency:null,source,updated_at:'2026-11-10T12:00:00Z',complete:true,status:'ready',...extra});
window.__g451={pushes:[],requests:[],undoCalls:0,finishCalls:0,hidden:location.search.includes('hidden'),request(q){return new Promise((resolve,reject)=>window.__g451.requests.push({q,resolve,reject}))},undo(){window.__g451.undoCalls++;return Promise.resolve({ok:true,undone:69,transaction_ids:['d1','c1'],pending:true})},finish(){window.__g451.finishCalls++;return window.__g451.finishError?Promise.reject(Error('refresh')):Promise.resolve({ok:true,pending:false})},response,item,second};
function App(){const[open,setOpen]=useState(false);return <><button data-open onClick={()=>setOpen(true)}>Open history</button>{open&&<FiledTransfersSheet onClose={()=>setOpen(false)} initialSource='all' period={location.search.includes('period')?{start:'2026-11-01',end:'2026-11-30',label:'1 to 30 November 2026'}:undefined} expectedTotal={location.search.includes('period')?105.48:undefined}/>}</>};createRoot(document.getElementById('root')).render(<App/>);
`;
const stubs = {
  "next/navigation": `export const useRouter=()=>({push:href=>window.__g451.pushes.push(href)});`,
  "@/components/PreferencesContext": `export const usePreferences=()=>({hideNetWorth:window.__g451?.hidden||false,preferencesReady:true});`,
  "@/lib/api": `export const api={getFiledTransfers:q=>window.__g451.request(q),undoFiledTransfer:()=>window.__g451.undo(),finishTransferReview:()=>window.__g451.finish()};`,
  "@/lib/cacheInvalidation": `export const invalidateAfterTransactionCorrection=()=>{};export const notifyTransactionsChanged=()=>{};`,
};
await build({ stdin:{contents:entry,resolveDir:process.cwd(),loader:"tsx"}, bundle:true, loader:{".css":"local-css"}, outfile:path.join(out,"bundle.js"), jsx:"automatic", define:{"process.env":"{}"}, plugins:[{name:"g451-fixtures",setup(build){build.onResolve({filter:/^(next\/navigation|@\/components\/PreferencesContext|@\/lib\/api|@\/lib\/cacheInvalidation)$/},args=>({path:args.path,namespace:"g451"}));build.onLoad({filter:/.*/,namespace:"g451"},args=>({contents:stubs[args.path],loader:"js"}));}}] });
const css = (await postcss([tailwind({base:process.cwd()})]).process(await readFile("app/globals.css","utf8"),{from:path.resolve("app/globals.css")})).css + "\n" + await readFile(path.join(out,"bundle.css"),"utf8");
await writeFile(path.join(out,"styles.css"),css);
const html = '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/styles.css"><style>@font-face{font-family:Figtree;src:url(/fonts/Figtree.ttf)}@font-face{font-family:JetBrains;src:url(/fonts/JetBrainsMono.ttf)}:root{--font-figtree:Figtree;--font-jbmono:JetBrains}body{margin:0;background:#f0f2f7}.dark body{background:#0f172a}</style></head><body><div id="root"></div><script src="/bundle.js"></script></body></html>';
const server=createServer(async(req,res)=>{try{const url=req.url??"/";if(url==="/bundle.js"||url==="/styles.css"){res.setHeader("Content-Type",url.endsWith(".css")?"text/css; charset=utf-8":"application/javascript; charset=utf-8");return res.end(await readFile(path.join(out,url.slice(1))));}if(url.startsWith("/fonts/")){res.setHeader("Content-Type","font/ttf");return res.end(await readFile(path.join(process.cwd(),"public/design-media/c22/crafted/fonts",path.basename(url))));}res.setHeader("Content-Type","text/html; charset=utf-8");res.end(html);}catch{res.statusCode=404;res.end("missing");}});
await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
const button = text => `[...document.querySelectorAll('button')].find(e=>e.textContent.trim()===${JSON.stringify(text)})`;
const resolve = (index, expression) => `window.__g451.requests[${index}].resolve(${expression})`;
const reject = index => `window.__g451.requests[${index}].reject(Error('fixture failure'))`;
const rects = `(()=>{const q=s=>{const r=document.querySelector(s).getBoundingClientRect();return [Math.round(r.y),Math.round(r.height)]};return{header:q('[data-filed-history-header]'),filters:q('[data-filed-filters]'),list:q('[data-filed-list-area]'),pager:q('[data-sheet-footer]'),skeleton:document.querySelector('[data-filed-skeleton] > div')?.getBoundingClientRect().height||0,row:document.querySelector('[data-filed-row] summary')?.getBoundingClientRect().height||0}})()`;
const browser=await openBrowser({origin:`http://127.0.0.1:${server.address().port}`,output:evidence});
try {
  const visit=async(theme='light',width=390,query='')=>{await browser.viewport(width,844);await browser.navigate('/'+query,"Boolean(document.querySelector('[data-open]'))");await browser.evaluate(`document.documentElement.className=${JSON.stringify(theme==='dark'?'dark':'')}`);await browser.activate("document.querySelector('[data-open]')",false);await browser.waitFor("Boolean(document.querySelector('[role=dialog]'))");await browser.settle();};
  // First-load holds the final header/filter/list geometry before evidence arrives.
  await visit();
  assert.equal(await browser.evaluate("document.body.innerText.includes('0 series')"),false);
  const loadingRects=await browser.evaluate(rects); assert.ok(loadingRects.skeleton>0);
  await browser.shot('phone-light-loading');
  await browser.evaluate(resolve(0,"window.__g451.response([window.__g451.item,window.__g451.second],'all',{page:1,pages:2,total_series:11})"));await browser.waitFor("document.querySelectorAll('[data-filed-row]').length===2");
  const readyRects=await browser.evaluate(rects);
  assert.deepEqual({header:loadingRects.header,filters:loadingRects.filters,list:loadingRects.list,pager:loadingRects.pager},{header:readyRects.header,filters:readyRects.filters,list:readyRects.list,pager:readyRects.pager});
  assert.ok(Math.abs(loadingRects.skeleton-readyRects.row)<=2,`skeleton ${loadingRects.skeleton}, row ${readyRects.row}`);
  assert.equal(await browser.evaluate("document.body.innerText.includes('Monzo Current to Saving Challenge Pot')"),true);
  assert.equal(await browser.evaluate("document.body.textContent.includes('69 payments · 2 Sept to 9 Nov')&&document.body.textContent.includes('Rising £0.04 a day')"),true,await browser.evaluate("document.body.innerText"));
  await browser.shot('phone-light-ready');
  // Page fetches are equally quiet: old rows and footer geometry remain until page two wins.
  await browser.activate("document.querySelector('[aria-label=\"Next page\"]')");await browser.waitFor("window.__g451.requests.length===2");
  const pagingRects=await browser.evaluate(rects);assert.deepEqual({list:readyRects.list,pager:readyRects.pager},{list:pagingRects.list,pager:pagingRects.pager});assert.equal(await browser.evaluate("document.body.innerText.includes('69 payments')"),true);
  await browser.evaluate(resolve(1,"window.__g451.response([window.__g451.second],'all',{page:2,pages:2,total_series:11})"));await browser.waitFor("document.body.innerText.includes('Page 2 of 2')");
  await browser.activate("document.querySelector('[aria-label=\"Previous page\"]')");await browser.waitFor("window.__g451.requests.length===3");await browser.evaluate(resolve(2,"window.__g451.response([window.__g451.item,window.__g451.second],'all',{page:1,pages:2,total_series:11})"));await browser.waitFor("document.body.innerText.includes('Page 1 of 2')");
  // Filter retains previous content, selected state stays committed until the reply, and a late reply loses.
  await browser.activate(button('You confirmed'));await browser.waitFor("window.__g451.requests.length===4");
  assert.equal(await browser.evaluate("document.body.innerText.includes('69 payments')&&document.querySelector('[aria-pressed=true]').textContent==='All'"),true);
  await browser.activate(button('Filed by Sorted'));await browser.waitFor("window.__g451.requests.length===5");
  await browser.evaluate(resolve(4,"window.__g451.response([window.__g451.item],'sorted')"));await browser.waitFor("document.querySelector('[aria-pressed=true]').textContent==='Filed by Sorted'");
  await browser.evaluate(resolve(3,"window.__g451.response([window.__g451.second],'user')"));await browser.settle();
  assert.equal(await browser.evaluate("document.querySelector('[aria-pressed=true]').textContent==='Filed by Sorted'&&document.body.innerText.includes('Filed by Sorted')"),true);
  // Failed filter keeps the old ledger and offers recovery.
  await browser.activate(button('You confirmed'));await browser.waitFor("window.__g451.requests.length===6");await browser.evaluate(reject(5));await browser.waitFor("document.body.innerText.includes('Previous results shown.')");
  assert.equal(await browser.evaluate("document.body.innerText.includes('69 payments')"),true);await browser.activate(button('Try again'));await browser.waitFor("window.__g451.requests.length===7");await browser.evaluate(resolve(6,"window.__g451.response([window.__g451.second],'user')"));await browser.waitFor("document.querySelector('[aria-pressed=true]').textContent==='You confirmed'");
  await browser.shot('phone-light-user');
  // Preparing does not fabricate an empty count; stale evidence is visible but destructive Undo is unavailable.
  await browser.activate(button('All'));await browser.waitFor("window.__g451.requests.length===8");await browser.evaluate(resolve(7,"window.__g451.response([],'all',{status:'preparing'})"));await browser.waitFor("document.body.innerText.includes('Preparing series')");assert.equal(await browser.evaluate("document.body.innerText.includes('0 series')"),false);await browser.shot('phone-light-preparing');
  await browser.activate(button('Refresh'));await browser.waitFor("window.__g451.requests.length===9");await browser.evaluate(resolve(8,"window.__g451.response([window.__g451.item],'all',{status:'stale'})"));await browser.waitFor("document.body.innerText.includes('Updating history')");await browser.activate("document.querySelector('[data-filed-row] summary')",false);assert.equal(await browser.evaluate("[...document.querySelectorAll('button')].some(e=>e.textContent.includes('Undo this series')&& !e.disabled)"),false);assert.equal(await browser.evaluate("[...document.querySelectorAll('a')].some(e=>e.textContent==='See recorded transfers in transactions'&&e.getAttribute('href')==='/transactions?filed_series=sorted%3Aseries001')"),true);await browser.shot('phone-light-stale');
  // Exact empty remains distinct from preparing.
  await browser.activate(button('All'));await browser.waitFor("window.__g451.requests.length===10");await browser.evaluate(resolve(9,"window.__g451.response([],'all')"));await browser.waitFor("document.body.innerText.includes('No filed transfers yet')");
  // Reopen and exercise disclosure, Keep filed, Undo then a failed total refresh without a duplicate write.
  await browser.activate(button('Done'));await browser.waitFor("!document.querySelector('[role=dialog]')");await browser.waitFor("document.activeElement?.hasAttribute('data-open')");await browser.activate("document.querySelector('[data-open]')");await browser.waitFor("window.__g451.requests.length===11");await browser.evaluate(resolve(10,"window.__g451.response([window.__g451.item])"));await browser.waitFor("document.querySelector('[data-filed-row]')");
  await browser.evaluate("document.querySelector('[data-filed-row] summary').focus() ");await browser.call('Input.dispatchKeyEvent',{type:'keyDown',key:'Tab',code:'Tab',windowsVirtualKeyCode:9,nativeVirtualKeyCode:9,modifiers:8});await browser.call('Input.dispatchKeyEvent',{type:'keyUp',key:'Tab',code:'Tab',windowsVirtualKeyCode:9,nativeVirtualKeyCode:9,modifiers:8});assert.equal(await browser.evaluate("document.activeElement?.textContent?.trim()==='You confirmed'"),true);await browser.key('Tab','Tab',9);assert.equal(await browser.evaluate("document.activeElement?.matches('[data-filed-row] summary')"),true);await browser.key('Enter','Enter',13);await browser.waitFor("document.querySelector('[data-filed-receipt]')");assert.equal(await browser.evaluate("document.body.innerText.includes('−£11.88')&&!document.body.innerText.includes('+£11.88')&&document.querySelectorAll('[data-filed-transfer]').length===10"),true);await browser.shot('phone-light-receipt');await browser.key('Enter','Enter',13);await browser.waitFor("!document.querySelector('[data-filed-receipt]')");
  await browser.activate("document.querySelector('[data-filed-row] summary')",false);await browser.waitFor("Boolean(document.querySelector('[data-filed-receipt]'))");await browser.activate(button('Undo this series'));await browser.waitFor("document.body.innerText.includes('Undo this series?')");await browser.activate(button('Keep filed'));await browser.waitFor("document.body.innerText.includes('Transfers Sorted filed')");await browser.activate("document.querySelector('[data-filed-row] summary')",false);await browser.waitFor("Boolean(document.querySelector('[data-filed-receipt]'))");await browser.activate(button('Undo this series'));await browser.waitFor("document.body.innerText.includes('Undo this series?')");await browser.evaluate("window.__g451.finishError=true");await browser.activate(button('Undo series'));await browser.waitFor("document.body.innerText.includes('Totals have not refreshed yet')");assert.equal(await browser.evaluate("window.__g451.undoCalls"),1);await browser.activate(button('Refresh totals'));await browser.waitFor("window.__g451.finishCalls===2");assert.equal(await browser.evaluate("window.__g451.undoCalls"),1);
  // Hide balances masks every monetary disclosure while retaining its direction label.
  await browser.evaluate("location.search='?hidden'");await browser.waitFor("window.__g451?.hidden && window.__g451.requests.length===0");await browser.activate("document.querySelector('[data-open]')",false);await browser.waitFor("window.__g451.requests.length===1");await browser.evaluate(resolve(0,"window.__g451.response([window.__g451.item])"));await browser.waitFor("document.querySelector('[data-filed-row]')");await browser.activate("document.querySelector('[data-filed-row] summary')",false);await browser.waitFor("Boolean(document.querySelector('[data-filed-receipt]'))");assert.equal(await browser.evaluate("document.body.innerText.includes('Amount pattern hidden')&&!document.body.innerText.includes('£11.88')&&Boolean(document.querySelector('[aria-label=\"Outgoing amount hidden\"]'))&&document.body.textContent.includes('−£••••')&&!document.body.textContent.includes('+£••••')"),true);await browser.shot('phone-light-hidden');
  await browser.key('Escape','Escape',27);await browser.waitFor("!document.querySelector('[role=dialog]')");assert.equal(await browser.evaluate("document.activeElement?.hasAttribute('data-open')"),true);
  for (const [theme,width] of [["dark",390],["light",1440],["dark",1440]]) { await visit(theme,width);await browser.evaluate(resolve(0,"window.__g451.response([window.__g451.item,window.__g451.second])"));await browser.waitFor("document.querySelectorAll('[data-filed-row]').length===2");assert.equal(await browser.evaluate("document.documentElement.scrollWidth>innerWidth"),false);await browser.shot(`${theme}-${width}`); }
  for(const theme of ['light','dark']) {
    await visit(theme,390,'?period');
    const before=await browser.evaluate(rects);
    await browser.evaluate(resolve(0,"window.__g451.response([{...window.__g451.item,count:9,total_amount:105.48,first_date:'2026-11-01',occurrences:window.__g451.item.occurrences.slice(0,9)}],'all',{scope:{start:'2026-11-01',end:'2026-11-30'},scope_total:105.48,scope_currency:'GBP'})"));
    await browser.waitFor("Boolean(document.querySelector('[data-filed-row]'))");
    const after=await browser.evaluate(rects);
    assert.deepEqual({header:before.header,filters:before.filters,list:before.list,pager:before.pager},{header:after.header,filters:after.filters,list:after.list,pager:after.pager});
    assert.equal(await browser.evaluate("document.body.textContent.includes('9 payments · 1 Nov to 9 Nov')&&document.body.textContent.includes('£105.48')&&!document.body.textContent.includes('different total')"),true);
    await browser.shot('period-'+theme+'-390');
  }
  // G452: the real receipt caps a long legacy payload and keeps exact
  // all-time navigation available when the series cannot be undone.
  const large = `(()=>{const item={...window.__g451.item,series_key:'sorted:large170',count:170,all_time_count:170,total_amount:1470,can_undo:false,undo_count:0,amount_pattern:'Varying amounts',transactions_href:'/transactions?filed_series=sorted%3Alarge170',undo_unavailable_reason:'This filing cannot be safely undone from stored evidence.'};item.occurrences=Array.from({length:170},(_,index)=>{const date=new Date(Date.UTC(2026,10,9-index)).toISOString().slice(0,10),amount=index===0?11.88:index===1?6.60:8.64,base=window.__g451.item.occurrences[0];return{date,amount,currency:'GBP',debit:{...base.debit,id:'large-d'+index,date,amount},credit:{...base.credit,id:'large-c'+index,date,amount}}});item.first_date=item.occurrences.at(-1).date;return item})()`;
  for (const [theme,width,query] of [['light',390,''],['dark',390,''],['light',390,'?hidden'],['dark',390,'?hidden'],['light',1440,''],['dark',1440,''],['light',320,'']]) {
    await visit(theme,width,query);
    await browser.evaluate(resolve(0,`window.__g451.response([${large}])`));
    await browser.waitFor("Boolean(document.querySelector('[data-filed-row]'))");
    await browser.activate("document.querySelector('[data-filed-row] summary')",false);
    await browser.waitFor("document.querySelectorAll('[data-filed-transfer]').length===10");
    assert.equal(await browser.evaluate("document.body.innerText.includes('Showing 10 of 170 transfers, most recent first.')"),true);
    assert.equal(await browser.evaluate("[...document.querySelectorAll('[data-filed-transfer]')].every(row=>row.cells.length===3&&row.cells[1].textContent.includes('to Monzo'))"),true);
    assert.equal(await browser.evaluate("document.querySelectorAll('[data-filed-transfer] time')[0].dateTime"),'2026-11-09');
    assert.equal(await browser.evaluate("document.querySelectorAll('[data-filed-transfer] time')[9].dateTime"),'2026-10-31');
    assert.equal(await browser.evaluate("document.body.innerText.includes('cannot be safely undone')||[...document.querySelectorAll('button')].some(e=>e.textContent.includes('Undo this series'))"),false);
    assert.equal(await browser.evaluate("document.querySelector('[data-filed-receipt]').getBoundingClientRect().right<=innerWidth"),true);
    assert.equal(await browser.evaluate("[...document.querySelectorAll('a')].find(e=>e.textContent==='See all 170 in transactions')?.getAttribute('href')"),'/transactions?filed_series=sorted%3Alarge170');
    assert.equal(await browser.evaluate("/£1,470|£11.88/.test(document.body.innerText)"),!query.includes('hidden'));
    await browser.shot(`g452-${theme}-${width}${query?'-hidden':''}`);
    if(width===390&&!query) {
      await browser.evaluate("[...document.querySelectorAll('a')].find(e=>e.textContent==='See all 170 in transactions').scrollIntoView({block:'center'})");
      await browser.settle();await browser.shot(`g452-link-${theme}-390`);
    }
    if(theme==='light'&&width===390&&!query) {
      await browser.activate("[...document.querySelectorAll('a')].find(e=>e.textContent==='See all 170 in transactions')",false);
      await browser.waitFor("window.__g451.pushes.length===1&&!document.querySelector('[role=dialog]')");
      assert.equal(await browser.evaluate("window.__g451.pushes[0]"),'/transactions?filed_series=sorted%3Alarge170');
    }
  }
  // Incomplete historical receipts keep a qualified exact drill-in too.
  await visit('light',390);
  await browser.evaluate(resolve(0,`window.__g451.response([{...${large},history_complete:false}], 'all', {complete:false})`));
  await browser.waitFor("Boolean(document.querySelector('[data-filed-row]'))");
  await browser.activate("document.querySelector('[data-filed-row] summary')",false);
  await browser.waitFor("document.querySelectorAll('[data-filed-transfer]').length===10");
  assert.equal(await browser.evaluate("document.body.innerText.includes('Some older receipt evidence is unavailable.')"),true);
  await browser.activate("[...document.querySelectorAll('a')].find(e=>e.textContent==='See recorded transfers in transactions')",false);
  await browser.waitFor("window.__g451.pushes.length===1&&!document.querySelector('[role=dialog]')");
  assert.equal(await browser.evaluate("window.__g451.pushes[0]"),'/transactions?filed_series=sorted%3Alarge170');
  assert.deepEqual(browser.exceptions,[]);assert.deepEqual(browser.apiRequests,[]);await browser.save('result',{passed:true,widths:[390,1440],themes:['light','dark'],coverage:['first-load geometry','retained filter/page race','failure recovery','preparing/stale/empty','whole-series undo','privacy','keyboard']});console.log('G451 filed transfers browser checks passed');
} finally { browser.close();await new Promise(resolve=>server.close(resolve)); }
