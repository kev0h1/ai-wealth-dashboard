// G391 restoration evidence uses production list/header/detail components with synthetic local rows only.
import assert from "node:assert/strict";
import { build } from "esbuild";
import { createServer } from "node:http";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import postcss from "postcss";
import tailwind from "@tailwindcss/postcss";
import { openBrowser } from "./_plan-browser.mjs";

const out = await mkdtemp(path.join(tmpdir(), "g391-directory-"));
const evidence = path.resolve("../.impeccable/review/g391-restore");
await mkdir(evidence, { recursive: true });
const entry = `
import React,{useEffect,useRef,useState} from 'react';
import{createRoot}from'react-dom/client';
import AccountsDirectory from './components/AccountsDirectory';
import AccountsHeader from './components/AccountsHeader';
import AccountAvailabilityDetail from './components/AccountAvailabilityDetail';
import {buildEstate} from './lib/accountsEstate';
const bank=(id,name,type,balance,extra={})=>({id,name,type,balance,currency:'GBP',provider:'Northbridge',status:'connected',...extra});
const accounts=[
 bank('main','Household current account','current',1453), bank('bills','Bills account','current',300),
 bank('long','A deliberately long current account name that must still fit','current',278),
 bank('short','Everyday spending','current',259), bank('other','Personal current account','current',246),
 bank('overdrawn','Joint current account','current',-42),bank('saving','Rainy day savings','savings',700),
 bank('old','Old saver','savings',0),bank('mortgage','Home mortgage','debt',-150000),
 ...Array.from({length:5},(_,i)=>bank('card-'+i,'Credit card '+(i+1),'credit',-(i+1)*90)),
 bank('syncing','Updating saver','savings',125),bank('unknown','New bank account','savings',NaN)
];
const investments=[{id:'isa',provider:'Northbridge',account_type:'Stocks and shares ISA',total_value:3000}];
const manual={id:'offline',name:'Offline cash reserve',provider:'Offline',kind:'Current',balance:70,status:'connected',pinned:false,dormant:false,attention:false,source:'bank',raw:bank('offline','Offline cash reserve','current',70,{manual:true})};
function App(){
 const[q,setQ]=useState(''); const[lens,setLens]=useState('All'); const[dormant,setDormant]=useState(false);
 const[hidden,setHidden]=useState(false);const[pins,setPins]=useState([]);const[collapsed,setCollapsed]=useState({});
 const[selected,setSelected]=useState(null);const triggerId=useRef('');const[menu,setMenu]=useState(false);
 useEffect(()=>{window.setHidden=setHidden;window.setPins=setPins},[]);
 const restore=()=>{setSelected(null);requestAnimationFrame(()=>document.querySelector('[data-account-row-id="'+triggerId.current+'"]').focus())};
 useEffect(()=>{const onKey=e=>{if(e.key==='Escape'&&selected)restore()};addEventListener('keydown',onKey);return()=>removeEventListener('keydown',onKey)},[selected]);
 if(selected)return <main data-detail className='mx-auto max-w-3xl p-4 text-slate-900 dark:text-slate-100'><button data-back className='min-h-11 rounded-lg px-3 focus-visible:ring-2 focus-visible:ring-indigo-500' onClick={restore}>Back to accounts</button><h1>{selected.name}</h1><AccountAvailabilityDetail hidden={hidden} reading={{kind:'ready',value:0,warning:'payments'}} position={{after_payments:-289,after_payments_and_plans:-289,low_point:-289,plans_reserved:0}}/></main>;
 return <main data-ready className='mx-auto max-w-3xl p-4 text-slate-900 dark:text-slate-100'>
  <AccountsHeader directory netWorth={null} hidden={hidden} showChip={hidden} onShow={()=>setHidden(false)} onAdd={()=>setMenu(v=>!v)} addOpen={menu} addRef={{current:null}} onAddClose={()=>setMenu(false)} refresh={{onRefresh:()=>window.refreshes++,disabled:false,busy:false,freshness:'Oldest bank data from 2 hours ago.',message:'Ready to refresh your connected bank data.'}} addMenu={menu?<div role='menu'><button role='menuitem' onClick={()=>window.added='offline'}>Add an offline account</button></div>:null}/>
  <AccountsDirectory estate={buildEstate(accounts,investments,pins)} manualRows={[manual]} hidden={hidden} query={q} onQuery={setQ} lens={lens} onLens={setLens} showDormant={dormant} onShowDormant={setDormant} collapsed={collapsed} onToggleGroup={(key,closed)=>setCollapsed(v=>({...v,[key]:!closed}))} onOpen={(row,trigger)=>{triggerId.current=trigger.dataset.accountRowId;setSelected(row)}} syncFor={row=>row.id==='syncing'?{kind:'refresh',bank:'Northbridge'}:row.id==='unknown'?{kind:'new-bank',bank:'Northbridge'}:undefined} availabilityFor={row=>row.kind==='Current'&&row.id!=='offline'?{kind:'ready',value:row.id==='short'||row.id==='overdrawn'?0:row.id==='main'?10:170,warning:row.id==='short'?'payments':undefined}:undefined} termsFor={row=>row.kind==='Credit'?{termsPill:{label:'0% until December',amber:false},onTermsClick:()=>window.rates++}:{}}/>
 </main>
}
window.refreshes=0;window.added='';window.rates=0;createRoot(document.getElementById('root')).render(<App/>);
`;
await build({ stdin:{contents:entry,resolveDir:process.cwd(),loader:"tsx"}, bundle:true, outfile:path.join(out,"bundle.js"), jsx:"automatic", define:{"process.env":"{}"} });
const css=(await postcss([tailwind({base:process.cwd()})]).process(await readFile("app/globals.css","utf8"),{from:path.resolve("app/globals.css")})).css;
await writeFile(path.join(out,"styles.css"),css);
const html='<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/styles.css"><style>@font-face{font-family:Figtree;src:url(/fonts/Figtree.ttf)}@font-face{font-family:JetBrains;src:url(/fonts/JetBrainsMono.ttf)}:root{--font-figtree:Figtree;--font-jbmono:JetBrains}body{margin:0;background:#f0f2f7}.dark body{background:#0f172a}</style></head><body><div id="root"></div><script src="/bundle.js"></script></body></html>';
const server=createServer(async(req,res)=>{try{const url=req.url??"/";if(url==="/bundle.js"||url==="/styles.css"){res.setHeader("Content-Type",url.endsWith(".css")?"text/css; charset=utf-8":"application/javascript; charset=utf-8");return res.end(await readFile(path.join(out,url.slice(1))));}if(url.startsWith("/fonts/")){res.setHeader("Content-Type","font/ttf");return res.end(await readFile(path.join(process.cwd(),"public/design-media/c22/crafted/fonts",path.basename(url))));}if(url.startsWith("/banks/"))return res.end(await readFile(path.join(process.cwd(),"public",url)));res.setHeader("Content-Type","text/html; charset=utf-8");res.end(html);}catch{res.statusCode=404;res.end("missing");}});
await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
const browser=await openBrowser({origin:`http://127.0.0.1:${server.address().port}`,output:evidence});
const act=async selector=>{await browser.activate(selector, false);await browser.settle();};
try {
 await browser.navigate("/","document.querySelector('[data-ready]')");
 assert.equal(await browser.evaluate("document.fonts.check('14px Figtree') && document.fonts.check('14px JetBrains')"),true);
 for(const theme of ["light","dark"]) for(const width of [320,390,1280]) {
  await browser.viewport(width,844);await browser.evaluate(`document.documentElement.className=${JSON.stringify(theme==='dark'?'dark':'')}`);await browser.settle();
  assert.equal(await browser.evaluate("document.documentElement.scrollWidth>innerWidth"),false,"no page overflow");
  assert.equal(await browser.evaluate("document.querySelector('input[name=account-search]').closest('label').getBoundingClientRect().height>=44"),true,"search keeps its 44px target");
  assert.equal(await browser.evaluate("document.querySelectorAll('[data-g339-availability]').length"),6,"Available visible on eligible current rows");
  assert.equal(await browser.evaluate("document.querySelector('[aria-label=\"Current accounts\"] > button').innerText.includes('£2,494')"),true,"group subtotal reconciles bank balances");
  assert.equal(await browser.evaluate("getComputedStyle(document.querySelector('[aria-label=\"Loans and mortgages accounts\"] > button .money')).whiteSpace"),"nowrap","signed group total stays together at narrow widths");
  await browser.shot(`${theme}-${width}`,{full:true});
 }
 await browser.viewport(390,844);
 await browser.type("document.querySelector('input[name=account-search]')","Offline cash reserve");
 await browser.waitFor("document.querySelectorAll('[data-account-row-id]').length===1 && document.body.innerText.includes('Offline cash reserve')");
 await act("document.querySelector('[aria-label=\"Clear search\"]')");
 assert.equal(await browser.evaluate("document.activeElement?.getAttribute('name')"),"account-search");
 await act("[...document.querySelectorAll('[aria-label=\"Account filters\"] button')].find(e=>e.textContent==='Credit')");
 assert.equal(await browser.evaluate("document.querySelectorAll('[data-account-row-id]').length"),5);
 await act("[...document.querySelectorAll('[aria-label=\"Account filters\"] button')].find(e=>e.textContent==='Owed')");
 assert.equal(await browser.evaluate("document.querySelectorAll('[data-account-row-id]').length"),7);
 await act("[...document.querySelectorAll('[aria-label=\"Account filters\"] button')].find(e=>e.textContent==='All')");
 await act("document.querySelector('[aria-label=\"Credit cards accounts\"] > button')");
 assert.equal(await browser.evaluate("document.querySelector('[aria-label=\"Credit cards accounts\"] > button').getAttribute('aria-expanded')"),"true","first click expands default-collapsed credit group");
 await browser.evaluate("document.querySelector('[aria-label=\"Credit cards accounts\"] [data-account-row-id]').parentElement.querySelector('button[aria-label*=\"edit this card\"]').focus(); true");
 await browser.key('Enter','Enter',13);await browser.settle();
 assert.equal(await browser.evaluate("window.rates===1 && !document.querySelector('[data-detail]')"),true,"rate button keyboard activation never opens the parent row");
 await act("document.querySelector('[aria-label=\"Inactive accounts\"] > button')");
 assert.equal(await browser.evaluate("Boolean(document.querySelector('[data-account-row-id=\"inactive:old\"]').closest('[inert]'))"),false);
 await act("document.querySelector('[aria-label=\"Current accounts\"] > button')");
 assert.equal(await browser.evaluate("Boolean(document.querySelector('[data-account-row-id=\"group:Current:main\"]').closest('[inert]'))"),true);
 await act("document.querySelector('[aria-label=\"Current accounts\"] > button')");
 await browser.evaluate("window.setHidden(true)");await browser.settle();
 assert.equal(await browser.evaluate("document.body.innerText.includes('−£••••') && !document.body.innerText.includes('£2,494') && !document.body.innerText.includes('£1,453')"),true);
 await browser.shot("masked-dark-390",{full:true});await browser.evaluate("window.setHidden(false); window.setPins(['main'])");await browser.settle();
 for(const key of ['pinned:main','group:Current:main']) {
  await act(`document.querySelector('[data-account-row-id="${key}"]')`);
  await browser.waitFor("Boolean(document.querySelector('[data-account-availability-working]'))");
  await act("document.querySelector('summary')");
  assert.equal(await browser.evaluate("document.body.innerText.includes('After scheduled payments')"),true);
  await browser.key('Escape','Escape',27);
  await browser.waitFor(`document.activeElement?.getAttribute('data-account-row-id')===${JSON.stringify(key)}`);
 }
 await browser.shot("pinned-dark-390",{full:true});
 await browser.viewport(320,844);await browser.settle();assert.equal(await browser.evaluate("document.documentElement.scrollWidth>innerWidth"),false,"expanded credit terms fit a narrow phone");await browser.shot("expanded-dark-320",{full:true});
 await browser.viewport(390,844);
 await act("document.querySelector('[aria-label=\"Refresh connected banks\"]')");assert.equal(await browser.evaluate("window.refreshes"),1);
 await act("document.querySelector('[data-add-control]')");await browser.waitFor("Boolean(document.querySelector('[role=menuitem]'))");await act("document.querySelector('[role=menuitem]')");assert.equal(await browser.evaluate("window.added"),"offline");
 assert.equal(await browser.evaluate("document.querySelectorAll('button button, [role=button] button').length"),0,"account openers and rate actions have independent native semantics");
 assert.deepEqual(browser.exceptions,[]);assert.deepEqual(browser.apiRequests,[]);
 await browser.save("result",{passed:true,synthetic:true,widths:[320,390,1280],themes:["light","dark"],checks:["actual restored list/header/detail components","type filters, group bank totals, Available warnings, masked signs, pinned/inactive, collapse, credit rates keyboard, source focus return, refresh/add"]});
 console.log("G391 restoration browser matrix passed");
} finally {browser.close();await new Promise(resolve=>server.close(resolve));}
