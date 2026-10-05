import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { shouldGuard, touchAllowed, installPennyIosPanGuard, stableAcross } from "../lib/pennyIosPanGuard.ts";
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
assert.match(panel, /Boolean\(viewport\?\.iosStable\) && shouldGuard\(Boolean\(viewport\?\.keyboardVisible\), Boolean\(viewport\?\.layoutShrank\)\)/, "guard enabled expression excludes layoutShrank");
assert.equal((panel.match(/usePennyIosPanGuard\(/g) ?? []).length, 1);
assert.match(panel, /iosGuard = typing && Boolean\(viewport\?\.iosStable\)/);
assert.match(panel, /\{iosGuard && <div className="penny-typing-underlay"/, "underlay exists only while the iOS typing guard is on");
assert.doesNotMatch(read("../lib/pennyIosPanGuard.ts"), /backdrop-filter|blur/);
const css = read("../components/PennySheetPanel.styles.ts");
assert.match(css, /\.penny-typing-underlay \{[^}]*inset: 0[^}]*var\(--background\)/);
const underlayCss = css.match(/\.penny-typing-underlay \{[^}]*\}/)[0];
assert.doesNotMatch(underlayCss, /blur|opacity|rgba/, "underlay is opaque, not a scrim");
assert.match(underlayCss, /pointer-events: none/, "taps reach the click-catcher");
assert.match(css, /\[data-penny-ios-guard\] \[data-penny-scroll\] \{ touch-action: pan-y; overscroll-behavior: contain/);
const hook = read("../lib/usePennyIosPanGuard.ts");
assert.match(hook, /if \(!enabled\) return;/);
assert.match(hook, /acquireLock: acquireScrollLock/);
assert.doesNotMatch(hook + read("../lib/pennyIosPanGuard.ts"), /scrollY|scrollX/, "never scrollTo from scrollY");
const kb = read("../lib/usePennyKeyboard.ts");
assert.match(kb, /iosStable/);
assert.doesNotMatch(kb, /settled:|\.settled|setInterval/);
// stableAcross: two consecutive iOS-strategy reads.
const iosRead = (visible, shrank) => visible && !shrank;
const seq = reads => reads.reduce((st, [v, sh]) => ({ prev: iosRead(v, sh), stable: stableAcross(st.prev, iosRead(v, sh)) }), { prev: false, stable: false }).stable;
assert.equal(seq([[true, false], [true, false]]), true, "two iOS reads: stable");
assert.equal(seq([[true, false]]), false, "one read is not stable");
assert.equal(seq([[true, false], [true, true]]), false, "Android transient corrected by the next read: not stable");
assert.equal(seq([[true, true], [true, true], [true, true]]), false, "shrunk layout is never stable");
assert.match(read("../components/PennyConversation.tsx"), /data-penny-scroll=\{inSheet/);

// Runtime: installPennyIosPanGuard against fakes.
function fakes({ offsetTop = 0, scroller = true } = {}) {
  const log = [];
  const mk = name => ({ listeners: [], addEventListener(t, f) { log.push(`add ${name}:${t}`); this.listeners.push([t, f]); }, removeEventListener(t, f) { log.push(`remove ${name}:${t}`); this.listeners = this.listeners.filter(([a, b]) => !(a === t && b === f)); }, fire(t, e) { this.listeners.filter(([a]) => a === t).forEach(([, f]) => f(e)); } });
  const vv = Object.assign(mk("vv"), { height: 480, offsetTop, offsetLeft: 0 });
  const win = Object.assign(mk("win"), { innerHeight: 844, visualViewport: vv, scrollTo: (x, y) => log.push(`scrollTo ${x},${y}`) });
  const inside = {};
  const el = { scrollTop: 100, scrollHeight: 1000, clientHeight: 400, contains: n => n === inside };
  const doc = Object.assign(mk("doc"), { documentElement: { style: { height: "auto", overflow: "visible" } }, body: { style: { height: "7px" } }, orig: { h: "auto", o: "visible", b: "7px" }, querySelector: () => (scroller ? el : null) });
  return { log, vv, win, doc, inside, el };
}
const lockLog = (log, doc) => () => { log.push("lock"); return () => { log.push("release"); if (doc) log.push(`state@release ${doc.documentElement.style.height}|${doc.documentElement.style.overflow}|${doc.body.style.height}`); }; };
{
  const f = fakes();
  const teardown = installPennyIosPanGuard(f.win, f.doc, { acquireLock: lockLog(f.log, f.doc) });
  assert.equal(f.log[0], "lock", "lock is acquired before anything is clamped");
  assert.equal(f.doc.documentElement.style.height, "480px");
  assert.equal(f.doc.body.style.height, "480px");
  assert.equal(f.doc.documentElement.style.overflow, "hidden");
  f.vv.fire("scroll");
  assert.equal(f.log.filter(l => l.startsWith("scrollTo")).length, 0, "offsetTop 0: scrollTo not called");
  f.vv.offsetTop = 40;
  f.vv.fire("scroll");
  assert.equal(f.log.filter(l => l === "scrollTo 0,0").length, 1, "offsetTop 40: snapped once");
  // touch guard
  const prevent = [];
  const touch = (target, y) => ({ target, touches: [{ clientY: y }], cancelable: true, preventDefault: () => prevent.push(1) });
  f.doc.fire("touchstart", touch(f.inside, 300));
  f.doc.fire("touchmove", touch({}, 250));
  assert.equal(prevent.length, 1, "touchmove outside the scroller is cancelled");
  f.doc.fire("touchmove", touch(f.inside, 250));
  assert.equal(prevent.length, 1, "inside with room is not cancelled");
  const adds = f.log.filter(l => l.startsWith("add ")).length;
  teardown();
  assert.equal(f.log.filter(l => l.startsWith("remove ")).length, adds, "every listener removed");
  assert.equal(f.vv.listeners.length + f.win.listeners.length + f.doc.listeners.length, 0);
  assert.deepEqual([f.doc.documentElement.style.height, f.doc.documentElement.style.overflow, f.doc.body.style.height], ["auto", "visible", "7px"], "exact previous inline values restored");
  assert.ok(f.log.includes("release"));
assert.equal(f.log.at(-1), "state@release auto|visible|7px", "at the moment the lock is released the clamps are already restored");
}
console.log("g211-ios-pan-guard: ok");
