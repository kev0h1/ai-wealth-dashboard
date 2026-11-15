// G473: the app install id is created once, persisted, reused, and sent with
// both native push registrations (and never cleared by sign-out).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { getInstallId, INSTALL_ID_STORAGE_KEY } from "../lib/installId.ts";

const memory = () => {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => void m.set(k, v), m };
};

const store = memory();
const first = getInstallId(store);
assert.ok(first && /^[A-Za-z0-9_-]{8,64}$/.test(first), "an id is created");
assert.equal(store.m.get(INSTALL_ID_STORAGE_KEY), first, "and persisted");
assert.equal(getInstallId(store), first, "reused, never recreated");
assert.equal(getInstallId(store), first);

const other = memory();
assert.notEqual(getInstallId(other), first, "a different install gets a different id");

const broken = memory();
broken.m.set(INSTALL_ID_STORAGE_KEY, "x");
assert.notEqual(getInstallId(broken), "x", "a malformed stored id is replaced");

assert.equal(getInstallId(null), null, "no storage: nothing is sent");
const throwing = { getItem() { throw new Error("denied"); }, setItem() { throw new Error("denied"); } };
assert.equal(getInstallId(throwing), null, "storage errors never throw");

const api = readFileSync(new URL("../lib/api.ts", import.meta.url), "utf8");
for (const name of ["registerApnsToken", "registerFcmToken"]) {
  const at = api.indexOf(`${name}: (token`);
  assert.ok(at > 0, `${name} exists`);
  const block = api.slice(at, at + 400);
  assert.ok(block.includes("install_id: getInstallId()"), `${name} sends install_id`);
}
const push = readFileSync(new URL("../lib/capacitorPush.ts", import.meta.url), "utf8");
assert.ok(!push.includes(INSTALL_ID_STORAGE_KEY) && !push.includes("wd_install_id"), "sign-out code never touches the install id");
console.log("g473-install-id: ok");
