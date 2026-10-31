// Browser regression for the shipped review component's asynchronous save failures.
// Run after `npm run build`: node scripts/verify-g382-review-decisions.mjs
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {readFile,readdir} from 'node:fs/promises';
import {createServer} from 'node:http';
import {fileURLToPath} from 'node:url';
import {openBrowser} from './_plan-browser.mjs';
const root=fileURLToPath(new URL('..',import.meta.url));
const entry=`import React from 'react';import {createRoot} from 'react-dom/client';import Review from './components/MiscategorisedReviewSheet';import {api} from './lib/api';
const kind=new URLSearchParams(location.search).get('kind');window.attempts=0;window.changed=0;
const save=async()=>{window.attempts++;if(window.attempts===1)throw Error('Unavailable');return{credit_category:'Transfer',debit_category:'Transfer'};};
api.dismissTransferPair=save;api.confirmTransferPair=save;api.dismissMiscategorisedSeries=save;
const leg={amount:25,account_id:'current',category:'Other',date:'2026-10-01',description:'Transfer reference',merchant_name:null};
const pair={pair_key:'credit:debit',date_diff_days:3,credit:{...leg,id:'credit',account_id:'saver'},debit:{...leg,id:'debit'}};
const item={id:'single',ids:['single'],count:1,series_key:'Series',merchant_name:'Series',description:'Transfer',amount:25,amount_min:25,amount_max:25,date:'2026-10-01',first_date:'2026-10-01',currency:'GBP',category:'Other',transaction_type:'debit',account_id:'current'};
createRoot(document.getElementById('root')).render(<Review accounts={[]} initialItems={kind==='series'?[item]:[]} initialPairs={kind==='series'?[]:[pair]} onClose={()=>{}} onRecategorise={()=>{}} onChanged={()=>window.changed++}/>);`;
const result=await build({absWorkingDir:root,stdin:{contents:entry,resolveDir:root,loader:'tsx'},bundle:true,write:false,format:'iife',platform:'browser',jsx:'automatic',define:{'process.env.NODE_ENV':'"production"','process.env':'{}'}});
const files=await readdir(root+'/.next/static/chunks');
const css=(await Promise.all(files.filter(f=>f.endsWith('.css')).map(f=>readFile(root+'/.next/static/chunks/'+f,'utf8')))).join('\n');
const server=createServer((req,res)=>{res.setHeader('Content-Type',req.url==='/app.js'?'application/javascript':req.url==='/app.css'?'text/css':'text/html; charset=utf-8');res.end(req.url==='/app.js'?result.outputFiles[0].text:req.url==='/app.css'?css:'<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/app.css"></head><body><div id="root"></div><script src="/app.js"></script></body></html>');});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const b=await openBrowser({origin:'http://127.0.0.1:'+server.address().port,output:'/tmp/g382-production-evidence'});
try{
for(const [kind,label] of [['confirm','Same transfer'],['pair','Not the same'],['series','Dismiss']]){
 await b.viewport(390,900);await b.navigate('/?kind='+kind,'document.querySelector("[role=dialog]")');
 const selector=`Array.from(document.querySelectorAll('button')).find(e=>e.textContent.trim()===${JSON.stringify(label)})`;
 if(kind==='pair')assert.match(await b.evaluate('document.body.innerText'),/3 days apart/);
 await b.activate(selector);await b.waitFor('document.querySelector("[role=alert]")');
 assert.equal(await b.evaluate('window.changed'),0,'failed save must not announce success');
 assert.equal(await b.evaluate(`${selector}.disabled`),false,'retry stays available');
 await b.shot(kind+'-failure',{full:true});await b.activate(selector);await b.waitFor('window.changed===1');
 assert.equal(await b.evaluate('window.attempts'),2);
 assert.equal(await b.evaluate(`!!(${selector})`),false,'successful save removes row');
}
assert.deepEqual(b.exceptions,[]);console.log('G382: confirm, pair dismissal and series dismissal restore on failure and retry successfully');
}catch(e){console.error(b.exceptions);throw e;}finally{b.close();server.close();}
