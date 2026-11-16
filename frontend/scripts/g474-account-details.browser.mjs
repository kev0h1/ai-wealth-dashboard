// Production components in a disposable local fixture. No retained design route,
// live account, API write or hand-authored substitute for the shipped content.
import assert from "node:assert/strict";
import { build } from "esbuild";
import { createServer } from "node:http";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import postcss from "postcss";
import tailwind from "@tailwindcss/postcss";
import { openBrowser } from "./_plan-browser.mjs";

const out = await mkdtemp(path.join(tmpdir(), "g474-account-details-"));
const evidence = path.resolve("../.impeccable/review/g474-foldin");
await mkdir(evidence, { recursive: true });
const entry = `
import React,{useState} from 'react';import{createRoot}from'react-dom/client';
import{SheetFrame}from'./components/SheetFrame';
import AccountDetailsContent from './components/AccountDetailsContent';
import CardDetailsSections from './components/CardDetailsSections';
import AccountCountRow from './components/AccountCountRow';
import{AccountConnectionEvidence,AccountConnectionSummary}from'./components/AccountConnectionDetails';
const p=new URLSearchParams(location.search),kind=p.get('kind')||'credit',state=p.get('state')||'healthy',hidden=p.has('hidden');
document.documentElement.className=p.get('mode')==='dark'?'dark':'';
let refreshAttempts=0;window.fixture={events:[]};
const account={id:'fictional-account',name:p.has('long')?'Travel and household purchases with a deliberately long account name':kind==='credit'?'Travel card':kind==='savings'?'Rainy day':'Everyday account',type:kind==='credit'?'credit':'bank',subtype:kind==='savings'?'SAVINGS':'TRANSACTION',provider:'Northbridge',status:state==='reconnect'?'expired':'connected',balance:kind==='credit'?-1524.37:850.26,currency:'GBP',account_number:p.has('missing')?undefined:'1111222233332849',sort_code:kind==='credit'||p.has('missing')?undefined:'12-34-56',connection_id:'fictional-connection',bank_synced_to:state==='never'||p.has('missing')?null:'2026-11-15T10:24:00Z',transactions_synced_at:state==='never'||p.has('missing')?null:'2026-11-15T10:30:00Z'};
const connection={connection_id:'fictional-connection',provider:'finexer',status:state==='reconnect'?'expired':'authorized',accounts:1,expires_at:p.has('missing')?null:'2099-02-12T00:00:00Z',next_reconfirm_by:p.has('missing')?null:'2099-02-12T00:00:00Z'};
const card={account_id:account.id,name:account.name,provider:account.provider,balance:account.balance,currency:'GBP',card_class:'credit_card',source:'finexer',ask_eligible:false,terms:{status:'confirmed',apr_pct:22.9,promos:[],payment_method:'fixed',fixed_payment_amount:52.34,payment_due_day:8}};
function App(){const[open,setOpen]=useState(true),[pinned,setPinned]=useState(false),[included,setIncluded]=useState(true),[child,setChild]=useState(null);
const event=v=>window.fixture.events.push(v);
const refresh=async()=>{event('refresh');if(p.has('failure')&&refreshAttempts++===0)throw Error('fixture failure');return{refreshed:true,bank_synced_to:'2026-11-16T10:24:00Z'};};
return <><button id='opener' onClick={()=>setOpen(true)}>Account details</button>{open&&<SheetFrame title='Account details' variant='focused' mobileFullScreen={p.get('frame')!=='default'} onClose={()=>setOpen(false)} bodyClassName='px-5 pb-5' footer={({close})=><button type='button' className='min-h-12 w-full rounded-xl bg-indigo-600 px-4 py-3 text-sm font-semibold text-white' onClick={close}>Done</button>}>
{({closeThen})=><AccountDetailsContent account={account} name={account.name} providerLabel='Northbridge' kindLabel={kind==='credit'?'Credit card':kind==='savings'?'Savings':'Current account'} controlsTitle={kind==='credit'?'Card and Home':'Home and Left to spend'}
cardRows={kind==='credit'?<CardDetailsSections card={card} grouped hiddenOverride={hidden} onEditPayment={()=>closeThen(()=>{event('payment');setChild('Payment')})} onEditRates={()=>closeThen(()=>{event('rates');setChild('Rates and deals')})}/>:null}
inclusion={kind!=='credit'?<AccountCountRow account={account} counted={included} onChange={setIncluded} calm grouped lockedReason={p.has('locked')?'Included while this account is short for payments.':undefined}/>:null}
pinned={pinned} showPin pinDisabledReason={state==='reconnect'?'Reconnect this account before changing its Home pin.':undefined} onTogglePin={()=>{setPinned(!pinned);event('pin')}} deleting={false} onRemove={()=>closeThen(()=>event('remove'))}
connection={<AccountConnectionSummary account={account} providerLabel='Northbridge' pending={state==='never'} onRefresh={refresh} onReconnect={()=>closeThen(()=>event('reconnect'))}/>}
connectionDetails={<AccountConnectionEvidence account={account} connection={connection}/>}/>}</SheetFrame>}
{child&&<SheetFrame title={child} onClose={()=>{setChild(null);setOpen(true)}}><p>Child callback reached</p></SheetFrame>}</>}
createRoot(document.getElementById('root')).render(<App/>);
`;
let browser;
const server = createServer(async (req, res) => {
  try {
    const url = req.url ?? "/";
    if (["/bundle.js", "/styles.css"].includes(url)) {
      res.setHeader("Content-Type", url.endsWith(".css") ? "text/css; charset=utf-8" : "application/javascript; charset=utf-8");
      res.end(await readFile(path.join(out, url.slice(1))));
    } else if (url.startsWith("/fonts/")) {
      res.setHeader("Content-Type", "font/ttf");
      res.end(await readFile(path.join(process.cwd(), "public/design-media/c22/crafted/fonts", path.basename(url))));
    } else {
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.end(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/styles.css"><style>@font-face{font-family:Figtree;src:url(/fonts/Figtree.ttf);font-display:swap}:root{--font-figtree:Figtree}body{margin:0;font-family:Figtree,sans-serif;background:#f0f2f7}.dark{color-scheme:dark}.dark body{background:#0f172a}</style></head><body><main id="root"></main><script src="/bundle.js"></script></body></html>`);
    }
  } catch { res.statusCode = 404; res.end("missing"); }
});

try {
  await build({ stdin: { contents: entry, resolveDir: process.cwd(), loader: "tsx" }, bundle: true, loader: { ".css": "local-css" }, outfile: path.join(out, "bundle.js"), jsx: "automatic", define: { "process.env": "{}" } });
  const css = (await postcss([tailwind({ base: process.cwd() })]).process(await readFile("app/globals.css", "utf8"), { from: path.resolve("app/globals.css") })).css;
  await writeFile(path.join(out, "styles.css"), css + "\n" + await readFile(path.join(out, "bundle.css"), "utf8"));
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  browser = await openBrowser({ origin: `http://127.0.0.1:${server.address().port}`, output: evidence });
  const open = async query => { await browser.navigate(`/?${query}`, "document.querySelector('[data-g474-account-details]')"); };
  const metrics = () => browser.evaluate(`(()=>{
    const panel=document.querySelector('[data-sheet-frame]'),body=panel.querySelector('[data-sheet-body]'),identity=panel.querySelector('[aria-label="Account identity"]'),summary=panel.querySelector('summary'),disclosure=summary.parentElement,remove=disclosure.parentElement.nextElementSibling;
    const r=panel.getBoundingClientRect(),id=identity.getBoundingClientRect(),h=panel.querySelector('header').getBoundingClientRect(),f=panel.querySelector('[data-sheet-footer]').getBoundingClientRect(),s=summary.getBoundingClientRect(),text=summary.querySelector('span').getBoundingClientRect();
    const boxes=[...identity.children].map(e=>e.getBoundingClientRect());
    return{viewport:[innerWidth,innerHeight],panel:[r.left,r.top,r.right,r.bottom],identity:[Math.min(...boxes.map(b=>b.top))-h.bottom,id.bottom-parseFloat(getComputedStyle(identity).borderBottomWidth)-Math.max(...boxes.map(b=>b.bottom))],disclosure:[text.top-s.top,s.bottom-text.bottom],followingGap:remove.getBoundingClientRect().top-disclosure.getBoundingClientRect().bottom,followingBorder:parseFloat(getComputedStyle(remove).borderTopWidth),footerVisible:f.top>=r.top&&f.bottom<=r.bottom+1,bodyScrolls:body.scrollHeight>body.clientHeight,overflow:panel.scrollWidth>panel.clientWidth||document.documentElement.scrollWidth>innerWidth+1,small:[...panel.querySelectorAll('button,summary')].filter(e=>!e.disabled&&e.getBoundingClientRect().height<43.9).map(e=>e.textContent)};
  })()`);
  const readings = [];
  for (const width of [320, 390, 430, 768, 1440]) {
    await browser.viewport(width, width === 320 ? 720 : 900);
    for (const mode of ["light", "dark"]) for (const kind of ["current", "savings", "credit"]) for (const state of ["healthy", "reconnect", "never"]) {
      if ([430, 768].includes(width) && (kind !== "credit" || state !== "healthy")) continue;
      await open(`kind=${kind}&state=${state}&mode=${mode}${width === 320 ? "&long" : ""}`);
      const m = await metrics(); readings.push({ width, mode, kind, state, ...m });
      assert.equal(m.overflow, false, "no horizontal clipping");
      assert.equal(m.footerVisible, true, "Done stays in the visible sheet");
      assert.deepEqual(m.small, [], "44px targets");
      assert.ok(Math.abs(m.identity[0] - m.identity[1]) <= 1, `identity clearance ${m.identity}`);
      assert.ok(Math.abs(m.disclosure[0] - m.disclosure[1]) <= 1, `closed disclosure clearance ${m.disclosure}`);
      assert.ok(Math.abs(m.followingGap) <= 1 && m.followingBorder === 0, "no extra gap or duplicate rule below Connection details");
      if (width < 1024) assert.deepEqual(m.panel.map(Math.round), [0, 0, width, width === 320 ? 720 : 900], "mobile fills the entire visual viewport");
      else assert.ok(m.panel[2] - m.panel[0] <= 500 && m.panel[1] > 0, "desktop remains a centred dialog");
      assert.equal(await browser.evaluate("document.body.innerHTML.includes('1111222233332849')"), false, "only last four account digits enter the DOM");
      if ((width === 390 && (kind === "credit" || state === "healthy")) || (width === 1440 && kind === "credit" && state === "healthy")) {
        await browser.shot(`${kind}-${state}-${width}-${mode}`);
      }
    }
    console.log(`G474: ${width}px geometry passed`);
  }
  await browser.save("geometry", readings);
  await browser.viewport(390, 844);
  await open("kind=credit&state=reconnect&mode=dark");
  await browser.evaluate("document.querySelector('summary').scrollIntoView({block:'center'})");
  await browser.shot("connection-closed-bottom-dark");
  await browser.activate("document.querySelector('summary')");
  assert.equal(await browser.evaluate("document.querySelector('details').open"), true);
  await browser.evaluate("document.querySelector('summary').scrollIntoView({block:'start'})");
  await browser.shot("connection-open-dark");
  await browser.activate("document.querySelector('[aria-label=\"View account information\"]')");
  await browser.waitFor("document.querySelectorAll('[data-sheet-frame]').length===2");
  await browser.shot("identity-information-dark");
  await browser.activate("document.querySelectorAll('[data-sheet-frame]')[1].querySelector('[aria-label=\"Back to Account details\"]')");
  await browser.waitFor("document.querySelectorAll('[data-sheet-frame]').length===1");
  assert.equal(await browser.evaluate("document.activeElement?.getAttribute('aria-label')"), "View account information", "child dismissal restores its opener");
  await open("kind=current&mode=light&locked");
  assert.equal(await browser.evaluate("document.querySelector('[role=switch][aria-label=\"Include in Left to spend\"]').disabled"), true);
  await open("kind=current&mode=light");
  await browser.activate("document.querySelector('[role=switch][aria-label=\"Include in Left to spend\"]')");
  assert.equal(await browser.evaluate("document.querySelector('[role=switch][aria-label=\"Include in Left to spend\"]').getAttribute('aria-checked')"), "false");
  await browser.activate("document.querySelector('[role=switch][aria-label=\"Pin to Home\"]')");
  assert.equal(await browser.evaluate("document.querySelector('[role=switch][aria-label=\"Pin to Home\"]').getAttribute('aria-checked')"), "true");
  await open("kind=credit&mode=dark&hidden&missing&failure");
  assert.equal(await browser.evaluate("document.body.innerHTML.includes('52.34')"), false, "fixed payments respect hidden balances");
  assert.match(await browser.evaluate("document.body.innerText"), /not supplied/);
  await browser.activate("document.querySelector('[data-a179-refresh-button]')");
  await browser.waitFor("document.querySelector('[data-a179-refresh-note]').textContent.includes('could not')");
  await browser.activate("document.querySelector('[data-a179-refresh-button]')");
  await browser.waitFor("!document.querySelector('[data-a179-refresh-note]').textContent");
  for (const [selector, event] of [["[data-card-entry=payment]", "payment"], ["[data-card-entry=rates]", "rates"]]) {
    await open("kind=credit&mode=dark");
    await browser.activate(`document.querySelector('${selector}')`);
    await browser.waitFor(`window.fixture.events.includes('${event}')`);
    assert.equal(await browser.evaluate("document.querySelectorAll('[data-sheet-frame]').length"), 1, "navigation consumes the parent sheet first");
  }
  await open("kind=credit&state=reconnect&mode=dark");
  assert.equal(await browser.evaluate("document.querySelector('[role=switch]').disabled"), true, "ended connection cannot change its pin");
  await browser.activate("Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='Reconnect Northbridge')");
  await browser.waitFor("window.fixture.events.includes('reconnect')");
  await open("kind=credit&mode=light");
  await browser.activate("Array.from(document.querySelectorAll('button')).find(b=>b.textContent.includes('Remove account'))");
  await browser.waitFor("window.fixture.events.includes('remove')");
  await open("kind=credit&mode=light");
  await browser.activate("document.querySelector('[aria-label=\"Close Account details\"]')");
  await browser.waitFor("!document.querySelector('[data-sheet-frame]')");
  await browser.activate("document.querySelector('#opener')");
  await browser.waitFor("document.querySelector('[data-sheet-frame]')");
  await browser.key("Escape", "Escape", 27);
  await browser.waitFor("!document.querySelector('[data-sheet-frame]')");
  assert.equal(await browser.evaluate("document.activeElement?.id"), "opener");
  await open("kind=credit&mode=light&frame=default");
  const defaultTop = await browser.evaluate("document.querySelector('[data-sheet-frame]').getBoundingClientRect().top");
  assert.ok(defaultTop > 0, "other focused sheets retain their existing mobile inset");
  assert.deepEqual(browser.exceptions, [], "no browser exceptions");
  assert.deepEqual(browser.apiRequests, [], "fixture never calls a live API");
  await browser.save("flows", { passed: true, cases: readings.length, checks: ["identity symmetry", "closed disclosure symmetry", "full mobile viewport", "fixed footer", "child focus and Back", "locked inclusion", "pin and inclusion", "privacy", "missing facts", "refresh failure and retry", "separate card callbacks", "reconnect", "remove callback", "Escape and focus restore", "other-sheet inset preserved"], apiRequests: browser.apiRequests });
  console.log(`G474 account details: ${readings.length} geometry cases and interaction checks passed`);
} finally {
  browser?.close();
  if (server.listening) await new Promise(resolve => server.close(resolve));
  await rm(out, { recursive: true, force: true });
}
