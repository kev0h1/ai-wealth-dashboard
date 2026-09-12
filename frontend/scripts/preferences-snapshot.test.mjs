// Plain-Node test for lib/preferencesSnapshot.ts (G62), same framework-free
// pattern as scripts/preference-save.test.mjs, scripts/serial-queue.test.mjs
// and scripts/preferences-version.test.mjs — imports the real production
// modules (lib/preferencesSnapshot.ts, lib/preferenceSave.ts,
// lib/serialQueue.ts) rather than a re-implementation of any of them.
//
// THE DEFECT, FIRST PASS (G62): components/PreferencesContext.tsx's six
// field savers (hide_net_worth, dark_mode, pay_period_config, region,
// debt_target_months, debt_tracking_start) each run a failure-path
// `reconcile()` after a failed save. Before the first fix, every one of
// those six called `refreshPreferences()`, which fetches GET /preferences
// AND applies every field to local state as a side effect — so if field A
// is still mid-PATCH (optimistically applied, save() not yet settled) when
// field B's save fails, B's reconcile fetch could carry a STALE value for A
// (A's in-flight PATCH hadn't bumped the version yet, so the stale
// snapshot still passed the freshness gate) and silently stomp A's
// optimistic value. Worse: A's own success path never re-applies A's value
// once its save() finally resolves (createPreferenceSaver only re-applies
// on the OPTIMISTIC path and the FAILURE path, never again on success —
// see lib/preferenceSave.ts), so the wrong, stomped value stuck for the
// rest of the session and in localStorage.
//
// First fix: `loadPreferences` was split into `fetchGatedSnapshot`
// (fetch + version-gate only, never applies anything) and
// `applyWholeDocument` (applies every field), and each of the six fields'
// OWN `reconcile` was rewired (via `makeFieldReconcile` below) to call the
// scoped fetch alone, extracting only its own key.
//
// THE DEFECT, REVIEW #1 (G62): that first pass only rewired the six
// fields' OWN reconciles. `refreshPreferences()` still composes the fetch
// WITH `applyWholeDocument`, and it has FOUR OTHER callers, all in
// app/settings/SettingsPage.tsx — the Penny consent revoke (B13, ~line
// 379), and the failure-path reconciles of the child benefit (G58, ~line
// 730), cover-plan (G45, ~line 790) and notification prefs (G52, ~line
// 841) toggles — none of which reconcile one of the six fields above, so
// none were touched by the first pass. Every one of those four can still
// land mid-save on one of the six fields and stomp it: flip dark mode (its
// PATCH in flight, version not yet bumped), then let a notification toggle
// fail in that window — its catch calls refreshPreferences(), which
// reapplies dark mode from a snapshot that still passes the freshness
// gate. Same bug, different door.
//
// Second fix: `applyWholeDocument` now takes an optional per-field `skip`
// map, and `loadPreferences` (which both the mount effect and
// `refreshPreferences()` — and so all four callers above — go through)
// builds it from each of the six savers' own `isSaving` flag
// (`createPreferenceSaver` already exposes this). A field currently
// authoring its own value is left untouched by ANY whole-document apply,
// regardless of who triggered it, closing the hole for every caller,
// present and future, without SettingsPage.tsx needing any change.
//
// Four things below prove this, using real production code:
//  1. Unit tests for `fetchGatedSnapshot`, `makeFieldReconcile` and
//     `applyWholeDocument` (including its `skip` map) in isolation.
//  2. The FIRST scenario (field B's OWN reconcile stomping field A),
//     proving the first fix: "bug" mode reconstructs the pre-fix shape,
//     "fixed" mode drives the REAL `makeFieldReconcile`.
//  3. The SECOND scenario (review #1's hole): a caller that is not any of
//     the six fields' own reconcile — modelling SettingsPage.tsx's four
//     `refreshPreferences()` callers — invokes the real `applyWholeDocument`
//     while field A is mid-save, once with no `skip` guard (the exact
//     shape every one of those four callers exercised before review #1's
//     fix) and once with the real skip guard wired, proving A survives
//     only when the guard is present.
//  4. STATIC checks on the real components/PreferencesContext.tsx source:
//     every one of its six reconcile lines must build from the real
//     `makeFieldReconcile(fetchPreferencesSnapshot, ...)` and never call
//     `refreshPreferences()`; and its `loadPreferences` must call
//     `applyWholeDocument` with a skip map that reads every one of the six
//     savers' `isSaving.current` — this is what actually fails if either
//     fix is reverted, since scenarios 2 and 3 only prove the underlying
//     primitives, not which shape the real file wires up.
//
// Run with:
//   node --no-warnings --experimental-strip-types scripts/preferences-snapshot.test.mjs
// or:
//   npm run -s check:preferences-snapshot

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { fetchGatedSnapshot, applyWholeDocument, makeFieldReconcile } from "../lib/preferencesSnapshot.ts";
import { shouldAcceptPreferencesSnapshot } from "../lib/preferencesVersion.ts";
import { createPreferenceSaver } from "../lib/preferenceSave.ts";
import { createSerialQueue } from "../lib/serialQueue.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const frontendRoot = path.resolve(__dirname, "..");

let failures = 0;
function check(label, cond) {
  if (!cond) {
    failures += 1;
    console.error(`FAIL: ${label}`);
  } else {
    console.log(`PASS: ${label}`);
  }
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const noopCallbacks = () => ({
  applyHideNetWorth: () => {},
  applyDarkMode: () => {},
  applyPayPeriodConfig: () => {},
  applyRegion: () => {},
  applyDebtTargetMonths: () => {},
  applyDebtTrackingStart: () => {},
  setSpendWidgets: () => {},
  setHomePinnedWidget: () => {},
  setDebtBurndownOverrides: () => {},
  setRawPrefs: () => {},
});

// ── Part 1: fetchGatedSnapshot / makeFieldReconcile / applyWholeDocument,
//    in isolation ──────────────────────────────────────────────────────

async function testFetchGatedSnapshotAppliesFreshnessGate() {
  const versionHolder = { current: 5 };
  const stale = await fetchGatedSnapshot(async () => ({ hide_net_worth: true, version: 3 }), versionHolder, shouldAcceptPreferencesSnapshot);
  check("a snapshot older than the last accepted version is discarded", stale === null);
  check("the version holder is unchanged by a discarded snapshot", versionHolder.current === 5);

  const fresh = await fetchGatedSnapshot(async () => ({ hide_net_worth: true, version: 9 }), versionHolder, shouldAcceptPreferencesSnapshot);
  check("a snapshot newer than the last accepted version is returned", fresh && fresh.hide_net_worth === true);
  check("the version holder advances on an accepted snapshot", versionHolder.current === 9);
}

async function testFetchGatedSnapshotSwallowsFetchFailure() {
  const versionHolder = { current: 0 };
  const result = await fetchGatedSnapshot(async () => {
    throw new Error("network");
  }, versionHolder, shouldAcceptPreferencesSnapshot);
  check("a failed fetch resolves to null rather than throwing", result === null);
}

async function testMakeFieldReconcileExtractsOnlyItsOwnKey() {
  const reconcileDarkMode = makeFieldReconcile(async () => ({ hide_net_worth: true, dark_mode: false }), "dark_mode");
  check("makeFieldReconcile extracts exactly the requested key", (await reconcileDarkMode()) === false);

  const reconcileMissing = makeFieldReconcile(async () => ({ hide_net_worth: true }), "region");
  check("makeFieldReconcile returns undefined for a key absent from the snapshot", (await reconcileMissing()) === undefined);

  const reconcileNoServer = makeFieldReconcile(async () => null, "dark_mode");
  check("makeFieldReconcile returns undefined when the fetch itself yields nothing", (await reconcileNoServer()) === undefined);
}

function testApplyWholeDocumentAppliesEveryFieldWithNoSkip() {
  const applied = [];
  const cb = {
    applyHideNetWorth: (v) => applied.push(["hide_net_worth", v]),
    applyDarkMode: (v) => applied.push(["dark_mode", v]),
    applyPayPeriodConfig: (v) => applied.push(["pay_period_config", v]),
    applyRegion: (v) => applied.push(["region", v]),
    applyDebtTargetMonths: (v) => applied.push(["debt_target_months", v]),
    applyDebtTrackingStart: (v) => applied.push(["debt_tracking_start", v]),
    setSpendWidgets: (v) => applied.push(["spend_widgets", v]),
    setHomePinnedWidget: (v) => applied.push(["home_pinned_widget", v]),
    setDebtBurndownOverrides: (v) => applied.push(["debt_burndown_overrides", v]),
    setRawPrefs: (v) => applied.push(["rawPrefs", v]),
  };
  applyWholeDocument(
    { hide_net_worth: true, dark_mode: false, region: "UK", spend_widgets: ["a"], home_pinned_widget: "w" },
    cb
  );
  check(
    "applyWholeDocument with no skip map applies every field (mount hydration's shape — nothing is in flight yet)",
    applied.some((e) => e[0] === "hide_net_worth" && e[1] === true) &&
      applied.some((e) => e[0] === "dark_mode" && e[1] === false) &&
      applied.some((e) => e[0] === "region" && e[1] === "UK") &&
      applied.some((e) => e[0] === "rawPrefs")
  );
}

function testApplyWholeDocumentSkipsOnlyTheGuardedField() {
  const applied = [];
  const cb = {
    ...noopCallbacks(),
    applyHideNetWorth: (v) => applied.push(["hide_net_worth", v]),
    applyDarkMode: (v) => applied.push(["dark_mode", v]),
    applyRegion: (v) => applied.push(["region", v]),
  };
  applyWholeDocument(
    { hide_net_worth: true, dark_mode: false, region: "UK" },
    cb,
    { darkMode: () => true } // only dark_mode is "saving"
  );
  check("a field whose skip guard returns true is never applied", !applied.some((e) => e[0] === "dark_mode"));
  check("a field with no skip guard (or one returning false) is still applied", applied.some((e) => e[0] === "hide_net_worth"));
  check("an unrelated field is unaffected by another field's skip guard", applied.some((e) => e[0] === "region"));
}

// ── Part 2: field B's OWN failure reconciling must never touch field A —
//    the first G62 fix. A tiny fake localStorage + field harness, reused
//    by Part 3 below. ──────────────────────────────────────────────────

function makeFakeLocalStorage() {
  const store = new Map();
  return {
    setItem: (k, v) => store.set(k, v),
    getItem: (k) => (store.has(k) ? store.get(k) : null),
  };
}

// Builds one field's local-state + localStorage-mirroring apply(), the
// same shape as PreferencesContext.tsx's own applyHideNetWorth/
// applyDarkMode wrappers.
function makeField(storageKey, storage) {
  const state = { value: false };
  const events = [];
  return {
    state,
    events,
    getCurrent: () => state.value,
    apply: (v) => {
      state.value = v;
      storage.setItem(storageKey, v ? "1" : "0");
      events.push(`apply:${v}`);
    },
  };
}

// Runs the field-B-fails scenario once, in either "bug" mode (B's
// reconcile mirrors the OLD refreshPreferences()-based reconcile: fetch
// AND side-effect-apply every field via applyWholeDocument with no skip
// map) or "fixed" mode (B's reconcile IS the real `makeFieldReconcile`).
async function runOwnFieldReconcileScenario(mode) {
  const storage = makeFakeLocalStorage();
  const fieldA = makeField("wd_hide_balances", storage); // hide_net_worth-shaped
  const fieldB = makeField("wd_dark", storage); // dark_mode-shaped
  const versionHolder = { current: -1 };

  const serverDoc = { hide_net_worth: false, dark_mode: false, version: 0 };
  const fetchServerDoc = async () => ({ ...serverDoc });
  const fetchSnapshot = () => fetchGatedSnapshot(fetchServerDoc, versionHolder, shouldAcceptPreferencesSnapshot);

  let resolveASave;
  const saverA = createPreferenceSaver({
    queue: createSerialQueue(),
    getCurrent: fieldA.getCurrent,
    apply: fieldA.apply,
    save: () =>
      new Promise((resolve) => {
        resolveASave = resolve; // held open — A is "mid-PATCH" until the test resolves this
      }),
    reconcile: makeFieldReconcile(fetchSnapshot, "hide_net_worth"),
  });

  const saverB = createPreferenceSaver({
    queue: createSerialQueue(),
    getCurrent: fieldB.getCurrent,
    apply: fieldB.apply,
    save: async () => {
      throw new Error("B's save fails");
    },
    reconcile:
      mode === "bug"
        ? // The shape every one of the six reconciles had BEFORE the first
          // fix: fetch, then apply the WHOLE document with no skip guard
          // (as refreshPreferences()/loadPreferences() did before either
          // fix), THEN separately extract this field's own value.
          async () => {
            const server = await fetchSnapshot();
            if (server) {
              applyWholeDocument(server, { ...noopCallbacks(), applyHideNetWorth: fieldA.apply });
            }
            return server ? server.dark_mode : undefined;
          }
        : // The current, fixed shape: the REAL makeFieldReconcile, fetch
          // only, never touches A.
          makeFieldReconcile(fetchSnapshot, "dark_mode"),
  });

  const aRun = saverA.run(true);
  await delay(5);
  check(`[own-field/${mode}] A's optimistic value is applied while its save is in flight`, fieldA.state.value === true);
  check(`[own-field/${mode}] localStorage reflects A's optimistic value while in flight`, storage.getItem("wd_hide_balances") === "1");

  await saverB.run(true);

  if (mode === "bug") {
    check(
      "[own-field/bug] reproduces the first G62 defect: B's reconcile side-effect stomps A's still-in-flight optimistic value",
      fieldA.state.value === false
    );
    check("[own-field/bug] localStorage is stomped right along with the in-memory state", storage.getItem("wd_hide_balances") === "0");
  } else {
    check("[own-field/fixed] B's reconcile does NOT touch A's still-in-flight optimistic value", fieldA.state.value === true);
    check("[own-field/fixed] localStorage still reflects A's untouched optimistic value", storage.getItem("wd_hide_balances") === "1");
  }

  serverDoc.hide_net_worth = true;
  serverDoc.version = 1;
  resolveASave({ version: 1 });
  await aRun;

  if (mode === "bug") {
    check(
      "[own-field/bug] the stomped value STICKS even after A's own save succeeds — createPreferenceSaver's success path never re-applies",
      fieldA.state.value === false
    );
    check("[own-field/bug] localStorage still carries the wrong, stuck value", storage.getItem("wd_hide_balances") === "0");
  } else {
    check("[own-field/fixed] A's value is correctly true after its own save succeeds", fieldA.state.value === true);
    check("[own-field/fixed] localStorage matches", storage.getItem("wd_hide_balances") === "1");
  }
}

// ── Part 3: THE REVIEW #1 SCENARIO — a caller that reconciles a DIFFERENT
//    field entirely (modelling SettingsPage.tsx's child benefit / cover-
//    plan / notification-prefs failure paths, or the Penny consent revoke,
//    all of which call refreshPreferences()) must not stomp a field that
//    is mid-save, and this must hold with NO changes at those call sites —
//    only `applyWholeDocument`'s own `skip` map decides it. ─────────────

async function runExternalCallerScenario(withGuard) {
  const storage = makeFakeLocalStorage();
  const fieldA = makeField("wd_hide_balances", storage); // hide_net_worth-shaped
  const versionHolder = { current: -1 };

  const serverDoc = { hide_net_worth: false, dark_mode: false, version: 0 };
  const fetchServerDoc = async () => ({ ...serverDoc });
  const fetchSnapshot = () => fetchGatedSnapshot(fetchServerDoc, versionHolder, shouldAcceptPreferencesSnapshot);

  let resolveASave;
  const saverA = createPreferenceSaver({
    queue: createSerialQueue(),
    getCurrent: fieldA.getCurrent,
    apply: fieldA.apply,
    save: () =>
      new Promise((resolve) => {
        resolveASave = resolve; // held open — A is "mid-PATCH"
      }),
    reconcile: makeFieldReconcile(fetchSnapshot, "hide_net_worth"),
  });

  // This mirrors PreferencesContext.tsx's loadPreferences()/
  // refreshPreferences() — the REAL applyWholeDocument, called by
  // something that is NOT field A's own reconcile (in production: the
  // Penny consent revoke, or the child benefit/cover-plan/notification
  // prefs failure paths reconciling THEIR OWN unrelated field). Called
  // here with a skip map only when `withGuard` is true, so this test
  // exercises the exact optional-third-argument contract the real
  // `applyWholeDocument` has today.
  async function externalRefresh() {
    const server = await fetchSnapshot();
    if (!server) return null;
    applyWholeDocument(
      server,
      { ...noopCallbacks(), applyHideNetWorth: fieldA.apply },
      withGuard ? { hideNetWorth: () => saverA.isSaving.current } : undefined
    );
    return server;
  }

  const aRun = saverA.run(true);
  await delay(5);
  check(`[external-caller/guard=${withGuard}] A's optimistic value applied while mid-save`, fieldA.state.value === true);

  // An unrelated caller refreshes the whole document RIGHT NOW, while A is
  // still mid-save and the server still has A's old, pre-write value
  // (no version bump yet either, so it passes the freshness gate) — this
  // is review #1's exact reproduction, just via a caller other than a
  // field's own reconcile.
  await externalRefresh();

  if (withGuard) {
    check(
      "[external-caller/guard=true] the skip guard protects A from an unrelated caller's whole-document apply (review #1's fix)",
      fieldA.state.value === true
    );
    check("[external-caller/guard=true] localStorage still reflects A's untouched value", storage.getItem("wd_hide_balances") === "1");
  } else {
    check(
      "[external-caller/guard=false] reproduces review #1's defect: an unrelated caller's whole-document apply stomps A even though A's own reconcile was never involved",
      fieldA.state.value === false
    );
    check("[external-caller/guard=false] localStorage is stomped too", storage.getItem("wd_hide_balances") === "0");
  }

  serverDoc.hide_net_worth = true;
  serverDoc.version = 1;
  resolveASave({ version: 1 });
  await aRun;

  if (withGuard) {
    check("[external-caller/guard=true] A is correctly true after its own save succeeds", fieldA.state.value === true);
  } else {
    check(
      "[external-caller/guard=false] the stomped value STICKS even after A's own save succeeds (no changes at the caller were needed to prove this)",
      fieldA.state.value === false
    );
  }
}

// ── Part 4: static guards on the real PreferencesContext.tsx source —
//    what actually fails if either fix is reverted. ─────────────────────
//
// H36: the two functions below used to be substring searches — "does
// makeFieldReconcile(..., '<key>')" appear anywhere in the file, "does
// '<saver>.isSaving.current'" appear anywhere in loadPreferences. Both
// pass just as happily if a copy-paste swap pairs one field's key with
// ANOTHER field's saver (e.g. hideNetWorthSaver wired to reconcile
// "dark_mode", darkModeSaver wired to reconcile "hide_net_worth"; or the
// skip map's `hideNetWorth` guard reading `darkModeSaver.isSaving.current`
// and vice versa) — every expected substring is still present, just
// attached to the wrong field. That is exactly the six-near-identical-
// lines mistake this item exists to catch, so every check below binds a
// field's key to its OWN saver, not to the set of keys/savers in the file
// as a whole.
//
// Block extraction is a balanced-delimiter scan rather than a fixed
// end-anchor or an indentation-sensitive pattern, so reformatting
// (reordering an object's properties, reindenting, wrapping a line) can't
// make it silently find zero blocks or the wrong one — a prior review
// flagged exactly that failure mode for a regex-based block extraction.

function extractBalanced(src, openIndex, openChar, closeChar) {
  if (src[openIndex] !== openChar) return null;
  let depth = 0;
  for (let i = openIndex; i < src.length; i += 1) {
    if (src[i] === openChar) depth += 1;
    else if (src[i] === closeChar) {
      depth -= 1;
      if (depth === 0) return src.slice(openIndex, i + 1);
    }
  }
  return null; // unbalanced source — caller must treat this as "not found", not crash
}

// The full `const <saverVarName> = useRef(createPreferenceSaver<...>({
// ... })).current;` call for one saver, found by balanced-paren scan from
// the `(` right after `useRef` through its matching `)` — independent of
// how the object literal inside is formatted.
function extractSaverBlock(src, saverVarName) {
  const declPrefix = `const ${saverVarName} = useRef`;
  const declIndex = src.indexOf(declPrefix);
  if (declIndex === -1) return null;
  const openParenIndex = src.indexOf("(", declIndex + declPrefix.length);
  if (openParenIndex === -1) return null;
  return extractBalanced(src, openParenIndex, "(", ")");
}

// The `{ ... }` body of `const <fnName> = useCallback((...) => { ... },
// [...])`, found by balanced-brace scan from the function body's opening
// brace — independent of what is defined before or after it in the file.
function extractCallbackBody(src, fnName) {
  const declPrefix = `const ${fnName} = useCallback`;
  const declIndex = src.indexOf(declPrefix);
  if (declIndex === -1) return null;
  const braceIndex = src.indexOf("{", declIndex + declPrefix.length);
  if (braceIndex === -1) return null;
  return extractBalanced(src, braceIndex, "{", "}");
}

// The six fields, each with: its server-document key, its saver variable
// name, and the key it should use in loadPreferences' skip map.
const FIELD_SAVER_PAIRS = [
  { key: "hide_net_worth", saverVar: "hideNetWorthSaver", skipKey: "hideNetWorth" },
  { key: "dark_mode", saverVar: "darkModeSaver", skipKey: "darkMode" },
  { key: "pay_period_config", saverVar: "payPeriodConfigSaver", skipKey: "payPeriodConfig" },
  { key: "region", saverVar: "regionSaver", skipKey: "region" },
  { key: "debt_target_months", saverVar: "debtTargetMonthsSaver", skipKey: "debtTargetMonths" },
  { key: "debt_tracking_start", saverVar: "debtTrackingStartSaver", skipKey: "debtTrackingStart" },
];

function testRealContextFileWiresEachFieldToMakeFieldReconcile() {
  const contextSrc = readFileSync(path.join(frontendRoot, "components/PreferencesContext.tsx"), "utf-8");

  // Whole-file sanity: exactly six reconcile-via-makeFieldReconcile call
  // sites, covering exactly the expected keys. This does NOT by itself
  // prove each key is wired to its own saver — a swap between two fields'
  // keys leaves the count and the set both unchanged — which is what the
  // per-saver loop below is for.
  const reconcileLines = [
    ...contextSrc.matchAll(/reconcile:\s*makeFieldReconcile<[^>]+>\(fetchPreferencesSnapshot,\s*"([a-z_]+)"\)/g),
  ].map((m) => m[1]);
  check("components/PreferencesContext.tsx wires exactly six fields through makeFieldReconcile", reconcileLines.length === 6);
  check(
    "the six fields wired are exactly the expected set",
    JSON.stringify([...reconcileLines].sort()) === JSON.stringify(FIELD_SAVER_PAIRS.map((f) => f.key).sort())
  );
  check(
    "no reconcile in the file calls the whole-document refreshPreferences() (the first G62 defect)",
    !/reconcile: async \(\) => \{[\s\S]*?refreshPreferences\(\)/.test(contextSrc)
  );

  // Per-saver binding: each saver's OWN useRef(createPreferenceSaver(...))
  // block must contain a makeFieldReconcile call for THAT saver's own
  // key, not merely a makeFieldReconcile call for the right key
  // *somewhere in the file*. This is what catches a copy-paste swap
  // (hideNetWorthSaver reconciling "dark_mode", darkModeSaver reconciling
  // "hide_net_worth") that the two whole-file checks above would miss.
  for (const { key, saverVar } of FIELD_SAVER_PAIRS) {
    const block = extractSaverBlock(contextSrc, saverVar);
    check(`${saverVar}'s createPreferenceSaver block is found in the real file`, block !== null);
    if (!block) continue;
    const ownReconciles = [
      ...block.matchAll(/reconcile:\s*makeFieldReconcile<[^>]+>\(fetchPreferencesSnapshot,\s*"([a-z_]+)"\)/g),
    ];
    check(`${saverVar} has exactly one reconcile: makeFieldReconcile(...) call in its own block`, ownReconciles.length === 1);
    check(
      `${saverVar}'s reconcile is wired to its own key "${key}", not a swapped field's key`,
      ownReconciles.length === 1 && ownReconciles[0][1] === key
    );
  }
}

function testRealLoadPreferencesGuardsEverySaverWithIsSaving() {
  const contextSrc = readFileSync(path.join(frontendRoot, "components/PreferencesContext.tsx"), "utf-8");
  const body = extractCallbackBody(contextSrc, "loadPreferences");
  check("loadPreferences's body is found in the real file (balanced-brace extraction, order- and indentation-agnostic)", body !== null);
  if (!body) return;

  check("loadPreferences calls applyWholeDocument", body.includes("applyWholeDocument("));

  // Per-field binding: the skip map must pair EACH field's own key with
  // THAT field's own saver's isSaving flag, not merely mention both the
  // key and the saver substring somewhere in the function. A copy-paste
  // swap — pairing `hideNetWorth` with `darkModeSaver.isSaving.current`
  // and `darkMode` with `hideNetWorthSaver.isSaving.current` — leaves
  // every one of the six `<saver>.isSaving.current` substrings present
  // (the exact regression this item exists to close) but fails every one
  // of the checks below, because none of the six pairings would match.
  for (const { saverVar, skipKey } of FIELD_SAVER_PAIRS) {
    const pairPattern = new RegExp(`\\b${skipKey}\\s*:\\s*\\(\\)\\s*=>\\s*${saverVar}\\.isSaving\\.current\\b`);
    check(
      `loadPreferences' skip map pairs "${skipKey}" with its own ${saverVar}.isSaving.current, not a swapped field's saver`,
      pairPattern.test(body)
    );
  }
}

async function main() {
  await testFetchGatedSnapshotAppliesFreshnessGate();
  await testFetchGatedSnapshotSwallowsFetchFailure();
  await testMakeFieldReconcileExtractsOnlyItsOwnKey();
  testApplyWholeDocumentAppliesEveryFieldWithNoSkip();
  testApplyWholeDocumentSkipsOnlyTheGuardedField();

  await runOwnFieldReconcileScenario("bug");
  await runOwnFieldReconcileScenario("fixed");

  await runExternalCallerScenario(false);
  await runExternalCallerScenario(true);

  testRealContextFileWiresEachFieldToMakeFieldReconcile();
  testRealLoadPreferencesGuardsEverySaverWithIsSaving();

  if (failures > 0) {
    console.error(`\n${failures} failure(s).`);
    process.exit(1);
  }
  console.log("\nAll preferences-snapshot checks passed.");
}

main();
