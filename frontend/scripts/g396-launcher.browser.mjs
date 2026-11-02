// Manual real-component regression. --baseline captures the original obstruction.
import assert from 'node:assert/strict';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {AppRouterContext} from 'next/dist/shared/lib/app-router-context.shared-runtime.js';
import {MoveCard} from '../components/HomeBrief.tsx';
import {PRESENCE_FIXTURES} from './fixtures/g388-penny.ts';
import {build} from 'esbuild';
import postcss from 'postcss';
import tailwind from '@tailwindcss/postcss';
import {createServer} from 'node:http';
import {mkdtemp,readFile,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {openBrowser} from './_plan-browser.mjs';
const baseline=process.argv.includes('--baseline'),out=await mkdtemp(path.join(tmpdir(),'g396-'));
const evidence=path.resolve('../.impeccable/review/g396',baseline?'before':'after');
const noop=()=>{},router={push:noop,replace:noop,back:noop,forward:noop,refresh:noop,prefetch:async()=>{}};
const card=renderToStaticMarkup(React.createElement(AppRouterContext.Provider,{value:router},React.createElement(MoveCard,{item:PRESENCE_FIXTURES.coverPlan,previewMode:true,dismissible:false})));
const homeSource=await readFile('app/components/HomePage.tsx','utf8');
const homeClass=homeSource.match(/className="(relative isolate min-h-dvh pb-\[calc\(9rem[^\"]+)"/)[1];
const entry=`import React from 'react';import{createRoot}from'react-dom/client';import BottomNav from './components/BottomNav';window.appearance='outline';window.resolved=true;window.ctaClicks=0;const root=createRoot(document.getElementById('nav-root'));window.render=(a='outline',r=true)=>{window.appearance=a;window.resolved=r;root.render(<BottomNav/>)};window.render();document.querySelector('[data-card]').addEventListener('click',e=>{if(e.target.closest('a')){e.preventDefault();window.ctaClicks++}});`;
const mock=name=>({
 'next/navigation':`export const usePathname=()=>'/';`,
 'next/link':`export default function Link(p){return <a {...p}/>}`,
 '@/lib/api':`export const api={atRiskCount:async()=>({count:0})};`,
 '@/components/PreferencesContext':`export const usePreferences=()=>({pennyAppearance:window.appearance,pennyAppearanceResolved:window.resolved});`,
 '@/components/PennySheetProvider':`import{useState}from'react';export const usePennySheet=()=>{const[isOpen,setOpen]=useState(false);return{isOpen,open:()=>setOpen(true),close:()=>setOpen(false)}};`,
}[name]);
await build({stdin:{contents:entry,resolveDir:process.cwd(),loader:'tsx'},bundle:true,jsx:'automatic',outfile:path.join(out,'bundle.js'),define:{'process.env':'{}'},plugins:[{name:'isolated-nav',setup(b){b.onResolve({filter:/^(next\/|@\/)/},a=>mock(a.path)?{path:a.path,namespace:'fixture'}:undefined);b.onLoad({filter:/.*/,namespace:'fixture'},a=>({contents:mock(a.path),loader:'tsx',resolveDir:process.cwd()}))}}]});
const css=(await postcss([tailwind({base:process.cwd()})]).process(await readFile('app/globals.css','utf8'),{from:path.resolve('app/globals.css')})).css;
await writeFile(path.join(out,'styles.css'),css);
await writeFile(path.join(out,'index.html'),`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/styles.css"><style>@font-face{font-family:Figtree;src:url(/fonts/Figtree.ttf)}@font-face{font-family:JetBrains;src:url(/fonts/JetBrainsMono.ttf)}:root{--font-figtree:Figtree;--font-jbmono:JetBrains}</style></head><body><main class="${homeClass}"><header class="px-4 pt-8"><h1 class="text-xl font-bold">Home</h1></header><div id="spacer" style="height:150px"></div><div data-card class="mx-4">${card}</div></main><div id="nav-root"></div><script src="/bundle.js"></script></body></html>`);
const server=createServer(async(req,res)=>{const u=req.url??'/';try{
 if(u==='/bundle.js'||u==='/styles.css'){res.setHeader('Content-Type',u.endsWith('css')?'text/css':'application/javascript');return res.end(await readFile(path.join(out,u.slice(1))))}
 if(u.startsWith('/banks/')){res.setHeader('Content-Type',u.endsWith('.svg')?'image/svg+xml':'image/png');return res.end(await readFile(path.join(process.cwd(),'public',u)))}
 if(u.startsWith('/fonts/'))return res.end(await readFile(path.join(process.cwd(),'public/design-media/c22/crafted/fonts',path.basename(u))));
 if(u!=='/'){res.statusCode=404;return res.end('missing')};res.setHeader('Content-Type','text/html');res.end(await readFile(path.join(out,'index.html')));
}catch{res.statusCode=404;res.end('missing')}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const b=await openBrowser({origin:`http://127.0.0.1:${server.address().port}`,output:evidence});
const cta="[...document.querySelectorAll('[data-card] a')].find(e=>e.textContent.includes('See what'))";
const metrics=()=>b.evaluate(`(()=>{const rail=document.querySelector('.glass-rail'),p=document.querySelector('[aria-label=Penny]'),a=${cta},r=rail.getBoundingClientRect(),q=p.getBoundingClientRect(),c=a.getBoundingClientRect(),hit=document.elementFromPoint(c.x+c.width/2,c.y+c.height/2);return{railTop:r.top,railBottom:r.bottom,top:q.top,bottom:q.bottom,width:q.width,height:q.height,ctaBottom:c.bottom,ctaHit:a.contains(hit),background:getComputedStyle(p).backgroundColor,railBackground:getComputedStyle(rail).backgroundColor,shadow:getComputedStyle(p).boxShadow,gradient:getComputedStyle(p).backgroundImage,svg:p.querySelectorAll('svg').length,overflow:document.documentElement.scrollWidth>innerWidth}})()`);
const results=[];
try{
 await b.viewport(390,844);await b.navigate('/',"document.querySelector('[data-penny-appearance]')");
 for(const theme of ['light','dark']){
  await b.evaluate(`document.documentElement.className=${JSON.stringify(theme==='dark'?'dark':'')};scrollTo(0,0)`);
  await b.evaluate(`(()=>{const a=${cta},r=document.querySelector('.glass-rail').getBoundingClientRect(),s=document.querySelector('#spacer');s.style.height=(parseFloat(s.style.height)+r.top-4-a.getBoundingClientRect().bottom)+'px'})()`);
  for(const appearance of ['outline','ink','original','pending']){
   await b.evaluate(`window.render(${JSON.stringify(appearance==='pending'?'original':appearance)},${appearance!=='pending'})`);
   await b.waitFor(`document.querySelector('[data-penny-appearance]')?.dataset.pennyAppearance===${JSON.stringify(appearance)}`);
   await b.settle();const m=await metrics();results.push({theme,appearance,...m});
   if(!baseline){assert.ok(m.top>=m.railTop&&m.bottom<=m.railBottom,'launcher stays inside rail');assert.equal(m.ctaHit,true,'CTA above rail remains clickable');assert.equal(m.width,56);assert.equal(m.height,56);assert.equal(m.overflow,false);if(appearance!=='original')assert.equal(m.background,m.railBackground,'neutral door uses rail tone');assert.equal(m.gradient.includes('gradient'),appearance==='original');if(appearance==='pending')assert.equal(m.svg,0);}
   if(appearance!=='ink')await b.shot(`${theme}-${appearance}`);
  }
 }
 if(baseline)assert.ok(results.some(r=>!r.ctaHit),'baseline reproduces obstruction');
 else{
  await b.evaluate("window.render('outline',true)");await b.waitFor("document.querySelector('[data-penny-appearance=outline]')");await b.activate(cta);assert.equal(await b.evaluate('window.ctaClicks'),1);
  await b.evaluate("document.querySelector('[aria-label=Penny]').focus()");await b.key('Enter','Enter',13);await b.waitFor("document.querySelector('[aria-label=Penny]').getAttribute('aria-pressed')==='true'");await b.key(' ','Space',32);await b.waitFor("document.querySelector('[aria-label=Penny]').getAttribute('aria-pressed')==='false'");
  for(const width of [320,768,1280]){await b.viewport(width,844);await b.settle();assert.equal(await b.evaluate('document.documentElement.scrollWidth>innerWidth'),false);if(width>=1024)assert.equal(await b.evaluate("getComputedStyle(document.querySelector('nav')).display"),'none');await b.shot(`width-${width}`);}
  await b.viewport(390,844);await b.call('Emulation.setSafeAreaInsetsOverride',{insets:{bottom:34}});await b.evaluate('scrollTo(0,document.body.scrollHeight)');await b.settle();const safe=await metrics();assert.ok(safe.ctaBottom<safe.railTop,'terminal CTA clears gesture inset');assert.equal(safe.ctaHit,true);await b.shot('safe-area-end');results.push({safeArea:34,...safe});
 }
 assert.deepEqual(b.exceptions,[]);assert.deepEqual(b.apiRequests,[]);await b.save('results',{baseline,results});console.log(JSON.stringify({baseline,checks:results.length,output:evidence}));
}finally{b.close();await new Promise(r=>server.close(r));}
