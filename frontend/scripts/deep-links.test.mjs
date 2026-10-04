// A68: the deep-link contract, parser and global dispatcher. Plain Node.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as dl from "../lib/deepLinks.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..", "..");
const contract = JSON.parse(readFileSync(path.join(root, "shared", "deep-links.json"), "utf8"));

// Constants equal the shared contract.
assert.equal(dl.DEEP_LINK_SCHEME, contract.scheme);
assert.equal(dl.SIGNIN_PATH, contract.paths.signin);
assert.equal(dl.BANK_CONNECTED_PATH, contract.paths.bank_connected);
assert.equal(dl.QUERY_PROVIDER, contract.query.provider);
assert.equal(dl.QUERY_CONNECTION, contract.query.connection);
assert.equal(dl.QUERY_STATUS, contract.query.status);
// Frozen for installed binaries.
assert.equal(dl.SIGNIN_PATH, "auth-done");
assert.equal(dl.BANK_CONNECTED_PATH, "auth-complete");

// Parsing.
assert.deepEqual(dl.parseDeepLink("wealthdash://auth-done"), { kind: "signin" });
assert.deepEqual(dl.parseDeepLink("wealthdash://auth-complete"), { kind: "bank_connected" });
assert.deepEqual(dl.parseDeepLink("wealthdash://auth-complete/"), { kind: "bank_connected" });
assert.deepEqual(dl.parseDeepLink("wealthdash:///auth-complete?x"), { kind: "bank_connected" });
assert.deepEqual(dl.parseDeepLink("WEALTHDASH://AUTH-COMPLETE"), { kind: "bank_connected" });
assert.deepEqual(
  dl.parseDeepLink("wealthdash://auth-complete?provider=finexer&connection=cst_1&status=ok"),
  { kind: "bank_connected", provider: "finexer", connection: "cst_1", status: "ok" },
);
assert.deepEqual(
  dl.parseDeepLink("wealthdash://auth-complete?provider=truelayer&connection=c%26d&status=error"),
  { kind: "bank_connected", provider: "truelayer", connection: "c&d", status: "error" },
);
assert.equal(dl.parseDeepLink("wealthdash://auth-complete?status=weird").status, undefined);
for (const bad of ["", "https://example.com/auth-done", "wealthdash://other", "otherscheme://auth-done", "auth-done"]) {
  assert.equal(dl.parseDeepLink(bad).kind, "unknown", bad);
}

// Dispatch.
class FakeTarget {
  events = [];
  dispatchEvent(e) { this.events.push(e); return true; }
}
globalThis.CustomEvent ??= class { constructor(type, init) { this.type = type; this.detail = init?.detail; } };
let closes = 0;
const closer = async () => { closes += 1; };
const t = new FakeTarget();
const detail = dl.dispatchDeepLink("wealthdash://auth-complete?provider=finexer&connection=cst_1&status=ok", t, closer);
assert.equal(t.events.length, 1);
assert.equal(t.events[0].type, dl.DEEP_LINK_EVENT);
assert.equal(dl.DEEP_LINK_EVENT, "wd:deeplink");
assert.deepEqual(t.events[0].detail, { kind: "bank_connected", provider: "finexer", connection: "cst_1", status: "ok" });
assert.deepEqual(detail, t.events[0].detail);
assert.equal(closes, 1);
dl.dispatchDeepLink("wealthdash://nothing", t, closer);
dl.dispatchDeepLink("https://example.com", t, closer);
assert.equal(t.events.length, 1);
assert.equal(closes, 1);

// Source guards.
const layout = readFileSync(path.join(here, "..", "app", "layout.tsx"), "utf8");
assert.match(layout, /<DeepLinkHandler \/>/);
const loop = readFileSync(path.join(here, "..", "lib", "mobileLoginLoop.ts"), "utf8");
assert.ok(loop.includes("AUTH_RETURN_URL"));

console.log("check:deep-links ok");
