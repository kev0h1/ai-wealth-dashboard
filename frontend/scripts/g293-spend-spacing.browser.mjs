// Real source-extracted Spend shell + real components and built CSS/fonts.
// Isolated layout evidence only, not an authenticated page or callback test.
import assert from "node:assert/strict";
import { openBrowser } from "./g293-browser-helper.mjs";
import { renderSpendShell } from "./g293-spend-spacing.test.mjs";

const b = await openBrowser({ origin: process.env.G293_TEST_ORIGIN || "http://127.0.0.1:3157", output: process.argv[2] });
const results = [];
try {
  for (const mode of ["light", "dark"]) {
    await b.viewport(390);
    await b.navigate(`/design/spend-live?mode=${mode}&state=normal`, `document.querySelector('[data-g285-period-bar]') && document.documentElement.classList.contains('dark') === ${mode === "dark"}`);
    const documentShell = await b.evaluate(`(() => {
      const head=document.head.cloneNode(true);head.querySelectorAll('script').forEach(e=>e.remove());
      return {head:head.innerHTML,html:document.documentElement.className,body:document.body.className};
    })()`);
    for (const width of [320, 390, 768, 1280]) for (const state of ["current", "completed", "year", "empty"]) {
      await b.viewport(width);
      const html = `<!doctype html><html class="${documentShell.html}"><head>${documentShell.head}</head><body class="${documentShell.body}">${renderSpendShell(state)}</body></html>`;
      const { frameTree } = await b.call("Page.getFrameTree");
      await b.call("Page.setDocumentContent", { frameId: frameTree.frame.id, html });
      await b.waitFor(`document.querySelector('[data-g186-hero]') && document.querySelector('[data-g293-shell]')`);
      await b.settle();
      const m = await b.evaluate(`(() => {
        const page=document.querySelector('[data-g293-shell]'),head=page.querySelector('header'),hero=page.querySelector('[data-g186-hero]'),grid=page.querySelector('[data-g293-grid]');
        const box=e=>{const r=e.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height,bottom:r.bottom,right:r.right}};
        const back=[...page.querySelectorAll('button')].find(e=>e.textContent.includes('Back to this period'));
        const controls=['[data-period-picker]','[aria-label="Previous pay period"]','[aria-label="Next pay period"]','[aria-label="Search transactions"]'];
        return{width:innerWidth,overflow:document.documentElement.scrollWidth>innerWidth+1,head:box(head),hero:box(hero),
          gap:box(grid).y-box(back||head).bottom,headerPadding:getComputedStyle(head).paddingBottom,gridMargin:getComputedStyle(grid).marginTop,
          back:back?box(back):null,targets:controls.map(key=>box(page.querySelector(key))),font:getComputedStyle(hero.querySelector('[data-out-amount]')).fontSize,
          period:page.querySelector('[data-period-label]').textContent,columns:getComputedStyle(grid).gridTemplateColumns};
      })()`);
      assert.equal(m.width, width);
      assert.equal(m.overflow, false, `${mode}/${width}/${state} no horizontal overflow`);
      assert.equal(m.headerPadding, "0px");
      assert.equal(m.gridMargin, "12px");
      assert.ok(Math.abs(m.gap - 12) < .5, JSON.stringify({ mode, width, state, m }));
      assert.ok(m.targets.every(r => r.width >= 44 && r.height >= 44));
      assert.equal(m.font, "30px", "approved hero type unchanged");
      assert.equal(Boolean(m.back), state === "completed");
      if (m.back) assert.ok(Math.abs(m.back.y - m.head.bottom - 12) < .5 && m.back.height >= 44);
      assert.ok(m.hero.x >= (width < 640 ? 16 : width < 1024 ? 24 : 32), "real page gutter, not a padded preview parent");
      assert.ok(m.hero.right <= width - (width < 640 ? 16 : width < 1024 ? 24 : 32) + 1);
      assert.equal(m.columns.split(" ").length, width < 1024 ? 1 : 2);
      assert.equal(m.period, state === "completed" ? "28 Aug to 24 Sep" : state === "year" ? "25 Dec to 28 Jan" : "25 Sep to 29 Oct");
      if (width === 390 && ["current", "completed"].includes(state)) await b.shot(`${mode}-${state}`);
      if (mode === "dark" && width === 320 && state === "year") await b.shot("narrow-cross-year");
      if (mode === "light" && width === 1280 && state === "completed") await b.shot("desktop-completed");
      results.push({ mode, width, state, ...m });
    }
  }
  assert.deepEqual(b.exceptions, []);
  assert.deepEqual(b.apiRequests, []);
  await b.save("results", { layouts: results.length, evidence: "isolated source-extracted production shell, not authenticated page", results });
  console.log(JSON.stringify({ layouts: results.length, output: b.output }));
} finally { b.close(); }
