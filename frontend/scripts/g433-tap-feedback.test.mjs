import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// G433: no square browser tap flash; the bottom nav gives rounded press feedback instead.
const dir = new URL("..", import.meta.url);
const read = (env, path) => readFileSync(process.env[env] ?? new URL(path, dir), "utf8");
const globals = read("G433_GLOBALS", "app/globals.css");
const nav = read("G433_NAV", "components/navigation/BottomNav.module.css");

assert.ok(/(^|\n)html\s*\{[^}]*-webkit-tap-highlight-color:\s*transparent/.test(globals), "globals.css must set a transparent tap highlight on html");

for (const m of nav.matchAll(/-webkit-tap-highlight-color:\s*([^;}]+)/g)) {
  assert.equal(m[1].trim(), "transparent", "nav css has a non-transparent tap highlight");
}

assert.ok(/\.tab:active\s*\{[^}]*background:\s*rgb\(79 70 229 \/ \.12\)/.test(nav), ".tab:active must carry the rounded tint");
assert.ok(/\.penny\.pennyPress:active\s*\{[^}]*box-shadow:\s*inset[^;}]*rgb\(79 70 229 \/ \.12\)/.test(nav), "launcher :active must carry the tint inside its own corners");
assert.ok(/\.tab\s*\{[^}]*border-radius:\s*14px/.test(nav) && /\.penny\s*\{[^}]*border-radius:\s*16px/.test(nav), "tab and launcher keep their radii");

// The tint is press-only: hover stays gated and plain :focus is never styled.
const stripped = nav.replace(/@media \(hover: hover\) \{[^{}]*\{[^{}]*\}\s*\}/g, "");
assert.ok(!/:hover/.test(stripped), "a :hover rule sits outside @media (hover: hover)");
assert.ok(!/:focus(?!-visible)/.test(nav), "plain :focus styling found in nav css");
// Global fallback: layered (so utilities outrank it), zero specificity, disabled controls excluded.
const layer = globals.match(/@layer base \{([\s\S]*?)\n\}/);
assert.ok(layer, "globals.css needs an @layer base block");
assert.ok(/:where\(button, a\[href\][^)]*\):active:not\(:disabled\):not\(\[aria-disabled="true"\]\)\s*\{\s*opacity:\s*\.8/.test(layer[1]), "press fallback must be :where(...):active:not(:disabled) inside @layer base");
console.log("g433 tap feedback: ok");
