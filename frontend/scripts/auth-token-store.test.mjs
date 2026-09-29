// A123: unit test for lib/auth.ts token storage. Fake SecureStorage and fake
// localStorage injected through the test seam; no Capacitor, no network.
//   npm run -s check:auth-token-store
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as auth from "../lib/auth.ts";

const KEY = "wealth_session_token";
let failures = 0;
async function t(name, fn) {
  try { await fn(); console.log("ok  " + name); }
  catch (e) { failures++; console.error("FAIL " + name + "\n  " + (e && e.stack || e)); }
}

function fakeStorage(init = {}) {
  const m = new Map(Object.entries(init));
  return { m, getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { m.set(k, String(v)); }, removeItem: (k) => { m.delete(k); } };
}
function fakeSecure(init = {}, opts = {}) {
  const m = new Map(Object.entries(init));
  const calls = [];
  return {
    m, calls,
    async get(k) { calls.push(["get", k]); if (opts.getThrows) throw new Error("boom"); if (opts.getHangs) return new Promise(() => {}); return m.has(k) ? m.get(k) : null; },
    async set(k, v, cd, sync, access) { calls.push(["set", k, v, sync, access]); if (opts.setThrows) throw new Error("boom"); if (!opts.setDropped) m.set(k, v); },
    async remove(k) { calls.push(["remove", k]); const had = m.delete(k); return had; },
  };
}
function setup({ native, secure, storage, timeoutMs = 50 }) {
  let loads = 0;
  auth.__configureTokenStoreForTests({
    isNative: () => native,
    loadSecure: async () => { loads++; return secure; },
    storage: () => storage,
    timeoutMs,
  });
  return { loads: () => loads };
}

await t("(a) web never touches secure storage, reads/writes localStorage", async () => {
  const secure = fakeSecure(); const storage = fakeStorage({ [KEY]: "web1" });
  const s = setup({ native: false, secure, storage });
  await auth.hydrateToken();
  assert.equal(auth.getToken(), "web1");
  await auth.setTokenAsync("web2");
  assert.equal(storage.m.get(KEY), "web2");
  auth.clearToken(); await auth.__tokenWritesSettled();
  assert.equal(storage.m.has(KEY), false);
  assert.equal(secure.calls.length, 0);
  assert.equal(s.loads(), 0);
});

await t("(b) native hydrate: secure hit", async () => {
  const secure = fakeSecure({ [KEY]: "sec1" }); const storage = fakeStorage();
  setup({ native: true, secure, storage });
  assert.equal(auth.getToken(), null); // before hydrate
  await auth.hydrateToken();
  assert.equal(auth.getToken(), "sec1");
});

await t("(c) migration: legacy -> secure, read-back verified, then localStorage removed", async () => {
  const secure = fakeSecure(); const storage = fakeStorage({ [KEY]: "old" });
  setup({ native: true, secure, storage });
  await auth.hydrateToken();
  assert.equal(auth.getToken(), "old");
  assert.equal(secure.m.get(KEY), "old");
  assert.equal(storage.m.has(KEY), false);
  const setCall = secure.calls.find((c) => c[0] === "set");
  assert.equal(setCall[3], false, "sync off");
  assert.equal(setCall[4], 1, "WhenUnlockedThisDeviceOnly");
  const order = secure.calls.map((c) => c[0]);
  assert.ok(order.lastIndexOf("get") > order.indexOf("set"), "read-back after write");
});

await t("(c2) migration: read-back mismatch keeps legacy copy", async () => {
  const secure = fakeSecure({}, { setDropped: true }); const storage = fakeStorage({ [KEY]: "old" });
  setup({ native: true, secure, storage });
  await auth.hydrateToken();
  assert.equal(auth.getToken(), "old");
  assert.equal(storage.m.get(KEY), "old");
});

await t("(d) failed secure.set leaves localStorage intact, token still in memory", async () => {
  const secure = fakeSecure({}, { setThrows: true }); const storage = fakeStorage({ [KEY]: "old" });
  setup({ native: true, secure, storage });
  await auth.hydrateToken();
  assert.equal(auth.getToken(), "old");
  assert.equal(storage.m.get(KEY), "old");
});

await t("(e) setToken is sync-correct; setTokenAsync awaits the secure write; native never writes localStorage", async () => {
  const secure = fakeSecure(); const storage = fakeStorage();
  setup({ native: true, secure, storage });
  await auth.hydrateToken();
  auth.setToken("n1");
  assert.equal(auth.getToken(), "n1");
  await auth.__tokenWritesSettled();
  assert.equal(secure.m.get(KEY), "n1");
  const ok = await auth.setTokenAsync("n2");
  assert.equal(ok, true);
  assert.equal(secure.m.get(KEY), "n2");
  assert.equal(auth.getToken(), "n2");
  assert.equal(storage.m.has(KEY), false);
});

await t("(f) clearToken clears memory + secure + legacy key", async () => {
  const secure = fakeSecure({ [KEY]: "x" }); const storage = fakeStorage({ [KEY]: "x" });
  setup({ native: true, secure, storage });
  await auth.hydrateToken();
  auth.clearToken();
  assert.equal(auth.getToken(), null);
  await auth.__tokenWritesSettled();
  assert.equal(secure.m.has(KEY), false);
  assert.equal(storage.m.has(KEY), false);
});

await t("(g) read error -> signed out, no localStorage fallback", async () => {
  const secure = fakeSecure({}, { getThrows: true }); const storage = fakeStorage({ [KEY]: "old" });
  setup({ native: true, secure, storage });
  await auth.hydrateToken();
  assert.equal(auth.getToken(), null);
  assert.equal(storage.m.get(KEY), "old", "legacy value untouched");
});

await t("(g2) read timeout -> signed out, no localStorage fallback", async () => {
  const secure = fakeSecure({}, { getHangs: true }); const storage = fakeStorage({ [KEY]: "old" });
  setup({ native: true, secure, storage, timeoutMs: 20 });
  await auth.hydrateToken();
  assert.equal(auth.getToken(), null);
});

await t("(h) hydrate idempotent; concurrent calls share one promise", async () => {
  const secure = fakeSecure({ [KEY]: "s" }); const storage = fakeStorage();
  setup({ native: true, secure, storage });
  const p1 = auth.hydrateToken(); const p2 = auth.hydrateToken();
  assert.equal(p1, p2);
  await Promise.all([p1, p2]); await auth.hydrateToken();
  assert.equal(secure.calls.filter((c) => c[0] === "get").length, 1);
});

await t("(i) a setToken during a slow hydrate is not overwritten by it", async () => {
  const storage = fakeStorage();
  let release;
  const secure = fakeSecure();
  secure.get = () => new Promise((r) => { release = () => r("stale"); });
  setup({ native: true, secure, storage, timeoutMs: 1000 });
  const h = auth.hydrateToken();
  await new Promise((r) => setTimeout(r, 5));
  auth.setToken("fresh");
  release(); await h;
  assert.equal(auth.getToken(), "fresh");
});

await t("static guard: the storage key appears only in lib/auth.ts", () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const skip = new Set(["node_modules", ".next", ".next-prev", "scripts", "out", ".git"]);
  const hits = [];
  (function walk(dir) {
    for (const n of readdirSync(dir)) {
      if (skip.has(n)) continue;
      const p = path.join(dir, n);
      const st = statSync(p);
      if (st.isDirectory()) walk(p);
      else if (/\.(ts|tsx|js|jsx|mjs)$/.test(n) && readFileSync(p, "utf8").includes(KEY)) hits.push(path.relative(root, p));
    }
  })(root);
  assert.deepEqual(hits, ["lib/auth.ts"]);
});

if (failures) { console.error(failures + " failed"); process.exit(1); }
console.log("auth-token-store: all passed");
