// G277: growth shows at once from cost versus value. Pins: no two-point gate in
// the section, the card renders with a single chart point and a quiet chart
// line, the per-holding row reads "Cost not known" with no gain, partial
// coverage wording, and the three risk lines verbatim. G278: the big figure is
// labelled Value, the card shows whenever the account has a value, and a
// partial cost never draws a whole-account Paid in / Growth pair.
//
// Run: npm run -s check:g277-growth-at-once

import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import PortfolioGrowthCard from "../components/PortfolioGrowthCard.tsx";
import HoldingRows from "../components/portfolio-growth/HoldingRows.tsx";
import { hasKnownCost } from "../lib/investmentGrowth.ts";

const h = React.createElement;
const read = (rel) => readFileSync(new URL(rel, import.meta.url), "utf8");

const section = read("../components/InvestmentGrowthSection.tsx");
assert.ok(!/points\.length\s*>=\s*2/.test(section), "no two-point gate in the section");
assert.ok(!section.includes("Growth appears after a day or two of prices"), "old waiting copy is gone");
assert.ok(!section.includes("hasKnownCost"), "G278: the card shows whenever there is a value, so an anchor can be set with no known cost");

const growth = {
  account_id: "a1", currency: "GBP", range: "all", method: "simple", method_label: "Simple gain, not a time-weighted return",
  statement_date: null, points: [{ date: "2026-10-15", value: 5000, paid_in: 4908.98 }], since: "2026-10-13", as_of: "2026-10-15",
  value: 5000, paid_in: 4908.98, growth_abs: 91.02, growth_pct: 1.85, holdings_with_cost: 2, holdings_total: 2,
  cost_coverage: null, holdings: [],
};
const partial = { ...growth, holdings_with_cost: 1, cost_coverage: "over 1 of 2 holdings" };
assert.equal(hasKnownCost(growth), true);
assert.equal(hasKnownCost({ ...growth, growth_abs: null, paid_in: null }), false);

const html = renderToStaticMarkup(h(PortfolioGrowthCard, { title: "Value", growth, range: "all", status: "ready" }));
assert.ok(html.includes("£5,000.00") && html.includes("+£91.02"), "headline and gain render with one point");
assert.ok(html.includes("Chart fills in as daily prices arrive."), "quiet chart line until two points");
assert.ok(html.includes("Simple gain, not a time-weighted return."), "method label");
assert.ok(!html.includes("over 1 of 2 holdings"), "complete coverage says nothing about coverage");
const partialHtml = renderToStaticMarkup(h(PortfolioGrowthCard, { title: "Value", growth: partial, range: "all", status: "ready" }));
assert.ok(partialHtml.includes("Cost is known for 1 of 2 holdings"), "partial coverage is stated");
assert.ok(!partialHtml.includes("+£91.02") && !partialHtml.includes("Paid in"), "a partial cost draws no whole-account Paid in / Growth pair");
for (const l of ["Capital at risk.", "Past performance is not a guide to future returns.", "Prices are end of day and may be delayed."]) {
  assert.ok(html.includes(l), `risk line: ${l}`);
}

const rows = renderToStaticMarkup(h(HoldingRows, { holdings: [
  { id: "h1", name: "Fund A", isin: null, type: "Fund", units: 10, price: 120, value: 1200, statement_value: 1000, cost: null, cost_source: null, gain_abs: null, gain_pct: null, change_abs: null, change_pct: null, price_date: null },
  { id: "h2", name: "Fund B", isin: null, type: "Fund", units: null, price: null, value: 1000, statement_value: 900, cost: 900, cost_source: "statement", gain_abs: 100, gain_pct: 11.11, change_abs: null, change_pct: null, price_date: null },
] }));
assert.ok(rows.includes("Cost not known"), "unknown cost row");
assert.ok(rows.includes("+£100.00") && rows.includes("+11.11%"), "known cost row shows gain and percent");
assert.equal((rows.match(/Cost not known/g) || []).length, 1, "only the unknown holding says so");

for (const f of ["../lib/investmentGrowth.ts", "../components/InvestmentGrowthSection.tsx", "../components/portfolio-growth/HoldingRows.tsx"]) {
  const src = read(f);
  assert.ok(!src.includes("—") && !/[A-Za-z]!["'\s<]/.test(src.replace(/!==|!=|!\w|!\(/g, "")), `no em dash or exclamation in ${f}`);
}
console.log("g277-growth-at-once: ok");
