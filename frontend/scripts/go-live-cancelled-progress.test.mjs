// Plain-Node test for lib/goLive.ts's itemTotals/headerFigures (H80
// correction round) — same framework-free pattern as
// scripts/cash-walk.test.mjs et al: imports the REAL production
// functions (the exact ones frontend/app/ops/go-live/page.tsx and
// HeaderHero.tsx call), not a hand-copied re-implementation.
//
// Run with:
//   node --no-warnings --experimental-strip-types scripts/go-live-cancelled-progress.test.mjs
// or:
//   npm run -s check:go-live-cancelled-progress
//
// docs/ops/BACKLOG.md claims a cancelled item is "never counted as done
// or as outstanding by any progress figure on the board" (itemTotals'
// done/total pair, and headerFigures' p1Open). Before this test existed
// that claim rested entirely on reading the source, unverified by
// anything that runs — this is the first automated check for it.

import { itemTotals, headerFigures } from "../lib/goLive.ts";

let failures = 0;

function check(label, actual, expected) {
  const same = JSON.stringify(actual) === JSON.stringify(expected);
  if (!same) {
    failures += 1;
    console.error(`FAIL: ${label} — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  } else {
    console.log(`PASS: ${label}`);
  }
}

// Minimal fixture builder: every GoLiveItem field filled with an inert
// default, override just what a given check cares about.
function item(overrides) {
  return {
    id: "H1",
    section: "H",
    title: "Fixture item",
    text: "",
    owner: "claude",
    state: "todo",
    reason: null,
    branch: null,
    link: null,
    uat_review: false,
    done_at: null,
    commit: null,
    notes: [],
    priority: "p3",
    unblocks: [],
    ...overrides,
  };
}

// ── itemTotals: a cancelled item must move neither side of done/total ──

check(
  "a todo item alone counts as 1 outstanding, 0 done",
  itemTotals([item({ id: "A1", state: "todo" })]),
  { done: 0, total: 1 },
);

check(
  "a done item alone counts as 1 of 1 done",
  itemTotals([item({ id: "A1", state: "done" })]),
  { done: 1, total: 1 },
);

check(
  "a cancelled item alone counts as 0 of 0 -- not outstanding, not done",
  itemTotals([item({ id: "A1", state: "cancelled", reason: "not wanted" })]),
  { done: 0, total: 0 },
);

check(
  "adding a cancelled item to an existing done/total pair does not move it",
  itemTotals([
    item({ id: "A1", state: "done" }),
    item({ id: "A2", state: "todo" }),
    item({ id: "A3", state: "cancelled", reason: "superseded" }),
  ]),
  { done: 1, total: 2 }, // the cancelled item (A3) counted in neither figure
);

check(
  "a mix of every state: cancelled excluded, everything else counted",
  itemTotals([
    item({ id: "A1", state: "done" }),
    item({ id: "A2", state: "done" }),
    item({ id: "A3", state: "todo" }),
    item({ id: "A4", state: "blocked", reason: "waiting" }),
    item({ id: "A5", state: "review", branch: "feature-A5-thing" }),
    item({ id: "A6", state: "rejected", reason: "wrong approach" }),
    item({ id: "A7", state: "uat", link: "https://uat.wealth.auriqltd.co.uk/design" }),
    item({ id: "A8", state: "cancelled", reason: "obsolete" }),
    item({ id: "A9", state: "cancelled", reason: "duplicate" }),
  ]),
  { done: 2, total: 7 }, // 9 items total, minus the 2 cancelled (A8, A9)
);

// ── headerFigures.p1Open: a cancelled P1 must not inflate "P1 open" ─────

check(
  "a single open P1 item counts as 1",
  headerFigures([item({ id: "A1", priority: "p1", state: "todo" })]).p1Open,
  1,
);

check(
  "a done P1 item does not count as open",
  headerFigures([item({ id: "A1", priority: "p1", state: "done" })]).p1Open,
  0,
);

check(
  "a cancelled P1 item does not count as open either (the bug this test guards)",
  headerFigures([item({ id: "A1", priority: "p1", state: "cancelled", reason: "not wanted" })]).p1Open,
  0,
);

check(
  "a cancelled P1 item alongside a genuinely open P1 item only counts the open one",
  headerFigures([
    item({ id: "A1", priority: "p1", state: "todo" }),
    item({ id: "A2", priority: "p1", state: "in-progress", branch: "feature-A2-thing" }),
    item({ id: "A3", priority: "p1", state: "cancelled", reason: "obsolete" }),
    item({ id: "A4", priority: "p2", state: "todo" }), // wrong priority, must not count
  ]).p1Open,
  2,
);

if (failures > 0) {
  console.error(`\n${failures} failure(s).`);
  process.exit(1);
}
console.log("\nAll go-live cancelled-progress (H80) checks passed.");
