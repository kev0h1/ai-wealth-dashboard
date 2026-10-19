import assert from "node:assert/strict";
import { openBrowser } from "../../../scripts/g293-browser-helper.mjs";

const b = await openBrowser({ origin: process.env.G295_TEST_ORIGIN || "http://127.0.0.1:3158", output: process.argv[2] });
const results = [];
const layoutErrors = [];
// The app's shared scroll restorer remembers this preview's own scroll.
// No account, preference, product handoff or other route key may change.
const storageSnapshot = "({local:{...localStorage},session:Object.fromEntries(Object.entries(sessionStorage).filter(([key])=>!key.startsWith('wd_scroll:/design/home-brief-anatomy?')))})";
const navigate = (variant, state, mode, clean = true) => b.navigate(`/design/home-brief-anatomy?${new URLSearchParams({ variant, state, mode, clean: clean ? "1" : "0" })}`, `document.querySelector('[data-g295-preview][data-g295-ready="true"][data-view="${state}"][data-variant="${variant}"]') && document.documentElement.classList.contains('dark') === ${mode === "dark"}`);
const cases = [];
for (const mode of ["light", "dark"]) for (const variant of ["a", "b"]) {
  for (const state of ["focus", "family", "edges", "hidden", "empty"]) cases.push({ mode, variant, state, width: 390 });
  for (const state of ["family", "edges"]) cases.push({ mode, variant, state, width: 320 });
  for (const width of [768, 1280]) cases.push({ mode, variant, state: "family", width });
}
for (const mode of ["light", "dark"]) cases.push({ mode, variant: "reference", state: "focus", width: 390 });

try {
  for (const { width, mode, variant, state } of cases) {
    await b.viewport(width);
    await navigate(variant, state, mode);
    const m = await b.evaluate(`(() => {
      const box=e=>{const r=e.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom}};
      return {width:innerWidth,overflow:document.documentElement.scrollWidth>innerWidth+1,
        cards:[...document.querySelectorAll('[data-example]')].map(ex=>{
          const kind=ex.dataset.kind,key=ex.dataset.example;
          const root=kind==='tip'?ex.firstElementChild?.firstElementChild:kind==='month'?ex.querySelector('.glass-card'):ex.firstElementChild;
          const header=kind==='tip'?root.querySelector('button:last-child'):kind==='payday'?root.firstElementChild.firstElementChild:root.firstElementChild;
          const headline=kind==='tip'?header.querySelector('p.font-bold'):kind==='payday'?header.querySelector('h2'):header?.querySelector('p');
          const lead=root.querySelector('[data-brief-lead],[data-move-lead],[data-total-moving]');
          const dismiss=root.querySelector('button[aria-label="Hide on Home"],button[aria-label^="Dismiss"]');
          const body=[...root.children].find(e=>e.tagName==='P');
          const tile=header?.querySelector(':scope > span[aria-hidden="true"]');
          return {key,kind,root:box(root),headline:headline?box(headline):null,lead:lead?box(lead):null,body:body?box(body):null,dismiss:dismiss?box(dismiss):null,
            tile:tile?{box:box(tile),display:getComputedStyle(tile).display,svg:tile.querySelector('svg')?box(tile.querySelector('svg')):null}:null,
            text:root.innerText,targets:[...root.querySelectorAll('button,a')].filter(e=>e.getClientRects().length).map(e=>({label:e.getAttribute('aria-label')||e.textContent.trim(),...box(e)}))};
        })};
    })()`);
    assert.equal(m.width, width);
    assert.equal(m.overflow, false, `${width}/${mode}/${variant}/${state} no horizontal overflow`);
    for (const card of m.cards) {
      if (variant === "reference" || card.key === "deferred") continue;
      try {
      assert.ok(card.root.x >= 0 && card.root.right <= width + 1, `card stays inside viewport, not hidden by shell clipping: ${JSON.stringify({ width, key: card.key, root: card.root })}`);
      if (card.headline) assert.ok(Math.abs(card.headline.x - card.root.x - 17) < 1.5, `one 16px reading inset ${JSON.stringify({ width, mode, variant, state, card })}`);
      if (card.lead && card.headline) assert.ok(Math.abs(card.lead.x - card.headline.x) < 1.5, "lead shares headline edge");
      if (card.body && card.headline) assert.ok(Math.abs(card.body.x - card.headline.x) < 1.5, "body shares headline edge");
      if (card.dismiss && card.headline && card.headline.y < card.dismiss.bottom && card.headline.bottom > card.dismiss.y) assert.ok(card.headline.right <= card.dismiss.x + 1, "header does not sit beneath dismiss");
      if (card.tile) {
        assert.equal(card.tile.display, variant === "a" ? "none" : "contents");
        if (variant === "b") assert.equal(card.tile.svg.width, 16, "inline cue is not a tile column");
      }
      for (const target of card.targets) if (target.label !== "See the payments" || card.kind !== "tip") assert.ok(target.height >= 43.5, `44px action ${JSON.stringify({ width, card: card.key, target })}`);
      if (state === "hidden") assert.doesNotMatch(card.text, /£[\d,]+/);
      } catch (error) { layoutErrors.push({ width, mode, variant, state, key: card.key, error: error.message }); }
    }
    if (width === 390 && state === "focus") await b.shot(`${variant}-${mode}-reported`, { full: true });
    if (width === 390 && state === "family" && mode === "dark") await b.shot(`${variant}-dark-family`, { full: true });
    if (width === 320 && state === "edges" && mode === "light") await b.shot(`${variant}-narrow-optional`, { full: true });
    if (width === 1280 && mode === "light" && variant === "a") await b.shot("a-desktop-family");
    results.push({ width, mode, variant, state, ...m });
  }
  await b.save("layout-results", { results, layoutErrors });
  await b.viewport(390);
  await navigate("a", "focus", "light");
  const storageBefore = await b.evaluate(storageSnapshot);
  await b.activate(`document.querySelector('[data-example="covered"] [role="button"]')`);
  await b.waitFor(`document.querySelector('[data-preview-feedback]').textContent.includes('/upcoming')`);
  await b.activate(`document.querySelector('[data-example="card-detail"] button')`);
  await b.waitFor(`document.querySelector('[data-preview-feedback]').textContent.includes('/accounts?cardTerms=1')`);
  await b.evaluate(`document.querySelector('[data-example="debt"] footer a').focus()`);
  await b.key("Tab", "Tab", 9);
  assert.equal(await b.evaluate(`document.activeElement.matches('[data-example="debt"] button[aria-label="Hide on Home"]')`), true, "natural Tab order reaches the unchanged dismiss control");
  await b.key("Enter", "Enter", 13);
  await b.waitFor(`!document.querySelector('[data-example="debt"]')`);
  await b.activate(`[...document.querySelectorAll('button')].find(e=>e.textContent==='Reset examples')`);
  await b.waitFor(`document.querySelector('[data-example="debt"]')`);
  await b.activate(`[...document.querySelectorAll('[data-example="card-detail"] button')].find(e=>e.textContent.trim()==='Not now')`);
  await b.waitFor(`!document.querySelector('[data-example="card-detail"]')`);
  assert.deepEqual(await b.evaluate(storageSnapshot), storageBefore);
  await navigate("b", "family", "dark");
  const familyStorage = await b.evaluate(storageSnapshot);
  await b.activate(`document.querySelector('[data-example="payday"] button[aria-label="Dismiss"]')`);
  await b.waitFor(`!document.querySelector('[data-example="payday"]')`);
  await b.activate(`[...document.querySelectorAll('[data-example="rhythm"] button')].find(e=>e.textContent.trim()==='A one-off')`);
  await b.waitFor(`document.querySelector('[data-example="rhythm"]').textContent.includes('Noted, one-off.')`);
  await b.activate(`[...document.querySelectorAll('[data-example="rhythm"] button')].find(e=>e.textContent.trim()==='See the payments')`);
  await b.activate(`document.querySelector('[data-example="allocation"] button:not([aria-label])')`);
  await b.waitFor(`document.querySelector('[data-preview-feedback]').textContent.includes('Adjust set-aside')`);
  await b.activate(`document.querySelector('[data-example="tip"] button:last-child')`);
  assert.deepEqual(await b.evaluate(storageSnapshot), familyStorage);
  assert.equal(await b.evaluate("location.pathname"), "/design/home-brief-anatomy");
  await navigate("a", "focus", "light", false);
  await b.shot("review-controls", { full: true });
  assert.deepEqual(b.exceptions, []);
  assert.deepEqual(b.apiRequests, []);
  await b.save("results", { layouts: results.length, interactions: "local touch and keyboard controls, reset, real preview-mode answer, guarded routes and unsafe actions, unchanged product storage excluding this preview's own scroll memory", results });
  assert.deepEqual(layoutErrors, [], "batched layout findings");
  console.log(JSON.stringify({ layouts: results.length, output: b.output }));
} finally { b.close(); }
