// G407 C evidence uses production summary/forecast/activity/sheet components with synthetic local rows only.
import assert from "node:assert/strict";
import { build } from "esbuild";
import { createServer } from "node:http";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import postcss from "postcss";
import tailwind from "@tailwindcss/postcss";
import { openBrowser } from "./_plan-browser.mjs";

const out = await mkdtemp(path.join(tmpdir(), "g407-detail-"));
const evidence = path.resolve("../.impeccable/review/g407-foldin");
await mkdir(evidence, { recursive: true });
const entry = `
import React,{useState} from 'react';import{createRoot}from'react-dom/client';
import AccountDetailLayout from './components/AccountDetailLayout';import styles from './components/AccountDetailLayout.module.css';
import AccountAvailabilityDetail from './components/AccountAvailabilityDetail';import AccountCountRow from './components/AccountCountRow';import AccountRefreshRow from './components/AccountRefreshRow';
import{AccountTransactionsToolbar}from'./components/AccountDetailParts';import SegmentedControl from './components/SegmentedControl';import{TransactionRowContent}from'./components/TransactionRow';import{SheetFrame}from'./components/SheetFrame';import{BalancesHiddenContext}from'./lib/balancesHidden';import{accountAvailability}from'./lib/accountAvailability';import MoneyText from './components/MoneyText';
const params=new URLSearchParams(location.search),state=params.get('state')||'plans',hidden=params.get('hidden')==='true';
const base={id:'fixture-account',name:state==='long'?'Joint household bills and everyday spending account':'Everyday account',provider:'Monzo',provider_id:'monzo',type:'bank',subtype:'CURRENT',currency:'GBP',status:'connected',balance:state==='payments'?-43.29:233.98,include_in_safe_to_spend:state!=='excluded',connection_id:'fixture',bank_synced_to:'2026-11-02T18:00:00Z'};
const gap=state==='plans'?-10.01:state==='payments'?-289.32:103.98;
const position={after_payments:state==='payments'?-289.32:183.98,plans_reserved:state==='plans'?193.99:80,after_payments_and_plans:gap,low_point:state==='payments'?-289.32:183.98,low_point_and_plans:gap,spend_from_headroom:Math.max(0,gap)};
const txs=state==='empty'?[]:[['coffee','Corner coffee',4.85,'Eating out'],['groceries','Neighbourhood groceries',23.41,'Groceries'],['transport','City travel',7.20,'Transport']].map(([id,description,amount,category])=>({id,account_id:base.id,description,merchant_name:description,amount,category,type:'debit',date:'2026-11-02',currency:'GBP',is_pending:false}));
const amount=value=>(value<0?'−':'')+'£'+(hidden?'••••':Math.abs(value).toLocaleString('en-GB',{minimumFractionDigits:2,maximumFractionDigits:2}));
function App(){const[account,setAccount]=useState(base),[details,setDetails]=useState(false),[tab,setTab]=useState('Transactions'),[query,setQuery]=useState(''),[pinned,setPinned]=useState(false),[confirm,setConfirm]=useState(false),[reason,setReason]=useState(null),[transaction,setTransaction]=useState(null);
 const snapshot=state==='checking'?{status:'loading'}:state==='unavailable'?{status:'failed'}:{status:'ready',positions:{[base.id]:position}};
 const reading=accountAvailability(account,snapshot);const locked=reading?.kind==='ready'&&reading.warning;
 const rows=txs.filter(tx=>tx.description.toLowerCase().includes(query.toLowerCase()));
 const forecast=!account.include_in_safe_to_spend?<button data-excluded className='min-h-11 text-left text-[13px]' onClick={()=>setDetails(true)}>Excluded from estimated left to spend</button>:<AccountAvailabilityDetail reading={reading} position={position} hidden={hidden} layout='calm'/>;
 return <BalancesHiddenContext.Provider value={hidden}><main data-ready className='mx-auto max-w-5xl p-4 text-slate-900 dark:text-slate-100'><button className='mb-4 min-h-11 text-sm'>‹ Accounts</button>
 <AccountDetailLayout account={account} accountName={account.name} providerLabel='Monzo' onDetails={()=>setDetails(true)} balance={<MoneyText text={amount(account.balance)}/>} forecast={forecast} activity={<section data-g407-activity aria-label='Account activity' className={styles.activity}>
 <div className={styles.activityHeader}><SegmentedControl className={styles.activityTabs} options={['Transactions','Categories']} value={tab} onChange={setTab} ariaLabel='Account view'/></div>
 {tab==='Transactions'?<><div className={styles.search}><AccountTransactionsToolbar searchQuery={query} onSearchChange={setQuery} onClearSearch={()=>setQuery('')}/></div><div className={styles.rows}>{rows.length?rows.map(tx=><TransactionRowContent key={tx.id} transaction={tx} hidden={hidden} onClick={()=>setTransaction(tx)}/>):<p className='p-8 text-center text-sm'>{query?'No matching transactions':'No transactions yet'}</p>}</div></>:<div className={styles.rows}>{txs.map(tx=><button key={tx.id} className='flex min-h-16 w-full items-center justify-between px-4 text-sm' onClick={()=>{setQuery(tx.description);setTab('Transactions')}}><span>{tx.category}</span><MoneyText text={amount(tx.amount)}/></button>)}</div>}
 </section>}/></main>
 {details&&<SheetFrame title='Account details' description='Current · Monzo' variant='compact' onClose={()=>setDetails(false)}>{({closeThen})=><div className='space-y-5'>
 <AccountCountRow account={account} counted={account.include_in_safe_to_spend} reason={reason} calm compact lockedReason={locked?'Included while this account is short '+(locked==='payments'?'for payments':'after plans')+'.':undefined} onChange={next=>{if(state==='refused'){setReason('This account pays upcoming items this period, so it has to count');return}setReason(null);setAccount(v=>({...v,include_in_safe_to_spend:next}))}}/>
 <div className='border-t border-slate-200 pt-3 dark:border-slate-700'><p className='mb-2 text-[13px]'>Reconfirm by 21 November 2026</p><AccountRefreshRow account={account} now={Date.parse('2026-11-02T20:00:00Z')} compact onRefresh={async()=>{window.refreshes++;return{refreshed:false,message:'Synthetic check. No bank refresh was requested.'}}}/></div>
 <div className='border-t border-slate-200 pt-3 dark:border-slate-700'><button className={styles.action} onClick={()=>setPinned(!pinned)}>{pinned?'Unpin from Home':'Pin to Home'}</button><button className={styles.action+' text-rose-700 dark:text-rose-300'} onClick={()=>closeThen(()=>setConfirm(true))}>Remove account</button></div>
 </div>}</SheetFrame>}
 {confirm&&<SheetFrame title='Remove this account?' variant='compact' onClose={()=>setConfirm(false)}><button className='min-h-11' onClick={()=>setConfirm(false)}>Cancel</button></SheetFrame>}
 {transaction&&<SheetFrame title={transaction.description} variant='compact' onClose={()=>setTransaction(null)}><MoneyText text={amount(-transaction.amount)}/></SheetFrame>}
 </BalancesHiddenContext.Provider>;
}
window.refreshes=0;createRoot(document.getElementById('root')).render(<App/>);
`;
await build({ stdin:{contents:entry,resolveDir:process.cwd(),loader:"tsx"}, bundle:true, loader:{".css":"local-css"}, outfile:path.join(out,"bundle.js"), jsx:"automatic", define:{"process.env":"{}"} });
const css=(await postcss([tailwind({base:process.cwd()})]).process(await readFile("app/globals.css","utf8"),{from:path.resolve("app/globals.css")})).css + "\n" + await readFile(path.join(out,"bundle.css"),"utf8");
await writeFile(path.join(out,"styles.css"),css);
const html='<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/styles.css"><style>@font-face{font-family:Figtree;src:url(/fonts/Figtree.ttf)}@font-face{font-family:JetBrains;src:url(/fonts/JetBrainsMono.ttf)}:root{--font-figtree:Figtree;--font-jbmono:JetBrains}body{margin:0;background:#f0f2f7}.dark body{background:#0f172a}</style></head><body><div id="root"></div><script src="/bundle.js"></script></body></html>';
const server=createServer(async(req,res)=>{try{const url=req.url??"/";if(url==="/bundle.js"||url==="/styles.css"){res.setHeader("Content-Type",url.endsWith(".css")?"text/css; charset=utf-8":"application/javascript; charset=utf-8");return res.end(await readFile(path.join(out,url.slice(1))));}if(url.startsWith("/fonts/")){res.setHeader("Content-Type","font/ttf");return res.end(await readFile(path.join(process.cwd(),"public/design-media/c22/crafted/fonts",path.basename(url))));}if(url.startsWith("/banks/"))return res.end(await readFile(path.join(process.cwd(),"public",url)));res.setHeader("Content-Type","text/html; charset=utf-8");res.end(html);}catch{res.statusCode=404;res.end("missing");}});
await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
const browser=await openBrowser({origin:`http://127.0.0.1:${server.address().port}`,output:evidence});
try {
 const visit=async(params='')=>browser.navigate('/?'+params,"document.querySelector('[data-ready]')");
 const act=async(selector)=>{await browser.activate(selector,false);await browser.settle()};
 for(const theme of ['light','dark'])for(const width of [320,390,1280]){
  await browser.viewport(width,844);await visit();await browser.evaluate(`document.documentElement.className=${JSON.stringify(theme==='dark'?'dark':'')}`);await browser.settle();
  assert.equal(await browser.evaluate('document.documentElement.scrollWidth>innerWidth'),false);
  assert.equal(await browser.evaluate("getComputedStyle(document.querySelector('[data-g407-activity]')).borderTopWidth"),'1px');
  assert.equal(await browser.evaluate("document.body.innerText.includes('£10.01 short after plans')"),true);
  await browser.shot(`${theme}-${width}`,{full:true});
  await act("document.querySelector('[aria-label=\"Account details\"]')");await browser.waitFor("Boolean(document.querySelector('[role=dialog]'))");
  assert.equal(await browser.evaluate("document.querySelector('[role=switch]').disabled"),true);
  assert.equal(await browser.evaluate("document.querySelector('[role=switch]').getBoundingClientRect().height>=44"),true);
  if(width===390)await browser.shot(`sheet-${theme}-${width}`);
  await browser.key('Escape','Escape',27);await browser.waitFor("!document.querySelector('[role=dialog]')");await browser.waitFor("document.activeElement?.getAttribute('aria-label')==='Account details'");
 }
 await browser.viewport(390,844);
 for(const state of ['payments','available','excluded','checking','unavailable','empty','long']){
  await visit('state='+state);await browser.evaluate("document.documentElement.className='dark'");await browser.settle();
  assert.equal(await browser.evaluate('document.documentElement.scrollWidth>innerWidth'),false);
  await browser.shot('state-'+state,{full:true});
 }
 await visit('hidden=true&state=payments');await act("document.querySelector('summary')");
 assert.equal(await browser.evaluate("document.body.textContent.includes('−£••••') && !/£(?:43\\.29|289\\.32|4\\.85|23\\.41)/.test(document.body.innerHTML)"),true,'hidden DOM and opened evidence keep masks and signs');await browser.shot('hidden-working',{full:true});
 await visit('state=available');await act("document.querySelector('[aria-label=\"Account details\"]')");await browser.waitFor("Boolean(document.querySelector('[role=switch]'))");
 await browser.activate("document.querySelector('[role=switch]')",true);await browser.waitFor("document.querySelector('[role=switch]').getAttribute('aria-checked')==='false'");
 await browser.evaluate("document.querySelector('[role=switch]').focus();true");await browser.key(' ','Space',32);await browser.waitFor("document.querySelector('[role=switch]').getAttribute('aria-checked')==='true'");
 await act("document.querySelector('[data-a179-refresh-button]')");assert.equal(await browser.evaluate('window.refreshes'),1);assert.equal(await browser.evaluate("document.querySelector('[data-a179-asof]').textContent.includes('2 hours ago')"),true);
 await act("[...document.querySelectorAll('button')].find(e=>e.textContent==='Remove account')");await browser.waitFor("document.querySelector('[role=dialog]')?.textContent.includes('Remove this account?')");assert.equal(await browser.evaluate("document.querySelectorAll('[role=dialog]').length"),1,'closeThen replaces rather than stacks task sheets');await act("[...document.querySelectorAll('button')].find(e=>e.textContent==='Cancel')");await browser.waitFor("!document.querySelector('[role=dialog]')");
 await browser.type("document.querySelector('[name=transaction-search]')",'Corner');await browser.waitFor("!document.body.innerText.includes('Neighbourhood groceries')");await act("document.querySelector('[aria-label=\"Clear search\"]')");assert.equal(await browser.evaluate("document.activeElement?.getAttribute('name')"),'transaction-search');
 await browser.evaluate("document.querySelector('[role=tab]').focus();true");await browser.key('ArrowRight','ArrowRight',39);await browser.waitFor("document.querySelector('[aria-selected=true]').textContent==='Categories'");
 await visit('state=refused');await act("document.querySelector('[aria-label=\"Account details\"]')");await act("document.querySelector('[role=switch]')");await browser.waitFor("document.querySelector('[role=alert]')?.textContent.includes('upcoming items')");assert.equal(await browser.evaluate("document.querySelector('[role=switch]').getAttribute('aria-checked')"),'true');
 assert.deepEqual(browser.exceptions,[]);assert.deepEqual(browser.apiRequests,[]);await browser.save('result',{passed:true,componentFixtures:true,widths:[320,390,1280],themes:['light','dark'],states:['plans','payments','available','excluded','checking','unavailable','empty','long','hidden','refused']});console.log('G407 C production component browser checks passed');
}finally{browser.close();await new Promise(resolve=>server.close(resolve))}
