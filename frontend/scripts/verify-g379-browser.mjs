// Manual browser integration check. Bundles the production component with an
// in-memory API double; no authenticated route or live API is contacted.
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import postcss from 'postcss';
import tailwind from '@tailwindcss/postcss';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { openBrowser } from './_plan-browser.mjs';
const out = await mkdtemp(path.join(tmpdir(), 'g379-approved-'));
const source = `import React from 'react'; import {createRoot} from 'react-dom/client';
import HomeTransfersCheck from './components/HomeTransfersCheck';
window.requests=[]; window.ready=0; window.reviews=0; window.refreshKey=0; window.enabled=true;
window.render=()=>root.render(<HomeTransfersCheck refreshKey={window.refreshKey} enabled={window.enabled} onReady={()=>window.ready++} onReview={()=>window.reviews++}/>);
const root=createRoot(document.getElementById('root')); window.render();`;
await build({stdin:{contents:source,resolveDir:process.cwd(),loader:'tsx'},bundle:true,write:true,outfile:path.join(out,'bundle.js'),jsx:'automatic',define:{'process.env.NODE_ENV':'"production"'},plugins:[{name:'test-boundaries',setup(b){
 b.onResolve({filter:/^@\/lib\/api$/},()=>({path:'api',namespace:'mock'}));
 b.onResolve({filter:/^@\/lib\/cacheInvalidation$/},()=>({path:'events',namespace:'mock'}));
 b.onLoad({filter:/.*/,namespace:'mock'},a=>({loader:'jsx',resolveDir:process.cwd(),contents:a.path==='api'?`export const api={getMiscategorisedCount:()=>new Promise((resolve,reject)=>window.requests.push({resolve,reject}))};`:`export const TRANSACTIONS_CHANGED_EVENT='sorted:transactions-changed';`}));
}}]});
const css=await postcss([tailwind({base:process.cwd()})]).process(await readFile('app/globals.css','utf8'),{from:path.resolve('app/globals.css')});
await writeFile(path.join(out,'styles.css'),css.css);
const html=`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/styles.css"><main style="max-width:520px;margin:auto;padding:24px 16px"><h1 style="font-size:28px;font-weight:700;margin-bottom:20px">Good morning, Alex</h1><div id="root"></div></main><script src="/bundle.js"></script>`;
const server=createServer(async(req,res)=>{const filename=req.url==='/bundle.js'?'bundle.js':req.url==='/styles.css'?'styles.css':null;res.setHeader('Content-Type',filename?.endsWith('.css')?'text/css':filename?'text/javascript':'text/html');res.end(filename?await readFile(path.join(out,filename)):html);});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const b=await openBrowser({origin:`http://127.0.0.1:${server.address().port}`,output:out});
const wait=async(expr)=>{for(let n=0;n<100;n++){if(await b.evaluate(`!!(${expr})`))return;await new Promise(r=>setTimeout(r,50));}throw Error('Timeout '+expr);};
const text=()=>b.evaluate('document.body.innerText');
try {
 await b.viewport(390,844); await b.navigate('/', 'window.requests?.length===1');
 assert.match(await text(),/Checking for transfers/); assert.doesNotMatch(await text(),/all checked/);
 await b.evaluate('window.requests[0].resolve({review_total:14,count:0,pair_count:0})'); await wait('document.body.innerText.includes("Check your transfers")');
 await b.activate('Array.from(document.querySelectorAll("button")).find(v=>v.textContent.includes("Review transfers"))');
 assert.equal(await b.evaluate('window.reviews'),1);
 for(const width of [320,390,1280])for(const dark of [false,true]) {
   await b.viewport(width,900); await b.evaluate(`document.documentElement.classList.toggle('dark',${dark})`);
   assert.equal(await b.evaluate('document.documentElement.scrollWidth<=innerWidth'),true);
   assert.ok(await b.evaluate('Array.from(document.querySelectorAll("button")).find(v=>v.textContent.includes("Review transfers")).getBoundingClientRect().height>=44'));
   await b.shot(`pending-${width}-${dark?'dark':'light'}`,{full:true});
 }
 await b.evaluate("window.dispatchEvent(new Event('sorted:transactions-changed'))");await wait('window.requests.length===2');
 await b.evaluate("window.dispatchEvent(new Event('sorted:transactions-changed'))");await wait('window.requests.length===3');
 await b.evaluate('window.requests[2].resolve({review_total:0})');await wait('document.querySelector("#root").childElementCount===0');
 await b.evaluate('window.requests[1].resolve({review_total:99})'); assert.equal(await b.evaluate('document.querySelector("#root").childElementCount'),0);
 await b.viewport(390,844);await b.shot('quiet',{full:true});
 await b.evaluate('window.refreshKey++;window.render()');await wait('window.requests.length===4');
 await b.evaluate('window.requests[3].reject(new Error("offline"))');await wait('document.body.innerText.includes("couldn’t be checked")');
 assert.doesNotMatch(await text(),/all checked/); await b.shot('failed',{full:true});
 await b.activate('document.querySelector("button")');await wait('window.requests.length===5');
 await b.evaluate('window.requests[4].resolve({count:0,pair_count:0})');await wait('document.body.innerText.includes("couldn’t be checked")');
 await b.activate('document.querySelector("button")');await wait('window.requests.length===6');
 await b.evaluate('window.requests[5].resolve({review_total:1})');await wait("document.querySelector('[aria-label=\"1 to check\"]')");
 await b.evaluate('Array.from(document.querySelectorAll("button")).find(v=>v.textContent.includes("Review transfers")).focus()');assert.equal(await b.evaluate('document.activeElement.tagName'),'BUTTON');
 await b.shot('retry-single-focus',{full:true});
 await b.evaluate('window.enabled=false;window.render()');await wait('document.querySelector("#root").childElementCount===0');
 assert.equal(b.exceptions.length,0); assert.equal(b.apiRequests.length,0);
 console.log(JSON.stringify({passed:true,evidence:out,checks:'pending/zero/error/malformed/retry/out-of-order/refresh/unconnected/keyboard, 320/390/1280 both themes'}));
} finally {await b.close();await new Promise(r=>server.close(r));}
