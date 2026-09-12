// Plain-Node test for the serialization primitive (G45, second re-review,
// blocker 1). Same framework-free pattern as scripts/preferences-version.test.mjs
// and this repo's existing scripts/legal-content.test.mjs.
//
// Run with:
//   node --no-warnings --experimental-strip-types scripts/serial-queue.test.mjs
// or:
//   npm run -s check:serial-queue

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

async function testRunsOneAtATimeInOrder() {
  const queue = createSerialQueue();
  const events = [];
  let concurrent = 0;
  let maxConcurrent = 0;

  async function item(label, ms) {
    concurrent += 1;
    maxConcurrent = Math.max(maxConcurrent, concurrent);
    events.push(`${label}:start`);
    await delay(ms);
    events.push(`${label}:end`);
    concurrent -= 1;
    return label;
  }

  // Fire three "toggles" back-to-back, synchronously, the way three fast
  // clicks would — the SECOND and THIRD must not start until the ones
  // before them have fully settled.
  const p1 = queue.run(() => item("A", 30));
  const p2 = queue.run(() => item("B", 10));
  const p3 = queue.run(() => item("C", 5));

  const results = await Promise.all([p1, p2, p3]);

  check("never more than one item runs at once", maxConcurrent === 1);
  check(
    "items run strictly in enqueue order, each fully finishing before the next starts",
    events.join(",") === "A:start,A:end,B:start,B:end,C:start,C:end"
  );
  check("each run() resolves with its own function's own result", results.join(",") === "A,B,C");
}

async function testAFailureDoesNotBlockOrCorruptLaterItems() {
  const queue = createSerialQueue();
  const events = [];

  const p1 = queue.run(async () => {
    events.push("A:start");
    await delay(10);
    events.push("A:end");
    throw new Error("A failed (simulates a failed PATCH)");
  });

  // B is queued immediately after A, before A has settled — it must not
  // start until A's rejection has been fully processed, and its own
  // success must not be affected by A's failure.
  const p2 = queue.run(async () => {
    events.push("B:start");
    await delay(5);
    events.push("B:end");
    return "B-ok";
  });

  let p1Rejected = false;
  await p1.catch(() => {
    p1Rejected = true;
  });
  const p2Result = await p2;

  check("the failing item's own promise still rejects (caller sees the failure)", p1Rejected === true);
  check("the next queued item still runs and succeeds", p2Result === "B-ok");
  check(
    "B does not start until A has fully settled (including A's own failure)",
    events.join(",") === "A:start,A:end,B:start,B:end"
  );
}

async function testThirdItemWaitsForAFailedSecondItemToo() {
  // Guards the exact review scenario: A fails, B (queued right after A)
  // must still only run once A is done, and C (queued after B) must only
  // run once B is done — a chain of any length, not just two items.
  const queue = createSerialQueue();
  const events = [];

  const pA = queue.run(async () => {
    events.push("A:start");
    await delay(15);
    events.push("A:end");
    throw new Error("A failed");
  });
  const pB = queue.run(async () => {
    events.push("B:start");
    await delay(15);
    events.push("B:end");
    throw new Error("B also failed");
  });
  const pC = queue.run(async () => {
    events.push("C:start");
    await delay(5);
    events.push("C:end");
    return "C-ok";
  });

  await Promise.allSettled([pA, pB, pC]);
  const cResult = await pC;

  check(
    "a chain of two consecutive failures still serializes correctly",
    events.join(",") === "A:start,A:end,B:start,B:end,C:start,C:end"
  );
  check("the item after two failures still succeeds normally", cResult === "C-ok");
}

async function main() {
  await testRunsOneAtATimeInOrder();
  await testAFailureDoesNotBlockOrCorruptLaterItems();
  await testThirdItemWaitsForAFailedSecondItemToo();

  if (failures > 0) {
    console.error(`\n${failures} failure(s).`);
    process.exit(1);
  }
  console.log("\nAll serial-queue checks passed.");
}

main();
