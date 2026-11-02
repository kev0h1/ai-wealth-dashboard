import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { HomeTransfersCheckView, transferReviewCount, beginRefetch } from '../components/HomeTransfersCheck.tsx';

assert.equal(transferReviewCount({ review_total: 7, count: 0, pair_count: 0 }), 7);
assert.equal(transferReviewCount({ review_total: 0, count: 9 }), 0);
for (const value of [undefined, null, -1, 0.5, NaN, Infinity, '3']) {
  assert.throws(() => transferReviewCount({ review_total: value }), 'Malformed data must never say all checked');
}
const html = state => renderToStaticMarkup(React.createElement(HomeTransfersCheckView, { state, onRetry() {}, onReview() {} }));
assert.equal(html({ status: 'loading' }), '', 'G400: loading renders nothing');
const source = readFileSync(new URL('../components/HomeTransfersCheck.tsx', import.meta.url), 'utf8');
assert.doesNotMatch(source, /Checking for transfers/);
assert.doesNotMatch(source, /LoaderCircle/);
const ready = { status: 'ready', count: 3 };
assert.equal(beginRefetch(ready), ready, 'refetch keeps the prior ready count');
assert.match(html(beginRefetch(ready)), /Check your transfers/);
assert.deepEqual(beginRefetch({ status: 'loading' }), { status: 'loading' });
assert.deepEqual(beginRefetch({ status: 'failed' }), { status: 'loading' });
assert.equal(html({ status: 'ready', count: 0 }), '');
for (const count of [1, 14, 1000]) {
  const output = html({ status: 'ready', count });
  assert.match(output, /Check your transfers/);
  assert.match(output, /<button/);
  assert.match(output, new RegExp(`aria-label="${count} to check"`));
  assert.doesNotMatch(output, /Dismiss|Close/);
}
const failed = html({ status: 'failed' });
assert.match(failed, /couldn’t be checked/);
assert.match(failed, /Try again/);
assert.match(failed, /<button/);
assert.doesNotMatch(failed, /all checked/);
console.log('G379: all-time count and approved loading, pending, empty and failure treatments pass');
