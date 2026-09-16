// Plain-Node test for the G108 PUSH-vs-POP detection fix. Same
// framework-free pattern as scripts/serial-queue.test.mjs.
//
// Run with:
//   node --no-warnings --experimental-strip-types scripts/scroll-nav-detect.test.mjs
// or:
//   npm run -s check:scroll-nav-detect
//
// This does not drive a real browser (that reproduction was done by hand
// with headless Chrome against real /design pages — see the G108 backlog
// item and session notes for the recorded scroll numbers). What it tests
// instead is the actual decision rule in lib/scrollNavDetect.ts, against a
// tiny in-memory model of a browser history stack that follows the exact
// rules verified by reading Next.js's own source (see that file's header
// comment for the file/line citations):
//   - a fresh push/replace's new entry starts with a BARE state (nothing
//     carried over from the entry that was current before it)
//   - a traversal (back/forward, of any distance) lands on an entry whose
//     state is whatever was last written there, untouched
//
// It also ports the OLD `window.history.length` heuristic this replaces
// (faithfully — see git history of components/ScrollReset.tsx for the
// original) and runs it through the identical scenario, to prove this test
// actually bites: it fails against the old algorithm and passes against the
// new one.

import { classifyNavigation } from "../lib/scrollNavDetect.ts";

let failures = 0;

function check(label, cond) {
  if (!cond) {
    failures += 1;
    console.error(`FAIL: ${label}`);
  } else {
    console.log(`PASS: ${label}`);
  }
}

// --- Tiny history-stack model -----------------------------------------
//
// entries[i].state is `null` for a never-visited entry, else whatever our
// detector (or nothing) last stamped there. `index` is the current
// position. `push` truncates anything after `index` and appends a bare
// entry, matching completeSoftNavigation's `preserveCustomHistoryState:
// false` (Next.js never spreads the outgoing entry's state into a fresh
// push). `traverse` only moves `index`; it never touches `entries`,
// matching completeTraverseNavigation's `preserveCustomHistoryState: true`
// (the browser hands back the traversed-to entry's own stored state,
// unmodified).
function makeHistory() {
  return { entries: [{ state: null }], index: 0 };
}
function push(history) {
  history.entries = history.entries.slice(0, history.index + 1);
  history.entries.push({ state: null });
  history.index += 1;
}
function traverse(history, delta) {
  const next = history.index + delta;
  if (next < 0 || next >= history.entries.length) {
    throw new Error("traverse out of bounds");
  }
  history.index = next;
}
function currentState(history) {
  return history.entries[history.index].state;
}
function setCurrentState(history, state) {
  history.entries[history.index].state = state;
}

// --- New algorithm driver (lib/scrollNavDetect.ts) ----------------------
function makeNewDetector() {
  let seq = 0;
  // Returns isPop for the entry `history` is currently on, and updates the
  // stack's stored state exactly like ScrollReset.tsx's effect does.
  return function land(history) {
    const { isPop, stampedState } = classifyNavigation(currentState(history), seq + 1);
    if (!isPop) {
      seq += 1;
      setCurrentState(history, stampedState);
    }
    return isPop;
  };
}

// --- Old algorithm driver (the pre-G108 window.history.length heuristic,
// ported faithfully from ScrollReset.tsx's git history) ------------------
function makeOldDetector() {
  let lastLength = null;
  return function land(history) {
    const length = history.entries.length;
    const isPop = lastLength != null && length <= lastLength;
    lastLength = length;
    return isPop;
  };
}

// --- Scenario 1: Kevin's exact bug report --------------------------------
// Load A, push to B, go BACK to A (genuine back — must restore), then tap a
// nav icon to B again (a fresh push — must start at top, NOT restore B's
// old saved scroll).
function testPushRightAfterBackIsNotMisreadAsPop() {
  const history = makeHistory();
  const land = makeNewDetector();
  const landOld = makeOldDetector();

  check("cold load of A is not a POP (new)", land(history) === false);
  check("cold load of A is not a POP (old)", landOld(history) === false);

  push(history); // user taps a link to B
  check("push to B is not a POP (new)", land(history) === false);
  check("push to B is not a POP (old)", landOld(history) === false);

  traverse(history, -1); // browser BACK to A — genuine back, must restore
  check("back to A IS a POP (new)", land(history) === true);
  check("back to A IS a POP (old)", landOld(history) === true);

  push(history); // user taps the SAME nav icon to B again, right after the back
  check(
    "push to B right after a back is correctly NOT a POP (new algorithm — this is the fix)",
    land(history) === false
  );
  check(
    "the OLD algorithm gets this exact case wrong (documents the bug this item fixes)",
    landOld(history) === true
  );
}

// --- Scenario 2: multi-step back, then forward through the same entries -
function testMultiStepBackThenForward() {
  const history = makeHistory(); // A
  const land = makeNewDetector();

  land(history); // cold load A
  push(history); // B
  land(history);
  push(history); // C
  land(history);

  traverse(history, -2); // jump straight from C to A, two entries at once
  check("jumping back two entries at once IS a POP", land(history) === true);

  traverse(history, 2); // native forward, straight back to C
  check(
    "forwarding back through entries just backed out of IS a POP (restores, doesn't reset to top)",
    land(history) === true
  );
}

// --- Scenario 3: a fresh cold load always starts at the top -------------
function testColdLoadIsNeverAPop() {
  const history = makeHistory();
  const land = makeNewDetector();
  check("a brand new tab's first render is not a POP", land(history) === false);
}

function main() {
  testPushRightAfterBackIsNotMisreadAsPop();
  testMultiStepBackThenForward();
  testColdLoadIsNeverAPop();

  if (failures > 0) {
    console.error(`\n${failures} failure(s).`);
    process.exit(1);
  }
  console.log("\nAll scroll-nav-detect checks passed.");
}

main();
