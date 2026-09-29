#!/usr/bin/env node
// A125: the A121 biometric app-lock gate lives in lib/api.ts as a
// module-scoped `fetch` shadow (exported as `gatedFetch`) that rejects with
// AppLockedError while the lock is engaged. It only covers calls that go
// through it. A component calling the GLOBAL fetch against an authenticated
// endpoint would silently escape the gate, and nothing structural stopped
// that. This is the standing guard: any use of the `fetch` identifier
// (fetch(...), window.fetch, globalThis.fetch, self.fetch, `= fetch`, passing
// it as a value) in frontend source outside lib/api.ts fails, unless it is
// listed in ALLOW below with a written reason. `gatedFetch` is a different
// identifier and is the sanctioned way to make an out-of-api.ts request.
//
// Comments and string/template text are blanked before matching, so prose
// mentioning "fetch" does not trip it. Allowlist entries are keyed by file
// plus a snippet that must appear on the offending line (never a line
// number), and an entry that no longer matches anything fails as stale so
// the list cannot rot.
//
// Usage: node scripts/check-no-raw-fetch.mjs   (from frontend/)

import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

// The one file allowed to touch the global fetch: it owns the gate.
const GATE_FILE = "lib/api.ts";

const SKIP_DIRS = new Set(["node_modules", ".next", ".next-prev", "scripts", "coverage"]);
const EXTS = /\.(ts|tsx|js|jsx|mjs|cjs)$/;

// file (posix, relative to frontend/) + snippet on the offending line + why.
const ALLOW = [
  ...["nordigen", "yapily", "truelayer", "finexer"].map((p) => ({
    file: `app/auth/${p}/callback/route.ts`,
    snippet: `/auth/${p}/callback`,
    reason:
      "Next.js server-side Route Handler (runs on the server, never in the browser, so the client biometric lock does not exist here). It forwards the provider's OAuth redirect params to the backend callback, which authenticates via the signed state param, not a session token, and returns no financial data to the caller.",
  })),
  ...[
    ["g115-spend-from-accounts/G115SpendFromAccountsClient.tsx"],
    ["g88-home-real/G88HomeRealClient.tsx"],
    ["g134-home-inventory/HomeInventoryClient.tsx"],
  ].flatMap(([f]) => [
    {
      file: `app/design/${f}`,
      snippet: "window.fetch.bind(window)",
      reason:
        "Auth-exempt /design preview that temporarily patches window.fetch to serve fixture data and restores it on unmount; it only captures the native fetch to pass unrelated requests through. Preview pages have no session and no app-lock component, and check:design-no-live-data separately forbids live API use there.",
    },
    {
      file: `app/design/${f}`,
      snippet: "window.fetch =",
      reason: "Same preview-only fixture patch (install and restore) as above; not a production request path.",
    },
    {
      file: `app/design/${f}`,
      snippet: "typeof window.fetch",
      reason: "Type annotation on the same preview-only fixture patch; not a call.",
    },
  ]),
  ...["components/GoalsStrip.tsx", "components/UpcomingBillsStrip.tsx"].flatMap((f) => [
    {
      file: f,
      snippet: "fetch()",
      reason:
        "Calls a local useCallback named `fetch` declared in the same file (it wraps gated api.* calls); it shadows the global and is not the global fetch. Rename it if this entry ever gets in the way.",
    },
    {
      file: f,
      snippet: "onClick={fetch}",
      reason: "Passes the same local useCallback `fetch` as a retry handler, not the global.",
    },
  ]),
];

// Replace comments and string/template literal text with spaces, keeping
// newlines, so line numbers and code tokens survive. `${...}` expressions
// inside templates stay live code.
function stripNonCode(src) {
  let out = "";
  let i = 0;
  const n = src.length;
  const stack = []; // "tpl" frames for template literals, "brace" for `${` bodies
  const blank = (c) => (c === "\n" ? "\n" : " ");
  while (i < n) {
    const c = src[i];
    const d = src[i + 1];
    const top = stack[stack.length - 1];
    if (top === "tpl") {
      if (c === "\\") { out += blank(c) + blank(d ?? ""); i += 2; continue; }
      if (c === "`") { stack.pop(); out += " "; i++; continue; }
      if (c === "$" && d === "{") { stack.push("brace"); out += "  "; i += 2; continue; }
      out += blank(c); i++; continue;
    }
    if (c === "/" && d === "/") {
      while (i < n && src[i] !== "\n") { out += " "; i++; }
      continue;
    }
    if (c === "/" && d === "*") {
      out += "  "; i += 2;
      while (i < n && !(src[i] === "*" && src[i + 1] === "/")) { out += blank(src[i]); i++; }
      out += "  "; i += 2;
      continue;
    }
    if (c === "'" || c === '"') {
      out += " "; i++;
      while (i < n && src[i] !== c && src[i] !== "\n") {
        if (src[i] === "\\") { out += " "; i++; }
        out += blank(src[i] ?? ""); i++;
      }
      out += " "; i++;
      continue;
    }
    if (c === "`") { stack.push("tpl"); out += " "; i++; continue; }
    if (top === "brace") {
      if (c === "{") { stack.push("brace"); }
      else if (c === "}") { stack.pop(); }
    }
    out += c; i++;
  }
  return out;
}

function listFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    if (entry.startsWith(".") || SKIP_DIRS.has(entry)) continue;
    const full = path.join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) out.push(...listFiles(full));
    else if (EXTS.test(entry)) out.push(full);
  }
  return out;
}

// Code-shaped uses only, so JSX prose ("Re-fetch the last 90 days") cannot
// trip it: a call `fetch(`, a member read `window|globalThis|self.fetch`, or
// the bare identifier used as a value (`= fetch`, `{fetch}`, `[fetch]`,
// `, fetch)`). Computed access via a string (`window["fetch"]`) is invisible
// here because string text is blanked; nothing in the repo does that and
// review should reject it.
const FETCH_RE = new RegExp(
  [
    String.raw`(?<![\w$.-])fetch\s*\(`,
    String.raw`\b(?:window|globalThis|self)\s*\.\s*fetch\b`,
    String.raw`[=,(:{\[]\s*fetch\s*[,;)}\]]`,
    String.raw`=\s*fetch\b`,
  ].join("|"),
);
const used = new Set();
const failures = [];
let scanned = 0;

for (const full of listFiles(root)) {
  const rel = path.relative(root, full).split(path.sep).join("/");
  if (rel === GATE_FILE) continue;
  scanned++;
  const raw = readFileSync(full, "utf8");
  const rawLines = raw.split("\n");
  const codeLines = stripNonCode(raw).split("\n");
  codeLines.forEach((line, idx) => {
    if (!FETCH_RE.test(line)) return;
    const idxAllow = ALLOW.findIndex((a) => a.file === rel && rawLines[idx].includes(a.snippet));
    if (idxAllow >= 0) { used.add(idxAllow); return; }
    failures.push(`${rel}:${idx + 1}: raw \`fetch\` bypasses the app-lock gate: ${rawLines[idx].trim()}`);
  });
}

const stale = ALLOW.map((a, i) => [a, i]).filter(([, i]) => !used.has(i));
let bad = false;
if (failures.length) {
  bad = true;
  console.error("check:no-raw-fetch FAILED. Use `api.*`, or `gatedFetch` from lib/api.ts, instead of the global fetch:\n");
  for (const f of failures) console.error("  " + f);
  console.error("\nIf a raw fetch is genuinely required, add an entry with a written reason to ALLOW in scripts/check-no-raw-fetch.mjs.");
}
if (stale.length) {
  bad = true;
  console.error("\ncheck:no-raw-fetch: stale ALLOW entries (no matching line, remove them):");
  for (const [a] of stale) console.error(`  ${a.file} :: ${a.snippet}`);
}
if (bad) process.exit(1);
console.log(`check:no-raw-fetch OK (${scanned} files scanned, ${used.size} allowlisted entries matched)`);
