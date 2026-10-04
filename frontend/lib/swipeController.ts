// G207: DOM-facing controller for lib/swipeGesture.ts, kept free of React so
// it can be driven by plain node tests with a stub element. The React hook
// (lib/useSwipeDismiss.ts) is a thin wrapper over this.
//
// Beyond the pure state machine it owns: which pointer is active (other
// pointers are ignored), the spring-back/dismiss timers, mouse buttons===0
// as cancel, the optional canStart gate, and "always leave the element at
// rest unless a dismiss is under way".

import { createSwipeGesture, swipeOpacity, type SwipeOptions } from "./swipeGesture";

export interface SwipeEl {
  style: { transform: string; opacity: string; transition: string };
  offsetWidth: number;
  offsetHeight: number;
  setPointerCapture?(id: number): void;
}

/** The slice of PointerEvent the controller reads. */
export interface SwipePointerEvent {
  pointerId: number;
  pointerType?: string;
  button?: number;
  buttons?: number;
  clientX: number;
  clientY: number;
  target?: EventTarget | null;
  currentTarget: EventTarget | null;
}

export interface SwipeDismissOptions extends SwipeOptions {
  /** Gate a gesture before it starts (e.g. scrollTop === 0, or a handle
   *  target for sheets). Default: always true. */
  canStart?: (e: SwipePointerEvent) => boolean;
}

export interface SwipeControllerDeps {
  getEl: () => SwipeEl | null;
  onDismiss: () => void;
  options?: SwipeDismissOptions;
  reducedMotion?: () => boolean;
  now?: () => number;
}

export function createSwipeController(deps: SwipeControllerDeps) {
  const opts = () => deps.options ?? {};
  const axis = opts().axis ?? "x";
  const sign = opts().sign ?? -1;
  const gesture = createSwipeGesture(opts());
  const now = deps.now ?? (() => Date.now());
  const reduced = () => deps.reducedMotion?.() ?? false;
  let activeId: number | null = null;
  let springTimer: ReturnType<typeof setTimeout> | null = null;
  let dismissTimer: ReturnType<typeof setTimeout> | null = null;
  let dismissing = false;

  const translate = (px: number) => (axis === "x" ? `translateX(${px * sign}px)` : `translateY(${px * sign}px)`);
  const sizeOf = (el: SwipeEl) => (axis === "x" ? el.offsetWidth : el.offsetHeight);

  function reset(el: SwipeEl) {
    el.style.transition = "";
    el.style.transform = "";
    el.style.opacity = "";
  }
  function clearSpring() {
    if (springTimer) { clearTimeout(springTimer); springTimer = null; }
  }
  function abort() {
    activeId = null;
    const wasActive = gesture.cancel();
    const el = deps.getEl();
    if (el && !dismissing && (wasActive || el.style.transform)) reset(el);
  }

  return {
    onPointerDown(e: SwipePointerEvent) {
      if (dismissing || activeId !== null) return; // dismiss under way, or a second finger
      if (e.pointerType === "mouse" && e.button !== 0) return;
      if (deps.options?.canStart && !deps.options.canStart(e)) return;
      const el = deps.getEl();
      if (springTimer) { clearSpring(); if (el) reset(el); } // snap, don't fight the spring-back
      activeId = e.pointerId;
      gesture.start(e.clientX, e.clientY, now());
    },
    onPointerMove(e: SwipePointerEvent) {
      if (e.pointerId !== activeId) return;
      if (e.pointerType === "mouse" && e.buttons === 0) { abort(); return; }
      const el = deps.getEl();
      if (!el) return;
      const m = gesture.move(e.clientX, e.clientY);
      if (m.capture) {
        try { (e.currentTarget as unknown as SwipeEl).setPointerCapture?.(e.pointerId); } catch {}
      }
      if (!m.dragging) return;
      el.style.transition = "";
      el.style.transform = translate(m.offset);
      el.style.opacity = String(swipeOpacity(m.offset, sizeOf(el), reduced()));
    },
    onPointerUp(e: SwipePointerEvent) {
      if (e.pointerId !== activeId) return;
      activeId = null;
      const el = deps.getEl();
      const size = el ? sizeOf(el) : 0;
      const end = gesture.end(e.clientX, e.clientY, now(), size);
      if (!el) return;
      const animate = !reduced();
      if (end.action === "none") {
        if (el.style.transform) reset(el);
      } else if (end.action === "dismiss") {
        dismissing = true;
        el.style.transition = animate ? "transform 0.2s var(--ease-out), opacity 0.15s ease" : "none";
        el.style.transform = translate(size + 20);
        el.style.opacity = "0";
        dismissTimer = setTimeout(() => { dismissing = false; deps.onDismiss(); }, animate ? 200 : 0);
      } else if (animate) {
        el.style.transition = "transform 0.25s var(--ease-out), opacity 0.2s ease";
        el.style.transform = translate(0);
        el.style.opacity = "1";
        clearSpring();
        springTimer = setTimeout(() => { springTimer = null; const cur = deps.getEl(); if (cur) reset(cur); }, 250);
      } else {
        reset(el);
      }
    },
    onPointerCancel(e: SwipePointerEvent) {
      if (e.pointerId !== activeId) return;
      abort();
    },
    onLostPointerCapture(e: SwipePointerEvent) {
      // Touch pointers are implicitly captured by the element under the
      // finger; our own setPointerCapture on the card releases that one,
      // and its lostpointercapture bubbles up here. Only a loss on the card
      // itself means the drag is over.
      if (e.target !== e.currentTarget) return;
      if (e.pointerId !== activeId) return;
      abort();
    },
    dispose() {
      clearSpring();
      if (dismissTimer) { clearTimeout(dismissTimer); dismissTimer = null; }
    },
  };
}
