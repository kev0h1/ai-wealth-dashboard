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
assert.match(brief, /<HomeGreetingHeader greeting=\{greeting\.text\} avatarInitials=\{avatarInitials\} namePending=\{greeting\.namePending\} \/>/, "live brief renders the shared header");
const skeleton = page.slice(page.indexOf("function HomeSkeleton"), page.indexOf("export default function HomePage"));
assert.match(skeleton, /<HomeGreetingHeader greeting=\{greeting\.text\} avatarInitials=\{initialsOf\(displayName\) \?\? null\} namePending=\{greeting\.namePending\} \/>/, "skeleton renders the shared header with the same greeting logic (G488)");
assert.doesNotMatch(skeleton, /text-\[28px\] font-bold/, "skeleton no longer carries its own 28px heading");
assert.doesNotMatch(brief.slice(brief.indexOf("export default function HomeBrief")), /className="rise-in"/, "brief root has no rise-in that would re-fade the header");
assert.match(brief, /buildGreeting\(hour, firstName, nameResolved\)/, "live greeting comes from the same shared builder as the skeleton (G488)");

assert.match(skeleton.slice(0, 600), /aria-hidden="true"\s+inert/, "skeleton root is inert so its header links are not focusable");

// Markup identity and content.
const html = renderToStaticMarkup(h(HomeGreetingHeader, { greeting: "Hi, Alex", avatarInitials: "AB" }));
const heading = html.match(/<h1\b[^>]*>(.*?)<\/h1>/s)?.[1].replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
assert.equal(heading, "Hi, Alex", "the responsive greeting preserves its words and separating space");
assert.match(html, /aria-label="Account and settings"[^>]*href="\/settings"/);
assert.match(html, /aria-label="Your accounts"[^>]*href="\/accounts"/);
assert.match(html, /aria-label="Home shortcuts"/);
assert.match(html, /data-phosphor-icon="bank"/);
assert.match(html, /data-phosphor-icon="gear-six"/);
assert.doesNotMatch(html, /lucide-/);
assert.equal((html.match(/data-phosphor-icon=/g) ?? []).length, 2, "bank and settings are the two icons when the profile shows initials");
assert.match(html, />AB</);
assert.match(renderToStaticMarkup(h(HomeGreetingHeader, { greeting: "Good morning", avatarInitials: null })), /data-phosphor-icon="user-circle"/, "no name falls back to the person icon");

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
