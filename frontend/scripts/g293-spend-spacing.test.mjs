// Production shell geometry, not a retained design preview or an authenticated page.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { SpendPeriodBar } from "../components/SpendHeader.tsx";
import SpendPaceHero from "../components/SpendPaceHero.tsx";
import { formatPeriod } from "../lib/payPeriod.ts";
import { spacingFixture, spacingIncome, STATES } from "./fixtures/g293-spend-spacing.ts";

// Read the actual page's outer shell, grid and summary section. Copying a
// padded phone wrapper into a test can conceal a production inset regression.
const source = readFileSync(new URL("../app/components/SpendPage.tsx", import.meta.url), "utf8");
const ast = ts.createSourceFile("SpendPage.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const page = ast.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === "SpendPage");
const returned = page.body.statements.filter(ts.isReturnStatement).at(-1).expression.expression;
assert.ok(ts.isJsxElement(returned), "SpendPage returns its real JSX shell");
const children = node => node.children.filter(n => ts.isJsxElement(n) || ts.isJsxSelfClosingElement(n));
// G306: the shell is wrapped in BalancesHiddenContext.Provider; the layout under test is its one child.
const root = returned.openingElement.tagName.getText(ast) === "BalancesHiddenContext.Provider" ? children(returned)[0] : returned;
const open = node => ts.isJsxElement(node) ? node.openingElement : node;
const tag = node => open(node).tagName.getText(ast);
const attr = (node, name) => open(node).attributes.properties.find(n => ts.isJsxAttribute(n) && n.name.text === name)?.initializer;
const textAttr = (node, name) => { const value = attr(node, name); assert.ok(ts.isStringLiteral(value), `${name} is a source-backed literal`); return value.text; };
const [periodBar, grid] = children(root);
assert.equal(tag(periodBar), "SpendPeriodBar", "header immediately precedes the content grid");
const summary = children(grid)[0];
assert.equal(textAttr(summary, "aria-label"), "Pay period summary");
assert.equal(tag(children(summary)[0]), "SpendPaceHero", "real hero is first in the actual summary section");
const journey = children(grid).find(node => tag(node) === "main");
assert.ok(journey, "actual desktop journey column remains beside the summary");
const style = attr(root, "style").expression;
assert.ok(ts.isObjectLiteralExpression(style));
const rootStyle = Object.fromEntries(style.properties.map(prop => {
  assert.ok(ts.isPropertyAssignment(prop) && ts.isStringLiteral(prop.initializer));
  return [prop.name.getText(ast), prop.initializer.text];
}));
export const shell = {
  root: textAttr(root, "className"), style: rootStyle,
  grid: textAttr(grid, "className"), summary: textAttr(summary, "className"), journey: textAttr(journey, "className"),
};
assert.ok(shell.grid.split(" ").includes("mt-3"), "approved B has exactly one 12px handoff");
assert.equal(shell.grid.split(" ").filter(c => /^mt-/.test(c)).length, 1);
assert.ok(shell.root.includes("px-4") && shell.root.includes("sm:px-6") && shell.root.includes("lg:px-8"), "real responsive gutters");
assert.match(shell.style.paddingTop, /safe-area-inset-top/);
const mirror = readFileSync(new URL("../app/design/spend-live/SpendLiveClient.tsx", import.meta.url), "utf8");
assert.ok(mirror.includes(`className="${shell.grid}"`), "retained header fixture uses the production spacing");

const noop = () => {};
export function renderSpendShell(state) {
  const verdict = spacingFixture(state), incomeTxns = spacingIncome(verdict);
  const common = { verdict, incomeTxns, onTransactionClick: noop };
  return renderToStaticMarkup(h("div", { className: shell.root, style: shell.style, "data-g293-shell": true },
    h(SpendPeriodBar, {
      ...common, periodLabel: formatPeriod(new Date(`${verdict.period.start}T00:00:00Z`), new Date(`${verdict.period.end}T00:00:00Z`)),
      isCurrentPeriod: !verdict.period.closed, canGoPrev: !verdict.period.closed,
      onPrev: noop, onNext: noop, onOpenSettings: noop, onOpenRules: noop,
      recentPeriods: [{ offset: 0, label: "Current pay period" }, { offset: -1, label: "Previous pay period" }], onSelectOffset: noop,
    }),
    h("div", { className: shell.grid, "data-g293-grid": true },
      h("section", { className: shell.summary, "aria-label": "Pay period summary" }, h(SpendPaceHero, { ...common, onOutTap: noop, onMovedTap: noop })),
      h("main", { className: shell.journey, "aria-label": "Journey omitted from isolated layout check" }),
    ),
  ));
}
for (const { key: state } of STATES) {
  const html = renderSpendShell(state);
  const header = html.match(/<header[^>]*>/)[0];
  assert.doesNotMatch(header, /\bpb-/, "no duplicated trailing header padding");
  assert.ok(html.includes(state === "completed" ? "28 Aug to 24 Sep" : state === "year" ? "25 Dec to 28 Jan" : "25 Sep to 29 Oct"), "literal calendar dates in any host timezone");
  assert.equal(html.includes("Back to this period"), state === "completed");
  if (state === "completed") assert.match(html, /class="mt-3 inline-flex min-h-11/);
  if (state === "year") assert.ok(html.includes("2026 to 2027"));
  assert.equal((html.match(/data-g186-hero=/g) ?? []).length, 1);
  const verdict = spacingFixture(state), income = spacingIncome(verdict);
  assert.ok(Math.abs([...verdict.notables, ...verdict.majority].reduce((sum, item) => sum + item.spent, verdict.unresolved.total) - verdict.pills.spent) < .001);
  assert.ok(Math.abs(income.reduce((sum, item) => sum + item.amount, 0) - verdict.pills.income) < .001);
  assert.ok(Math.abs(verdict.pills.income - verdict.pills.spent - verdict.pills.net) < .001);
  assert.equal(verdict.moved.reduce((sum, item) => sum + item.amount, 0), verdict.moved_total);
}
console.log("PASS G293 B: actual page-shell classes, one 12px gap, intact Back action, real header/hero and four reconciled synthetic states.");
