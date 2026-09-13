"use client";

import type { ReactNode } from "react";

export type SpendJourneyDestination = {
  id: string;
  label: string;
  value: ReactNode;
  needsLook?: boolean;
  onBeforeJump?: () => void;
};

function jumpTo(destination: SpendJourneyDestination) {
  destination.onBeforeJump?.();
  const section = document.getElementById(destination.id);
  if (!section) return;

  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  section.focus({ preventScroll: true });
  section.scrollIntoView({ behavior: reducedMotion ? "auto" : "smooth", block: "start" });
}

/**
 * The compact route map for the Spend journey. Destinations are supplied by
 * the caller so a completed step, notably "Place", can leave the strip
 * entirely instead of lingering as dead navigation.
 */
export default function SpendJourneyNav({
  destinations,
  desktop = false,
}: {
  destinations: SpendJourneyDestination[];
  desktop?: boolean;
}) {
  return (
    <nav
      aria-label="Jump through this pay period"
      className={`grid gap-2 ${desktop ? "grid-cols-2" : destinations.length >= 4 ? "grid-cols-4" : destinations.length === 3 ? "grid-cols-3" : "grid-cols-2"}`}
    >
      {destinations.map((destination) => (
        <button
          key={destination.id}
          type="button"
          onClick={() => jumpTo(destination)}
          className="flex min-h-12 min-w-0 flex-col items-start justify-center rounded-xl border border-slate-200 bg-white px-2 py-2 text-left shadow-sm transition-[background-color,border-color,transform] hover:border-slate-300 hover:bg-slate-50 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 motion-reduce:transition-none dark:border-slate-700 dark:bg-slate-800 dark:shadow-none dark:hover:border-slate-600 dark:hover:bg-slate-700 dark:focus-visible:ring-offset-slate-900 sm:px-3"
        >
          <span className="flex max-w-full items-center gap-1.5 truncate text-[10px] font-semibold uppercase tracking-[0.05em] text-slate-600 dark:text-slate-400">
            {destination.label}
            {destination.needsLook && (
              <>
                <span aria-hidden="true" className="size-1.5 shrink-0 rounded-full bg-amber-400" />
                <span className="sr-only">Needs a look</span>
              </>
            )}
          </span>
          <span className="mt-0.5 max-w-full truncate text-[12px] font-bold text-slate-900 dark:text-white">
            {destination.value}
          </span>
        </button>
      ))}
    </nav>
  );
}
