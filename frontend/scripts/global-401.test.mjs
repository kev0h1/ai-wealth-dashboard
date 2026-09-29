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

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

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

// Shared by check 6 (the real lib/api.ts scan) and check 7 (a synthetic
// decoy proving the scanner itself is honest) below — module scope so both
// can call the exact same scanner, not two copies that could drift apart.
//
// Explicit allowlist: fetch() call sites whose URL is already on api.ts's
// OWN UNAUTHORIZED_HOOK_EXEMPT_PATHS list (the login/session-check
// surface). reportIfUnauthorized would be a guaranteed no-op there, so
// these are exempt from the scan rather than required to call it —
// matched by a literal substring that must appear on the fetch(...) line
// itself, so a NEW exempt call added later still fails this scan until
// someone deliberately adds it here, rather than silently passing.
const EXEMPT_FETCH_URL_SUBSTRINGS = ["/auth/session/validate"];
// A121: the module-scoped `function fetch(...)` shadow (the app-lock
// request gate) and its own single internal `return globalThis.fetch(...)`
// call are the network PRIMITIVE every call site below funnels through —
// not a call site of their own needing a 401 marker within a lookahead
// window. Every real call site already reaches reportIfUnauthorized/toJson
// via its OWN res handling once this primitive resolves, so scanning the
// primitive's own two lines for those markers would be checking the wrong
// thing entirely (and did produce two false positives here once A121 and
// A124 first landed in the same file — this exclusion is what closes that).
const GATE_DEFINITION_LINE_RE = /^\s*function fetch\(|return globalThis\.fetch\(/;
// toJson is almost always called generically (`toJson<{ ok: boolean }>(r)`),
// so a plain "toJson(" substring match misses every real call site — the
// marker has to tolerate an optional `<...>` between the name and the
// opening paren.
const GATE_MARKERS = [/reportIfUnauthorized\(/, /toJson\s*(<[^(]*>)?\s*\(/];
const LOOKAHEAD_LINES = 20;

// A124 review tightening #1: the first cut of this scanner joined the RAW
// lookahead window (comments included) before testing GATE_MARKERS against
// it, so a decoy — a comment mentioning "reportIfUnauthorized(" near an
// actually-ungated fetch, e.g. a stale "// TODO: reportIfUnauthorized(..."
// nobody ever wired up — read as covered. This strips every comment-only
// line and any trailing `// ...` comment (careful not to treat a URL's
// `://` as a comment marker) before the window is ever searched, so only
// REAL code can satisfy a gate marker.
function stripLineForGateScan(line) {
  const trimmed = line.trim();
  if (trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*")) return "";
  return line.replace(/(?<!:)\/\/.*$/, "");
}

function scanApiTsForUngatedFetches(lines) {
  const offenders = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    if (trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*")) continue;
    if (!/\bfetch\(/.test(line)) continue;
    if (EXEMPT_FETCH_URL_SUBSTRINGS.some((s) => line.includes(s))) continue;
    if (GATE_DEFINITION_LINE_RE.test(line)) continue;
    const window = lines.slice(i, i + LOOKAHEAD_LINES + 1).map(stripLineForGateScan).join("\n");
    if (!GATE_MARKERS.some((m) => m.test(window))) offenders.push(i + 1); // 1-based
  }
  return offenders;
}

// ── 6. Source scan: every `fetch(` call site in lib/api.ts is routed
//      through the gate — a static backstop against a future call site
//      being added the old way (a manual `if (!res.ok)`/`.then(r => ...)`
//      with no reportIfUnauthorized/toJson), the exact shape all 14 gaps
//      this check was written for took. Runtime tests above can only prove
//      the sites that exist ARE wired correctly; this proves no site is
//      missing full stop, without having to enumerate and stub all 14 ────
{
  const apiTsPath = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "lib", "api.ts");
  const apiSource = readFileSync(apiTsPath, "utf8");
  const apiLines = apiSource.split("\n");

  const offenders = scanApiTsForUngatedFetches(apiLines);
  check(
    `every fetch( call site in lib/api.ts is routed through reportIfUnauthorized/toJson within ${LOOKAHEAD_LINES} lines${offenders.length ? ` (offending line(s): ${offenders.join(", ")})` : ""}`,
    offenders.length === 0
  );
}

// ── 7. The scanner above is not fooled by a decoy comment mentioning
//      "reportIfUnauthorized(" near a fetch that is genuinely ungated —
//      the exact false-clean the A124 review reproduced ────────────────
{
  const decoyLines = [
    "  someDecoyCall: () =>",
    "    fetch(`${API_BASE}/decoy/route`, {",
    "      method: \"DELETE\",",
    "      headers: authHeaders(),",
    "    }).then((r) => {",
    "      // TODO: reportIfUnauthorized( should go here once this route needs it",
    "      if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);",
    "      return r.json();",
    "    }),",
  ];
  const offenders = scanApiTsForUngatedFetches(decoyLines);
  check(
    "a decoy comment containing 'reportIfUnauthorized(' does not clear an actually-ungated fetch",
    offenders.length === 1 && offenders[0] === 2
  );
}

// ── 8. Exemption matcher tightening (A124 review #2): pathname.endsWith(exempt)
//      used to exempt ANYTHING ending in an exempt suffix — "/push/health"
//      read as exempt purely because it ends in "/health". The matcher now
//      strips only a leading "/api" and requires EXACT equality ─────────
{
  const probes = [
    { url: "https://api.example.com/push/health", exempt: false, label: '/push/health must NOT be exempt (old endsWith("/health") false positive)' },
    { url: "https://api.example.com/api/auth/google", exempt: true, label: "/api/auth/google (leading /api stripped) must be exempt" },
    { url: "https://api.example/auth/google", exempt: true, label: "https://api.example/auth/google (no /api prefix) must be exempt" },
    { url: "https://api.example.com/auth/google/native-something", exempt: false, label: "/auth/google/native-something must NOT be exempt" },
  ];
  for (const { url, exempt, label } of probes) {
    resetUnauthorizedGate();
    let fireCount = 0;
    setUnauthorizedHandler(() => { fireCount += 1; });
    fetchImpl = async () => fakeResponse({ status: 401, url });
    await expectRejects(api.getProfile());
    check(label, exempt ? fireCount === 0 : fireCount === 1);
  }
}

// ── 9. A118: a 401 on POST /auth/logout (token already revoked, e.g. another
//      device signed out everywhere first) must NOT raise the "signed out on
//      another device" hook on the device that tapped logout ───────────
{
  resetUnauthorizedGate();
  let fireCount = 0;
  setUnauthorizedHandler(() => { fireCount += 1; });
  setToken("session-logout");
  let calledUrl = null;
  fetchImpl = async (url, init) => {
    calledUrl = String(url);
    return fakeResponse({ status: 401, url: "https://api.example.com/auth/logout" });
  };
  const err = await expectRejects(api.logout());
  check("api.logout() hits /auth/logout and still rejects on 401 (caller clears locally)", err instanceof Error && calledUrl.endsWith("/auth/logout"));
  check("a 401 on /auth/logout does NOT invoke the unauthorized handler", fireCount === 0);
  clearToken();
}

// ── 10. A118: the 401 handler and the revalidate 401 branch in AuthProvider
//       must sign out LOCALLY only. Calling the server-revoking logout()
//       there would send a pointless request with a dead token, and a stray
//       401 on an unrelated route would sign out EVERY device ───────────
{
  const authPath = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "components", "AuthProvider.tsx");
  // Strip comments so prose mentioning logout() can't satisfy or fail the scan.
  const src = readFileSync(authPath, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  function block(startNeedle) {
    const i = src.indexOf(startNeedle);
    if (i < 0) return null;
    const open = src.indexOf("{", i + startNeedle.length - 1);
    let depth = 0;
    for (let j = open; j < src.length; j++) {
      if (src[j] === "{") depth++;
      else if (src[j] === "}" && --depth === 0) return src.slice(open, j + 1);
    }
    return null;
  }
  const handlerBlock = block("setUnauthorizedHandler(() => {");
  const revalBlock = block("if (res.status === 401) {");
  check("found the 401 handler and the revalidate 401 branch in AuthProvider", !!handlerBlock && !!revalBlock);
  const callsServerLogout = (b) => /(^|[^.\w])logout\s*\(|api\.logout\s*\(/.test(b || "");
  check("the A124 401 handler does not call logout()/api.logout() (no revoke-everywhere on a stray 401)", !callsServerLogout(handlerBlock));
  check("the revalidate 401 branch does not call logout()/api.logout()", !callsServerLogout(revalBlock));
  check("both use clearLocalSession()", /clearLocalSession\(\)/.test(handlerBlock || "") && /clearLocalSession\(\)/.test(revalBlock || ""));
}

// ── 11. A118: api.logout() carries an abort timeout so a hung connection
//       cannot leave the user stuck on Sign out ─────────────────────────
{
  const apiSrc = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "lib", "api.ts"), "utf8");
  const i = apiSrc.indexOf("logout: async () => {");
  const body = i < 0 ? "" : apiSrc.slice(i, i + 700);
  check("api.logout() uses an AbortController with a timeout and passes its signal", /new AbortController\(\)/.test(body) && /setTimeout\(/.test(body) && /signal:\s*controller\.signal/.test(body));
}

// ── 12. A120: logout() drops the device push registration before the
//       server revoke; clearLocalSession() tears it down locally only ──────
{
  const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
  const strip = (t) => t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  const src = strip(readFileSync(path.join(root, "components", "AuthProvider.tsx"), "utf8"));
  const push = strip(readFileSync(path.join(root, "lib", "capacitorPush.ts"), "utf8"));
  const fnBody = (needle) => {
    const i = src.indexOf(needle);
    if (i < 0) return "";
    const open = src.indexOf("{", i);
    let depth = 0;
    for (let j = open; j < src.length; j++) {
      if (src[j] === "{") depth++;
      else if (src[j] === "}" && --depth === 0) return src.slice(open, j + 1);
    }
    return "";
  };
  const logoutBody = fnBody("async function logout()");
  const localBody = fnBody("function clearLocalSession()");
  const iPush = logoutBody.indexOf("unregisterCapacitorPush(");
  const iApi = logoutBody.indexOf("api.logout(");
  check("logout() calls unregisterCapacitorPush() before api.logout()", iPush >= 0 && iApi > iPush);
  check("logout() bounds the push unregister with a timeout race", /Promise\.race\(/.test(logoutBody) && /setTimeout\(/.test(logoutBody));
  check("clearLocalSession() tears push down locally with remote:false", /unregisterCapacitorPush\(\{\s*remote:\s*false\s*\}\)/.test(localBody));
  const resync = strip(readFileSync(path.join(root, "components", "NativePushResync.tsx"), "utf8"));
  check("NativePushResync reads the user from useAuth and its effect depends on the email",
    /useAuth\(\)/.test(resync) && /\},\s*\[email\]\)/.test(resync));
  check("NativePushResync re-POSTs the existing browser subscription on sign-in (web resync)",
    /getSubscription\(\)/.test(resync) && /api\.subscribePush\(/.test(resync) && /if \(email\) resyncWebPush\(\)/.test(resync));
  check("logout() clears its push race timer", /clearTimeout\(pushTimer\)/.test(logoutBody));
  check("unregisterCapacitorPush skips the network DELETE when remote is false", /if \(remote\)/.test(push) && /resyncCompleted = false/.test(push));
}

if (failures > 0) {
  console.error(`\n${failures} check(s) failed.`);
  process.exit(1);
} else {
  console.log("\nAll checks passed.");
}
