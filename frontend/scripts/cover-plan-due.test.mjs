// Run: npm run -s check:cover-plan-due
import assert from "node:assert/strict";
import { coverPlanSummary, coverPlanProtectsHeader } from "../lib/coverPlanDue.ts";

const one = { needs_by: "Thursday", needs_by_last: "Thursday", needs_by_date: "2026-10-01", needs_by_last_date: "2026-10-01" };
assert.equal(coverPlanSummary(one, 1), "Payment due Thursday");

assert.equal(coverPlanSummary(one, 4), "4 payments due by Thursday");
assert.equal(coverPlanProtectsHeader(one, 4), "Due by Thursday");

const range = { ...one, needs_by_last: "29 Oct", needs_by_last_date: "2026-10-29" };
assert.equal(coverPlanSummary(range, 4), "4 payments, first due Thursday");
assert.equal(coverPlanProtectsHeader(range, 4), "First due Thursday, last due 29 Oct");

// Older cached plans without the new fields keep the previous copy.
const legacy = { needs_by: "Thursday" };
assert.equal(coverPlanSummary(legacy, 4), "4 payments due by Thursday");
assert.equal(coverPlanProtectsHeader(legacy, 4), "Due by Thursday");
console.log("cover-plan-due: ok");
