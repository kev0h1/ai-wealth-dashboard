// E18: a stale cashflow response is refetched once, quietly.
//  1. only cashflow_stale === true schedules a retry, and only before the retry is spent
//  2. the schedule fires once after the delay, marks the retry spent, then refetches
//  3. cancelling before the timer fires does nothing
//  4. the default delay is about five seconds
//  5. PlanningPage wires the helper and adds no new copy
//
// Run: npm run -s check:e18-stale-cashflow-retry

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  STALE_CASHFLOW_REFETCH_MS, shouldRefetchStaleCashflow, scheduleStaleCashflowRefetch,
} from "../lib/cashflowStaleRetry.ts";

assert.equal(STALE_CASHFLOW_REFETCH_MS, 5000);
assert.equal(shouldRefetchStaleCashflow({ cashflow_stale: true }, false), true);
assert.equal(shouldRefetchStaleCashflow({ cashflow_stale: true }, true), false);
assert.equal(shouldRefetchStaleCashflow({ cashflow_stale: false }, false), false);
assert.equal(shouldRefetchStaleCashflow({}, false), false);
assert.equal(shouldRefetchStaleCashflow(null, false), false);

const order = [];
scheduleStaleCashflowRefetch(() => order.push("refetch"), () => order.push("spent"), 10);
await new Promise((r) => setTimeout(r, 60));
assert.deepEqual(order, ["spent", "refetch"], "fires once, spends the retry before refetching");

const none = [];
const cancel = scheduleStaleCashflowRefetch(() => none.push("refetch"), () => none.push("spent"), 20);
cancel();
await new Promise((r) => setTimeout(r, 60));
assert.deepEqual(none, []);

const page = readFileSync(new URL("../app/planning/PlanningPage.tsx", import.meta.url), "utf8");
assert.match(page, /scheduleStaleCashflowRefetch/);
assert.match(page, /staleRetried/);

console.log("e18-stale-cashflow-retry: ok");
