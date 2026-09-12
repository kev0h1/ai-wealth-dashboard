#!/usr/bin/env node
// G45 — manual, browser-driven proof for the review blockers that cannot
// be exercised without a real browser + a real backend (this repo has no
// frontend test harness; the coordinator asked that this be kept in the
// branch, not built into one). Three scenarios, one per blocker found
// across three review rounds.
//
// BLOCKER 1 (serialized writes): toggle A's PATCH is still in flight when
// toggle B fires; if A later fails, its failure path must not wipe B's
// already-succeeded write. Fixed by lib/serialQueue.ts (SettingsPage.tsx
// never fires two cover-plan PATCHes concurrently), reconciling a failure
// from the SERVER instead of a captured `previous` snapshot, AND (found
// while building THIS proof script, not in the original review) a second,
// more subtle bug in the same area: the rawPrefs-driven sync effect can
// fire asynchronously, on React's own render schedule, AFTER a later
// queued toggle's own optimistic update — silently reapplying an
// already-stale reconciliation on top of newer state. Fixed with
// `lastSyncedRawPrefsRef` in SettingsPage.tsx (see that ref's own comment).
//
// BLOCKER 2 (freshness signal): a GET /preferences issued at app boot can
// resolve AFTER a PATCH that already landed, carrying a stale pre-toggle
// snapshot. Fixed by a monotonic `version` on the preferences document
// (backend/app/routers/preferences.py) and a client-side freshness rule
// (frontend/lib/preferencesVersion.ts, wired into
// frontend/components/PreferencesContext.tsx) that discards any snapshot
// older than the last one accepted — including one from a slow GET that
// predates a since-completed PATCH.
//
// BLOCKER 3 (third re-review, no-else fallback): runCoverToggle's catch
// reconciles from the server on a failed PATCH, but had no `else` on
// `if (server) { ... }` — if the reconciling GET ALSO failed, or its
// snapshot was discarded as stale, the optimistic (unsaved) change stayed
// on screen forever, next to a "could not save" message. Fixed by falling
// back to `previous` (the pre-toggle value already captured at the top of
// runCoverToggle) in that else branch, so the screen can never show an
// unsaved change as saved. See scenarioDoubleFailure below.
//
// WHY THIS CAN'T BE A COMMITTED, CI-RUN TEST
// This repo has no frontend test harness (no jest/vitest/testing-library).
// Reproducing these races needs a real running backend, a REAL PRODUCTION
// BUILD of this frontend, a same-origin reverse proxy in front of it
// (mirrors UAT's own nginx /api/ proxy, since the backend's CORS allowlist
// doesn't include arbitrary localhost ports), a synthetic test user with
// real manual accounts, and Chrome DevTools Protocol request interception
// to force response ordering deterministically. None of that is available
// to an automated `npm test` in this repo today.
//
// WHY THIS SCRIPT SHIMS THE `version` FIELD ITSELF
// The live backend this script talks to may not yet have the `version`
// field deployed (this branch's own backend change can't be exercised live
// without either restarting the shared `wealth-api` service — forbidden —
// or running a second backend process, which would require copying
// production secrets — refused by design). So this script performs every
// real GET/PATCH itself (real Mongo reads/writes happen, and are asserted
// against at the end) but AUGMENTS each JSON response with a `version`
// field from its own monotonic counter before handing it to the browser —
// faithfully simulating "the backend fix is deployed" without needing a
// second real backend. The backend's OWN version logic (does `version`
// actually advance on write, does GET reflect what PATCH just wrote) is
// covered separately and directly by
// backend/tests/test_preferences_versioning.py, run against the real
// production preferences.py.
//
// The PURE LOGIC underneath both fixes is ALSO covered by committed,
// framework-free tests that run in seconds with plain Node:
//   frontend/scripts/serial-queue.test.mjs        (blocker 1's primitive)
//   frontend/scripts/preferences-version.test.mjs (blocker 2's primitive)
// This script proves the INTEGRATION on top of those: that
// SettingsPage.tsx and PreferencesContext.tsx actually wire them up
// correctly end-to-end, against a real API for everything except the one
// field the live backend doesn't carry yet.
//
// PREREQUISITES:
//
//  1. A real backend running and reachable (UAT uses :8000; this script
//     talks to it only through the same-origin proxy below).
//  2. A PRODUCTION build of this frontend (`npm run build`, no
//     NEXT_PUBLIC_API_URL override — leave API_BASE as the default "/api"
//     so it matches this proxy's shape), served via
//     `node node_modules/.bin/next start -p 3132` (an inner port; this
//     script talks to it via the proxy below, not directly).
//  3. A tiny same-origin reverse proxy in front of it (mirrors UAT's own
//     nginx config: everything under /api/ goes to the backend, everything
//     else to the Next.js server), e.g.:
//
//       node -e '
//         const http = require("http");
//         const FRONTEND = { host: "127.0.0.1", port: 3132 };
//         const BACKEND  = { host: "127.0.0.1", port: 8000 };
//         http.createServer((req, res) => {
//           const toApi = req.url.startsWith("/api/") || req.url === "/api";
//           const target = toApi ? BACKEND : FRONTEND;
//           const path = toApi ? (req.url.replace(/^\/api/, "") || "/") : req.url;
//           const p = http.request({ ...target, path, method: req.method,
//             headers: { ...req.headers, host: `${target.host}:${target.port}` } },
//             (r) => { res.writeHead(r.statusCode, r.headers); r.pipe(res); });
//           p.on("error", (e) => { res.writeHead(502); res.end(String(e)); });
//           req.pipe(p);
//         }).listen(3131);
//       '
//
//  4. A synthetic test user (never a real one — this touches real Mongo
//     documents): mint a session token signed with the backend's actual
//     .session_secret, e.g.:
//
//       cd backend && .venv/bin/python -c "
//       from itsdangerous import URLSafeTimedSerializer
//       secret = open('.session_secret').read().strip()
//       print(URLSafeTimedSerializer(secret).dumps({'email': 'YOUR-TEST-EMAIL', 'name': 'Test'}))
//       "
//
//     then, with that token, via curl against the real backend:
//       - PUT /profile with {"full_name": "...", "complete": true} (skips
//         onboarding, which otherwise redirects /settings away).
//       - POST /manual-accounts twice with {"name": ..., "account_type":
//         "current", "balance": ...} to get two real, cover-eligible
//         account ids for ACCOUNT_1_ID / ACCOUNT_2_ID below.
//
//  5. puppeteer-core (this repo doesn't depend on it; install it somewhere
//     e.g. `npm install puppeteer-core` in a scratch directory) plus a
//     locally installed Chrome/Chromium binary.
//
//  6. AFTER running this script, clean up: DELETE both manual accounts,
//     and delete the synthetic user's preferences/profile/data-version
//     documents directly (this script does not do this for you, since it
//     has no direct Mongo access).
//
// USAGE:
//   PPTR_MODULE_PATH=/path/to/puppeteer-core \
//   CHROME_PATH=/usr/bin/google-chrome \
//   TOKEN=<minted token> \
//   ACCOUNT_1_ID=<manual account id> \
//   ACCOUNT_2_ID=<other manual account id> \
//   APP_URL=http://localhost:3131 \
//     node scripts/manual/g45-preferences-race-proof.mjs
//
// Exits 0 if all scenarios pass, 1 otherwise. Prints a clear PASS/FAIL per
// assertion either way.

import { createRequire } from "module";

const require = createRequire(import.meta.url);

const PPTR_MODULE_PATH = process.env.PPTR_MODULE_PATH;
const CHROME_PATH = process.env.CHROME_PATH || "/usr/bin/google-chrome";
const TOKEN = process.env.TOKEN;
const ACCOUNT_1 = process.env.ACCOUNT_1_ID;
const ACCOUNT_2 = process.env.ACCOUNT_2_ID;
const APP_URL = process.env.APP_URL || "http://localhost:3131";

if (!PPTR_MODULE_PATH || !TOKEN || !ACCOUNT_1 || !ACCOUNT_2) {
  console.error(
    "Missing required env vars. Need PPTR_MODULE_PATH, TOKEN, ACCOUNT_1_ID, ACCOUNT_2_ID " +
      "(APP_URL and CHROME_PATH have defaults). See this file's header comment for how to obtain them."
  );
  process.exit(2);
}

const puppeteer = require(PPTR_MODULE_PATH);

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
  return new Promise((r) => setTimeout(r, ms));
}

async function realPatch(ids) {
  const res = await fetch(`${APP_URL}/api/preferences`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify({ cover_plan_excluded_accounts: ids }),
  });
  return res.json();
}
async function realGet() {
  const res = await fetch(`${APP_URL}/api/preferences`, { headers: { Authorization: `Bearer ${TOKEN}` } });
  return res.json();
}
async function realAccounts() {
  const res = await fetch(`${APP_URL}/api/accounts`, { headers: { Authorization: `Bearer ${TOKEN}` } });
  return res.json();
}

async function newPage(browser) {
  const page = await browser.newPage();
  await page.setViewport({ width: 420, height: 1400 });
  await page.evaluateOnNewDocument((token) => {
    localStorage.setItem("wealth_session_token", token);
  }, TOKEN);
  return page;
}

async function gotoSettingsAndWaitForCard(page) {
  await page.goto(`${APP_URL}/settings`, { waitUntil: "domcontentloaded", timeout: 30000 }).catch(() => {});
  await page.waitForFunction(() => document.body.innerText.includes("Where cover money can come from"), {
    timeout: 15000,
  });
  await delay(300);
}

function ariaChecked(page, label) {
  return page.evaluate((l) => {
    const btn = document.querySelector(`button[aria-label*="${l}"]`);
    return btn ? btn.getAttribute("aria-checked") : null;
  }, label);
}

// ── Scenario 1: a stale, late-resolving GET /preferences must not clobber a
//    fresher local write (blocker 2 — the version-freshness rule). ────────
async function scenarioStaleGet(browser, account1Label) {
  console.log("\n=== Scenario 1: stale GET must not clobber a fresher local write ===");
  await realPatch([]); // real reset, real Mongo write

  const page = await newPage(browser);
  let heldGetRequest = null;
  let toggleRequestBody = null;
  const BASE_VERSION = 100; // arbitrary, isolated from scenario 2's counter

  await page.setRequestInterception(true);
  page.on("request", async (req) => {
    const url = req.url();
    const isPreferences = url.includes("/api/preferences");
    if (req.method() === "GET" && isPreferences && !heldGetRequest) {
      heldGetRequest = req; // hold the app-boot mount GET, release it later
      return;
    }
    if (req.method() === "PATCH" && isPreferences) {
      const body = JSON.parse(req.postData() || "{}");
      toggleRequestBody = body;
      const real = await realPatch(body.cover_plan_excluded_accounts); // real write
      await req.respond({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ...real, version: BASE_VERSION + 1 }), // simulates the fixed backend
      });
      return;
    }
    req.continue();
  });

  await gotoSettingsAndWaitForCard(page);
  check("mount GET captured and held", !!heldGetRequest);

  await page.evaluate((label) => {
    document.querySelector(`button[aria-label*="${label}"]`).click();
  }, account1Label);

  const deadline = Date.now() + 10000;
  while (!toggleRequestBody && Date.now() < deadline) await delay(100);
  await delay(400); // let .then()/notePreferencesVersion/refreshCoverPlan settle
  check("toggle's PATCH response observed", !!toggleRequestBody);

  // Release the held GET now, carrying the OLDER version captured before
  // the toggle — the exact shape of a slow app-boot fetch resolving late.
  const realStale = await realGet();
  await heldGetRequest.respond({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ ...realStale, cover_plan_excluded_accounts: [], version: BASE_VERSION }),
  });
  await delay(800);

  const stateAfterStaleGet = await ariaChecked(page, account1Label);
  // "false" == excluded (Toggle's `checked` prop is `!excluded`).
  check("toggle survives the stale, late-resolving GET (expect false)", stateAfterStaleGet === "false");

  await page.close();
}

// ── Scenario 2: an overlapping second toggle must not be corrupted by the
//    first one's failure (blocker 1 — serialized writes + server-authoritative
//    failure reconciliation, including the delayed-effect stomp found while
//    building this proof). ──────────────────────────────────────────────────
async function scenarioOverlappingFailure(browser, account1Label, account2Label) {
  console.log("\n=== Scenario 2: a failed toggle must not corrupt a different, later toggle ===");
  await realPatch([]); // real reset, real Mongo write

  const page = await newPage(browser);
  let version = 5000; // arbitrary, isolated from scenario 1's counter
  let failFirstPatch = true;
  let patchesSeen = 0;
  let concurrentInFlight = 0;
  let maxConcurrentPatches = 0;

  await page.setRequestInterception(true);
  page.on("request", async (req) => {
    const url = req.url();
    const isPreferences = url.includes("/api/preferences");
    if (req.method() === "GET" && isPreferences) {
      // Every GET (mount, and the failure-path refreshPreferences() call)
      // gets a real read plus the CURRENT shimmed version, never held.
      const real = await realGet();
      await req.respond({ status: 200, contentType: "application/json", body: JSON.stringify({ ...real, version }) });
      return;
    }
    if (req.method() === "PATCH" && isPreferences) {
      patchesSeen += 1;
      concurrentInFlight += 1;
      maxConcurrentPatches = Math.max(maxConcurrentPatches, concurrentInFlight);
      if (failFirstPatch) {
        failFirstPatch = false;
        await req.respond({ status: 500, contentType: "application/json", body: '{"detail":"forced failure"}' });
        concurrentInFlight -= 1;
        return;
      }
      const body = JSON.parse(req.postData() || "{}");
      const real = await realPatch(body.cover_plan_excluded_accounts); // real write
      version += 1;
      await req.respond({ status: 200, contentType: "application/json", body: JSON.stringify({ ...real, version }) });
      concurrentInFlight -= 1;
      return;
    }
    req.continue();
  });

  await gotoSettingsAndWaitForCard(page);

  // Fire both clicks back-to-back, synchronously, the way two fast taps
  // would — WITHOUT waiting for the first one's PATCH to resolve. With
  // serialized writes, toggle B must not even send its PATCH until toggle
  // A's whole lifecycle (including A's failure-path server refetch) has
  // settled.
  await page.evaluate(
    (l1, l2) => {
      document.querySelector(`button[aria-label*="${l1}"]`).click();
      document.querySelector(`button[aria-label*="${l2}"]`).click();
    },
    account1Label,
    account2Label
  );

  const deadline = Date.now() + 15000;
  while (patchesSeen < 2 && Date.now() < deadline) await delay(100);
  await delay(1200); // let A's failure-path refetch AND B's success fully settle

  check("both PATCHes were eventually sent", patchesSeen >= 2);
  check("the two PATCHes were never in flight at the same time (serialized)", maxConcurrentPatches <= 1);

  const state1 = await ariaChecked(page, account1Label);
  const state2 = await ariaChecked(page, account2Label);
  const server = await realGet();

  // Account 1's toggle was forced to fail — it must NOT end up excluded.
  check("account 1 (forced failure) shows allowed, not excluded", state1 === "true");
  // Account 2's toggle should have succeeded normally, reflected correctly
  // on screen — not clobbered by A's delayed reconciliation effect landing
  // after B's own optimistic update (the bug found while building this
  // proof script).
  check("account 2 (real toggle) shows excluded", state2 === "false");
  check(
    "server holds exactly account 2 excluded, not account 1, not both, not neither",
    JSON.stringify((server.cover_plan_excluded_accounts || []).sort()) === JSON.stringify([ACCOUNT_2].sort())
  );

  await page.close();
}

// ── Scenario 3: the PATCH fails AND the reconciling GET also fails (or
//    times out) — there is no server truth at all to reconcile from. The
//    review's third-round blocker: runCoverToggle's catch had no `else` on
//    `if (server) { ... }`, so this exact case left the optimistic (unsaved)
//    change on screen forever, next to a "could not save" message — the
//    screen claimed an account was protected from the cover plan when the
//    server never received that change. ─────────────────────────────────
async function scenarioDoubleFailure(browser, account1Label) {
  console.log("\n=== Scenario 3: PATCH fails AND the reconciling GET also fails ===");
  await realPatch([]); // real reset, real Mongo write — account1 starts NOT excluded

  const page = await newPage(browser);
  let getCount = 0;
  let patchSeen = false;

  await page.setRequestInterception(true);
  page.on("request", async (req) => {
    const url = req.url();
    const isPreferences = url.includes("/api/preferences");
    if (req.method() === "GET" && isPreferences) {
      getCount += 1;
      if (getCount === 1) {
        // The app-boot mount GET must succeed normally so the page loads.
        const real = await realGet();
        await req.respond({ status: 200, contentType: "application/json", body: JSON.stringify(real) });
        return;
      }
      // Every GET after the mount fetch is the toggle's OWN reconciling
      // refetch (refreshPreferences() inside runCoverToggle's catch) —
      // force it to fail too, so there is no server truth available at all.
      await req.respond({ status: 500, contentType: "application/json", body: '{"detail":"forced GET failure"}' });
      return;
    }
    if (req.method() === "PATCH" && isPreferences) {
      patchSeen = true;
      await req.respond({ status: 500, contentType: "application/json", body: '{"detail":"forced PATCH failure"}' });
      return;
    }
    req.continue();
  });

  await gotoSettingsAndWaitForCard(page);

  await page.evaluate((label) => {
    document.querySelector(`button[aria-label*="${label}"]`).click();
  }, account1Label);

  const deadline = Date.now() + 10000;
  while ((!patchSeen || getCount < 2) && Date.now() < deadline) await delay(100);
  await delay(1000); // let the failed reconciliation fully settle

  check("the toggle's PATCH was sent (and forced to fail)", patchSeen);
  check("a reconciling GET was attempted after the PATCH failed (and forced to fail too)", getCount >= 2);

  const state1 = await ariaChecked(page, account1Label);
  const bodyText = await page.evaluate(() => document.body.innerText);
  const server = await realGet();

  // The account started NOT excluded ("true"). With no server truth
  // reachable at all, the screen must fall back to that pre-toggle value —
  // never leave the optimistic (unsaved) "excluded" state on screen.
  check("checkbox falls back to the pre-toggle state (expect true = allowed)", state1 === "true");
  check("the failure message is shown", bodyText.includes("Could not save that change"));
  check(
    "the server was never actually changed (still empty)",
    JSON.stringify(server.cover_plan_excluded_accounts || []) === "[]"
  );

  await page.close();
}

async function main() {
  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  try {
    // Labels match the `onToggle` aria-label built in CoverPlanSourcesCard.tsx
    // ("${excluded ? 'Allow' : 'Exclude'} ${account.name} as a cover source"),
    // matched here by account NAME substring, resolved from the real API so
    // this script works with whatever names the caller's synthetic accounts
    // actually have.
    const accounts = await realAccounts();
    const acc1 = accounts.find((a) => a.id === ACCOUNT_1);
    const acc2 = accounts.find((a) => a.id === ACCOUNT_2);
    if (!acc1 || !acc2) {
      throw new Error(
        `Could not find ACCOUNT_1_ID (${ACCOUNT_1}) / ACCOUNT_2_ID (${ACCOUNT_2}) via GET /api/accounts — ` +
          "double-check the ids and that this token's user actually owns them."
      );
    }

    await scenarioStaleGet(browser, acc1.name);
    await scenarioOverlappingFailure(browser, acc1.name, acc2.name);
    await scenarioDoubleFailure(browser, acc1.name);
  } finally {
    await browser.close();
  }

  if (failures > 0) {
    console.error(`\n${failures} failure(s). This branch's G45 fix is NOT proven.`);
    process.exit(1);
  }
  console.log("\nAll scenarios passed.");
}

main().catch((e) => {
  console.error("FATAL:", e);
  process.exit(2);
});
