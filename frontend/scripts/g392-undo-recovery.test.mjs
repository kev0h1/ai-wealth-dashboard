// G392/G453: correction writes and Undo are atomic server operations. Keep
// retry intent on the client, but never recreate the previous staged Undo.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const frontend = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sheet = await readFile(path.join(frontend, "components/TeachingSheet.tsx"), "utf8");

assert.match(sheet, /async function saveCorrection\(\)/, "scoped correction has one save path");
assert.match(sheet, /await api\.applyCorrection\(/, "save waits for the durable server result");
assert.match(sheet, /const request = pendingRequest \?\?/, "retry keeps the original operation id");
assert.match(sheet, /async function undoCorrection\(\)/, "Undo has one server-owned path");
assert.match(sheet, /await api\.undoCorrection\(/, "Undo waits for the server snapshot restore");
assert.match(sheet, /restored\.restored_categories/, "Undo notifies the exact restored categories");
const saveStart = sheet.indexOf("async function saveCorrection()");
const saveEnd = sheet.indexOf("async function undoCorrection()");
const saveBody = sheet.slice(saveStart, saveEnd);
assert.ok(saveStart >= 0 && saveEnd > saveStart, "the scoped save body is present");
assert.ok(saveBody.indexOf("setPendingRequest(request)") < saveBody.indexOf("await api.applyCorrection"), "retry intent is retained before an unknown write outcome");
assert.match(saveBody, /if \(cause instanceof ApiError && cause\.status < 500\)\s*\{\s*setPendingRequest\(null\)/, "only a definitive client error clears retry intent");
assert.doesNotMatch(sheet, /runTeachingUndoStages|undoInFlight|undoStarted|setTimeout\([^)]*5000/, "there is no client-side staged or expiring Undo");
assert.doesNotMatch(sheet, /propose-rule|movement-destination/, "automatic propagation and destination naming are removed");
assert.doesNotMatch(sheet, /text-red-600 dark:text-red-400" role="alert">\{error\}/, "ordinary write errors are neutral, not financial-risk red");

console.log("G392/G453 server Undo recovery checks passed");
