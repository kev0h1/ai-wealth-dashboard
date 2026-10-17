// G284: every route the server hands the app as an action must exist in the
// Capacitor static export, and every component that renders a server action
// must navigate through the one helper (lib/actionRoutes.ts) with the client
// router or <Link>. Background: "See your tax levers" was a raw <a href="/tax">;
// the native shell answers a full navigation to an extensionless path with
// index.html, so the tap reloaded Home. Also /debt-plan had no page in the
// export (redirects() is disabled for output: "export").
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { actionHref } from "../lib/actionRoutes.ts";

const root = new URL("..", import.meta.url).pathname;
const repo = join(root, "..");

function walk(dir, exts, skip = [], out = []) {
  for (const name of readdirSync(dir)) {
    if (["node_modules", ".next", ".mobile-build", "out", ...skip].includes(name)) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, exts, skip, out);
    else if (exts.some((e) => p.endsWith(e))) out.push(p);
  }
  return out;
}

// 1. Routes the export drops: build-mobile.sh patches only the OAuth callback
// route handlers (they stay in the export as force-static 204s). Nothing under
// app/ is excluded from the page set, so a page file is a page in the export.
const buildMobile = readFileSync(join(root, "scripts/build-mobile.sh"), "utf8");
const callbackHandlers = [...buildMobile.matchAll(/"(app\/[^"]+\/route\.ts)"/g)].map((m) => m[1]);
assert.ok(callbackHandlers.length > 0, "could not parse build-mobile.sh FILES");

// 2. Server action routes: literal "/..." values of route/url keys in the backend.
const API_ONLY = new Map([
  // Carries kind "confirm_payday": the ask:payday card POSTs it via api.confirmPayday, never navigates.
  ["/income/confirm-payday", "api-only action, handled by the bespoke payday card"],
]);
const pyFiles = walk(join(repo, "backend/app"), [".py"], ["__pycache__"]);
const routes = new Map();
const RE = /\b(?:route|url|_route)["']?\s*[:=]\s*f?"(\/[a-z][^"{?#]*)/gi;
for (const f of pyFiles) {
  const src = readFileSync(f, "utf8");
  for (const m of src.matchAll(RE)) {
    if (/^\/(api|auth|bank_accounts)\b/.test(m[1])) continue;
    if (!routes.has(m[1])) routes.set(m[1], []);
    routes.get(m[1]).push(relative(repo, f));
  }
}
for (const required of ["/tax", "/upcoming", "/cards", "/month/story", "/accounts", "/spend", "/planning", "/settings"]) {
  assert.ok(routes.has(required), `route scan lost ${required}: the backend scan regex is stale`);
}

function pageExists(path) {
  const dir = join(root, "app", path === "/" ? "" : path);
  return existsSync(join(dir, "page.tsx")) || existsSync(join(dir, "page.ts"));
}

const problems = [];
for (const [route, files] of routes) {
  if (API_ONLY.has(route)) continue;
  const resolved = actionHref(route);
  if (!pageExists(resolved)) problems.push(`${route} (from ${[...new Set(files)].join(", ")}) resolves to ${resolved}, which has no page under app/ so the app export lacks it`);
  const segs = resolved.split("/").filter(Boolean);
  if (callbackHandlers.some((h) => h.startsWith(`app/${segs.join("/")}/`)) ) problems.push(`${route} is an OAuth callback route, excluded from native`);
}
assert.deepEqual(problems, [], problems.join("\n"));

// Retired routes are rewritten, queries survive, junk falls back.
assert.equal(actionHref("/debt-plan"), "/cards");
assert.equal(actionHref("/debt-plan?x=1"), "/cards?x=1");
assert.equal(actionHref("/tax"), "/tax");
assert.equal(actionHref("https://evil.example/x"), "/upcoming");
assert.equal(actionHref("//evil.example"), "/upcoming");
assert.equal(actionHref(undefined, "/spend"), "/spend");

// 3. Components rendering server actions use the helper, never a raw in-app anchor or window.location.
const tsx = walk(root, [".tsx"], ["design", "ops", "scripts"]);
// Deliberate full navigations: global-error.tsx replaces the whole root layout, so a
// client router does not exist there, and "/" is index.html in the shell anyway; the
// OAuth consent hop is a web-only flow whose route the native build excludes.
const FULL_NAV_OK = ["app/global-error.tsx", "components/AuthProvider.tsx:361"];
const offenders = [];
for (const file of tsx) {
  const rel = relative(root, file);
  const src = readFileSync(file, "utf8");
  src.split("\n").forEach((line, i) => {
    const at = `${rel}:${i + 1}`;
    if (FULL_NAV_OK.some((ok) => at === ok || rel === ok)) return;
    if (/\b(?:action|link|needleItem\.action|secondary_action)!?\??\.route\b/.test(line) && !/actionHref\(|\?\.route\?\.replace|\.route\s*[!=]==?|\?\s*item\.action\?\.route/.test(line) && !/^\s*(\/\/|\*)/.test(line)) {
      // allow reads that are not navigations (comparisons, keys, props)
      if (/(router\.(push|replace)|href=|location)/.test(line)) offenders.push(`${at}: server route not passed through actionHref: ${line.trim().slice(0, 100)}`);
    }
    if (/<a\s[^>]*href=(?:"\/(?!\/)|\{`\/|\{[^}]*route)/.test(line)) offenders.push(`${at}: raw <a href> to an in-app path (full navigation); use <Link>: ${line.trim().slice(0, 100)}`);
    if (/window\.location\.(href|assign|replace)\s*(=|\()\s*(`\/|"\/|[a-z_.]*route)/i.test(line)) offenders.push(`${at}: window.location for an in-app path: ${line.trim().slice(0, 100)}`);
  });
}
assert.deepEqual(offenders, [], offenders.join("\n"));

console.log(`g284-native-action-routes: ${routes.size} server routes verified (${API_ONLY.size} api-only), ${tsx.length} components scanned`);
