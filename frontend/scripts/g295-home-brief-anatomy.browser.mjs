// Approved G295 B: actual production cards rendered from synthetic props,
// with built Next CSS/fonts. Static replacements prove layout only. The
// initial existing trajectory catalogue separately proves native dismissal.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime.js";
import { openBrowser } from "./g293-browser-helper.mjs";
import { renderHomeBrief } from "./fixtures/g295-home-brief-cards.tsx";

const b = await openBrowser({ origin: process.env.G295_TEST_ORIGIN || "http://127.0.0.1:3158", output: process.argv[2] });
const results = [], errors = [];
const noop=()=>{};
const router={bfcacheId:"g295-layout",push:noop,replace:noop,refresh:noop,back:noop,forward:noop,prefetch:async()=>{}};
const markup=view=>renderToStaticMarkup(h(AppRouterContext.Provider,{value:router},renderHomeBrief(view)));
const storage = "({local:{...localStorage},session:Object.fromEntries(Object.entries(sessionStorage).filter(([key])=>!key.startsWith('wd_scroll:/design/home-brief-cards?')))})";
const baseline = process.env.G295_BASELINE ? JSON.parse(await readFile(process.env.G295_BASELINE, "utf8")).results : [];
const navigate = mode => b.navigate(`/design/home-brief-cards?state=trajectory&variant=b&mode=${mode}`, `document.querySelector('[data-trajectory-state="rising-interest"] [data-brief-header]') && document.documentElement.classList.contains('dark') === ${mode === "dark"}`);
try {
  await b.viewport(390);
  await navigate("light");
  const before = await b.evaluate(storage);
  await b.evaluate(`document.querySelector('[data-trajectory-state="rising-interest"] footer a').focus()`);
  await b.key("Tab", "Tab", 9);
  assert.equal(await b.evaluate(`document.activeElement.matches('[data-trajectory-state="rising-interest"] button[aria-label="Hide on Home"]')`), true);
  await b.key("Enter", "Enter", 13);
  await b.waitFor(`!document.querySelector('[data-trajectory-state="rising-interest"] [data-brief-header]')`);
  await b.activate(`document.querySelector('[data-trajectory-state="rising-promo"] button[aria-label="Hide on Home"]')`);
  await b.waitFor(`!document.querySelector('[data-trajectory-state="rising-promo"] [data-brief-header]')`);
  assert.deepEqual(await b.evaluate(storage), before, "real local dismissals preserve product storage");

  for (const mode of ["light", "dark"]) {
    await navigate(mode);
    const shell = await b.evaluate(`(() => { const head=document.head.cloneNode(true);head.querySelectorAll('script').forEach(e=>e.remove());return{head:head.innerHTML,html:document.documentElement.className,body:document.body.className}; })()`);
    for (const width of [320, 390, 768, 1280]) for (const state of ["focus", "family", "edges", "hidden", "empty"]) {
      await b.viewport(width);
      const html = `<!doctype html><html class="${shell.html}" style="color-scheme:${mode}"><head>${shell.head}</head><body class="${shell.body}"><main class="min-h-dvh bg-[#f0f2f7] pt-5 pb-5 dark:bg-[#0f172a]">${markup(state)}</main></body></html>`;
      const { frameTree } = await b.call("Page.getFrameTree");
      await b.call("Page.setDocumentContent", { frameId: frameTree.frame.id, html });
      await b.waitFor(`document.querySelector('[data-g295-layout]')`);
      await b.settle();
      const m = await b.evaluate(`(() => {
        const box=e=>{const r=e.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom}};
        return{width:innerWidth,overflow:document.documentElement.scrollWidth>innerWidth+1,cards:[...document.querySelectorAll('[data-example]')].map(ex=>{
          const key=ex.dataset.example,kind=ex.dataset.kind;
          const root=kind==='tip'?ex.firstElementChild.firstElementChild:ex.firstElementChild;
          const header=kind==='tip'?root.querySelector('button:last-child'):kind==='payday'?root.firstElementChild.firstElementChild:kind==='month'?root:root.firstElementChild;
          const headline=kind==='tip'?header.querySelector('p.font-bold'):kind==='payday'?header.querySelector('h2'):header.querySelector('p');
          const cue=header.querySelector(':scope > span[aria-hidden="true"]');
          const lead=root.querySelector('[data-brief-lead],[data-move-lead],[data-total-moving]');
          const body=[...root.children].find(e=>e.tagName==='P');
          const dismiss=root.querySelector('button[aria-label="Hide on Home"],button[aria-label^="Dismiss"]');
          return{key,kind,root:box(root),headline:headline?box(headline):null,lead:lead?box(lead):null,body:body?box(body):null,dismiss:dismiss?box(dismiss):null,
            cue:cue?{...box(cue),background:getComputedStyle(cue).backgroundColor,svg:box(cue.querySelector('svg')),colour:getComputedStyle(cue.querySelector('svg')).color}:null,
            nativeHeader:!!root.querySelector('[data-brief-header]'),text:root.innerText,
            targets:[...root.querySelectorAll('button,a')].filter(e=>e.getClientRects().length).map(e=>({label:e.getAttribute('aria-label')||e.textContent.trim(),...box(e)}))};
        })};
      })()`);
      assert.equal(m.width, width);
      assert.equal(m.overflow, false, `${mode}/${width}/${state}: no page overflow`);
      for (const card of m.cards) {
        try {
          assert.ok(card.root.x>=0 && card.root.right<=width+1, "card fits viewport without shell clipping");
          if (card.key === "deferred") continue;
          if (card.headline) assert.ok(Math.abs(card.headline.x-card.root.x-17)<1.5, "16px full reading inset");
          if (card.lead && card.headline) assert.ok(Math.abs(card.lead.x-card.headline.x)<1.5, "lead shares reading edge");
          if (card.body && card.headline) assert.ok(Math.abs(card.body.x-card.headline.x)<1.5, "body shares reading edge");
          if (card.dismiss && card.headline && card.headline.y<card.dismiss.bottom && card.headline.bottom>card.dismiss.y) assert.ok(card.headline.right<=card.dismiss.x+1, "headline clears dismiss");
          if (card.nativeHeader) {
            assert.equal(card.cue.width,16);assert.equal(card.cue.height,16);assert.equal(card.cue.svg.width,16);
            assert.equal(card.cue.background,"rgba(0, 0, 0, 0)", "no residual tile tint");
          }
          for (const target of card.targets) assert.ok(target.height>=43.5, `44px target: ${target.label}`);
          if (state === "hidden") assert.doesNotMatch(card.text,/£[\d,]+/);
          const old=baseline.find(r=>r.variant==='b'&&r.width===width&&r.mode===mode&&r.state===state)?.cards.find(c=>c.key===card.key);
          if (old?.headline && card.headline) {
            assert.ok(Math.abs((card.headline.x-card.root.x)-(old.headline.x-old.root.x))<1.5,"approved B horizontal parity");
            assert.ok(Math.abs((card.headline.y-card.root.y)-(old.headline.y-old.root.y))<1.5,"approved B headline vertical parity");
          }
        } catch(error) {errors.push({mode,width,state,key:card.key,error:error.message,card});}
      }
      if (width===390 && state==='focus') await b.shot(`${mode}-reported`,{full:true});
      if (width===390 && mode==='dark' && state==='family') await b.shot("dark-family",{full:true});
      if (width===320 && mode==='light' && state==='edges') await b.shot("narrow-optional",{full:true});
      if (width===1280 && mode==='light' && state==='family') await b.shot("desktop-family");
      if (width===768 && mode==='dark' && state==='family') await b.shot("intermediate-family");
      if (width===390 && mode==='light' && state==='hidden') await b.shot("hidden-amounts",{full:true});
      if (width===390 && mode==='dark' && state==='empty') await b.shot("empty-brief");
      results.push({mode,width,state,...m});
    }
  }
  await b.save("results",{layouts:results.length,cards:results.reduce((n,r)=>n+r.cards.length,0),errors,evidence:"production-component SSR, real CSS/fonts; separate hydrated native touch/keyboard dismissals",baseline:baseline.length>0,results});
  assert.deepEqual(b.apiRequests,[]);assert.deepEqual(b.exceptions,[]);
  assert.deepEqual(errors,[],"batched layout and approved-B parity findings");
  console.log(JSON.stringify({layouts:results.length,cards:results.reduce((n,r)=>n+r.cards.length,0),output:b.output}));
} finally {b.close();}
