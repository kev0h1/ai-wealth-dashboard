// G421: every Upcoming cancel/delete control awaits the API, then refreshes
// Upcoming through the G399 path and clears the Spend verdict cache.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const planning = read("app/planning/PlanningPage.tsx");
const commitmentSheet = read("components/CommitmentSheet.tsx");
const allocationEditor = read("components/AllocationPlanEditor.tsx");

function body(src, marker, length = 1200) {
  const i = src.indexOf(marker);
  assert.ok(i >= 0, `missing ${marker}`);
  return src.slice(i, i + length);
}

// Planned payment delete: awaited, never fire-and-forget, then refetch.
const confirm = body(planning, "async function confirmPlannedDelete(");
assert.ok(confirm.indexOf("await api.deletePlanned(") < confirm.indexOf("invalidateVerdictCache()"));
assert.ok(confirm.indexOf("invalidateVerdictCache()") < confirm.indexOf("await api.cashflowWithForecast()"));
assert.doesNotMatch(planning, /api\.deletePlanned\([^)]*\)\.catch/, "no fire-and-forget planned delete");
const timer = body(planning, "function deletePlannedWithUndo(", 1400);
assert.match(timer, /void confirmPlannedDelete\(id\)/);
assert.match(body(planning, "function flushPlannedDelete()", 400), /confirmPlannedDelete\(p\.id, false\)/);

// Plan, set-aside and goal edits all refresh through these two helpers.
assert.match(body(planning, "function refreshAllocations()", 200), /invalidateVerdictCache\(\)/);
assert.match(body(planning, "async function refreshAccountFlow()", 300), /invalidateVerdictCache\(\)/);
assert.match(planning, /onDeleted=\{\(\) => refreshAllocations\(\)\}/);

// Not a bill (dismiss) clears the verdict cache once the API resolves.
assert.match(planning, /api\.dismissRecurring\(name\)\.then\(\(\) => \{ invalidateVerdictCache\(\); \}\)/);

// Set-aside delete awaits the API before onDeleted; goal cancel awaits then clears the cache.
assert.match(allocationEditor, /if \(action === "delete"\) await services\.deleteAllocation\(allocation\.id\);/);
const cancel = body(commitmentSheet, "async function handleCancelCommitment(", 500);
assert.ok(cancel.indexOf("await operations.cancelCommitment(") < cancel.indexOf("invalidateVerdictCache()"));
assert.ok(cancel.indexOf("invalidateVerdictCache()") < cancel.indexOf("onCancelled"));

// Cancel A then B inside the undo window: flushing A must not refetch over B.
const flush = body(planning, "function flushPlannedDelete()", 700);
assert.match(flush, /confirmPlannedDelete\(p\.id, false\)/, "flush skips the refetch");
assert.match(confirm, /if \(!refetch\) return;/);
assert.ok(confirm.indexOf("if (!refetch) return;") < confirm.indexOf("await api.cashflowWithForecast()"));
assert.match(confirm, /lastPlannedDeleteRef\.current === null && lastDismissRef\.current === null\) setCashflow\(fresh\)/, "refetch applies only when nothing else is pending");
const undo = body(planning, "function undoPlannedDelete()", 700);
assert.match(undo, /lastPlannedDeleteRef\.current = null/, "undo restores the one pending delete once");
assert.match(planning, /setTimeout\(\(\) => \{ setUndoBar\(null\); lastDismissRef\.current = null; \}, 6000\)/);

console.log("g421-cancel-refresh: ok");
