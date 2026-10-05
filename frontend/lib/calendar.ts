// G136: pure calendar helpers behind components/DatePicker. No React, no
// Date-of-the-day reads (callers pass "today"), so everything is testable and
// deterministic. Values travel as ISO strings exactly as the native inputs
// produced them: "YYYY-MM-DD" in day mode, "YYYY-MM" in month mode. Display
// is British: "16 Oct 2026" and "October 2026". Ordinal helpers live in
// lib/dates.ts and are for short backend-formatted strings, not used here.

export type PickerMode = "day" | "month";
/** m is 0-11. Month values always carry d = 1. */
export interface Ymd { y: number; m: number; d: number }

export const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"] as const;
export const MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;
const WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;
/** Monday-first column heads for the day grid. */
export const WEEKDAY_HEADS = [
  { s: "M", l: "Monday" }, { s: "T", l: "Tuesday" }, { s: "W", l: "Wednesday" }, { s: "T", l: "Thursday" },
  { s: "F", l: "Friday" }, { s: "S", l: "Saturday" }, { s: "S", l: "Sunday" },
] as const;
/** How many years one page of the year selector shows (3 x 4). */
export const YEAR_PAGE = 12;

const pad = (n: number, w = 2) => String(n).padStart(w, "0");

export const daysIn = (y: number, m: number) => new Date(y, m + 1, 0).getDate();
export const monthKey = (v: { y: number; m: number }) => v.y * 12 + v.m;
export const dayKey = (v: Ymd) => v.y * 10000 + v.m * 100 + v.d;
export const sameDay = (a: Ymd | null, b: Ymd | null) => !!a && !!b && dayKey(a) === dayKey(b);
export const toMonth = (v: Ymd): Ymd => ({ y: v.y, m: v.m, d: 1 });
export const weekdayName = (v: Ymd) => WEEKDAY_NAMES[new Date(v.y, v.m, v.d).getDay()];

/** Parse "YYYY-MM-DD" (day) or "YYYY-MM" (month); null when empty or invalid. */
export function parseIso(value: string | null | undefined, mode: PickerMode): Ymd | null {
  if (!value) return null;
  const match = (mode === "day" ? /^(\d{4})-(\d{2})-(\d{2})$/ : /^(\d{4})-(\d{2})$/).exec(value);
  if (!match) return null;
  const y = Number(match[1]);
  const m = Number(match[2]) - 1;
  const d = mode === "day" ? Number(match[3]) : 1;
  if (m < 0 || m > 11 || d < 1 || d > daysIn(y, m)) return null;
  return { y, m, d };
}

export function formatIso(v: Ymd, mode: PickerMode): string {
  return mode === "day" ? `${pad(v.y, 4)}-${pad(v.m + 1)}-${pad(v.d)}` : `${pad(v.y, 4)}-${pad(v.m + 1)}`;
}

/** The local calendar day as an ISO date (never UTC, which is wrong near midnight). */
export function todayIso(now: Date = new Date()): string {
  return formatIso({ y: now.getFullYear(), m: now.getMonth(), d: now.getDate() }, "day");
}

export const formatDay = (v: Ymd) => `${v.d} ${MONTH_SHORT[v.m]} ${v.y}`;
export const formatMonth = (v: Ymd) => `${MONTH_NAMES[v.m]} ${v.y}`;

/** Display text for a stored value, or "" when empty or invalid. */
export function formatValue(value: string | null | undefined, mode: PickerMode): string {
  const v = parseIso(value, mode);
  if (!v) return "";
  return mode === "day" ? formatDay(v) : formatMonth(v);
}

export function addDays(v: Ymd, n: number): Ymd {
  const d = new Date(v.y, v.m, v.d + n);
  return { y: d.getFullYear(), m: d.getMonth(), d: d.getDate() };
}

/** Shift by whole months, keeping the day when the target month has it. */
export function addMonths(v: Ymd, n: number): Ymd {
  const t = v.y * 12 + v.m + n;
  const y = Math.floor(t / 12);
  const m = ((t % 12) + 12) % 12;
  return { y, m, d: Math.min(v.d, daysIn(y, m)) };
}

/**
 * Cells for one month, Monday-first: leading blanks (null), the days 1..n,
 * then trailing blanks so the length is always a multiple of 7.
 */
export function monthGridCells(y: number, m: number): (number | null)[] {
  const lead = (new Date(y, m, 1).getDay() + 6) % 7;
  const cells: (number | null)[] = [
    ...Array.from({ length: lead }, () => null),
    ...Array.from({ length: daysIn(y, m) }, (_, i) => i + 1),
  ];
  while (cells.length % 7) cells.push(null);
  return cells;
}

export function chunk<T>(items: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += n) out.push(items.slice(i, i + n));
  return out;
}

/** Whether v sits outside [min, max] at the mode's granularity. */
export function outOfRange(v: Ymd, mode: PickerMode, min: Ymd | null, max: Ymd | null): boolean {
  if (mode === "day") return (!!min && dayKey(v) < dayKey(min)) || (!!max && dayKey(v) > dayKey(max));
  return (!!min && monthKey(v) < monthKey(min)) || (!!max && monthKey(v) > monthKey(max));
}

/** Clamp v into [min, max] at the mode's granularity (month mode returns d = 1). */
export function clampYmd(v: Ymd, mode: PickerMode, min: Ymd | null, max: Ymd | null): Ymd {
  const base = mode === "month" ? toMonth(v) : v;
  if (min && outOfRange(base, mode, min, null)) return mode === "month" ? toMonth(min) : min;
  if (max && outOfRange(base, mode, null, max)) return mode === "month" ? toMonth(max) : max;
  return base;
}

/** Clamp an ISO string; returns "" for an empty or invalid input. */
export function clampIso(value: string, mode: PickerMode, min?: string, max?: string): string {
  const v = parseIso(value, mode);
  if (!v) return "";
  return formatIso(clampYmd(v, mode, parseIso(min, mode), parseIso(max, mode)), mode);
}

/**
 * First year of the page that should be showing when the year selector opens
 * on `year`. With a minimum the pages are aligned to it (so paging back never
 * lands on dead years); without one the year sits four from the start.
 */
export function yearPageStart(year: number, minYear?: number | null, maxYear?: number | null): number {
  let start = minYear != null ? minYear + Math.floor((year - minYear) / YEAR_PAGE) * YEAR_PAGE : year - 4;
  if (maxYear != null && start + YEAR_PAGE - 1 > maxYear && (minYear == null || maxYear - YEAR_PAGE + 1 >= minYear)) {
    start = maxYear - YEAR_PAGE + 1;
  }
  return start;
}

export interface YearPage { years: number[]; hasPrev: boolean; hasNext: boolean }

/** The 12 years of a page, and whether another page exists either side within min/max. */
export function yearPage(start: number, minYear?: number | null, maxYear?: number | null): YearPage {
  return {
    years: Array.from({ length: YEAR_PAGE }, (_, i) => start + i),
    hasPrev: minYear == null || start > minYear,
    hasNext: maxYear == null || start + YEAR_PAGE - 1 < maxYear,
  };
}
