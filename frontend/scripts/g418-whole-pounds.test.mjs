// G418: summary Spend from and Available figures are whole pounds; pence stay
// inside the working ledgers (G415 rule). Rounding is the hero's: Intl nearest
// pound, halves away from zero, each figure on its own.
import assert from "node:assert/strict";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import SpendFromAccountList from "../components/SpendFromAccountList.tsx";
import AccountAvailabilityDetail from "../components/AccountAvailabilityDetail.tsx";
import { formatAvailabilityAmount } from "../lib/accountAvailability.ts";
import { formatSafeToSpendAmount } from "../lib/pennyScreenViews.ts";
import { bestSpendAccount, spendFromTreatmentPlan } from "../lib/spendFromAccount.ts";

for (const v of [0, 1, 8.25, 108.36, 287.29, 142.65, 483.21, 26.5, 1234.5, 1000000.49]) {
  assert.equal(formatAvailabilityAmount(v), formatSafeToSpendAmount(v), `same rule as the hero for ${v}`);
}
assert.equal(formatAvailabilityAmount(0.4), "£0.40", "a non-zero amount under a pound never reads as £0");

const account = (id, provider) => ({ id, provider, name: `${provider} Current`, type: "BANK", subtype: "TRANSACTION", currency: "GBP", balance: 1000, status: "connected" });
const accounts = [account("a", "barclays"), account("b", "hsbc"), account("c", "monzo")];
const amounts = [287.29, 142.65, 14.1];
const eligibility = Object.fromEntries(accounts.map((a, i) => [a.id, { headroom: 1000, short: false, spend_from_headroom: amounts[i], is_current_account: true }]));
const plan = spendFromTreatmentPlan(bestSpendAccount(eligibility, accounts), () => true, 444.04);
const list = renderToStaticMarkup(h(SpendFromAccountList, { entries: plan.entries, amount: formatAvailabilityAmount, coverMoveVisible: false, onLogoError() {}, kind: "bank-rail" }));
assert.ok(list.includes("£287") && list.includes("£143"), "Spend from rows are whole pounds");
assert.ok(!/£\d[\d,]*\.\d\d/.test(list), "no pence in the Spend from summary");
assert.ok(list.includes("Showing your top 2. See them all in Your accounts."), "the top-two line is kept");
assert.ok(!/add up|adds up|total|exactly|sum/i.test(list), "rounded rows never claim an exact sum");

const working = (basis, extra = {}) => ({ basis, lowest: false, movesOut: [], movesIn: [], savingsMove: null, ...extra });
const reading = { kind: "ready", value: 287.29, working: working(287.29) };
const position = { after_payments: 287.29, plans_reserved: 0, after_payments_and_plans: 287.29 };
const detail = renderToStaticMarkup(h(AccountAvailabilityDetail, { reading, position, hidden: false, layout: "calm" }));
const summary = detail.match(/<summary[\s\S]*?<\/summary>/)[0];
assert.ok(summary.includes("£287") && !/£287\.\d\d/.test(summary), "account page summary line is whole pounds");
assert.ok(detail.includes("£287.29"), "the account working ledger keeps pence");
const short = renderToStaticMarkup(h(AccountAvailabilityDetail, { reading: { kind: "ready", value: -289.4, warning: "payments", working: working(-289.4) }, position: { after_payments: -289.4, low_point: -289.4, plans_reserved: 0 }, hidden: false, layout: "calm" }));
const shortSummary = short.match(/<summary[\s\S]*?<\/summary>/)[0].replace(/<[^>]+>/g, "").replace(/<!-- -->/g, "");
assert.ok(shortSummary.includes("£289 short") && !/£289\.\d\d/.test(shortSummary) && short.includes("−£289.40"), "short summary whole pounds, ledger pence");
console.log("g418-whole-pounds ok");

// F1 (G463): the Accounts list no longer renders the overdraft line at all.
{
  const React = (await import("react")).default;
  const { default: Row } = await import("../components/AccountLedgerRow.tsx");
  const { bankToRow } = await import("../lib/accountsEstate.ts");
  const acc = { id: "a", name: "Account", type: "bank", subtype: "TRANSACTION", balance: 100.4, currency: "GBP", provider: "Bank", status: "connected", overdraft_limit: 500, available: 600.37 };
  const html = renderToStaticMarkup(React.createElement(Row, { row: bankToRow(acc, []) }));
  assert.doesNotMatch(html, /with overdraft/i);
  assert.ok(!/£600/.test(html), "the bank's available figure is not shown on the row");
}
