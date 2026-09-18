// Date-group helpers for payment lists — grouped by calendar day under a
// heading ("13 September"). Originally built for the G119 design round
// (app/design/g119-transactions-live) after Kevin's own feedback on the
// prior G92 round was to KEEP the day groupings; extracted here for G122 so
// the production transactions hub (app/transactions/TransactionsPage.tsx)
// and that preview's Variant A share ONE grouping implementation instead of
// the preview staying a copy production can silently drift from — the same
// reasoning lib/transactionFilters.ts already documents for the filter
// chips/sheet.
//
// Every date comparison here goes through dateToUTCDay (the same helper
// lib/payPeriod.ts's own formatDate uses) instead of a raw `new Date(iso)`,
// because the API sends naive datetimes ("2026-07-17T00:00:00", no zone)
// and `new Date(str)` parses that as LOCAL time, silently shifting a
// payment onto the wrong day for anyone west of Greenwich.
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
// appended items are a contiguous continuation of the same sorted order — a
// day never splits into two non-adjacent sections. NOT safe across
// independent same-position re-fetches: both the production
// TransactionsPage.tsx and the preview's Variant A use page-based Prev/Next
// pagination (GET /transactions/search's only pagination contract), which
// replaces `items` wholesale each page, so a day that straddles a page
// boundary legitimately opens a second heading on the next page. That is a
// disclosed, deliberate consequence of page-based paging (every row is
// still shown exactly once, under whichever page's heading it falls on),
// not a bug — a true cursor would need a backend change to fix, see this
// route's own pagination recommendation.
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
