import assert from "node:assert/strict";
import { register } from "node:module";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { compareShape, differenceLabel, guideFor, GUIDES, money, signedMoney } from "../lib/paySplitReference.ts";
import { SCENARIOS, scenarioFor } from "./fixtures/g279-pay-split.ts";
import { fixture as comparisonFixture } from "./fixtures/g342-pay-split.ts";
import { restoredFixture } from "./fixtures/g343-restored-pay-split.ts";

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
    } else if (reference.ranges) {
      assert.equal(result.netDifference, null, "independent ranges have no summed gap");
      for (const row of result.rows) {
        assert.equal(row.guide, null);
        assert.equal(row.guideShare, null);
        assert.ok(row.guideMin <= row.guideMax);
        assert.equal(row.position, row.actual < row.guideMin ? "below" : row.actual > row.guideMax ? "above" : "within");
      }
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
assert.equal(differenceLabel(moved), `${money(moved.delta)} more than this reference`);

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
assert.match(defaultHtml, /50\/30\/20/);
assert.match(defaultHtml, /50\/30\/20 example/);
assert.doesNotMatch(defaultHtml, /60\/20\/20/, "the default display must not silently use the alternative reference");
assert.match(defaultHtml, /Your amounts and the example/);
assert.match(defaultHtml, /Paired actual and reference bars/);
assert.match(defaultHtml, /\+£414/);
assert.match(defaultHtml, /−£5.80/);
assert.match(defaultHtml, /\+£98.80/);
assert.match(draw({ reference: "conscious" }), /Example ranges/);
assert.doesNotMatch(draw({ reference: "first" }), /Paired actual and reference bars|more than this reference/);
assert.doesNotMatch(draw({ hideValues: true }), /£414|£2,836|£98.80/, "hidden comparison cannot disclose money in text or attributes");
assert.match(draw({ hideValues: true }), /amounts are hidden/);
assert.doesNotMatch(draw({ shape: scenarioFor("thin").shape }), /£0/);
assert.match(draw({ shape: scenarioFor("thin").shape }), /No comparison yet/);
assert.match(draw({view:"card"}), /See full breakdown/);
assert.doesNotMatch(draw({view:"card"}), /Paired actual and reference bars/);
const card = renderToStaticMarkup(createElement(Card, { shape, hideValues: false, onOpen: () => {}, reference: "50-30-20" }));
assert.equal((card.match(/aria-label="Reference comparison"/g) ?? []).length, 1, "Spend renders the actual approved comparison once");
let selected;
const hero = renderToStaticMarkup(createElement(Hero, { shape, renderComparison: entry => { selected = entry; return createElement(Comparison, { shape: entry, reference: "50-30-20", hideValues: false }); } }));
assert.equal(selected.take_home, shape.take_home);
assert.deepEqual(selected.jobs, shape.jobs, "instrument and comparison get the same entry, not a later effect");
assert.match(hero, /Your amounts and the example/);
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
assert.match(draw({ shape: big }), /£4,140,000/);
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
console.log("PASS G279: exact income-based reference math, neutral movement, no invented principle benchmark, restored G343 compact/paired production renders, explicit default/alternative ratios, privacy and thin states.");

// G341: inclusive ranges, exact endpoint differences, no invented midpoint or risk.
const ranges=guideFor('conscious');
for(const [actual,position,delta] of [[4999.99,'below',-.01],[5000,'within',0],[6000,'within',0],[6000.01,'above',.01],[6124.69,'above',124.69]]){
 const jobs=[{id:'fixed',amount:actual},{id:'moved',amount:1500},{id:'free',amount:2500}];
 const candidate={...shape,take_home:10000,jobs,total_out:actual+4000};
 const result=compareShape(candidate,ranges),fixed=result.rows[0];
 assert.deepEqual([fixed.guideMin,fixed.guideMax,fixed.guide, fixed.position,fixed.delta],[5000,6000,null,position,delta]);
 assert.equal(result.netDifference,null,'independent ranges do not form a net allocation');
 if(delta===124.69)assert.equal(differenceLabel(fixed),'£124.69 more than the top of the range');
 if(delta===0)assert.equal(differenceLabel(fixed),'Within the range');
}
{
 const html=draw({reference:'conscious'});
 assert.match(html,/Guide 50 to 60%/);assert.match(html,/Guide 10 to 20%/);assert.match(html,/Guide 20 to 35%/);
 assert.doesNotMatch(html,/No budget or target is set/);
 assert.doesNotMatch(html,/60\/20\/20|Paired actual and reference bars|How the differences add up|class="warning"/);
 assert.doesNotMatch(draw({reference:'conscious',hideValues:true}),/£\d/);
}
assert.doesNotMatch(defaultHtml,/class="warning"/,'an income-reference difference is not financial risk');
console.log('G341: generic range reference, inclusive endpoints, neutral copy and privacy passed');

const liveCopyFiles=['../components/PaySplitComparison.tsx','../lib/paySplitReference.ts','../app/spend/shape/ReferenceShapesRow.tsx','../../backend/app/services/penny_pay_split.py','../../backend/app/content/money_basics.py','../../backend/app/services/penny_tools.py'];
for(const file of liveCopyFiles){
 const source=readFileSync(new URL(file,import.meta.url),'utf8').replaceAll('"conscious-spending-plan"','"legacy-topic"');
 assert.doesNotMatch(source,/conscious[\s-]+spending|\bramit\b|\bsethi\b|iwillteachyoutoberich|guilt[\s-]+free/i,`${file}: retired reference must not reappear in live copy`);
}

// G343 restoration: the screenshot layout, current exact arithmetic and privacy.
const exact = comparisonFixture('kevin');
const compact = draw({shape:exact,view:'card'});
for (const amount of ["+£409.09", "−£26.93", "+£124.69"]) {
 assert.equal(compact.split(amount).length - 1, 1, amount + ' appears once, without repeating it in the caption');
}
assert.match(compact,/Income for this pay period: .*£4,843.68/);
assert.match(compact,/above 50% example/);assert.match(compact,/below 20% example/);
assert.doesNotMatch(compact,/class="track"|class="marker"|Paired actual|Your income share/);
assert.equal((compact.match(/>How this comparison works</g)??[]).length,1);
assert.match(compact,/href="\/spend\/shape"/);
const restored=restoredFixture('historic');
const screenshotComparison=compareShape(restored,guide);
assert.deepEqual(screenshotComparison.rows.map(row=>[row.actual,row.guide,row.delta]),[[152.65,230.51,-77.86],[.05,92.2,-92.15],[303,138.31,164.69]]);
for(const view of ['card','detail']){
 const html=draw({shape:restored,view});
 for(const amount of ['−£77.86','−£92.15','+£164.69'])assert.equal(html.split(amount).length-1,1);
 assert.match(html,/£461.02/);
 assert.match(html,/Explore your pay/);
 assert.doesNotMatch(html,/class="warning"|consumerfinance|cfpb/i);
}
const detail=draw({shape:restored});
assert.match(detail,/Paired actual and reference bars/);
assert.match(detail,/Your amount/);assert.match(detail,/50% example/);assert.match(detail,/20% example/);assert.match(detail,/30% example/);assert.match(detail,/Difference/);assert.match(detail,/£0.05/);
assert.equal((detail.match(/class="barGroup"/g)??[]).length,2);
assert.match(detail,/width:33\.111/,'actual bar uses exact money on the shared pound scale');
const rangeHtml=draw({shape:exact,reference:'conscious'});
assert.doesNotMatch(rangeHtml,/Paired actual|60\/20\/20|How the differences add up/);
assert.match(rangeHtml,/Guide 50 to 60%/);
assert.match(rangeHtml,/Within range/);
assert.doesNotMatch(draw({shape:exact,reference:'first'}),/Paired actual|class="amounts"|above guide|below guide/);
assert.match(draw({shape:exact,average:true}),/Average income per pay period/);
for(const reference of GUIDES.map(g=>g.id))for(const view of ['card','detail'])for(const props of [{hideValues:true},{reference:undefined,hideValues:false},{shape:scenarioFor('thin').shape}]){
 const html=draw({reference,view,...props});
 assert.doesNotMatch(html,/£\d|class="stackedBar"|class="amounts"|class="compactRows"/,'hidden, unready and unavailable states disclose no numbers or chart geometry');
}
console.log('G343 restored layout: screenshot figures, compact unique deltas, paired pound-scale bars, exact detail rows, ranges/principle, scope and privacy passed');

// G345: alternative compact references must show the data, not zero range
// differences or an empty principle card. The point reference keeps its deltas.
for (const reference of ['conscious', 'first']) {
 const html = draw({shape:exact, reference, view:'card'});
 assert.match(html, /Your amounts this period/);
 for (const amount of ['£2,830.93', '£941.81', '£1,577.79']) {
  assert.equal(html.split(amount).length - 1, 1, `${reference}: actual ${amount} is visible once`);
 }
 assert.equal((html.match(/aria-label="View (?:Fixed|Moved|Free) breakdown"/g) ?? []).length, 3);
 assert.doesNotMatch(html, />£0</, `${reference}: zero difference must not replace actual amounts`);
 if (reference === 'conscious') assert.equal((html.match(/within \d+ to \d+% range/g) ?? []).length, 3);
 else assert.doesNotMatch(html, /Within range|above guide|below guide|Matches guide/);
 assert.match(draw({shape:exact, reference, view:'card', average:true}), /Your average amounts/);
 const zero = structuredClone(exact);
 zero.jobs.forEach(job => { job.amount = 0; job.drivers = []; });
 zero.total_out = zero.beyond = zero.overspent = 0;
 const zeroHtml = draw({shape:zero, reference, view:'card'});
 assert.equal((zeroHtml.match(/>£0</g) ?? []).length, 3, 'genuine zero amounts remain visible');
}
const outsideCompact = draw({shape:comparisonFixture('outside'), reference:'conscious', view:'card'});
assert.match(outsideCompact, /above 50 to 60% range/);
assert.match(outsideCompact, /below 10 to 20% range/);
assert.doesNotMatch(outsideCompact, /above guide|below guide/);
console.log('G345: alternative compact references show real group amounts, true zero and range positions without inventing a principle benchmark');

// G344 A: range rows lead with actuals, hiding the pound ledger until requested.
assert.match(rangeHtml, /class="rangeRows"/);
assert.doesNotMatch(rangeHtml, /class="amounts"|Difference<|>£0</);
for (const amount of ['£2,830.93','£941.81','£1,577.79']) assert.ok(rangeHtml.includes(amount));
assert.match(draw({shape:comparisonFixture('outside'),reference:'conscious'}), /above range/);
assert.match(draw({shape:comparisonFixture('outside'),reference:'conscious'}), /below range/);

// G346 A: explanation belongs beside actuals; a savings habit is never inferred.
const savings = draw({shape:exact,reference:'first',view:'card'});
assert.match(savings,/Saving before spending means putting money aside when you get paid/);
assert.match(savings,/cannot tell whether savings were set aside first/);
assert.match(savings,/What do these groups mean/);
assert.doesNotMatch(savings,/No budget or target is set|Approximate mapping|over\/under markers|A principle, not a percentage/);
assert.match(draw({shape:exact,reference:'50-30-20',view:'card'}),/Difference from the example/);
assert.match(draw({shape:exact,reference:'conscious',view:'card'}),/within 50 to 60% range/);
