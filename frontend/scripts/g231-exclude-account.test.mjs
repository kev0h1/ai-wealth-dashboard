// G231 (2026-10-07): counted accounts. Pins the hero line "Not counting N
// accounts", the quiet "Not counted" tag on an Accounts row, the account sheet's
// switch row and its refusal reason, the spend-from exclusion and the
// Upcoming walk exclusion, all against the production components.
//
// Run: npm run -s check:g231-exclude-account
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import React from "react";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime.js";
import { renderToStaticMarkup } from "react-dom/server";
import SafeToSpendCard, { notCountingLabel } from "../components/SafeToSpendCard.tsx";
import AccountLedgerRow from "../components/AccountLedgerRow.tsx";
import CountTowardsSafeToSpendRow, { COUNT_TOWARDS_HELPER, COUNT_TOWARDS_LABEL } from "../components/CountTowardsSafeToSpendRow.tsx";
import { FIGURE_DATA } from "../app/design/safe-to-spend-figure/fixtures.ts";
import { bankToRow } from "../lib/accountsEstate.ts";
import { bestSpendAccount } from "../lib/spendFromAccount.ts";
import { walkUpcomingAccounts } from "../lib/upcomingAccountWalk.ts";

const noop = () => {};
const router = { back: noop, forward: noop, refresh: noop, push: noop, replace: noop, prefetch: noop };
const render = (props) => renderToStaticMarkup(React.createElement(AppRouterContext.Provider, { value: router }, React.createElement(SafeToSpendCard, { loading: false, onRetry: noop, previewBalancesVisible: true, ...props })));
const clean = (label, html) => {
  assert.ok(!html.includes("—"), `${label}: no em dash`);
  assert.ok(!html.includes("!"), `${label}: no exclamation mark`);
};

// 1. Hero line.
assert.equal(notCountingLabel(1), "Not counting 1 account");
assert.equal(notCountingLabel(2), "Not counting 2 accounts");
{
  const html = render({ data: FIGURE_DATA.excluded });
  assert.match(html, /data-g231-not-counting/);
  assert.match(html, />Not counting 2 accounts</);
  const link = html.match(/<a[^>]*data-g231-not-counting[^>]*>/)[0];
  assert.match(link, /href="\/accounts"/, "links to Accounts");
  assert.match(link, /text-slate-600/, "ink only");
  assert.doesNotMatch(link.replace("focus-visible:ring-indigo-500", ""), /indigo|amber|rose|red-|emerald|violet/, "no colour (the focus ring is the one shared exception)");
  assert.match(link, /min-h-11/, "44px target");
  assert.ok(html.indexOf("data-g231-not-counting") < html.indexOf("data-sts-disclaimer"), "sits above the footer");
  assert.match(html, /Across counted current accounts\./);
  clean("excluded hero", html);
  const one = render({ data: { ...FIGURE_DATA.excluded, excluded_accounts_count: 1, excluded_accounts: [{ id: "a", name: "Joint" }] } });
  assert.match(one, />Not counting 1 account</);
}
assert.ok(!render({ data: FIGURE_DATA["on-track"] }).includes("data-g231-not-counting"), "nothing when every account counts");
assert.ok(!render({ data: { ...FIGURE_DATA.excluded, excluded_accounts_count: 0 } }).includes("data-g231-not-counting"));
assert.ok(!render({ data: null, loading: true }).includes("data-g231-not-counting"), "no line without a figure");
assert.ok(!render({ data: null, error: true }).includes("data-g231-not-counting"));
// The Full calculation ledger gains no new line.
assert.doesNotMatch(render({ data: FIGURE_DATA.excluded }), /Excluded|excluded accounts/i);

// 2. Accounts row tag.
const acct = { id: "a1", name: "Joint bills", type: "Current", subtype: "CURRENT", balance: 420, currency: "GBP", provider: "Barclays", status: "connected" };
{
  const tagged = renderToStaticMarkup(React.createElement(AccountLedgerRow, { row: bankToRow({ ...acct, include_in_safe_to_spend: false }, []), onClick: noop }));
  assert.match(tagged, /data-g231-not-counted/);
  assert.match(tagged, /Not counted/);
  assert.match(tagged, /not counted towards Safe to Spend/, "spoken state");
  assert.match(tagged, /£420/, "balance still shows");
  assert.match(tagged, /text-slate-500/);
  clean("tagged row", tagged);
  for (const flag of [undefined, true]) {
    const plain = renderToStaticMarkup(React.createElement(AccountLedgerRow, { row: bankToRow({ ...acct, include_in_safe_to_spend: flag }, []), onClick: noop }));
    assert.ok(!plain.includes("Not counted"), "counted rows carry no tag");
  }
}

// 3. Account sheet row.
{
  const on = renderToStaticMarkup(React.createElement(CountTowardsSafeToSpendRow, { counted: true, onChange: noop }));
  assert.ok(on.includes(COUNT_TOWARDS_LABEL) && COUNT_TOWARDS_LABEL === "Count towards Safe to Spend");
  assert.equal(COUNT_TOWARDS_HELPER, "Turn off for accounts you do not spend from, like a joint bills account.");
  assert.ok(on.includes(COUNT_TOWARDS_HELPER));
  assert.match(on, /role="switch"[^>]*aria-checked="true"|aria-checked="true"[^>]*role="switch"/);
  assert.match(on, /min-w-\[44px\] min-h-\[44px\]/, "44px target");
  assert.ok(!on.includes("data-g231-count-reason"));
  const off = renderToStaticMarkup(React.createElement(CountTowardsSafeToSpendRow, { counted: false, onChange: noop }));
  assert.match(off, /aria-checked="false"/);
  const reason = "This account pays 2 upcoming items this period, so it has to count";
  const refused = renderToStaticMarkup(React.createElement(CountTowardsSafeToSpendRow, { counted: true, onChange: noop, reason }));
  assert.match(refused, /data-g231-count-reason/);
  assert.ok(refused.includes(reason));
  assert.match(refused, /role="alert"/);
  for (const html of [on, off, refused]) clean("count row", html);
  // Only connected current and savings accounts get the row.
  const page = readFileSync(new URL("../app/components/AccountsPage.tsx", import.meta.url), "utf8");
  assert.match(page, /!isManual && !isStatement && !isCredit && \(\s*<div className="px-4 pt-4">\s*<CountTowardsSafeToSpendRow/);
  assert.match(page, /invalidateAllAccountData\(\);\s*\} catch \(err\)/, "caches clear after a successful toggle");
}

// 4. Spend from never offers an excluded account.
{
  const accounts = [
    { ...acct, id: "joint", include_in_safe_to_spend: false, cover_source_eligible: true },
    { ...acct, id: "main", name: "Main", cover_source_eligible: true },
  ];
  const eligibility = { joint: { short: false, headroom: 900, spend_from_headroom: 900 }, main: { short: false, headroom: 80, spend_from_headroom: 80 } };
  const result = bestSpendAccount(eligibility, accounts);
  assert.equal(result.kind, "account");
  assert.equal(result.best.accountId, "main");
  assert.equal(result.alternative, null);
  const onlyExcluded = bestSpendAccount({ joint: eligibility.joint }, [accounts[0]]);
  assert.equal(onlyExcluded.kind, "none");
}

// 5. Upcoming's By account list drops an excluded account.
{
  const bill = (account_id, name) => ({ name, amount: 10, expected_date: "2026-10-12", days_away: 5, account_id, account_name: account_id, account_balance: 100, kind: "commitment", is_credit_card: false });
  const cashflow = { upcoming_bills: [bill("main", "Rent"), bill("joint", "Council tax")], upcoming_income: [], internal_inflows: [] };
  const end = Date.parse("2026-10-30");
  assert.deepEqual(walkUpcomingAccounts(cashflow, end).accounts.map((a) => a.id).sort(), ["joint", "main"]);
  assert.deepEqual(walkUpcomingAccounts(cashflow, end, [], new Set(["joint"])).accounts.map((a) => a.id), ["main"]);
  const withPlanSource = walkUpcomingAccounts({ upcoming_bills: [], upcoming_income: [], internal_inflows: [] }, end, [{ id: "joint", bank: "Barclays", name: "Joint", balance: 50 }], new Set(["joint"]));
  assert.equal(withPlanSource.accounts.length, 0, "an excluded plan source is not listed either");
}

console.log("g231-exclude-account: all assertions passed");
