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
function setup({ native, secure, storage, timeoutMs = 50, pluginImplemented = true }) {
  let loads = 0;
  auth.__configureTokenStoreForTests({
    isNative: () => native,
    loadSecure: async () => { loads++; return secure; },
    pluginImplemented: () => pluginImplemented,
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
  await auth.hydrateToken(); await auth.__tokenWritesSettled();
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
  await auth.hydrateToken(); await auth.__tokenWritesSettled();
  assert.equal(auth.getToken(), "old");
  assert.equal(storage.m.get(KEY), "old");
});

await t("(d) failed secure.set leaves localStorage intact, token still in memory", async () => {
  const secure = fakeSecure({}, { setThrows: true }); const storage = fakeStorage({ [KEY]: "old" });
  setup({ native: true, secure, storage });
  await auth.hydrateToken(); await auth.__tokenWritesSettled();
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


// Controllable latency: every set/get/remove waits on a deferred the test releases.
function slowSecure(init = {}) {
  const m = new Map(Object.entries(init));
  const pending = [];
  const gate = (fn) => new Promise((resolve) => pending.push(() => resolve(fn())));
  return {
    m, pending,
    get: (k) => { const snap = m.has(k) ? m.get(k) : null; return gate(() => snap); }, // value as of call time (a slow read)
    set: (k, v) => gate(() => { m.set(k, v); }),
    remove: (k) => gate(() => m.delete(k)),
    async flush() { // release the MOST RECENTLY started operation first (worst-case reordering), until quiet
      for (let i = 0; i < 50; i++) {
        await new Promise((r) => setTimeout(r, 2));
        const next = pending.pop();
        if (next) next(); else if (i > 5) return;
      }
    },
  };
}

await t("(j) slow set then clearToken leaves the store empty", async () => {
  const secure = slowSecure(); const storage = fakeStorage();
  setup({ native: true, secure, storage, timeoutMs: 5000 });
  auth.setToken("a");
  await new Promise((r) => setTimeout(r, 5));
  auth.clearToken();
  await secure.flush(); await auth.__tokenWritesSettled();
  assert.equal(secure.m.has(KEY), false);
  assert.equal(auth.getToken(), null);
});

await t("(k) slow migration write then clearToken leaves the store empty and memory null", async () => {
  const secure = slowSecure(); const storage = fakeStorage({ [KEY]: "old" });
  setup({ native: true, secure, storage, timeoutMs: 5000 });
  const h = auth.hydrateToken();
  await new Promise((r) => setTimeout(r, 5)); secure.pending.pop()(); // release the initial get -> null
  await h;
  await new Promise((r) => setTimeout(r, 5)); // migration set now in flight
  auth.clearToken();
  await secure.flush(); await auth.__tokenWritesSettled();
  assert.equal(secure.m.has(KEY), false);
  assert.equal(auth.getToken(), null);
  assert.equal(storage.m.has(KEY), false);
});

await t("(l) clear then set ends with the new token", async () => {
  const secure = slowSecure({ [KEY]: "old" }); const storage = fakeStorage();
  setup({ native: true, secure, storage, timeoutMs: 5000 });
  auth.clearToken();
  auth.setToken("new");
  await secure.flush(); await auth.__tokenWritesSettled();
  assert.equal(secure.m.get(KEY), "new");
  assert.equal(auth.getToken(), "new");
});

await t("(n) setToken during hydrate's slow read is not overwritten by the legacy migration", async () => {
  const secure = slowSecure(); const storage = fakeStorage({ [KEY]: "old" });
  setup({ native: true, secure, storage, timeoutMs: 5000 });
  const h = auth.hydrateToken();
  await new Promise((r) => setTimeout(r, 5)); // initial get in flight
  auth.setToken("fresh");
  await secure.flush(); await h; await secure.flush(); await auth.__tokenWritesSettled();
  assert.equal(secure.m.get(KEY), "fresh");
  assert.equal(auth.getToken(), "fresh");
});

await t("(m) a hung loadSecure is bounded by the timeout", async () => {
  setup({ native: true, secure: null, storage: fakeStorage({ [KEY]: "old" }), timeoutMs: 20 });
  auth.__configureTokenStoreForTests({ isNative: () => true, loadSecure: () => new Promise(() => {}), storage: () => fakeStorage(), timeoutMs: 20 });
  await auth.hydrateToken();
  assert.equal(auth.getToken(), null);
});

// ---- A133 ----
const origWarn = console.warn;
function quiet(fn) { return async () => { const w = []; console.warn = (...a) => w.push(a.join(" ")); try { await fn(w); } finally { console.warn = origWarn; } }; }

await t("(o) A133: a native write that never settles still resolves false and the token is in memory at once", quiet(async () => {
  const secure = fakeSecure(); secure.set = () => new Promise(() => {});
  setup({ native: true, secure, storage: fakeStorage(), timeoutMs: 20 });
  const p = auth.setTokenAsync("tok");
  assert.equal(auth.getToken(), "tok", "in memory before any await");
  assert.equal(await p, false);
  assert.equal(auth.getToken(), "tok");
}));

await t("(o2) A133: a hung loadSecure on write is bounded too, and a later write is not stuck behind it", quiet(async () => {
  const storage = fakeStorage();
  auth.__configureTokenStoreForTests({ isNative: () => true, loadSecure: () => new Promise(() => {}), pluginImplemented: () => true, storage: () => storage, timeoutMs: 20 });
  assert.equal(await auth.setTokenAsync("a"), false);
  assert.equal(await auth.setTokenAsync("b"), false);
  assert.equal(auth.getToken(), "b");
  assert.equal(storage.m.has(KEY), false, "timeout does not fall back to localStorage");
}));

await t("(o3) A133: a throwing write resolves false, never rejects, no localStorage", quiet(async () => {
  const secure = fakeSecure({}, { setThrows: true }); const storage = fakeStorage();
  setup({ native: true, secure, storage });
  assert.equal(await auth.setTokenAsync("t"), false);
  assert.equal(auth.getToken(), "t");
  assert.equal(storage.m.has(KEY), false);
}));

await t("(o4) A133: a hung remove cannot block a later write", quiet(async () => {
  const secure = fakeSecure(); secure.remove = () => new Promise(() => {});
  setup({ native: true, secure, storage: fakeStorage(), timeoutMs: 20 });
  auth.clearToken();
  assert.equal(await auth.setTokenAsync("after"), true);
  assert.equal(secure.m.get(KEY), "after");
}));

await t("(p) A133: plugin absent from the binary -> localStorage for hydrate, write and clear, with a warning", quiet(async (w) => {
  const secure = fakeSecure(); const storage = fakeStorage({ [KEY]: "legacy" });
  setup({ native: true, secure, storage, pluginImplemented: false });
  await auth.hydrateToken();
  assert.equal(auth.getToken(), "legacy");
  assert.equal(await auth.setTokenAsync("n"), true);
  assert.equal(storage.m.get(KEY), "n");
  auth.clearToken(); await auth.__tokenWritesSettled();
  assert.equal(storage.m.has(KEY), false);
  assert.equal(secure.calls.length, 0, "secure storage never called (it would hang)");
  assert.ok(w.some((m) => m.includes("A123") && m.includes("A133")), "warns naming A123/A133");
}));

await t("(p2) A133: UNIMPLEMENTED error from the plugin falls back for read and write", quiet(async () => {
  const unimpl = Object.assign(new Error('"SecureStorage" plugin is not implemented on ios'), { code: "UNIMPLEMENTED" });
  const secure = fakeSecure(); secure.get = async () => { throw unimpl; }; secure.set = async () => { throw unimpl; };
  const storage = fakeStorage({ [KEY]: "legacy" });
  setup({ native: true, secure, storage });
  await auth.hydrateToken();
  assert.equal(auth.getToken(), "legacy");
  assert.equal(await auth.setTokenAsync("n"), true);
  assert.equal(storage.m.get(KEY), "n");
}));

await t("(p3) A133: timeouts and other errors do NOT fall back to localStorage", quiet(async () => {
  const storage = fakeStorage({ [KEY]: "legacy" });
  setup({ native: true, secure: fakeSecure({}, { getHangs: true }), storage, timeoutMs: 20 });
  await auth.hydrateToken();
  assert.equal(auth.getToken(), null);
  setup({ native: true, secure: fakeSecure({}, { getThrows: true }), storage });
  await auth.hydrateToken();
  assert.equal(auth.getToken(), null);
  const s3 = fakeStorage();
  setup({ native: true, secure: Object.assign(fakeSecure(), { set: () => new Promise(() => {}) }), storage: s3, timeoutMs: 20 });
  await auth.setTokenAsync("x");
  assert.equal(s3.m.has(KEY), false);
}));

await t("(q) A133: default pluginImplemented reads Capacitor.PluginHeaders (absent array assumes implemented)", () => {
  const src = readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../lib/auth.ts"), "utf8");
  assert.ok(/PluginHeaders/.test(src) && /name === "SecureStorage"/.test(src));
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
