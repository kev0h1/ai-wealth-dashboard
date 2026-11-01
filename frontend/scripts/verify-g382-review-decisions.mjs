// Real production components, synthetic API only. Run after npm run build.
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {readFile,readdir} from 'node:fs/promises';
import {createServer} from 'node:http';
import {fileURLToPath} from 'node:url';
import {openBrowser} from './_plan-browser.mjs';
const root=fileURLToPath(new URL('..',import.meta.url));
const entry=`import React from 'react';import {createRoot} from 'react-dom/client';import Review from './components/MiscategorisedReviewSheet';import {api} from './lib/api';
const params=new URLSearchParams(location.search),kind=params.get('kind');document.documentElement.classList.toggle('dark',params.get('mode')==='dark');
window.attempts=0;window.changed=0;window.writes=[];window.loadAttempts=0;
const leg={amount:75.53,currency:'GBP',account_id:'current',category:'Other',date:'2026-10-01',description:params.has('long')?'A very long payment description that still needs to remain readable on a narrow phone':'CURRENT ACCOUNT TRANSFER',merchant_name:null};
const pair={pair_key:'credit:debit',date_diff_days:3,credit:{...leg,id:'credit',account_id:'saver',category:'Income',date:'2026-10-04'},debit:{...leg,id:'debit'}};
const item={...leg,id:'single',ids:['single'],count:1,series_key:'Series',amount_min:75.53,amount_max:75.53,first_date:'2026-10-01',transaction_type:'debit'};
let pairs=kind==='series'||kind==='single'||kind==='teaching'||kind==='empty'?[]:[pair],items=kind==='series'||kind==='single'||kind==='teaching'?[item]:[],separate=[];
if(kind==='reload'){const saved=JSON.parse(sessionStorage.getItem('g382-queue')||'null');if(saved){pairs=saved.pairs;separate=saved.separate;}}
const persist=()=>{if(kind==='reload')sessionStorage.setItem('g382-queue',JSON.stringify({pairs,separate}));};
api.getMiscategorised=async()=>{window.loadAttempts++;if(kind==='load-error'&&window.loadAttempts===1)throw Error('Unavailable');return{items,separate_items:separate};};
api.getTransferPairSuggestions=async()=>({items:pairs});
const rejectFirst=()=>{window.attempts++;if(['confirm','pair','single'].includes(kind)&&window.attempts===1)throw Error('Unavailable');};
api.confirmTransferPair=async()=>{rejectFirst();pairs=[];persist();return{credit_category:'Transfer',debit_category:'Transfer'};};
api.dismissTransferPair=async()=>{rejectFirst();pairs=[];separate=[pair.debit,pair.credit].map((v,i)=>({...item,...v,ids:[v.id],series_key:'separate:'+v.id,transaction_type:i?'credit':'debit'}));persist();return{ok:true};};
api.dismissMiscategorisedSeries=async()=>{rejectFirst();items=[];return{ok:true};};
const correct=(id,body)=>{if(kind==='single')rejectFirst();window.writes.push({id,body});separate=separate.filter(v=>v.id!==id);items=items.filter(v=>v.id!==id);persist();return{custom_category:body.category||'Transfer'};};
api.resolveMovement=async(id,body)=>correct(id,body);api.patchTransaction=async(id,body)=>correct(id,body);
api.getGoals=async()=>[];api.suggestRule=async()=>({suggestion:null});
const accounts=[{id:'current',name:'Premier Current Account',provider:'Barclays',type:'current',currency:'GBP'},{id:'saver',name:'Personal',provider:'Starling',type:'current',currency:'GBP'}];
createRoot(document.getElementById('root')).render(<Review accounts={accounts} onClose={()=>{}} onUpdated={()=>window.changed++} onChanged={()=>window.changed++}/>);`;
// Supply preferences without a real session; both visible and hidden are checked.
const result=await build({absWorkingDir:root,stdin:{contents:entry,resolveDir:root,loader:'tsx'},bundle:true,write:false,format:'iife',platform:'browser',jsx:'automatic',define:{'process.env.NODE_ENV':'"production"','process.env':'{}'},plugins:[{name:'fixture-preferences',setup(b){b.onResolve({filter:/PreferencesContext$/},()=>({path:'preferences',namespace:'fixture'}));b.onLoad({filter:/.*/,namespace:'fixture'},()=>({contents:"export const usePreferences=()=>({hideNetWorth:new URLSearchParams(location.search).has('hidden'),preferencesReady:!new URLSearchParams(location.search).has('unready')});",loader:'js'}));}}]});
const files=await readdir(root+'/.next/static/chunks');
const css=(await Promise.all(files.filter(f=>f.endsWith('.css')).map(f=>readFile(root+'/.next/static/chunks/'+f,'utf8')))).join('\n');
const server=createServer((req,res)=>{res.setHeader('Content-Type',req.url==='/app.js'?'application/javascript':req.url==='/app.css'?'text/css':'text/html; charset=utf-8');res.end(req.url==='/app.js'?result.outputFiles[0].text:req.url==='/app.css'?css:'<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/app.css"></head><body><div id="root"></div><script src="/app.js"></script></body></html>');});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const b=await openBrowser({origin:'http://127.0.0.1:'+server.address().port,output:'/tmp/g382-production-evidence'});
const button=label=>`Array.from(document.querySelectorAll('button')).find(e=>e.textContent.trim()===${JSON.stringify(label)})`;
const click=label=>b.activate(button(label));
const ready='!!document.querySelector("[data-review-pair], [data-review-id]")';
try{
for(const [kind,label] of [['confirm','Yes, same transfer'],['pair','Review separately'],['single','Save this payment']]){
 await b.viewport(390,900);await b.navigate('/?kind='+kind,ready);
 if(kind==='single'){await b.activate('document.querySelector("summary")');await click('Another of my accounts');}
 if(kind==='pair')assert.match(await b.evaluate('document.body.innerText'),/3 days apart/);
 await click(label);await b.waitFor('!!document.querySelector("[role=alert]")');
 assert.equal(await b.evaluate('window.changed'),0,'failed save must not announce success');
 assert.equal(await b.evaluate(`${button(label)}.disabled`),false,'retry stays available');
 await b.shot(kind+'-failure',{full:true});await click(label);await b.waitFor('window.changed===1');
 assert.equal(await b.evaluate('window.attempts'),2);
 await b.waitFor(`!(${button(label)})`);
 if(kind==='pair')assert.equal(await b.evaluate('document.querySelectorAll("[data-review-id]").length'),2,'separate retains both legs');
}
// Separate choices survive reopening, and correcting the source keeps the credit.
await b.navigate('/?kind=reload',ready);await click('Review separately');await b.waitFor('document.querySelectorAll("[data-review-id]").length===2');
await b.navigate('/?kind=reload',ready);assert.equal(await b.evaluate('document.querySelectorAll("[data-review-id]").length'),2);
await b.activate('document.querySelector("[data-review-id=debit] summary")');await click('Another of my accounts');
assert.equal(await b.evaluate('window.writes.length'),0,'choice still asks for confirmation');
await click('Save this payment');await b.waitFor('document.querySelectorAll("[data-review-id]").length===1');
assert.equal(await b.evaluate('document.querySelector("[data-review-id]").dataset.reviewId'),'credit');
assert.equal(await b.evaluate('window.writes[0].body.resolution'),'mine-here');
await b.navigate('/?kind=reload',ready);assert.equal(await b.evaluate('document.querySelector("[data-review-id]").dataset.reviewId'),'credit');
await b.activate('document.querySelector("summary")');await click('Keep as income');await click('Save this payment');await b.waitFor('document.body.innerText.includes("Nothing needs review")');
// Loading failures cannot pretend there is nothing to review.
await b.navigate('/?kind=load-error','!!document.querySelector("[role=alert]")');assert.doesNotMatch(await b.evaluate('document.body.innerText'),/Nothing needs review/);await click('Try again');await b.waitFor(ready);
// Real teaching entry points are navigations, not automatic financial writes.
for(const [choice,text] of [['Savings or investments','What did you put it into?'],['Spending','Groceries'],['Paying off a card','Save this payment']]){
 await b.navigate('/?kind=teaching',ready);await b.activate('document.querySelector("summary")');await click(choice);await b.waitFor(`document.querySelectorAll('[role=dialog]').length===2 && document.body.innerText.includes(${JSON.stringify(text)})`);
 assert.equal(await b.evaluate('window.writes.length'),0);
 assert.equal(await b.evaluate('document.querySelectorAll("button.bg-black\\\\/40").length'),1,'only parent sheet dims');
 await b.shot('teaching-'+choice.split(' ')[0],{full:true});
 if(choice==='Paying off a card'){await click('Save this payment');await b.waitFor('window.writes.length===1');assert.equal(await b.evaluate('window.writes[0].body.category'),'Debt');}
}
for(const [width,mode,extra] of [[390,'light',''],[390,'dark',''],[320,'dark','&long=1'],[1280,'light',''],[390,'dark','&hidden=1'],[390,'light','&unready=1']]){
 await b.viewport(width,900);await b.navigate('/?kind=visual&mode='+mode+extra,ready);
 const text=await b.evaluate('document.body.innerText');
 if(extra.includes('hidden')||extra.includes('unready')){assert.doesNotMatch(text,/75[.,]53/);assert.match(text,/−••••/);assert.match(text,/\+••••/);}
 assert.equal(await b.evaluate('document.documentElement.scrollWidth>innerWidth'),false,'no viewport overflow');
 await b.save(`${width}-${mode}-styles`,await b.evaluate(`(()=>{const e=${button('Yes, same transfer')};return{color:getComputedStyle(e).color,bg:getComputedStyle(e).backgroundColor,fill:getComputedStyle(e).webkitTextFillColor,html:e.outerHTML}})()`));
 await b.shot(`${width}-${mode}${extra.replaceAll('&','-').replaceAll('=','-')}`,{full:true});
}
await b.navigate('/?kind=series',ready);await b.evaluate('document.querySelector("summary").focus()');await b.key('Enter','Enter',13);assert.equal(await b.evaluate('document.querySelector("details").open'),true);
assert.deepEqual(b.exceptions,[]);console.log('G382: save retry, durable separate legs, teaching choices, load recovery, privacy, keyboard and responsive themes passed');
}catch(e){console.error(b.exceptions);throw e;}finally{b.close();server.close();}
