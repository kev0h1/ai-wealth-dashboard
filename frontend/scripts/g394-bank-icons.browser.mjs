// Manual G394 browser evidence using real production components and app CSS.
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createServer } from 'node:http';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import postcss from 'postcss';
import tailwind from '@tailwindcss/postcss';
import { openBrowser } from './_plan-browser.mjs';

const out = await mkdtemp(path.join(tmpdir(), 'g394-bank-icons-'));
const evidence = path.resolve('../.impeccable/review/g394');
await mkdir(evidence, {recursive:true});
const entry = `
import React from 'react'; import {createRoot} from 'react-dom/client';
import {BankIcon,BankBadge} from './components/AccountMiniCard';
import {MoveAccountIcon,MoveRoute} from './components/MoveRoute';
import {MerchantIcon} from './components/TransactionRow';
import AccountLedgerRow from './components/AccountLedgerRow';
import SpendFromAccountList from './components/SpendFromAccountList';
const banks=['Barclays','HSBC','NatWest','Monzo','Starling','Revolut','Chase','American Express','Nationwide','Tide'];
const account={id:'n',name:'Everyday',type:'bank',subtype:'current',balance:42,currency:'GBP',provider:'NatWest',provider_id:'natwest',status:'connected'};
const tx=name=>({id:name,account_id:'a',date:'2026-11-02',amount:1,currency:'GBP',description:name,transaction_type:'debit'});
const row={id:'n',name:'Everyday',provider:'NatWest',kind:'Current',balance:42,status:'connected',pinned:false,dormant:false,attention:false,source:'bank',raw:account};
const root=createRoot(document.getElementById('root'));
window.render=(mode='marks')=>root.render(<main data-ready className='p-4 text-slate-900 dark:text-slate-100'>
<h1 className='text-xl font-bold mb-2'>Bank icon verification</h1>
<p className='text-sm mb-4'>Account · Route · Transaction · Spend from</p>
<div className='rounded-xl bg-white dark:bg-slate-800 p-3'>{banks.map(name=><div key={name} data-bank={name} className='grid grid-cols-[minmax(0,1fr)_36px_28px_36px_24px] gap-3 items-center min-h-14 border-b border-slate-200 dark:border-slate-700'><span className='text-sm'>{name}</span><BankIcon identity={{provider:name}}/><MoveAccountIcon account={{provider:name,name:'Account'}}/><MerchantIcon transaction={tx(name)} colour='#64748b'/><BankIcon identity={{provider:name}} size={24}/></div>)}</div>
<h2 className='mt-5 font-semibold'>Actual account row</h2><div className='rounded-xl bg-white dark:bg-slate-800'><AccountLedgerRow row={row}/></div>
<div className='rounded-xl bg-white dark:bg-slate-800 p-3 mt-3'><SpendFromAccountList entries={[{accountId:'n',name:'Everyday',provider:'NatWest',headroom:42,account}]} pool={60} amount={n=>'£'+n} coverMoveVisible={false} kind='bank-rail' onLogoError={()=>{}}/></div>
<h2 className='mt-4 font-semibold'>Unavailable mark</h2><div id='retry' className='mt-2'>{mode==='broken'?<BankBadge logoSrc='/missing.png' initials='NW' altText='' size={28}/>:<BankBadge logoSrc='/banks/natwest.png' initials='NW' altText='' size={28}/>}</div>
<div id='unknown' className='mt-2'><BankIcon identity={{provider:'New Bank'}} size={28}/></div>
</main>);window.render();`;
await build({stdin:{contents:entry,resolveDir:process.cwd(),loader:'tsx'},bundle:true,outfile:path.join(out,'bundle.js'),jsx:'automatic',define:{'process.env':'{}'}});
const css=(await postcss([tailwind({base:process.cwd()})]).process(await readFile('app/globals.css','utf8'),{from:path.resolve('app/globals.css')})).css;
await writeFile(path.join(out,'styles.css'),css);
await writeFile(path.join(out,'index.html'),'<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/styles.css"><style>@font-face{font-family:Figtree;src:url(/fonts/Figtree.ttf)}@font-face{font-family:JetBrains;src:url(/fonts/JetBrainsMono.ttf)}:root{--font-figtree:Figtree;--font-jbmono:JetBrains}body{background:#f0f2f7}.dark body{background:#0f172a}</style></head><body><div id="root"></div><script src="/bundle.js"></script></body></html>');
const server=createServer(async(req,res)=>{
 const url=req.url??'/';
 try {
  if(url==='/bundle.js'||url==='/styles.css'){res.setHeader('Content-Type',url.endsWith('css')?'text/css':'application/javascript');return res.end(await readFile(path.join(out,url.slice(1))));}
  if(url.startsWith('/banks/')){res.setHeader('Content-Type',url.endsWith('.svg')?'image/svg+xml':'image/png');return res.end(await readFile(path.join(process.cwd(),'public',url)));}
  if(url.startsWith('/fonts/'))return res.end(await readFile(path.join(process.cwd(),'public/design-media/c22/crafted/fonts',path.basename(url))));
  if(url!=='/'){res.statusCode=404;return res.end('missing');}
  res.setHeader('Content-Type','text/html');return res.end(await readFile(path.join(out,'index.html')));
 }catch{res.statusCode=404;res.end('missing');}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const browser=await openBrowser({origin:`http://127.0.0.1:${server.address().port}`,output:evidence});
try {
 await browser.viewport(390,844);
 await browser.call('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:2,mobile:true});
 await browser.navigate('/',"document.querySelector('[data-ready]')");
 await browser.waitFor("[...document.images].every(i=>i.complete&&i.naturalWidth>0)");
 assert.equal(await browser.evaluate("document.querySelectorAll('[data-bank] img').length"),40);
 assert.equal(await browser.evaluate("[...document.images].every(i=>new URL(i.src).origin===location.origin)"),true,'no external browser logos');
 assert.equal(await browser.evaluate("document.fonts.check('14px Figtree')"),true);
 for(const theme of ['light','dark']){
  await browser.evaluate(`document.documentElement.className=${JSON.stringify(theme==='dark'?'dark':'')}`);
  assert.equal(await browser.evaluate('document.documentElement.scrollWidth>innerWidth'),false);
  await browser.shot(`banks-${theme}-390-2x`,{full:true});
 }
 await browser.evaluate("window.render('broken')");
 await browser.waitFor("document.querySelector('#retry').textContent==='NW'");
 assert.equal(await browser.evaluate("getComputedStyle(document.querySelector('#retry>div')).backgroundColor"),'rgb(100, 116, 139)');
 assert.equal(await browser.evaluate("getComputedStyle(document.querySelector('#unknown>div')).backgroundColor"),'rgb(100, 116, 139)');
 await browser.shot('fallback-dark',{full:true});
 await browser.evaluate("window.render('marks')");
 await browser.waitFor("document.querySelector('#retry img')?.naturalWidth>0");
 assert.equal(browser.exceptions.length,0,JSON.stringify(browser.exceptions));
 assert.equal(browser.apiRequests.length,0,JSON.stringify(browser.apiRequests));
 await browser.save('result',{passed:true,banks:10,theme:['light','dark'],width:390,dpr:2,checks:['actual shared/move/merchant/ledger/spend components','same-origin local assets','failed source fallback and identity reset','neutral fallback','no monetary or horizontal overflow'],exceptions:browser.exceptions});
 console.log('G394 browser matrix passed; evidence: '+evidence);
}finally{browser.close();await new Promise(resolve=>server.close(resolve));}
