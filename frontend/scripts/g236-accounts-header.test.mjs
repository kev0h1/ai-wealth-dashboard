// G236 Accounts header: the production header pin.
// Re-pinned DELIBERATELY by the G236 fold-in (Kevin picked variant A, "Verdict
// header", 2026-10-10). Before the fold-in this test pinned the header
// byte-for-byte against the old inline block (title, subtitle, Add menu, Net worth
// with its eye). It now pins the A header: title, Net worth as the Display
// figure, "across N accounts" caption, the "Balances hidden · Show" chip when
// asked for, and NO eye. Any change to components/AccountsHeader.tsx markup must
// update EXPECTED below on purpose, with a reason in the commit.
//  1. Shown, hidden and chip-visible renders match the pinned markup.
//  2. AccountLedgerRow is unchanged without hideAmount and masks the balance,
//     visibly and in its spoken label, with it.
//
// Run: npm run -s check:g236-accounts-header

import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import AccountsHeader from "../components/AccountsHeader.tsx";
import AccountLedgerRow from "../components/AccountLedgerRow.tsx";

const h = React.createElement;
const noop = () => {};
const render = (props) => renderToStaticMarkup(h(AccountsHeader, { onShow: noop, showChip: false, ...props }));

const SHOWN = '<header class="mb-4"><h1 class="text-[20px] font-bold leading-tight text-slate-950 dark:text-white">Accounts</h1><div class="mt-5" data-tutorial-id="tutorial-networth"><p class="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Net worth</p><p class="money mt-1 text-[30px] font-bold leading-[1.2] tracking-[-0.025em] text-slate-950 dark:text-white"><span aria-hidden="true">£47,310</span><span class="sr-only">£47,310</span></p><p class="mt-1 text-xs text-slate-600 dark:text-slate-400">across 6 accounts</p></div></header>';
assert.equal(render({ netWorth: { value: 47310, accountCount: 6 }, hidden: false }), SHOWN, "shown header markup is pinned");

const hidden = render({ netWorth: { value: 47310, accountCount: 6 }, hidden: true, showChip: true });
assert.ok(hidden.includes('<span aria-hidden="true">£••••</span><span class="sr-only">Balance hidden</span>'), "hidden figure is masked and spoken as hidden");
assert.ok(!hidden.includes("47,310"), "hidden header prints no balance");
assert.ok(hidden.includes("data-hidden-chip") && hidden.includes("Balances hidden · Show"), "chip shows when asked");
assert.ok(!render({ netWorth: { value: 1, accountCount: 1 }, hidden: true, showChip: false }).includes("data-hidden-chip"), "no chip unless asked");
assert.ok(render({ netWorth: { value: -1234, accountCount: 1 }, hidden: false }).includes("−£1,234") && render({ netWorth: { value: -1234, accountCount: 1 }, hidden: false }).includes("across 1 account<"), "negative uses the currency minus, singular caption");
assert.ok(!render({ netWorth: null, hidden: false }).includes("Net worth"), "no Net worth block until the KPIs load");

{
  const row = { id: "r", name: "Premier Current", provider: "Barclays", kind: "Current", balance: 1284.5, status: "connected", pinned: false, dormant: false, attention: false, source: "bank", raw: { id: "r", name: "Premier Current", type: "Current", balance: 1284.5, currency: "GBP", provider: "Barclays", status: "connected" } };
  const plain = renderToStaticMarkup(h(AccountLedgerRow, { row }));
  const masked = renderToStaticMarkup(h(AccountLedgerRow, { row, hideAmount: true }));
  assert.ok(plain.includes("£1,285"), "unmasked row prints the balance");
  assert.ok(!masked.includes("£1,285") && masked.includes("£••••") && masked.includes("balance hidden"), "masked row hides the balance and speaks it hidden");
  assert.equal(renderToStaticMarkup(h(AccountLedgerRow, { row, hideAmount: false })), plain, "hideAmount false renders as before");
}
console.log("g236-accounts-header: ok");
