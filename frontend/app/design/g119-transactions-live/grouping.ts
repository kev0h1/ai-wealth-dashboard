// Date-group helpers for the G119 transactions round. Kevin's own feedback
// on G92 (see this route's index description) was to KEEP the day
// groupings — this is that grammar, rebuilt to be correct against the same
// bug formatDate() in lib/payPeriod.ts already documents: the API sends
// naive datetimes ("2026-07-17T00:00:00", no zone), and `new Date(str)`
// parses that as LOCAL time, which silently shifts a payment onto the
// wrong day for anyone west of Greenwich. Every date comparison here goes
// through dateToUTCDay (same helper formatDate uses) instead of a raw
// `new Date(iso)`, unlike McpActivityPage.tsx's groupByDay which is
// grouping real UTC instants (`ts`, ISO with a trailing Z) and doesn't
// have this problem.
import { dateToUTCDay } from "@/lib/payPeriod";
import type { Transaction } from "@/lib/api";

const MONTH_LONG = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

export function dayKey(dateStr: string): number {
  return dateToUTCDay(dateStr);
}

export function formatDayHeading(dateStr: string): string {
  const t = dateToUTCDay(dateStr);
  const now = new Date();
  const todayUTC = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  const diffDays = Math.round((todayUTC - t) / 86400000);
  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  const d = new Date(t);
  const sameYear = d.getUTCFullYear() === now.getFullYear();
  return sameYear
    ? `${d.getUTCDate()} ${MONTH_LONG[d.getUTCMonth()]}`
    : `${d.getUTCDate()} ${MONTH_LONG[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

export interface DayGroup {
  key: number;
  heading: string;
  rows: Transaction[];
}

// Groups an already date-desc-sorted list into consecutive same-day
// sections. Safe across "load more"/infinite-scroll appends as long as the
// appended items are a contiguous continuation of the same sorted order
// (true for Variant B/C's accumulate-in-place paging) — a day never splits
// into two non-adjacent sections. NOT safe across independent same-position
// re-fetches (Variant A's page-based Prev/Next replaces `items` wholesale
// each page, so a day that straddles a page boundary legitimately opens a
// second heading on the next page; that's a disclosed, deliberate
// consequence of page-based paging, not a bug here — see this route's
// pagination recommendation).
export function groupByDay(items: Transaction[]): DayGroup[] {
  const groups: DayGroup[] = [];
  for (const tx of items) {
    const key = dayKey(tx.date);
    const last = groups[groups.length - 1];
    if (last && last.key === key) {
      last.rows.push(tx);
    } else {
      groups.push({ key, heading: formatDayHeading(tx.date), rows: [tx] });
    }
  }
  return groups;
}
