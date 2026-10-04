// G207: framework-free swipe-to-dismiss state machine. Pure (no DOM, no
// React), so it can be tested under plain node and reused by G205's
// swipe-down on sheets: the direction is a parameter, not a copy.
//
// Rules it enforces:
//   - nothing moves until an axis lock: travel on the dismiss axis must
//     exceed `lockPx` AND exceed the cross-axis travel. If the cross axis
//     wins first (a page scroll starting on the card) the gesture is
//     "ignored" for the rest of its life and can never produce an offset.
//   - a lock that begins away from the dismiss direction is also ignored.
//   - `capture` is true exactly once, on the move that confirms intent, so
//     the caller captures the pointer only then.
//   - cancel() (pointercancel / lostpointercapture / touchcancel) always
//     returns the caller to rest; it is a no-op once a gesture has ended,
//     so the lostpointercapture that follows a normal pointerup cannot
//     undo a dismiss animation.

export type SwipeAxis = "x" | "y";
export type SwipeSign = -1 | 1;

export interface SwipeOptions {
  /** Dismiss axis: "x" for swipe left/right, "y" for swipe up/down (G205). */
  axis?: SwipeAxis;
  /** Dismiss direction along the axis: -1 = left/up, 1 = right/down. */
  sign?: SwipeSign;
  /** Travel on the dismiss axis before the lock is decided (px). */
  lockPx?: number;
  /** Fraction of the element's size past which release dismisses. */
  dismissFraction?: number;
  /** Release speed (px/ms) past which release dismisses. */
  flickVelocity?: number;
  /** prefers-reduced-motion: no fade, no animated settle. */
  reducedMotion?: boolean;
}

export type SwipePhase = "idle" | "pending" | "dragging" | "ignored";

export interface SwipeMove {
  /** Distance to translate along the axis, in px. Always >= 0 toward the
   *  dismiss direction (the caller multiplies by `sign`). 0 when not locked. */
  offset: number;
  /** True only on the single move that confirms horizontal/vertical intent. */
  capture: boolean;
  /** True while a locked drag is in progress. */
  dragging: boolean;
}

export type SwipeEndAction = "dismiss" | "spring-back" | "none";

export interface SwipeEnd {
  action: SwipeEndAction;
  /** False under reduced motion: apply the end state without transitions. */
  animate: boolean;
}

export const SWIPE_DEFAULTS = {
  axis: "x" as SwipeAxis,
  sign: -1 as SwipeSign,
  lockPx: 8,
  dismissFraction: 0.35,
  flickVelocity: 0.5,
};

export function createSwipeGesture(options: SwipeOptions = {}) {
  // Explicit `undefined` values (a hook forwarding optional props) must not
  // clobber the defaults, so drop them before merging.
  const defined = Object.fromEntries(Object.entries(options).filter(([, v]) => v !== undefined)) as SwipeOptions;
  const o = { ...SWIPE_DEFAULTS, reducedMotion: false, ...defined };
  let phase: SwipePhase = "idle";
  let x0 = 0;
  let y0 = 0;
  let t0 = 0;
  let offset = 0;

  function toAxes(x: number, y: number) {
    const dx = x - x0;
    const dy = y - y0;
    const main = (o.axis === "x" ? dx : dy) * o.sign; // + toward dismissal
    const cross = o.axis === "x" ? dy : dx;
    return { main, cross };
  }

  return {
    get phase() {
      return phase;
    },
    get offset() {
      return offset;
    },
    start(x: number, y: number, t: number) {
      x0 = x;
      y0 = y;
      t0 = t;
      offset = 0;
      phase = "pending";
    },
    move(x: number, y: number): SwipeMove {
      const rest: SwipeMove = { offset: 0, capture: false, dragging: false };
      if (phase === "idle" || phase === "ignored") return rest;
      const { main, cross } = toAxes(x, y);
      if (phase === "pending") {
        const aMain = Math.abs(main);
        const aCross = Math.abs(cross);
        if (aMain <= o.lockPx && aCross <= o.lockPx) return rest;
        // Lock only when the dismiss axis clearly wins and heads the
        // dismiss way; anything else is a scroll or a wrong-way drag.
        if (aMain > o.lockPx && aMain > aCross && main > 0) {
          phase = "dragging";
          offset = Math.max(0, main);
          return { offset, capture: true, dragging: true };
        }
        phase = "ignored";
        return rest;
      }
      offset = Math.max(0, main);
      return { offset, capture: false, dragging: true };
    },
    end(x: number, y: number, t: number, size: number): SwipeEnd {
      const animate = !o.reducedMotion;
      if (phase !== "dragging") {
        phase = "idle";
        offset = 0;
        return { action: "none", animate };
      }
      const { main } = toAxes(x, y);
      const elapsed = t - t0;
      const velocity = elapsed > 0 ? Math.abs(main) / elapsed : 0;
      phase = "idle";
      offset = 0;
      const dismiss = main > 0 && (main > size * o.dismissFraction || velocity > o.flickVelocity);
      return { action: dismiss ? "dismiss" : "spring-back", animate };
    },
    /** pointercancel, lostpointercapture, touchcancel. Returns true when the
     *  caller must reset its transform/opacity/dragging state. */
    cancel(): boolean {
      const wasActive = phase !== "idle";
      phase = "idle";
      offset = 0;
      return wasActive;
    },
  };
}

export type SwipeGesture = ReturnType<typeof createSwipeGesture>;

/** Opacity for a drag of `offset` px on an element `size` px along the axis. */
export function swipeOpacity(offset: number, size: number, reducedMotion = false): number {
  if (reducedMotion || size <= 0) return 1;
  return Math.max(0, 1 - offset / (size * 0.55));
}
