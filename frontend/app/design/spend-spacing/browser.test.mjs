import assert from "node:assert/strict";
import { openBrowser } from "./qa-browser.mjs";

const b = await openBrowser({ origin: process.env.G293_TEST_ORIGIN || "http://127.0.0.1:3157", output: process.argv[2] });
const results = [];
const navigate = (variant, state, mode, clean = true) => b.navigate(`/design/spend-spacing?${new URLSearchParams({ variant, state, mode, clean: clean ? "1" : "0" })}`, `document.querySelector('[data-g293-ready="true"][data-g293-state="${state}"]') && document.documentElement.classList.contains('dark') === ${mode === "dark"}`);
try {
  for (const width of [320, 390, 768, 1280]) for (const mode of ["light", "dark"]) for (const variant of ["a", "b", "reference"]) for (const state of ["current", "completed", "year", "empty"]) {
    await b.viewport(width);
    await navigate(variant, state, mode);
    const m = await b.evaluate(`(() => {
      const page=document.querySelector('[data-g293-page]'),controls=document.querySelector('[data-g293-controls]'),head=page.querySelector('header'),hero=page.querySelector('[data-g186-hero]'),grid=document.querySelector('[data-g293-content]');
      const box=e=>{const r=e.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height,bottom:r.bottom,right:r.right}};
      const back=[...controls.querySelectorAll('button')].find(e=>e.textContent.includes('Back to this period'));
      const keys=['[data-period-picker]','[aria-label="Previous pay period"]','[aria-label="Next pay period"]','[aria-label="Search transactions"]'];
      return{width:innerWidth,overflow:document.documentElement.scrollWidth>innerWidth+1,page:box(page),head:box(head),controls:box(controls),hero:box(hero),gap:hero.getBoundingClientRect().y-controls.getBoundingClientRect().bottom,
        headerPadding:getComputedStyle(head).paddingBottom,gridMargin:getComputedStyle(grid).marginTop,back:back?box(back):null,
        targets:keys.map(key=>box(controls.querySelector(key))),font:getComputedStyle(hero.querySelector('[data-out-amount]')).fontSize,
        amount:hero.querySelector('[data-out-amount]').textContent,period:controls.querySelector('[data-period-label]').textContent,
        year:controls.querySelector('[data-period-title]').textContent,columns:getComputedStyle(grid).gridTemplateColumns};
    })()`);
    assert.equal(m.width, width);
    assert.equal(m.overflow, false, JSON.stringify({ width, mode, variant, state, m }));
    assert.ok(Math.abs(m.gap - (variant === "a" ? 20 : variant === "b" ? 12 : 28)) < .5, "one deliberate content gap");
    assert.equal(m.headerPadding, variant === "reference" ? "20px" : "0px");
    assert.ok(m.targets.every(r => r.width >= 44 && r.height >= 44), "all period controls remain 44px");
    assert.equal(m.font, "30px", "hero typography stays approved");
    assert.equal(Boolean(m.back), state === "completed");
    if (m.back) assert.ok(Math.abs(m.back.y - m.head.bottom - 12) < .5, "Back stays inside navigation group");
    assert.ok(m.hero.x >= 0 && m.hero.right <= width + 1);
    if (width < 1024) assert.equal(m.columns.split(" ").length, 1, "mobile keeps the real stacked topology");
    else assert.equal(m.columns.split(" ").length, 2, "desktop keeps the two-column topology");
    if (state === "year") assert.match(m.year, /2026 to 2027/);
    if (width === 390 && variant !== "reference" && ["current", "completed"].includes(state)) await b.shot(`${variant}-${mode}-${state}`);
    if (variant === "a" && mode === "dark" && width === 320 && state === "year") await b.shot("a-narrow-year");
    if (variant === "b" && mode === "light" && width === 1280 && state === "completed") await b.shot("b-desktop-completed");
    results.push({ width, mode, variant, state, ...m });
  }
  await b.viewport(390);
  await navigate("b", "current", "dark");
  await b.activate(`document.querySelector('[aria-label="Previous pay period"]')`);
  await b.waitFor(`document.querySelector('[data-g293-state="completed"]')`);
  await b.activate(`[...document.querySelectorAll('[data-g293-controls] button')].find(e=>e.textContent.includes('Back to this period'))`);
  await b.waitFor(`document.querySelector('[data-g293-state="current"]')`);
  await b.activate(`document.querySelector('[data-period-picker]')`);
  await b.waitFor(`document.querySelector('[data-sheet-frame]') && document.activeElement.closest('[data-sheet-frame]')`);
  await b.key("Escape", "Escape", 27);
  await b.waitFor(`!document.querySelector('[data-sheet-frame]')`);
  await b.waitFor(`document.activeElement===document.querySelector('[data-period-picker]')`);
  await b.key("Tab", "Tab", 9);
  assert.equal(await b.evaluate(`document.activeElement.getAttribute('aria-label')`), "Previous pay period");
  await b.key("Tab", "Tab", 9);
  assert.equal(await b.evaluate(`document.activeElement.getAttribute('aria-label')`), "Search transactions");
  await b.activate(`document.querySelector('[aria-label="Search transactions"]')`);
  assert.equal(await b.evaluate("location.pathname"), "/design/spend-spacing", "Search stays local in preview");
  await b.activate(`document.querySelector('[aria-label="Show income payments"]')`);
  assert.equal(await b.evaluate(`document.querySelector('[aria-label="Show income payments"]').getAttribute('aria-expanded')`), "true");
  await b.activate(`document.querySelector('[data-g186-hero] summary')`);
  assert.equal(await b.evaluate(`document.querySelector('[data-g186-hero] details').open`), true);
  await b.viewport(390);
  await navigate("a", "current", "light", false);
  await b.shot("comparison-controls", { full: true });
  assert.deepEqual(b.exceptions, []);
  assert.deepEqual(b.apiRequests, []);
  await b.save("results", { layouts: results.length, interactions: "touch navigation, return, native sheet Escape/focus, Tab order, local Search and income/ledger disclosures", exceptions: b.exceptions, apiRequests: b.apiRequests, results });
  console.log(JSON.stringify({ layouts: results.length, interactions: "passed", output: b.output }));
} finally { b.close(); }
