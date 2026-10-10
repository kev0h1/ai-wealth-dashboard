// G236 fold-in of variant A (Kevin 2026-10-10).
//  1. AccountsHeader: no eye, Display figure, "across N accounts" caption.
//  2. AccountsPage: no eye control, no header Add, every AccountLedgerRow gets
//     hideAmount={hideNetWorth}, gated on preferencesReady, one global mask.
//  3. The floating Add: 56px, fixed bottom right above the nav, z-45, hides when told.
//  4. SettingsPage has the Hide balances row bound to hideNetWorth in Display.
//  5. No em dash or exclamation mark in the new copy.
//
// Run: npm run -s check:g236-accounts-fold-in

import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync, existsSync } from "node:fs";
import AccountsHeader from "../components/AccountsHeader.tsx";
import AccountsAddFab from "../components/AccountsAddFab.tsx";

const h = React.createElement;
const noop = () => {};
const read = (rel) => readFileSync(new URL(rel, import.meta.url), "utf8");
const ref = { current: null };

// 1. Header.
{
  const html = renderToStaticMarkup(h(AccountsHeader, { netWorth: { value: 47310, accountCount: 20 }, hidden: false, showChip: false, onShow: noop }));
  assert.ok(!html.includes("Hide balance") && !html.includes("Show balance") && !html.includes("<svg"), "no eye");
  assert.ok(html.includes("text-[30px]") && html.includes("£47,310"), "Net worth is the 30px Display figure");
  assert.ok(html.includes("across 20 accounts"), "caption");
  assert.ok(!html.includes("<button"), "no control in the header while shown, and no Add in the header");
}

// 2. Page source.
const page = read("../app/components/AccountsPage.tsx");
assert.ok(!/aria-label=\{hideNetWorth \? "Show balance"/.test(page) && !page.includes('"Hide balance"'), "no eye control on the page");
assert.ok(page.includes("preferencesReady") && /hideNetWorthPref \|\| !preferencesReady/.test(page), "masked until preferences resolve");
{
  const rows = [...page.matchAll(/<AccountLedgerRow\b/g)].map((m) => m.index);
  assert.ok(rows.length >= 5, "page renders its ledger rows");
  for (const i of rows) {
    const end = page.indexOf("/>", page.indexOf("sync=", i));
    assert.ok(page.slice(i, end).includes("hideAmount={hideNetWorth}"), `AccountLedgerRow at offset ${i} passes hideAmount={hideNetWorth}`);
  }
  assert.ok(!/<AccountMiniCard\b/.test(page), "no unmasked AccountMiniCard");
  assert.ok(!page.includes("showAdd=") && !page.includes("onToggleAdd"), "header carries no Add");
  assert.ok(page.includes("<AccountsAddFab") && page.includes("showChip={preferencesReady && hideNetWorthPref}"), "floating Add and chip wired");
  assert.ok(page.includes("onShow={() => setHideNetWorth(false)}"), "the chip toggles the same global preference");
  assert.ok(!/useState\([^)]*hide/i.test(page), "no second local mask state");
}

// 3. Floating Add.
{
  const open = renderToStaticMarkup(h(AccountsAddFab, { open: true, onToggle: noop, onClose: noop, menuRef: ref, menuItems: h("button", { type: "button" }, "Row"), suppressed: false }));
  assert.ok(open.includes("size-14") && open.includes("fixed right-5 z-[45]") && open.includes("+ 80px") || open.includes("+80px"), "56px, fixed bottom right, z-45, 80px above the nav base");
  assert.ok(open.includes('aria-label="Add account"') && open.includes('role="menu"') && open.includes('aria-expanded="true"'), "named, opens a menu");
  assert.ok(!renderToStaticMarkup(h(AccountsAddFab, { open: false, onToggle: noop, onClose: noop, menuRef: ref, menuItems: null, suppressed: false })).includes('role="menu"'), "menu closed by default");
  assert.ok(renderToStaticMarkup(h(AccountsAddFab, { open: false, onToggle: noop, onClose: noop, menuRef: ref, menuItems: null, suppressed: true })).includes(" hidden"), "hides when a sheet or Find is open");
}

// 3b. G250: the list clears the floating Add (button top edge + 24px margin).
{
  const fab = read("../components/AccountsAddFab.tsx");
  assert.ok(/ADD_FAB_LIST_CLEARANCE\s*=\s*\n?\s*"pb-\[calc\(max\(env\(safe-area-inset-bottom,0px\),10px\)\+160px\)\] lg:pb-28"/.test(fab), "list bottom padding = 80 + 56 + 24 above the nav base");
  assert.ok(page.includes("min-h-dvh ${ADD_FAB_LIST_CLEARANCE}"), "the Banks list container applies the clearance");
}

// 4. Settings.
{
  const s = read("../app/settings/SettingsPage.tsx");
  const display = s.slice(s.indexOf('title="Display"'), s.indexOf("{/* ── Your plan"));
  assert.ok(display.includes("Hide balances") && display.includes("Mask balances across the app until you choose to show them."), "Hide balances row in Display");
  assert.ok(/checked=\{hideNetWorth\}[\s\S]{0,120}setHideNetWorth\(!hideNetWorth\)/.test(display), "bound to hideNetWorth / setHideNetWorth");
  assert.ok(display.includes('preferencesSaveError?.field === "hide_net_worth"'), "save-error line");
}

// 5. Copy.
for (const f of ["../components/AccountsHeader.tsx", "../components/AccountsAddFab.tsx"]) {
  const src = read(f).replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
  assert.ok(!src.includes("—") && !/["'>`][^"'`<>]*[A-Za-z]!["'<`]/.test(src), `${f}: copy rules`);
}
assert.ok(!existsSync(new URL("../app/design/accounts-header", import.meta.url)), "the G236 preview directory is gone");
console.log("g236-accounts-fold-in: ok");
