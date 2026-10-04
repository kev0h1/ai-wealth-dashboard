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

export function useSwipeDismiss<T extends HTMLElement>(onDismiss: () => void, options: SwipeOptions = {}) {
  const ref = useRef<T>(null);
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
  }

  const handlers = {
    onPointerDown(e: React.PointerEvent<T>) {
      // Mouse users get the visible dismiss button, not a drag.
      if (e.pointerType === "mouse" && e.button !== 0) return;
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
      el.style.transition = "";
      el.style.transform = translate(m.offset);
      el.style.opacity = String(swipeOpacity(m.offset, sizeOf(el), reduced));
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
        el.style.transition = animate ? "transform 0.2s var(--ease-out), opacity 0.15s ease" : "none";
        el.style.transform = translate(size + 20);
        el.style.opacity = "0";
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => onDismissRef.current(), animate ? 200 : 0);
      } else {
        el.style.transition = animate ? "transform 0.25s var(--ease-out), opacity 0.2s ease" : "none";
        el.style.transform = translate(0);
        el.style.opacity = "1";
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

  return { ref, handlers };
}
