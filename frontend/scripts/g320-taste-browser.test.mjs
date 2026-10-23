// Manual synthetic CDP QA for the G320 cash-and-cards taste round.
// This visits only fixed preview fixtures and intentionally blocks APIs.
import assert from "node:assert/strict";
import { openBrowser } from "./_plan-browser.mjs";

const b = await openBrowser({
  origin: process.env.PLAN_QA_ORIGIN ?? "http://127.0.0.1:3203",
  output: process.env.PLAN_QA_OUTPUT ?? "/tmp/g320-r3-qa",
});
const variants = ["g", "h", "i"];
const scenarios = ["cards-purchases", "cards-monthly", "cards-reserve", "cards-move", "cards-shared", "cards-large", "cards-none", "payments-short"];
const floorCopy = "The amount available above cannot fall below £0, so the shortfall stays visible here.";
let checks = 0;
const route = (variant, scenario, mode, hide = 0) =>
  `/design/spend-from-line?variant=${variant}&scenario=${scenario}&mode=${mode}&hide=${hide}`;
const visible = "node=>Boolean(node&&node.checkVisibility())";

async function visit(variant, scenario, mode, hide = 0, width = 390) {
  await b.viewport(width, width === 320 ? 740 : 900);
  try {
    const ready = await b.evaluate("document.documentElement?.dataset.g320Ready==='true'&&location.pathname==='/design/spend-from-line'");
    if (ready) {
      await b.evaluate(`history.pushState(null,'',${JSON.stringify(route(variant, scenario, mode, hide))})`);
    } else {
      await b.navigate(route(variant, scenario, mode, hide), "document.documentElement?.dataset.g320Ready==='true'");
    }
    const expected = JSON.stringify({ variant, scenario, mode, hide: String(hide) });
    await b.waitFor(`(()=>{const a=document.querySelector('nav[aria-label="Design preview controls"] a[aria-current="true"]');if(!a)return false;const p=new URL(a.href).searchParams;return Object.entries(${expected}).every(([key,value])=>p.get(key)===value)})()`);
    await b.evaluate("document.querySelectorAll('[data-g320-card] details').forEach(node=>{node.open=false});scrollTo({top:0,left:0,behavior:'instant'})");
    await b.settle();
  } catch (error) {
    console.error(JSON.stringify({ variant, scenario, mode, hide, exceptions: b.exceptions, assets: await b.evaluate("performance.getEntriesByType('resource').filter(e=>e.initiatorType==='script').map(e=>({name:e.name,status:e.responseStatus,duration:e.duration}))") }));
    throw error;
  }
  await b.waitFor("Boolean(document.querySelector('[data-g320-card]'))");
  assert.deepEqual(b.exceptions, [], `${variant}/${scenario}: browser exception`);
  assert.deepEqual(b.apiRequests, [], `${variant}/${scenario}: preview must not request an API`);
}

async function facts() {
  return b.evaluate(`(()=>{
    const text=n=>n?.innerText?.trim()??"", attrs=n=>n?[n,...n.querySelectorAll('*')].flatMap(x=>[...x.attributes].filter(a=>a.name.startsWith('aria-')).map(a=>a.value)).join(' '):"";
    const q=s=>document.querySelector(s), qa=s=>[...document.querySelectorAll(s)];
    const card=q('[data-g320-card]'), root=q('[data-g320-taste]'), main=q('[data-taste-main]'), secondary=q('[data-taste-secondary]');
    const box=n=>{const r=n?.getBoundingClientRect();return r&&{left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height,overflow:n.scrollWidth>n.clientWidth,visible:n.checkVisibility()}};
    const accountRows=qa('[data-g320-account]').map(n=>({id:n.dataset.g320Account,text:text(n),limit:text(n.querySelector('[data-g320-limit]')),box:box(n)}));
    const scope=q('main[data-g320-ready]');
    const all=[scope?.textContent??'',attrs(scope)].join(' ');
    const cashSpan=q('[data-taste-cash] span')??q('#safe-to-spend-heading span');
    return {
      cardCount:qa('[data-g320-card]').length, card:box(card), variant:root?.dataset.g320Taste??null,
      // Current is deliberately read from its production heading; taste cards
      // expose the same derived verdict through their labelled cash figure.
      headline:text(q('#safe-to-spend-heading')??q('[data-taste-cash]')), tone:q('[data-forecast-tone]')?.dataset.forecastTone??q('[data-forecast-tone]')?.textContent?.trim()??null,
      status:text(q('[data-forecast-tone]')), counts:text(q('[data-sts-counts]')), countsCount:qa('[data-sts-counts]').length, disclaimer:text(q('[data-sts-disclaimer]')),
      footerLinks:qa('[data-g320-card] a[href="/accounts"]').map(a=>({label:text(a),href:a.getAttribute('href')})),
      actions:qa('[data-g320-card] a,[data-g320-card] button').map(a=>a.textContent.trim()), main:box(main), secondary:box(secondary),
      cash:box(q('[data-taste-cash]')), cashFont:cashSpan?getComputedStyle(cashSpan).fontSize:null, cardAmount:qa('[data-taste-card-amount]').map(n=>({text:text(n),box:box(n),font:getComputedStyle(n).fontSize})),
      readout:box(q('[data-taste-card-readout]')), context:box(q('[data-taste-card-context]')), reserve:box(q('[data-taste-reserve]')),
      details:q('[data-taste-activity-details]')?{open:q('[data-taste-activity-details]').open, bodyVisible:q('[data-taste-activity-details] > div')?.checkVisibility()??false}:null,
      working:q('[data-taste-working]')?{open:q('[data-taste-working]').open, text:text(q('[data-taste-working]'))}:null,
      accounts:accountRows, all, body:text(document.body), rootCount:qa('[data-g320-taste]').length,
      mainCount:qa('[data-taste-main]').length, secondaryCount:qa('[data-taste-secondary]').length,
    };
  })()`);
}

function financial(f, scenario, label) {
  if (scenario === "cards-purchases") {
    assert.match(f.body, /£1,947/, `${label}: card purchases stay separate`);
    assert.equal(f.headline, "£242", `${label}: cash verdict remains £242`);
    assert.deepEqual(f.cardAmount.map(a=>a.text), ["+£1,947"], `${label}: the secondary figure is purchases`);
    assert.doesNotMatch(f.headline, /1,947/, `${label}: purchases do not replace cash verdict`);
  }
  if (scenario === "cards-monthly") assert.match(f.body, /Due around 28 Oct/, `${label}: confirmed bill date is visible`);
  if (scenario === "cards-reserve") {
    assert.equal(f.headline, "£0", `${label}: reserve headline is zero`);
    assert.deepEqual(f.cardAmount.map(a=>a.text), ["+£325"], `${label}: the reserve headline uses true card growth, not £200 purchases`);
    assert.match(f.body, /£325/, `${label}: true card growth reserve is £325, not purchases £200`);
    assert.match(f.body, /£73 safety shortfall/, `${label}: shortfall remains visible`);
    assert.equal(f.accounts.length, 0, `${label}: reserve offers no account candidates`);
    assert.equal(f.reserve?.visible, true, `${label}: reserve warning is visible`);
  }
  if (scenario === "payments-short") {
    assert.match(f.headline, /−£573/, `${label}: genuine payment shortfall is signed`);
    assert.equal(f.status, "Short", `${label}: payment shortfall has the correct status`);
    assert.equal(f.tone, "risk", `${label}: only the dated payment gap establishes red`);
    assert.equal(f.accounts.length, 0, `${label}: payment shortfall offers no account candidates`);
  }
  if (scenario === "cards-shared") assert.ok(f.accounts.every(a=>a.limit===''), `${label}: shared pool is not repeated per bank`);
  if (scenario === "cards-purchases" || scenario === "cards-monthly" || scenario === "cards-move") {
    const limits = Object.fromEntries(f.accounts.map(a => [a.id, a.limit]));
    assert.deepEqual(limits, { natwest: "£96", starling: "£54" }, `${label}: lower limits stay on their own rows`);
  }
}

function layout(f, variant, scenario, label, width) {
  assert.equal(f.cardCount, 1, `${label}: one preview card`);
  assert.equal(f.rootCount, 1, `${label}: one taste root`);
  assert.equal(f.variant, variant, `${label}: selected taste variant`);
  assert.equal(f.card.visible, true, `${label}: card is painted`);
  assert.equal(f.card.overflow, false, `${label}: card has no horizontal overflow`);
  assert.ok(f.card.left >= -1 && f.card.right <= width + 1, `${label}: card fits viewport`);
  assert.equal(f.mainCount, 1, `${label}: one cash surface`);
  assert.equal(f.countsCount, 1, `${label}: counts scope is not duplicated`);
  assert.equal(f.cashFont, "30px", `${label}: cash remains the primary 30px figure`);
  assert.equal(f.footerLinks.length, 1, `${label}: one accounts footer call to action`);
  for (const row of f.accounts) {
    assert.equal(row.box.visible, true, `${label}: ${row.id} is visible`);
    assert.equal(row.box.overflow, false, `${label}: ${row.id} has no overflow`);
    assert.ok(row.box.left >= -1 && row.box.right <= width + 1, `${label}: ${row.id} fits`);
  }
  for (const amount of f.cardAmount) assert.ok(parseFloat(amount.font)<=19, `${label}: card figure is quieter than 30px cash figure`);
  if (variant === "g") {
    if (f.cardAmount.length) assert.equal(f.readout?.visible, true, `${label}: G exposes its card readout`);
    if (f.cardAmount.length && scenario !== "cards-reserve") assert.equal(f.context?.visible, true, `${label}: G has card context`);
    if (scenario === "cards-purchases" && width === 390) {
      assert.ok(f.readout.left >= f.cash.right - 2 && Math.abs(f.readout.top - f.cash.top) < 50, `${label}: normal G cash and card readout sit beside each other`);
    }
  }
  if (variant === "i") {
    assert.equal(f.secondaryCount, scenario === "cards-none" ? 0 : 1, `${label}: I has a second surface only when activity exists`);
  }
  if (scenario === "cards-large") assert.equal(f.card.overflow, false, `${label}: long monetary text fits`);
}

function privacy(f, label, hide) {
  if (!hide) return;
  const privateText = f.all.replaceAll(floorCopy, "zero floor guidance");
  assert.doesNotMatch(privateText, /(?:−|\+)?£\s*\d/, `${label}: private money is masked in visible text and ARIA`);
}

function compareCurrent(actual, baseline, label) {
  for (const key of ["headline", "tone", "status", "counts", "disclaimer"]) assert.equal(actual[key], baseline[key], `${label}: ${key} matches current baseline`);
  assert.deepEqual(actual.footerLinks, baseline.footerLinks, `${label}: footer link label and href match baseline`);
  assert.deepEqual(actual.actions, baseline.actions, `${label}: action labels match current baseline`);
}

const baselineCache = new Map();
async function baseline(scenario, mode, hide) {
  const key = `${scenario}/${mode}/${hide}`;
  if (baselineCache.has(key)) return baselineCache.get(key);
  await visit("current", scenario, mode, hide);
  const value = await facts();
  baselineCache.set(key, value);
  return value;
}

async function caseCheck(variant, scenario, mode, hide = 0, width = 390, compare = true) {
  const base = compare ? await baseline(scenario, mode, hide) : null;
  await visit(variant, scenario, mode, hide, width);
  const f = await facts(), label = `${variant}/${scenario}/${mode}/hide-${hide}/${width}`;
  layout(f, variant, scenario, label, width);
  privacy(f, label, hide);
  if (!hide) financial(f, scenario, label);
  if (base) compareCurrent(f, base, label);
  checks++;
  return f;
}
async function capture(name) { await b.shot(name, { full: true }); checks++; return name; }

try {
  // Query-selected fixed data must already be masked in server-rendered HTML,
  // before client hydration can correct or change anything.
  for (const [v, scenario] of [["g", "cards-purchases"], ["i", "cards-reserve"]]) {
    const response = await fetch((process.env.PLAN_QA_ORIGIN ?? "http://127.0.0.1:3203") + route(v, scenario, "light", 1));
    assert.equal(response.status, 200);
    const html = await response.text();
    const initial = await b.evaluate(`(()=>{const d=new DOMParser().parseFromString(${JSON.stringify(html)},'text/html');d.querySelectorAll('script,style').forEach(n=>n.remove());const m=d.querySelector('main[data-g320-ready]');return {cash:Boolean(m?.querySelector('[data-taste-cash]')),text:m?.textContent??'',aria:m?[m,...m.querySelectorAll('*')].flatMap(n=>[...n.attributes].filter(a=>a.name.startsWith('aria-')).map(a=>a.value)).join(' '):''}})()`);
    assert.equal(initial.cash, true, `${v}: cash content exists in the HTML response`);
    assert.doesNotMatch((initial.text + initial.aria).replaceAll(floorCopy, "zero floor guidance"), /£\s*\d/, `${v}: initial HTML already hides private figures`);
    checks++;
  }
  if (!process.env.G320_CONFIRM_ONLY) {
    for (const variant of variants) for (const mode of ["light", "dark"]) for (const hide of [0, 1]) for (const scenario of scenarios) {
      await caseCheck(variant, scenario, mode, hide);
    }
  }

  // Edge identity and fit checks use the same fixed fixtures.
  for (const scenario of ["same-bank", "unknown", "overlap", "shared-two"]) {
    const f = await caseCheck("g", scenario, "light");
    assert.ok(f.accounts.every(a => a.text.length > 3), `${scenario}: important account names remain readable`);
    if (scenario === "overlap") assert.match(f.body, /not amounts to add together/, "overlap: limits are explicitly non-additive");
  }

  // H's native disclosure must be visibly closed and keyboard-operable.
  await caseCheck("h", "cards-purchases", "light");
  assert.equal(await b.evaluate(`(${visible})(document.querySelector('[data-taste-activity-details] > div'))`), false, "H details begin visually closed");
  await b.evaluate("document.querySelector('[data-taste-activity-details] summary').focus()");
  await b.key("Enter", "Enter", 13);
  await b.waitFor("document.querySelector('[data-taste-activity-details]').open");
  assert.equal(await b.evaluate(`(${visible})(document.querySelector('[data-taste-activity-details] > div'))`), true, "H details open from keyboard");
  let hOpen = await facts();
  assert.match(hOpen.body, /Purchases only/, "H open details explain card scope");

  // Cash working remains a native, reconciled calculation without a double deduction.
  await caseCheck("g", "cards-reserve", "light");
  await b.evaluate("document.querySelector('[data-taste-working] summary').focus()");
  await b.key("Enter", "Enter", 13);
  await b.waitFor("document.querySelector('[data-taste-working]').open");
  const reserveWorking = await facts();
  assert.match(reserveWorking.working.text, /Card safety check/i, "cash working exposes safety calculation");
  assert.match(reserveWorking.working.text, /Unconfirmed card reserve.*−£325/s, "reserve is separately deducted once");
  assert.match(reserveWorking.working.text, /Safety position.*−£73/s, "safety calculation reconciles to £73 shortfall");

  const captures = [];
  for (const v of variants) for (const m of ["light", "dark"]) { await caseCheck(v, "cards-purchases", m); captures.push(await capture(`${v}-purchases-${m}`)); }
  for (const v of variants) { await caseCheck(v, "cards-reserve", "light"); captures.push(await capture(`${v}-reserve-light`)); }
  for (const v of variants) { await caseCheck(v, "payments-short", "dark"); captures.push(await capture(`${v}-payments-short-dark`)); }
  await caseCheck("g", "cards-monthly", "light"); captures.push(await capture("g-monthly-light"));
  await caseCheck("h", "cards-monthly", "dark"); captures.push(await capture("h-monthly-dark"));
  await caseCheck("i", "cards-move", "light"); captures.push(await capture("i-move-light"));
  await caseCheck("g", "cards-large", "light"); captures.push(await capture("g-large-light"));
  await caseCheck("h", "cards-purchases", "light", 1); captures.push(await capture("h-purchases-hidden-light"));
  await caseCheck("h", "cards-purchases", "light");
  await b.evaluate("document.querySelector('[data-taste-activity-details] summary').focus()");
  await b.key("Enter", "Enter", 13);
  await b.waitFor("document.querySelector('[data-taste-activity-details]').open");
  captures.push(await capture("h-details-open-light"));
  for (const v of variants) { await caseCheck(v, "cards-purchases", "light", 0, 1280); captures.push(await capture(`${v}-desktop-light`)); }
  assert.equal(captures.length, 21, "bounded full-page evidence manifest");

  for (const width of [320, 1280]) for (const variant of variants) for (const mode of ["light", "dark"]) {
    await caseCheck(variant, "cards-purchases", mode, 0, width, false);
    await caseCheck(variant, "cards-purchases", mode, 1, width, false);
    await caseCheck(variant, "cards-large", mode, 0, width, false);
  }
  assert.deepEqual(b.exceptions, [], "no browser exceptions");
  assert.deepEqual(b.apiRequests, [], "no API requests");
  await b.save("results", { checks, captures, exceptions: b.exceptions, apiRequests: b.apiRequests });
  console.log(JSON.stringify({ checks, captures: captures.length, exceptions: b.exceptions, apiRequests: b.apiRequests }));
} finally {
  b.close();
}
