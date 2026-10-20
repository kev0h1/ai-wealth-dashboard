import assert from "node:assert/strict";
import { openBrowser } from "./qa-browser.mjs";
const b = await openBrowser({origin:process.env.G291_TEST_ORIGIN||"http://127.0.0.1:3163",output:process.argv[2]});
const variants = process.env.G291_VARIANT ? [process.env.G291_VARIANT] : ["a","b"];
const phase = process.env.G291_PHASE || "all";
const results = [];
const q = action => `document.querySelector('[data-g291-action="${action}"]')`;
const field = name => `document.querySelector('[data-g291-field="${name}"]')`;
const delay = () => new Promise(resolve=>setTimeout(resolve,450));
async function tap(expression) { await delay(); await b.activate(expression); await b.settle(); }
const click = action => tap(q(action));
const step = name => b.waitFor(`document.querySelector('[data-g291-step="${name}"]')`);
async function navigate(variant,state="matched",theme="dark") {
  await b.navigate(`/design/plans-simple?${new URLSearchParams({variant,state,theme})}`, `document.querySelector('[data-g291-ready="true"]') && document.documentElement.classList.contains('dark')===${theme==="dark"}`);
}
async function close() {
  await tap(`document.querySelector('[data-sheet-frame] header button[aria-label^="Close "]')`);
  await b.waitFor("!document.querySelector('[data-sheet-frame]')");
  await delay();
}
const text = () => b.evaluate("document.querySelector('[data-sheet-frame]').innerText");
async function selectCategory(value) {
  await tap(`document.querySelector('[data-g291-category="${value}"]')`);
  assert.equal(await b.evaluate("!!document.querySelector('[data-sheet-frame] select')"),false,"category choices never invoke the native OS picker");
}
async function measure(label) {
  const row=await b.evaluate(`(()=>{
    const f=document.querySelector('[data-sheet-frame]'),r=f.getBoundingClientRect(),footer=f.querySelector('[data-sheet-footer]');
    return {overflow:document.documentElement.scrollWidth>innerWidth+1,dialogs:document.querySelectorAll('[data-sheet-frame]').length,
      left:r.left,right:r.right,bottom:r.bottom,width:innerWidth,height:innerHeight,footer:footer?.getBoundingClientRect().bottom??0,
      contribution:(()=>{const row=f.querySelector('[aria-label="Contribution"] > p:nth-child(2)');if(!row)return null;const [amount,caption]=row.children;return {amountBottom:amount.getBoundingClientRect().bottom,captionTop:caption.getBoundingClientRect().top}})(),
      viewActions:(()=>{const dock=f.querySelector('[data-g291-view-actions]');if(!dock)return null;const edit=dock.querySelector('[data-g291-action="edit"]');return {dockWidth:dock.getBoundingClientRect().width,editWidth:edit.getBoundingClientRect().width,bodyActions:!!f.querySelector('[data-g291-step="view"] [data-g291-action]')}})(),
      fields:[...f.querySelectorAll('input:not([type=radio]):not([type=checkbox]),select')].map(e=>({label:!!e.labels?.length,font:parseFloat(getComputedStyle(e).fontSize)}))};
  })()`);
  assert.equal(row.overflow,false,label);assert.equal(row.dialogs,1,label);
  assert.ok(row.left>=-1&&row.right<=row.width+1&&row.bottom<=row.height+1,label);
  assert.ok(row.footer<=row.height+1,label);assert.ok(row.fields.every(e=>e.label&&e.font>=16),label);
  assert.ok(row.contribution===null||row.contribution.captionTop>=row.contribution.amountBottom-1,"contribution caption has its own line");
  assert.ok(row.viewActions===null||!row.viewActions.bodyActions&&row.viewActions.editWidth>=row.viewActions.dockWidth-1,"view actions span the footer, not a left-side cluster");
  results.push({label,...row});
}
async function chooseAugust() {
  await tap("document.querySelector('#target-month')");
  await b.waitFor("document.querySelectorAll('[data-sheet-frame]').length===2");
  await tap("document.querySelector('[aria-label=\"August 2027\"]')");
  await tap("[...document.querySelectorAll('[data-sheet-frame]')].at(-1).querySelector('[data-sheet-footer] button:last-child')");
  await b.waitFor("document.querySelectorAll('[data-sheet-frame]').length===1");
}
try {
  if(phase!=="journeys") for(const variant of variants) for(const theme of ["light","dark"]) for(const state of ["matched","no-history","one-account","many-accounts","short","offline","no-source"]) {
    await b.viewport(390);await navigate(variant,state,theme);await click("open-view");await step("view");await measure(`${variant}/${theme}/${state}/view`);
    if(variant==="b"&&["matched","one-account"].includes(state))await b.shot(`${state}-view-${theme}`);
    await b.evaluate("void(window.__g291Frame=document.querySelector('[data-sheet-frame]'))");
    await click("edit");await step("edit");await measure(`${variant}/${theme}/${state}/edit`);
    assert.equal(await b.evaluate("window.__g291Frame===document.querySelector('[data-sheet-frame]')"),true,"same physical sheet for edit");
    if(state==="no-source")assert.equal(await b.evaluate(`${q("save")}.disabled`),true);
    if(variant==="b"&&["matched","one-account"].includes(state))await b.shot(`${state}-review-${theme}`);
    await close();
  }
  if(phase!=="layouts") for(const variant of variants) {
    // Explicit goal entry must not ask for the already-known goal kind.
    await b.viewport(390);await navigate(variant,"matched","light");await click("start-goal");await step("purpose");
    assert.match(await text(),/Japan.*December 2028/);
    await b.type(field("name"),"Japan trip");await click("next-purpose");
    if(variant==="a") {
      await step("target");assert.match(await text(),/£135/);await click("next-details");await step("source");await click("confirm-source");await step("destination");
    } else {
      await step("setup");assert.equal(await b.evaluate("!!"+q("save")),false);await click("confirm-source");await click("edit-destination");await step("destination");
    }
    assert.equal(await b.evaluate(`${field("include-existing")}.checked`),false);
    await tap(field("include-existing"));await measure(`${variant}/existing-pot`);
    if(variant==="a")await b.shot("pot-choice-light");
    await click("confirm-destination");
    if(variant==="b"){await step("setup");await click("next-setup");}
    await step("tracking");await tap("document.querySelector('[data-g291-tracking=\"category\"]')");await selectCategory("groceries");assert.match(await text(),/0 transfers/);await selectCategory("savings");
    assert.match(await text(),/2 transfers/);assert.match(await text(),/£150/);assert.doesNotMatch(await text(),/Skip for now/);
    await b.evaluate("document.querySelector('[data-g291-category=savings] input').focus()");
    await b.key("ArrowUp","ArrowUp",38);
    assert.equal(await b.evaluate("document.querySelector('[data-g291-category=groceries] input').checked"),true,"category rows support native radio keyboard navigation");
    await b.key("ArrowDown","ArrowDown",40);
    assert.equal(await b.evaluate("document.querySelector('[data-g291-category=savings] input').checked"),true);
    await measure(`${variant}/goal-category`);if(variant==="a")await b.shot("goal-category-light");
    await click("confirm-tracking");await step("review");assert.match(await text(),/£115/);assert.match(await text(),/£200 of £1,200/);
    await click("save");await step("result");await click("view-result");await step("view");assert.match(await text(),/£200 of £1,200/,"save includes existing share once");
    // Real month picker commits a changed date; contribution and saved share survive.
    await click("edit");await click("edit-target");await step("target");await chooseAugust();assert.match(await text(),/£100/);assert.match(await text(),/£200 of £1,200/);
    await click("next-details");await step("edit");await measure(`${variant}/changed-month`);await b.shot(`${variant}-changed-month-light`);
    await click("save");await step("result");await click("view-result");await step("view");assert.match(await text(),/£100/);assert.match(await text(),/£200 of £1,200/);
    await click("edit");await click("edit-source");await step("source");
    await tap("[...document.querySelectorAll('[data-sheet-frame] [role=radio]')].find(e=>e.innerText.includes('Bills account'))");
    await click("confirm-source");await step("edit");assert.match(await text(),/Confirm Savings category/);
    assert.equal(await b.evaluate(q("save")+".disabled"),true);
    await click("edit-tracking");await step("tracking");await click("confirm-tracking");await step("edit");
    assert.equal(await b.evaluate(q("save")+".disabled"),false);await close();

    // Keep-here set-aside supports category tracking without requiring a pot.
    await navigate(variant,"one-account","dark");await click("start-aside");await step("purpose");assert.match(await text(),/£300.*groceries/);
    await b.type(field("name"),"Groceries");await click("next-purpose");
    if(variant==="a"){await step("amount");await b.type(field("amount"),"300");await click("next-details");await step("source");await click("confirm-source");}
    else{await step("setup");assert.equal(await b.evaluate("!!"+q("save")),false);await click("confirm-source");await click("edit-target");await step("amount");await b.type(field("amount"),"300");await click("next-details");await step("setup");await click("next-setup");}
    await step("tracking");assert.equal(await b.evaluate("!!"+q("save")),false,"new set-asides reach tracking before Save");
    await tap("document.querySelector('[data-g291-tracking=\"category\"]')");await selectCategory("groceries");
    assert.match(await text(),/3 purchases/);assert.match(await text(),/£105/);assert.match(await text(),/-£5/);assert.match(await text(),/£100/);assert.match(await text(),/refund/);await measure(`${variant}/aside-category`);if(variant==="b")await b.shot("groceries-category-dark");
    await click("confirm-tracking");await step("review");await click("save");await step("result");await click("view-result");await step("view");
    assert.match(await text(),/Groceries category tracking/);assert.match(await text(),/£300/);assert.match(await text(),/held back/,"evidence is not an implemented reserve release");
    await b.shot(`${variant}-groceries-view-dark`);

    // Back from unsaved edits keeps the stored name. Destructive actions remain explicit.
    await click("edit");await click("edit-name");await step("purpose");await b.type(field("name"),"Unsaved change");await click("next-purpose");await step("edit");
    await tap("document.querySelector('[data-sheet-frame] header button[aria-label^=\"Back\"]')");await step("view");assert.doesNotMatch(await text(),/Unsaved change/);
    await click("pause");await step("pause");await click("confirm-pause");await step("result");await click("view-result");await step("view");assert.match(await text(),/Paused/);
    await click("resume");await step("result");await click("view-result");await step("view");
    await click("delete");await step("delete");await click("confirm-delete");await step("result");assert.equal(await b.evaluate(`!!${q("view-result")}`),false);await click("close");await b.waitFor("!document.querySelector('[data-sheet-frame]')");await delay();

    // Generic start retains helpful examples; no-history payment needs a name or Not now.
    await navigate(variant,"no-history","dark");await click("start");await b.type(field("name"),"Sofa");await click("next-purpose");await step("kind");assert.match(await text(),/£2,000.*Japan/);assert.match(await text(),/£300.*groceries/);await close();
    await click("open-view");await click("edit");await click("edit-tracking");await step("tracking");await tap("document.querySelector('[data-g291-tracking=\"payment\"]')");await click("confirm-tracking");await step("tracking");assert.match(await text(),/payment name|Not now/);
    await tap("document.querySelector('[data-g291-tracking=\"none\"]')");await click("confirm-tracking");await step("edit");await close();
  }
  if(phase!=="layouts") {
    for(const width of [320,1280]) {await b.viewport(width);await navigate("b");await click("open-view");await step("view");await measure(`view-width-${width}`);await b.shot(`view-width-${width}`);await click("edit");await step("edit");await measure(`width-${width}`);await b.shot(`width-${width}`);await click("edit-name");await step("purpose");await b.type(field("name"),"W".repeat(80));await click("next-purpose");await step("edit");await measure(`long-name-${width}`);await close();}
    await b.viewport(390);await navigate("b","one-account","dark");await click("start-aside");await b.type(field("name"),"Groceries");await click("next-purpose");await step("setup");await click("confirm-source");await b.shot("b-aside-setup-dark");await click("next-setup");await step("tracking");await b.shot("b-aside-tracking-dark");
    await tap("document.querySelector('[data-g291-tracking=\"category\"]')");await tap("document.querySelector('[data-sheet-frame] header button[aria-label^=\"Back\"]')");await step("setup");
    assert.equal(await b.evaluate(q("next-setup")+".disabled"),false,"an unfinished tracking choice never blocks returning to that step");await click("next-setup");await step("tracking");await click("confirm-tracking");await step("review");await close();
    await b.viewport(390);await navigate("a","matched","light");await b.evaluate(`${q("open-view")}.focus()`);await b.key("Enter","Enter",13);await step("view");await b.key("Tab","Tab",9);
    assert.equal(await b.evaluate("document.querySelector('[data-sheet-frame]').contains(document.activeElement)"),true,"keyboard focus stays in sheet");await close();
  }
  assert.deepEqual(b.exceptions,[]);assert.deepEqual(b.apiRequests,[]);
  await b.save(`results-${phase}-${process.env.G291_VARIANT||"both"}`,{phase,variants,checks:results.length,results,exceptions:b.exceptions,apiRequests:b.apiRequests});
  console.log(JSON.stringify({phase,variants,layoutChecks:results.length,interactions:"passed",output:b.output}));
} finally {b.close();}
