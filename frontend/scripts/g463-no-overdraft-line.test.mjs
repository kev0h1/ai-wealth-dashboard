// G463: no account page renders the "Available with overdraft" line.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";

const React = (await import("react")).default;
const { default: Row } = await import("../components/AccountLedgerRow.tsx");
const { bankToRow } = await import("../lib/accountsEstate.ts");
const acc = { id: "a", name: "Account", type: "bank", subtype: "TRANSACTION", balance: 100, currency: "GBP", provider: "Bank", status: "connected", overdraft_limit: 500, available: 600 };
const html = renderToStaticMarkup(React.createElement(Row, { row: bankToRow(acc, []) }));
assert.doesNotMatch(html, /with overdraft/i, "account list row must not render the overdraft line");
assert.doesNotMatch(html, /data-a181-overdraft/);

for (const f of ["../app/components/AccountsPage.tsx", "../components/AccountLedgerRow.tsx"]) {
  const src = readFileSync(new URL(f, import.meta.url), "utf8");
  assert.doesNotMatch(src, /availableWithOverdraftText|AVAILABLE_WITH_OVERDRAFT|data-a181-overdraft|with overdraft/i, `${f} must not render the overdraft line`);
}
console.log("g463-no-overdraft-line ok");
