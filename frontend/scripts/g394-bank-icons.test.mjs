// G394: resolver and rendered component paths for bank identity tiles.
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { BankIcon, accountBrand, bankKey } from "../components/AccountMiniCard.tsx";
import { MoveAccountIcon } from "../components/MoveRoute.tsx";
import { MerchantIcon, bankProviderForMerchant } from "../components/TransactionRow.tsx";

const render = node => renderToStaticMarkup(node);

assert.equal(bankKey({ provider: "American Express" }), "AMEX");
assert.equal(bankKey({ provider_id: "american_express", provider: "Card" }), "AMEX");
assert.equal(accountBrand({ provider: "American Express" }).logoSrc, "/banks/amex.png");
assert.equal(accountBrand({ provider: "Tide" }).logoSrc, "/banks/tide.svg");
assert.equal(accountBrand({ provider: "A new bank", provider_id: "new-bank", logo_url: "https://provider.invalid/logo.png", bg_colors: ["#112233"] }).logoSrc, "/api/logo/provider/new-bank");
assert.equal(accountBrand({ provider: "Offline" }).initials, "");

assert.equal(bankProviderForMerchant("NatWest"), "NatWest");
assert.equal(bankProviderForMerchant("NATWEST BANK"), null, "bank aliases must be exact, not substring matches");
assert.equal(bankProviderForMerchant("The NatWest Cafe"), null, "ordinary merchants must keep generic treatment");

for (const [name, expected] of [["NatWest", "/banks/natwest.png"], ["American Express", "/banks/amex.png"], ["Tide", "/banks/tide.svg"]]) {
  const markup = render(React.createElement(BankIcon, { identity: { provider: name }, size: 28 }));
  assert.match(markup, new RegExp(expected.replace(/[/.]/g, "\\$&")), `${name} renders its curated mark`);
}

assert.match(render(React.createElement(MoveAccountIcon, { account: { provider: "American Express", name: "Card" } })), /banks\/amex\.png/, "Move route uses the shared AMEX tile");
assert.match(render(React.createElement(MerchantIcon, { transaction: { id: "natwest", account_id: "a", date: "2026-11-02", amount: 1, currency: "GBP", description: "NatWest", transaction_type: "debit" }, colour: "#64748b" })), /banks\/natwest\.png/, "bank merchant uses the local bank tile before generic logo lookup");
assert.match(render(React.createElement(MerchantIcon, { transaction: { id: "ordinary", account_id: "a", date: "2026-11-02", amount: 1, currency: "GBP", description: "The NatWest Cafe", transaction_type: "debit" }, colour: "#64748b" })), /logo\/natwest\.com/, "ordinary merchant remains on generic icon path");

console.log("G394 bank icon resolver and component paths passed");
