// G412 variant A evidence: the production CardDetailsSections inside the production SheetFrame (focused),
// next to the same Connection and action rows AccountsPage renders. Synthetic card, no network.
// Run: node scripts/g412-card-sections.browser.mjs   (screenshots land in ../.impeccable/review/g412-foldin)
import assert from "node:assert/strict";
import { build } from "esbuild";
import { createServer } from "node:http";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import postcss from "postcss";
import tailwind from "@tailwindcss/postcss";
import { openBrowser } from "./_plan-browser.mjs";

const out = await mkdtemp(path.join(tmpdir(), "g412-card-"));
const evidence = path.resolve("../.impeccable/review/g412-foldin");
await mkdir(evidence, { recursive: true });
const entry = `
import React from 'react';import{createRoot}from'react-dom/client';
import styles from './components/AccountDetailLayout.module.css';
import CardDetailsSections from './components/CardDetailsSections';import{SheetFrame}from'./components/SheetFrame';
import{BalancesHiddenContext}from'./lib/balancesHidden';
import{Star,Trash2}from'lucide-react';
const params=new URLSearchParams(location.search),dated=params.get('dates')!=='none',hidden=params.get('hidden')==='true';
const bill={statement_start:'2026-09-04',statement_close:'2026-10-03',payment_due:'2026-10-28',next_payment_due:'2026-11-28',estimated_bill:720,payment_amount:720,payment_remaining:720,paid_since_close:0,spending_since_close:200,payment_method:'full',payment_account_id:'pay',status:'estimated',reason:null,estimated:true,next_payday:'2026-10-30',due_before_payday:true};
const terms={status:'confirmed',apr_pct:22.9,promos:[{kind:'purchases',apr_pct:0,until:'2099-05-31'}],bt_offers:[{ends:'2099-08-31',fee_pct:2.5,note:null}],bt_offer_note:null,min_payment_note:null,confirmed_at:null,product_key:null,usage:dated?'clear_monthly':null,
 statement_close_day:dated?3:null,payment_due_day:dated?28:null,payment_due_days_after_close:null,payment_method:dated?'full':null,payment_account_id:dated?'pay':null,fixed_payment_amount:null};
const card={account_id:'c1',name:'Example Rewards Card',provider:'Example Bank',balance:-920,currency:'GBP',source:'finexer',ask_eligible:false,statement_bill:dated?bill:null,terms};
createRoot(document.getElementById('root')).render(<BalancesHiddenContext.Provider value={hidden}><main data-ready>
<SheetFrame title='Account details' description='Credit card · Example Bank' variant='focused' onClose={()=>{}}>{()=><div className='divide-y divide-slate-200 dark:divide-slate-700 [&>*]:py-4 [&>*:first-child]:pt-0 [&>*:last-child]:pb-0'>
<CardDetailsSections card={card} hiddenOverride={hidden} paymentAccounts={[{id:'pay',name:'Example Current'}]} onEditPayment={()=>{}} onEditRates={()=>{}}/>
<div data-g412-section='connection'><h3 className='mb-1 text-base font-bold text-slate-900 dark:text-slate-100'>Connection</h3><p className='mb-2 text-[13px] text-slate-600 dark:text-slate-300'>Connected until 21 January 2027</p><button className='min-h-11 text-[13px] font-semibold'>Refresh bank data</button></div>
<div><button type='button' className={styles.action}>Pin to Home<Star size={15} aria-hidden='true'/></button><button type='button' className={styles.action+' text-rose-700 dark:text-rose-300'}>Remove account<Trash2 size={15} aria-hidden='true'/></button></div>
</div>}</SheetFrame></main></BalancesHiddenContext.Provider>);
`;
await build({ stdin:{contents:entry,resolveDir:process.cwd(),loader:"tsx"}, bundle:true, loader:{".css":"local-css"}, outfile:path.join(out,"bundle.js"), jsx:"automatic", define:{"process.env":"{}"} });
const css=(await postcss([tailwind({base:process.cwd()})]).process(await readFile("app/globals.css","utf8"),{from:path.resolve("app/globals.css")})).css + "\n" + await readFile(path.join(out,"bundle.css"),"utf8");
await writeFile(path.join(out,"styles.css"),css);
const html='<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/styles.css"><style>@font-face{font-family:Figtree;src:url(/fonts/Figtree.ttf)}@font-face{font-family:JetBrains;src:url(/fonts/JetBrainsMono.ttf)}:root{--font-figtree:Figtree;--font-jbmono:JetBrains}body{margin:0;background:#f0f2f7}.dark body{background:#0f172a}</style></head><body><div id="root"></div><script src="/bundle.js"></script></body></html>';
const server=createServer(async(req,res)=>{try{const url=req.url??"/";if(url==="/bundle.js"||url==="/styles.css"){res.setHeader("Content-Type",url.endsWith(".css")?"text/css; charset=utf-8":"application/javascript; charset=utf-8");return res.end(await readFile(path.join(out,url.slice(1))));}if(url.startsWith("/fonts/")){res.setHeader("Content-Type","font/ttf");return res.end(await readFile(path.join(process.cwd(),"public/design-media/c22/crafted/fonts",path.basename(url))));}res.setHeader("Content-Type","text/html; charset=utf-8");res.end(html);}catch{res.statusCode=404;res.end("missing");}});
await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
const browser=await openBrowser({origin:`http://127.0.0.1:${server.address().port}`,output:evidence});
try {
  await browser.viewport(390,844);
  for(const theme of ['light','dark'])for(const dates of ['set','none'])for(const hidden of ['false','true']){
    await browser.navigate(`/?dates=${dates==='set'?'yes':'none'}&hidden=${hidden}`,"document.querySelector('[data-g412-section=payment]')");
    await browser.evaluate(`document.documentElement.className=${JSON.stringify(theme==='dark'?'dark':'')}`);await browser.settle();
    assert.equal(await browser.evaluate('document.documentElement.scrollWidth>innerWidth'),false);
    const text=await browser.evaluate('document.body.innerText');
    const sections=await browser.evaluate("[...document.querySelectorAll('[data-g412-section]')].map(e=>e.dataset.g412Section).join(',')");
    assert.equal(sections,'payment,rates,connection');
    if(hidden==='true')assert.equal(/£\d/.test(await browser.evaluate('document.body.innerHTML')),false,'masked');
    if(dates==='none')assert.equal(/statement dates|Add statement/i.test(text),false,'no nudge');
    await browser.shot(`sheet-${theme}-${dates}-${hidden==='true'?'masked':'shown'}`);
  }
  assert.deepEqual(browser.exceptions,[]);
}finally{browser.close();await new Promise(resolve=>server.close(resolve))}
console.log("g412-card-sections.browser: ok");
