// A108: bank consent return handling, landing helper, and source guards. Plain Node.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { handleBankConnectReturn } from "../lib/bankConnectReturn.ts";
import { findLandedAccount, SYNC_POLL_TIMEOUT_MS } from "../lib/syncLanding.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (p) => readFileSync(path.join(here, "..", p), "utf8");

function run(detail, sheetOpen = false) {
  const calls = [];
  handleBankConnectReturn(detail, { push: (h) => calls.push(["push", h]) }, () => calls.push(["invalidate"]), sheetOpen);
  return calls;
}

assert.deepEqual(run({ kind: "bank_connected", provider: "finexer", connection: "cst_1", status: "ok" }), [
  ["invalidate"],
  ["push", "/accounts?syncing=1&connection=cst_1"],
]);
assert.deepEqual(run({ kind: "bank_connected", connection: "a b&c", status: "ok" }), [
  ["invalidate"],
  ["push", "/accounts?syncing=1&connection=a%20b%26c"],
]);
assert.deepEqual(run({ kind: "bank_connected", status: "error" }), [["push", "/accounts?connect=cancelled"]]);
assert.deepEqual(run({ kind: "bank_connected", status: "error" }, true), []);
assert.deepEqual(run({ kind: "signin" }), []);
assert.deepEqual(run({ kind: "unknown" }), []);

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
assert.ok(/finexerConnectLink\(bank\.id, native\)/.test(sheet) && /legacyBankConnectLink\(bank\.id, native\)/.test(sheet));
assert.ok(sheet.includes("isNativePlatform()"));
assert.ok(sheet.includes("browserFinished"));
const hrefAt = sheet.indexOf("window.location.href = auth_url");
assert.ok(hrefAt > sheet.indexOf("} else {", sheet.indexOf("Browser.open")), "full-page redirect only in the web branch");
assert.equal(sheet.split("window.location.href = auth_url").length, 2);
assert.ok(!sheet.includes("A139") || sheet.includes("never return the plugin proxy"));
const api = read("lib/api.ts");
assert.ok(api.includes('q.push("native=1")'));
assert.ok(read("app/components/AccountsPage.tsx").includes("findLandedAccount("));
assert.ok(read("components/DeepLinkHandler.tsx").includes("handleBankConnectReturn"));
console.log("bank-connect-return ok");
