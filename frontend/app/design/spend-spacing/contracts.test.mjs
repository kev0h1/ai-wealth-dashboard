import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { SearchParamsContext } from "next/dist/shared/lib/hooks-client-context.shared-runtime.js";
import { SpendPeriodBar } from "../../../components/SpendHeader.tsx";
import SpendPaceHero from "../../../components/SpendPaceHero.tsx";
import { formatPeriod } from "../../../lib/payPeriod.ts";
import { spacingFixture, spacingIncome, STATES } from "./fixtures.ts";
import Preview from "./SpendSpacingPreview.tsx";

const noop = () => {};
const stripIds = html => html.replace(/\s(?:id|aria-controls)="[^"]*"/g, "");
let cases = 0;
for (const { key: state } of STATES) {
  const verdict = spacingFixture(state);
  const incomeTxns = spacingIncome(verdict);
  const common = { verdict, incomeTxns, onTransactionClick: noop };
  const header = renderToStaticMarkup(h(SpendPeriodBar, {
    ...common, periodLabel: formatPeriod(new Date(`${verdict.period.start}T00:00:00Z`), new Date(`${verdict.period.end}T00:00:00Z`)),
    isCurrentPeriod: !verdict.period.closed, canGoPrev: !verdict.period.closed,
    onPrev: noop, onNext: noop, onOpenSettings: noop, onOpenRules: noop,
    recentPeriods: [{ offset: 0, label: "Current pay period" }, { offset: 1, label: "Previous pay period" }], onSelectOffset: noop,
  }));
  const hero = stripIds(renderToStaticMarkup(h(SpendPaceHero, { ...common, onOutTap: noop, onMovedTap: noop })));
  for (const variant of ["a", "b", "reference"]) for (const mode of ["light", "dark"]) {
    const html = renderToStaticMarkup(h(SearchParamsContext.Provider, { value: new URLSearchParams({ state, variant, mode, clean: "1" }) }, h(Preview)));
    assert.ok(html.includes(header), `${state}/${variant}: exact production header markup, controls and guards`);
    assert.ok(html.includes(state === "completed" ? "28 Aug to 24 Sep" : state === "year" ? "25 Dec to 28 Jan" : "25 Sep to 29 Oct"), "literal fixture calendar dates must not shift with the host timezone");
    assert.ok(stripIds(html).includes(hero), `${state}/${variant}: exact production hero copy, figures and disclosures`);
    assert.equal((html.match(/data-g186-hero=/g) ?? []).length, 1, "one actual financial hero");
    assert.equal(html.includes("Back to this period"), state === "completed");
    assert.doesNotMatch(html, /Spacing options/, "page-only comparison has no extra header chrome");
    cases++;
  }
  const named = [...verdict.notables, ...verdict.majority].reduce((sum, item) => sum + item.spent, 0);
  assert.ok(Math.abs(named + verdict.unresolved.total - verdict.pills.spent) < .001, "Out fixture reconciles");
  assert.ok(Math.abs(incomeTxns.reduce((sum, item) => sum + item.amount, 0) - verdict.pills.income) < .001);
  assert.ok(Math.abs(verdict.pills.income - verdict.pills.spent - verdict.pills.net) < .001);
  assert.equal(verdict.moved.reduce((sum, item) => sum + item.amount, 0), verdict.moved_total);
}
const source = readFileSync(new URL("SpendSpacingPreview.tsx", import.meta.url), "utf8");
const controls = renderToStaticMarkup(h(SearchParamsContext.Provider, { value: new URLSearchParams({ variant: "a", state: "current", clean: "0" }) }, h(Preview)));
for (const label of ["Spacing options", "A · Calm rhythm", "B · Closer grouping", "Current spacing", "View page only"]) assert.ok(controls.includes(label), "comparison controls remain available outside page-only mode");
assert.doesNotMatch(source, /api\.|fetch\(|localStorage|sessionStorage|—/);
const css = readFileSync(new URL("spend-spacing.module.css", import.meta.url), "utf8");
assert.match(css, /--hero-gap: 20px/);
assert.match(css, /--hero-gap: 12px/);
assert.match(css, /\[data-g285-period-bar\]\) \{ padding-bottom: 0; \}/);
assert.doesNotMatch(css, /font-size: 30|data-g186|data-out-amount|!important/, "hero internals never overridden");
console.log(`PASS G293: ${cases} actual header/hero render contracts; synthetic financial reconciliation; no production changes or live operations.`);
