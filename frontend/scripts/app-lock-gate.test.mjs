// Plain-Node test for A121 (pentest IOS-07/IOS-03, HIGH) follow-up work,
// plus A125 (raised by the independent review of A121: the app-lock request
// gate lives in a module-scoped fetch shadow inside lib/api.ts, and while
// it covers every call in that file, nothing stopped a future component
// from calling the global `fetch` directly against an authenticated
// endpoint and silently escaping the gate).
//
// scripts/app-lock.test.mjs already covers the gate's core contract in
// depth (an authenticated call issues no fetch and rejects with
// AppLockedError while locked, then succeeds once unlocked, including the
// /auth/logout exemption) — this file does not repeat that in full, only a
// light end-to-end check of the same story (section 1 below), and adds the
// three things that file does not cover:
//
//   1. (light) locked state blocks a gated call and unlocks it after auth.
//   2. Cold start starts locked — lib/appLockTiming.ts's isColdStartLocked.
//   3. A resume past the timeout re-locks, one that doesn't is ignored —
//      lib/appLockTiming.ts's shouldRelockOnResume.
//   4. A21 25: a static source scan across the whole frontend tree (not
//      just lib/api.ts) — an ungated `fetch(` call site talking to the API
//      from outside lib/api.ts is caught, closing the structural gap the
//      A121 review raised rather than just documenting it as a convention.
//
// What this file does NOT prove: BiometricLock.tsx's actual mount/effect
// wiring (no jsdom/DOM implementation is installed in this repo's plain
// -Node test runner — see app-lock-inert.test.mjs's own header for the
// same constraint), or anything about the real WebKit hit-testing behaviour
// the pentest finding was filed over. Those need the device retest.
//
// Run with:
//   npm run -s check:app-lock-gate
// or:
//   node --no-warnings --experimental-strip-types --experimental-loader ./scripts/_ts-extensionless-loader.mjs scripts/app-lock-gate.test.mjs

import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isAppLocked, setAppLocked } from "../lib/appLock";
import { api, AppLockedError } from "../lib/api";
import { isColdStartLocked, shouldRelockOnResume, MIN_HIDDEN_MS } from "../lib/appLockTiming";

let failures = 0;

function check(label, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) {
    failures += 1;
    console.error(`FAIL: ${label}\n  expected: ${e}\n  actual:   ${a}`);
  } else {
    console.log(`PASS: ${label}`);
  }
}

function ok(label, cond) {
  check(label, !!cond, true);
}

// ── 1. (light) locked state blocks a gated call, unlocks after auth ─────

function fakeOkResponse(body) {
  return { ok: true, status: 200, json: async () => body };
}

{
  const realFetch = globalThis.fetch;
  let callCount = 0;
  globalThis.fetch = async () => {
    callCount += 1;
    return fakeOkResponse([]);
  };
  try {
    ok("gate: starts unlocked", !isAppLocked());
    await api.getInvestmentAccounts();
    check("gate: unlocked call issues a fetch", callCount, 1);

    setAppLocked(true); // simulate the lock engaging (cold start / re-lock)
    let rejectedWith = null;
    try {
      await api.getInvestmentAccounts();
    } catch (e) {
      rejectedWith = e;
    }
    ok("gate: call while locked rejects with AppLockedError", rejectedWith instanceof AppLockedError);
    check("gate: no fetch issued while locked", callCount, 1);

    setAppLocked(false); // simulate a successful biometric auth
    await api.getInvestmentAccounts();
    check("gate: same call after auth succeeds issues a fresh fetch", callCount, 2);
  } finally {
    globalThis.fetch = realFetch;
    setAppLocked(false);
  }
}

// ── 2. Cold start starts locked ──────────────────────────────────────────

check("cold start: native platform + lock enabled -> locked", isColdStartLocked(true, true), true);
check("cold start: native platform + lock disabled -> not locked", isColdStartLocked(true, false), false);
check("cold start: web (not native) + lock enabled -> not locked (pref is native-only)", isColdStartLocked(false, true), false);
check("cold start: web + lock disabled -> not locked", isColdStartLocked(false, false), false);

// ── 3. A resume past the timeout re-locks; one that doesn't is ignored ──

check(
  `resume: hiddenFor 0ms (no matching pause / spurious event) does not re-lock`,
  shouldRelockOnResume(0),
  false
);
check(
  `resume: hiddenFor just under MIN_HIDDEN_MS (${MIN_HIDDEN_MS - 1}ms) does not re-lock`,
  shouldRelockOnResume(MIN_HIDDEN_MS - 1),
  false
);
check(
  `resume: hiddenFor exactly MIN_HIDDEN_MS (${MIN_HIDDEN_MS}ms) re-locks`,
  shouldRelockOnResume(MIN_HIDDEN_MS),
  true
);
check(
  `resume: hiddenFor well past MIN_HIDDEN_MS re-locks`,
  shouldRelockOnResume(MIN_HIDDEN_MS * 30),
  true
);

// ── 4. A125: static source scan — every `fetch(` call site anywhere in the
//      frontend tree that talks to the backend API is either inside
//      lib/api.ts (this gate's own home) or goes through its exported
//      `gatedFetch`/`api.*` surface, never the bare global `fetch`. ───────
//
// Two structural exclusions, both narrow and named rather than a broad
// directory skip, so a new file added later is scanned by default:
//   - lib/api.ts itself: the gate's own implementation legitimately calls
//     `globalThis.fetch` once, directly — that IS the choke point, not a
//     bypass of it.
//   - `route.ts`/`route.tsx` files under app/: by Next.js App Router
//     convention these are server-only Route Handlers (the OAuth provider
//     callbacks, e.g. app/auth/finexer/callback/route.ts) — they run on
//     the Next.js server, never inside the device's WebView, so the
//     client-side lib/appLock.ts signal (a plain module-scope variable in
//     the CLIENT bundle) has no meaning there at all; gating them would be
//     a no-op at best and a misleading comment at worst.
// A file that defines its OWN local `fetch` identifier (`const fetch = `/
// `function fetch(`) shadows the global one for every BARE `fetch()` call
// site inside it — components/GoalsStrip.tsx and
// components/UpcomingBillsStrip.tsx both do this today (a
// `useCallback`-wrapped refetch helper, unrelated to the network
// primitive, always invoked as `fetch();` with no arguments). This used to
// skip the whole FILE once such a declaration was found anywhere in it —
// review of this item found that let a planted `globalThis.fetch(...)`
// elsewhere in the SAME file read as clean, since the file-level skip never
// looked at that line at all. Narrowed to a per-line exclusion instead,
// the way GATE_DEFINITION_LINE_RE (scripts/global-401.test.mjs) narrowly
// excludes lib/api.ts's own two fetch-primitive lines rather than the
// whole file: only the shadow's own declaration line, and a BARE call to
// it (`fetch()`, no arguments — the shadow here is a no-arg callback, and
// the real `fetch` always needs at least a URL, so a bare call can never
// be a real network request either way) are excluded. `globalThis.fetch(`,
// `window.fetch(`, or any `fetch(` call carrying an argument still gets
// flagged, local shadow or not — see the GoalsStrip decoy in check 6 below
// for the case this closes.
const SCAN_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const SCAN_DIRS = ["app", "components", "lib"];
const FETCH_CALL_RE = /\bfetch\(/;
const LOCAL_FETCH_DECL_RE = /^\s*(const fetch = |function fetch\()/;
const LOCAL_FETCH_BARE_CALL_RE = /\bfetch\(\s*\)/;

function stripLineForScan(line) {
  const trimmed = line.trim();
  if (trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*")) return "";
  return line.replace(/(?<!:)\/\/.*$/, "");
}

function listSourceFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === ".next") continue;
    const full = path.join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      out.push(...listSourceFiles(full));
    } else if (/\.(ts|tsx)$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

/** Pure per-file scan, exported in spirit (not literally — this is a plain
 * Node test file, not a module) so check 6 below can exercise it directly
 * against synthetic content shaped like GoalsStrip.tsx, the same way
 * scanApiTsForUngatedFetches in global-401.test.mjs is exercised against a
 * synthetic decoy rather than only ever running against real files on
 * disk. `relPath` is used only for the two structural exclusions
 * (lib/api.ts itself, server-only route.ts/route.tsx) and for labelling an
 * offender's location. */
function scanFileForUngatedFetches(relPath, source) {
  if (relPath === path.join("lib", "api.ts")) return []; // the gate's own home
  const basename = path.basename(relPath);
  if (basename === "route.ts" || basename === "route.tsx") return []; // server-only

  const offenders = [];
  const lines = source.split("\n");
  lines.forEach((line, i) => {
    const stripped = stripLineForScan(line);
    if (!FETCH_CALL_RE.test(stripped)) return;
    if (LOCAL_FETCH_DECL_RE.test(stripped)) return; // the local shadow's own declaration
    if (LOCAL_FETCH_BARE_CALL_RE.test(stripped)) return; // a bare call — `globalThis.fetch()`/`window.fetch()` with truly no argument would ALSO match this, but neither is a real request (fetch() with no URL throws) and neither appears anywhere in this codebase today
    offenders.push(`${relPath}:${i + 1}`);
  });
  return offenders;
}

function scanFrontendForUngatedFetches() {
  const offenders = [];
  for (const dir of SCAN_DIRS) {
    const absDir = path.join(SCAN_ROOT, dir);
    let files;
    try {
      files = listSourceFiles(absDir);
    } catch {
      continue;
    }
    for (const file of files) {
      const rel = path.relative(SCAN_ROOT, file);
      const source = readFileSync(file, "utf8");
      offenders.push(...scanFileForUngatedFetches(rel, source));
    }
  }
  return offenders;
}

{
  const offenders = scanFrontendForUngatedFetches();
  check(
    `no bare fetch( call site talks to the API outside lib/api.ts${offenders.length ? ` (offender(s): ${offenders.join(", ")})` : ""}`,
    offenders.length === 0 ? "none" : offenders,
    "none"
  );
}

// ── 5. The scanner is not fooled by a comment mentioning "fetch(" near a
//      genuinely clean call, and DOES catch a real decoy ─────────────────
{
  const decoyClean = ["  // TODO: consider calling fetch( here one day", "  gatedFetch(`${API_BASE}/decoy`);"];
  const cleanOffenders = decoyClean
    .map((line, i) => (FETCH_CALL_RE.test(stripLineForScan(line)) ? i : -1))
    .filter((i) => i >= 0);
  check("scanner: a comment-only mention of fetch( is not flagged", cleanOffenders.length, 0);

  const decoyBypass = ["  someDecoyCall: () =>", "    fetch(`${API_BASE}/decoy/route`).then((r) => r.json()),"];
  const bypassOffenders = decoyBypass
    .map((line, i) => (FETCH_CALL_RE.test(stripLineForScan(line)) ? i : -1))
    .filter((i) => i >= 0);
  check("scanner: a genuine raw fetch( call is flagged", bypassOffenders.length, 1);
}

// ── 6. The GoalsStrip decoy (review of A121 at 4513aff9): a file shaped
//      exactly like components/GoalsStrip.tsx — a local `const fetch = `
//      shadow, called bare elsewhere in the file — used to read entirely
//      clean under the old whole-file skip even with a planted
//      `globalThis.fetch(...)` sitting right next to it. Verified
//      red-then-green against the fix: this reproduces red against the
//      PRE-fix `LOCAL_FETCH_SHADOW_RE`-whole-file-skip logic (the file-level
//      `if (LOCAL_FETCH_SHADOW_RE.test(source)) continue;` would have
//      skipped this synthetic file outright, reporting zero offenders) and
//      green against scanFileForUngatedFetches above, which is what
//      scanFrontendForUngatedFetches now actually calls. ───────────────
{
  const decoyGoalsStrip = [
    "export function GoalsStrip() {",
    "  const fetch = useCallback(() => {",
    "    setLoading(true);",
    "  }, []);",
    "",
    "  useEffect(() => { fetch(); }, [fetch]);",
    "",
    "  // Planted decoy: bypasses the local shadow above via globalThis,",
    "  // reaching the REAL network fetch — must still be caught.",
    "  globalThis.fetch(`${API_BASE}/decoy-bypass`);",
    "",
    "  return null;",
    "}",
  ].join("\n");

  const offenders = scanFileForUngatedFetches(path.join("components", "GoalsStrip.tsx"), decoyGoalsStrip);
  check(
    `GoalsStrip decoy: the planted globalThis.fetch( is caught despite the local shadow (offenders: ${JSON.stringify(offenders)})`,
    offenders.length === 1 && offenders[0] === `${path.join("components", "GoalsStrip.tsx")}:10`,
    true
  );
}

if (failures > 0) {
  console.error(`\n${failures} check(s) failed.`);
  process.exit(1);
} else {
  console.log("\nAll checks passed.");
}
