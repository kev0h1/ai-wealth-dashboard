// G278: provider anchor. Pins: the big figure is labelled Value (never Growth),
// the header line says "paid in since", the anchor entry point and Edit anchor
// link, the provider's rate labelled "from Vanguard", the reconciliation line
// with its "Use Vanguard's value" control, every holding with units and price
// (or No price yet), the secondary statement-period and purchase sections, and
// copy rules (no em dash, no exclamation).
//
// Run: npm run -s check:g278-anchor

import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import PortfolioGrowthCard from "../components/PortfolioGrowthCard.tsx";
import PortfolioGrowthDetail from "../components/PortfolioGrowthDetail.tsx";
import { parseMoneyInput, parsePercentInput, reconciliationText, fromProvider } from "../lib/investmentGrowth.ts";

const h = React.createElement;
const read = (rel) => readFileSync(new URL(rel, import.meta.url), "utf8");

const holdings = [
  { id: "h1", name: "FTSE Global All Cap", isin: null, type: "Fund", units: 51.67, price: 300, value: 15501, statement_value: 14835.59, cost: null, cost_source: null, gain_abs: null, gain_pct: null, change_abs: null, change_pct: null, price_date: "2026-10-15" },
  { id: "note:sp", name: "S&P 500 UCITS ETF", isin: null, type: "Fund", units: 43, price: null, value: 4908.98, statement_value: 0, cost: 4908.98, cost_source: "contract_notes", gain_abs: 0, gain_pct: 0, change_abs: null, change_pct: null, price_date: null },
  { id: "c", name: "Cash", isin: null, type: "Cash", units: null, price: null, value: 0.06, statement_value: 0.06, cost: null, cost_source: null, gain_abs: null, gain_pct: null, change_abs: null, change_pct: null, price_date: null },
];
const anchor = { date: "2026-10-15", provider_value: 20313.61, provider_return: 1341.92, total_paid_in: null, provider_rate_of_return_pct: 14.61, source: "user", use_provider_value: false };
const base = {
  account_id: "a1", currency: "GBP", range: "all", method: "simple", method_label: "Simple gain, not a time-weighted return", provider: "Vanguard",
  statement_date: "2026-09-04", points: [{ date: "2026-10-14", value: 20000, paid_in: null }, { date: "2026-10-15", value: 20342.64, paid_in: null }],
  since: null, as_of: "2026-10-15", value: 20342.64, paid_in: 4908.98, growth_abs: -73.2, growth_pct: -1.49,
  holdings_with_cost: 1, holdings_total: 3, cost_coverage: "over 1 of 3 holdings", holdings,
  lifetime: null, anchor: null,
  since_statement: { date: "2026-09-04", closing_value: 14835.65, paid_in: 5308.98, growth_abs: 198.01, fees: 0 },
  statement_periods: [{ from: "2026-06-05", to: "2026-09-04", opening_value: 13170.84, closing_value: 14835.65, payments_in: 1200, withdrawals: 0, growth_abs: 464.81, growth_pct: 3.53, fees: 12, interest: 0, before_fees_and_interest: 476.81 }],
  periods_chain: null,
  purchases: [{ date: "2026-07-01", fund_name: "FTSE Global All Cap", units: 1.3762, amount: 400, price: 300, value: 412.86, gain_abs: 12.86, gain_pct: 3.2, source: "statement" }],
};
const life = {
  anchor, provider: "Vanguard", net_paid_in_at_anchor: 18971.69, paid_in_after: 0, withdrawn_after: 0, paid_in: 18971.69,
  growth_abs: 1370.95, growth_pct: 7.23, since: "2026-10-15",
  rate_of_return: { pct: 14.61, as_of: "2026-10-15", label: "from Vanguard", note: "Money-weighted, as shown by your provider. Sorted does not recompute it." },
  reconciliation: { date: "2026-10-15", ours: 20342.64, provider_value: 20313.61, difference: 29.03, override: false },
};
const noop = () => {};

// No anchor: Value leads, the entry point is offered, no growth label on the big figure.
const noAnchor = renderToStaticMarkup(h(PortfolioGrowthCard, { title: "Value", growth: base, range: "all", status: "ready", onAnchor: noop }));
assert.ok(noAnchor.includes(">Value<"), "the big figure is labelled Value");
assert.ok(!/>Growth<\/h2>/.test(noAnchor), "the heading is never Growth");
assert.ok(noAnchor.includes("£20,342.64"), "the value shows");
assert.ok(noAnchor.includes("Anchor from your provider to see lifetime growth"), "entry point with no anchor");
assert.ok(!noAnchor.includes("Edit anchor"), "no Edit anchor without an anchor");
assert.ok(noAnchor.includes("Growth since your 4 Sep statement") && noAnchor.includes("+£198.01"), "growth since the statement, secondary");
assert.ok(noAnchor.includes("Cost is known for 1 of 3 holdings"), "partial cost says so instead of a misleading pair");

// Anchor set: lifetime leads, the rate is the provider's, reconciliation and its control show.
const withAnchor = { ...base, anchor, lifetime: life };
const html = renderToStaticMarkup(h(PortfolioGrowthCard, { title: "Value", growth: withAnchor, range: "all", status: "ready", onAnchor: noop, onOverride: noop }));
assert.ok(html.includes("Growth since you started") && html.includes("+£1,370.95"), "lifetime growth from the anchor");
assert.ok(html.includes("14.61%") && html.includes("from Vanguard"), "provider rate labelled from Vanguard");
assert.ok(html.includes("as of 15 Oct 2026"), "rate is dated");
assert.ok(html.includes("Sorted shows £20,342.64, Vanguard showed £20,313.61 on 15 Oct, likely price timing."), "reconciliation line");
assert.ok(html.includes("Use Vanguard&#x27;s value") || html.includes("Use Vanguard's value"), "use the provider value control");
assert.ok(html.includes("Edit anchor"), "Edit anchor link");
assert.ok(html.includes("Entered by you."), "labelled user-entered");
assert.ok(html.includes("Simple gain, not a time-weighted return."), "method label kept");
for (const l of ["Capital at risk.", "Past performance is not a guide to future returns.", "Prices are end of day and may be delayed."]) assert.ok(html.includes(l), `risk line: ${l}`);
assert.ok(!html.includes("Anchor from your provider to see lifetime growth"), "no entry prompt once anchored");

// Hidden balances mask every figure.
const masked = renderToStaticMarkup(h(PortfolioGrowthCard, { title: "Value", growth: withAnchor, range: "all", status: "ready", hidden: true, onAnchor: noop }));
assert.ok(!masked.includes("20,342.64") && !masked.includes("1,370.95") && !masked.includes("18,971.69"), "figures mask with hide balances");

// Override active reads as a display override for that date only.
const ov = { ...withAnchor, lifetime: { ...life, reconciliation: { ...life.reconciliation, override: true } } };
const ovHtml = renderToStaticMarkup(h(PortfolioGrowthCard, { title: "Value", growth: ov, range: "all", status: "ready", onAnchor: noop, onOverride: noop }));
assert.ok(ovHtml.includes("for 15 Oct only") && ovHtml.includes("Show Sorted&#x27;s figure"), "override is for that date only and reversible");

// Detail: every holding with units and price, secondary sections.
const detail = renderToStaticMarkup(h(PortfolioGrowthDetail, { title: "Value", growth: withAnchor, range: "all", bare: true, onAnchor: noop, onOverride: noop }));
for (const n of ["FTSE Global All Cap", "S&amp;P 500 UCITS ETF", "Cash"]) assert.ok(detail.includes(n), `holding listed: ${n}`);
assert.ok(detail.includes("43 units") && detail.includes("No price yet"), "units, and No price yet for an unpriced holding");
assert.ok(detail.includes("Statement periods") && detail.includes("+£464.81") && detail.includes("Fees"), "statement-period growth with fees as a line");
assert.ok(detail.includes("Purchases") && detail.includes("+£12.86"), "per-purchase gain");
assert.ok(detail.includes("Paid in at anchor") && detail.includes("£18,971.69"), "how paid in is built up");
assert.ok(detail.indexOf("Growth since you started") < detail.indexOf("Statement periods"), "lifetime leads, periods are secondary");

// Pure helpers.
assert.equal(parseMoneyInput("£20,313.61"), 20313.61);
assert.equal(parseMoneyInput("−1,341.92"), -1341.92);
assert.equal(parseMoneyInput("abc"), null);
assert.equal(parsePercentInput("14.61%"), 14.61);
assert.equal(parsePercentInput(""), null);
assert.equal(fromProvider("Vanguard"), "from Vanguard");
assert.equal(fromProvider(null), "from your provider");
assert.equal(reconciliationText({ ours: 1, provider_value: 2, date: "2026-10-15" }, "Vanguard", true), "Sorted shows £••••, Vanguard showed £•••• on 15 Oct, likely price timing.");

// Source pins.
const accounts = read("../app/components/AccountsPage.tsx");
assert.ok(accounts.includes("paid in") && accounts.includes("since ${stmtDate} statement"), "the header line says paid in since the statement");
assert.ok(!/\$\{sign\}£\$\{hideNetWorth \? "••••" : absVal\} since/.test(accounts), "the header line never states a bare signed figure as growth");
const sheet = read("../components/portfolio-growth/AnchorSheet.tsx");
assert.ok(sheet.includes("SheetFrame") && sheet.includes("Anchor from your provider"), "the anchor sheet is a SheetFrame");
assert.ok(sheet.includes("min-h-[44px]") && !sheet.includes("min-h-[40px]"), "44px targets");
assert.ok(sheet.includes("Personal rate of return") && sheet.includes("Total paid in") && sheet.includes("Clear anchor"), "fields and clear");
assert.ok(read("../lib/api.ts").includes("/anchor/override"), "override endpoint");

for (const f of ["../lib/investmentGrowth.ts", "../components/portfolio-growth/AnchorSheet.tsx", "../components/portfolio-growth/LifetimeBlock.tsx", "../components/portfolio-growth/SecondaryGrowth.tsx", "../components/PortfolioGrowthCard.tsx", "../components/PortfolioGrowthDetail.tsx", "../components/portfolio-growth/HoldingRows.tsx"]) {
  const src = read(f);
  assert.ok(!src.includes("—"), `no em dash in ${f}`);
  assert.ok(!/[A-Za-z]!["'\s<]/.test(src.replace(/!==|!=|!\w|!\(/g, "")), `no exclamation in ${f}`);
}
console.log("g278-anchor: ok");
