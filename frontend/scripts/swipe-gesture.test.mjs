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

// Source assertions.
const spot = readFileSync(new URL("../components/HomeInsightSpotlight.tsx", import.meta.url), "utf8");
check("HomeInsightSpotlight sets touch-action pan-y", /touchAction:\s*"pan-y"|touch-pan-y/.test(spot));
check("HomeInsightSpotlight uses shared swipe hook", spot.includes("useSwipeDismiss"));
check("HomeInsightSpotlight has no raw setPointerCapture or style.transform", !/setPointerCapture|style\.transform/.test(spot));
const hook = readFileSync(new URL("../lib/useSwipeDismiss.ts", import.meta.url), "utf8");
check("hook handles pointercancel", /onPointerCancel/.test(hook));
check("hook handles lostpointercapture", /onLostPointerCapture/.test(hook));
check("hook ignores bubbled implicit-capture loss (target !== currentTarget)", /e\.target !== e\.currentTarget/.test(hook));
check("hook captures only on confirmed lock", /m\.capture/.test(hook) && !/onPointerDown[\s\S]{0,300}setPointerCapture/.test(hook));
check("hook honours prefers-reduced-motion", /prefers-reduced-motion/.test(hook));
for (const f of ["SwipeToDelete.tsx", "upcoming/SwipeDismissRow.tsx"]) {
  const src = readFileSync(new URL(`../components/${f}`, import.meta.url), "utf8");
  check(`${f} handles touchcancel`, /onTouchCancel=\{onTouchCancel\}/.test(src));
}

if (failures) { console.error(`${failures} check(s) failed`); process.exit(1); }
console.log("swipe-gesture: all checks passed");
