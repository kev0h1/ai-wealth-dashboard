import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { SpendPeriodBar } from "../components/SpendHeader.tsx";
import { formatPeriod } from "../lib/payPeriod.ts";

const noOp = () => {};
const base = {
  isCurrentPeriod: true, canGoPrev: true, onPrev: noOp, onNext: noOp,
  onOpenSettings: noOp, onOpenRules: noOp, incomeTxns: [],
  onTransactionClick: noOp, onSelectOffset: noOp,
};
const cases = [
  ["2026-09-25", "2026-10-29", 6, 29, "25 Sep to 29 Oct", null],
  ["2026-12-25", "2027-01-28", 6, 29, "25 Dec to 28 Jan", "2026 to 2027"],
  ["2026-09-21", "2026-09-27", 3, 4, "21 Sep to 27 Sep", null],
  ["2026-08-28", "2026-09-24", 28, 0, "28 Aug to 24 Sep", null],
  ["2026-10-01", "2026-10-31", 19, null, "1 Oct to 31 Oct", null],
];

export function renderPeriodBar(start, end, elapsed, left, extra = {}) {
  return renderToStaticMarkup(React.createElement(SpendPeriodBar, {
    ...base,
    verdict: { period: { start, end, days_elapsed: elapsed, days_left: left } },
    periodLabel: formatPeriod(new Date(`${start}T00:00:00Z`), new Date(`${end}T00:00:00Z`)),
    ...extra,
  }));
}

for (const [start, end, elapsed, left, label, year] of cases) {
  const html = renderPeriodBar(start, end, elapsed, left);
  assert.match(html, /data-g285-period-bar="b"/);
  assert.match(html, /grid-cols-\[minmax\(0,1fr\)_auto_44px\]/);
  assert.ok(html.includes(label), `Complete period ${label}`);
  assert.ok(html.includes(`Day ${elapsed}${left == null ? "" : ` of ${elapsed + left}`}`));
  assert.equal(html.includes("2026 to 2027"), Boolean(year));
  assert.match(html, /aria-label="Choose pay period, [^"]*2026[^"]*"/);
  assert.match(html, /aria-haspopup="dialog" aria-expanded="false"/);
  assert.doesNotMatch(html, /truncate|text-ellipsis|max-w-\[104px\]/);
  assert.ok(html.indexOf("Spend</h1>") < html.indexOf("data-period-picker"));
  const title = html.slice(html.indexOf("data-period-title"), html.indexOf("<nav"));
  assert.ok(title.includes(label), "Period picker belongs beneath the title, not between arrows");
  const arrows = html.slice(html.indexOf("<nav"), html.indexOf("</nav>"));
  assert.equal((arrows.match(/<button/g) ?? []).length, 2);
  assert.match(arrows, /aria-label="Previous pay period"/);
  assert.match(arrows, /aria-label="Next pay period" disabled=""/);
  assert.match(html, /<a[^>]*aria-label="Search transactions"[^>]*href="\/transactions"/);
  assert.match(html, /min-h-11 min-w-11/);
  assert.equal((html.match(/size-11/g) ?? []).length, 3, "Both arrows and Search retain 44px targets");
  assert.doesNotMatch(html, /glass-hero|£/, "Header does not re-render or change the financial instrument");
}
const closed = renderPeriodBar(...cases[3].slice(0, 4), { isCurrentPeriod: false, canGoPrev: false });
assert.match(closed, /aria-label="Previous pay period" disabled=""/);
assert.doesNotMatch(closed, /aria-label="Next pay period" disabled/);
assert.match(closed, /Back to this period/);
const pending = renderToStaticMarkup(React.createElement(SpendPeriodBar, { ...base, verdict: null, periodLabel: "" }));
assert.doesNotMatch(pending, /data-period-picker|Day |Choose pay period/);
const source = readFileSync(new URL("../components/SpendHeader.tsx", import.meta.url), "utf8");
assert.match(source, /onClick=\{onPrev\}/);
assert.match(source, /onClick=\{onNext\}/);
assert.match(source, /closeThen\(\(\) => onSelectOffset\(p.offset\)\)/);
assert.match(source, /closeThen\(onOpenSettings\)/);
assert.match(source, /closeThen\(onOpenRules\)/);
assert.match(source, /onClick=\{\(\) => onSelectOffset\(0\)\}/);
console.log("G285 B: full date under Spend, real day counts, year context, navigation guards, Search and existing sheet paths pass.");
