"use client";

import { useState, useRef } from "react";
import { X } from "lucide-react";

// G131 (g124-upcoming-refine fold-in) — this row is now folded into one
// bounded UpcomingDayCard per day (rounded-2xl border, overflow-hidden,
// hairline divide-y rows) instead of rendering as its own floating card.
// Giving this shell its own rounded-2xl corners, as it did before, would
// show rounded corners peeking out of the middle of a straight-edged
// bounded card wherever a mid-list row gets swiped — the exact clash this
// fold-in's own brief flagged. Fix: this shell (and the reveal panel
// behind it) render with SQUARE corners now, full stop, no per-row
// position tracking needed — the day-card's own `overflow-hidden
// rounded-2xl` on its outer `<section>` clips the first row's top corners
// and the last row's bottom corners into its curve automatically, exactly
// as it already does for the card's own background and border. Every
// interior seam is already square, matching the divide-y hairlines either
// side of it.
//
// G133 (regression fix) — extracted out of PlanningPage.tsx into its own
// file so the g124-upcoming-refine design preview (DayGroups.tsx) can
// import and wrap its fixture Row in the SAME component PlanningPage.tsx
// renders, instead of not demonstrating swipe at all. Unlike renderRow
// (PlanningPage.tsx), which is a page-scoped closure over live risk-walk
// state, edit sheets and dismiss handlers and stays genuinely out of
// scope to extract, this component was always a self-contained, stateless
// (props-only) wrapper with no coupling to page state — nothing about the
// extraction changes its behaviour. Doing this closes the gap that let
// G133 itself through: the day card paints its surface on the CARD
// (`bg-white dark:bg-slate-800`, UpcomingDayCard.tsx), not on each row, so
// the sliding content layer needs that same opaque background to occlude
// the red reveal panel underneath as it translates. Because the preview
// previously hand-authored its Row without this wrapper, it never
// exercised the reveal at all, and a mid-swipe screenshot of the preview
// could not have caught the transparent-layer regression that shipped to
// production.
export default function SwipeDismissRow({ onDismiss, children, label = "Not recurring" }: { onDismiss: () => void; children: React.ReactNode; label?: string }) {
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
    setDx(Math.min(0, mx));
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
      setTimeout(onDismiss, 180);
    } else {
      setDx(0);
    }
    axis.current = "none";
  }

  return (
    <div ref={shellRef} className="relative overflow-hidden">
      <div
        className="absolute inset-0 bg-rose-500 flex items-center justify-end gap-1.5 pr-4"
        style={{ opacity: Math.min(1, Math.abs(dx) / 80) }}
      >
        <X size={14} className="text-white" />
        <span className="text-xs font-semibold text-white">{label}</span>
      </div>
      <div
        // G133 fix: this layer has no rounding of its own (square corners
        // are deliberate, see the fold-in note above), but it slides over
        // the red reveal panel and must occlude it while doing so. It
        // used to rely on the row's own `rounded-2xl glass-card` for that
        // opacity; G131 removed that surface so rows would sit flush
        // inside the bounded UpcomingDayCard, which left this layer fully
        // transparent and let the reveal show through the row's text
        // mid-swipe. Match the day card's own surface
        // (`bg-white dark:bg-slate-800`, UpcomingDayCard.tsx) instead.
        className="bg-white dark:bg-slate-800"
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
