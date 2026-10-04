"use client";

// G207: React binding for lib/swipeGesture.ts. Returns pointer handlers to
// spread on the swipeable element and mutates that element's style through a
// ref (no re-render per move). Used by HomeInsightSpotlight; G205 passes
// axis: "y", sign: 1 for swipe-down on sheets.

import { useEffect, useMemo, useRef } from "react";
import type React from "react";
import { createSwipeGesture, swipeOpacity, type SwipeOptions } from "@/lib/swipeGesture";

export function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function"
    ? window.matchMedia("(prefers-reduced-motion: reduce)").matches
    : false;
}

/** G205 extensions, all optional so G207's tip card is unchanged. */
export interface SwipeDismissExtras {
  /** Gate evaluated on pointerdown; false means this touch never starts a gesture. */
  canStart?: (e: React.PointerEvent<HTMLElement>) => boolean;
  /** False turns the whole gesture off (e.g. dismissDisabled, desktop). */
  enabled?: boolean;
  /** Fade the element itself while dragging. Sheets keep a solid panel (default true). */
  fade?: boolean;
  /** An element (the sheet backdrop) whose opacity follows drag progress. */
  companionRef?: React.RefObject<HTMLElement | null>;
  /** After onDismiss, if the element is still mounted (a confirm held the
   *  close), restore it after this many ms. 0 disables. */
  restoreAfterMs?: number;
}

export function useSwipeDismiss<T extends HTMLElement>(onDismiss: () => void, options: SwipeOptions & SwipeDismissExtras = {}) {
  const { canStart, enabled = true, fade = true, companionRef, restoreAfterMs = 0 } = options;
  const ref = useRef<T>(null);
  const last = useRef({ y: 0, t: 0, v: 0 });
  const onDismissRef = useRef(onDismiss);
  useEffect(() => { onDismissRef.current = onDismiss; });
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const axis = options.axis ?? "x";
  const sign = options.sign ?? -1;
  const lockPx = options.lockPx;
  const dismissFraction = options.dismissFraction;
  const flickVelocity = options.flickVelocity;
  const gesture = useMemo(
    () => createSwipeGesture({ axis, sign, lockPx, dismissFraction, flickVelocity }),
    [axis, sign, lockPx, dismissFraction, flickVelocity],
  );

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const translate = (px: number) => (axis === "x" ? `translateX(${px * sign}px)` : `translateY(${px * sign}px)`);
  const sizeOf = (el: HTMLElement) => (axis === "x" ? el.offsetWidth : el.offsetHeight);

  function reset(el: HTMLElement) {
    el.style.transition = "";
    el.style.transform = "";
    el.style.opacity = "";
    if (companionRef?.current) {
      companionRef.current.style.transition = "";
      companionRef.current.style.opacity = "";
    }
  }

  function companion(offset: number, size: number, transition: string, to?: string) {
    const c = companionRef?.current;
    if (!c) return;
    c.style.transition = transition;
    c.style.opacity = to ?? String(Math.max(0, 1 - offset / (size * 0.6)));
  }

  const handlers = {
    onPointerDown(e: React.PointerEvent<T>) {
      // Mouse users get the visible dismiss button, not a drag.
      if (e.pointerType === "mouse" && e.button !== 0) return;
      if (!enabled || (canStart && !canStart(e))) return;
      last.current = { y: e.clientY, t: Date.now(), v: 0 };
      gesture.start(e.clientX, e.clientY, Date.now());
    },
    onPointerMove(e: React.PointerEvent<T>) {
      const el = ref.current;
      if (!el) return;
      const m = gesture.move(e.clientX, e.clientY);
      if (m.capture) {
        try { e.currentTarget.setPointerCapture(e.pointerId); } catch {}
      }
      if (!m.dragging) return;
      const reduced = prefersReducedMotion();
      const now = Date.now();
      if (now > last.current.t) last.current = { y: e.clientY, t: now, v: (e.clientY - last.current.y) / (now - last.current.t) };
      el.style.transition = "";
      el.style.transform = translate(m.offset);
      if (fade) el.style.opacity = String(swipeOpacity(m.offset, sizeOf(el), reduced));
      if (!reduced) companion(m.offset, sizeOf(el), "");
    },
    onPointerUp(e: React.PointerEvent<T>) {
      const el = ref.current;
      const reduced = prefersReducedMotion();
      const size = el ? sizeOf(el) : 0;
      const end = gesture.end(e.clientX, e.clientY, Date.now(), size);
      if (!el) return;
      if (end.action === "none") return;
      const animate = !reduced;
      if (end.action === "dismiss") {
        // Continue the finger's velocity: time the remaining travel at the
        // release speed, clamped so a slow drag still settles briskly.
        const travel = Math.max(0, size + 20 - Math.abs(gesture.lastOffset));
        const v = Math.abs(last.current.v);
        const ms = animate ? Math.round(v > 0.05 ? Math.min(260, Math.max(120, travel / v)) : 200) : 0;
        el.style.transition = animate ? `transform ${ms}ms var(--ease-out), opacity 0.15s ease` : "none";
        el.style.transform = translate(size + 20);
        if (fade) el.style.opacity = "0";
        companion(0, size, animate ? `opacity ${ms}ms ease` : "none", "0");
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => {
          onDismissRef.current();
          if (restoreAfterMs > 0) {
            timer.current = setTimeout(() => { if (ref.current) reset(ref.current); }, restoreAfterMs);
          }
        }, ms);
      } else {
        el.style.transition = animate ? "transform 0.25s var(--ease-out), opacity 0.2s ease" : "none";
        el.style.transform = translate(0);
        if (fade) el.style.opacity = "1";
        companion(0, size, animate ? "opacity 0.25s ease" : "none", "1");
        if (animate) {
          if (timer.current) clearTimeout(timer.current);
          timer.current = setTimeout(() => { if (ref.current) reset(ref.current); }, 250);
        } else {
          reset(el);
        }
      }
    },
    onPointerCancel() {
      if (gesture.cancel() && ref.current) reset(ref.current);
    },
    onLostPointerCapture(e: React.PointerEvent<T>) {
      // Touch pointers are implicitly captured by the element under the
      // finger; our own setPointerCapture on the card releases that one,
      // and its lostpointercapture bubbles up here. Only a loss on the card
      // itself (or the pointer ending) means the drag is over.
      if (e.target !== e.currentTarget) return;
      if (gesture.cancel() && ref.current) reset(ref.current);
    },
  };

  /** True while a locked drag is in progress (callers cancel the native pan). */
  const gestureActive = () => gesture.phase === "dragging";

  return { ref, handlers, gestureActive };
}
