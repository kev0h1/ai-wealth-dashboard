// G207: tests for lib/swipeGesture.ts (pure) plus source assertions on the
// components that use it.
//   npm run -s check:swipe-gesture
import { readFileSync } from "node:fs";
import { createSwipeGesture, swipeOpacity } from "../lib/swipeGesture.ts";

let failures = 0;
function check(label, cond) {
  if (!cond) { failures += 1; console.error(`FAIL: ${label}`); } else console.log(`PASS: ${label}`);
}

// Vertical-first movement never produces an offset, even if it later drifts left.
{
  const g = createSwipeGesture({ axis: "x", sign: -1 });
  g.start(200, 300, 0);
  const moves = [[199, 312], [190, 330], [100, 380], [20, 400]].map(([x, y]) => g.move(x, y));
  check("vertical-first: no offset", moves.every((m) => m.offset === 0 && !m.dragging && !m.capture));
  check("vertical-first: phase ignored", g.phase === "ignored");
  check("vertical-first: end is none", g.end(20, 400, 400, 300).action === "none");
}
// Sub-threshold wobble does not lock or capture.
{
  const g = createSwipeGesture();
  g.start(200, 300, 0);
  const m = g.move(195, 303);
  check("below lockPx: no offset, no capture", m.offset === 0 && !m.capture && g.phase === "pending");
}
// Rightward lock on a left-dismiss card is ignored.
{
  const g = createSwipeGesture({ axis: "x", sign: -1 });
  g.start(100, 100, 0);
  check("wrong-way lock ignored", g.move(130, 101).offset === 0 && g.phase === "ignored");
}
// Horizontal lock captures exactly once and follows the finger.
{
  const g = createSwipeGesture({ axis: "x", sign: -1 });
  g.start(300, 100, 0);
  const a = g.move(280, 102);
  const b = g.move(240, 104);
  check("horizontal: captures once on lock", a.capture === true && b.capture === false);
  check("horizontal: offset tracks finger", a.offset === 20 && b.offset === 60 && b.dragging);
  const r = g.end(100, 105, 1000, 300);
  check("horizontal past threshold dismisses", r.action === "dismiss");
}
// Below threshold springs back; slow.
{
  const g = createSwipeGesture({ axis: "x", sign: -1 });
  g.start(300, 100, 0);
  g.move(270, 100);
  g.move(250, 100);
  check("below threshold springs back", g.end(250, 100, 2000, 300).action === "spring-back");
}
// Flick dismisses below the distance threshold.
{
  const g = createSwipeGesture({ axis: "x", sign: -1 });
  g.start(300, 100, 0);
  g.move(270, 100);
  check("fast flick dismisses", g.end(240, 100, 60, 300).action === "dismiss");
}
// pointercancel / lostpointercapture reset, and are no-ops after a normal end.
{
  const g = createSwipeGesture();
  g.start(300, 100, 0);
  g.move(250, 100);
  check("cancel mid-drag asks for reset", g.cancel() === true && g.phase === "idle" && g.offset === 0);
  check("move after cancel is inert", g.move(200, 100).offset === 0);
  g.start(300, 100, 0);
  g.move(250, 100);
  g.end(250, 100, 3000, 300);
  check("cancel after end is a no-op (lostpointercapture after pointerup)", g.cancel() === false);
}
// Vertical variant (G205 swipe-down) is a parameter.
{
  const g = createSwipeGesture({ axis: "y", sign: 1 });
  g.start(100, 100, 0);
  const m = g.move(102, 140);
  check("vertical variant locks on downward drag", m.capture && m.offset === 40);
  check("vertical variant dismisses past threshold", g.end(102, 300, 1000, 400).action === "dismiss");
  const h = createSwipeGesture({ axis: "y", sign: 1 });
  h.start(100, 100, 0);
  check("vertical variant ignores horizontal-first", h.move(140, 102).offset === 0 && h.phase === "ignored");
}
// Explicit undefined options (as the React hook forwards them) keep defaults.
{
  const g = createSwipeGesture({ axis: "x", sign: -1, lockPx: undefined, dismissFraction: undefined, flickVelocity: undefined });
  g.start(300, 100, 0);
  check("undefined options keep defaults and still lock", g.move(280, 100).capture === true);
}
// Reduced motion.
{
  const g = createSwipeGesture({ reducedMotion: true });
  g.start(300, 100, 0);
  g.move(250, 100);
  check("reduced motion: end reports no animation", g.end(50, 100, 1000, 300).animate === false);
  check("reduced motion: no fade", swipeOpacity(100, 300, true) === 1 && swipeOpacity(100, 300, false) < 1);
}

// Behavioural: drive the real controller with a stub element.
import { createSwipeController } from "../lib/swipeController.ts";
function rig(options = {}) {
  const el = { style: { transform: "", opacity: "", transition: "" }, offsetWidth: 300, offsetHeight: 200, setPointerCapture() { el.captured = true; } };
  let t = 0;
  let dismissed = 0;
  const c = createSwipeController({ getEl: () => el, onDismiss: () => { dismissed += 1; }, options, now: () => t });
  const ev = (id, x, y, extra = {}) => ({ pointerId: id, pointerType: "touch", button: 0, buttons: 1, clientX: x, clientY: y, target: el, currentTarget: el, ...extra });
  return { el, c, ev, tick: (n) => { t += n; }, get dismissed() { return dismissed; } };
}
{
  const r = rig();
  r.c.onPointerDown(r.ev(1, 300, 100)); r.c.onPointerMove(r.ev(1, 260, 100)); r.c.onPointerMove(r.ev(1, 200, 100));
  check("controller: drag sets transform", r.el.style.transform === "translateX(-100px)" && r.el.captured === true);
  r.c.onPointerCancel(r.ev(1, 0, 0));
  check("controller: cancel mid-drag resets transform and opacity", r.el.style.transform === "" && r.el.style.opacity === "");
  r.c.onPointerDown(r.ev(1, 300, 100)); r.c.onPointerMove(r.ev(1, 250, 100)); r.c.onLostPointerCapture(r.ev(1, 250, 100));
  check("controller: lostpointercapture on the card resets", r.el.style.transform === "");
  r.c.onPointerDown(r.ev(1, 300, 100)); r.c.onPointerMove(r.ev(1, 250, 100));
  r.c.onLostPointerCapture(r.ev(1, 250, 100, { target: {} }));
  check("controller: bubbled child lostpointercapture is ignored", r.el.style.transform === "translateX(-50px)");
  r.c.onPointerCancel(r.ev(1, 0, 0));
}
{
  const r = rig();
  r.c.onPointerDown(r.ev(1, 300, 100)); r.c.onPointerMove(r.ev(1, 250, 100));
  r.c.onPointerDown(r.ev(2, 50, 50)); r.c.onPointerMove(r.ev(2, 40, 400)); r.c.onPointerUp(r.ev(2, 40, 400));
  check("controller: second pointer ignored, drag untouched", r.el.style.transform === "translateX(-50px)");
  r.c.onPointerMove(r.ev(1, 200, 100));
  check("controller: first pointer still drags", r.el.style.transform === "translateX(-100px)");
  r.c.onPointerCancel(r.ev(1, 0, 0));
}
{
  const r = rig();
  r.el.style.transform = "translateX(-30px)"; // stray residue, gesture never locked
  r.c.onPointerDown(r.ev(1, 300, 100)); r.c.onPointerUp(r.ev(1, 300, 100));
  check("controller: pointerup with action none resets a present transform", r.el.style.transform === "");
}
{
  const r = rig({ canStart: () => false });
  r.c.onPointerDown(r.ev(1, 300, 100)); r.c.onPointerMove(r.ev(1, 200, 100));
  check("controller: canStart false never starts", r.el.style.transform === "" && !r.el.captured);
  const g = rig({ canStart: (e) => e.clientY < 150 });
  g.c.onPointerDown(g.ev(1, 300, 100)); g.c.onPointerMove(g.ev(1, 200, 100));
  check("controller: canStart true starts", g.el.style.transform === "translateX(-100px)");
}
{
  const r = rig();
  r.c.onPointerDown(r.ev(1, 300, 100, { pointerType: "mouse" })); r.c.onPointerMove(r.ev(1, 250, 100, { pointerType: "mouse" }));
  r.c.onPointerMove(r.ev(1, 200, 100, { pointerType: "mouse", buttons: 0 }));
  check("controller: mouse move with buttons 0 cancels and resets", r.el.style.transform === "");
}
{
  // pointerdown during spring-back snaps to rest and the old timer cannot fire mid-drag.
  const r = rig();
  r.c.onPointerDown(r.ev(1, 300, 100)); r.c.onPointerMove(r.ev(1, 270, 100)); r.tick(2000); r.c.onPointerUp(r.ev(1, 270, 100));
  check("controller: spring-back animates", r.el.style.transform === "translateX(0px)");
  r.c.onPointerDown(r.ev(1, 300, 100));
  check("controller: pointerdown during spring-back snaps to rest", r.el.style.transform === "" && r.el.style.transition === "");
  r.c.onPointerMove(r.ev(1, 250, 100));
  await new Promise((res) => setTimeout(res, 320));
  check("controller: stale spring-back timer does not clobber the next drag", r.el.style.transform === "translateX(-50px)");
  r.c.onPointerCancel(r.ev(1, 0, 0));
  r.c.dispose();
}
{
  const r = rig();
  r.c.onPointerDown(r.ev(1, 300, 100)); r.c.onPointerMove(r.ev(1, 250, 100)); r.tick(100); r.c.onPointerMove(r.ev(1, 50, 100)); r.c.onPointerUp(r.ev(1, 50, 100));
  await new Promise((res) => setTimeout(res, 260));
  check("controller: dismiss fires onDismiss once", r.dismissed === 1);
  r.c.dispose();
}

{
  // Mouse pressed on the card, released off it before the lock: no pointerup arrives.
  const r = rig();
  const m = (id, x, y, extra = {}) => r.ev(id, x, y, { pointerType: "mouse", ...extra });
  r.c.onPointerDown(m(1, 300, 100)); r.c.onPointerMove(m(1, 298, 100));
  r.c.onPointerDown(m(1, 100, 100)); r.c.onPointerMove(m(1, 95, 100));
  check("controller: re-press with same id restarts, no stale offset", r.el.style.transform === "" );
  r.c.onPointerMove(m(1, 60, 100));
  check("controller: drag after restart is measured from the new press", r.el.style.transform === "translateX(-40px)");
  r.c.onPointerCancel(m(1, 0, 0));
}
{
  const r = rig();
  r.c.onPointerDown(r.ev(1, 300, 100)); r.c.onPointerMove(r.ev(1, 250, 100));
  r.c.dispose();
  check("controller: dispose mid-drag resets the element", r.el.style.transform === "" && r.el.style.opacity === "");
  r.c.onPointerMove(r.ev(1, 200, 100));
  check("controller: no drag continues after dispose", r.el.style.transform === "");
}

// Source assertions.
const spot = readFileSync(new URL("../components/HomeInsightSpotlight.tsx", import.meta.url), "utf8");
check("HomeInsightSpotlight sets touch-action pan-y", /touchAction:\s*"pan-y"|touch-pan-y/.test(spot));
check("HomeInsightSpotlight uses shared swipe hook", spot.includes("useSwipeDismiss"));
check("HomeInsightSpotlight has no raw setPointerCapture or style.transform", !/setPointerCapture|style\.transform/.test(spot));
const hook = readFileSync(new URL("../lib/swipeController.ts", import.meta.url), "utf8") + readFileSync(new URL("../lib/useSwipeDismiss.ts", import.meta.url), "utf8");
check("hook handles pointercancel", /onPointerCancel/.test(hook));
check("hook handles lostpointercapture", /onLostPointerCapture/.test(hook));
check("hook ignores bubbled implicit-capture loss (target !== currentTarget)", /e\.target !== e\.currentTarget/.test(hook));
check("hook captures only on confirmed lock", /m\.capture/.test(hook) && !/onPointerDown\([\s\S]{0,600}?setPointerCapture/.test(hook.split("onPointerMove")[0]));
check("hook honours prefers-reduced-motion", /prefers-reduced-motion/.test(hook));
for (const f of ["SwipeToDelete.tsx", "upcoming/SwipeDismissRow.tsx"]) {
  const src = readFileSync(new URL(`../components/${f}`, import.meta.url), "utf8");
  check(`${f} handles touchcancel`, /onTouchCancel=\{onTouchCancel\}/.test(src));
}

if (failures) { console.error(`${failures} check(s) failed`); process.exit(1); }
console.log("swipe-gesture: all checks passed");
