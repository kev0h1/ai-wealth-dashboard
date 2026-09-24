"use client";

// The one divider style on /upcoming's ledger (`app/planning/
// PlanningPage.tsx`) — the payday boundary established it, the cluster
// interval marker (see `lib/upcomingMarkers.ts`) reuses it verbatim, only
// the label changes. Shared with the design preview
// (`app/design/g124-upcoming-refine/`) so the two can't drift.
//
// G127 round-three fix (rejected round, Kevin): at a seam where a marker
// and the payday boundary used to be CONCATENATED into one label ("5
// payments in 3 days · Next pay period, from Fri 25 Sep"), the merged
// string was too long for a 390px screen — the label wrapped to two lines
// and, because both hairlines are `flex-1` with a zero flex-basis, a flex
// row with negative free space allocates that overflow entirely onto the
// only sibling with a non-zero basis (the label): the hairlines collapsed
// to ~0px and the divider read as stray left-aligned text.
//
// Chosen fix — "the payday boundary owns the divider": the visible
// hairline/label row ALWAYS carries only the `label` prop, which for the
// payday case is short and fixed-shape ("Next pay period · from <date>")
// and therefore reliably fits one line at any width this app supports. When
// a marker lands on the same seam, its own label is passed as `sublabel`
// instead, rendering as a quiet caption underneath rather than squeezed
// into the same flex row. The combined meaning stays available to
// assistive tech via `ariaLabel`, which the caller can set to concatenate
// both facts in whatever phrasing reads best (see PlanningPage.tsx's own
// payday-boundary aria copy, which differs slightly from its visible text).
export default function UpcomingDivider({
  label,
  sublabel,
  ariaLabel,
}: {
  label: string;
  sublabel?: string;
  ariaLabel?: string;
}) {
  return (
    <div className="py-1.5">
      <div
        role="separator"
        aria-label={ariaLabel ?? (sublabel ? `${sublabel} · ${label}` : label)}
        className="flex items-center gap-3"
      >
        <div className="h-px flex-1 bg-slate-100 dark:bg-slate-700" />
        <span className="shrink-0 text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
          {label}
        </span>
        <div className="h-px flex-1 bg-slate-100 dark:bg-slate-700" />
      </div>
      {sublabel && (
        <p className="mt-1 text-center text-xs font-medium text-slate-400 dark:text-slate-500">{sublabel}</p>
      )}
    </div>
  );
}
