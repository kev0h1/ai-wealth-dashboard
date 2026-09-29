// Cover plan due-date copy (G184). `needs_by` is the earliest bill's date, so
// several payments must never read as "due by" it unless they share that day.

export type DueRange = {
  needs_by?: string | null;
  needs_by_last?: string | null;
  needs_by_date?: string | null;
  needs_by_last_date?: string | null;
};

/** True when the bills span more than one day (needs both labels to say so). */
export function hasDueRange(d: DueRange, count: number): boolean {
  if (count < 2 || !d.needs_by || !d.needs_by_last) return false;
  if (d.needs_by_date && d.needs_by_last_date) return d.needs_by_date !== d.needs_by_last_date;
  return d.needs_by !== d.needs_by_last;
}

/** Right-hand summary line on the move card. */
export function coverPlanSummary(d: DueRange, count: number): string {
  if (count === 1) return `Payment due ${d.needs_by}`;
  if (hasDueRange(d, count)) return `${count} payments, first due ${d.needs_by}`;
  return `${count} payments due by ${d.needs_by}`;
}

/** Sub-line under "Protects N payments". */
export function coverPlanProtectsHeader(d: DueRange, count: number): string {
  if (hasDueRange(d, count)) return `First due ${d.needs_by}, last due ${d.needs_by_last}`;
  return `Due by ${d.needs_by}`;
}
