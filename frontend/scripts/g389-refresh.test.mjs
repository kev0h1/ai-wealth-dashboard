import assert from "node:assert/strict";
import {
  accountsFreshness,
  advancedTimestampSignature,
  isRefreshEligible,
  refreshBaseline,
  refreshCooldown,
  refreshProgress,
} from "../lib/accountsOverviewRefresh.ts";

const now = Date.parse("2026-11-02T12:00:00Z");
const bank = (over = {}) => ({
  id: "bank-1", name: "Main", type: "transaction", balance: 1, currency: "GBP", provider: "Monzo",
  connection_id: "connection-1", bank_synced_to: "2026-11-02T10:00:00Z", ...over,
});

// Only live, unpaused accounts are refresh targets.
assert.equal(isRefreshEligible(bank()), true);
assert.equal(isRefreshEligible(bank({ manual: true })), false);
assert.equal(isRefreshEligible(bank({ id: "statement-1" })), false);
assert.equal(isRefreshEligible(bank({ paused: true })), false);

// A186 balance-only accounts have no setter work to confirm. A pot must not
// leave an otherwise completed overview refresh waiting for its timeout.
assert.equal(isRefreshEligible(bank({ balance_only: true })), false);
const pot = bank({ id: "pot", balance_only: true, bank_synced_to: null });
const mixedBaseline = refreshBaseline([bank(), pot]);
assert.deepEqual([...mixedBaseline.keys()], ["bank-1"]);
assert.equal(refreshProgress([bank({ bank_synced_to: "2026-11-02T10:01:00Z" }), pot], mixedBaseline), "updated");
assert.equal(refreshCooldown([bank({ bank_next_refresh_at: "2026-11-02T12:30:00Z" }), pot], now), Date.parse("2026-11-02T12:30:00Z"));

// Freshness includes paused banks, but never transaction download times.
assert.match(accountsFreshness([bank(), bank({ id: "paused", paused: true, bank_synced_to: "2026-11-02T09:00:00Z" })], now), /3 hours ago/);
assert.match(accountsFreshness([bank({ bank_synced_to: null, transactions_synced_at: "2026-11-02T11:00:00Z" })], now), /not reported/);

// Every eligible bank must be cooled down before the overview control is gated.
assert.equal(refreshCooldown([bank({ bank_next_refresh_at: "2026-11-02T12:30:00Z" }), bank({ id: "bank-2" })], now), null);
assert.equal(refreshCooldown([bank({ bank_next_refresh_at: "2026-11-02T12:30:00Z" }), bank({ id: "bank-2", bank_next_refresh_at: "2026-11-02T12:45:00Z" })], now), Date.parse("2026-11-02T12:30:00Z"));

// Accepted work is not completion. Only changed bank as-of times confirm it.
const baseline = refreshBaseline([bank(), bank({ id: "bank-2" })]);
assert.equal(refreshProgress([bank(), bank({ id: "bank-2" })], baseline), "waiting");
assert.equal(refreshProgress([bank({ bank_synced_to: "2026-11-02T10:01:00Z" }), bank({ id: "bank-2" })], baseline), "partial");
assert.equal(refreshProgress([bank({ bank_synced_to: "2026-11-02T10:01:00Z" }), bank({ id: "bank-2", bank_synced_to: "2026-11-02T10:02:00Z" })], baseline), "updated");
assert.equal(advancedTimestampSignature([bank({ bank_synced_to: "bad" }), bank({ id: "bank-2" })], baseline), "");

console.log("g389 refresh helpers: ok");
