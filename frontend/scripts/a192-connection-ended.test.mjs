// A192: an account whose bank connection has ended is not counted in Left to spend,
// keeps its last balance visible, and says so quietly (no em dash, no red).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { CONNECTION_ENDED_NOT_COUNTED, CONNECTION_ENDED_TAG, connectionEnded, isCountedInLeftToSpend } from "../lib/accountCounted.ts";
import { accountAvailability } from "../lib/accountAvailability.ts";

assert.equal(connectionEnded({ status: "expired" }), true);
assert.equal(connectionEnded({ status: "connected" }), false);
assert.equal(isCountedInLeftToSpend({ status: "connected" }), true);
assert.equal(isCountedInLeftToSpend({ status: "expired" }), false);
assert.equal(isCountedInLeftToSpend({ status: "connected", include_in_safe_to_spend: false }), false);
assert.equal(isCountedInLeftToSpend({ status: "connected", counted_in_left_to_spend: false }), false);
assert.equal(isCountedInLeftToSpend({ status: "connected", counted_in_left_to_spend: true, include_in_safe_to_spend: true }), true);

for (const copy of [CONNECTION_ENDED_NOT_COUNTED, CONNECTION_ENDED_TAG]) assert.ok(!copy.includes("—"), "no em dash");
assert.equal(CONNECTION_ENDED_NOT_COUNTED, "Connection ended, not counted in Left to spend");

const account = { id: "a", name: "A", type: "bank", subtype: "TRANSACTION", currency: "GBP", balance: 5000, status: "expired", provider: "x" };
assert.equal(accountAvailability(account, { status: "ready", positions: {} }), undefined, "no availability for an ended connection");

const row = readFileSync(new URL("../components/AccountLedgerRow.tsx", import.meta.url), "utf8");
assert.match(row, /data-a192-connection-ended/, "row carries the quiet tag");
assert.ok(!/data-a192-connection-ended[^>]*(rose|red)-/.test(row), "the tag is never red");
const page = readFileSync(new URL("../app/components/AccountsPage.tsx", import.meta.url), "utf8");
assert.match(page, /CONNECTION_ENDED_NOT_COUNTED/, "account page shows the line");
console.log("a192-connection-ended: ok");
