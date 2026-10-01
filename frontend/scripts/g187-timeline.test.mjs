import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import "./g187-checkpoint-figures.test.mjs";
import { fixtureFor, SCENARIOS, ORDER } from "../app/design/planning-ladder-timeline/fixtures.ts";
import PlanningCheckpointTimeline from "../components/PlanningCheckpointTimeline.tsx";
import Timeline from "../app/design/planning-ladder-timeline/Timeline.tsx";

const [component, timeline, client, fixtures, growPanel] = await Promise.all([
  readFile(new URL("../components/PlanningCheckpointTimeline.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/design/planning-ladder-timeline/Timeline.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/design/planning-ladder-timeline/PlanningLadderTimelineClient.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/design/planning-ladder-timeline/fixtures.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/planning/GrowPanel.tsx", import.meta.url), "utf8"),
]);

assert.match(growPanel, /PlanningCheckpointTimeline/);
assert.match(growPanel, /planningCheckpointFigures\(view\)/);
assert.match(timeline, /import PlanningCheckpointTimeline/);
assert.match(timeline, /variant === "b"\) return <PlanningCheckpointTimeline/);
assert.match(client, /params\.get\("variant"\) === "a" \? "a" : "b"/);
assert.match(client, /planningCheckpointFigures\(fixture\.view\)/);
assert.match(client, /Approved shared group card/);

assert.match(component, /aria-expanded/);
assert.match(component, /aria-controls/);
assert.match(component, /inert=\{!open\}/);
assert.match(component, /grid-rows-\[0fr\]/);
assert.match(component, /motion-reduce:transition-none/);
assert.match(component, /min-h-11/);
assert.match(component, /data-g187-expanded-group="shared"/);
assert.match(component, /data-g187-active-card/);
assert.match(component, /mt-4 border-t border-slate-200 pt-4/);
assert.doesNotMatch(component, /divide-y/);
assert.match(component, /step\.options\.map/);
assert.doesNotMatch(component, /step\.options\.slice/);
assert.match(component, /step\.link\.route/);
assert.match(component, /maskMoney\(step\.detail, hideValues\)/);
assert.match(component, /formatCurrency\(Math\.abs\(amount\)\)/);
assert.match(component, /attention\.map[\s\S]*done\.length[\s\S]*active\.length[\s\S]*locked\.length/);
assert.match(component, /Add an account/);
assert.doesNotMatch(component, /period_gate/);
assert.match(fixtures, /hidden/);
assert.match(fixtures, /long/);
assert.match(fixtures, /attention/);
assert.match(fixtures, /neutral/);

const steps = [
  { key: "done", title: "Completed checkpoint", state: "done", detail: "Completed with £200.00 saved.", options: [], link: { label: "Review completed ›", route: "/accounts" } },
  { key: "pension", title: "Pension top-up", state: "active", detail: "This checkpoint has no display figure.", options: ["First original option", "Second original option", "Third original option"], link: { label: "Open pension ›", route: "/planning" } },
  { key: "attention", title: "Check this first", state: "attention", detail: "Attention wording stays factual.", options: ["Attention option must not render"], link: { label: "Review attention ›", route: "/upcoming" } },
  { key: "later", title: "Later checkpoint", state: "locked", detail: "Later detail with £200.00.", options: [], link: { label: "Read later ›", route: "/goals" } },
];
const figures = { done: { amount: -200, label: "Monthly gap" }, later: { amount: 1200, label: "Target" } };
const markup = renderToStaticMarkup(React.createElement(PlanningCheckpointTimeline, { steps, figures, hideValues: false, initialExpand: "all" }));
assert.match(markup, /Priority checkpoints/);
assert.match(markup, /aria-expanded="true"/);
assert.match(markup, /First original option/);
assert.match(markup, /Second original option/);
assert.match(markup, /Third original option/);
assert.doesNotMatch(markup, /Attention option must not render/);
assert.match(markup, /−£200\.00/);
const noFigureMarkup = renderToStaticMarkup(React.createElement(PlanningCheckpointTimeline, { steps: [steps[1]], hideValues: false }));
assert.match(noFigureMarkup, /Pension top-up/);
assert.match(noFigureMarkup, /Current/);
assert.doesNotMatch(noFigureMarkup, /grid-cols-/, "A checkpoint without a figure has no empty figure column");
assert.match(markup, /Review completed/);
assert.match(markup, /Review attention/);
assert.match(markup, /Read later/);
const hiddenMarkup = renderToStaticMarkup(React.createElement(PlanningCheckpointTimeline, { steps, figures, hideValues: true, initialExpand: "all" }));
assert.match(hiddenMarkup, /£••••/);
assert.doesNotMatch(hiddenMarkup, /£200\.00/);
assert.doesNotMatch(hiddenMarkup.replace(/<[^>]*>/g, ""), /(?:200|1,?200)/, "masked figures do not leak digits into visible text");
const closedMarkup = renderToStaticMarkup(React.createElement(PlanningCheckpointTimeline, { steps, figures, hideValues: false }));
assert.match(closedMarkup, /inert=""/);
const emptyMarkup = renderToStaticMarkup(React.createElement(PlanningCheckpointTimeline, { steps: [], hideValues: false }));
assert.match(emptyMarkup, /No checkpoints yet/);
assert.match(emptyMarkup, /href="\/accounts"/);
const previewMarkup = renderToStaticMarkup(React.createElement(Timeline, { steps, metadata: {}, hideValues: false, variant: "b", initialExpand: "all", figures }));
assert.match(previewMarkup, /data-g187-timeline="b"/);
assert.match(previewMarkup, /data-g187-expanded-group="shared"/);

for (const scenario of SCENARIOS) {
  const { view, debt } = fixtureFor(scenario);
  assert.deepEqual(view.ladder.map((step) => step.key), scenario === "empty" ? [] : ORDER);
  const ledger = view.surplus_ledger;
  assert.equal(ledger.income - ledger.spending - ledger.debt_deduction, view.surplus_monthly);
  assert.equal(debt.cards.reduce((sum, card) => sum + card.debt, 0), view.debt.total);
  assert.ok(view.ladder.filter((step) => ["active", "attention"].includes(step.state)).length <= 1);
  if (view.ladder.find((step) => step.key === "starter_buffer")?.state === "done") assert.ok(view.buffer.current >= 1500);
  if (view.ladder.find((step) => step.key === "full_fund")?.state === "done") assert.ok(view.buffer.current >= view.buffer.target);
  if (view.ladder.find((step) => step.key === "expensive_debt")?.state === "done") assert.equal(view.debt.expensive_total, 0);
}

console.log("g187 timeline structural checks passed");
