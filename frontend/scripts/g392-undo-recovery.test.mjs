// G392 F2: Undo must be resumable. These are deliberately API-shaped mocks:
// each successful stage is remembered, so a retry cannot repeat a mutation
// that may already have changed a newer user decision.
import assert from "node:assert/strict";
import { build } from "esbuild";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const frontend = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const bundled = await build({
  entryPoints: [path.join(frontend, "lib/teachingUndo.ts")],
  bundle: true,
  format: "esm",
  platform: "node",
  write: false,
});
const { runTeachingUndoStages } = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString("base64")}`);

function mockedUndo(stages, failures = new Set()) {
  const calls = [];
  const api = Object.fromEntries(stages.map((id) => [id, async () => {
    calls.push(id);
    if (failures.delete(id)) throw new Error(`${id} unavailable`);
  }]));
  return { calls, api, completed: new Set() };
}

async function retriesOnlyUnfinished(label, stageIds, failingStage, dependencies = {}) {
  const mock = mockedUndo(stageIds, new Set([failingStage]));
  const stages = stageIds.map((id) => ({ id, dependsOn: dependencies[id], run: mock.api[id] }));
  const first = await runTeachingUndoStages(stages, mock.completed);
  assert.equal(first.complete, false, `${label}: the failed undo stays incomplete`);
  assert.ok(first.failedStageIds.includes(failingStage), `${label}: reports the failed stage`);
  const beforeRetry = [...mock.calls];
  const second = await runTeachingUndoStages(stages, mock.completed);
  assert.equal(second.complete, true, `${label}: a retry completes it`);
  const retried = mock.calls.slice(beforeRetry.length);
  assert.equal(retried.filter((id) => id === failingStage).length, 1, `${label}: retry repeats the failed write once`);
  for (const completed of mock.completed) {
    if (completed !== failingStage && beforeRetry.includes(completed)) {
      assert.equal(retried.includes(completed), false, `${label}: retry does not repeat successful ${completed}`);
    }
  }
}

await retriesOnlyUnfinished("single spend", ["primary"], "primary");
await retriesOnlyUnfinished("debit movement", ["primary"], "primary");
await retriesOnlyUnfinished("credit movement", ["primary"], "primary");
await retriesOnlyUnfinished("rule primary", ["rule", "primary", "sibling:a"], "primary", { primary: ["rule"], "sibling:a": ["rule"] });
await retriesOnlyUnfinished("rule deletion", ["rule", "primary", "sibling:a"], "rule", { primary: ["rule"], "sibling:a": ["rule"] });
await retriesOnlyUnfinished("rule sibling", ["rule", "primary", "sibling:a", "sibling:b"], "sibling:a", { primary: ["rule"], "sibling:a": ["rule"], "sibling:b": ["rule"] });

// A DELETE can commit while its response is lost. The next DELETE returns 404,
// which means the desired rule absence, not an endlessly retryable failure.
{
  const completed = new Set(); let deletes = 0; const calls = [];
  const result = await runTeachingUndoStages([
    { id: "rule", run: async () => { deletes++; throw { status: 404 }; }, acceptsError: (e) => e?.status === 404 },
    { id: "primary", dependsOn: ["rule"], run: async () => { calls.push("primary"); } },
    { id: "sibling", dependsOn: ["rule"], run: async () => { calls.push("sibling"); } },
  ], completed);
  assert.equal(result.complete, true, "lost rule-delete response accepts the confirmed absent state");
  assert.equal(deletes, 1); assert.deepEqual(calls, ["primary", "sibling"]);
}

// The component owns this short in-flight gate. Source assertions pin the
// user-visible wiring while the executable cases above pin retry semantics.
const sheet = await readFile(path.join(frontend, "components/TeachingSheet.tsx"), "utf8");
assert.match(sheet, /const undoInFlight = useRef\(false\)/, "duplicate Undo clicks are gated before a render");
assert.match(sheet, /if \(!toast \|\| undoInFlight\.current\) return;/, "the gate is checked before starting Undo");
assert.match(sheet, /if \(!undoStarted\.current\) sheetCloseRef\.current\?\.\(\);/, "the expiry timer cannot close a started Undo");
assert.match(sheet, /Undo could not finish\. Some saved changes may still be in place\./, "partial Undo has persistent truthful copy");
assert.match(sheet, /\bRetry\b/, "partial Undo offers retry");
assert.match(sheet, /\bDone\b/, "partial Undo offers a safe exit");
assert.doesNotMatch(sheet, /text-red-600 dark:text-red-400" role="alert">\{error\}/, "ordinary save errors are neutral, not financial-risk red");

console.log("G392 Undo recovery checks passed");
