import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { HomeTransfersCheckView, transferReviewCount } from '../components/HomeTransfersCheck.tsx';

assert.equal(transferReviewCount({ review_total: 7, count: 0, pair_count: 0 }), 7);
assert.equal(transferReviewCount({ review_total: 0, count: 9 }), 0);
for (const value of [undefined, null, -1, 0.5, NaN, Infinity, '3']) {
  assert.throws(() => transferReviewCount({ review_total: value }), 'Malformed data must never say all checked');
}
const html = state => renderToStaticMarkup(React.createElement(HomeTransfersCheckView, { state, onRetry() {} }));
assert.match(html({ status: 'loading' }), /Checking for transfers/);
assert.doesNotMatch(html({ status: 'loading' }), /all checked/);
assert.match(html({ status: 'ready', count: 0 }), /Transfers all checked/);
for (const count of [1, 14, 1000]) {
  const output = html({ status: 'ready', count });
  assert.match(output, /Check your transfers/);
  assert.match(output, /href="\/spend\?review=1"/);
  assert.match(output, new RegExp(`aria-label="${count} to check"`));
  assert.doesNotMatch(output, /Dismiss|Close/);
}
const failed = html({ status: 'failed' });
assert.match(failed, /couldn’t be checked/);
assert.match(failed, /Try again/);
assert.match(failed, /href="\/spend\?review=1"/);
assert.doesNotMatch(failed, /all checked/);
console.log('G379: all-time count and approved loading, pending, empty and failure treatments pass');
