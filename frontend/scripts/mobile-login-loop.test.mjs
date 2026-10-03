// A133: lib/mobileLoginLoop.ts (the nativeGoogleLogin poll/return loop) with
// every native dependency faked.   npm run -s check:mobile-login-loop
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runMobileLoginLoop } from "../lib/mobileLoginLoop.ts";
import { createHash } from "node:crypto";
import {
  PENDING_LOGIN_KEY, PENDING_LOGIN_TTL_MS, clearPendingLogin, createSharedPoller,
  loadPendingLogin, newPendingLogin, savePendingLogin, sha256Hex,
} from "../lib/pendingLogin.ts";

let failures = 0;
async function t(name, fn) {
  try { await fn(); console.log("ok  " + name); }
  catch (e) { failures++; console.error("FAIL " + name + "\n  " + (e && e.stack || e)); }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function harness(pollImpl, extra = {}) {
  const h = { closes: 0, removed: 0, handlers: null, polls: 0 };
  const deps = {
    pollOnce: async () => { h.polls++; return pollImpl(h.polls); },
    closeBrowser: async () => { h.closes++; },
    addListeners: async (handlers) => { h.handlers = handlers; return [1, 2, 3].map(() => ({ remove: () => { h.removed++; } })); },
    intervalMs: 20, timeoutMs: 2000, closeTimeoutMs: 50,
    ...extra,
  };
  return { h, deps };
}

await t("resolves ok on a token poll, closes the browser, removes listeners, stops polling", async () => {
  const { h, deps } = harness((n) => (n >= 2 ? "ok" : "pending"));
  assert.equal(await runMobileLoginLoop(deps), "ok");
  const polls = h.polls;
  assert.equal(h.closes, 1);
  assert.equal(h.removed, 3);
  await sleep(80);
  assert.equal(h.polls, polls, "interval cleared, no more polls");
});

await t("invite_only and err map through", async () => {
  assert.equal(await runMobileLoginLoop(harness(() => "invite_only").deps), "invite_only");
  assert.equal(await runMobileLoginLoop(harness(() => "err").deps), "failed");
});

await t("auth-done deep link closes the browser immediately even while a poll is stuck in flight", async () => {
  let release;
  const { h, deps } = harness(() => new Promise((r) => { release = r; }));
  const p = runMobileLoginLoop(deps);
  await sleep(30);
  assert.equal(h.closes, 0);
  h.handlers.onUrlOpen("wealthdash://auth-done");
  await sleep(5);
  assert.equal(h.closes, 1, "browser closed while the poll is still in flight");
  assert.equal(h.polls, 1, "no second concurrent poll");
  release("ok");
  assert.equal(await p, "ok");
});

await t("an unrelated deep link does not close the browser", async () => {
  const { h, deps } = harness((n) => (n >= 3 ? "ok" : "pending"));
  const p = runMobileLoginLoop(deps);
  await sleep(5);
  h.handlers.onUrlOpen("wealthdash://something-else");
  assert.equal(h.closes, 0);
  await p;
});

await t("polls never overlap and a trigger mid-poll causes exactly one re-poll (no double token handling)", async () => {
  let active = 0, maxActive = 0, ok = 0;
  const { h, deps } = harness(async (n) => {
    active++; maxActive = Math.max(maxActive, active);
    await sleep(15);
    active--;
    if (n === 2) { ok++; return "ok"; }
    return "pending";
  }, { intervalMs: 5 });
  const p = runMobileLoginLoop(deps);
  for (let i = 0; i < 6; i++) { h.handlers.onActive(); h.handlers.onBrowserFinished(); await sleep(3); }
  assert.equal(await p, "ok");
  assert.equal(maxActive, 1);
  assert.equal(ok, 1, "token result produced once");
});

await t("a Browser.close() that never settles does not strand the caller", async () => {
  const { deps } = harness(() => "ok", { closeBrowser: () => new Promise(() => {}) });
  assert.equal(await runMobileLoginLoop(deps), "ok");
});

await t("overall timeout resolves failed and clears the interval", async () => {
  const { h, deps } = harness(() => "pending", { timeoutMs: 60 });
  assert.equal(await runMobileLoginLoop(deps), "failed");
  const polls = h.polls;
  await sleep(60);
  assert.equal(h.polls, polls);
  assert.equal(h.removed, 3);
});

await t("pollOnce rejecting is treated as pending, loop continues", async () => {
  const { deps } = harness((n) => { if (n < 3) throw new Error("net"); return "ok"; });
  assert.equal(await runMobileLoginLoop(deps), "ok");
});

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (f) => readFileSync(path.resolve(here, "..", f), "utf8");
const memStore = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => { m.set(k, v); }, removeItem: (k) => { m.delete(k); }, m }; };

await t("source: nativeGoogleLogin uses the loop, a bounded POST fetch, and the shared poller", () => {
  const src = read("lib/nativeAuth.ts");
  assert.ok(src.includes("runMobileLoginLoop("));
  assert.ok(src.includes("AbortController"), "poll fetch is bounded");
  assert.ok(src.includes("createSharedPoller({ post: postPoll, applyToken: setTokenAsync })"));
  assert.ok(src.includes('App.addListener("appUrlOpen", ({ url }) => h.onUrlOpen(url))'));
  assert.ok(/method: "POST"/.test(src) && src.includes("/auth/mobile/poll`"));
});

await t("source: state and poll secret come from crypto.getRandomValues, never Math.random", () => {
  const src = read("lib/pendingLogin.ts");
  const fn = src.slice(src.indexOf("export function newPendingLogin"), src.indexOf("export function savePendingLogin"));
  assert.equal((fn.match(/crypto\.getRandomValues\(/g) || []).length, 2);
  assert.ok(fn.includes("new Uint8Array(16)"));
  assert.ok(!src.includes("Math.random"));
  assert.ok(!read("lib/nativeAuth.ts").includes("Math.random"));
});

await t("source: the poll secret is never placed in a URL (only sha256 of it, as challenge)", () => {
  const na = read("lib/nativeAuth.ts");
  const pl = read("lib/pendingLogin.ts");
  for (const [name, src] of [["nativeAuth.ts", na], ["pendingLogin.ts", pl]]) {
    for (const line of src.split("\n")) {
      if (/pollSecret|poll_secret/.test(line)) {
        assert.ok(!/\?state=|&state=|encodeURIComponent|URLSearchParams|\$\{API_BASE\}/.test(line), name + " puts the secret near a URL: " + line.trim());
      }
    }
  }
  assert.ok(/&challenge=\$\{challenge\}/.test(na) && na.includes("sha256Hex(pending.pollSecret)"));
  assert.ok(na.includes("body: JSON.stringify({ state: p.state, poll_secret: p.pollSecret })"));
  assert.ok(!/poll\?state=/.test(na), "no GET poll with the state in the query");
});

await t("source: pending login is saved before Browser.open and cleared after the loop and on open failure", () => {
  const fn = read("lib/nativeAuth.ts");
  const g = fn.slice(fn.indexOf("export async function nativeGoogleLogin"), fn.indexOf("export async function resumePendingLogin") > 0 ? fn.indexOf("// A133 / A135") : undefined);
  assert.ok(g.indexOf("savePendingLogin(pending)") > 0 && g.indexOf("savePendingLogin(pending)") < g.indexOf("Browser.open("));
  assert.ok(g.lastIndexOf("clearPendingLogin()") > g.indexOf("await runMobileLoginLoop("));
  assert.ok(/openResult === "rejected"\) \{\s*clearPendingLogin\(\);\s*return "failed";/.test(g));
  assert.ok(!/await Browser\.open/.test(g), "no bare await Browser.open");
  assert.ok(g.includes("BROWSER_OPEN_TIMEOUT_MS") && g.includes('"slow"'));
});

await t("source: AuthProvider resumes a pending login before concluding signed out", () => {
  const src = read("components/AuthProvider.tsx");
  const i = src.indexOf("resumePendingLogin(");
  assert.ok(i > 0 && i > src.indexOf("await hydrateToken()") && i < src.indexOf("const token = getToken();\n      if (!token)"));
});

await t("sha256Hex matches node crypto (incl. multi-block and padding edges)", () => {
  for (const input of ["", "abc", "a".repeat(55), "a".repeat(56), "a".repeat(64), "5e".repeat(16), "x".repeat(1000)]) {
    assert.equal(sha256Hex(input), createHash("sha256").update(input).digest("hex"), input.slice(0, 10));
  }
});

await t("newPendingLogin: state m+32hex, secret 32hex, distinct", () => {
  const p = newPendingLogin(5);
  assert.match(p.state, /^m[0-9a-f]{32}$/);
  assert.match(p.pollSecret, /^[0-9a-f]{32}$/);
  assert.notEqual(p.state.slice(1), p.pollSecret);
  assert.equal(p.startedAt, 5);
});

await t("pending login persists to both stores, loads, clears; expiry and junk are dropped", () => {
  const a = memStore(), b = memStore();
  const p = newPendingLogin(1000);
  savePendingLogin(p, [a, b]);
  assert.ok(a.m.has(PENDING_LOGIN_KEY) && b.m.has(PENDING_LOGIN_KEY));
  assert.deepEqual(loadPendingLogin(1000 + 1000, [a, b]), p);
  assert.equal(loadPendingLogin(1000 + PENDING_LOGIN_TTL_MS + 1, [a, b]), null, "expired");
  assert.equal(a.m.size + b.m.size, 0, "expiry removed it");
  savePendingLogin(p, [a]);
  a.m.set(PENDING_LOGIN_KEY, "{not json");
  assert.equal(loadPendingLogin(1000, [a]), null);
  assert.equal(a.m.size, 0);
  savePendingLogin(p, [a, b]);
  clearPendingLogin([a, b]);
  assert.equal(a.m.size + b.m.size, 0);
  // survives with only localStorage present (sessionStorage lost to a process kill)
  savePendingLogin(p, [b]);
  assert.deepEqual(loadPendingLogin(1001, [a, b]), p);
});

function poller(replies, extra = {}) {
  const log = { posts: [], applied: [], cleared: 0 };
  let i = 0;
  const pollOnce = createSharedPoller({
    post: async (p) => { log.posts.push(p); await sleep(5); const r = replies[Math.min(i++, replies.length - 1)]; return r; },
    applyToken: async (t) => { log.applied.push(t); },
    clear: () => { log.cleared++; },
    ...extra,
  });
  return { log, pollOnce };
}

await t("resume-on-start redeems once: a token reply applies exactly once and clears the record", async () => {
  const { log, pollOnce } = poller([{ status: "token", token: "T" }]);
  const p = newPendingLogin();
  assert.equal(await pollOnce(p), "ok");
  assert.equal(await pollOnce(p), "ok", "second ask for an applied state is a no-op ok");
  assert.deepEqual(log.applied, ["T"]);
  assert.equal(log.posts.length, 1, "no second request for an applied state");
  assert.equal(log.cleared, 1);
});

await t("a resumed poll and a still-running loop cannot both apply the token (concurrent)", async () => {
  const { log, pollOnce } = poller([{ status: "token", token: "T" }]);
  const p = newPendingLogin();
  const rs = await Promise.all([pollOnce(p), pollOnce(p), pollOnce({ ...p })]);
  assert.deepEqual(rs, ["ok", "ok", "ok"]);
  assert.deepEqual(log.applied, ["T"]);
  assert.equal(log.posts.length, 1, "in-flight request shared");
});

await t("even two separate requests that both return a token apply it once", async () => {
  const log = { applied: [] };
  const pollOnce = createSharedPoller({
    post: async () => ({ status: "token", token: "T" }),
    applyToken: async (t) => { log.applied.push(t); await sleep(20); },
    clear: () => {},
  });
  const p = newPendingLogin();
  const first = pollOnce(p);
  await first;
  await pollOnce(p);
  assert.deepEqual(log.applied, ["T"]);
});

await t("pending, network failure, error and invite_only replies", async () => {
  const p = newPendingLogin();
  assert.equal(await poller([{ status: "pending" }]).pollOnce(p), "pending");
  assert.equal(await poller([null]).pollOnce(p), "pending");
  const e = poller([{ status: "error", error: "auth_failed" }]);
  assert.equal(await e.pollOnce(p), "err");
  assert.equal(e.log.cleared, 1);
  assert.equal(await poller([{ status: "error", error: "invite_only" }]).pollOnce(p), "invite_only");
  const thrower = createSharedPoller({ post: async () => { throw new Error("boom"); }, applyToken: async () => {}, clear: () => {} });
  assert.equal(await thrower(p), "pending");
});

await t("loop + shared poller: browser closes on auth-done mid-poll and the token is applied once", async () => {
  let release;
  const log = { applied: [] };
  const pollOnce = createSharedPoller({
    post: () => new Promise((r) => { release = () => r({ status: "token", token: "T" }); }),
    applyToken: async (t) => { log.applied.push(t); },
    clear: () => {},
  });
  const p = newPendingLogin();
  const { h, deps } = harness(() => pollOnce(p));
  const done = runMobileLoginLoop(deps);
  await sleep(30);
  h.handlers.onUrlOpen("wealthdash://auth-done");
  await sleep(5);
  assert.equal(h.closes, 1);
  release();
  assert.equal(await done, "ok");
  assert.deepEqual(log.applied, ["T"]);
});

if (failures) { console.error(failures + " failed"); process.exit(1); }
console.log("mobile-login-loop: all passed");
