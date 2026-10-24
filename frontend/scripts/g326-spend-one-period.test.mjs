// G326: the Spend page reads ONE period definition (the verdict's `period`).
// Synthetic data only, same fixtures style as g293-spend-spacing.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { SpendPeriodBar } from "../components/SpendHeader.tsx";
import SpendPaceHero from "../components/SpendPaceHero.tsx";
import { spacingFixture } from "./fixtures/g293-spend-spacing.ts";
import {
  hasServerIncome, incomeRowsTotal, payArrivedText, periodDayCaption,
  periodLabelFromVerdict, serverIncomeTransactions,
} from "../lib/spendPeriod.ts";

const noop = () => {};
const base = spacingFixture("current"); // 25 Sep to 29 Oct, a 35-day period

function withPeriod(rows, extra = {}) {
  const income = Math.round(rows.reduce((s, r) => s + r.amount, 0) * 100) / 100;
  return {
    ...base,
    pills: { ...base.pills, income, net: Math.round((income - base.pills.spent) * 100) / 100 },
    period: {
      ...base.period, start: "2026-10-01", end: "2026-10-31", days_elapsed: 23, days_left: 8,
      length_days: 31, day_number: 24, payday: "2026-11-01", label: "1 Oct to 31 Oct", income_rows: rows, ...extra,
    },
  };
}
const early = { id: "p1", date: "2026-09-30", amount: 444.7, description: "Example employer pay", merchant_name: "Example employer", category: "Income", account_id: "a1", attributed_early: true };
const onTime = { id: "p2", date: "2026-10-03", amount: 100, description: "Example refund pay", merchant_name: "", category: "Income", account_id: "a1", attributed_early: false };

function render(verdict, clientLabel = "1 Oct → 31 Oct") {
  const incomeTxns = hasServerIncome(verdict) ? serverIncomeTransactions(verdict) : [];
  const bar = renderToStaticMarkup(h(SpendPeriodBar, {
    verdict, periodLabel: periodLabelFromVerdict(verdict, clientLabel), isCurrentPeriod: true, canGoPrev: true,
    incomeTxns, onTransactionClick: noop, onPrev: noop, onNext: noop, onOpenSettings: noop, onOpenRules: noop,
    recentPeriods: [], onSelectOffset: noop, onOutTap: noop, onMovedTap: noop,
  }));
  const hero = renderToStaticMarkup(h(SpendPaceHero, { verdict, incomeTxns, onTransactionClick: noop, onOutTap: noop, onMovedTap: noop }));
  return { bar, hero, incomeTxns };
}

// 1. The label and "Day N of M" come from the same object: a 31-day label never sits beside a 35-day count.
{
  const v = withPeriod([early]);
  const { bar, hero } = render(v, "25 Sep → 29 Oct (a different client guess)");
  assert.match(bar, /1 Oct to 31 Oct/);
  assert.doesNotMatch(bar, /client guess/, "server label wins over the client's own label");
  assert.match(bar, /Day 24 of 31/);
  assert.match(hero, /Day 24 of 31/);
  assert.equal(periodDayCaption(v), "Day 24 of 31");
  assert.doesNotMatch(bar + hero, /of 35/);
}

// 2. In equals the income list total, and the list is non-empty whenever In > 0.
for (const rows of [[early], [early, onTime], [onTime]]) {
  const v = withPeriod(rows);
  const { hero, incomeTxns } = render(v);
  assert.ok(v.pills.income > 0);
  assert.ok(incomeTxns.length > 0, "list is never empty while In is non-zero");
  assert.equal(Math.round(incomeTxns.reduce((s, t) => s + t.amount, 0) * 100), Math.round(v.pills.income * 100));
  assert.equal(incomeRowsTotal(v), v.pills.income);
  assert.doesNotMatch(hero, /No income payments to show/);
  for (const r of rows) assert.ok(hero.includes(r.description) || hero.includes(r.merchant_name || r.description), `row ${r.id} rendered`);
}

// 3. "Pay arrived" carries the real date and makes early attribution plain.
assert.equal(payArrivedText(withPeriod([early]), "1 Oct"), "Pay arrived 30 Sep, counted for this period");
assert.equal(payArrivedText(withPeriod([onTime]), "1 Oct"), "Pay arrived · 3 Oct");
assert.equal(payArrivedText(withPeriod([]), "1 Oct"), "Pay arrived · 1 Oct", "no server rows falls back to the caller's date");

// 4. A verdict cached before the new fields shipped still renders from the legacy fields.
{
  const legacy = { ...base, period: { start: "2026-09-25", end: "2026-10-29", days_elapsed: 24, days_left: 11, offset: 0, closed: false } };
  assert.equal(periodDayCaption(legacy), "Day 24 of 35");
  assert.equal(hasServerIncome(legacy), false);
  assert.equal(periodLabelFromVerdict(legacy, "fallback label"), "fallback label");
}

// 5. Source wiring: SpendPage reads the server period for label, income list, bounds and Pay arrived.
{
  const page = readFileSync(new URL("../app/components/SpendPage.tsx", import.meta.url), "utf8");
  assert.match(page, /periodLabelFromVerdict\(verdict/);
  assert.match(page, /hasServerIncome\(verdict\)\s*\?\s*serverIncomeTransactions\(verdict\)/);
  assert.match(page, /payArrivedText\(verdict/);
  assert.match(page, /const periodStart = useMemo\(\s*\(\) => \(serverPeriod \? new Date\(dateToUTCDay\(serverPeriod\.start\)\)/);
  assert.doesNotMatch(page, /Pay arrived · \{periodStart/, "the timeline node no longer prints the period start as the pay date");
  assert.match(page, /const isCurrentPeriod = periodOffset === 0/);
}
console.log("g326 spend one-period checks passed");
