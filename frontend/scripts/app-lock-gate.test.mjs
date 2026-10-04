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

// ── 7. Review of A121 at 4513aff9: components/BiometricLock.tsx's
//      `attemptUnlock` is async and awaits real I/O (the hardware
//      availability check, the native OS prompt) — a remote sign-out, or
//      any other unmount, can land mid-await, and a stale continuation
//      calling `setLockedState(true)`/`setAppLocked(true)` after that
//      point would leave the shared lock signal stuck true with no lock
//      screen left mounted to ever clear it, stranding the NEXT sign-in
//      behind lib/api.ts's AppLockedError gate — the same class of bug the
//      A125 unmount-reset effect closes for an ordinary sign-out, but this
//      one is a genuine RACE (a resolved-after-unmount promise
//      continuation), not something a synchronous unmount effect alone can
//      catch, since the continuation runs strictly AFTER that effect's own
//      cleanup already fired.
//
// This logic can't be pulled out as a pure function the way the cold-start
// /resume-timeout decisions were (lib/appLockTiming.ts): it's genuinely
// entangled with real async I/O (isAvailable(), the native authenticate()
// prompt) that only exists on a device. What CAN be verified off-device is
// that the guard is actually present at each point a stale continuation
// could otherwise slip through — a static source assertion, the same
// spirit as the fetch-gate scan above, just checking for a specific
// sentinel (`if (!mountedRef.current) return;`) rather than a call shape.
//
// The check is DIRECTIONAL, not a fixed-size window either side of the
// dangerous line: for each danger zone (the synchronous code between one
// await/entry point and the next), scan forward from that anchor and ask
// "is the FIRST thing found a guard, or a mutating call?" — a guard found
// before any mutator passes; a mutator found before any guard fails, even
// if a guard exists further away (e.g. protecting an EARLIER, unrelated
// danger zone) — see check 8 below for the false-positive a naive nearby
// -window check let through during review of this exact test.
const MUTATORS = ["setLockedState(", "setLockEnabled(", "setAwaitingAuth(", "setAutoDisabledNotice(", "setErrorMessage("];
const GUARD = "if (!mountedRef.current) return;";

function firstGuardBeforeFirstMutation(lines, anchorIndex, endIndex) {
  for (let i = anchorIndex + 1; i < endIndex; i++) {
    // Stripped, not raw: a prose comment explaining WHY the guard matters
    // (this file has several, quoting `setLockedState(true)` etc. in
    // backticks) would otherwise read as a real mutating line and falsely
    // fail a zone that is, in fact, correctly guarded.
    const line = stripLineForScan(lines[i]);
    if (line.includes(GUARD)) return true; // guard found before any mutation in this zone
    if (MUTATORS.some((m) => line.includes(m))) return false; // mutation found first — not guarded
  }
  return false; // neither found before endIndex — treat as unguarded
}

{
  const bioLockPath = path.join(SCAN_ROOT, "components", "BiometricLock.tsx");
  const bioSource = readFileSync(bioLockPath, "utf8");
  const bioLines = bioSource.split("\n");

  function firstLineIndexContaining(needle, fromIndex = 0) {
    for (let i = fromIndex; i < bioLines.length; i++) {
      if (bioLines[i].includes(needle)) return i;
    }
    return -1;
  }

  const declIndex = firstLineIndexContaining("const mountedRef = useRef(true)");
  ok("mounted guard: mountedRef is declared as a ref (not state)", declIndex >= 0);

  // The unmount effect that resets it — outside attemptUnlock entirely,
  // paired with the A125 setAppLocked(false) reset.
  const unmountResetIndex = firstLineIndexContaining("mountedRef.current = false;");
  ok("mounted guard: an unmount effect sets mountedRef.current = false", unmountResetIndex >= 0);

  const attemptUnlockStart = firstLineIndexContaining("const attemptUnlock = useCallback(async () => {");
  ok("mounted guard: attemptUnlock is found", attemptUnlockStart >= 0);
  const attemptUnlockEnd = firstLineIndexContaining("}, [setLockedState]);", attemptUnlockStart + 1);
  ok("mounted guard: attemptUnlock's closing brace is found", attemptUnlockEnd > attemptUnlockStart);

  // Zone 1 — entry: the very first check in the function body, before the
  // single-flight guard, before anything else — catches a call that races
  // the unmount itself (e.g. a resume listener callback already in flight).
  ok(
    "mounted guard: attemptUnlock's entry has a mountedRef guard before any state mutation",
    firstGuardBeforeFirstMutation(bioLines, attemptUnlockStart, attemptUnlockEnd)
  );

  // Zone 2 — after `await isAvailable()`, before the `!supported` branch's
  // own mutating calls. Bounded at the NEXT await (the authenticate() one),
  // not attemptUnlockEnd, so this zone can't accidentally pass by finding
  // the LATER guard meant for zone 3 instead of its own.
  const isAvailableIndex = firstLineIndexContaining("await isAvailable()", attemptUnlockStart);
  ok("mounted guard: isAvailable() call site is found inside attemptUnlock", isAvailableIndex > attemptUnlockStart && isAvailableIndex < attemptUnlockEnd);
  const authAwaitIndex = firstLineIndexContaining("ok = await withTimeout(", isAvailableIndex + 1);
  ok("mounted guard: the authenticate() await is found inside attemptUnlock", authAwaitIndex > isAvailableIndex && authAwaitIndex < attemptUnlockEnd);
  ok(
    "mounted guard: a mountedRef guard is the first thing after await isAvailable(), before the !supported branch's own mutations",
    firstGuardBeforeFirstMutation(bioLines, isAvailableIndex, authAwaitIndex)
  );

  // Zone 3 — after the authenticate() await settles (past its own
  // `finally` cleanup), before `setAwaitingAuth(false); setLockedState(!ok)`
  // — the actual finding: a failed/cancelled prompt resolving after unmount
  // must not reach setLockedState(!ok).
  const setLockedNotOkIndex = firstLineIndexContaining("setLockedState(!ok);", attemptUnlockStart);
  ok("mounted guard: setLockedState(!ok) call site is found inside attemptUnlock", setLockedNotOkIndex > authAwaitIndex && setLockedNotOkIndex < attemptUnlockEnd);
  ok(
    "mounted guard: a mountedRef guard is the first thing after the authenticate() await settles, before setLockedState(!ok)",
    firstGuardBeforeFirstMutation(bioLines, authAwaitIndex, attemptUnlockEnd)
  );

  // Zone 4 — inside the timeout/error `catch` block, before its own
  // setAwaitingAuth(false)/setErrorMessage(...).
  const catchIndex = firstLineIndexContaining("} catch {", attemptUnlockStart);
  ok("mounted guard: attemptUnlock's catch block is found", catchIndex > attemptUnlockStart && catchIndex < attemptUnlockEnd);
  ok(
    "mounted guard: a mountedRef guard is the first thing inside the catch block, before its own setAwaitingAuth(false)",
    firstGuardBeforeFirstMutation(bioLines, catchIndex, attemptUnlockEnd)
  );

  // G203 presentation setters: the first statement after `await isAvailable()`
  // is the mounted guard, and setBiometryType( / setFailure( only ever follow
  // a mounted guard inside their own block.
  const nextCode = (from) => {
    for (let i = from + 1; i < attemptUnlockEnd; i++) {
      const t = bioLines[i].trim();
      if (t && !t.startsWith("//")) return i;
    }
    return -1;
  };
  const firstAfterAvail = nextCode(isAvailableIndex);
  ok(
    "G203: the first statement after await isAvailable() is `if (!mountedRef.current) return;`",
    firstAfterAvail > 0 && bioLines[firstAfterAvail].trim() === "if (!mountedRef.current) return;"
  );
  const setterLines = [];
  for (let i = attemptUnlockStart; i < attemptUnlockEnd; i++) {
    if (/\b(setBiometryType|setFailure)\(/.test(bioLines[i])) setterLines.push(i);
  }
  ok("G203: setBiometryType( and setFailure( call sites are found (3)", setterLines.length === 3);
  for (const i of setterLines) {
    // Walk back through this block and its enclosing blocks (skipping closed
    // sibling blocks); a mounted guard must precede the setter on that path.
    let depth = 0;
    let guarded = false;
    for (let j = i - 1; j >= attemptUnlockStart; j--) {
      const l = bioLines[j];
      if (depth === 0 && l.trim() === "if (!mountedRef.current) return;") {
        guarded = true;
        break;
      }
      // A guard from before an await proves nothing about state after it.
      if (/\bawait\b/.test(l)) break;
      for (const ch of l.split("").reverse()) {
        if (ch === "}") depth++;
        if (ch === "{") depth = Math.max(0, depth - 1); // stepped out into the enclosing block, keep walking
      }
      // A line like "} catch {" / "} else {" steps out of its own block and
      // then, walking back, past the closing brace of a SIBLING block, which
      // the char loop above already counted (depth 1), so that sibling's
      // guards are skipped rather than credited.
    }
    ok(`G203: ${bioLines[i].trim()} (line ${i + 1}) sits after a mounted guard in its block`, guarded);
  }
}

// ── 8. The mounted-guard scan above is not fooled by a decoy that has A
//      guard somewhere in the function but not covering the actual
//      dangerous line — proven the same way check 5 proves the fetch
//      scanner isn't fooled by a decoy comment. This decoy has a real,
//      correctly-placed guard after isAvailable() (zone 2), but the
//      regression under test is a MISSING guard for zone 3 (after the
//      authenticate() await, before setLockedState(!ok)) — an earlier
//      review pass of this exact test used a fixed-size nearby-line window
//      instead of this directional scan, and that window was wide enough
//      to let zone 2's real guard "cover" zone 3's missing one purely by
//      proximity. This decoy is what caught that. ───────────────────────
{
  const decoyLines = [
    "const attemptUnlock = useCallback(async () => {",
    "  if (!mountedRef.current) return;",
    "  if (!nativePlatform() || !isLockEnabled()) {",
    "    setLockedState(false);",
    "    return;",
    "  }",
    "  try {",
    "    const { supported } = await isAvailable();",
    "    if (!mountedRef.current) return;",
    "    let ok = false;",
    "    ok = await withTimeout(authenticate('Unlock Sorted'), AUTH_TIMEOUT_MS);",
    "    // regression: no mountedRef check here before the dangerous call",
    "    setAwaitingAuth(false);",
    "    setLockedState(!ok);",
    "  } catch {",
    "    setAwaitingAuth(false);",
    "  }",
    "}, [setLockedState]);",
  ];
  const decoyAuthAwaitIndex = decoyLines.findIndex((l) => l.includes("ok = await withTimeout("));
  const decoyGuardedZone3 = firstGuardBeforeFirstMutation(decoyLines, decoyAuthAwaitIndex, decoyLines.length);
  check("mounted guard scanner: a regression missing zone 3's guard is NOT read as guarded", decoyGuardedZone3, false);

  // Sanity: the SAME decoy's zone 2 (after isAvailable(), before the
  // authenticate() await) genuinely IS guarded — proves the scanner isn't
  // just failing everything.
  const decoyIsAvailableIndex = decoyLines.findIndex((l) => l.includes("await isAvailable()"));
  const decoyGuardedZone2 = firstGuardBeforeFirstMutation(decoyLines, decoyIsAvailableIndex, decoyAuthAwaitIndex);
  check("mounted guard scanner: the decoy's own correctly-guarded zone 2 still reads as guarded", decoyGuardedZone2, true);
}

if (failures > 0) {
  console.error(`\n${failures} check(s) failed.`);
  process.exit(1);
} else {
  console.log("\nAll checks passed.");
}
