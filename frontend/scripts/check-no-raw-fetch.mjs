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
// Scans frontend/ and ../shared/src (imported as @wealth/shared). Fails CLOSED:
// a file whose blanking ends inside an unterminated template literal (for
// example a regex literal containing a backtick, which this tokeniser does
// not understand) is reported as unscannable rather than silently ignored.
// Before scanning, the script runs an in-memory self-test of known evasions
// (newline before the call parens, destructuring, phantom template frames,
// second call on an allowlisted line) so those stay caught.
//
// Usage: node scripts/check-no-raw-fetch.mjs   (from frontend/)

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

// The one file allowed to touch the global fetch: it owns the gate.
const GATE_FILE = "lib/api.ts";

const SKIP_DIRS = new Set(["node_modules", ".next", ".next-prev", "scripts", "coverage"]);
const EXTS = /\.(ts|tsx|js|jsx|mjs|cjs)$/;

// file (posix, relative to frontend/) + snippet on the offending line + why.
// A68: the finexer and truelayer callback routes no longer call fetch themselves; they go
// through lib/callbackRelay.ts (a doFetch indirection the scan does not flag), so their
// ALLOW entries were removed rather than left stale.
const ALLOW = [
  ...["nordigen", "yapily"].map((p) => ({
    file: `app/auth/${p}/callback/route.ts`,
    snippet: "fetch(`${BACKEND}/auth/" + p + "/callback",
    reason:
      "Next.js server-side Route Handler (runs on the server, never in the browser, so the client biometric lock does not exist here). It forwards the provider's OAuth redirect params to the backend callback, which authenticates via the signed state param, not a session token, and returns no financial data to the caller.",
  })),
  ...[
    ["g88-home-real/G88HomeRealClient.tsx"],
    ["g134-home-inventory/HomeInventoryClient.tsx"],
    ["sync-loading/SyncLoadingClient.tsx"],
    ["home-cleanup/HomeCleanupClient.tsx"],
    ["card-terms-sheet/CardTermsSheetClient.tsx"],
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
      snippet: "[fetch]",
      reason: "Effect dependency array naming the same local useCallback `fetch`, not the global.",
    },
    {
      file: f,
      snippet: "onClick={fetch}",
      reason: "Passes the same local useCallback `fetch` as a retry handler, not the global.",
    },
  ]),
];

// Replace comments and string/template literal text with spaces, keeping
// newlines and column positions, so line numbers and code tokens survive.
// `${...}` expressions inside templates stay live code. Returns
// { text, unterminated }: unterminated is true when EOF is reached inside a
// template literal or `${` body, which means the tokeniser lost sync.
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
      if (src[i] === c) { out += " "; i++; }
      continue;
    }
    if (c === "`") { stack.push("tpl"); out += " "; i++; continue; }
    if (top === "brace") {
      if (c === "{") { stack.push("brace"); }
      else if (c === "}") { stack.pop(); }
    }
    out += c; i++;
  }
  return { text: out.slice(0, n), unterminated: stack.length > 0 };
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
// trip it. Matched against the WHOLE blanked text (so `fetch` newline `(`
// is caught): a call `fetch(`, a member read `window|globalThis|self.fetch`,
// the bare identifier used as a value (`= fetch`, `{fetch}`, `[fetch]`,
// `, fetch)`), and destructuring it off the global
// (`const { fetch: f } = window`). Computed access via a string
// (`window["fetch"]`) is invisible because string text is blanked; nothing in
// the repo does that and review should reject it.
const FETCH_PATTERNS = [
  /(?<![\w$.-])fetch\s*\(/g,
  /\b(?:window|globalThis|self)\s*\.\s*fetch\b/g,
  /[=,(:{\[]\s*fetch\s*[,;)}\]]/g,
  /=\s*fetch\b/g,
  /\{[^{}]*(?<![\w$.-])fetch\b[^{}]*\}\s*=\s*(?:window|globalThis|self)\b/g,
];

// Scan one file's source. Returns { unscannable, findings: [{line, text}],
// usedEntries: Set<index into allow> }. A match is exempt only when an
// allowlist entry's snippet occurs on the match's line AND the match starts
// inside that snippet occurrence, so a second raw call sharing a line with
// an allowlisted one is still flagged.
function scanSource(rel, src, allow) {
  const { text, unterminated } = stripNonCode(src);
  const used = new Set();
  if (unterminated) return { unscannable: true, findings: [], used };
  const rawLines = src.split("\n");
  const lineStarts = [0];
  for (let i = 0; i < src.length; i++) if (src[i] === "\n") lineStarts.push(i + 1);
  const lineOf = (pos) => {
    let lo = 0, hi = lineStarts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (lineStarts[mid] <= pos) lo = mid; else hi = mid - 1;
    }
    return lo;
  };
  const seen = new Set();
  const findings = [];
  for (const re of FETCH_PATTERNS) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(text))) {
      // Anchor on the `fetch` token itself (destructure matches start earlier).
      const tokenOffset = m[0].search(/(?<![\w$.-])fetch\b|\.\s*fetch\b/);
      let pos = m.index + Math.max(tokenOffset, 0);
      if (text[pos] === ".") pos = m.index + m[0].lastIndexOf("fetch");
      if (seen.has(pos)) continue;
      seen.add(pos);
      const ln = lineOf(pos);
      const lineStart = lineStarts[ln];
      const rawLine = rawLines[ln];
      let allowed = false;
      allow.forEach((a, idx) => {
        if (allowed || a.file !== rel) return;
        let from = 0;
        for (;;) {
          const at = rawLine.indexOf(a.snippet, from);
          if (at < 0) break;
          const s = lineStart + at;
          // Cover the whole match (not just its `fetch` token) so
          // `window.fetch =` style snippets and `{fetch}` both work.
          if (m.index >= s && m.index < s + a.snippet.length || (pos >= s && pos < s + a.snippet.length)) {
            allowed = true; used.add(idx); return;
          }
          from = at + 1;
        }
      });
      if (!allowed) findings.push({ line: ln + 1, text: rawLine.trim() });
    }
  }
  findings.sort((x, y) => x.line - y.line);
  return { unscannable: false, findings, used };
}

// ---- self-test: evasions that must stay caught -----------------------------
function selfTest() {
  const probes = [
    { name: "plain call", src: `fetch("/x");`, want: [1] },
    { name: "newline before parens", src: `await fetch\n("/x");`, want: [1] },
    { name: "call after newline, line number", src: `const a = 1;\n\nawait fetch\n  ("/x");`, want: [3] },
    { name: "window.fetch member", src: `window.fetch("/x");`, want: [1] },
    { name: "globalThis.fetch member", src: `globalThis . fetch ("/x");`, want: [1] },
    { name: "alias value", src: `const f = fetch;`, want: [1] },
    { name: "destructure renamed", src: `const { fetch: f } = window;`, want: [1] },
    { name: "destructure shorthand", src: `const { fetch } = globalThis;`, want: [1] },
    { name: "destructure among others", src: `const { a, fetch: f, b } = self;`, want: [1] },
    { name: "comment ignored", src: `// fetch("/x")\n/* fetch\n("/x") */`, want: [] },
    { name: "prose in JSX ignored", src: `<p>Re-fetch the last 90 days.</p>`, want: [] },
    { name: "gatedFetch ok", src: `gatedFetch("/x");`, want: [] },
    { name: "regex with backtick fails closed", src: "const re = /[`]/;\nfetch(\"/x\");", unscannable: true },
    {
      name: "allowlisted call passes",
      src: `window.fetch = mock;`,
      allow: [{ file: "p.ts", snippet: "window.fetch =" }],
      want: [],
    },
    {
      name: "second call on allowlisted line still flagged",
      src: `window.fetch = mock; fetch("/x");`,
      allow: [{ file: "p.ts", snippet: "window.fetch =" }],
      want: [1],
    },
    {
      name: "allowlisted call plus second call on the same line, snippet is the call",
      src: `fetch(a); fetch(b);`,
      allow: [{ file: "p.ts", snippet: "fetch(a)" }],
      want: [1],
    },
  ];
  const bad = [];
  for (const p of probes) {
    const r = scanSource("p.ts", p.src, p.allow ?? []);
    const got = r.findings.map((f) => f.line);
    const ok = p.unscannable
      ? r.unscannable === true
      : !r.unscannable && JSON.stringify(got) === JSON.stringify(p.want);
    if (!ok) bad.push(`${p.name}: expected ${p.unscannable ? "unscannable" : JSON.stringify(p.want)}, got ${r.unscannable ? "unscannable" : JSON.stringify(got)}`);
  }
  if (bad.length) {
    console.error("check:no-raw-fetch SELF-TEST FAILED (the checker itself is broken):");
    for (const b of bad) console.error("  " + b);
    process.exit(1);
  }
  return probes.length;
}

const probeCount = selfTest();

const SCAN_ROOTS = [{ dir: root, prefix: "" }];
const sharedSrc = path.resolve(root, "..", "shared", "src");
if (existsSync(sharedSrc)) SCAN_ROOTS.push({ dir: sharedSrc, prefix: "../shared/src/" });

const used = new Set();
const failures = [];
const unscannable = [];
let scanned = 0;

for (const { dir, prefix } of SCAN_ROOTS) {
  for (const full of listFiles(dir)) {
    const rel = prefix + path.relative(dir, full).split(path.sep).join("/");
    if (rel === GATE_FILE) continue;
    scanned++;
    const r = scanSource(rel, readFileSync(full, "utf8"), ALLOW);
    if (r.unscannable) { unscannable.push(rel); continue; }
    r.used.forEach((i) => used.add(i));
    for (const f of r.findings) {
      failures.push(`${rel}:${f.line}: raw \`fetch\` bypasses the app-lock gate: ${f.text}`);
    }
  }
}

const stale = ALLOW.map((a, i) => [a, i]).filter(([, i]) => !used.has(i));
let bad = false;
if (failures.length) {
  bad = true;
  console.error("check:no-raw-fetch FAILED. Use `api.*`, or `gatedFetch` from lib/api.ts, instead of the global fetch:\n");
  for (const f of failures) console.error("  " + f);
  console.error("\nIf a raw fetch is genuinely required, add an entry with a written reason to ALLOW in scripts/check-no-raw-fetch.mjs.");
}
if (unscannable.length) {
  bad = true;
  console.error("\ncheck:no-raw-fetch: files the scanner could not tokenise (unterminated template literal at EOF, often a regex literal containing a backtick). Restructure the file so the scanner can read it, or allowlist it with a reason:");
  for (const f of unscannable) console.error("  " + f);
}
if (stale.length) {
  bad = true;
  console.error("\ncheck:no-raw-fetch: stale ALLOW entries (no matching line, remove them):");
  for (const [a] of stale) console.error(`  ${a.file} :: ${a.snippet}`);
}
if (bad) process.exit(1);
console.log(`check:no-raw-fetch OK (${scanned} files scanned, ${used.size} allowlisted entries matched, ${probeCount} self-test probes)`);
