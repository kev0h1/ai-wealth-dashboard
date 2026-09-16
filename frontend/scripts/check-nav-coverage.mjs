#!/usr/bin/env node
// Guards G79's structural fix against regressing back to the bug it fixed
// (app/spend/shape/ShapePage.tsx silently missing components/BottomNav.tsx
// because BottomNav used to be mounted per-page, and nobody added it to
// that one page). Kevin's rule (2026-09-16): every page has the nav bar
// unless he has explicitly exempted it.
//
// The fix: BottomNav is now mounted exactly ONCE, in app/layout.tsx, as a
// sibling of components/Sidebar.tsx — every route gets it by default, with
// no per-page opt-in possible. The only routes without it are the small,
// named, reasoned list in lib/navExemptRoutes.ts (also read at runtime by
// BottomNav.tsx itself, via isNavExemptPath, so there is exactly one
// source of truth). Because coverage is now structural rather than
// per-page, "does route X render the nav?" collapses to "is route X in
// lib/navExemptRoutes.ts?" — this script's job is making sure THAT list
// stays honest:
//
//   1. Every exempt entry still points at a route that actually exists
//      (catches a stale entry left behind after a page/section is
//      renamed or removed — the same "no drift" shape as
//      check-design-index.mjs's directory<->slug check).
//   2. Every exempt entry carries a real, non-trivial reason (Kevin's
//      rule is "explicitly exempted", not "silently exempted" — a
//      one-word or empty reason doesn't count as explicit).
//   3. No file other than app/layout.tsx itself (and BottomNav.tsx, which
//      needs its own default export) default-imports the real
//      components/BottomNav — this is the regression that would put TWO
//      navs on one route, the mirror-image failure of the original bug.
//
// Usage: node scripts/check-nav-coverage.mjs   (from frontend/)
//    or: node --experimental-strip-types scripts/check-nav-coverage.mjs

import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { NAV_EXEMPT_ROUTES } from "../lib/navExemptRoutes.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const frontendRoot = path.resolve(__dirname, "..");
const appDir = path.join(frontendRoot, "app");
const componentsDir = path.join(frontendRoot, "components");

let failures = [];

// ── 1 & 2: every exempt entry resolves to a real route, with a real reason ──

function pathToPageFile(routePath) {
  // "/" -> app/page.tsx ; "/terms" -> app/terms/page.tsx ; "/oauth/consent"
  // -> app/oauth/consent/page.tsx
  const segments = routePath.split("/").filter(Boolean);
  return path.join(appDir, ...segments, "page.tsx");
}

function exists(p) {
  try {
    statSync(p);
    return true;
  } catch {
    return false;
  }
}

for (const { path: routePath, reason } of NAV_EXEMPT_ROUTES) {
  if (!reason || reason.trim().length < 20) {
    failures.push(`lib/navExemptRoutes.ts: "${routePath}" has no real reason ("${reason}") — Kevin's rule requires an EXPLICIT exemption, not a silent one.`);
  }

  if (routePath.endsWith("/")) {
    const dir = path.join(appDir, ...routePath.split("/").filter(Boolean));
    if (!exists(dir) || !statSync(dir).isDirectory()) {
      failures.push(`lib/navExemptRoutes.ts: prefix "${routePath}" has no matching directory (app/${routePath.slice(1).replace(/\/$/, "")}) — stale exemption, remove it or fix the path.`);
    }
  } else {
    const pageFile = pathToPageFile(routePath);
    if (!exists(pageFile)) {
      failures.push(`lib/navExemptRoutes.ts: "${routePath}" has no matching page.tsx (expected ${path.relative(frontendRoot, pageFile)}) — stale exemption, remove it or fix the path.`);
    }
  }
}

// ── 3: nothing double-mounts the real BottomNav ──────────────────────────

const BOTTOM_NAV_IMPORT_RE = /^\s*import\s+BottomNav\s+from\s+["']@\/components\/BottomNav["'];?\s*$/m;

function listTsxFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      out.push(...listTsxFiles(full));
    } else if (/\.(tsx|ts)$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

const layoutFile = path.join(appDir, "layout.tsx");
const bottomNavFile = path.join(componentsDir, "BottomNav.tsx");

const candidateFiles = [...listTsxFiles(appDir), ...listTsxFiles(componentsDir)].filter(
  (f) => f !== layoutFile && f !== bottomNavFile
);

const doubleMounts = [];
for (const file of candidateFiles) {
  const source = readFileSync(file, "utf8");
  if (BOTTOM_NAV_IMPORT_RE.test(source)) {
    doubleMounts.push(path.relative(frontendRoot, file));
  }
}

if (doubleMounts.length > 0) {
  for (const f of doubleMounts) {
    failures.push(`${f} imports the real components/BottomNav directly — BottomNav is mounted once, in app/layout.tsx (G79); a second import here would double-render the nav on whatever route this file serves.`);
  }
}

// ── Report ────────────────────────────────────────────────────────────────

if (failures.length === 0) {
  console.log(
    `check:nav-coverage OK (${NAV_EXEMPT_ROUTES.length} named nav exemptions verified, ${candidateFiles.length} files checked for a duplicate BottomNav mount)`
  );
  process.exit(0);
}

console.error("Nav coverage check failed:\n");
for (const f of failures) console.error(`  - ${f}`);
console.error("\nSee lib/navExemptRoutes.ts (the single source of truth BottomNav.tsx and this script both read).");
process.exit(1);
