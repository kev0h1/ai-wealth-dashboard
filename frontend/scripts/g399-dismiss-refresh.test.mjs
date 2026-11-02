// G399: every skip / clear / edit control awaits the API and then refreshes
// its owner, and HomeBrief's optimistic skip keeps its revert branch.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const brief = read("components/HomeBrief.tsx");
const planning = read("app/planning/PlanningPage.tsx");
const editForm = read("components/UpcomingEditForm.tsx");
const editorSupport = read("components/upcoming/editorSupport.tsx");
const detailFlow = read("components/upcoming/UpcomingDetailFlow.tsx");

function body(src, startMarker, length = 1800) {
  const i = src.indexOf(startMarker);
  assert.ok(i >= 0, `missing ${startMarker}`);
  return src.slice(i, i + length);
}

// HomeBrief unfunded-moves card: awaited, then onRefresh; revert kept.
const unfunded = body(brief, "async function handleSkip(move: UnfundedMoveEntry)");
assert.match(unfunded, /await api\.skipUpcomingOccurrence\(/, "unfunded skip must await the API");
assert.ok(unfunded.indexOf("await api.skipUpcomingOccurrence(") < unfunded.indexOf("await onRefresh?.()"), "onRefresh runs after the awaited skip");
assert.match(unfunded, /catch \{[\s\S]*setMoves\(prev =>[\s\S]*if \(collapses\) setHidden\(false\)/, "revert branch kept");
assert.match(unfunded, /setMoves\(remaining\)/, "optimistic removal kept");
assert.doesNotMatch(unfunded, /api\.skipUpcomingOccurrence\([^)]*\)\.catch/, "no fire-and-forget skip");
assert.match(brief, /<UnfundedMoveCard [^>]*onRefresh=\{onRefresh\}/, "BriefBody passes onRefresh to the unfunded card");

// MoveCard.
const move = body(brief, "async function handleSkip(bill: PlanDestBill)");
assert.ok(move.indexOf("await api.skipUpcomingOccurrence(") < move.indexOf("await onRefresh?.()"));

// Upcoming's own skip refetches the cashflow after the API resolves.
const upcoming = body(planning, "function skipOccurrence(", 1400);
assert.ok(upcoming.indexOf("api.skipUpcomingOccurrence(") < upcoming.indexOf(".then("));
assert.match(upcoming, /api\.cashflowWithForecast\(\)\.then\(setCashflow\)/);

// Edit sheet: operation awaited, then onSaved (the owner's refresh), then close.
assert.match(editForm, /request\.run\(operation, onDone \?\? onCancel, undefined, onSaved\)/);
for (const call of ["services.editUpcoming(", "services.clearUpcomingOverride(", "services.skipUpcomingOccurrence("]) {
  assert.match(editForm, new RegExp(`mutate\\(\\(\\) => ${call.replace(/[().]/g, "\\$&")}`), `${call} goes through mutate`);
}
const run = body(editorSupport, "async function run(", 1400);
assert.ok(run.indexOf("await operation()") < run.indexOf("await current.refresh()"));
assert.match(detailFlow, /async function saved\(\) \{ await props\.onRefresh\(\); \}/);
assert.match(planning, /onSaved=\{\(\) => \{ api\.cashflowWithForecast\(\)\.then\(setCashflow\)/);

console.log("g399-dismiss-refresh: ok");
