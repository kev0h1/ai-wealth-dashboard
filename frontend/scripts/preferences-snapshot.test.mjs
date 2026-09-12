// Plain-Node test for lib/preferencesSnapshot.ts (G62), same framework-free
// pattern as scripts/preference-save.test.mjs, scripts/serial-queue.test.mjs
// and scripts/preferences-version.test.mjs — imports the real production
// modules (lib/preferencesSnapshot.ts, lib/preferenceSave.ts,
// lib/serialQueue.ts) rather than a re-implementation of any of them.
//
// THE DEFECT THIS PROVES FIXED (G62): components/PreferencesContext.tsx's
// six field savers (hide_net_worth, dark_mode, pay_period_config, region,
// debt_target_months, debt_tracking_start) each run a failure-path
// `reconcile()` after a failed save. Before this fix, every one of those
// six called `refreshPreferences()`, which fetches GET /preferences AND
// applies every field to local state as a side effect — so if field A is
// still mid-PATCH (optimistically applied, save() not yet settled) when
// field B's save fails, B's reconcile fetch can carry a STALE value for A
// (the in-flight PATCH hasn't bumped the version yet, so the stale
// snapshot still passes the freshness gate) and silently stomp A's
// optimistic value. Worse: A's own success path never re-applies A's value
// once its save() finally resolves (createPreferenceSaver only re-applies
// on the OPTIMISTIC path and the FAILURE path, never again on success —
// see lib/preferenceSave.ts), so the wrong, stomped value sticks for the
// rest of the session and in localStorage.
//
// The fix splits the one function that used to do both jobs
// (`loadPreferences`) into `fetchGatedSnapshot` (fetch + version-gate only,
// never applies anything) and `applyWholeDocument` (applies every field —
// correct for mount hydration, wrong for a single field's reconcile).
// Every field's `reconcile` now calls `fetchPreferencesSnapshot` (built
// from `fetchGatedSnapshot` alone) instead of `refreshPreferences` (which
// still composes both, via `loadPreferences`, for mount hydration and its
// other caller, SettingsPage's Penny consent revoke).
//
// Two things below prove this, using real production code:
//  1. A DYNAMIC scenario, using the real `createPreferenceSaver` +
//     `createSerialQueue` + `fetchGatedSnapshot` + `applyWholeDocument`,
//     modelling exactly two fields (A = hide_net_worth-shaped, B =
//     dark_mode-shaped) sharing one server document and one version
//     counter, run once in "bug mode" (B's reconcile calls
//     fetchGatedSnapshot THEN applyWholeDocument — the literal shape
//     `refreshPreferences()` had) and once in "fixed mode" (B's reconcile
//     calls fetchGatedSnapshot alone) — proving the mechanism.
//  2. A STATIC check on the real components/PreferencesContext.tsx source:
//     every one of its six `reconcile` blocks must call
//     `fetchPreferencesSnapshot()` and must NOT call `refreshPreferences()`
//     — this is what actually fails if someone reverts the real fix, since
//     the dynamic scenario above only tests the underlying primitive, not
//     which one the real file wires up.
//
// Run with:
//   node --no-warnings --experimental-strip-types scripts/preferences-snapshot.test.mjs
// or:
//   npm run -s check:preferences-snapshot

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { fetchGatedSnapshot, applyWholeDocument } from "../lib/preferencesSnapshot.ts";
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

// ── Part 1: fetchGatedSnapshot / applyWholeDocument, in isolation ────────

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

function testApplyWholeDocumentAppliesEveryField() {
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
    "applyWholeDocument calls every field's apply callback, this is the behaviour mount hydration relies on",
    applied.some((e) => e[0] === "hide_net_worth" && e[1] === true) &&
      applied.some((e) => e[0] === "dark_mode" && e[1] === false) &&
      applied.some((e) => e[0] === "region" && e[1] === "UK") &&
      applied.some((e) => e[0] === "rawPrefs")
  );
}

// ── Part 2: the actual G62 scenario — field A mid-save, field B's failure
//    reconciles, A's optimistic value must survive, in localStorage too. ──

// A tiny fake localStorage, so the harness can assert the SAME localStorage
// contract PreferencesContext.tsx's own applyHideNetWorth/applyDarkMode
// wrappers keep: whatever value is applied is also the value localStorage
// holds, on every path (optimistic, reconciled, and the eventual success
// settle), never just some of them.
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

// Runs the exact G62 scenario once, in either "bug" mode (B's reconcile
// mirrors the OLD refreshPreferences()-based reconcile: fetch AND
// side-effect-apply every field via applyWholeDocument) or "fixed" mode
// (B's reconcile mirrors the CURRENT fetchPreferencesSnapshot()-based one:
// fetch only, apply nothing but its own field, which createPreferenceSaver
// itself then applies from the returned value). Everything else — the real
// createPreferenceSaver, the real per-field createSerialQueue, the real
// fetchGatedSnapshot — is identical between the two runs.
async function runScenario(mode) {
  const storage = makeFakeLocalStorage();
  const fieldA = makeField("wd_hide_balances", storage); // hide_net_worth-shaped
  const fieldB = makeField("wd_dark", storage); // dark_mode-shaped
  const versionHolder = { current: -1 };

  // The fake server: A's write only lands once its save() is manually
  // resolved (modelling "still mid-PATCH"); B's write is forced to fail
  // and never lands at all.
  const serverDoc = { hide_net_worth: false, dark_mode: false, version: 0 };
  const fetchServerDoc = async () => ({ ...serverDoc });

  let resolveASave;
  const saverA = createPreferenceSaver({
    queue: createSerialQueue(),
    getCurrent: fieldA.getCurrent,
    apply: fieldA.apply,
    save: () =>
      new Promise((resolve) => {
        resolveASave = resolve; // held open — A is "mid-PATCH" until the test resolves this
      }),
    reconcile: async () => {
      const server = await fetchGatedSnapshot(fetchServerDoc, versionHolder, shouldAcceptPreferencesSnapshot);
      return server ? server.hide_net_worth : undefined;
    },
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
        ? // The shape every one of the six reconciles had BEFORE this fix:
          // fetch, then apply the WHOLE document (as refreshPreferences()/
          // loadPreferences() did) as a side effect, THEN separately
          // extract this field's own value.
          async () => {
            const server = await fetchGatedSnapshot(fetchServerDoc, versionHolder, shouldAcceptPreferencesSnapshot);
            if (server) {
              applyWholeDocument(server, {
                applyHideNetWorth: fieldA.apply,
                applyDarkMode: () => {}, // B applies its own value itself, via createPreferenceSaver's return path
                applyPayPeriodConfig: () => {},
                applyRegion: () => {},
                applyDebtTargetMonths: () => {},
                applyDebtTrackingStart: () => {},
                setSpendWidgets: () => {},
                setHomePinnedWidget: () => {},
                setDebtBurndownOverrides: () => {},
                setRawPrefs: () => {},
              });
            }
            return server ? server.dark_mode : undefined;
          }
        : // The current, fixed shape: fetch only, never touch A.
          async () => {
            const server = await fetchGatedSnapshot(fetchServerDoc, versionHolder, shouldAcceptPreferencesSnapshot);
            return server ? server.dark_mode : undefined;
          },
  });

  // A starts saving (optimistic apply(true) fires immediately) but its
  // save() will not settle until we resolve it below — modelling "field A
  // is mid-save".
  const aRun = saverA.run(true);
  await delay(5);
  check(`[${mode}] A's optimistic value is applied while its save is in flight`, fieldA.state.value === true);
  check(`[${mode}] localStorage reflects A's optimistic value while in flight`, storage.getItem("wd_hide_balances") === "1");

  // B's save fails, which fires B's reconcile — a GET against the server,
  // which still shows hide_net_worth: false because A's write has not
  // landed yet (no version bump either), so it passes the freshness gate.
  await saverB.run(true);

  if (mode === "bug") {
    check(
      "[bug] reproduces the G62 defect: B's reconcile side-effect stomps A's still-in-flight optimistic value back to the stale server value",
      fieldA.state.value === false
    );
    check(
      "[bug] localStorage is stomped right along with the in-memory state (G62's exact user-facing symptom)",
      storage.getItem("wd_hide_balances") === "0"
    );
  } else {
    check(
      "[fixed] B's reconcile does NOT touch A's still-in-flight optimistic value",
      fieldA.state.value === true
    );
    check(
      "[fixed] localStorage still reflects A's untouched optimistic value",
      storage.getItem("wd_hide_balances") === "1"
    );
  }

  // A's own save now finally succeeds — the server catches up.
  serverDoc.hide_net_worth = true;
  serverDoc.version = 1;
  resolveASave({ version: 1 });
  await aRun;

  if (mode === "bug") {
    check(
      "[bug] the stomped value STICKS even after A's own save succeeds — createPreferenceSaver's success path never re-applies (this is the 'survives until a full reload' symptom)",
      fieldA.state.value === false
    );
    check("[bug] localStorage still carries the wrong, stuck value", storage.getItem("wd_hide_balances") === "0");
  } else {
    check("[fixed] A's value is correctly true after its own save succeeds", fieldA.state.value === true);
    check("[fixed] localStorage matches", storage.getItem("wd_hide_balances") === "1");
  }
}

// ── Part 3: static guard on the real PreferencesContext.tsx source — the
//    part that actually fails if the real fix is reverted, since Part 2
//    only proves the underlying primitive, not which one the real file
//    calls. ──────────────────────────────────────────────────────────────

function testRealContextFileWiresReconcileToTheScopedFetch() {
  const contextSrc = readFileSync(path.join(frontendRoot, "components/PreferencesContext.tsx"), "utf-8");
  const reconcileBlocks = [...contextSrc.matchAll(/reconcile: async \(\) => \{([\s\S]*?)\n    \},/g)].map(
    (m) => m[1]
  );
  check(
    "components/PreferencesContext.tsx defines exactly six field-saver reconcile callbacks",
    reconcileBlocks.length === 6
  );
  reconcileBlocks.forEach((block, i) => {
    check(
      `reconcile block #${i + 1} calls the scoped fetchPreferencesSnapshot()`,
      block.includes("fetchPreferencesSnapshot()")
    );
    check(
      `reconcile block #${i + 1} does NOT call the whole-document refreshPreferences() (the G62 defect)`,
      !block.includes("refreshPreferences()")
    );
  });
}

async function main() {
  await testFetchGatedSnapshotAppliesFreshnessGate();
  await testFetchGatedSnapshotSwallowsFetchFailure();
  testApplyWholeDocumentAppliesEveryField();
  await runScenario("bug");
  await runScenario("fixed");
  testRealContextFileWiresReconcileToTheScopedFetch();

  if (failures > 0) {
    console.error(`\n${failures} failure(s).`);
    process.exit(1);
  }
  console.log("\nAll preferences-snapshot checks passed.");
}

main();
