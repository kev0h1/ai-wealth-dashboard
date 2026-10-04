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

await t("overall timeout resolves timeout (G202: told apart from failed) and clears the interval", async () => {
  const { h, deps } = harness(() => "pending", { timeoutMs: 60 });
  assert.equal(await runMobileLoginLoop(deps), "timeout");
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
  assert.ok(/createSharedPoller\(\{\s*post: postPoll,[\s\S]*?setTokenAsync\(t\)/.test(src));
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

await t("source (A135): native sign-in transitions in place, no page reload, via AuthProvider.establishSession", () => {
  const ls = read("lib/../components/LoginScreen.tsx");
  const g = ls.slice(ls.indexOf("async function handleGoogleClick"), ls.indexOf("const isInviteOnly"));
  assert.ok(!/location\.reload/.test(g), "handlers must not reload after native login");
  assert.equal((g.match(/await runNative\("(google|apple)"\)/g) || []).length, 2, "google and apple both use the one runNative path");
  const f = ls.slice(ls.indexOf("async function establish("), ls.indexOf("async function runNative"));
  assert.ok(f.includes("await onSignedIn(ctrl.signal)"));
  // the only remaining reload is the explicit fallback for hosts without the callback
  assert.ok(/if \(!onSignedIn\) \{\s*window\.location\.reload\(\);/.test(f));
  const ap = read("components/AuthProvider.tsx");
  assert.ok(ap.includes("<LoginScreen error={authError} onSignedIn={establishSession} resuming={resuming} onCancelResume={cancelResume} />"));
  const e = ap.slice(ap.indexOf("async function establishSession"), ap.indexOf("useEffect(() => {\n    // A135: a cold start"));
  assert.ok(e.includes("getToken()") && e.includes("/auth/session/validate") && e.includes("setUser(") && e.includes("resetUnauthorizedGate()") && e.includes("invalidateAllAccountData()"));
  assert.ok(!/location\.reload/.test(e));
  assert.ok(!ap.includes("resumePendingLogin(() => window.location.reload())"), "late resume also in place");
});

await t("source (A135 review): establishSession clears the token only on 401/403 or a missing email, never on a thrown error or 5xx", () => {
  const ap = read("components/AuthProvider.tsx");
  const e = ap.slice(ap.indexOf("async function establishSession"), ap.indexOf("// G202: whenever a user is set"));
  assert.equal((e.match(/clearToken\(\)/g) || []).length, 2, "exactly two clear sites");
  assert.ok(/res\.status === 401 \|\| res\.status === 403\) \{\s*clearToken\(\)/.test(e));
  assert.ok(/if \(!data\.email\) \{\s*clearToken\(\)/.test(e));
  assert.ok(/if \(!res\.ok\) return "unreachable";/.test(e));
  const c = e.slice(e.lastIndexOf("} catch {"));
  assert.ok(!/clearToken/.test(c), "the catch must not clear the token");
});

await t("source (A135 review 2): establishSession retries a transient failure once, keeps the token, and LoginScreen offers tap-to-retry", () => {
  const ap = read("components/AuthProvider.tsx");
  const e = ap.slice(ap.indexOf("async function establishSession"), ap.indexOf("useEffect(() => {\n    // A135: a cold start"));
  const top = e.slice(0, e.indexOf("async function validateOnce"));
  assert.equal((top.match(/await validateOnce\(signal\)/g) || []).length, 2, "exactly one retry, no loop");
  assert.ok(/if \(outcome === "unreachable"\) \{[\s\S]*SESSION_RETRY_DELAY_MS[\s\S]*outcome = await validateOnce\(signal\);/.test(top));
  assert.ok(!/while|for \(/.test(top), "no loop");
  assert.ok(!/clearToken/.test(top), "the retry path does not clear the token");
  assert.ok(/SESSION_RETRY_DELAY_MS = 1500/.test(ap));
  const ls = read("components/LoginScreen.tsx");
  assert.ok(read("lib/signInPhase.ts").includes("we could not reach Sorted. Your sign-in is kept, so you can try again.") && ls.includes("<UnreachablePanel"));
  assert.ok(/outcome === "unreachable"\) setLocal\(\{ kind: "unreachable" \}\)/.test(ls));
  assert.ok(/onRetry=\{retrySessionCheck\}/.test(ls) && /void establish\(run, lastAttemptRef\.current/.test(ls), "tap re-runs establishSession");
  assert.ok(!/signOut|clearToken\(/.test(ls));
});

// ------------------------------------------------------------------ G202
import { createRunGuard, SLOW_AFTER_MS, derivePhase, failedCopy, signingCopy } from "../lib/signInPhase.ts";
import { boundedSignal } from "../lib/abortBound.ts";

const lsSrc = read("components/LoginScreen.tsx");
const apSrc = read("components/AuthProvider.tsx");
const spSrc = read("components/SignInProgress.tsx");
const naSrc = read("lib/nativeAuth.ts");
const between = (src, a, b) => src.slice(src.indexOf(a), src.indexOf(b, src.indexOf(a)));

await t("G202 phase: set on the tap, cleared on every exit (ok, rejected, unreachable, cancel, failure, timeout)", () => {
  const run = between(lsSrc, "async function runNative", "function retrySessionCheck");
  assert.ok(/setLocal\(\{ kind: "signing-in", attempt, stage: "provider", startedAt \}\)/.test(run), "set on tap with startedAt");
  assert.ok(/const startedAt = Date\.now\(\)/.test(run));
  assert.ok(/result === "invite_only"[\s\S]*setLocal\(\{ kind: "idle" \}\)/.test(run), "invite_only returns to idle");
  assert.ok(/result === "cancelled"\) setLocal\(\{ kind: "idle" \}\)/.test(run), "cancelled returns to idle");
  assert.ok(/fail\(result === "timeout" \? "timeout" : "failed"\)/.test(run), "failure and timeout leave signing-in");
  const est = between(lsSrc, "async function establish(", "async function runNative");
  assert.ok(/outcome === "unreachable"\) setLocal\(\{ kind: "unreachable" \}\)/.test(est));
  assert.ok(/outcome === "rejected"\) fail\("failed"\)/.test(est));
  assert.ok(/function fail\([^)]*\) \{[\s\S]*setLocal\(\{ kind: "failed", reason \}\)/.test(lsSrc));
  const cancel = between(lsSrc, "function cancelSignIn", "function dismissPhase");
  assert.ok(/setLocal\(\{ kind: "idle" \}\)/.test(cancel));
  assert.ok(!/useState\(false\);\s*\n\s*async function finishNativeSignIn/.test(lsSrc));
  assert.ok(!/const \[unreachable, setUnreachable\]/.test(lsSrc), "no separate unreachable boolean, one phase source");
});

await t("G202: LoginScreen has no alert( at all", () => {
  assert.ok(!/\balert\(/.test(lsSrc), "window.alert is gone");
  assert.ok(!/window\.alert/.test(lsSrc));
});

await t("G202: failure notice is role=alert and takes focus (and replaces the alert)", () => {
  const fn = between(spSrc, "export function FailedNotice", "export function UnreachablePanel");
  assert.ok(/role="alert"/.test(fn));
  assert.ok(/tabIndex=\{-1\}/.test(fn) && /ref\.current\?\.focus\(\)/.test(fn));
  assert.ok(/<FailedNotice key=\{noticeSeq\} reason=\{phase\.reason\} \/>/.test(lsSrc), "rendered from the phase, remounted per failure");
  assert.equal(failedCopy("failed").title, "We could not sign you in");
  assert.equal(failedCopy("timeout").title, "Sign-in took too long");
  assert.ok(!/minute|five|\d/.test(failedCopy("timeout").line + failedCopy("timeout").title), "no duration in the timeout copy");
  assert.notEqual(failedCopy("failed").line, failedCopy("timeout").line);
});

await t("G202 cancel: aborting the loop stops polling, closes the sheet, removes listeners and resolves cancelled", async () => {
  const { h, deps } = harness(() => "pending");
  const ctrl = new AbortController();
  const p = runMobileLoginLoop(deps, ctrl.signal);
  await sleep(50);
  ctrl.abort();
  assert.equal(await p, "cancelled");
  const polls = h.polls;
  assert.equal(h.closes, 1);
  assert.equal(h.removed, 3);
  await sleep(80);
  assert.equal(h.polls, polls, "no more polls after cancel");
  const pre = new AbortController(); pre.abort();
  assert.equal(await runMobileLoginLoop(harness(() => "pending").deps, pre.signal), "cancelled", "already aborted");
});

await t("G202 cancel: clears the pending login and a token that raced in; a poll in flight cannot store one", () => {
  const c = between(naSrc, "export function cancelNativeLogin", "// D5: distinguishes");
  assert.ok(/loginAbort\?\.abort\(\)/.test(c) && /clearPendingLogin\(\)/.test(c) && /clearToken\(\)/.test(c) && /applySuppressed = true/.test(c));
  assert.ok(/if \(applySuppressed\) return Promise\.resolve\(\);/.test(naSrc));
  const g = between(naSrc, "async function googleLoginInner", "// A133 / A135");
  assert.ok(/runMobileLoginLoop\(loopDeps\(pending\), signal\)/.test(g), "the live loop gets the abort signal");
  assert.ok(/signal\.aborted\) \{[\s\S]*clearPendingLogin\(\);[\s\S]*return "cancelled"/.test(g), "cancel during open");
  assert.ok(/cancelNativeLogin\(\)/.test(between(lsSrc, "function cancelSignIn", "function dismissPhase")), "Cancel calls it");
});

await t("G202 cancel (behavioural): the shared poller never applies a token after cancel, and the record is gone", async () => {
  const stores = [memStore()];
  const p = newPendingLogin();
  savePendingLogin(p, stores);
  let suppressed = false, applied = 0, release;
  const poll = createSharedPoller({
    post: () => new Promise((r) => { release = () => r({ status: "token", token: "T" }); }),
    applyToken: async () => { if (!suppressed) applied++; },
    clear: () => clearPendingLogin(stores),
  });
  const ctrl = new AbortController();
  const done = runMobileLoginLoop(harness(() => poll(p)).deps, ctrl.signal);
  await sleep(30);
  suppressed = true; ctrl.abort(); clearPendingLogin(stores); // what cancelNativeLogin does
  assert.equal(await done, "cancelled");
  release();
  await sleep(10);
  assert.equal(applied, 0);
  assert.equal(loadPendingLogin(Date.now(), stores), null);
});

await t("G202 resuming: AuthProvider passes the persisted pending login's startedAt, not a fresh clock", () => {
  assert.ok(/const pendingAtStart = loadPendingLogin\(\)/.test(apSrc));
  assert.ok(/setResuming\(\{ startedAt: pendingAtStart\.startedAt, stage: "provider" \}\)/.test(apSrc));
  assert.ok(apSrc.includes("resuming={resuming}"));
  const t0 = 5_000;
  const ph = derivePhase({ kind: "idle" }, { startedAt: t0, stage: "provider" });
  assert.deepEqual(ph, { kind: "signing-in", attempt: "resume", stage: "provider", startedAt: t0 });
  assert.equal(signingCopy(ph, t0 + 25_000).title, "Still signing you in", "the clock survives the kill");
  assert.deepEqual(derivePhase({ kind: "idle" }, { startedAt: t0, stage: "session", ended: "timeout" }), { kind: "failed", reason: "timeout" });
  assert.deepEqual(derivePhase({ kind: "idle" }, { startedAt: t0, stage: "session", ended: "unreachable" }), { kind: "unreachable" }, "A135: unreachable keeps the token and offers retry");
  assert.deepEqual(derivePhase({ kind: "idle" }, { startedAt: t0, stage: "session", ended: "failed" }), { kind: "failed", reason: "failed" });
  const local = { kind: "failed", reason: "failed" };
  assert.equal(derivePhase(local, { startedAt: t0, stage: "provider" }), local, "a local phase always wins");
  assert.ok(/if \(resuming\) return <LoginScreen/.test(apSrc), "no blank slate while resuming");
});

await t("G202 validateOnce is bounded: the signal aborts after the bound, on outer abort, and dispose stops the timer", async () => {
  assert.ok(/VALIDATE_TIMEOUT_MS = 15_000/.test(apSrc));
  const v = between(apSrc, "async function validateOnce", "useEffect(() => {\n    // A135: a cold start");
  assert.ok(/boundedSignal\(VALIDATE_TIMEOUT_MS, signal\)/.test(v) && /signal: bound\.signal/.test(v) && /bound\.dispose\(\)/.test(v));
  assert.ok(/bound\.signal\.aborted\) return "unreachable"/.test(v), "an aborted check never signs in");
  const a = boundedSignal(30);
  assert.equal(a.signal.aborted, false);
  await sleep(60);
  assert.equal(a.signal.aborted, true, "aborts after the bound");
  const outer = new AbortController();
  const b = boundedSignal(10_000, outer.signal);
  outer.abort();
  assert.equal(b.signal.aborted, true, "outer abort propagates");
  b.dispose();
  const c = boundedSignal(30);
  c.dispose();
  await sleep(60);
  assert.equal(c.signal.aborted, false, "dispose clears the timer");
});

await t("G202: 'Still signing you in' appears at 20s and not before, and the panel uses it", () => {
  assert.equal(SLOW_AFTER_MS, 20_000);
  const ph = { kind: "signing-in", attempt: "google", stage: "provider", startedAt: 0 };
  assert.equal(signingCopy(ph, 19_999).title, "Signing you in");
  const slow = signingCopy(ph, 20_000);
  assert.equal(slow.title, "Still signing you in");
  assert.ok(slow.line.includes("taking longer than usual"));
  assert.equal(signingCopy({ ...ph, stage: "session" }, 0).line, "Checking your session.");
  assert.ok(/signingCopy\(phase, now\)/.test(spSrc));
});

await t("G202: the preview renders the production LoginScreen, with no copied variants", () => {
  const pv = read("app/design/signin-loading/SigninLoadingClient.tsx");
  assert.ok(/import LoginScreen/.test(pv) && /<LoginScreen phase=\{phase\} nowMs=\{nowMs\} \/>/.test(pv));
  assert.ok(!/variants/.test(pv) && !/renderPhase/.test(pv));
  assert.ok(!/renderPhase|hideMarkWhileSigningIn/.test(lsSrc));
});

await t("G202 review 1: the resume signal is dropped whenever a user is set, and failed is set only when no user resulted", () => {
  assert.ok(/useEffect\(\(\) => \{\s*if \(user\) \{\s*setResuming\(null\);\s*window\.dispatchEvent\(new Event\("wd:session-established"\)\);[^\n]*\s*\}\s*\}, \[user\]\);/.test(apSrc), "any user clears resuming (init, late success, establishSession)");
  assert.ok(/const outcome = await establishSession\(initCtrl\.signal\);/.test(apSrc), "init uses the shared establishSession (A135)");
  assert.ok(/ended: "unreachable" \}\)\);/.test(apSrc), "init: unreachable (token kept) rather than failed");
  assert.ok(/setResuming\(\(r\) => \(o === "ok" \? null :/.test(apSrc), "late success: null on ok, failed only otherwise");
});

await t("G202 review 1 (behavioural model): after a sign-out a concluded resume leaves no panel", () => {
  // the exact reducer shape AuthProvider uses, driven through success then sign-out
  let resuming = { startedAt: 1, stage: "session" };
  let user = null;
  const conclude = (signedIn) => { resuming = signedIn ? null : resuming && resuming.stage === "session" && !resuming.ended ? { ...resuming, ended: "failed" } : resuming; };
  user = { email: "a@b" }; conclude(true);
  user = null; // later sign-out
  assert.equal(derivePhase({ kind: "idle" }, resuming).kind, "idle");
  let r2 = { startedAt: 1, stage: "session" };
  r2 = false ? null : r2 && r2.stage === "session" && !r2.ended ? { ...r2, ended: "failed" } : r2;
  assert.equal(derivePhase({ kind: "idle" }, r2).kind, "failed", "no user: failed is still shown");
});

await t("G202 review 2: Cancel clears only a token this attempt minted", () => {
  const c = between(naSrc, "export function cancelNativeLogin", "// D5: distinguishes");
  assert.ok(/if \(attemptMintedToken\) \{[\s\S]*clearToken\(\)/.test(c) && !/\n  clearToken\(\);/.test(c), "clearToken only behind the flag");
  assert.ok(/attemptMintedToken = false;\s*\n\s*const ctrl = new AbortController/.test(naSrc), "reset at the start of each attempt");
  assert.ok(/attemptMintedToken = true;\s*\n\s*return setTokenAsync\(t\)/.test(naSrc), "google and resume poll mint");
  assert.ok(/attemptMintedToken = true;\s*\n\s*await setTokenAsync\(data\.session_token\)/.test(naSrc), "apple mints");
});

await t("G202 review 3: Cancel during resume shows the idle form at once and the init result is ignored", () => {
  const c = between(apSrc, "function cancelResume", "useEffect(() => {\n    // A135: a cold start");
  assert.ok(/resumeCancelledRef\.current = true;[\s\S]*setResuming\(null\);[\s\S]*setChecking\(false\);/.test(c));
  assert.ok(/resumeCancelledRef\.current = false;\s*\n\s*discardRef\.current = false;\s*\n\s*pendingLoginRef\.current = false;/.test(apSrc), "reset before the first await");
  assert.ok(/outcome === "ok"\) \{\s*setResuming\(null\);[^\n]*\n\s*if \(resumeCancelledRef\.current\)/.test(apSrc), "init validate result ignored when cancelled");
});

await t("G202 review 4: a stale result from a cancelled attempt must not change the phase (run guard)", () => {
  const g = createRunGuard();
  const a = g.next();
  assert.ok(g.isCurrent(a));
  g.cancel();
  assert.ok(!g.isCurrent(a), "cancelled run is stale");
  const b = g.next();
  assert.ok(!g.isCurrent(a) && g.isCurrent(b), "superseded run is stale");
  // LoginScreen applies the guard after every await before touching the phase
  const run = between(lsSrc, "async function establish(", "function retrySessionCheck");
  assert.equal((run.match(/if \(!runRef\.current\.isCurrent\(run\)\) return;/g) || []).length, 2, "after the sign-in await and after the session await");
  assert.ok(/runRef\.current\.cancel\(\)/.test(between(lsSrc, "function cancelSignIn", "function dismissPhase")));
});

await t("G202 review 6: the late-success session check is abortable, cancelResume aborts it, and an aborted check never calls setUser", () => {
  const late = between(apSrc, "// Late success: the token is in", "(result) => {");
  assert.ok(/const lateCtrl = new AbortController\(\);\s*\n\s*lateAbortRef\.current = lateCtrl;/.test(late));
  assert.ok(/establishSession\(lateCtrl\.signal\)/.test(late), "late path passes the signal");
  assert.ok(/if \(resumeCancelledRef\.current\) return;[^\n]*\n\s*setResuming/.test(late), "cancelled ref checked before touching state");
  const c = between(apSrc, "function cancelResume", "useEffect(() => {\n    // A135: a cold start");
  assert.ok(/lateAbortRef\.current\?\.abort\(\)/.test(c), "cancelResume aborts the late controller");
  const v = between(apSrc, "async function validateOnce", "useEffect(() => {");
  assert.ok(v.indexOf("bound.signal.aborted") > 0 && v.indexOf("bound.signal.aborted") < v.indexOf("setUser("), "abort checked before setUser");
});

await t("source (A135): init() never clears the token on a non-401 outcome", () => {
  const init = apSrc.slice(apSrc.indexOf("async function initInner"), apSrc.indexOf("  // A118 review: a deliberate user tap"));
  assert.ok(init.includes("await establishSession(initCtrl.signal)"), "init validates through establishSession");
  assert.ok(!/\} else \{\s*clearToken\(\);\s*\}\s*\} catch \{\s*clearToken\(\);/.test(init), "old wipe-on-anything-but-200 shape is gone");
  assert.ok(!/gatedFetch\(/.test(init), "no raw validate fetch inside init");
  // every clearToken in init sits in the cancel branches
  for (const m of init.matchAll(/clearToken\(\)/g)) {
    const before = init.slice(Math.max(0, m.index - 160), m.index);
    assert.ok(/pendingLoginRef\.current\)\s*$|resumeCancelledRef\.current\) \{\s*$/.test(before), "clearToken only in a cancel branch: " + before.slice(-80));
  }
});

await t("source (A135 review): the ledger timer is native-gated, skips a set user, and init's finally clears it", () => {
  assert.ok(/if \(nativePlatform\(\)\) \{\s*ledgerTimer = setTimeout\(/.test(apSrc), "timer only started on native");
  assert.ok(/if \(initDone \|\| resumeCancelledRef\.current \|\| userRef\.current\) return;/.test(apSrc), "timer bails when done, cancelled or a user is set");
  assert.ok(/\} finally \{\s*initDone = true;\s*if \(ledgerTimer\) clearTimeout\(ledgerTimer\);\s*\}/.test(apSrc), "finally clears the ledger timer");
});

if (failures) { console.error(failures + " failed"); process.exit(1); }
console.log("mobile-login-loop: all passed");
