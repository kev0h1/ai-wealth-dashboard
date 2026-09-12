// Plain-Node test for the shared preference-save shape (G60), same
// framework-free pattern as scripts/serial-queue.test.mjs and
// scripts/preferences-version.test.mjs — imports the real production
// modules (lib/preferenceSave.ts AND lib/serialQueue.ts, the same queue
// every real call site uses) rather than a re-implementation of either.
//
// Run with:
//   node --no-warnings --experimental-strip-types scripts/preference-save.test.mjs
// or:
//   npm run -s check:preference-save

import { createPreferenceSaver } from "../lib/preferenceSave.ts";
import { createSerialQueue } from "../lib/serialQueue.ts";

let failures = 0;

function check(label, cond) {
  if (!cond) {
    failures += 1;
    console.error(`FAIL: ${label}`);
  } else {
    console.log(`PASS: ${label}`);
  }
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// A minimal harness modelling one field's local state, the way a real
// caller (PreferencesContext, SpendTrends, Onboarding) would: a mutable
// holder for "current value" plus a log of every apply/error/success call,
// so assertions can check ORDER, not just final state.
function makeField(initial) {
  const state = { value: initial };
  const events = [];
  return {
    state,
    events,
    getCurrent: () => state.value,
    apply: (v) => {
      state.value = v;
      events.push(`apply:${JSON.stringify(v)}`);
    },
    onError: (msg) => events.push(`error:${msg === null ? "null" : JSON.stringify(msg)}`),
    onSuccess: () => events.push("success"),
  };
}

async function testSuccessPath() {
  const field = makeField(false);
  let savedWith;
  let notedVersion;
  const saver = createPreferenceSaver({
    queue: createSerialQueue(),
    getCurrent: field.getCurrent,
    apply: field.apply,
    save: async (v) => {
      savedWith = v;
      return { version: 7 };
    },
    reconcile: async () => undefined,
    noteVersion: (v) => { notedVersion = v; },
    onError: field.onError,
    onSuccess: field.onSuccess,
  });

  await saver.run(true);

  check("success: save() received the computed next value", savedWith === true);
  check("success: version reported to noteVersion", notedVersion === 7);
  check("success: final state is the new value", field.state.value === true);
  check(
    "success: applies optimistically, clears any stale error, then reports success (no failure message)",
    field.events.join(",") === 'apply:true,error:null,success'
  );
}

async function testFailureReconciledFromServer() {
  const field = makeField("a");
  const saver = createPreferenceSaver({
    queue: createSerialQueue(),
    getCurrent: field.getCurrent,
    apply: field.apply,
    save: async () => { throw new Error("network"); },
    // Server truth differs from both the optimistic value AND the
    // pre-write value — proves reconciliation wins over both, not just
    // "revert to previous".
    reconcile: async () => "server-truth",
    onError: field.onError,
    onSuccess: field.onSuccess,
  });

  await saver.run("b");

  check("reconciled failure: final state is the SERVER value, not `previous`", field.state.value === "server-truth");
  check(
    "reconciled failure: applies optimistic, clears prior error, then reverts to server truth and surfaces the failure",
    field.events.join(",") === 'apply:"b",error:null,apply:"server-truth",error:"Could not save that change. Try again."'
  );
  check("reconciled failure: onSuccess never called", !field.events.includes("success"));
}

async function testFailureWithNoServerTruthFallsBackToPrevious() {
  // The exact case that took three rejections to get right (see
  // runCoverToggle's comment in SettingsPage.tsx): the save fails AND the
  // reconciling refetch has nothing to offer (itself failed, or was
  // discarded as stale) — the only safe move is the PRE-WRITE value, not
  // leaving the optimistic (unsaved) value on screen next to an error.
  const field = makeField("previous-value");
  const saver = createPreferenceSaver({
    queue: createSerialQueue(),
    getCurrent: field.getCurrent,
    apply: field.apply,
    save: async () => { throw new Error("network"); },
    reconcile: async () => undefined,
    onError: field.onError,
  });

  await saver.run("optimistic-value");

  check("no-server-truth failure: falls back to the pre-write value", field.state.value === "previous-value");
  check(
    "no-server-truth failure: optimistic value was applied then overwritten, never left showing",
    field.events.includes('apply:"optimistic-value"') && field.state.value !== "optimistic-value"
  );
}

async function testCustomFailureMessage() {
  const field = makeField(0);
  const saver = createPreferenceSaver({
    queue: createSerialQueue(),
    getCurrent: field.getCurrent,
    apply: field.apply,
    save: async () => { throw new Error("nope"); },
    reconcile: async () => undefined,
    onError: field.onError,
    failureMessage: "Custom failure copy",
  });
  await saver.run(1);
  check("custom failure message is used verbatim", field.events.includes("error:\"Custom failure copy\""));
}

async function testMissingOnErrorAndOnSuccessDoNotThrow() {
  // Onboarding has nowhere to show a message for at least one of its two
  // fields — `onError`/`onSuccess` must be genuinely optional, not just
  // typed optional.
  const field = makeField(0);
  const saver = createPreferenceSaver({
    queue: createSerialQueue(),
    getCurrent: field.getCurrent,
    apply: field.apply,
    save: async () => { throw new Error("nope"); },
    reconcile: async () => undefined,
  });
  let threw = false;
  try {
    await saver.run(1);
  } catch {
    threw = true;
  }
  check("missing onError/onSuccess never throws", !threw);
  check("apply still falls back to previous with no onError wired", field.state.value === 0);
}

async function testIsSavingReflectsInFlightState() {
  const field = makeField(0);
  let resolveSave;
  const saver = createPreferenceSaver({
    queue: createSerialQueue(),
    getCurrent: field.getCurrent,
    apply: field.apply,
    save: () => new Promise((resolve) => { resolveSave = resolve; }),
    reconcile: async () => undefined,
  });

  check("isSaving starts false", saver.isSaving.current === false);
  const runPromise = saver.run(1);
  await delay(5);
  check("isSaving is true while the save is in flight", saver.isSaving.current === true);
  resolveSave({ version: 1 });
  await runPromise;
  check("isSaving returns to false once settled", saver.isSaving.current === false);
}

// The core regression this whole G45/G52/G58/G60 lineage exists to prevent:
// two overlapping calls to run() must never let the second read a
// `previous` that predates the first's own failure-path reconciliation.
async function testOverlappingRunsReadSettledState() {
  const field = makeField("start");
  const saveLog = [];
  const saver = createPreferenceSaver({
    queue: createSerialQueue(),
    getCurrent: field.getCurrent,
    apply: field.apply,
    save: async (v) => {
      saveLog.push(v);
      if (v === "first-attempt") {
        await delay(15);
        throw new Error("first attempt fails");
      }
      return { version: 2 };
    },
    // Server truth for the failed first attempt: neither the optimistic
    // value NOR the true pre-write value — a third, distinguishable value,
    // so the test can tell exactly which branch supplied the second run's
    // `previous`.
    reconcile: async () => "reconciled-after-first-failure",
    onError: field.onError,
  });

  // Two calls fired back-to-back, exactly like a user tapping a toggle
  // twice in quick succession — createSerialQueue guarantees the second
  // does not start until the first has fully settled.
  const p1 = saver.run("first-attempt");
  await delay(1); // ensure p1 has actually started before p2 is queued
  const p2 = saver.run("second-attempt");
  await Promise.all([p1, p2]);

  check(
    "second run's own optimistic apply happened (queue did not drop it)",
    field.events.some((e) => e === 'apply:"second-attempt"')
  );
  check(
    "second run committed last, on top of the first run's reconciliation, not a stale pre-first-run value",
    field.state.value === "second-attempt"
  );
  check("both saves were actually issued, never skipped", saveLog.join(",") === "first-attempt,second-attempt");
}

async function main() {
  await testSuccessPath();
  await testFailureReconciledFromServer();
  await testFailureWithNoServerTruthFallsBackToPrevious();
  await testCustomFailureMessage();
  await testMissingOnErrorAndOnSuccessDoNotThrow();
  await testIsSavingReflectsInFlightState();
  await testOverlappingRunsReadSettledState();

  if (failures > 0) {
    console.error(`\n${failures} failure(s).`);
    process.exit(1);
  }
  console.log("\nAll preference-save checks passed.");
}

main();
