#!/usr/bin/env node
// Guards G138's class fix against regressing back to the bug it fixed:
// deleting a bank account left Spend still listing its transaction as an
// unplaced payment, counted in Out, until a hard refresh, because
// AccountsPage.tsx's delete handler cleared only the accounts cache
// (invalidateAccounts()) and left the verdict/money-shape/Home/signals
// caches serving their pre-deletion payload. The fix was lib/
// accountMutations.ts's invalidateAllAccountData(), one function that
// clears every module-scope cache holding account- or transaction-derived
// data, called from every account mutation (delete, a new connection
// landing, a reconnect, a statement upload, and every manual-account/
// manual-transaction/mirror-rule write, plus HomePage's manual sync).
//
// What made the ORIGINAL bug possible: nothing enforced that a new cache
// under lib/ gets wired into the one function meant to clear all of them.
// This script is that enforcement — the same "no drift" shape as
// check-nav-coverage.mjs's directory<->list check, applied to caches
// instead of nav routes:
//
//   Every exported `invalidate*`/`clear*` function under lib/ must either
//   be CALLED from lib/accountMutations.ts's invalidateAllAccountData(),
//   or be named in this script's own ALLOWED_UNREACHABLE list below, with a
//   real, non-trivial reason for why an account mutation must NOT clear it.
//
// A function landing in neither bucket means: someone added a new
// account/transaction-derived cache and forgot to wire it in — exactly the
// G138 bug, one cache at a time, forever, unless this fails the build.
//
// Usage: node scripts/check-account-cache-coverage.mjs   (from frontend/)
//    or: node --experimental-strip-types --experimental-loader ./scripts/_ts-extensionless-loader.mjs scripts/check-account-cache-coverage.mjs
//
// NOTE (2026-09-22): this check is NOT yet wired into scripts/session.sh
// finish's hardcoded subset of `npm run check:*` calls — see that script's
// own comment block for the list it actually runs. Until it is added
// there (a change to session.sh itself, out of scope for this item), this
// only runs when invoked directly via `npm run -s check:account-cache-coverage`.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const frontendRoot = path.resolve(__dirname, "..");
const libDir = path.join(frontendRoot, "lib");

let failures = [];

// ── Entries this script must NOT demand invalidateAllAccountData() call ────
//
// Each entry is [relative file path, exported function name, reason]. The
// reason is Kevin's rule from check-nav-coverage.mjs applied here: an
// EXPLICIT exemption, not a silent one — anyone reading this list should be
// able to tell, without opening the target file, why an account mutation
// must leave that cache alone.
const ALLOWED_UNREACHABLE = [
  [
    "lib/auth.ts",
    "clearToken",
    "clears the session token itself — calling this from an account mutation would sign the user out, not refresh their account data.",
  ],
  [
    "lib/colourStore.ts",
    "clearColour",
    "category colour customisation is a device-scoped display preference, not account- or transaction-derived data — see lib/colourStore.ts's own header.",
  ],
  [
    "lib/colourStore.ts",
    "clearAllColours",
    "same reasoning as clearColour above: a display preference, not cached financial data.",
  ],
  [
    "lib/iconStore.ts",
    "clearIcon",
    "category icon customisation is a device-scoped display preference, not account- or transaction-derived data, mirroring lib/colourStore.ts.",
  ],
  [
    "lib/homeDismissedAdvice.ts",
    "clearHomeDismissedAdvice",
    "a 'hidden on Home' dismissal preference, not a cache of stale data — it already self-prunes against the live /today feed (pruneHomeDismissedAdvice) whenever a dismissed item's companion card stops being emitted, including after an account deletion removes the item that produced it. Cleared wholesale only at logout, where the concern is a DIFFERENT user's dismissals, not stale figures.",
  ],
  [
    "lib/openBankingAccess.ts",
    "invalidateOpenBankingAccess",
    "caches the user's subscription tier / open-banking entitlement, not their accounts or transactions — a plan change (PlanPicker), not an account mutation, is what invalidates it correctly.",
  ],
  [
    "lib/accountMutations.ts",
    "invalidateAllAccountData",
    "this IS the invalidator the other entries must be reachable from — it cannot be a call inside its own body.",
  ],
];

function exists(p) {
  try {
    statSync(p);
    return true;
  } catch {
    return false;
  }
}

for (const [relFile, fnName, reason] of ALLOWED_UNREACHABLE) {
  if (!reason || reason.trim().length < 20) {
    failures.push(`ALLOWED_UNREACHABLE: "${relFile}"'s "${fnName}" has no real reason ("${reason}") — an exemption from the invalidator must be EXPLICIT, not silent.`);
  }
  const full = path.join(frontendRoot, relFile);
  if (!exists(full)) {
    failures.push(`ALLOWED_UNREACHABLE: "${relFile}" does not exist — stale exemption, remove it or fix the path.`);
    continue;
  }
  const source = readFileSync(full, "utf8");
  const defRe = new RegExp(`export\\s+function\\s+${fnName}\\s*\\(`);
  if (!defRe.test(source)) {
    failures.push(`ALLOWED_UNREACHABLE: "${relFile}" no longer exports a function called "${fnName}" — stale exemption, remove it or fix the name.`);
  }
}

// ── Find every exported invalidate*/clear* function under lib/ ─────────────

function listLibFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      out.push(...listLibFiles(full));
    } else if (/\.(ts|tsx)$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

// Two shapes, both common in this codebase: a plain/async function
// declaration (`export function invalidateX(`, `export async function
// clearX(`), and a const bound to an arrow function or a function
// expression (`export const invalidateX = (`, `export const clearX = async
// (`, `export const invalidateX = function (`, `export const clearX = async
// function (`). Reviewer-flagged gap (2026-09-22): the original regex only
// covered the first shape, so a future cache added as `export const
// invalidateFoo = () => {}` — a very likely shape for a new addition —
// would silently vanish from `found` below and this guard would pass while
// missing exactly the case it exists to catch. Proven both ways: a
// temporary `export const invalidateFakeArrowCache = () => {}` and a
// temporary `export async function clearFakeAsyncCache()` were each added
// to a lib/ file and confirmed to fail this check by name, then reverted.
const EXPORT_FN_DECL_RE = /export\s+(?:async\s+)?function\s+(invalidate[A-Za-z0-9]*|clear[A-Za-z0-9]*)\s*\(/g;
const EXPORT_CONST_FN_RE = /export\s+const\s+(invalidate[A-Za-z0-9]*|clear[A-Za-z0-9]*)\s*=\s*(?:async\s+)?(?:\(|function\b)/g;

const found = []; // { relFile, fnName }
for (const file of listLibFiles(libDir)) {
  const relFile = path.relative(frontendRoot, file).replace(/\\/g, "/");
  const source = readFileSync(file, "utf8");
  for (const re of [EXPORT_FN_DECL_RE, EXPORT_CONST_FN_RE]) {
    let m;
    re.lastIndex = 0;
    while ((m = re.exec(source)) !== null) {
      found.push({ relFile, fnName: m[1] });
    }
  }
}

if (found.length === 0) {
  failures.push("No exported invalidate*/clear* function found anywhere under lib/ — that's suspicious enough (lib/accountMutations.ts itself should have matched) to mean this script's own regex broke, not that every cache vanished.");
}

// ── invalidateAllAccountData's own source: what does it actually call? ─────

const accountMutationsFile = path.join(libDir, "accountMutations.ts");
if (!exists(accountMutationsFile)) {
  failures.push("lib/accountMutations.ts is missing — G138's invalidator (invalidateAllAccountData) is expected to live here.");
} else {
  const source = readFileSync(accountMutationsFile, "utf8");
  const fnMatch = source.match(/export function invalidateAllAccountData\s*\([^)]*\)\s*:\s*void\s*\{([\s\S]*?)\n\}/);
  if (!fnMatch) {
    failures.push("lib/accountMutations.ts: could not find `export function invalidateAllAccountData(): void { ... }` — this script's regex expects that exact shape to read the function body from.");
  } else {
    const body = fnMatch[1];

    for (const { relFile, fnName } of found) {
      const isSelf = relFile === "lib/accountMutations.ts" && fnName === "invalidateAllAccountData";
      const exempt = ALLOWED_UNREACHABLE.some(([f, n]) => f === relFile && n === fnName);
      if (isSelf || exempt) continue;

      const callRe = new RegExp(`\\b${fnName}\\s*\\(`);
      if (!callRe.test(body)) {
        failures.push(
          `${relFile}: "${fnName}" is exported but never called from lib/accountMutations.ts's invalidateAllAccountData() — and it is not in this script's ALLOWED_UNREACHABLE list either. If this cache holds account- or transaction-derived data, wire it into invalidateAllAccountData() (see lib/categoryMutations.ts for the equivalent call-through pattern); if it genuinely must NOT be cleared by an account mutation, add it to ALLOWED_UNREACHABLE with a real reason. This is exactly the G138 bug: a cache invalidated on some writes but not others.`
        );
      }
    }
  }
}

// ── Report ────────────────────────────────────────────────────────────────

if (failures.length === 0) {
  console.log(
    `check:account-cache-coverage OK (${found.length} exported invalidate*/clear* function(s) under lib/ checked, ${ALLOWED_UNREACHABLE.length} explicit exemption(s) verified)`
  );
  process.exit(0);
}

console.error("Account cache coverage check failed:\n");
for (const f of failures) console.error(`  - ${f}`);
console.error("\nSee lib/accountMutations.ts (invalidateAllAccountData) and this script's own ALLOWED_UNREACHABLE list.");
process.exit(1);
