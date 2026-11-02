// Manual synthetic preview checks. Run against an isolated worktree server.
import assert from 'node:assert/strict';
import path from 'node:path';
import { openBrowser } from '../../../scripts/_plan-browser.mjs';

const b = await openBrowser({origin: process.env.PREVIEW_ORIGIN || 'http://127.0.0.1:3399', output: path.resolve('../.impeccable/review/accounts-refresh')});
const ready = "document.querySelector('[data-g389-ready]') && getComputedStyle(document.querySelector('[data-g389-ready]')).getPropertyValue('--canvas')";
const load = async (query) => b.navigate('/design/accounts-refresh?' + query, ready);
const refresh = `document.querySelector('button[aria-label="Refresh connected banks"]')`;
const add = `document.querySelector('button[aria-label="Add account"]')`;
const wait = (ms) => new Promise(r => setTimeout(r, ms));
try {
  for (const [variant, mode, width] of (process.env.SKIP_CAPTURES ? [] : [['a','light',390],['a','dark',390],['b','light',390],['b','dark',390],['a','light',320],['b','dark',320],['a','dark',1280],['b','light',1280]])) {
    await b.viewport(width, 844);
    await load(`clean=1&variant=${variant}&mode=${mode}`);
    assert.equal(await b.evaluate('document.documentElement.scrollWidth <= innerWidth'), true, 'no horizontal overflow');
    assert.equal(await b.evaluate(`document.querySelector('[aria-label="Net worth"]').innerText.includes('−£')`), true, 'negative sign remains visible');
    for (const control of [refresh, add]) assert.equal(await b.evaluate(`(()=>{const r=(${control}).getBoundingClientRect();return r.width>=44&&r.height>=44})()`), true, '44px header targets');
    await b.shot(`${variant}-${mode}-${width}`);
  }
  await b.viewport(390,844);
  await load('clean=1&variant=a&mode=dark&hidden=1&state=partial');
  assert.equal(await b.evaluate(`document.querySelector('[aria-label="Net worth"]').innerText.includes('−£••••')`),true);
  assert.equal(await b.evaluate(`document.querySelector('[aria-label="Accounts by type"]').innerText.includes('1,284')`),false);
  await b.shot('a-dark-partial-hidden');
  await load('clean=1&variant=b&mode=light&tier=statements');
  assert.equal(await b.evaluate(`${refresh}.disabled`),true);
  await b.activate(add);
  await b.waitFor(`document.activeElement.textContent.startsWith('Connect a bank')`);
  assert.equal(await b.evaluate(`document.activeElement.textContent.startsWith('Connect a bank')`),true);
  await b.key('ArrowDown','ArrowDown',40);
  assert.equal(await b.evaluate(`document.activeElement.textContent`),'Upload a statement');
  await b.key('Home','Home',36);
  await b.key('Enter','Enter',13);
  await b.waitFor(`document.body.innerText.includes('Bank connection needs a subscription')`);
  await b.shot('b-light-paused-menu');
  await b.key('Escape','Escape',27);
  await b.waitFor(`document.activeElement===${add}`);
  assert.equal(await b.evaluate(`document.activeElement===${add}`),true,'menu returns focus');
  for (const variant of ['a','b']) {
    for (const state of ['error','cooldown','empty']) {
      await load(`clean=1&variant=${variant}&state=${state}`);
      assert.equal(await b.evaluate(`${refresh}.disabled`),state!=='error');
      assert.equal(await b.evaluate(`!!document.querySelector('[role="status"]')`),true);
    }
    for (const outcome of ['success','partial','error']) {
      await load(`clean=1&variant=${variant}&outcome=${outcome}`);
      await b.activate(refresh);
      await b.waitFor(`document.querySelector('[data-refresh-state="updating"]')`);
      assert.equal(await b.evaluate(`${refresh}.disabled`),true);
      assert.equal(await b.evaluate(`${add}.disabled`),false);
      assert.match(await b.evaluate(`document.querySelector('[aria-label="Net worth"]').innerText`),/09:40/);
      await b.waitFor(`document.querySelector('[data-refresh-state="${outcome==='success'?'idle':outcome}"]')`);
      assert.match(await b.evaluate(`document.querySelector('[aria-label="Net worth"]').innerText`),/09:40/);
    }
  }
  await load('clean=1&variant=a');
  await b.type(`document.querySelector('#account-search')`,'does not exist');
  await b.waitFor(`document.body.innerText.includes('No accounts match')`);
  await b.activate(`document.querySelector('button[aria-label="Clear search"]')`);
  assert.equal(await b.evaluate('document.activeElement.id'),'account-search');
  await b.waitFor(`document.body.innerText.includes('Day to day')`);
  await load('variant=a');
  await b.activate(`Array.from(document.querySelectorAll('button')).find(x=>x.textContent==='Home A context')`);
  await b.waitFor(`document.querySelector('button').closest('main').innerText.includes('Good morning, Alex')`);
  await b.activate(`Array.from(document.querySelectorAll('button')).find(x=>x.textContent==='Accounts')`);
  await b.waitFor(`document.querySelector('[aria-label="Net worth"]')`);
  await wait(50);
  assert.equal(b.exceptions.length,0,JSON.stringify(b.exceptions));
  assert.equal(b.apiRequests.length,0,'preview must not call API');
  await b.save('checks',{status:'passed',viewports:[320,390,1280],themes:['light','dark'],states:['idle','updating','partial','error','cooldown','empty','Statements'],apiRequests:b.apiRequests,exceptions:b.exceptions});
  console.log('G389 preview browser checks passed; captures saved in '+b.output);
} finally { await b.close(); }
