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
//   4. isNavExemptPath actually EXEMPTS each listed entry in every shape
//      that route can be reached in — including "/ops/go-live.html", the
//      literal filename a Next static export emits and the exact path the
//      Board Android app's start shim loads. Added by H75: checks 1-3 all
//      passed while the nav rendered over the board inside Board, because
//      nothing here ever called the matcher. A guard that cannot catch the
//      bug it guards is how that shipped. This section also asserts the
//      negative direction, that normalising the pathname has not quietly
//      exempted a neighbouring route that was never on the list.
//
// Usage: node scripts/check-nav-coverage.mjs   (from frontend/)
//    or: node --experimental-strip-types scripts/check-nav-coverage.mjs

import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { NAV_EXEMPT_ROUTES, isNavExemptPath } from "../lib/navExemptRoutes.ts";

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

// ── 4: the matcher exempts every listed entry, in every reachable shape ──
//
// Table-driven, generated from the list itself so it cannot go stale: a new
// exemption is covered the moment it is added. Each case is [pathname,
// expected], and the shapes come from how a route is actually reached:
//
//   "/ops/go-live"            browser on the real server (what always worked)
//   "/ops/go-live.html"       Capacitor/WebView on the bundled static export
//                             — H75's bug: the Board app's shim loads exactly
//                             this, and usePathname() reports it verbatim
//   "/ops/go-live/"           trailing slash (a hand-typed or copied URL, and
//                             what the export would emit under trailingSlash)
//   "/ops/go-live/index.html" the same route as a file under trailingSlash

const matcherCases = [];

for (const { path: routePath } of NAV_EXEMPT_ROUTES) {
  if (routePath.endsWith("/")) {
    const base = routePath.slice(0, -1); // "/design/" -> "/design"
    matcherCases.push(
      [base, true],
      [`${base}.html`, true],
      [routePath, true],
      [`${base}/index.html`, true],
      // A child of the subtree, in each of the same shapes.
      [`${routePath}some-preview`, true],
      [`${routePath}some-preview.html`, true],
      [`${routePath}some-preview/`, true],
      [`${routePath}some-preview/index.html`, true],
      [`${routePath}nested/deep-preview.html`, true],
      // Sibling routes that merely START with the same text must NOT be
      // swept in by the prefix branch.
      [`${base}s`, false],
      [`${base}s.html`, false],
      [`${base}er/thing`, false]
    );
  } else {
    matcherCases.push(
      [routePath, true],
      [`${routePath}.html`, true],
      [`${routePath}/`, true],
      [`${routePath}/index.html`, true],
      // An exact entry is NOT a prefix: a deeper route under it keeps the
      // nav unless it is listed in its own right.
      [`${routePath}-extra`, false],
      [`${routePath}x.html`, false]
    );
  }
}

// Real product routes that must keep the nav, whatever shape they arrive in
// (the static export emits a .html file for every one of these too).
for (const productRoute of ["/", "/spend", "/spend/shape", "/upcoming", "/planning", "/penny", "/settings", "/cards", "/tax", "/receipts", "/accounts", "/month"]) {
  matcherCases.push([productRoute, false]);
  if (productRoute !== "/") {
    matcherCases.push([`${productRoute}.html`, false], [`${productRoute}/`, false], [`${productRoute}/index.html`, false]);
  } else {
    matcherCases.push(["/index.html", false]);
  }
}

// Empty/absent pathname: usePathname() can be null on the very first render.
matcherCases.push([null, false], [undefined, false], ["", false]);

for (const [candidate, expected] of matcherCases) {
  let actual;
  try {
    actual = isNavExemptPath(candidate);
  } catch (err) {
    failures.push(`lib/navExemptRoutes.ts: isNavExemptPath(${JSON.stringify(candidate)}) threw (${err?.message ?? err}).`);
    continue;
  }
  if (actual !== expected) {
    failures.push(
      expected
        ? `lib/navExemptRoutes.ts: isNavExemptPath(${JSON.stringify(candidate)}) is false, but that pathname is one of the shapes a listed nav-exempt route is reached in (a Next static export serves the literal ".html" file, which is what the Board Android app loads) — the nav will render over an explicitly exempted route.`
        : `lib/navExemptRoutes.ts: isNavExemptPath(${JSON.stringify(candidate)}) is true, but that route is not on the exemption list — the matcher is over-normalising and has silently removed the nav from a real product surface.`
    );
  }
}

// One explicit, non-generated regression case, named so a future reader sees
// the actual reported bug rather than only the generated table (Kevin,
// 2026-09-17: the nav rendered on the board inside the Board Android app).
if (!isNavExemptPath("/ops/go-live.html")) {
  failures.push(
    'lib/navExemptRoutes.ts: isNavExemptPath("/ops/go-live.html") is false — this is H75 exactly: the Board Android app\'s start shim loads /ops/go-live.html (the literal file the static export emits, since Capacitor\'s local asset server resolves real filenames), so the bottom nav renders over the private admin board.'
  );
}

// ── Report ────────────────────────────────────────────────────────────────

if (failures.length === 0) {
  console.log(
    `check:nav-coverage OK (${NAV_EXEMPT_ROUTES.length} named nav exemptions verified, ${candidateFiles.length} files checked for a duplicate BottomNav mount, ${matcherCases.length} isNavExemptPath cases asserted)`
  );
  process.exit(0);
}

console.error("Nav coverage check failed:\n");
for (const f of failures) console.error(`  - ${f}`);
console.error("\nSee lib/navExemptRoutes.ts (the single source of truth BottomNav.tsx and this script both read).");
process.exit(1);
