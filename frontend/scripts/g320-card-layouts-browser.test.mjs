// Manual synthetic CDP QA for the G320 card-layout proposal. It exercises only
// fixed fictional preview data: it must never use preferences or API responses.
import assert from "node:assert/strict";
import { openBrowser } from "./_plan-browser.mjs";

const b = await openBrowser({
  origin: process.env.PLAN_QA_ORIGIN ?? "http://127.0.0.1:3202",
  output: process.env.PLAN_QA_OUTPUT ?? "/tmp/g320-r2-qa",
});
const variants = ["d", "e", "f"];
const card = "document.querySelector('[data-g320-card]')";
const rail = "document.querySelector('[data-g320-spend-from]')";
let checks = 0;

const route = (variant, scenario, mode, hide = 0) =>
  `/design/spend-from-line?variant=${variant}&scenario=${scenario}&mode=${mode}&hide=${hide}`;
const expectAccounts = {
  "cards-purchases": ["natwest", "starling"],
  "cards-monthly": ["natwest", "starling"],
  "cards-move": ["natwest", "starling"],
  "cards-shared": ["natwest", "starling", "monzo"],
  "cards-large": ["natwest", "starling"],
  "cards-none": ["natwest", "starling"],
  "shared-two": ["natwest", "hsbc"],
  "same-bank": ["natwest", "natwest-joint"],
  unknown: ["local", "hsbc"],
  overlap: ["natwest", "hsbc"],
};
const expectedLimits = {
  "cards-purchases": { natwest: "£96", starling: "£54" },
  "cards-monthly": { natwest: "£96", starling: "£54" },
  "cards-move": { natwest: "£96", starling: "£54" },
  "cards-large": { natwest: "£7,600", starling: "£4,820" },
  "cards-none": { natwest: "£96", starling: "£54" },
  overlap: { natwest: "£90", hsbc: "£60" },
};

async function visit(variant, scenario, mode, hide = 0, width = 390) {
  await b.viewport(width, width === 320 ? 740 : 900);
  await b.navigate(route(variant, scenario, mode, hide), "document.documentElement?.dataset.g320Ready==='true'");
  await b.waitFor(`Boolean(${card})`);
  if (scenario !== "cards-reserve") await b.waitFor(`Boolean(${rail})`);
  assert.deepEqual(b.exceptions, [], `${variant}/${scenario}: browser exception`);
  assert.deepEqual(b.apiRequests, [], `${variant}/${scenario}: preview must not request an API`);
}

async function pageFacts() {
  return b.evaluate(`(()=>{
    const c=${card}, r=${rail}, move=document.querySelector('[data-g320-move]'), all=node=>node ? [node.textContent,...Array.from(node.querySelectorAll('*')).flatMap(x=>Array.from(x.attributes).filter(a=>a.name.startsWith('aria-')).map(a=>a.value))].join(' ') : '';
    const rect=c.getBoundingClientRect(), accounts=r ? Array.from(r.querySelectorAll('[data-g320-account]')).map(row=>{
      const q=row.getBoundingClientRect(), limit=row.querySelector('[data-g320-limit]');
      return {id:row.dataset.g320Account,text:row.textContent.trim(),limit:limit?.textContent.trim() ?? null,visible:row.checkVisibility(),overflow:row.scrollWidth>row.clientWidth,fit:q.left>=-1&&q.right<=innerWidth+1,width:q.width};
    }) : [];
    const panel=c.querySelector('aside[aria-label="Card balance activity"]'), heading=c.querySelector('#safe-to-spend-heading');
    const headingRect=heading?.getBoundingClientRect(), railRect=r?.getBoundingClientRect();
    return {cardCount:document.querySelectorAll('[data-g320-card]').length,fit:rect.left>=-1&&rect.right<=innerWidth+1,overflow:c.scrollWidth>c.clientWidth,
      placement:r?.dataset.g320Placement ?? null, variant:r?.dataset.g320SpendFrom ?? null, accounts, text:c.textContent, railText:r?.textContent ?? '', headingText:heading?.textContent?.trim() ?? '', pageText:document.body.textContent, accessible:all(document.querySelector('main[data-g320-ready]')),
      panel:Boolean(panel), panelVisible:panel?.checkVisibility() ?? false, panelText:panel?.textContent ?? '', counts:c.querySelectorAll('[data-sts-counts]').length,
      besideActual:Boolean(headingRect&&railRect&&railRect.left>=headingRect.right-1&&Math.abs(railRect.top-headingRect.top)<45),
      heading:getComputedStyle(c.querySelector('#safe-to-spend-heading span')).fontSize, label:getComputedStyle(c.querySelector('#safe-to-spend-label')).fontSize};
  })()`);
}

function assertGeometry(facts, label) {
  assert.equal(facts.cardCount, 1, `${label}: exactly one card`);
  assert.equal(facts.fit, true, `${label}: card fits viewport`);
  assert.equal(facts.overflow, false, `${label}: card has no horizontal overflow`);
  assert.equal(facts.panelVisible, facts.panel, `${label}: card-activity panel is painted, not hidden by preview CSS`);
  for (const account of facts.accounts.filter(account => account.visible)) {
    assert.equal(account.fit, true, `${label}: ${account.id} row fits`);
    assert.equal(account.overflow, false, `${label}: ${account.id} has no hidden horizontal overflow`);
    assert.ok(account.width >= 48, `${label}: ${account.id} is a usable, readable column`);
  }
  assert.equal(facts.counts, 1, `${label}: counts scope occurs once`);
  if (facts.placement === "beside") assert.equal(facts.besideActual, true, `${label}: account rail is physically beside the cash figure`);
  assert.equal(facts.heading, "30px", `${label}: hero figure remains 30px`);
  assert.equal(facts.label, "11px", `${label}: hero label remains 11px`);
}

function assertAccounts(facts, scenario, label, hidden) {
  const ids = facts.accounts.map(x => x.id);
  assert.deepEqual(ids, expectAccounts[scenario], `${label}: expected accounts`);
  for (const row of facts.accounts) assert.ok(row.text.length > 3, `${label}: ${row.id} has a readable name`);
  const limits = Object.fromEntries(facts.accounts.filter(x => x.limit).map(x => [x.id, x.limit]));
  if (hidden) {
    assert.doesNotMatch(facts.accessible, /£\s*\d/, `${label}: balances are absent from text and aria labels`);
    return;
  }
  assert.deepEqual(limits, expectedLimits[scenario] ?? {}, `${label}: lower limits belong to their own account rows`);
}

async function capture(name) { await b.shot(name, { full: true }); checks++; }
async function checkCardCase(variant, scenario, mode, hide = 0, width = 390) {
  await visit(variant, scenario, mode, hide, width);
  const facts = await pageFacts(), label = `${variant}/${scenario}/${mode}/${hide}/${width}`;
  assertGeometry(facts, label);
  if (scenario !== "cards-reserve") assertAccounts(facts, scenario, label, hide);
  if (scenario === "cards-reserve" && hide) {
    // The approved safety explanation names the universal £0 floor. It is
    // static guidance, not a private amount; every actual figure stays masked.
    const privateAmounts = facts.accessible.replaceAll("The amount available above cannot fall below £0, so the shortfall stays visible here.", "The zero floor is explained here.");
    assert.doesNotMatch(privateAmounts, /£\s*\d/, `${label}: reserve mask removes private money from text and aria labels`);
  }
  assert.equal(facts.variant, scenario === "cards-reserve" ? null : variant, `${label}: correct treatment rendered`);
  checks++;
  return facts;
}

try {
  // The full 390px matrix checks the financial/privacy contract in either theme
  // and with the balance mask on. It may be skipped only for a later recapture.
  if (!process.env.G320_CONFIRM_ONLY) {
    for (const variant of variants) for (const mode of ["light", "dark"]) for (const hide of [0, 1]) {
      for (const scenario of ["cards-purchases", "cards-monthly", "cards-reserve", "cards-move", "cards-shared", "cards-large", "cards-none"]) {
        const facts = await checkCardCase(variant, scenario, mode, hide);
        if (scenario === "cards-reserve") {
          assert.equal(facts.accounts.length, 0, `${variant}: reserve gives no account choice`);
          if (!hide) {
            assert.match(facts.text, /£0/, `${variant}: reserve hero is zero`);
            assert.match(facts.text, /£325/, `${variant}: reserve panel states amount held back`);
            assert.match(facts.text, /£73 safety shortfall/, `${variant}: reserve names the safety shortfall`);
            assert.match(facts.panelText, /Repayment not confirmed/, `${variant}: reserve has amber-check copy`);
          }
        }
      }
    }
    // Older fixtures remain useful compact-layout edges.
    for (const scenario of ["shared-two", "same-bank", "unknown", "overlap"]) {
      const facts = await checkCardCase("d", scenario, "light");
      if (scenario === "overlap") assert.match(facts.text, /not amounts to add together/, "overlap is explicitly non-additive");
    }
  }

  // Financial facts that must not be conflated with the cash estimate.
  for (const variant of variants) {
    let facts = await checkCardCase(variant, "cards-purchases", "light");
    assert.equal(facts.panel, true, `${variant}: purchases shows card activity`);
    assert.match(facts.panelText, /\+£1,947/, `${variant}: purchases total is visible`);
    assert.match(facts.panelText, /not deducted from the cash above/, `${variant}: purchases are not deducted twice`);
    assert.equal(facts.headingText, "£242", `${variant}: pooled value is the hero verdict`);
    assert.doesNotMatch(facts.railText, /£242/, `${variant}: shared cash total is not repeated as an account limit`);
    facts = await checkCardCase(variant, "cards-monthly", "dark");
    assert.match(facts.text, /£2,247/, `${variant}: confirmed bill remains in cash context`);
    assert.match(facts.panelText, /Due around 28 Oct/, `${variant}: confirmed repayment has date context`);
    facts = await checkCardCase(variant, "cards-none", "light");
    assert.equal(facts.panel, false, `${variant}: no card activity has no panel`);
  }

  const move = await checkCardCase("d", "cards-move", "light");
  assert.match(move.pageText, /Pending move/, "move context sits above the card");
  assert.match(move.text, /£40 is already held back/, "move reserve is stated once in the card context");
  assert.match(move.panelText, /£1,947/, "move leaves card purchases separate");
  const shared = await checkCardCase("e", "cards-shared", "dark");
  assert.equal(Object.keys(Object.fromEntries(shared.accounts.filter(x => x.limit).map(x => [x.id, x.limit]))).length, 0, "shared caps do not repeat individual currency limits");
  const large = await checkCardCase("f", "cards-large", "light");
  assert.equal(large.placement, "below", "large figure moves accounts below on phone");

  // Bounded, full-page visual evidence: 20 images, each chosen for a decision.
  for (const variant of variants) for (const mode of ["light", "dark"]) { await checkCardCase(variant, "cards-purchases", mode); await capture(`${variant}-purchases-${mode}`); }
  for (const variant of variants) { await checkCardCase(variant, "cards-reserve", "light"); await capture(`${variant}-reserve-light`); }
  for (const variant of variants) { await checkCardCase(variant, "cards-monthly", "dark"); await capture(`${variant}-monthly-dark`); }
  await checkCardCase("d", "cards-move", "light"); await capture("d-move-light");
  await checkCardCase("e", "cards-shared", "dark"); await capture("e-shared-dark");
  await checkCardCase("f", "cards-large", "light"); await capture("f-large-light");
  await checkCardCase("d", "cards-purchases", "light", 1); await capture("d-purchases-hidden-light");
  await checkCardCase("e", "cards-reserve", "dark", 1); await capture("e-reserve-hidden-dark");

  // F's native disclosure must work from the keyboard and visibility, not just rects.
  await checkCardCase("f", "cards-purchases", "light");
  assert.equal(await b.evaluate(`${rail}.querySelector('details').open`), false, "F begins folded");
  assert.equal(await b.evaluate(`${rail}.querySelector('[data-g320-account="starling"]').checkVisibility()`), false, "F alternative is initially hidden");
  await b.evaluate(`${rail}.querySelector('summary').focus()`);
  await b.key("Enter", "Enter", 13);
  await b.waitFor(`${rail}.querySelector('details').open`);
  assert.equal(await b.evaluate(`${rail}.querySelector('[data-g320-account="starling"]').checkVisibility()`), true, "F keyboard disclosure reveals alternative");
  await capture("f-disclosure-open-purchases-light");
  checks++;

  // Links must retain state after a completed navigation, then browser Back.
  await visit("e", "cards-reserve", "dark", 1);
  const before = await b.evaluate("location.href");
  await b.evaluate("document.querySelector('nav[aria-label=\"Design preview controls\"] a').focus()");
  await b.key("Enter", "Enter", 13);
  await b.waitFor(`location.href!==${JSON.stringify(before)}`);
  await b.evaluate("history.back()");
  await b.waitFor("new URLSearchParams(location.search).get('variant')==='e' && new URLSearchParams(location.search).get('scenario')==='cards-reserve'");
  assert.equal(await b.evaluate("new URLSearchParams(location.search).get('mode')"), "dark", "Back retains mode");
  assert.equal(await b.evaluate("new URLSearchParams(location.search).get('hide')"), "1", "Back retains balance mask");
  checks++;

  // Small and desktop smoke coverage, including layout placement and real side rail.
  for (const width of [320, 1280]) for (const variant of variants) for (const mode of ["light", "dark"]) {
    const facts = await checkCardCase(variant, "cards-purchases", mode, 0, width);
    if (width === 1280) {
      assert.equal(facts.placement, "beside", `${variant}/${mode}: desktop rail is beside hero`);
      const positions = await b.evaluate(`(()=>{const h=${card}.querySelector('#safe-to-spend-heading'),r=${rail};const a=h.getBoundingClientRect(),q=r.getBoundingClientRect();return {right:a.right,left:q.left,top:a.top,railTop:q.top};})()`);
      assert.ok(positions.left >= positions.right - 1 && Math.abs(positions.railTop - positions.top) < 45, `${variant}/${mode}: rail is physically beside hero, not competing below`);
    }
  }
  for (const variant of variants) {
    await checkCardCase(variant, "cards-purchases", "light", 1, 320);
    const narrowLarge = await checkCardCase(variant, "cards-large", "light", 0, 320);
    assert.equal(narrowLarge.placement, "below", `${variant}: large figure moves accounts below at 320px`);
  }
  for (const variant of variants) { await checkCardCase(variant, "cards-purchases", "light", 0, 1280); await capture(`${variant}-desktop-light`); }

  assert.deepEqual(b.exceptions, [], "no browser exceptions");
  assert.deepEqual(b.apiRequests, [], "no API requests");
  await b.save("results", { checks, exceptions: b.exceptions, apiRequests: b.apiRequests, captures: 21 });
  console.log(JSON.stringify({ checks, captures: 21, exceptions: b.exceptions, apiRequests: b.apiRequests }));
} finally {
  b.close();
}
