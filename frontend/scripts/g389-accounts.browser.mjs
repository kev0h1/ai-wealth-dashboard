// G389: real HomeBrief, AccountsHeader/AddMenu and refresh hook. Synthetic API.
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {createServer} from 'node:http';
import {mkdtemp, readFile, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import postcss from 'postcss';
import tailwind from '@tailwindcss/postcss';
import {openBrowser} from './_plan-browser.mjs';
const out=await mkdtemp(path.join(tmpdir(),'g389-actual-'));
const entry=`
import React,{useState,useRef,useCallback,StrictMode} from 'react';import {createRoot} from 'react-dom/client';
import AccountsHeader from './components/AccountsHeader';import AccountsAddMenu from './components/AccountsAddMenu';
import HomeBrief from './components/HomeBrief';import {useAccountsOverviewRefresh} from './lib/useAccountsOverviewRefresh';
const bank=(id,at)=>({id,name:'Everyday',type:'bank',balance:120,currency:'GBP',provider:'Northbridge',status:'connected',connection_id:id,bank_synced_to:at});
const old=new Date(Date.now()-7200000).toISOString();window.base=[bank('a',old),bank('b',old)];
function App({state='idle',hidden=false,large=false}){const [accounts,setAccounts]=useState(window.base.map(a=>({...a,...(state==='paused'?{paused:true}:{}),...(state==='cooldown'?{bank_next_refresh_at:new Date(Date.now()+600000).toISOString()}: {})})));const [menu,setMenu]=useState(false);const ref=useRef(null);
const reload=useCallback(async()=>{window.reloads++;setAccounts(window.polled)},[]);const sync=useCallback(async()=>{},[]);
const refresh=useAccountsOverviewRefresh({accounts:state==='empty'?[]:accounts,canConnectBank:state!=='paused',loading:state==='loading',syncStatus:window.syncState??{state:'idle',connections:[]},refreshSyncStatus:sync,reload});
const action=s=>{window.action=s;setMenu(false)};
return <main data-ready className='mx-auto max-w-3xl p-4'>
<section id='home' className='mb-8'><HomeBrief items={[]} firstName='Alex' displayName='Alex Example' safeToSpend={null} loading={true} syncError={false} hasAccounts={false}/></section>
<AccountsHeader netWorth={state==='unavailable'?null:{value:large?-123456789:-13009,accountCount:22}} hidden={hidden} showChip={hidden} onShow={()=>{window.action='show'}} onAdd={()=>setMenu(v=>!v)} addOpen={menu} addRef={ref} onAddClose={()=>setMenu(false)} refresh={{...refresh,onRefresh:()=>void refresh.refresh()}} addMenu={menu?<AccountsAddMenu allowed={state!=='paused'} ready={state!=='loading'} onBank={p=>action(p)} onStatement={()=>action('statement')} onInvestment={()=>action('investment')} onOffline={()=>action('offline')}/>:null}/>
</main>}
let n=0;const root=createRoot(document.getElementById('root'));window.render=(opts={})=>{window.scenario=opts.state??'idle';window.calls=0;window.reloads=0;window.polled=window.base;window.action='';root.render(<StrictMode><App key={++n} {...opts}/></StrictMode>)};window.render();`;
const mocks={
 'next/link':`import React from 'react';export default function Link({children,href,...props}){return <a href={href} {...props}>{children}</a>}`,
 'next/navigation':`export const useRouter=()=>({push(){},replace(){},prefetch(){},refresh(){},back(){}});export const usePathname=()=>'/';export const useSearchParams=()=>new URLSearchParams();`,
 'next/dynamic':`export default ()=>()=>null;`,
 '@/lib/api':`export const providerLogoUrl=()=>undefined;export class ApiError extends Error{constructor(status){super('fixture');this.status=status}};export const api=new Proxy({syncAccounts:async()=>{window.calls++;if(window.scenario==='error')throw new ApiError(500);if(window.scenario==='rate')throw new ApiError(429);if(window.scenario==='server-paused')return{paused:true};return{message:'Synced'}},accounts:async()=>{if(window.scenario==='poll-error')throw Error('fixture read failure');return window.polled}}, {get:(o,k)=>o[k]??(()=>{throw Error('Unexpected fixture API '+k)})});`,
 '@/lib/accountMutations':`export const invalidateAllAccountData=()=>{};`
};
await build({stdin:{contents:entry,resolveDir:process.cwd(),loader:'tsx'},bundle:true,outfile:path.join(out,'bundle.js'),jsx:'automatic',define:{'process.env':'{}'},plugins:[{name:'fixture-boundaries',setup(b){b.onResolve({filter:/^(next\/(link|navigation|dynamic)|@\/lib\/(api|accountMutations))$/},a=>({path:a.path,namespace:'fixture'}));b.onLoad({filter:/.*/,namespace:'fixture'},a=>({contents:mocks[a.path],loader:'tsx',resolveDir:process.cwd()}));}}]});
const css=(await postcss([tailwind({base:process.cwd()})]).process(await readFile('app/globals.css','utf8'),{from:path.resolve('app/globals.css')})).css;
await writeFile(path.join(out,'styles.css'),css);
const html='<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/styles.css"><style>@font-face{font-family:Figtree;src:url(/fonts/Figtree.ttf)}@font-face{font-family:JetBrains;src:url(/fonts/JetBrainsMono.ttf)}:root{--font-figtree:Figtree;--font-jbmono:JetBrains}body{background:#f0f2f7}.dark body{background:#0f172a}</style></head><body><div id="root"></div><script src="/bundle.js"></script></body></html>';
const server=createServer(async(req,res)=>{try{const url=req.url??'/';if(url==='/bundle.js'||url==='/styles.css'){res.setHeader('Content-Type',url.endsWith('css')?'text/css':'application/javascript');return res.end(await readFile(path.join(out,url.slice(1))))}if(url.startsWith('/fonts/'))return res.end(await readFile(path.join(process.cwd(),'public/design-media/c22/crafted/fonts',path.basename(url))));res.setHeader('Content-Type','text/html; charset=utf-8');res.end(html)}catch{res.statusCode=404;res.end('missing')}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const b=await openBrowser({origin:'http://127.0.0.1:'+server.address().port,output:path.resolve('../.impeccable/review/g389-foldin')});
const refresh="document.querySelector('[aria-label=\"Refresh connected banks\"]')", add="document.querySelector('[data-add-control]')";
const render=async opts=>{await b.evaluate('window.render('+JSON.stringify(opts)+')');await b.settle();};
try{
 await b.viewport(390,844);await b.navigate('/',"document.querySelector('[data-ready]')");
 for(const mode of ['light','dark']) for(const width of [320,390,1280]){
  await b.viewport(width,844);await b.evaluate('document.documentElement.className='+JSON.stringify(mode==='dark'?'dark':''));await render({});
  assert.equal(await b.evaluate('document.documentElement.scrollWidth>innerWidth'),false);
  const targets=await b.evaluate(`[...document.querySelectorAll('#home a,header button')].filter(e=>e.getClientRects().length).map(e=>({name:e.getAttribute('aria-label')||e.textContent.trim(),height:e.getBoundingClientRect().height}))`);
  targets.forEach(t=>assert.ok(t.height>=44,t.name));
  assert.equal(await b.evaluate("document.querySelector('#home a[href=\"/accounts\"]')?.textContent.trim()"),'Accounts');
  assert.equal(await b.evaluate("!!document.querySelector('#home button[aria-label*=\"refresh\" i]')"),false);
  await b.shot(mode+'-'+width,{full:true});
 }
 await b.viewport(320,844);await render({hidden:true,large:true});
 assert.equal(await b.evaluate('document.documentElement.scrollWidth>innerWidth'),false);
 assert.equal(await b.evaluate("document.querySelector('header').textContent.includes('−£••••')"),true);
 assert.equal(await b.evaluate("document.querySelector('header').textContent.includes('123,456,789')"),false);await b.shot('masked-negative-320',{full:true});
 await render({large:true});assert.equal(await b.evaluate('document.documentElement.scrollWidth>innerWidth'),false);await b.shot('large-negative-320',{full:true});
 for(const state of ['paused','empty','cooldown','loading']){await render({state});assert.equal(await b.evaluate(refresh+'.disabled'),true,state);assert.equal(await b.evaluate(add+'.disabled'),false);}
 await render({state:'paused'});await b.activate(add);await b.waitFor("document.activeElement.textContent==='Manage subscription'");
 assert.equal(await b.evaluate("document.querySelector('[role=menu] a').getAttribute('href')"),'/settings?plans=1');await b.shot('paused-add-320',{full:true});
 await b.key('Escape','Escape',27);assert.equal(await b.evaluate('document.activeElement.hasAttribute("data-add-control")'),true);
 await render({});await b.activate(add);await b.waitFor("document.activeElement.textContent==='Connect a bank'");await b.key('ArrowDown','ArrowDown',40);await b.key('End','End',35);await b.key('Enter','Enter',13);await b.waitFor("window.action==='offline'");
 await render({});const oldFreshness=await b.evaluate("document.querySelector('[data-bank-freshness]').textContent");await b.activate(refresh);await b.waitFor("document.querySelector('[role=status]').textContent.includes('requested')");assert.equal(await b.evaluate('window.reloads'),0);assert.equal(await b.evaluate("document.querySelector('[data-bank-freshness]').textContent"),oldFreshness);
 await b.evaluate("window.polled=window.base.map((a,i)=>i===0?{...a,bank_synced_to:new Date().toISOString()}:a)");await b.waitFor('window.reloads===1');assert.equal(await b.evaluate(refresh+'.disabled'),true,'partial continues waiting');await b.shot('partial-320',{full:true});
 await b.evaluate("window.polled=window.base.map(a=>({...a,bank_synced_to:new Date().toISOString()}))");await b.waitFor("document.querySelector('[role=status]').textContent.includes('Bank data updated')");assert.ok(await b.evaluate('window.reloads>=2'));
 for(const state of ['error','rate','server-paused','poll-error']){await render({state});await b.activate(refresh);await b.settle();assert.equal(await b.evaluate('window.reloads'),0);assert.equal(await b.evaluate("document.querySelector('[data-bank-freshness]').textContent"),oldFreshness);await b.shot(state+'-320',{full:true});}
 await render({state:'poll-error'});await b.activate(refresh);await b.waitFor("document.querySelector('[role=status]').textContent.includes('requested')");
 await b.evaluate("window.originalNow=Date.now;Date.now=()=>window.originalNow()+121000");await b.waitFor("document.querySelector('[role=status]').textContent.includes('still waiting')");assert.equal(await b.evaluate(refresh+'.disabled'),false);await b.evaluate("Date.now=window.originalNow");
 await render({});await b.evaluate(refresh+".click();"+refresh+".click()");await b.waitFor('window.calls===1');assert.equal(await b.evaluate('window.calls'),1,'same-frame double click only requests once');
 await render({});await b.activate(refresh);await b.waitFor("document.querySelector('[role=status]').textContent.includes('requested')");
 await b.evaluate("window.syncState={state:'failed',connections:[{connection_id:'a',state:'failed',provider:'finexer',error:'sync_failed'}]};window.polled=window.base.map((a,i)=>i===0?{...a,bank_synced_to:new Date().toISOString()}:a)");await b.waitFor("document.querySelector('[role=status]').textContent.includes('could not refresh every bank')");assert.equal(await b.evaluate(refresh+'.disabled'),false);await b.evaluate('window.syncState=null');
 assert.deepEqual(b.exceptions,[]);assert.deepEqual(b.apiRequests,[]);await b.save('result',{passed:true,widths:[320,390,1280],themes:['light','dark'],evidence:'actual production components and hook with synthetic API boundaries',exceptions:b.exceptions});console.log('G389 browser matrix passed');
}finally{b.close();await new Promise(r=>server.close(r));}
