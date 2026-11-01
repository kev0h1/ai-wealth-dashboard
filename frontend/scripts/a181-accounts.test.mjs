import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { accountKind, accountKindLabel, isBusinessAccount, isDormant } from "../lib/accountKind.ts";
import { buildEstate } from "../lib/accountsEstate.ts";
import { overdraftAvailable, availableWithOverdraftText } from "../lib/accountOverdraft.ts";
import { accountDetailKindText } from "../components/AccountDetailParts.tsx";
import AccountCountRow from "../components/AccountCountRow.tsx";

const acc = (o = {}) => ({ id: "a", name: "Account", type: "bank", subtype: "TRANSACTION", balance: 100, currency: "GBP", provider: "Bank", status: "connected", ...o });

// Loans and mortgages: their own group, never Current, never dormant at 0.
const loan = acc({ type: "debt", subtype: "LOAN", balance: -5000 });
const mortgage = acc({ id: "m", type: "debt", subtype: "MORTGAGE", balance: 0 });
assert.equal(accountKind(loan), "Debt");
assert.equal(accountKindLabel("Debt"), "Loan or mortgage");
assert.equal(isDormant(mortgage), false);
const estate = buildEstate([acc({ id: "c" }), loan, mortgage, acc({ id: "k", type: "credit_card", subtype: "CREDIT_CARD", balance: -20 })], [], []);
assert.deepEqual(estate.groups.map((g) => g.label), ["Current", "Credit cards", "Loans and mortgages"]);
assert.equal(accountKind(acc({ type: "credit_card", subtype: "CREDIT_CARD" })), "Credit", "charge cards share the credit card shape");

// Business tag.
assert.equal(isBusinessAccount({ finexer_type: "business" }), true);
assert.equal(isBusinessAccount({ finexer_type: "personal" }), false);
assert.equal(isBusinessAccount({}), false);
assert.equal(accountDetailKindText("Current", "Barclays", null, true), "Current · Barclays · Business");
assert.equal(accountDetailKindText("Current", "Barclays"), "Current · Barclays");
const countProps = { counted: false, onChange: () => {} };
const html = renderToStaticMarkup(React.createElement(AccountCountRow, { ...countProps, account: { type: "bank", subtype: "TRANSACTION", finexer_type: "business" } }));
assert.match(html, /Business accounts are not counted in Left to spend unless you switch this on\./);
assert.doesNotMatch(renderToStaticMarkup(React.createElement(AccountCountRow, { ...countProps, account: { type: "bank", subtype: "TRANSACTION", finexer_type: "personal" } })), /Business accounts/);

// Overdraft: balance stays the headline, available is a secondary, hedged line.
assert.equal(overdraftAvailable(acc({ overdraft_limit: 500, available: 620, balance: 120 })), 620);
assert.equal(overdraftAvailable(acc({ overdraft_limit: 500, available: 0, balance: -200 })), 300);
assert.equal(overdraftAvailable(acc({ overdraft_limit: 500, balance: 120 })), 620);
assert.equal(overdraftAvailable(acc({ balance: 120, available: 120 })), null, "no limit, no line");
assert.equal(overdraftAvailable(acc({ overdraft_limit: 500, manual: true })), null);
assert.equal(overdraftAvailable(acc({ overdraft_limit: 500, type: "credit_card", subtype: "CREDIT_CARD" })), null);
assert.equal(availableWithOverdraftText("£620"), "Available with overdraft about £620");
for (const s of [availableWithOverdraftText("£1"), "Business accounts are not counted in Left to spend unless you switch this on."]) {
  assert.ok(!s.includes("—") && !s.includes("!"), "no em dashes or exclamation marks");
}
console.log("a181-accounts ok");
