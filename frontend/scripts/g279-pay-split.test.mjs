import assert from "node:assert/strict";
import { register } from "node:module";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { compareShape, differenceLabel, guideFor, GUIDES, money, signedMoney } from "../lib/paySplitReference.ts";
import { SCENARIOS, scenarioFor } from "./fixtures/g279-pay-split.ts";

const guide = guideFor("50-30-20");
for (const fixture of SCENARIOS.filter(item => item.id !== "thin")) {
  for (const reference of GUIDES) {
    const result = compareShape(fixture.shape, reference);
    assert.equal(result.available, true);
    assert.equal(result.totalOut, fixture.shape.total_out);
    assert.equal(result.beyond, fixture.shape.beyond);
    for (const row of result.rows) {
      assert.ok(Math.abs(fixture.drivers[row.id].reduce((sum, driver) => sum + driver.amount, 0) - row.actual) < .005, `${fixture.id}/${row.id} illustrative evidence reconciles`);
      assert.equal(row.aboveCost, row.id !== "moved" && row.delta !== null && row.delta > 0);
    }
    if (reference.shares) {
      assert.equal(Math.round(result.rows.reduce((sum, row) => sum + row.guide, 0) * 100), Math.round(result.income * 100));
      assert.equal(Math.round(result.rows.reduce((sum, row) => sum + row.delta, 0) * 100), Math.round(result.netDifference * 100), "all differences reconcile to outgoings minus income");
    } else {
      assert.equal(result.netDifference, null);
      assert.equal(result.largestOver, null);
      for (const row of result.rows) {
        assert.equal(row.guide, null);
        assert.equal(row.delta, null);
        assert.equal(differenceLabel(row), "No fixed percentage");
      }
    }
  }
}

const beyond = compareShape(scenarioFor("beyond").shape, guide);
assert.equal(beyond.income, 4844);
assert.equal(beyond.totalOut, 5351);
assert.equal(beyond.beyond, 507);
assert.equal(beyond.netDifference, 507);
assert.deepEqual(beyond.rows.map(row => [row.id, row.actual, row.guide, row.delta]), [
  ["fixed", 2836, 2422, 414], ["moved", 963, 968.8, -5.8], ["free", 1552, 1453.2, 98.8],
]);
assert.equal(beyond.largestOver.id, "fixed");
assert.equal(Math.round(scenarioFor("beyond").shape.jobs.find(job => job.id === "fixed").share), 53);
assert.equal(Math.round(beyond.rows[0].incomeShare), 59, "income comparison is recalculated from exact amounts, never the outgoings percentage");
const nonsenseShares = structuredClone(scenarioFor("beyond").shape);
nonsenseShares.jobs.forEach(job => { job.share = 7; });
assert.deepEqual(compareShape(nonsenseShares, guide), beyond, "reference arithmetic never reads rounded displayed shares");
assert.equal(compareShape(scenarioFor("under").shape, guide).largestOver, null);
assert.equal(compareShape(scenarioFor("fixed").shape, guide).largestOver.id, "fixed");
assert.equal(compareShape(scenarioFor("free").shape, guide).largestOver.id, "free");
const moved = compareShape(scenarioFor("under").shape, guide).rows.find(row => row.id === "moved");
assert.ok(moved.delta > 0);
assert.equal(moved.aboveCost, false, "movement above a reference is not a cost warning");
assert.equal(differenceLabel(moved), "More moved than this reference");

for (const income of [0, -1, NaN, Infinity]) assert.equal(compareShape({ ...scenarioFor("beyond").shape, take_home: income }, guide).available, false);
assert.equal(compareShape(scenarioFor("thin").shape, guide).available, false);
assert.equal(compareShape({ ...scenarioFor("under").shape, jobs: [] }, guide).available, false);
assert.equal(compareShape({ ...scenarioFor("under").shape, total_out: 1 }, guide).available, false, "inconsistent totals do not produce an authoritative comparison");
const invalid = structuredClone(scenarioFor("under").shape);
invalid.jobs[0].amount = NaN;
assert.equal(compareShape(invalid, guide).available, false);
for (const income of [.01, 1.01, 4844.01, 99999999.99]) {
  const result = compareShape({ ...scenarioFor("under").shape, take_home: income }, guide);
  assert.equal(Math.round(result.rows.reduce((sum, row) => sum + row.guide, 0) * 100), Math.round(income * 100), "reference rounding neither loses nor invents pennies");
}
assert.equal(guideFor("bad-value").id, "50-30-20");
assert.equal(guideFor(null).id, "50-30-20");
assert.equal(money(1453.2), "£1,453.20");
assert.equal(signedMoney(-5.8), "−£5.80");
assert.equal(signedMoney(414), "+£414");
assert.equal(signedMoney(0), "£0");
assert.equal(signedMoney(-.001), "£0", "no negative zero");
assert.equal(signedMoney(-.005), "−£0.01", "negative half-pennies keep their sign and magnitude");
register("data:text/javascript," + encodeURIComponent(`
  export async function load(url, c, next) {
    if (url.endsWith('/PaySplitComparison.module.css')) return {format:'module',source:'export default new Proxy({}, {get: (_, key) => key});',shortCircuit:true};
    return next(url,c);
  }
`));
const { default: Comparison } = await import("../components/PaySplitComparison.tsx");
const { default: Card } = await import("../components/SpendShapeCard.tsx");
const { default: Hero, currentEntry } = await import("../app/spend/shape/MoneyShapeHero.tsx");
const shape = scenarioFor("beyond").shape;
const draw = props => renderToStaticMarkup(createElement(Comparison, { shape, reference: "50-30-20", hideValues: false, ...props }));
const defaultHtml = draw({});
assert.match(defaultHtml, /50\/30\/20 · adapted/);
assert.doesNotMatch(defaultHtml, /60\/20\/20/, "the default display must not silently use the alternative reference");
assert.match(defaultHtml, /Paired actual and reference bars/);
assert.match(defaultHtml, /\+£414/);
assert.match(defaultHtml, /−£5.80/);
assert.match(defaultHtml, /\+£98.80/);
assert.match(draw({ reference: "conscious" }), /Conscious Spending Plan · 60\/20\/20 example/);
assert.doesNotMatch(draw({ reference: "first" }), /Paired actual and reference bars|Above this reference/);
assert.doesNotMatch(draw({ hideValues: true }), /£414|£2,836|£98.80/, "hidden comparison cannot disclose money in text or attributes");
assert.match(draw({ hideValues: true }), /amounts are hidden/);
assert.doesNotMatch(draw({ shape: scenarioFor("thin").shape }), /£0/);
assert.match(draw({ shape: scenarioFor("thin").shape }), /No comparison yet/);
assert.match(draw({ view: "card" }), /View the comparison and breakdown/);
assert.doesNotMatch(draw({ view: "card" }), /Paired actual and reference bars/);
const card = renderToStaticMarkup(createElement(Card, { shape, hideValues: false, onOpen: () => {}, reference: "50-30-20" }));
assert.equal((card.match(/aria-label="Reference comparison"/g) ?? []).length, 1, "Spend renders the actual approved comparison once");
let selected;
const hero = renderToStaticMarkup(createElement(Hero, { shape, renderComparison: entry => { selected = entry; return createElement(Comparison, { shape: entry, reference: "50-30-20", hideValues: false }); } }));
assert.equal(selected.take_home, shape.take_home);
assert.deepEqual(selected.jobs, shape.jobs, "instrument and comparison get the same entry, not a later effect");
assert.match(hero, /Your amounts beside the guide/);
const shapePageSource = readFileSync(new URL("../app/spend/shape/ShapePage.tsx", import.meta.url), "utf8");
assert.match(shapePageSource, /reference=\{isPreview \? previewReference : undefined\}/, "fixture ShapePage uses a local reference, never customer preferences");
assert.match(shapePageSource, /onReferenceChange=\{isPreview \? setPreviewReference : undefined\}/);
const maskedHero = renderToStaticMarkup(createElement(Hero, { shape, hideValues: true }));
assert.doesNotMatch(maskedHero, /£4,844|£2,836|£507|£963/, "the instrument obeys the same privacy choice as its comparison");
const big = structuredClone(shape);
big.take_home *= 10000;
big.total_out *= 10000;
big.overspent *= 10000;
big.beyond *= 10000;
big.jobs.forEach(job => job.amount *= 10000);
assert.match(draw({ shape: big }), /longAmounts/, "large financial figures use stacked working instead of clipping");
assert.match(draw({ shape: big, view: "card" }), /compactLong/);
const bigCard = renderToStaticMarkup(createElement(Card, { shape: big, hideValues: false, onOpen: () => {}, reference: "50-30-20" }));
assert.match(bigCard, /grid-cols-2/, "the compact instrument reflows long Beyond money instead of truncating it");
assert.match(bigCard, /£5,070,000/);
assert.doesNotMatch(bigCard, /class="[^"]*truncate[^"]*"[^>]*>£5,070,000/);
const bigHero = renderToStaticMarkup(createElement(Hero, { shape: big }));
assert.match(bigHero, /glass-hero min-w-0/, "instrument can shrink inside the detail grid");
assert.match(bigHero, /grid-cols-\[10px_minmax\(0,1fr\)_auto\]/, "large money reflows below its job label without clipping");
for (const [out, meanGap, legacyLeft, netLeft, netBeyond] of [[800, 50, 250, 200, 0], [1200, 400, 200, 0, 200]]) {
  const netJobs = shape.jobs.map(job => ({ ...job, amount: job.id === "fixed" ? out : job.id === "left" ? netLeft : 0, share: job.id === "fixed" ? out / Math.max(1000, out) * 100 : job.id === "left" ? netLeft / 1000 * 100 : 0 }));
  const legacyJobs = netJobs.map(job => job.id === "left" ? { ...job, amount: legacyLeft } : job);
  const average = { months: 3, period_count: 2, start: "2026-08-01", end: "2026-09-30", take_home: 1000, overspent: meanGap, total_out: out, beyond: netBeyond, jobs: legacyJobs, net_jobs: netJobs, verdict: "Legacy", net_verdict: "Net-flow reading" };
  const selectedAverage = currentEntry(shape, [], [average], { kind: "average", months: 3 }, true);
  assert.deepEqual(selectedAverage.jobs, netJobs);
  assert.equal(selectedAverage.verdict, "Net-flow reading");
  assert.equal(selectedAverage.overspent, meanGap, "legacy mean-gap metric stays unchanged");
  const selectedShape = { ...shape, ...selectedAverage, periods: undefined, averages: undefined };
  const rendered = renderToStaticMarkup(createElement(Hero, { shape: selectedShape }));
  if (netBeyond) {
    assert.match(rendered, /Beyond take-home/);
    assert.doesNotMatch(rendered, /£400/, "Beyond row uses the same net gap as bar and comparison");
  } else {
    assert.doesNotMatch(rendered, /Beyond take-home/);
    assert.match(rendered, /Left over/);
    assert.match(rendered, /£200/);
  }
}
console.log("PASS G279: exact income-based reference math, neutral movement, no invented principle benchmark, true approved-A production renders, explicit default/alternative ratios, privacy and thin states.");
