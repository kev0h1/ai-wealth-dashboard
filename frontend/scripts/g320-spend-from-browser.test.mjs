// Optional QA for the temporary G320 Safe to Spend preview.
import assert from "node:assert/strict";
import { openBrowser } from "./_plan-browser.mjs";

const b = await openBrowser({ origin: process.env.PLAN_QA_ORIGIN ?? "http://127.0.0.1:3201", output: process.env.PLAN_QA_OUTPUT ?? "/tmp/g320-qa" });
const variants = ["a", "b", "c"];
const scenarios = ["one", "shared-two", "shared-three", "different", "mixed", "overlap", "move", "same-bank", "unknown"];
const expected = {
  one: { accounts: ["natwest"], limits: {} },
  "shared-two": { accounts: ["natwest", "hsbc"], limits: {} },
  "shared-three": { accounts: ["natwest", "hsbc", "monzo"], limits: {} },
  different: { accounts: ["natwest", "hsbc"], limits: { natwest: "£70", hsbc: "£50" } },
  mixed: { accounts: ["natwest", "hsbc"], limits: { hsbc: "£35" } },
  overlap: { accounts: ["natwest", "hsbc"], limits: { natwest: "£90", hsbc: "£60" } },
  move: { accounts: ["natwest", "hsbc"], limits: {} },
  "same-bank": { accounts: ["natwest", "natwest-joint"], limits: {} },
  unknown: { accounts: ["local", "hsbc"], limits: {} },
};
const card = "document.querySelector('[data-g320-card]')";
const body = "document.querySelector('[data-g320-spend-from]')";
const move = "document.querySelector('[data-g320-move]')";
let checks = 0;

function path(variant, scenario, mode, hide = 0) { return `/design/spend-from-line?variant=${variant}&scenario=${scenario}&mode=${mode}&hide=${hide}`; }
async function visit(variant, scenario, mode, hide = 0, width = 390) {
  await b.viewport(width, width === 320 ? 740 : 900);
  await b.navigate(path(variant, scenario, mode, hide), "document.documentElement?.dataset.g320Ready==='true'");
  await b.waitFor(`Boolean(${card})&&Boolean(${body})`);
}
async function assertCard(variant, scenario, mode, hide) {
  const actual = await b.evaluate(`(()=>{const card=${card},body=${body},move=${move};const rect=card.getBoundingClientRect();const ids=Array.from(body.querySelectorAll('[data-g320-account]')).map(node=>node.dataset.g320Account);const limits=Object.fromEntries(Array.from(body.querySelectorAll('[data-g320-limit]')).map(node=>[node.closest('[data-g320-account]')?.dataset.g320Account,node.textContent.trim()]));const accessible=node=>[node.textContent,...Array.from(node.querySelectorAll('*')).flatMap(child=>Array.from(child.attributes).filter(attribute=>attribute.name.startsWith('aria-')).map(attribute=>attribute.value))].join(' ');return{overflow:card.scrollWidth>card.clientWidth,left:rect.left,right:rect.right,width:innerWidth,ids,limits,body:body.textContent,allMoney:[accessible(card),move?accessible(move):''].join(' '),move:Boolean(move),cards:document.querySelectorAll('[data-g320-card]').length}})()`);
  assert.equal(actual.cards, 1, `${variant}/${scenario}/${mode}: one card`);
  assert.equal(actual.overflow, false, `${variant}/${scenario}/${mode}: card does not overflow`);
  assert.ok(actual.left >= 0 && actual.right <= actual.width + 1, `${variant}/${scenario}/${mode}: card fits`);
  assert.deepEqual(actual.ids, expected[scenario].accounts, `${variant}/${scenario}: account identities`);
  if (hide) assert.deepEqual(Object.keys(actual.limits), Object.keys(expected[scenario].limits), `${variant}/${scenario}: masked lower-limit placement`);
  else assert.deepEqual(actual.limits, expected[scenario].limits, `${variant}/${scenario}: lower account limits`);
  if (["shared-two", "shared-three", "move"].includes(scenario) && !hide) {
    const pool = scenario === "shared-three" ? "£240" : "£7";
    assert.equal(actual.body.split(pool).length - 1, 0, `${variant}/${scenario}: pooled value stays in the hero, not repeated beside accounts`);
  }
  assert.equal(actual.move, scenario === "move", `${variant}/${scenario}: move block state`);
  if (scenario === "overlap") assert.match(actual.body, /Account limits share the total above\./, `${variant}: overlapping limits cannot be added together`);
  if (hide) assert.doesNotMatch(actual.allMoney, /£\s*\d/, `${variant}/${scenario}: no exposed money in visible or aria text`);
  checks++;
}
async function capture(name) { await b.shot(name, { full: true }); checks++; }

try {
  // Full 390px semantic matrix: both themes, all variants, each fixture and
  // masking state. Direct navigation keeps this intentional matrix quick.
  if (!process.env.G320_CONFIRM_ONLY) for (const variant of variants) for (const mode of ["light", "dark"]) for (const scenario of scenarios) for (const hide of [0, 1]) {
    await visit(variant, scenario, mode, hide); await assertCard(variant, scenario, mode, hide);
  }

  // Representative visual evidence, kept bounded so each capture is useful.
  for (const variant of variants) for (const mode of ["light", "dark"]) for (const scenario of ["shared-two", "move"]) {
    await visit(variant, scenario, mode); await capture(`${variant}-${mode}-${scenario}`);
  }
  for (const scenario of ["different", "mixed", "overlap", "same-bank", "unknown"]) { await visit("a", scenario, "light"); await capture(`a-light-${scenario}`); }

  // Narrow and desktop smoke coverage for every treatment/theme.
  for (const width of [320, 1280]) for (const variant of variants) for (const mode of ["light", "dark"]) {
    await visit(variant, "shared-two", mode, 0, width); await assertCard(variant, "shared-two", mode, 0);
    if (width === 1280 && mode === "light") await capture(`${variant}-desktop-light`);
  }

  // The C treatment keeps the lower accounts behind native details.
  await visit("c", "different", "light");
  assert.equal(await b.evaluate(`${body}.querySelector('details').open`), false);
  assert.equal(await b.evaluate(`${body}.querySelector('[data-g320-account="hsbc"]').checkVisibility()`), false, "C alternative is initially folded");
  await b.evaluate(`${body}.querySelector('summary').focus()`);
  await b.key("Enter", "Enter", 13);
  await b.waitFor(`${body}.querySelector('details').open`);
  assert.equal(await b.evaluate(`${body}.querySelector('[data-g320-account="hsbc"]').checkVisibility()`), true, "keyboard opening reveals the lower account limit");
  await capture("c-light-different-open");
  await b.key("Enter", "Enter", 13);
  await b.waitFor(`!${body}.querySelector('details').open`); checks++;

  for (const [variant, scenario, mode] of [["a", "mixed", "light"], ["c", "move", "dark"]]) {
    await visit(variant, scenario, mode, 1); await capture(`${variant}-${mode}-${scenario}-hidden`);
  }

  // Preview controls must preserve the selected preview state in their links.
  await visit("b", "mixed", "dark", 1);
  const controlLinks = await b.evaluate(`Array.from(document.querySelectorAll('nav[aria-label="Design preview controls"] a')).map(link=>link.getAttribute('href'))`);
  assert.ok(controlLinks.length > 0, "preview controls expose links");
  assert.ok(controlLinks.every(href => href?.includes("variant=") && href.includes("scenario=") && href.includes("mode=") && href.includes("hide=")), "preview links retain the full query state");
  await b.evaluate("document.querySelector('nav[aria-label=\"Design preview controls\"] a').focus()");
  await b.key("Enter", "Enter", 13);
  await b.waitFor(`new URLSearchParams(location.search).get('variant')==='g' && document.querySelector('[data-g320-taste]')?.dataset.g320Taste==='g'`);
  await b.evaluate("history.back()");
  await b.waitFor(`new URLSearchParams(location.search).get('variant')==='b' && ${body}?.dataset.g320SpendFrom==='b'`);
  assert.equal(await b.evaluate("new URLSearchParams(location.search).get('hide')"), "1");
  assert.equal(await b.evaluate("new URLSearchParams(location.search).get('mode')"), "dark");
  await assertCard("b", "mixed", "dark", 1); checks++;

  // A signed-in user's stored dark theme must not defeat the light preview,
  // and using this temporary theme must leave that stored choice intact.
  await b.evaluate("localStorage.setItem('wd_dark','1')");
  await visit("a", "shared-two", "light");
  assert.equal(await b.evaluate("document.documentElement.classList.contains('dark')"), false);
  assert.equal(await b.evaluate("getComputedStyle(document.querySelector('main[data-g320-ready]')).colorScheme"), "light");
  assert.equal(await b.evaluate("localStorage.getItem('wd_dark')"), "1");
  await b.evaluate("localStorage.removeItem('wd_dark')"); checks++;

  assert.deepEqual(b.exceptions, []); assert.deepEqual(b.apiRequests, []);
  await b.save("results", { checks, exceptions: b.exceptions, apiRequests: b.apiRequests });
  console.log(JSON.stringify({ checks, exceptions: b.exceptions, apiRequests: b.apiRequests }));
} finally { b.close(); }
