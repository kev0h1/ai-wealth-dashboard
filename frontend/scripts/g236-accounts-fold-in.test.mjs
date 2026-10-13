// G236 fold-in of variant A (Kevin 2026-10-10).
//  1. AccountsHeader: no eye, Display figure, "across N accounts" caption.
//  2. AccountsPage: no eye control, no header Add, every AccountLedgerRow gets
//     hideAmount={hideNetWorth}, gated on preferencesReady, one global mask.
//  3. Re-pinned for G250 I Console, Kevin 2026-10-13: no floating Add (component and clearance
//     gone); Add is the 44px tint button in the header card corner and opens the same menu.
//  4. SettingsPage has the Hide balances row bound to hideNetWorth in Display.
//  5. No em dash or exclamation mark in the new copy.
//
// Run: npm run -s check:g236-accounts-fold-in

import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync, existsSync } from "node:fs";
import AccountsHeader from "../components/AccountsHeader.tsx";

const h = React.createElement;
const noop = () => {};
const read = (rel) => readFileSync(new URL(rel, import.meta.url), "utf8");

// 1. Header.
{
  const html = renderToStaticMarkup(h(AccountsHeader, { netWorth: { value: 47310, accountCount: 20 }, hidden: false, showChip: false, onShow: noop, onAdd: noop }));
  assert.ok(!html.includes("Hide balance") && !html.includes("Show balance") && !html.includes("lucide-eye"), "no eye");
  assert.ok(html.includes("text-[30px]") && html.includes("£47,310"), "Net worth is the 30px Display figure");
  assert.ok(html.includes("across 20 accounts"), "caption");
  // re-pinned for G250 I Console, Kevin 2026-10-13: the one control is Add, in the card corner.
  assert.equal((html.match(/<button/g) || []).length, 1, "the only control while shown is the card-corner Add");
  assert.ok(html.includes("glass-card") && html.includes("Net worth"), "glass instrument card with the Net worth label");
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
  assert.ok(!page.includes("showAdd=") && !page.includes("onToggleAdd"), "no legacy header Add props");
  assert.ok(!page.includes("AccountsAddFab") && !page.includes("ADD_FAB_LIST_CLEARANCE"), "no floating Add");
  assert.ok(page.includes("onAdd={() => setAddMenuOpen(v => !v)}") && page.includes("addRef={addMenuRef}") && page.includes("updated={formatUpdated(kpis?.last_updated)}"), "header Add opens the existing menu; updated from kpis.last_updated");
  assert.ok(page.includes("showChip={preferencesReady && hideNetWorthPref}"), "privacy rail wired");
  assert.ok(page.includes("onShow={() => setHideNetWorth(false)}"), "the chip toggles the same global preference");
  assert.ok(!/useState\([^)]*hide/i.test(page), "no second local mask state");
}

// 3. No floating Add; the list keeps nav clearance only.
{
  assert.ok(!existsSync(new URL("../components/AccountsAddFab.tsx", import.meta.url)), "AccountsAddFab is gone");
  assert.ok(page.includes("min-h-dvh pb-[calc(max(env(safe-area-inset-bottom,0px),10px)+96px)] lg:pb-28"), "the list container keeps nav clearance only");
  const open = renderToStaticMarkup(h(AccountsHeader, { netWorth: { value: 1, accountCount: 2 }, hidden: false, showChip: false, onShow: noop, onAdd: noop, addOpen: true, addMenu: h("div", { role: "menu" }, "Rows") }));
  assert.ok(open.includes("size-11") && open.includes('aria-label="Add account"') && open.includes('aria-expanded="true"') && open.includes('role="menu"'), "44px Add, named, opens a menu");
  assert.ok(!renderToStaticMarkup(h(AccountsHeader, { netWorth: { value: 1, accountCount: 2 }, hidden: false, showChip: false, onShow: noop, onAdd: noop })).includes('role="menu"'), "menu closed by default");
  assert.ok(!/\bfixed\b/.test(open), "nothing fixed in the header");
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
for (const f of ["../components/AccountsHeader.tsx", "../lib/updatedLabel.ts"]) {
  const src = read(f).replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
  assert.ok(!src.includes("—") && !/["'>`][^"'`<>]*[A-Za-z]!["'<`]/.test(src), `${f}: copy rules`);
}
assert.ok(!existsSync(new URL("../app/design/accounts-header", import.meta.url)), "the G236 preview directory is gone");
console.log("g236-accounts-fold-in: ok");
