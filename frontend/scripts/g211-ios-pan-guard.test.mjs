import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { shouldGuard, touchAllowed } from "../lib/pennyIosPanGuard.ts";
import { pennyBottomInset } from "../lib/pennyKeyboardViewport.ts";

// shouldGuard matrix: iOS strategy only.
assert.equal(shouldGuard(true, true), false, "Android/app shell (layout shrank) is never guarded");
assert.equal(shouldGuard(true, false), true, "iOS with keyboard up is guarded");
assert.equal(shouldGuard(false, false), false, "hidden keyboard releases the guard");
assert.equal(shouldGuard(false, true), false);

// touchAllowed. deltaY > 0 scrolls towards the end, < 0 towards the start.
const inside = {}; const outside = {};
const scroller = { contains: n => n === inside };
assert.equal(touchAllowed(inside, scroller, 100, 1000, 400, 10), true, "mid-scroll either way");
assert.equal(touchAllowed(inside, scroller, 100, 1000, 400, -10), true);
assert.equal(touchAllowed(inside, scroller, 0, 1000, 400, -10), false, "top, scrolling up: rubber-band blocked");
assert.equal(touchAllowed(inside, scroller, 0, 1000, 400, 10), true, "top, scrolling down is fine");
assert.equal(touchAllowed(inside, scroller, 600, 1000, 400, 10), false, "bottom, scrolling down: blocked");
assert.equal(touchAllowed(inside, scroller, 600, 1000, 400, -10), true);
assert.equal(touchAllowed(inside, scroller, 0, 400, 400, 10), false, "content that cannot scroll never allows a move");
assert.equal(touchAllowed(outside, scroller, 100, 1000, 400, 10), false, "outside the scroller: blocked");
assert.equal(touchAllowed(null, scroller, 100, 1000, 400, 10), false);
assert.equal(touchAllowed(inside, null, 100, 1000, 400, 10), false);

// Composer inset: iOS offsetTop is counted once, the keyboard edge is right.
assert.equal(pennyBottomInset(844, { height: 500, top: 24, scale: 1 }, false), 320, "visual top + height = keyboard edge");
assert.equal(pennyBottomInset(844, { height: 524, top: 0, scale: 1 }, false), 320);

// Source guards.
const read = p => readFileSync(new URL(p, import.meta.url), "utf8");
const panel = read("../components/PennySheetPanel.tsx");
assert.match(panel, /shouldGuard\(Boolean\(viewport\?\.keyboardVisible\), Boolean\(viewport\?\.layoutShrank\)\)/, "guard enabled expression excludes layoutShrank");
assert.equal((panel.match(/usePennyIosPanGuard\(/g) ?? []).length, 1);
assert.match(panel, /iosGuard = typing && shouldGuard/);
assert.match(panel, /\{iosGuard && <div className="penny-typing-underlay"/, "underlay exists only while the iOS typing guard is on");
assert.doesNotMatch(read("../lib/pennyIosPanGuard.ts"), /backdrop-filter|blur/);
const css = read("../components/PennySheetPanel.styles.ts");
assert.match(css, /\.penny-typing-underlay \{[^}]*inset: 0[^}]*var\(--background\)/);
assert.doesNotMatch(css.match(/\.penny-typing-underlay \{[^}]*\}/)[0], /blur|opacity|rgba/, "underlay is opaque, not a scrim");
assert.match(css, /\[data-penny-ios-guard\] \[data-penny-scroll\] \{ touch-action: pan-y; overscroll-behavior: contain/);
const hook = read("../lib/usePennyIosPanGuard.ts");
assert.match(hook, /if \(!enabled\) return;/);
assert.match(hook, /passive: false/);
for (const restore of ["html.height = prev.htmlHeight", "body.height = prev.bodyHeight", 'removeEventListener("touchmove"']) assert.ok(hook.includes(restore), restore);
assert.match(read("../components/PennyConversation.tsx"), /data-penny-scroll=\{inSheet/);
console.log("g211-ios-pan-guard: ok");
