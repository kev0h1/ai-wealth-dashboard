// G252: Penny charts. Renders PennyChart from fixture specs for each type
// (bar, line, stacked bar, donut), checks the category palette mapping, the
// server-written summary above the chart, the accessible table fallback, no
// Penny gradient, dark mode support, and the wiring in PennyConversation.
// Run: npm run -s check:g252-penny-chart
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

const { default: PennyChart, PennyChartPlot } = await import("../components/PennyChart.tsx");
const lib = await import("../lib/pennyChart.ts");
const { CATEGORY_COLOURS } = await import("../lib/categories.ts");
const h = React.createElement;
const html = (el) => renderToStaticMarkup(el);
const m = (rows) => rows.map(([x, y]) => ({ x, y }));

const bar = {
  type: "bar", title: "Eating Out by month", x: { label: "Month", kind: "category" }, y: { label: "Spent", unit: "money", currency: "GBP" },
  series: [{ name: "Eating Out", points: m([["Jul 2026", { amount: 176, currency: "GBP" }], ["Aug 2026", { amount: 312, currency: "GBP" }], ["Sep 2026", { amount: 94.5, currency: "GBP" }]]) }],
  note: "Rolling window.", summary: "Eating Out by month: highest in Aug 2026 at £312, lowest in Sep 2026 at £94.50.",
};
const line = {
  type: "line", title: "Monzo over time", x: { label: "Day", kind: "date" }, y: { label: "Net", unit: "money", currency: "GBP" },
  series: [{ name: "Net", points: m([["2026-10-01", { amount: -10, currency: "GBP" }], ["2026-10-05", { amount: 30, currency: "GBP" }], ["2026-10-08", { amount: 5, currency: "GBP" }]]) }],
  note: "Net of money in and out, not a balance.", summary: "Monzo over time: Net was −£10 on 1 Oct and £5 on 8 Oct, highest £30 on 5 Oct.",
};
const stacked = {
  type: "stacked_bar", title: "Spending by month", x: { label: "Month", kind: "category" }, y: { label: "Spent", unit: "money", currency: "GBP" },
  series: [
    { name: "Bills", points: m([["Aug", { amount: 835, currency: "GBP" }], ["Sep", { amount: 812, currency: "GBP" }]]) },
    { name: "Groceries", points: m([["Aug", { amount: 288, currency: "GBP" }], ["Sep", { amount: 342, currency: "GBP" }]]) },
  ],
  summary: "Spending by month: Bills, Groceries across 2 periods, highest total in Sep at £1,154.",
};
const donut = {
  type: "donut", title: "Spending by category", x: { label: "Category", kind: "category" }, y: { label: "Spent", unit: "money", currency: "GBP" },
  series: [{ name: "Spent", points: m([["Bills", { amount: 840, currency: "GBP" }], ["Groceries", { amount: 342, currency: "GBP" }], ["Other", { amount: 60, currency: "GBP" }]]) }],
  note: "Smaller categories grouped as Other", summary: "Spending by category: Bills is the largest at £840, 68% of the £1,242 shown.",
};

// ---- 1. each type renders: summary, title, svg, no gradient ----------------
for (const [name, spec] of Object.entries({ bar, line, stacked, donut })) {
  const out = html(h(PennyChart, { chart: spec }));
  assert.ok(out.includes("data-penny-chart"), `${name}: figure`);
  assert.ok(out.includes(`data-chart-type="${spec.type}"`), `${name}: type attribute`);
  const rest = spec.summary.slice(spec.title.length + 2);
  const shownText = rest.charAt(0).toUpperCase() + rest.slice(1);
  assert.ok(out.includes(shownText), `${name}: server summary is shown above the chart (title lead dropped, the title captions it)`);
  assert.ok(out.includes(`aria-label="${spec.summary}"`), `${name}: the full server sentence labels the chart`);
  assert.ok(out.indexOf(shownText) < out.indexOf('role="img"'), `${name}: summary comes before the chart`);
  assert.ok(out.includes(spec.title), `${name}: title`);
  // recharts 3 draws its svg after the client measures, so the server pass
  // yields its sized wrapper; the svg itself is verified by the browser shots.
  const plot = html(h(PennyChartPlot, { spec, dark: false, overrides: {}, size: { width: 320, height: 200 } }));
  assert.ok(plot.includes("recharts-wrapper") && plot.includes("width:320px"), `${name}: chart wrapper rendered`);
  assert.ok(out.includes('role="img"') && out.includes(`aria-label="${spec.summary}"`), `${name}: described to assistive tech by the summary`);
  assert.ok(!/gradient/i.test(out) && !/violet/.test(out), `${name}: no gradient, never the Penny gradient`);
  assert.ok(!out.includes("—"), `${name}: no em dash`);
  assert.ok(out.includes("Show as table") && /min-h-11/.test(out), `${name}: 44px table toggle`);
  assert.ok(out.includes('aria-pressed="false"'));
  if (spec.note) assert.ok(out.includes(spec.note), `${name}: note shown`);
}

// ---- 2. palette: category names wear the app's category colours -------------
{
  assert.equal(lib.chartColour(bar, "Eating Out", 0, false), CATEGORY_COLOURS["Eating Out"], "a series named after a category wears its colour");
  const d = html(h(PennyChart, { chart: donut }));
  for (const c of ["Bills", "Groceries", "Other"]) assert.ok(d.toLowerCase().includes(CATEGORY_COLOURS[c]), `donut legend swatch ${c}`);
  for (const c of ["Bills", "Groceries", "Other"]) assert.equal(lib.chartColour(donut, c, 0, true), CATEGORY_COLOURS[c], `donut slice ${c}`);
  assert.ok(d.includes("68%") && d.includes("£840.00"), "donut legend carries values and shares");
  const st = html(h(PennyChart, { chart: stacked }));
  assert.ok(st.toLowerCase().includes(CATEGORY_COLOURS.Bills) && st.toLowerCase().includes(CATEGORY_COLOURS.Groceries));
  assert.ok(st.includes("data-penny-chart-legend"), "two series get a legend");
  assert.ok(!html(h(PennyChart, { chart: bar })).includes("data-penny-chart-legend"), "one series needs no legend box");
  // fallback palette never contains red, amber or the violet of the Penny gradient
  const dark = lib.chartColour(line, "Net", 0, true), light = lib.chartColour(line, "Net", 0, false);
  assert.equal(light, "#4f46e5"); assert.equal(dark, "#818cf8");
  for (let i = 0; i < 4; i++) for (const d2 of [true, false]) {
    const c = lib.chartColour(line, "Net", i, d2).toLowerCase();
    assert.ok(!["#ef4444", "#f87171", "#dc2626", "#fbbf24", "#d97706", "#7c3aed"].includes(c), "no risk colour or Penny violet in the fallback set");
  }
  assert.equal(lib.chartColour(donut, "Groceries", 0, true, { Groceries: "#123456" }), "#123456", "the user's colour override wins");
}

// ---- 3. money and dates follow MoneyText conventions -----------------------
{
  assert.equal(lib.formatChartValue(bar, 312), "£312.00");
  assert.equal(lib.formatChartValue(bar, -84.2), "−£84.20", "currency minus kept");
  assert.equal(lib.formatChartValue(bar, 1234, true), "£1,234");
  assert.equal(lib.formatChartValue({ ...bar, y: { label: "x", unit: "number" } }, 1234.5), "1,234.5");
  assert.equal(lib.formatChartX(line, "2026-10-01", new Date("2026-10-10")), "1 Oct");
  assert.equal(lib.formatChartX(line, "2025-12-28", new Date("2026-10-10")), "28 Dec 2025");
}

// ---- 4. table fallback: the same numbers, accessible ------------------------
{
  const n = lib.normalisePennyChart;
  const t = lib.chartToTable(n(line));
  assert.equal(t.title, "Monzo over time");
  assert.deepEqual(t.columns.map((c) => c.label), ["Day", "Net"]);
  assert.equal(t.rows.length, 3);
  assert.deepEqual(t.rows[0].s0, { amount: -10, currency: "GBP" });
  const tt = lib.chartToTable(n(stacked));
  assert.deepEqual(tt.columns.map((c) => c.label), ["Month", "Bills", "Groceries"]);
  const dt = lib.chartToTable(n(donut));
  assert.deepEqual(dt.columns.map((c) => c.label), ["Category", "Spent"]);
  // the toggle is wired: the component swaps to PennyTable and back
  const src = readFileSync(new URL("../components/PennyChart.tsx", import.meta.url), "utf8");
  assert.ok(src.includes("setAsTable") && src.includes("<PennyTable table={table} />") && src.includes('"Show as chart"'), "toggle swaps in the table");
}

// ---- 5. static, dark mode, reduced motion ----------------------------------
{
  const src = readFileSync(new URL("../components/PennyChart.tsx", import.meta.url), "utf8");
  assert.ok(!/isAnimationActive=\{true\}/.test(src) && (src.match(/isAnimationActive=\{false\}/g) || []).length >= 3, "no animation gates visibility");
  assert.ok(src.includes("useIsDark") && src.includes("dark:bg-slate-800") && src.includes("dark:border-slate-600"), "dark mode");
  assert.ok(src.includes("motion-reduce:transition-none"), "reduced motion respected on the control");
  assert.ok(src.includes('trigger="click"'), "tap-for-value tooltip");
  assert.ok(!/bg-gradient|linear-gradient|from-indigo|to-violet/.test(src), "no gradient classes in the component");
  assert.ok(!/ReferenceLine[^>]*#(ef4444|f87171)/.test(src), "no red");
  const fixture = readFileSync(new URL("../app/design/penny-fullscreen/PennyFullscreenClient.tsx", import.meta.url), "utf8");
  assert.ok(fixture.includes("chart=") && fixture.includes("CHART_FIXTURES") && fixture.includes("VerdictBubble"), "design gate renders the production bubble");
}

// ---- 6. untrusted input renders nothing, never markup -----------------------
{
  assert.equal(html(h(PennyChart, { chart: { ...bar, type: "pie" } })), "");
  assert.equal(html(h(PennyChart, { chart: { ...bar, summary: "" } })), "");
  assert.equal(html(h(PennyChart, { chart: { ...bar, series: [] } })), "");
  assert.equal(lib.normalisePennyChart({ ...bar, series: [{ name: "x", points: new Array(37).fill({ x: "a", y: { amount: 1, currency: "GBP" } }) }] }), null);
  assert.equal(lib.normalisePennyChart({ ...donut, series: [donut.series[0], donut.series[0]] }), null);
  assert.equal(lib.normalisePennyChart({ ...stacked, series: [{ name: "x", points: m([["a", { amount: -1, currency: "GBP" }]]) }] }), null);
  const evil = html(h(PennyChart, { chart: { ...bar, title: "<img src=x onerror=1>", summary: "<script>alert(1)</script>" } }));
  assert.ok(!evil.includes("<script") && !evil.includes("<img"), "strings are drawn as text");
  assert.equal(lib.normalisePennyChart(null), null);
  // idempotent: the bubble normalises, then PennyChart normalises again
  const once = lib.normalisePennyChart(bar);
  assert.deepEqual(lib.normalisePennyChart(once), once);
  assert.equal(lib.normalisePennyChart({ ...bar, series: [{ name: "x", points: [{ x: "a", y: "12" }] }] }), null, "a string is not a value");
  assert.ok(html(h(PennyChart, { chart: once })).includes("data-penny-chart"), "an already-normalised spec renders");
}

// ---- 7. wiring: the bubble draws it under the reply; restored turns carry it -
{
  const conv = readFileSync(new URL("../components/PennyConversation.tsx", import.meta.url), "utf8");
  assert.ok(conv.includes("{msg.chart && <PennyChart chart={msg.chart} />}"), "VerdictBubble renders the chart");
  assert.ok(conv.includes("chart: normalisePennyChart(res.chart)"), "live answers carry the chart");
  assert.ok(conv.includes("chart: normalisePennyChart(t.chart)"), "restored turns carry the chart");
}
console.log("g252-penny-chart: all checks passed");
