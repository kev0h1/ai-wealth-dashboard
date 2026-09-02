"use client";

// Anchors a costed savings-insight card back to the money shape it would
// move — sits directly under any full tip card with a savings estimate.
// Ported from the approved wireframe's ShapeAnchorStrip
// (app/design/insights-full/sections.tsx / fixtures.ts's moveStripText),
// generalised to take `takeHome` as a prop instead of a fixture constant.

import { MoveRight } from "lucide-react";

function moveStripText(estimateMonthly: number, takeHome: number, job: "fixed" | "free"): string {
  const kind = job === "fixed" ? "fixed share" : "free spending";
  const n = takeHome > 0 ? Math.round((estimateMonthly / takeHome) * 100) : 0;
  if (n < 1) {
    return `less than 1 point of ${kind}, but every pound moves it`;
  }
  return `≈ ${n} point${n === 1 ? "" : "s"} of ${kind} back`;
}

export default function ShapeAnchorStrip({
  estimateMonthly,
  takeHome,
  job,
}: {
  estimateMonthly: number;
  takeHome: number;
  job: "fixed" | "free";
}) {
  return (
    <div className="-mt-1 flex items-center gap-1.5 px-1">
      <MoveRight size={14} className="flex-shrink-0 text-slate-600 dark:text-slate-400" aria-hidden="true" />
      <p className="text-[12px] text-slate-600 dark:text-slate-400">
        {moveStripText(estimateMonthly, takeHome, job)}
        <span className="italic text-slate-600 dark:text-slate-400"> · estimated</span>
      </p>
    </div>
  );
}
