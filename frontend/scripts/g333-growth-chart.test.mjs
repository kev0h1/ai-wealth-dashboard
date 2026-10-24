// G333: the growth chart never draws money paid in as growth. Pins: x is
// proportional to the date, the value line breaks at a gap, the paid-in line is
// a step line, a contribution reads as paid in or taken out, and the chart
// renders markers without any red.
//
// Run: npm run -s check:g333-growth-chart

import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import GrowthChart from "../components/portfolio-growth/GrowthChart.tsx";
import {
  chartGeometry, contributionText, formatPriceDay, linePath, showsPaidLine, stepPath, valueSegments,
} from "../lib/investmentGrowth.ts";

const h = React.createElement;
const pts = [
  { date: "2026-09-04", value: 14835.65, paid_in: 14835.65, contribution: 0, gap_before: false },
  { date: "2026-10-14", value: 14900, paid_in: 14835.65, contribution: 0, gap_before: true },
  { date: "2026-10-15", value: 20300, paid_in: 20144.63, contribution: 5308.98, gap_before: false },
  { date: "2026-10-16", value: 20310, paid_in: 20144.63, contribution: 0, gap_before: false },
  { date: "2026-10-24", value: 20335.3, paid_in: 20144.63, contribution: 0, gap_before: true },
];

// x follows the date, not the index.
const geo = chartGeometry(pts, 320, 120, true);
const span = 50; // 4 Sep to 24 Oct
assert.equal(geo.xs[0], 0);
assert.equal(geo.xs[4], 320);
assert.ok(Math.abs(geo.xs[1] - (40 / span) * 320) < 1e-9, "14 Oct sits at 40 of 50 days");
assert.ok(geo.xs[2] - geo.xs[1] < 7 && geo.xs[1] > 250, "a sparse series is not evenly spread");
assert.deepEqual(chartGeometry([pts[0]], 320, 120, true).xs, [160], "one point sits mid-chart");

// The value line breaks where gap_before is set.
assert.deepEqual(valueSegments(pts), [[0], [1, 2, 3], [4]]);
assert.deepEqual(valueSegments([]), []);
assert.deepEqual(valueSegments(pts.map((p) => ({ ...p, gap_before: false }))), [[0, 1, 2, 3, 4]]);

// The paid-in line is a step: horizontal, then vertical.
assert.equal(stepPath([0, 10, 20], [50, 50, 30]), "M0.0 50.0 H10.0 V50.0 H20.0 V30.0");
assert.equal(stepPath([5], [7]), "M5.0 7.0");
assert.equal(linePath([0, 10], [1, 2]), "M0.0 1.0 L10.0 2.0");

// Contribution copy keeps the currency minus and says what happened.
assert.equal(contributionText(4908.98), " · +£4,908.98 paid in");
assert.equal(contributionText(-250), " · −£250.00 taken out");
assert.equal(contributionText(0), "");
assert.equal(contributionText(undefined), "");
assert.equal(contributionText(4908.98, true), " · £•••• paid in", "hidden balances mask the figure");

assert.equal(showsPaidLine(pts), true);
assert.equal(showsPaidLine([{ ...pts[0], paid_in: null }]), false);

assert.equal(formatPriceDay("2026-10-16", "2026-10-15"), "15 to 16 Oct");
assert.equal(formatPriceDay("2026-10-16", "2026-10-16"), "16 Oct");
assert.equal(formatPriceDay("2026-10-02", "2026-09-30"), "30 Sep to 2 Oct");
assert.equal(formatPriceDay(null), null);

// Rendered chart: a broken line, a lone dot, a step path, one marker, no red.
const html = renderToStaticMarkup(h(GrowthChart, { points: pts, summary: "Value £20,335.30." }));
assert.ok(html.includes(" H") && html.includes(" V"), "the paid-in line is a step path");
assert.equal((html.match(/<circle/g) || []).length, 3, "two lone dots plus one contribution marker");
assert.ok(!/red|rose/.test(html), "no red on the chart");
assert.ok(!html.includes("—") && !html.includes("!"), "copy rules");

console.log("g333-growth-chart: ok");
