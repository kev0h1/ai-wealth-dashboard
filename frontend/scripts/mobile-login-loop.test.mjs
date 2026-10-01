// A133: lib/mobileLoginLoop.ts (the nativeGoogleLogin poll/return loop) with
// every native dependency faked.   npm run -s check:mobile-login-loop
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runMobileLoginLoop } from "../lib/mobileLoginLoop.ts";

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

await t("source: nativeGoogleLogin uses the loop, a bounded fetch, and setTokenAsync result is not required for ok", () => {
  const src = readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../lib/nativeAuth.ts"), "utf8");
  assert.ok(src.includes("runMobileLoginLoop("));
  assert.ok(src.includes("AbortController"), "poll fetch is bounded");
  assert.ok(/await setTokenAsync\(d\.token\);\s*return "ok";/.test(src));
  assert.ok(src.includes('App.addListener("appUrlOpen", ({ url }) => h.onUrlOpen(url))'));
});

if (failures) { console.error(failures + " failed"); process.exit(1); }
console.log("mobile-login-loop: all passed");
