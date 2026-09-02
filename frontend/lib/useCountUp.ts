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
 *
 * `startFromZero` (default false) opts a caller into tweening on the VERY
 * first mount too, counting up from 0 → target instead of settling
 * instantly. Off by default so existing callers (SafeToSpendCard's tiles,
 * which must not animate on page load) are unaffected — Month Story's
 * per-slide hero figures turn it on, since each slide is a fresh mount
 * (keyed by slide index) and the whole point is a restart-on-mount tween.
 */
export function useCountUp(target: number, opts?: { durationMs?: number; startFromZero?: boolean }): number {
  const duration = opts?.durationMs ?? 600;
  const startFromZero = opts?.startFromZero ?? false;
  const [value, setValue] = useState(startFromZero ? 0 : target);
  const fromRef = useRef(startFromZero ? 0 : target);
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
    // only tween on subsequent changes. Unless `startFromZero`: the caller
    // wants the first mount itself to tween (0 → target), so fall through
    // to the shared tick loop below instead of short-circuiting here.
    if (firstRunRef.current) {
      firstRunRef.current = false;
      if (!startFromZero) {
        fromRef.current = target;
        setValue(target);
        return;
      }
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
