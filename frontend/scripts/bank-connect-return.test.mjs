// A108: bank consent return handling, landing helper, and source guards. Plain Node.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  handleBankConnectReturn, resetBankReturnDedupe, registerBankSheet,
  stashPendingReturn, takePendingReturn, PENDING_BANK_RETURN_KEY, PENDING_BANK_RETURN_TTL_MS, bankSheetState,
} from "../lib/bankConnectReturn.ts";
import { launchMode, buildLinkQuery } from "../lib/bankConsentLaunch.ts";
import { findLandedAccount, SYNC_POLL_TIMEOUT_MS } from "../lib/syncLanding.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (p) => readFileSync(path.join(here, "..", p), "utf8");

function run(detail, extra = {}) {
  resetBankReturnDedupe();
  const calls = [];
  handleBankConnectReturn(detail, { push: (h) => calls.push(["push", h]) }, {
    invalidate: () => calls.push(["invalidate"]), sheetOpen: false, stay: false, ...extra,
  });
  return calls;
}
const ok = { kind: "bank_connected", provider: "finexer", connection: "cst_1", status: "ok" };

assert.deepEqual(run(ok), [["invalidate"], ["push", "/accounts?syncing=1&connection=cst_1"]]);
assert.deepEqual(run({ ...ok, connection: "a b&c" }), [["invalidate"], ["push", "/accounts?syncing=1&connection=a%20b%26c"]]);
assert.deepEqual(run({ kind: "bank_connected", status: "error" }), [["push", "/accounts?connect=cancelled"]]);
assert.deepEqual(run({ kind: "bank_connected", status: "error" }, { sheetOpen: true }), []);
assert.deepEqual(run({ kind: "signin" }), []);
assert.deepEqual(run({ kind: "unknown" }), []);
// Mid-onboarding: refresh, never navigate.
assert.deepEqual(run(ok, { stay: true }), [["invalidate"]]);

// Idempotent for 10 s per connection, then allowed again.
{
  resetBankReturnDedupe();
  const calls = [];
  let t = 1000;
  const o = { invalidate: () => calls.push("i"), sheetOpen: false, stay: false, now: () => t };
  const r = { push: (h) => calls.push(h) };
  handleBankConnectReturn(ok, r, o);
  handleBankConnectReturn(ok, r, o);
  assert.equal(calls.length, 2);
  handleBankConnectReturn({ ...ok, connection: "other" }, r, o);
  assert.equal(calls.length, 4);
  t += 10_001;
  handleBankConnectReturn(ok, r, o);
  assert.equal(calls.length, 6);
}

// Signed out: stash instead of navigating, then replay once.
{
  const store = new Map();
  const storage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v), removeItem: (k) => store.delete(k) };
  assert.deepEqual(run(ok, { hasToken: () => false, storage }), []);
  assert.ok(store.has(PENDING_BANK_RETURN_KEY));
  const pending = takePendingReturn(storage);
  assert.deepEqual(pending, ok);
  assert.equal(takePendingReturn(storage), null);
  assert.deepEqual(run(pending, { hasToken: () => true, storage }), [["invalidate"], ["push", "/accounts?syncing=1&connection=cst_1"]]);
  storage.setItem(PENDING_BANK_RETURN_KEY, "not json");
  assert.equal(takePendingReturn(storage), null);
  stashPendingReturn(null, ok); // no storage: no throw
}

// D6: a stashed return replays within 10 s WITHOUT resetting the dedupe map.
{
  resetBankReturnDedupe();
  const store = new Map();
  const storage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v), removeItem: (k) => store.delete(k) };
  const calls = [];
  const r = { push: (h) => calls.push(h) };
  let t = 5000;
  handleBankConnectReturn(ok, r, { invalidate: () => {}, sheetOpen: false, stay: false, hasToken: () => false, storage, now: () => t });
  assert.deepEqual(calls, []);
  t += 5000;
  const pending = takePendingReturn(storage, t);
  assert.deepEqual(pending, ok);
  handleBankConnectReturn(pending, r, { invalidate: () => {}, sheetOpen: false, stay: false, hasToken: () => true, now: () => t });
  assert.deepEqual(calls, ["/accounts?syncing=1&connection=cst_1"]);
}

// D7: the stash expires after 15 minutes and is cleared.
{
  const store = new Map();
  const storage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v), removeItem: (k) => store.delete(k) };
  stashPendingReturn(storage, ok, 1000);
  assert.deepEqual(takePendingReturn(storage, 1000 + PENDING_BANK_RETURN_TTL_MS), ok);
  stashPendingReturn(storage, ok, 1000);
  assert.equal(takePendingReturn(storage, 1000 + PENDING_BANK_RETURN_TTL_MS + 1), null);
  assert.equal(store.has(PENDING_BANK_RETURN_KEY), false);
}

// D8: the registry snapshot carries the stay flag synchronously.
{
  assert.deepEqual(bankSheetState(), { sheetOpen: false, stay: false });
  const off = registerBankSheet({ stayOnReturn: true });
  const snap = bankSheetState();
  off();
  assert.deepEqual(snap, { sheetOpen: true, stay: true });
  resetBankReturnDedupe();
  const calls = [];
  // Snapshot says stay even though the sheet has since unregistered.
  handleBankConnectReturn(ok, { push: (h) => calls.push(h) }, { invalidate: () => calls.push("i"), ...snap });
  assert.deepEqual(calls, ["i"]);
}

// Sheet registry accepts the stay flag and unregisters cleanly.
{
  const off = registerBankSheet({ stayOnReturn: true });
  resetBankReturnDedupe();
  const calls = [];
  handleBankConnectReturn(ok, { push: (h) => calls.push(h) }, { invalidate: () => calls.push("i") });
  assert.deepEqual(calls, ["i"]);
  off();
  resetBankReturnDedupe();
  handleBankConnectReturn(ok, { push: (h) => calls.push(h) }, { invalidate: () => calls.push("i") });
  assert.deepEqual(calls.slice(1), ["i", "/accounts?syncing=1&connection=cst_1"]);
}

// Launch decision.
assert.equal(launchMode(true, false), "browser");
assert.equal(launchMode(true, true), "browser");
assert.equal(launchMode(false, true), "rn");
assert.equal(launchMode(false, false), "location");
assert.deepEqual(buildLinkQuery(true), { native: true });
assert.deepEqual(buildLinkQuery(false), { native: false });

const accs = [{ id: "a1", connection_id: "c1" }, { id: "a2", connection_id: "c2" }];
assert.equal(findLandedAccount(accs, "c2").id, "a2");
assert.equal(findLandedAccount(accs, "c9"), undefined);
assert.equal(findLandedAccount([], "c1"), undefined);
assert.equal(findLandedAccount(accs, null).id, "a1");
assert.equal(findLandedAccount(accs).id, "a1");
assert.equal(findLandedAccount([], null), undefined);
assert.equal(SYNC_POLL_TIMEOUT_MS, 180000);

// Source guards.
const sheet = read("components/BankPickerSheet.tsx");
assert.ok(sheet.includes("Browser.open({ url: auth_url })"), "native consent opens in the in-app browser");
assert.ok(sheet.includes("launchMode(") && sheet.includes("buildLinkQuery(") && sheet.includes("stayOnReturn"));
assert.ok(/finexerConnectLink\(bank\.id, native\)/.test(sheet) && /legacyBankConnectLink\(bank\.id, native\)/.test(sheet));
assert.ok(sheet.includes("isNativePlatform()"));
assert.ok(read("lib/useBankReturnReset.ts").includes("browserFinished"), "A149: the shared hook owns browserFinished");
const hrefAt = sheet.indexOf("window.location.href = auth_url");
assert.ok(hrefAt > sheet.indexOf("} else {", sheet.indexOf("Browser.open")), "full-page redirect only in the web branch");
// onConnecting is not called before the native Browser.open (single native call site is the return handler).
const linkAt = sheet.indexOf("await api.finexerConnectLink");
const browserBranch = sheet.slice(sheet.indexOf('mode === "browser"', linkAt), sheet.indexOf('mode === "rn"', linkAt));
assert.ok(!browserBranch.includes("onConnecting"), "no onConnecting on the native branch");
assert.ok(read("components/DeepLinkHandler.tsx").includes("bankSheetState()"));
assert.ok(read("components/Onboarding.tsx").includes("stayOnReturn"));
assert.ok(read("components/AuthProvider.tsx").includes("wd:session-established"));
assert.equal(sheet.split("window.location.href = auth_url").length, 2);
assert.ok(!sheet.includes("A139") || sheet.includes("never return the plugin proxy"));
const api = read("lib/api.ts");
assert.ok(api.includes('q.push("native=1")'));
assert.ok(read("app/components/AccountsPage.tsx").includes("findLandedAccount("));
assert.ok(read("components/DeepLinkHandler.tsx").includes("handleBankConnectReturn"));
console.log("bank-connect-return ok");
