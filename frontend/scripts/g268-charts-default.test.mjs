// G268 (Kevin 2026-10-14): Spend's "Your charts". A user with no saved chart
// preferences sees Category breakdown first with the other charts below it
// (still visible, nothing pinned to Home); saved preferences are untouched;
// the donut shows at most six segments plus Other; and every chart reads the
// server's one definition of spending, so the donut, the daily bars, the
// period comparison and the size bands add up to Out.
// Run: npm run -s check:g268-charts-default
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  DEFAULT_SPEND_WIDGETS, MAX_DONUT_SEGMENTS, donutSlices, resolveSpendWidgets,
  spendAmountOf, spendPayments, spendTotal,
} from "../lib/spendCharts.ts";

const valid = (id) => ["category_pie", "daily_bars", "period_compare", "size_distribution", "transport_modes", "pace_curve", "debt_burndown"].includes(id);

// 1. G398 default: Category breakdown only; every other chart is added from the picker.
const fresh = resolveSpendWidgets(null, valid);
assert.deepEqual(fresh, ["category_pie"], "a user with nothing saved starts with the donut alone");
assert.deepEqual(DEFAULT_SPEND_WIDGETS, ["category_pie"]);
assert.deepEqual(resolveSpendWidgets(undefined, valid), fresh);
assert.deepEqual(fresh, DEFAULT_SPEND_WIDGETS);
fresh.push("x");
assert.equal(DEFAULT_SPEND_WIDGETS.includes("x"), false, "the default is returned as a copy");

// 2. Saved preferences are kept exactly: order, omissions, and an emptied list.
assert.deepEqual(resolveSpendWidgets(["period_compare", "category_pie"], valid), ["period_compare", "category_pie"]);
assert.deepEqual(resolveSpendWidgets(["pace_curve"], valid), ["pace_curve"]);
assert.deepEqual(resolveSpendWidgets([], valid), [], "an emptied collection stays empty");
assert.deepEqual(resolveSpendWidgets(["period_compare", "nope"], valid), ["period_compare"], "unknown ids are dropped, nothing else changes");

// 2b. Existing users who saved the old four-chart default keep it exactly.
const oldDefault = ["category_pie", "daily_bars", "pace_curve", "period_compare"];
assert.deepEqual(resolveSpendWidgets(oldDefault, valid), oldDefault, "a saved list is never reset to the new default");

// 2c. Every chart stays available from the picker.
const trendsSrc = readFileSync(new URL("../components/SpendTrends.tsx", import.meta.url), "utf8");
assert.match(trendsSrc, /const available = ALL_WIDGETS\.filter\(w => !widgets\.includes\(w\)\)/, "the picker lists every chart not already shown");
for (const title of ["Category breakdown", "Daily spend", "Spending pace", "Period comparison", "Card balance ahead", "Transaction sizes"]) {
  assert.ok(trendsSrc.includes(`title: "${title}"`), `${title} stays in the picker`);
}
const pageSrc = readFileSync(new URL("../app/components/SpendPage.tsx", import.meta.url), "utf8");
assert.match(pageSrc, /Add more charts/, "helper copy says more charts can be added");
assert.doesNotMatch(pageSrc, /Choose what appears here/);

// 3. Nothing is pinned to Home by default in the chart code.
const trends = readFileSync(new URL("../components/SpendTrends.tsx", import.meta.url), "utf8");
assert.match(trends, /props\.preview\?\.pinnedWidget \?\? null/, "the local pin starts empty");
assert.doesNotMatch(trends, /spendDebits/, "the old per-chart debit filter is gone");

// 4. Other grouping: at most six segments plus one Other, totals preserved.
const t = (category, amount, extra = {}) => ({ category, amount, transaction_type: "debit", spend_amount: amount, ...extra });
const many = [
  t("A", 100), t("B", 90), t("C", 80), t("D", 70), t("E", 60), t("F", 50),
  t("G", 40), t("H", 30), t("I", 20), t("J", 10),
];
const slices = donutSlices(many);
assert.equal(MAX_DONUT_SEGMENTS, 6);
assert.equal(slices.length, 7, "six named segments plus Other");
assert.deepEqual(slices.slice(0, 6).map(s => s.name), ["A", "B", "C", "D", "E", "F"]);
assert.equal(slices[6].name, "Other");
assert.equal(slices[6].value, 100, "G to J fold into Other");
assert.equal(slices.reduce((s, x) => s + x.value, 0), 550, "grouping never changes the total");
assert.equal(donutSlices(many.slice(0, 4)).length, 4, "a short list is not grouped");
const withOther = donutSlices([...many, t("Other", 25)]);
assert.equal(withOther.filter(s => s.name === "Other").length, 1, "a real Other category merges into the one Other");
assert.equal(withOther.at(-1).value, 125);

// 5. One definition: the charts read spend_amount, so movements, own-account
// moves and foreign rows contribute nothing and refunds net off.
const period = [
  t("Shopping", 100),
  t("Shopping", 40, { transaction_type: "credit", spend_amount: -40 }),
  t("Business", 15000, { spend_amount: 0 }),   // own-account move: server says 0
  t("Business", 500),
  t("Savings", 200, { spend_amount: 0 }),
  t("Investment", 400, { spend_amount: 0 }),
  t("Other", 25),
];
assert.equal(spendTotal(period), 585);
assert.equal(donutSlices(period).reduce((s, x) => s + x.value, 0), 585, "donut total is Out");
assert.equal(spendPayments(period).length, 3, "size bands count payments only");
assert.equal(spendAmountOf(period[2]), 0);
// The two charts that sum rows (period comparison, daily bars) agree with the donut.
const periodCompareThis = spendTotal(period);
assert.equal(periodCompareThis, donutSlices(period).reduce((s, x) => s + x.value, 0));
// An older payload with no spend_amount falls back to the previous rule.
assert.equal(spendAmountOf({ category: "Transfer", amount: 5, transaction_type: "debit" }), 0);
assert.equal(spendAmountOf({ category: "Shopping", amount: 5, transaction_type: "debit" }), 5);

// 6. Spend's jump-strip chip is the period's total Out.
const page = readFileSync(new URL("../app/components/SpendPage.tsx", import.meta.url), "utf8");
assert.match(page, /label: "Spending",\s*\/\/[\s\S]*?wholeMoney\(verdict\.pills\.spent\)/, "the chip shows total Out");

console.log("g268-charts-default: ok");
