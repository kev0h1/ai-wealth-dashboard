"use client";

import { useEffect, useRef, useState } from "react";

// Ease-out matches the app's --ease-out cubic-bezier feel closely enough for
// a numeric tween (a real cubic-bezier solve isn't worth it for ~600ms of
// digits). Dependency-free, SSR-safe, and respects reduced-motion.
function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

/**
 * Animates a number from its previous value to `target` on mount and
 * whenever `target` changes, using requestAnimationFrame. Returns the
 * currently-animated value (format it yourself at the call site).
 */
export function useCountUp(target: number, opts?: { durationMs?: number }): number {
  const duration = opts?.durationMs ?? 600;
  const [value, setValue] = useState(target);
  const fromRef = useRef(target);
  const rafRef = useRef<number | null>(null);
  const firstRunRef = useRef(true);

  useEffect(() => {
    if (typeof window === "undefined") {
      setValue(target);
      return;
    }
    if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setValue(target);
      fromRef.current = target;
      return;
    }
    // Skip animating on the very first mount — start settled at target,
    // only tween on subsequent changes.
    if (firstRunRef.current) {
      firstRunRef.current = false;
      fromRef.current = target;
      setValue(target);
      return;
    }

    const from = fromRef.current;
    const to = target;
    if (from === to) return;

    const start = performance.now();
    if (rafRef.current != null) cancelAnimationFrame(rafRef.current);

    function tick(now: number) {
      const elapsed = now - start;
      const t = Math.min(1, elapsed / duration);
      const eased = easeOutCubic(t);
      setValue(from + (to - from) * eased);
      if (t < 1) {
        rafRef.current = requestAnimationFrame(tick);
      } else {
        fromRef.current = to;
        rafRef.current = null;
      }
    }
    rafRef.current = requestAnimationFrame(tick);

    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target, duration]);

  return value;
}
