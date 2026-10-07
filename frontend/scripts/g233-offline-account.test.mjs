// G233 offline account detail: header, avatar, transactions toolbar.
//  1. The kind line shows the type once, never "Offline · Offline".
//  2. An offline account avatar is a glyph, no "OF" initials.
//  3. Add transaction is a 44px button in the same row as the search field.
//  4. AccountsPage renders the shared parts; no em dash or "!" in the copy.
// Run: npm run -s check:g233-offline-account

import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { AccountDetailKindLine, AccountTransactionsToolbar, accountDetailKindText } from "../components/AccountDetailParts.tsx";
import { BankBadge, accountBrand } from "../components/AccountMiniCard.tsx";
import { OFFLINE_ACCOUNT } from "../app/design/offline-account/fixtures.ts";

const h = React.createElement;
const noop = () => {};
const read = (rel) => readFileSync(new URL(rel, import.meta.url), "utf8");
const text = (html) => html.replace(/<[^>]+>/g, " ");

// 1
assert.equal(accountDetailKindText("Offline", "Offline"), "Offline account");
assert.equal(accountDetailKindText("Current", "Barclays"), "Current · Barclays");
const line = renderToStaticMarkup(h(AccountDetailKindLine, { kindLabel: "Offline", provider: "Offline" }));
assert.ok(!/Offline\s*·\s*Offline/.test(text(line)), "no Offline · Offline");

// 2
const brand = accountBrand(OFFLINE_ACCOUNT);
assert.notEqual(brand.initials, "OF", "offline brand has no OF initials");
const badge = renderToStaticMarkup(h(BankBadge, { logoSrc: brand.logoSrc, initials: brand.initials, altText: brand.label, brandBg: brand.background }));
assert.ok(badge.includes("<svg"), "offline avatar renders a glyph");
assert.ok(!/>\s*OF\s*</.test(badge), "no OF text in the avatar");

// 3
const bar = renderToStaticMarkup(h(AccountTransactionsToolbar, { searchQuery: "", onSearchChange: noop, onClearSearch: noop, onAdd: noop }));
const [barOpen] = bar.split("<input");
assert.ok(barOpen.includes("flex items-center gap-3"), "search and button share one row with a 12px gap");
const btn = bar.slice(bar.indexOf("<button"));
assert.ok(btn.includes("min-h-[44px]") && btn.includes("min-w-[44px]"), "Add transaction is a 44px button");
assert.ok(btn.includes('aria-label="Add transaction"') && btn.includes("Add transaction</span>"), "named Add transaction");
assert.ok(!btn.includes("bg-indigo-"), "outlined secondary, not indigo fill");
assert.ok(bar.indexOf("<input") < bar.indexOf("<button"), "button sits after the field in the same row");
assert.ok(bar.includes("mb-5"), "20px before the list");
const none = renderToStaticMarkup(h(AccountTransactionsToolbar, { searchQuery: "", onSearchChange: noop, onClearSearch: noop }));
assert.ok(!none.includes("Add transaction"), "no add button for a bank account");

// 4
const page = read("../app/components/AccountsPage.tsx");
assert.ok(page.includes("<AccountTransactionsToolbar") && page.includes("<AccountDetailKindLine"), "AccountsPage uses the shared parts");
assert.ok(!page.includes('<div className="flex justify-end pb-1">\n                  <button\n                    onClick={openAddManualTx}'), "old floating button gone");
for (const f of ["../components/AccountDetailParts.tsx", "../app/design/offline-account/OfflineAccountClient.tsx", "../app/design/offline-account/fixtures.ts"]) {
  const src = read(f).replace(/\/\/.*$/gm, "");
  assert.ok(!src.includes("—"), `${f}: no em dash`);
  assert.ok(!/["'>`][^"'`<>]*[A-Za-z]!["'<`]/.test(src), `${f}: no exclamation mark in copy`);
}
console.log("g233-offline-account: ok");
