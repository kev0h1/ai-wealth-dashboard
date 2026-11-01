// Synthetic preview QA only. Never imported by production or the preview page.
import assert from 'node:assert/strict';
import { openBrowser } from '../../../scripts/g293-browser-helper.mjs';
const browser = await openBrowser({ origin: process.env.G389_TEST_ORIGIN || 'http://127.0.0.1:3189', output: process.argv[2] });
const { evaluate, waitFor, navigate, viewport, activate, key, shot, settle, save } = browser;
const results = [];
const route = (variant, state, mode, extra = {}) => '/design/ux-accounts-entry?' + new URLSearchParams({ variant, state, mode, clean: '1', ...extra });
const ready = "document.querySelector('[data-g389-ready]') && getComputedStyle(document.querySelector('[data-g389-ready]')).getPropertyValue('--canvas').trim()";
const link = selector => `[...document.querySelectorAll(${JSON.stringify(selector)})].find(e => {const r=e.getBoundingClientRect(); return r.width > 0 && r.height > 0;})`;
try {
  for (const variant of ['a', 'b', 'c']) for (const mode of ['light', 'dark']) {
    for (const state of ['one', 'many', 'empty', 'loading', 'error']) {
      await viewport(390, 844); await navigate(route(variant, state, mode), ready);
      const metrics = await evaluate(`({overflow:document.documentElement.scrollWidth>innerWidth+1, figures:[...document.querySelectorAll('[class*="mono"]')].map(e=>e.textContent), hasDoor:!!document.querySelector('[data-accounts-door],nav[aria-label="Primary"] a[href*="view=accounts"]'), small:[...document.querySelectorAll('a,button,summary')].filter(e=>{const r=e.getBoundingClientRect();return r.width>0&&r.height>0&&r.height<43}).map(e=>({text:e.textContent,h:e.getBoundingClientRect().height}))})`);
      assert.equal(metrics.overflow, false, `${variant}/${state}/${mode} overflow`);
      assert.equal(metrics.hasDoor, true); assert.deepEqual(metrics.small, []);
      if (['empty', 'loading'].includes(state)) assert.deepEqual(metrics.figures, [], 'Unknown states invent no amounts');
      results.push({ variant, state, mode, width: 390, ...metrics });
      if (state === 'one') await shot(`${variant}-${mode}-390`, { full: true });
    }
    for (const width of [320, 1280]) {
      await viewport(width, 900); await navigate(route(variant, 'many', mode), ready);
      assert.equal(await evaluate('document.documentElement.scrollWidth>innerWidth+1'), false);
      if (width === 1280) assert.ok(await evaluate("document.getElementById('prototype-content').getBoundingClientRect().width > 650"), 'Desktop content keeps its own wide column');
      results.push({ variant, mode, width, state: 'many', overflow: false });
      await shot(`${variant}-${mode}-${width}`, { full: true });
    }
    await viewport(390, 844); await navigate(route(variant, 'many', mode, { hidden: '1' }), ready);
    assert.equal(await evaluate("/£[0-9]/.test(document.querySelector('[data-g389-ready]').innerText)"), false);
    await activate(link('a[href*="account=card"]'));
    await waitFor("document.querySelector('[data-view=account]')");
    assert.equal(await evaluate("document.querySelector('[data-preview-heading]').textContent"), 'Reward Credit Card');
    assert.equal(await evaluate("document.querySelector('[class*=heroMoney]').textContent"), '−£••••');
    assert.equal(await evaluate("document.activeElement.hasAttribute('data-preview-heading')"), true);
    await evaluate('history.back()'); await waitFor("document.querySelector('[data-view=home]')");
    await activate(link(variant === 'c' ? 'nav[aria-label="Primary"] a[href*="view=accounts"]' : '[data-accounts-door]'));
    await waitFor("document.querySelector('[data-view=accounts]')");
    assert.equal(await evaluate("document.activeElement.textContent"), 'Accounts');
    await activate(link('a[href*="account=saver"]'));
    await waitFor("document.querySelector('[data-view=account]')");
    assert.equal(await evaluate("document.querySelector('[data-preview-heading]').textContent"), 'Everyday Saver');
    await activate(link('a[href*="view=accounts"]')); await waitFor("document.querySelector('[data-view=accounts]')");
    await activate(link('a[href*="view=home"]')); await waitFor("document.querySelector('[data-view=home]')");
    await activate(link('button[aria-label="Ask Penny"]')); await waitFor('document.querySelector("dialog[open]")');
    await key('Tab', 'Tab', 9); assert.equal(await evaluate("!!document.activeElement.closest('dialog')"), true);
    await key('Escape', 'Escape', 27); await waitFor('!document.querySelector("dialog[open]")');
    await waitFor("document.activeElement.getAttribute('aria-label') === 'Ask Penny'");
    results.push({ variant, mode, interactions: 'selection, masking, route focus, history Back, Home, Penny focus/Escape passed' });
  }
  await navigate(route('a', 'empty', 'dark', { clean: '0' }), ready);
  await activate(link('summary')); await settle();
  assert.equal(await evaluate('document.documentElement.scrollWidth>innerWidth+1'), false);
  await shot('review-controls-390-dark', { full: true });
  await evaluate("document.querySelector('[data-accounts-door]').focus()");
  await key('Enter', 'Enter', 13); await waitFor("document.querySelector('[data-view=accounts]')");
  await activate(link('a[href*="view=add"]')); await waitFor("document.querySelector('[data-view=add]')");
  await activate("[...document.querySelectorAll('button')].find(e=>e.textContent.includes('Upload a statement'))");
  await waitFor("document.querySelector('[role=status]')?.textContent.includes('Selected: Upload a statement')");
  assert.deepEqual(browser.exceptions, []); assert.deepEqual(browser.apiRequests, []);
  await save('results', { results, exceptions: browser.exceptions, apiRequests: browser.apiRequests });
  console.log(JSON.stringify({ layouts: 42, interactionSets: 6, keyboard: 'passed', exceptions: browser.exceptions.length, apiRequests: browser.apiRequests.length }));
} finally { browser.close(); }
