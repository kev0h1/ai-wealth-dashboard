import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fixtureFor, SCENARIOS, ORDER } from "../app/design/planning-ladder-timeline/fixtures.ts";

const [timeline, client, fixtures] = await Promise.all([
  readFile(new URL("../app/design/planning-ladder-timeline/Timeline.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/design/planning-ladder-timeline/PlanningLadderTimelineClient.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/design/planning-ladder-timeline/fixtures.ts", import.meta.url), "utf8"),
]);
assert.match(client, /GrowHero/); assert.match(client, /SectionJumpStrip/); assert.match(client, /CollapsedLadder/);
assert.match(timeline, /aria-expanded/); assert.match(timeline, /inert=\{!open\}/); assert.match(timeline, /motion-reduce:transition-none/);
assert.match(timeline, /font-mono/); assert.match(timeline, /data-g187-timeline/);
assert.match(timeline, /data-g187-expanded-group="individual"/); assert.match(timeline, /data-g187-expanded-card/);
assert.match(timeline, /data-g187-expanded-group="shared"/); assert.match(timeline, /glass-card rounded-3xl p-5/);
assert.match(timeline, /data-g187-active-card/); assert.doesNotMatch(timeline, /glass-hero/);
assert.match(timeline, /col-span-2 text-sm leading-5/, "expanded explanation spans the full card width, not a narrow figure column");
assert.doesNotMatch(timeline, /space-y-3 px-2 pb-3/, "expanded cards align with the active checkpoint card");
assert.match(client, /expand=\$\{expand\}/); assert.match(client, /requestedExpand/); assert.match(client, /initialExpand=\{expand\}/);
assert.match(fixtures, /hidden/); assert.match(fixtures, /long/); assert.match(fixtures, /attention/); assert.match(fixtures, /neutral/);
assert.doesNotMatch(timeline, /period_gate/);
for (const scenario of SCENARIOS) {
  const { view, debt } = fixtureFor(scenario);
  assert.deepEqual(view.ladder.map(step => step.key), scenario === "empty" ? [] : ORDER);
  const ledger = view.surplus_ledger;
  assert.equal(ledger.income - ledger.spending - ledger.debt_deduction, view.surplus_monthly);
  assert.equal(debt.cards.reduce((sum, card) => sum + card.debt, 0), view.debt.total);
  assert.ok(view.ladder.filter(step => ["active", "attention"].includes(step.state)).length <= 1);
  if (view.ladder.find(step => step.key === "starter_buffer")?.state === "done") assert.ok(view.buffer.current >= 1500);
  if (view.ladder.find(step => step.key === "full_fund")?.state === "done") assert.ok(view.buffer.current >= view.buffer.target);
  if (view.ladder.find(step => step.key === "expensive_debt")?.state === "done") assert.equal(view.debt.expensive_total, 0);
}
assert.match(timeline, /more after this/);
assert.match(timeline, /size-6/);
assert.match(timeline, /-left-8/);
console.log("g187 timeline structural checks passed");
