"use client";

// SwipeToDelete — generalised swipe-left-to-delete shell.
// Touch-only by nature; on desktop the gesture is inert.
// The visible fallback (a "Remove" button inside the expanded content)
// covers keyboard and pointer users — per impeccable's
// "gestures need a visible fallback" rule.
//
// Mirrors the SpendPage SwipeDismissRow pattern exactly:
//   axis-lock  → Math.abs(mx) > Math.abs(my) * 1.5
//   threshold  → 40 % of shell width, or a flick (< 250 ms && dx < -60)
//   animation  → translate on the inner div; 180 ms ease-out on release

import { useState, useRef } from "react";
import { Trash2 } from "lucide-react";

interface Props {
  onDelete: () => void;
  label?: string;         // backdrop text, default "Delete"
  className?: string;     // forwarded to the outer shell (rounding, etc.)
  children: React.ReactNode;
}

export default function SwipeToDelete({ onDelete, label = "Delete", className = "", children }: Props) {
  const [dx, setDx] = useState(0);
  const [dragging, setDragging] = useState(false);
  const start = useRef<{ x: number; y: number; t: number } | null>(null);
  const axis = useRef<"none" | "h" | "v">("none");
  const shellRef = useRef<HTMLDivElement>(null);

  function onTouchStart(e: React.TouchEvent) {
    start.current = { x: e.touches[0].clientX, y: e.touches[0].clientY, t: Date.now() };
    axis.current = "none";
  }

  function onTouchMove(e: React.TouchEvent) {
    if (!start.current) return;
    const mx = e.touches[0].clientX - start.current.x;
    const my = e.touches[0].clientY - start.current.y;
    if (axis.current === "none") {
      if (Math.abs(mx) < 8 && Math.abs(my) < 8) return;
      axis.current = Math.abs(mx) > Math.abs(my) * 1.5 ? "h" : "v";
      if (axis.current === "h") setDragging(true);
    }
    if (axis.current !== "h") return;
    setDx(Math.min(0, mx)); // left only
  }

  function onTouchEnd() {
    if (!start.current) { setDragging(false); return; }
    const width = shellRef.current?.offsetWidth ?? 320;
    const elapsed = Date.now() - start.current.t;
    const flick = elapsed < 250 && dx < -60;
    start.current = null;
    setDragging(false);
    if (dx < -width * 0.4 || flick) {
      setDx(-width - 24);
      setTimeout(onDelete, 180);
    } else {
      setDx(0);
    }
    axis.current = "none";
  }

  // Opacity ramps from 0 → 1 over the first 80 px of swipe distance,
  // mirroring the SpendPage SwipeDismissRow opacity curve.
  const backdropOpacity = Math.min(1, Math.abs(dx) / 80);

  return (
    <div ref={shellRef} className={`relative overflow-hidden ${className}`}>
      {/* Rose backdrop, revealed as the user swipes left */}
      <div
        className="absolute inset-0 bg-rose-500 flex items-center justify-end gap-1.5 pr-5"
        style={{ opacity: backdropOpacity }}
        aria-hidden="true"
      >
        <Trash2 size={14} className="text-white" />
        <span className="text-xs font-semibold text-white">{label}</span>
      </div>

      {/* Content layer — translates with the finger */}
      <div
        style={{
          transform: `translateX(${dx}px)`,
          transition: dragging ? "none" : "transform 180ms ease-out",
        }}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
      >
        {children}
      </div>
    </div>
  );
}
