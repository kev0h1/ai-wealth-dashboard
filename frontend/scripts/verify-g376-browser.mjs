// Isolated manual integration check of the production teaching and goal sheets.
// API methods are replaced in memory. No live account reads or writes.
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import postcss from 'postcss';
import tailwind from '@tailwindcss/postcss';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { openBrowser } from './_plan-browser.mjs';
const out=await mkdtemp(path.join(tmpdir(),'g376-approved-'));
const entry=`import React from 'react';import {createRoot} from 'react-dom/client';import TeachingSheet from './components/TeachingSheet';import {api} from './lib/api';
window.calls=[];window.changes=0;window.addEventListener('sorted:transactions-changed',()=>window.changes++);window.updated=[];window.goalRequests=[];window.hidden=new URLSearchParams(location.search).get('hidden')==='1';window.failSave=false;window.generation=0;window.direction=new URLSearchParams(location.search).get('credit')==='1'?'credit':'debit';window.closeCalls=0;
api.resolveMovement=async(id,body)=>{window.calls.push({id,...body});if(window.failSave)throw Error('Connection lost. Try again.');return {custom_category:body.resolution==='mine-investment'?'Investment':body.resolution==='mine-savings'?'Savings':body.category||'Transfer',linked_goal_id:body.goal_id}};
api.patchTransaction=async(id,body)=>{window.calls.push({id,...body});return {...body,matches_past:0}};
api.listCommitments=()=>new Promise((resolve,reject)=>window.goalRequests.push({resolve,reject}));
api.accounts=async()=>[{id:'current',name:'Everyday',provider:'Example bank',type:'TRANSACTION',balance:300,currency:'GBP'}];
api.planFillCandidates=async()=>({candidates:[]});api.getPreferences=async()=>({});
api.previewCommitment=async()=>({per_period_slice:25,periods_left:4,starting_progress:0,feasibility:null,pots_detail:[],consent:null});api.spendVerdict=async()=>({period:{start:'2026-10-28',end:'2026-11-28'},previous_period:{start:'2026-09-28',end:'2026-10-28'}});
api.createCommitment=async body=>{window.calls.push({createGoal:body});return {id:'created',...body,status:'active'}};
window.render=()=>root.render(<TeachingSheet key={window.generation} transaction={{id:'t1',description:'Example destination',merchant_name:'Example destination',category:'Transfer',amount:25,currency:'GBP',date:'2026-10-31',transaction_type:window.direction,account_id:'current'}} account={{id:'current',name:'Everyday',provider:'Example bank',type:'TRANSACTION',balance:300,currency:'GBP'}} onClose={()=>window.closeCalls++} onUpdated={tx=>window.updated.push(tx)}/>);
const root=createRoot(document.getElementById('root'));window.render();`;
await build({stdin:{contents:entry,resolveDir:process.cwd(),loader:'tsx'},bundle:true,outfile:path.join(out,'bundle.js'),jsx:'automatic',define:{'process.env':'{}'},plugins:[{name:'fixture-boundaries',setup(b){
 b.onResolve({filter:/^next\/navigation$/},()=>({path:'navigation',namespace:'mock'}));
 b.onResolve({filter:/^@\/components\/PreferencesContext$/},()=>({path:'preferences',namespace:'mock'}));
 b.onLoad({filter:/.*/,namespace:'mock'},a=>({loader:'js',contents:a.path==='navigation'?`export const useRouter=()=>({push:()=>{},replace:()=>{},back:()=>{}});export const usePathname=()=>'/transactions';export const useSearchParams=()=>new URLSearchParams();`:`export const usePreferences=()=>({hideNetWorth:window.hidden,preferencesReady:true,payPeriodConfig:{type:'monthly_pay_date',day:28},rawPrefs:{}});`}));
}}]});
const css=await postcss([tailwind({base:process.cwd()})]).process(await readFile('app/globals.css','utf8'),{from:path.resolve('app/globals.css')});await writeFile(path.join(out,'styles.css'),css.css);
const html=`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/styles.css"><div id="root"></div><script src="/bundle.js"></script>`;
const server=createServer(async(req,res)=>{const filename=req.url==='/bundle.js'?'bundle.js':req.url==='/styles.css'?'styles.css':null;res.setHeader('Content-Type',filename?.endsWith('.css')?'text/css':filename?'text/javascript':'text/html');res.end(filename?await readFile(path.join(out,filename)):html);});await new Promise(r=>server.listen(0,'127.0.0.1',r));
const b=await openBrowser({origin:`http://127.0.0.1:${server.address().port}`,output:out});
const wait=async(expr)=>{for(let n=0;n<160;n++){if(await b.evaluate(`!!(${expr})`))return;await new Promise(r=>setTimeout(r,50));}throw Error('Timeout '+expr+' '+await b.evaluate('document.body.innerText'));};
const text=()=>b.evaluate('document.body.innerText');
const click=async label=>{const selector=`Array.from(document.querySelectorAll('button')).find(e=>e.textContent.trim()===${JSON.stringify(label)}||e.textContent.trim().startsWith(${JSON.stringify(label)}))`;await wait(selector);await b.activate(selector);};
try {
 await b.viewport(390,844);await b.navigate('/',"document.body?.innerText.includes('Where did this money go?')");
 if(!process.env.QUICK) for(const width of [320,390,1280])for(const dark of [false,true]){await b.viewport(width,900);await b.navigate('/',"document.body?.innerText.includes('Where did this money go?')");await b.evaluate(`document.documentElement.classList.toggle('dark',${dark})`);assert.equal(await b.evaluate('document.documentElement.scrollWidth<=innerWidth'),true);await b.shot(`root-${width}-${dark?'dark':'light'}`,{full:true});}
 await b.viewport(390,844);await b.navigate('/',"document.body?.innerText.includes('Where did this money go?')");await click('Savings or investments');await click('Investment');
 await wait('document.querySelector("input")');
 await b.evaluate(`(()=>{const e=document.querySelector('input');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,'My investment provider');e.dispatchEvent(new Event('input',{bubbles:true}));})()`);
 await b.shot('investment-name',{full:true});
 await b.evaluate('window.failSave=true');await click('Save as Investment');await wait('document.body.innerText.includes("Connection lost")');
 assert.equal(await b.evaluate('window.updated.length'),0);assert.equal(await b.evaluate('window.changes'),0);
 await b.evaluate('window.failSave=false');await click('Save as Investment');await wait('window.updated.length===1');
 assert.deepEqual(await b.evaluate('window.calls[1]'),{id:'t1',resolution:'mine-investment',destination_name:'My investment provider'});
 assert.equal(await b.evaluate('window.updated[0].category'),'Investment');assert.equal(await b.evaluate('window.changes'),1);
 await click('Undo');await wait('window.calls.length===3');assert.equal(await b.evaluate('window.calls[2].resolution'),'spending');assert.equal(await b.evaluate('window.changes'),2);
 await b.navigate('/?hidden=1',"document.body?.innerText.includes('Where did this money go?')");assert.doesNotMatch(await text(),/25[.,]00/);await b.shot('hidden',{full:true});
 await b.navigate('/?credit=1',"document.body?.innerText.includes('Money arrived')");assert.doesNotMatch(await text(),/Savings or investments/);await b.shot('credit',{full:true});
 await b.navigate('/',"document.body?.innerText.includes('Where did this money go?')");await click('A goal in Sorted');await wait('window.goalRequests.length===1');
 assert.match(await text(),/Loading your goals/);await b.evaluate('window.goalRequests[0].reject(new Error("offline"))');await wait('document.body.innerText.includes("Try again")');assert.doesNotMatch(await text(),/No active goals/);
 await click('Try again');await wait('window.goalRequests.length===2');await b.evaluate('window.goalRequests[1].resolve({items:[]})');await wait('document.body.innerText.includes("No active goals")');await b.shot('empty-goals',{full:true});
 await click('Create a goal');await wait('document.querySelector("#commitment-form")');await b.shot('real-goal-setup',{full:true});
 assert.equal(await b.evaluate('window.calls.length'),0);
 await b.type('document.querySelector("#commitment-name")','Trip');await click('Continue');await wait('document.querySelector("#commitment-form").dataset.planEditorStep!=="purpose"');
 await b.type('document.querySelector("#commitment-amount")','100');await click('Continue');await wait('document.querySelector("#commitment-form").dataset.planEditorStep==="source"');
 await wait('document.querySelector("button[role=radio]")');await b.activate('document.querySelector("button[role=radio]")');await click('Continue');await wait('document.querySelector("#commitment-form").dataset.planEditorStep==="destination"');
 await click('Continue');await wait('document.querySelector("#commitment-form").dataset.planEditorStep==="tracking"');await click('Review goal');await wait('document.querySelector("#commitment-form").dataset.planEditorStep==="review"');await b.shot('goal-review',{full:true});await b.evaluate('window.hidden=true;window.render()');await wait('document.body.innerText.includes("£••••")');await b.settle();assert.doesNotMatch(await text(),/£25|£100/);await b.shot('goal-review-hidden',{full:true});await b.evaluate('window.hidden=false;window.render()');
 await click('Save goal');await wait('document.body.innerText.includes("Which goal does this fund?")');assert.equal(await b.evaluate('window.calls[0].createGoal.name'),'Trip');assert.equal(await b.evaluate('window.updated.length'),0);
 await click('Trip');await wait('window.updated.length===1');assert.equal(await b.evaluate('window.calls[1].resolution'),'mine-goal');assert.equal(await b.evaluate('window.calls[1].goal_id'),'created');
 await b.navigate('/',"document.body?.innerText.includes('Where did this money go?')");await click('A goal in Sorted');await wait('window.goalRequests.length===1');await b.evaluate('window.goalRequests[0].resolve({items:[]})');await click('Create a goal');await wait('document.querySelector("#commitment-form")');
 await b.key('Escape','Escape',27);await wait('document.body.innerText.includes("Which goal does this fund?")');assert.equal(await b.evaluate('window.closeCalls'),0);
 await click('Create a goal');await wait('document.querySelector("#commitment-form")');await b.evaluate('history.back()');await wait('document.body.innerText.includes("Which goal does this fund?")');assert.equal(await b.evaluate('window.closeCalls'),0);
 await click('Create a goal');await wait('document.querySelector("#commitment-form")');await b.activate("Array.from(document.querySelectorAll('button')).find(e=>e.getAttribute('aria-label')==='Back to this payment')");await wait('document.body.innerText.includes("Which goal does this fund?")');assert.equal(await b.evaluate('window.closeCalls'),0);
 assert.equal(b.exceptions.length,0);assert.equal(b.apiRequests.length,0);
 console.log(JSON.stringify({passed:true,evidence:out,checks:'layouts, outlines, investment save/failure/undo/events, privacy, credit, goals loading/retry/create/select, Escape and history Back'}));
}catch(error){console.error(JSON.stringify({exceptions:b.exceptions,apiRequests:b.apiRequests,evidence:out}));throw error;}finally{await b.close();await new Promise(r=>server.close(r));}
