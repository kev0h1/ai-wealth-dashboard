/**
 * The single definition of the "cluster" interval-marker rule for /upcoming
 * (`app/planning/PlanningPage.tsx`'s day-group ledger). Pulled out of the
 * page so its own design preview (`app/design/g124-upcoming-refine/`) can
 * import the exact same function rather than a hand-rolled duplicate that
 * could drift, the same pattern as `lib/cashWalk.ts`.
 *
 * Source: the g124-upcoming-refine design round (G127, Kevin, 2026-09-18,
 * round three: "instead of like 10 days time should we have the date and
 * then perhaps at certain intervals on the canvas we can say 10 days,
 * ideally when you have a clutter of payments"). Three candidate rules were
 * built and compared on that preview ("gap", "rhythm", "cluster"); Kevin
 * picked "cluster" as the answer closest to his own "clutter of payments"
 * framing. The other two rules and the switcher that compared them are
 * deliberately NOT ported here or shipped anywhere — this is the only rule
 * that exists in production.
 */

export interface UpcomingDayGroupMeta {
  /** Days from today (0 = today), used to measure how tightly grouped a run is. */
  dayOffset: number;
  /** The group's own day key (its ISO expected_date), identifies where a marker sits. */
  dayKeyIso: string;
  /** Count of every row (active + settling) in this day's group, for the marker's own label. */
  itemCount: number;
}

export interface UpcomingMarker {
  /** The day-group a marker introduces, i.e. it renders directly before this group. */
  beforeDayKeyIso: string;
  label: string;
}

const RUN_MIN_GROUPS = 3;
const TIGHT_GAP_DAYS = 2;

// A run of 3 or more day-groups each within 2 days of the last counts as a
// clutter; the marker introduces the run, at its first day. A run starting
// at the very first group is skipped — nothing precedes "Today" for a
// marker to sit in front of. `groups` must already be sorted ascending by
// `dayOffset`.
export function computeClusterMarkers(groups: UpcomingDayGroupMeta[]): UpcomingMarker[] {
  const markers: UpcomingMarker[] = [];
  let i = 0;
  while (i < groups.length) {
    let j = i;
    while (j + 1 < groups.length && groups[j + 1].dayOffset - groups[j].dayOffset <= TIGHT_GAP_DAYS) j++;
    const runLength = j - i + 1;
    if (runLength >= RUN_MIN_GROUPS && i > 0) {
      const span = groups[j].dayOffset - groups[i].dayOffset;
      const paymentCount = groups.slice(i, j + 1).reduce((n, g) => n + g.itemCount, 0);
      markers.push({
        beforeDayKeyIso: groups[i].dayKeyIso,
        label: `${paymentCount} payments in ${span} ${span === 1 ? "day" : "days"}`,
      });
    }
    i = j + 1;
  }
  return markers;
}
