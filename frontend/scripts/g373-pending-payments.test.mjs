import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import TransactionRow, { TransactionRowContent } from '../components/TransactionRow.tsx';
import PendingPaymentsGroup from '../components/PendingPaymentsGroup.tsx';
import { transactionActivityDate, transactionPostingLabel, maskTransactionText } from '../lib/transactionActivity.ts';
import { groupByDay } from '../lib/transactionGrouping.ts';

const h = React.createElement;
const tx = (extra = {}) => ({ id:'p1', account_id:'bank', date:'2026-11-02T00:00:00', activity_date:'2026-10-31T11:30:00', amount:38.60, currency:'USD', description:'Terminal 4 coffee 38.60 USD', category:'Other', transaction_type:'debit', is_pending:true, ...extra });
const row = (transaction, hidden = false, extra = {}) => renderToStaticMarkup(h(TransactionRowContent, {transaction, hidden, showActivityDate:true, ...extra}));
const pending = row(tx(), false, {onClick: () => { throw Error('pending edit'); }});
assert.match(pending, /Pending/);
assert.match(pending, /−\$38\.60/);
assert.doesNotMatch(pending, /<button|Posts|Posted|Other/);
assert.match(pending, /data-pending="true"/);
const credit = row(tx({transaction_type:'credit'}));
assert.match(credit, /\+\$38\.60/);
assert.doesNotMatch(credit, /text-emerald-500/);
assert.match(row(tx({is_pending:false})), /<button[^>]*type="button"/);

for (const currency of ['GBP', 'USD', 'EUR', 'KES', 'CHF']) {
  const hidden = row(tx({currency, description:`Merchant 123, 38.60 ${currency}`}), true);
  assert.doesNotMatch(hidden, /38\.60/);
  assert.match(hidden, /Merchant 123/);
  assert.match(hidden, /aria-label="Amount hidden"/);
  assert.match(hidden, /−/);
  assert.match(hidden, /••••/);
}
assert.equal(maskTransactionText('Terminal 4 USD 38.60 and 12.50 EUR', true), 'Terminal 4 amount hidden and amount hidden');
assert.equal(maskTransactionText('Merchant 123, CHF 28.50 and 28.50 CHF', true, 'CHF'), 'Merchant 123, amount hidden and amount hidden');
assert.equal(maskTransactionText('£38.60', false), '£38.60');
// A real row outside a loaded preferences provider must never flash money.
const initial = renderToStaticMarkup(h(TransactionRow, { transaction:tx() }));
assert.doesNotMatch(initial, /38\.60/);
assert.match(initial, /Amount hidden/);

const booked = tx({is_pending:false});
assert.equal(transactionActivityDate(booked), '2026-10-31T11:30:00');
assert.equal(booked.date, '2026-11-02T00:00:00');
assert.equal(transactionPostingLabel(booked, '2026-10-31'), 'Posts Mon 2 Nov');
assert.equal(transactionPostingLabel(booked, '2026-11-02'), 'Posted Mon 2 Nov');
assert.equal(transactionPostingLabel(tx(), '2026-10-31'), null);
assert.equal(transactionPostingLabel(tx({is_pending:false, activity_date:undefined})), null);
assert.equal(transactionActivityDate(tx({activity_date:null})), '2026-11-02T00:00:00');
assert.equal(transactionPostingLabel(tx({is_pending:false, date:'invalid'})), null);
const groups = groupByDay([booked, tx({id:'yesterday',date:'2026-10-30',activity_date:'2026-10-30',is_pending:false})].map(t => ({...t,date:transactionActivityDate(t)})));
assert.equal(groups[0].key, Date.UTC(2026, 9, 31));
assert.equal(groups[0].rows[0].id, booked.id);

const renderGroup = props => renderToStaticMarkup(h(PendingPaymentsGroup, props));
assert.equal(renderGroup({items:[]}), '');
const group = renderGroup({items:[tx()],total:201,onLoadMore:()=>{}});
assert.match(group, /Pending payments/);
assert.match(group, />201</);
assert.match(group, /Show more pending payments/);
assert.doesNotMatch(group, /38\.60/);
assert.equal((group.match(/data-transaction-id=/g)||[]).length, 1);
const error = renderGroup({items:[],error:'Pending payments could not be loaded.',onLoadMore:()=>{}});
assert.match(error, /role="status"/);
assert.match(error, /Try again/);
assert.doesNotMatch(error, />0</);
assert.match(renderGroup({items:[tx()],total:2,moreHref:'/transactions'}), /href="\/transactions"/);
assert.match(renderGroup({items:[tx()],total:2,loadingMore:true,onLoadMore:()=>{}}), /disabled=""/);
const duplicateAmounts = renderGroup({items:[tx(),tx({id:'p2'})],total:2});
assert.equal((duplicateAmounts.match(/data-transaction-id=/g)||[]).length, 2, 'distinct payments with equal amounts remain distinct');
const handover = renderGroup({items:[tx({id:'p2'})],total:1});
assert.doesNotMatch(handover, /data-transaction-id="p1"/);
console.log('G373: pending separation, read-only rows, readiness masking, FX narratives, activity dates and handover rendering passed.');
