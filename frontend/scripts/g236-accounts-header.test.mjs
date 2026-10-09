// G236 Accounts header round (eye, header balance, one-handed Add).
//  1. components/AccountsHeader.tsx renders byte-identical to the header block
//     that stood inline in AccountsPage.tsx on origin/main (the baseline module
//     scripts/g236-header-baseline.tsx), across tab, menu, hidden, KPI-loaded,
//     card and offline combinations; AccountsPage renders the extraction.
//  2. AccountLedgerRow is unchanged without the new hideAmount prop and masks the
//     balance, visibly and in its spoken label, with it.
//  3. Variants a, b and c render no page-level eye (the Hide balance / Show
//     balance button); today still does.
//  4. Each variant has exactly one Add control with an accessible name and a
//     44px target (the floating action in A is 56px).
//  5. Hidden balances: every figure is masked and the "Balances hidden" chip
//     shows; shown, the chip is absent. (Today's rows stay unmasked: pinned as
//     the defect this round fixes.)
//  6. No em dash and no exclamation mark in the preview source or rendered text.
//
// Run: npm run -s check:g236-accounts-header

import assert from "node:assert/strict";
import React from "react";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime.js";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import AccountsHeader from "../components/AccountsHeader.tsx";
import AccountLedgerRow from "../components/AccountLedgerRow.tsx";
import { LegacyAccountsHeader } from "./g236-header-baseline.tsx";
import AccountsHeaderPreview from "../app/design/accounts-header/AccountsHeaderPreview.tsx";
import { estateFor } from "../app/design/accounts-header/fixtures.ts";

const h = React.createElement;
const noop = () => {};
const router = { back: noop, forward: noop, refresh: noop, push: noop, replace: noop, prefetch: noop };
const read = (rel) => readFileSync(new URL(rel, import.meta.url), "utf8");
const text = (html) => html.replace(/<[^>]+>/g, " ");
const count = (html, needle) => html.split(needle).length - 1;
const ref = { current: null };
const menu = h("button", { type: "button" }, "Menu row");

// 1. Byte-identical extraction.
for (const tab of ["Banks", "Investments"])
  for (const addMenuOpen of [false, true])
    for (const hidden of [false, true])
      for (const loaded of [false, true])
        for (const [cards, offline] of [[0, 0], [731, 2]]) {
          const accounts = cards > 0 ? [{ type: "bank", subtype: "CREDIT_CARD", balance: -cards }, { type: "bank", subtype: "TRANSACTION", balance: 90 }] : [{ type: "bank", subtype: "TRANSACTION", balance: 90 }];
          const manual = Array.from({ length: offline });
          const legacy = renderToStaticMarkup(h(LegacyAccountsHeader, {
            tab, addMenuOpen, setAddMenuOpen: noop, addMenuRef: ref, addMenuItems: menu,
            kpis: loaded ? { net_worth: loaded && cards ? -1234 : 47310 } : null,
            accounts, bankAccounts: accounts, investmentAccounts: [1], manualAccounts: manual,
            hideNetWorth: hidden, setHideNetWorth: noop,
          }));
          const extracted = renderToStaticMarkup(h(AccountsHeader, {
            showAdd: tab === "Banks", addMenuOpen, onToggleAdd: noop, addMenuRef: ref, addMenuItems: menu,
            netWorth: loaded ? { value: cards ? -1234 : 47310, cardTotal: cards, bankCount: accounts.length, investmentCount: 1, offlineCount: offline } : null,
            hidden, onToggleHidden: noop,
          }));
          assert.equal(extracted, legacy, `header markup identical (${tab}, menu ${addMenuOpen}, hidden ${hidden}, loaded ${loaded}, cards ${cards})`);
        }
{
  const page = read("../app/components/AccountsPage.tsx");
  assert.ok(page.includes("<AccountsHeader") && page.includes("headerNetWorth"), "AccountsPage renders the extracted header");
  assert.ok(!page.includes('aria-label={hideNetWorth ? "Show balance" : "Hide balance"}'), "the eye markup lives only in AccountsHeader");
  assert.ok(!/\.map\(row => <AccountLedgerRow[^)]*hideAmount/.test(page), "AccountsPage wiring unchanged by this round");
}

// 2. AccountLedgerRow.
{
  const row = { id: "r", name: "Premier Current", provider: "Barclays", kind: "Current", balance: 1284.5, status: "connected", pinned: false, dormant: false, attention: false, source: "bank", raw: { id: "r", name: "Premier Current", type: "Current", balance: 1284.5, currency: "GBP", provider: "Barclays", status: "connected" } };
  const plain = renderToStaticMarkup(h(AccountLedgerRow, { row }));
  const masked = renderToStaticMarkup(h(AccountLedgerRow, { row, hideAmount: true }));
  assert.ok(plain.includes("£1,285"), "unmasked row prints the balance");
  assert.ok(!masked.includes("£1,285") && masked.includes("£••••") && masked.includes("balance hidden"), "masked row hides the balance and speaks it hidden");
  assert.equal(renderToStaticMarkup(h(AccountLedgerRow, { row, hideAmount: false })), plain, "hideAmount false renders as before");
}

// 3 to 5. Variants.
const wrap = (props) => renderToStaticMarkup(h(AppRouterContext.Provider, { value: router }, h(AccountsHeaderPreview, props)));
const hasFigure = (html) => /£\s?[0-9]/.test(html);
for (const c of ["6", "20"]) {
  for (const v of ["a", "b", "c", "d", "e", "f"]) {
    for (const hidden of [false, true]) {
      const html = wrap({ variant: v, count: c, hidden });
      const tag = `${v}/${c}/${hidden ? "hidden" : "shown"}`;
      // 3
      assert.ok(!html.includes('aria-label="Hide balance"') && !html.includes('aria-label="Show balance"'), `${tag}: no page-level eye`);
      // 4
      assert.equal(count(html, "data-add-control"), 1, `${tag}: exactly one Add control`);
      const btn = html.slice(html.lastIndexOf("<button", html.indexOf("data-add-control")), html.indexOf(">", html.indexOf("data-add-control")) + 1);
      assert.ok(v === "e" ? /Add (an?|account)/.test(html.slice(html.indexOf("data-add-control"), html.indexOf("data-add-control") + 900)) : btn.includes('aria-label="Add account"'), `${tag}: Add has an accessible name`);
      assert.ok(v === "a" ? btn.includes("size-14") : btn.includes("min-h-11"), `${tag}: ${v === "a" ? "56px floating action" : "44px target"}`);
      // 5
      if (hidden) {
        assert.ok(!hasFigure(html), `${tag}: every figure is masked (visible text and labels)`);
        assert.equal(count(html, "data-hidden-chip"), 1, `${tag}: one chip`);
        assert.ok(text(html).includes("Balances hidden · Show"), `${tag}: Balances hidden chip text`);
        assert.ok(text(html).includes("££") === false, `${tag}: no doubled sign`);
      } else {
        assert.ok(hasFigure(html), `${tag}: figures show when not hidden`);
        assert.equal(count(html, "data-hidden-chip"), 0, `${tag}: no chip when shown`);
      }
      // 6
      const t = text(html);
      assert.ok(!t.includes("—") && !t.includes("!"), `${tag}: no em dash or exclamation mark`);
    }
  }
  // Today keeps the eye, and still leaks the rows when hidden (the defect).
  const today = wrap({ variant: "today", count: c, hidden: true });
  assert.ok(today.includes('aria-label="Show balance"'), `today/${c}: the eye is there`);
  assert.ok(hasFigure(text(today)), `today/${c}: hidden still prints the account rows (the defect)`);
}
// Menu open: one menu, items present, still one Add control.
for (const v of ["a", "b", "c", "d", "e", "f"]) {
  const html = wrap({ variant: v, count: "6", hidden: false, menuOpen: true });
  assert.equal(count(html, 'role="menu"'), 1, `${v}: one open menu`);
  assert.equal(count(html, "data-add-control"), 1, `${v}: still one Add control`);
}
assert.ok(estateFor("6").rows.length === 6 && estateFor("20").rows.length === 20, "fixtures hold 6 and 20 accounts");

// 6. Source copy.
for (const f of ["../components/AccountsHeader.tsx", "../app/design/accounts-header/AccountsHeaderPreview.tsx", "../app/design/accounts-header/AccountsHeaderClient.tsx", "../app/design/accounts-header/fixtures.ts"]) {
  const src = read(f).replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
  assert.ok(!src.includes("—"), `${f}: no em dash`);
  assert.ok(!/["'>`][^"'`<>]*[A-Za-z]!["'<`]/.test(src), `${f}: no exclamation mark in copy`);
}
console.log("g236-accounts-header: ok");
