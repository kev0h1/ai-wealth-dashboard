// G411: Home first paint matches the live header, and the service worker can
// never serve an old build's shell.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import HomeGreetingHeader from "../components/HomeGreetingHeader.tsx";

const brief = readFileSync(new URL("../components/HomeBrief.tsx", import.meta.url), "utf8");
const page = readFileSync(new URL("../app/components/HomePage.tsx", import.meta.url), "utf8");

// One shared header: both the live brief and the skeleton render it.
assert.match(brief, /<HomeGreetingHeader greeting=\{greeting\} avatarInitials=\{avatarInitials\} \/>/, "live brief renders the shared header");
const skeleton = page.slice(page.indexOf("function HomeSkeleton"), page.indexOf("export default function HomePage"));
assert.match(skeleton, /<HomeGreetingHeader greeting=\{`Hi, \$\{firstName \|\| "there"\}`\} avatarInitials=\{initialsOf\(displayName\) \?\? null\} \/>/, "skeleton renders the shared header with the neutral first-paint greeting");
assert.doesNotMatch(skeleton, /text-\[28px\] font-bold/, "skeleton no longer carries its own 28px heading");
assert.doesNotMatch(brief.slice(brief.indexOf("export default function HomeBrief")), /className="rise-in"/, "brief root has no rise-in that would re-fade the header");
assert.match(brief, /useState\(`Hi, \$\{name\}`\)/, "live first paint greeting is the same neutral Hi, name");

// Markup identity and content.
const html = renderToStaticMarkup(h(HomeGreetingHeader, { greeting: "Hi, Kevin", avatarInitials: "KM" }));
assert.match(html, /<h1[^>]*text-\[20px\][^>]*sm:text-\[28px\][^>]*>Hi, Kevin<\/h1>/);
assert.match(html, /aria-label="Account and settings"[^>]*href="\/settings"/);
assert.match(html, /href="\/accounts"[^>]*>.*Accounts<\/a>/s);
assert.match(html, />KM</);
assert.equal(renderToStaticMarkup(h(HomeGreetingHeader, { greeting: "Hi, there", avatarInitials: null })).includes("lucide-user-round"), true, "no name falls back to the person icon");

// Service worker: load it into a stub scope.
const src = readFileSync(new URL("../public/sw.js", import.meta.url), "utf8");
const handlers = {};
const deleted = [];
const scope = {
  self: { addEventListener: (type, fn) => { handlers[type] = fn; }, skipWaiting() {}, clients: { claim: async () => {}, matchAll: async () => [] }, registration: {} },
  caches: { keys: async () => ["wealth-v1", "next-shell-old", "other"], delete: async (k) => { deleted.push(k); return true; } },
  clients: {},
};
vm.runInNewContext(src, scope);
assert.equal(handlers.fetch, undefined, "no fetch handler: navigations always go to the network, never cache-first");
assert.ok(handlers.activate && handlers.install && handlers.push, "install, activate and push handlers exist");
let pending;
handlers.activate({ waitUntil: (p) => { pending = p; } });
await pending;
assert.deepEqual(deleted.sort(), ["next-shell-old", "other", "wealth-v1"], "activate deletes every cache not owned by the current version");
assert.doesNotMatch(src, /cache\.addAll|caches\.open|cache\.put/, "nothing is precached or stored");
console.log("g411 home skeleton and service worker checks passed");
