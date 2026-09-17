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
//   4. BOTH rails consult the list: components/BottomNav.tsx (the phone
//      rail) and components/Sidebar.tsx (the desktop rail) each import
//      isNavExemptPath and bail on a match. Added by H75: Sidebar never
//      consulted the list at all, so every route below still got the
//      desktop rail; an entry in that list means "no primary navigation
//      here", which is both rails or it means nothing.
//   5. The pre-paint <head> script (lib/navExemptRoutes.ts's
//      PRE_PAINT_NAV_SCRIPT, interpolated by app/layout.tsx) agrees with
//      isNavExemptPath — not by inspection, by EXECUTION: it is run in a
//      sandbox over the same case table below. It is a stringified script
//      that runs before any module of ours has loaded, so it cannot call
//      the real matcher, and a comment asking a future reader to keep the
//      two in step is the same class of promise that let the desktop rail
//      ignore this list until H75.
//   6. globals.css still carries the `html.nav-exempt` rules that release
//      the rail's reserved margin. Hiding a `position: fixed` rail without
//      releasing its 16rem of margin-left leaves a 256px dead gutter; the
//      two are a pair and this check is what stops them drifting apart.
//   7. isNavExemptPath actually EXEMPTS each listed entry in every shape
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
import vm from "node:vm";
import { NAV_EXEMPT_ROUTES, LEGAL_PAGE_ROUTES, PRE_PAINT_NAV_SCRIPT, isNavExemptPath, normaliseNavPath } from "../lib/navExemptRoutes.ts";

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

// ── 4: both rails obey the list ──────────────────────────────────────────

const railFiles = [
  ["components/BottomNav.tsx", "the phone rail"],
  ["components/Sidebar.tsx", "the desktop rail"],
];
const EXEMPT_IMPORT_RE = /import\s*\{[^}]*\bisNavExemptPath\b[^}]*\}\s*from\s*["']@\/lib\/navExemptRoutes["']/;
// Deliberately loose about SHAPE, strict about SUBSTANCE: the file must ask
// this list about the current pathname and must have a `return null` to act
// on the answer. It used to demand the exact text
// `if (isNavExemptPath(pathname)) return null;`, which would have failed on
// a harmless reformat to a braced body, or on assigning the answer to a
// const first — which Sidebar.tsx now does, since its effect needs the same
// value. Failing a gate on formatting trains people to work around the gate.
const EXEMPT_CALL_RE = /isNavExemptPath\(\s*pathname\s*\)/;
const RETURN_NULL_RE = /return\s+null\s*;/;

for (const [relFile, what] of railFiles) {
  const full = path.join(frontendRoot, relFile);
  if (!exists(full)) {
    failures.push(`${relFile} is missing — this script expects ${what} to live here and to consult lib/navExemptRoutes.ts.`);
    continue;
  }
  const source = readFileSync(full, "utf8");
  if (!EXEMPT_IMPORT_RE.test(source) || !EXEMPT_CALL_RE.test(source) || !RETURN_NULL_RE.test(source)) {
    failures.push(
      `${relFile} (${what}) does not consult lib/navExemptRoutes.ts — expected an \`isNavExemptPath\` import from "@/lib/navExemptRoutes", a call on the current pathname, and a \`return null\` acting on it. An entry in that list means "no primary navigation on this route", which is BOTH rails: until H75 the desktop rail ignored the list entirely and rendered over every exempted route, including the owner-only /ops/go-live board (and on a tablet the Board Android app is >= lg, so that rail links straight out of the board).`
    );
  }
}

// Sidebar owns the other half of the pre-paint class: the script in <head>
// cannot see a client-side route change, so the rail's own component keeps
// `nav-exempt` in sync. Without this the margin is released on a hard load
// of an exempt route and never on a soft navigation into or out of one.
const sidebarSource = readFileSync(path.join(componentsDir, "Sidebar.tsx"), "utf8");
if (!/nav-exempt/.test(sidebarSource) || !/useEffect/.test(sidebarSource)) {
  failures.push(
    'components/Sidebar.tsx no longer keeps the `nav-exempt` class in sync (expected a useEffect toggling it on document.documentElement). app/layout.tsx\'s pre-paint script only runs on a full page load, so without this a client-side route change into an exempt route keeps the rail\'s 256px reserved margin, and one out of it keeps the margin released.'
  );
}

// ── 5: the pre-paint script agrees with the matcher, by execution ────────

function prePaintClassesFor(pathname) {
  const added = new Set();
  const sandbox = {
    location: { pathname },
    document: { documentElement: { classList: { add: (c) => added.add(c) } } },
  };
  vm.runInNewContext(PRE_PAINT_NAV_SCRIPT, sandbox, { timeout: 1000 });
  return added;
}

// ── 6: globals.css still releases the rail's reserved margin ─────────────

const globalsCss = readFileSync(path.join(appDir, "globals.css"), "utf8");
const NAV_EXEMPT_SHELL_RE = /html\.nav-exempt\s+#app-shell\s*\{[^}]*margin-left:\s*0[^}]*\}/;
const NAV_EXEMPT_ASIDE_RE = /html\.nav-exempt\s+aside\s*\{[^}]*display:\s*none[^}]*\}/;
if (!NAV_EXEMPT_SHELL_RE.test(globalsCss)) {
  failures.push(
    "app/globals.css: no `html.nav-exempt #app-shell { ... margin-left: 0 ... }` rule. #app-shell reserves 16rem of margin-left for a `position: fixed` rail at >= 1024px, so an exempt route without this rule renders with a 256px dead gutter and its content 128px off centre (measured on /design, /ops/go-live, /ops/broadcast and /oauth/consent). Hiding the rail and releasing its margin are one change, not two."
  );
}
if (!NAV_EXEMPT_ASIDE_RE.test(globalsCss)) {
  failures.push(
    "app/globals.css: no `html.nav-exempt aside { display: none }` rule. That is what keeps the rail from flashing on an exempt route before hydration, on the same pre-paint class the margin release uses."
  );
}

// ── 7: the matcher exempts every listed entry, in every reachable shape ──
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

// One assumption, stated rather than left to be discovered: the generated
// negatives below (`${base}s`, `${base}-extra`, `${base}x.html`) assume no
// entry is a text prefix of another entry. Adding "/term" beside "/terms"
// would make "/terms" a generated negative of "/term" and fail this check
// spuriously. If that day comes, the entries are the truth and this
// generator is what needs the special case.
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
  // The pre-paint script must reach the same verdict as the matcher for
  // every case, including the null/undefined ones the script never sees
  // (location.pathname is always a string, so those are skipped below).
  if (typeof candidate === "string" && candidate !== "") {
    let classes;
    try {
      classes = prePaintClassesFor(candidate);
    } catch (err) {
      failures.push(`lib/navExemptRoutes.ts: PRE_PAINT_NAV_SCRIPT threw on ${JSON.stringify(candidate)} (${err?.message ?? err}) — it runs in <head> before anything else, so a throw there is a blank first paint.`);
      classes = new Set();
    }
    if (classes.has("nav-exempt") !== expected) {
      failures.push(
        `lib/navExemptRoutes.ts: PRE_PAINT_NAV_SCRIPT and isNavExemptPath disagree on ${JSON.stringify(candidate)} (script says ${classes.has("nav-exempt")}, matcher says ${expected}). These are the same decision made twice, once before paint and once at render; when they drift, an exempt route either keeps the rail's 256px reserved margin or releases it on a route that still has a rail.`
      );
    }
    const legalExpected = LEGAL_PAGE_ROUTES.includes(normaliseNavPath(candidate));
    if (classes.has("legal-page") !== legalExpected) {
      failures.push(
        `lib/navExemptRoutes.ts: PRE_PAINT_NAV_SCRIPT sets legal-page=${classes.has("legal-page")} for ${JSON.stringify(candidate)}, expected ${legalExpected} (LEGAL_PAGE_ROUTES: ${LEGAL_PAGE_ROUTES.join(", ")}). That class is what makes a published legal document full-bleed at every width.`
      );
    }
  }

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
    `check:nav-coverage OK (${NAV_EXEMPT_ROUTES.length} named nav exemptions verified, ${railFiles.length} rails confirmed to consult the list, the nav-exempt CSS reset present, ${candidateFiles.length} files checked for a duplicate BottomNav mount, ${matcherCases.length} cases asserted against both isNavExemptPath and the pre-paint script)`
  );
  process.exit(0);
}

console.error("Nav coverage check failed:\n");
for (const f of failures) console.error(`  - ${f}`);
console.error("\nSee lib/navExemptRoutes.ts (the single source of truth BottomNav.tsx and this script both read).");
process.exit(1);
