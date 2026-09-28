// Plain-Node test for A124: the frontend had no global handling of a 401
// from the API, so a session revoked elsewhere (another device's sign-out,
// account deletion, the dormant sweep) was experienced as a wall of
// per-card errors instead of a clean sign-out. Same framework-free pattern
// as scripts/verdict-cache.test.mjs: imports the REAL production
// lib/api.ts and lib/auth.ts, stubs `global.fetch` in place (the lowest
// seam that get<T>/post<T>/del<T>/toJson<T> all share), no network, no
// Mongo, no real account, no React renderer.
//
// components/AuthProvider.tsx is a "use client" component and isn't
// exercised here directly (it needs a DOM/JSX render this harness doesn't
// give it) — instead this registers a handler via the REAL
// setUnauthorizedHandler export standing in for AuthProvider's own
// registration, and asserts it calls the REAL, shared clearToken() from
// lib/auth.ts (the exact function AuthProvider's own logout() calls),
// which is what "the hook clears the token through the shared helper"
// means for both platforms (A123 will move where the token lives; this
// only cares that the SAME function is called, not where it writes to).
//
// Run with:
//   npm run -s check:global-401
// or:
//   node --no-warnings --experimental-strip-types --experimental-loader ./scripts/_ts-extensionless-loader.mjs scripts/global-401.test.mjs

import { api, setUnauthorizedHandler, resetUnauthorizedGate, ApiError } from "../lib/api";
import { getToken, setToken, clearToken } from "../lib/auth";

let failures = 0;

function check(label, cond) {
  if (!cond) {
    failures += 1;
    console.error(`FAIL: ${label}`);
  } else {
    console.log(`PASS: ${label}`);
  }
}

function fakeResponse({ status, url, body = { detail: "Session expired" } }) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 401 ? "Unauthorized" : status === 200 ? "OK" : "Error",
    url,
    json: async () => body,
  };
}

// Every case below installs its own fetch stub; kept as a mutable slot so
// each block can swap the response without a shared queue.
let fetchImpl = async () => fakeResponse({ status: 200, url: "https://api.example.com/unused", body: {} });
globalThis.fetch = (...args) => fetchImpl(...args);

async function expectRejects(promise) {
  try {
    await promise;
    return null;
  } catch (e) {
    return e;
  }
}

// ── 1. Three concurrent 401s on an authenticated call fire the hook exactly
//      once, and the hook's own cleanup (clearToken) runs exactly once ────
{
  resetUnauthorizedGate();
  setUnauthorizedHandler(null);
  setToken("session-a");
  let fireCount = 0;
  setUnauthorizedHandler(() => {
    fireCount += 1;
    clearToken();
  });

  fetchImpl = async () => fakeResponse({ status: 401, url: "https://api.example.com/profile" });

  // api.getProfile() -> get<T>("/profile"); three genuinely concurrent
  // calls, same as three cards on Home/Spend/Upcoming all discovering the
  // same revoked token in the same tick.
  const results = await Promise.all([
    expectRejects(api.getProfile()),
    expectRejects(api.getProfile()),
    expectRejects(api.getProfile()),
  ]);

  check("all three concurrent 401s still reject (callers still stop rendering)", results.every((e) => e instanceof ApiError));
  check("the unauthorized hook fired exactly once across three concurrent 401s", fireCount === 1);
  check("the hook's clearToken() ran (shared helper, not a private copy)", getToken() === null);
}

// ── 2. The gate can reopen: resetUnauthorizedGate() (AuthProvider calls
//      this right after a fresh sign-in validates ok) lets a LATER,
//      genuinely new revocation fire the hook again ─────────────────────
{
  let fireCount = 0;
  setUnauthorizedHandler(() => { fireCount += 1; });
  fetchImpl = async () => fakeResponse({ status: 401, url: "https://api.example.com/profile" });

  await expectRejects(api.getProfile());
  check("gate still shut immediately after case 1 (no reset yet)", fireCount === 0);

  resetUnauthorizedGate();
  await expectRejects(api.getProfile());
  check("resetUnauthorizedGate() lets a new revocation fire the hook again", fireCount === 1);
}

// ── 3. A 401 on the login/session-check/public surface does not fire the
//      hook — checked across get<T> (getProfile), post<T> (addCategory),
//      del<T> (revokeAllowlist) and the raw-fetch+toJson path
//      (deleteCategory), so all four functions named in A124 are proven,
//      not just one ───────────────────────────────────────────────────────
{
  const exemptUrls = [
    "https://api.example.com/auth/session/validate",
    "https://api.example.com/auth/google",
    "https://api.example.com/auth/google/callback",
    "https://api.example.com/auth/apple/native",
    "https://api.example.com/auth/mobile/poll",
    "https://api.example.com/health",
  ];

  for (const url of exemptUrls) {
    resetUnauthorizedGate();
    let fireCount = 0;
    setUnauthorizedHandler(() => { fireCount += 1; });
    setToken("session-b");

    fetchImpl = async () => fakeResponse({ status: 401, url });
    await expectRejects(api.getProfile()); // get<T>
    check(`401 whose response.url is ${url} does not fire the hook (get)`, fireCount === 0);
    check(`token is untouched when the hook never fires (get, ${url})`, getToken() === "session-b");

    fetchImpl = async () => fakeResponse({ status: 401, url });
    await expectRejects(api.addCategory("Test")); // post<T>
    check(`401 whose response.url is ${url} does not fire the hook (post)`, fireCount === 0);

    fetchImpl = async () => fakeResponse({ status: 401, url });
    await expectRejects(api.revokeAllowlist("some-key")); // del<T>
    check(`401 whose response.url is ${url} does not fire the hook (del)`, fireCount === 0);

    fetchImpl = async () => fakeResponse({ status: 401, url });
    await expectRejects(api.deleteCategory("Test")); // raw fetch + toJson<T>
    check(`401 whose response.url is ${url} does not fire the hook (toJson)`, fireCount === 0);
  }
  clearToken();
}

// ── 4. A non-exempt authenticated route still fires on get/post/del/toJson
//      individually (each of the four A124 names its own path through) ──
{
  const cases = [
    ["get", () => api.getProfile()],
    ["post", () => api.addCategory("Test")],
    ["del", () => api.revokeAllowlist("some-key")],
    ["toJson", () => api.deleteCategory("Test")],
  ];
  for (const [label, call] of cases) {
    resetUnauthorizedGate();
    let fireCount = 0;
    setUnauthorizedHandler(() => { fireCount += 1; });
    fetchImpl = async () => fakeResponse({ status: 401, url: "https://api.example.com/some/authenticated/route" });
    await expectRejects(call());
    check(`a non-exempt 401 fires the hook via ${label}`, fireCount === 1);
  }
}

// ── 5. A 200 never fires the hook ──────────────────────────────────────────
{
  resetUnauthorizedGate();
  let fireCount = 0;
  setUnauthorizedHandler(() => { fireCount += 1; });
  fetchImpl = async () =>
    fakeResponse({
      status: 200,
      url: "https://api.example.com/profile",
      body: { full_name: "Test User", name_tokens: ["test"], onboarding_complete: true, postcode: null, lat: null, lng: null },
    });

  const profile = await api.getProfile();
  check("a 200 resolves normally", profile.full_name === "Test User");
  check("a 200 never fires the hook", fireCount === 0);
}

setUnauthorizedHandler(null);

if (failures > 0) {
  console.error(`\n${failures} check(s) failed.`);
  process.exit(1);
} else {
  console.log("\nAll checks passed.");
}
