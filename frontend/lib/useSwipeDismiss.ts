"use client";

// G207: React binding for lib/swipeController.ts. Returns pointer handlers to
// spread on the swipeable element and mutates that element's style through a
// ref (no re-render per move). Used by HomeInsightSpotlight; G205 passes
// axis: "y", sign: 1 for swipe-down on sheets, optionally with `canStart`
// (e.g. scrollTop === 0 or a handle target).

import { useEffect, useMemo, useRef } from "react";
import type React from "react";
import { createSwipeController, type SwipeDismissOptions, type SwipeEl } from "@/lib/swipeController";

export type { SwipeDismissOptions };

export function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function"
    ? window.matchMedia("(prefers-reduced-motion: reduce)").matches
    : false;
}

export function useSwipeDismiss<T extends HTMLElement>(onDismiss: () => void, options: SwipeDismissOptions = {}) {
  const ref = useRef<T>(null);
  const onDismissRef = useRef(onDismiss);
  const canStartRef = useRef(options.canStart);
  useEffect(() => { onDismissRef.current = onDismiss; canStartRef.current = options.canStart; });
  const { axis, sign, lockPx, dismissFraction, flickVelocity } = options;

  const controller = useMemo(
    () =>
      createSwipeController({
        getEl: () => ref.current as unknown as SwipeEl | null,
        onDismiss: () => onDismissRef.current(),
        options: {
          axis, sign, lockPx, dismissFraction, flickVelocity,
          canStart: (e) => (canStartRef.current ? canStartRef.current(e) : true),
        },
        reducedMotion: prefersReducedMotion,
      }),
    [axis, sign, lockPx, dismissFraction, flickVelocity],
  );
  useEffect(() => () => controller.dispose(), [controller]);

  const handlers = {
    onPointerDown: (e: React.PointerEvent<T>) => controller.onPointerDown(e),
    onPointerMove: (e: React.PointerEvent<T>) => controller.onPointerMove(e),
    onPointerUp: (e: React.PointerEvent<T>) => controller.onPointerUp(e),
    onPointerCancel: (e: React.PointerEvent<T>) => controller.onPointerCancel(e),
    onLostPointerCapture: (e: React.PointerEvent<T>) => controller.onLostPointerCapture(e),
  };

  return { ref, handlers };
}
