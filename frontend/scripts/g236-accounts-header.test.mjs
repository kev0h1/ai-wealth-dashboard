// G236 Accounts header: the production header pin.
// Re-pinned for G250 I Console, Kevin 2026-10-13: the header is now the title and
// one glass-card instrument (Net worth label, 30px figure, caption, 44px tint Add
// in the corner, privacy rail with Show when hidden). No floating Add, no eye.
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
import { formatUpdated } from "../lib/updatedLabel.ts";
import AccountLedgerRow from "../components/AccountLedgerRow.tsx";

const h = React.createElement;
const noop = () => {};
const render = (props) => renderToStaticMarkup(h(AccountsHeader, { onShow: noop, onAdd: noop, showChip: false, ...props }));

const SHOWN = '<header class="relative z-30"><h1 class="text-[20px] font-bold leading-tight text-slate-950 dark:text-white">Accounts</h1><div class="glass-card mt-3 rounded-2xl p-4" data-tutorial-id="tutorial-networth"><div class="flex items-start justify-between gap-3"><div class="min-w-0"><p class="text-[13px] font-medium text-slate-600 dark:text-slate-400">Net worth</p><p class="money mt-1 text-[30px] font-bold leading-[1.2] tracking-[-0.025em] text-slate-950 dark:text-white"><span aria-hidden="true">£47,310</span><span class="sr-only">£47,310</span></p></div><div class="relative -mr-1 -mt-1 shrink-0"><button type="button" data-add-control="true" data-tutorial-id="tutorial-add-account" aria-haspopup="menu" aria-expanded="false" aria-label="Add account" class="inline-flex size-11 items-center justify-center rounded-xl bg-indigo-50 text-indigo-700 transition-transform hover:bg-indigo-100 active:scale-95 motion-reduce:transition-none dark:bg-indigo-400/15 dark:text-indigo-300 dark:hover:bg-indigo-400/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"><svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-plus" aria-hidden="true"><path d="M5 12h14"></path><path d="M12 5v14"></path></svg></button></div></div><p class="mt-1 text-xs text-slate-600 dark:text-slate-400">across 6 accounts</p></div></header>';
const HIDDEN_RAIL = '<div class="-mb-2 mt-3 flex items-center justify-between gap-3 border-t border-slate-100 pt-1 dark:border-white/10" data-privacy-rail="true"><p class="inline-flex items-center gap-1.5 text-xs text-slate-600 dark:text-slate-400"><svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-eye-off" aria-hidden="true"><path d="M10.733 5.076a10.744 10.744 0 0 1 11.205 6.575 1 1 0 0 1 0 .696 10.747 10.747 0 0 1-1.444 2.49"></path><path d="M14.084 14.158a3 3 0 0 1-4.242-4.242"></path><path d="M17.479 17.499a10.75 10.75 0 0 1-15.417-5.151 1 1 0 0 1 0-.696 10.75 10.75 0 0 1 4.446-5.143"></path><path d="m2 2 20 20"></path></svg>Balances hidden</p><button type="button" data-hidden-chip="true" class="-mr-2 inline-flex min-h-11 items-center rounded-xl px-3 text-sm font-semibold text-indigo-700 transition-transform active:scale-95 motion-reduce:transition-none dark:text-indigo-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500">Show<span class="sr-only"> balances</span></button></div>';
assert.equal(render({ netWorth: { value: 47310, accountCount: 6 }, hidden: false }), SHOWN, "shown header markup is pinned");

const hidden = render({ netWorth: { value: 47310, accountCount: 6 }, hidden: true, showChip: true });
assert.ok(hidden.includes('<span aria-hidden="true">£••••</span><span class="sr-only">Balance hidden</span>'), "hidden figure is masked and spoken as hidden");
assert.ok(!hidden.includes("47,310"), "hidden header prints no balance");
assert.ok(hidden.includes("data-hidden-chip") && hidden.includes("data-privacy-rail") && hidden.includes("Balances hidden") && hidden.includes("Show<span"), "privacy rail with Show when asked");
assert.ok(hidden.includes(HIDDEN_RAIL), "privacy rail markup is pinned");
assert.ok(hidden.includes("min-h-11") && hidden.includes("size-11"), "Show and Add are 44px targets");
assert.ok(hidden.includes('aria-label="Add account"') && hidden.includes("data-add-control") && hidden.includes('data-tutorial-id="tutorial-add-account"'), "Add lives in the card corner");
assert.ok(!hidden.includes("data-updated"), "no freshness reading while hidden");
assert.ok(render({ netWorth: { value: 1, accountCount: 2 }, hidden: false, updated: "Updated 8 min ago" }).includes('across 2 accounts<span data-updated="true"> · Updated 8 min ago</span>'), "freshness reading when shown");
assert.ok(!render({ netWorth: { value: 1, accountCount: 2 }, hidden: false }).includes("data-updated"), "no freshness reading when absent");
assert.ok(!hidden.includes("gradient") && !/#[0-9a-f]{3,6}\b/i.test(hidden), "tokens only, no gradient, no raw hex");
assert.ok(!render({ netWorth: { value: 1, accountCount: 1 }, hidden: true, showChip: false }).includes("data-hidden-chip"), "no chip unless asked");
assert.ok(render({ netWorth: { value: -1234, accountCount: 1 }, hidden: false }).includes("−£1,234") && render({ netWorth: { value: -1234, accountCount: 1 }, hidden: false }).includes("across 1 account<"), "negative uses the currency minus, singular caption");
{
  // G250 review fix: a failed KPI fetch still leaves the card, the label and Add (and the tutorial target).
  const nul = render({ netWorth: null, hidden: false, showChip: true, updated: "Updated 1 min ago" });
  assert.ok(nul.includes("Net worth") && nul.includes("Not available right now"), "null state names the gap in plain words");
  assert.ok(nul.includes("data-add-control") && nul.includes('data-tutorial-id="tutorial-add-account"'), "Add and its tutorial target survive");
  assert.ok(!nul.includes("£") && !nul.includes("text-[30px]") && !nul.includes("data-privacy-rail") && !nul.includes("data-updated") && !nul.includes("across"), "no figure, rail, caption or reading");
}

{
  const now = Date.parse("2026-10-13T12:00:00Z");
  const ago = (ms) => new Date(now - ms).toISOString();
  assert.equal(formatUpdated(ago(20_000), now), "Updated just now");
  assert.equal(formatUpdated(ago(8 * 60_000), now), "Updated 8 min ago");
  assert.equal(formatUpdated(ago(60 * 60_000), now), "Updated 1 hour ago");
  assert.equal(formatUpdated(ago(5 * 3600_000), now), "Updated 5 hours ago");
  assert.equal(formatUpdated(ago(30 * 3600_000), now), "Updated yesterday");
  assert.equal(formatUpdated(ago(72 * 3600_000), now), "Updated 3 days ago");
  assert.equal(formatUpdated(null, now), undefined);
  assert.equal(formatUpdated("nonsense", now), undefined);
}

{
  const row = { id: "r", name: "Premier Current", provider: "Barclays", kind: "Current", balance: 1284.5, status: "connected", pinned: false, dormant: false, attention: false, source: "bank", raw: { id: "r", name: "Premier Current", type: "Current", balance: 1284.5, currency: "GBP", provider: "Barclays", status: "connected" } };
  const plain = renderToStaticMarkup(h(AccountLedgerRow, { row }));
  const masked = renderToStaticMarkup(h(AccountLedgerRow, { row, hideAmount: true }));
  assert.ok(plain.includes("£1,285"), "unmasked row prints the balance");
  assert.ok(!masked.includes("£1,285") && masked.includes("£••••") && masked.includes("balance hidden"), "masked row hides the balance and speaks it hidden");
  assert.equal(renderToStaticMarkup(h(AccountLedgerRow, { row, hideAmount: false })), plain, "hideAmount false renders as before");
}
console.log("g236-accounts-header: ok");
