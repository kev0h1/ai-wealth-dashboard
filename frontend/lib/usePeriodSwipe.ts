"use client";
import { useRef } from "react";

// Swipe the pay-period selector CARD left/right to change period. Deliberately
// scoped to the card (not the whole page) so it never collides with list-row
// swipe-to-delete / swipe-to-dismiss. Convention: swipe right = previous period
// (back in time), swipe left = next period.
export function usePeriodSwipe(opts: {
  onPrev: () => void;
  onNext: () => void;
  canPrev?: boolean;   // default true
  canNext?: boolean;   // default true
}) {
  const start = useRef<{ x: number; y: number } | null>(null);
  return {
    onTouchStart: (e: React.TouchEvent) => {
      start.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
    },
    onTouchEnd: (e: React.TouchEvent) => {
      if (!start.current) return;
      const dx = e.changedTouches[0].clientX - start.current.x;
      const dy = e.changedTouches[0].clientY - start.current.y;
      start.current = null;
      // clearly horizontal, at least 50px (same threshold as row swipes)
      if (Math.abs(dx) < 50 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
      if (dx > 0) { if (opts.canPrev !== false) opts.onPrev(); }
      else { if (opts.canNext !== false) opts.onNext(); }
    },
  };
}
