#!/usr/bin/env node
// A26: /design/* ships to production auth-exempt (AuthProvider.tsx lets any
// path starting with "/design" through with no session check at all, "static
// mockups with zero user data — always public"). That's only safe as long as
// no file under app/design actually calls a real API, reads real cookies, or
// runs on the server with access to anything a signed-in session could see.
// This is a standing regression guard, not a one-off audit: /design grows a
// new preview directory most sessions, and nothing else stops one of them
// from quietly wiring up a real fetch. Plain Node, no deps, runs in CI/
// session finish without an install step.
//
// Usage: node scripts/check-design-no-live-data.mjs   (from frontend/)

import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const frontendRoot = path.resolve(__dirname, "..");
const designDir = path.join(frontendRoot, "app", "design");

// Each pattern paired with why it's forbidden here, so a failure explains
// itself rather than just failing. Applied to the whole file source. These
// are hard failures: as of A26 none of them fire, so wiring them into CI
// blocking is safe today.
const FORBIDDEN = [
  { re: /\bfetch\s*\(/, why: "calls fetch() directly" },
  { re: /\buseSWR\b/, why: "uses useSWR (implies a real data fetch)" },
  { re: /\baxios\b/, why: "uses axios" },
  { re: /from\s+["']next\/headers["']/, why: "imports next/headers (server-side cookies/headers access)" },
  { re: /\bcookies\s*\(\s*\)/, why: "reads cookies() directly" },
  { re: /["']use server["']/, why: "declares a server action" },
  { re: /\bgetServerSideProps\b/, why: "defines getServerSideProps" },
];

// Checked per-line rather than whole-source: a bare `import type { X } from
// "@/lib/api"` is erased at compile time (TypeScript types only, no runtime
// access to anything) — most app/design files that import from there only
// do this, and that's fine. A VALUE import of `api` itself is different: as
// of A26, seven files (spend-live, spend-verdict-a/b/c and friends) import
// the real `api` client and call real endpoints (api.createCheckpoint,
// api.cancelCheckpoint, api.recordTrendIntent) against whatever session
// cookie the visiting browser holds. That's a genuine, already-flagged gap
// (A26 pentest-readiness pass, docs/security/pentest-scope-2026-09.md), not
// something this guard should silently rip out or a fresh session should
// silently re-introduce elsewhere — so it's WARN-only (does not fail the
// build) until Kevin decides whether to stub these calls, gate them, or
// accept the risk as a signed-in-user-mutating-their-own-data issue.
const API_MODULE_VALUE_IMPORT_RE = /^\s*import\s+(?!type\b)[^;]*\bfrom\s+["']@\/lib\/api["']/;
const API_CALL_RE = /\bapi\.\w+\s*\(/;

function listFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      out.push(...listFiles(full));
    } else if (/\.(tsx|ts)$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

const files = listFiles(designDir);
const violations = [];
const warnings = [];

for (const file of files) {
  const source = readFileSync(file, "utf8");
  for (const { re, why } of FORBIDDEN) {
    if (re.test(source)) {
      violations.push({ file: path.relative(frontendRoot, file), why });
    }
  }
  const importsApiValue = source.split("\n").some((line) => API_MODULE_VALUE_IMPORT_RE.test(line));
  if (importsApiValue && API_CALL_RE.test(source)) {
    warnings.push(path.relative(frontendRoot, file));
  }
}

if (warnings.length > 0) {
  console.warn(`check:design-no-live-data WARN: ${warnings.length} file(s) under app/design call the real api client against whatever session the browser holds (known gap, see docs/security/pentest-scope-2026-09.md):`);
  for (const w of warnings) console.warn(`  - ${w}`);
}

if (violations.length === 0) {
  console.log(`check:design-no-live-data OK (${files.length} files under app/design, no hard-forbidden patterns)`);
  process.exit(0);
}

console.error("Files under app/design that could reach real user data (this ships auth-exempt, see AuthProvider.tsx):");
for (const v of violations) console.error(`  - ${v.file}: ${v.why}`);
console.error("\napp/design/* must stay static fixture data only. Move any real data need out of /design.");
process.exit(1);
