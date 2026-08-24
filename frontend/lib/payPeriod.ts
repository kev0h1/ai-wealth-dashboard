/**
 * Pay period helpers — mirrors bot.py logic.
 * Pay day = last Friday of each month.
 * A pay period runs from the payday of one month to the day before the payday
 * of the following month.
 */

/** Returns the last Friday of the given year/month as a Date (midnight UTC). */
export function lastFriday(year: number, month: number): Date {
  // month is 1-based (1 = January)
  // Start from the last day of the month and go backwards until Friday (5)
  const lastDay = new Date(Date.UTC(year, month, 0)); // day 0 of next month = last day of this month
  const dayOfWeek = lastDay.getUTCDay(); // 0=Sun, 5=Fri
  const daysBack = dayOfWeek >= 5 ? dayOfWeek - 5 : dayOfWeek + 2;
  lastDay.setUTCDate(lastDay.getUTCDate() - daysBack);
  return lastDay;
}

/** Returns the payday (last Friday) for a given year/month. */
export function getPayday(year: number, month: number): Date {
  return lastFriday(year, month);
}

/** Returns the last occurrence of `weekday` (0=Sun…6=Sat) in the given year/month. */
export function lastWeekdayOfMonth(year: number, month: number, weekday: number): Date {
  const lastDay = new Date(Date.UTC(year, month, 0));
  const dayOfWeek = lastDay.getUTCDay();
  const daysBack = (dayOfWeek - weekday + 7) % 7;
  lastDay.setUTCDate(lastDay.getUTCDate() - daysBack);
  return lastDay;
}

/**
 * Returns [start, end] for the pay period that contains refDate.
 * Start = last Friday of the previous month, End = day before last Friday of refDate's month.
 */
export function getPayPeriod(refDate: Date): [Date, Date] {
  const year = refDate.getUTCFullYear();
  const month = refDate.getUTCMonth() + 1; // 1-based

  // Payday this month
  const thisPayday = getPayday(year, month);

  let startMonth: number;
  let startYear: number;
  let endDate: Date;

  if (refDate.getTime() >= thisPayday.getTime()) {
    // We are on or after payday — period starts this month's payday
    startYear = year;
    startMonth = month;
    // End = day before next month's payday
    const nextMonth = month === 12 ? 1 : month + 1;
    const nextYear = month === 12 ? year + 1 : year;
    const nextPayday = getPayday(nextYear, nextMonth);
    endDate = new Date(nextPayday.getTime() - 86400000);
  } else {
    // Before payday — period started last month's payday
    const prevMonth = month === 1 ? 12 : month - 1;
    const prevYear = month === 1 ? year - 1 : year;
    startYear = prevYear;
    startMonth = prevMonth;
    // End = day before this month's payday
    endDate = new Date(thisPayday.getTime() - 86400000);
  }

  const start = getPayday(startYear, startMonth);
  return [start, endDate];
}

/** Navigate to the previous pay period. */
export function prevPeriod(start: Date): [Date, Date] {
  // Go one day before start to land in the previous period
  const dayBefore = new Date(start.getTime() - 86400000);
  return getPayPeriod(dayBefore);
}

/** Navigate to the next pay period. */
export function nextPeriod(end: Date): [Date, Date] {
  // Go one day after end to land in the next period
  const dayAfter = new Date(end.getTime() + 86400000);
  return getPayPeriod(dayAfter);
}

// Extract the calendar day encoded in an API date string as a UTC-midnight
// timestamp, WITHOUT going through JS's local-time parsing of naive
// datetimes. The API sends naive datetimes like "2026-07-31T00:00:00" (no
// timezone offset) — `new Date(...)` parses a string with no zone info as
// LOCAL time, so in BST (UTC+1) that instant becomes "2026-07-30T23:00:00Z",
// which is earlier than a `periodStart` built with `Date.UTC(...)`. Net
// effect if you use the raw parse: every transaction dated on day 1 of a pay
// period silently fails the `d >= s` check below and vanishes from every
// client-side filtered list (Income drill-down, Spend/Budget/Trends period
// views) — the server-computed OUT/IN pills are unaffected because they
// never run through this function. Parsing the calendar day straight out of
// the string and rebuilding it as UTC midnight treats the date the way the
// API actually meant it (a calendar day), not as a local instant. Do not
// "simplify" this back to `new Date(dateStr).getTime()`.
export function dateToUTCDay(dateStr: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(dateStr);
  if (m) return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return new Date(dateStr).getTime(); // fallback for a shape this regex doesn't match
}

/** Filter transactions to those within [start, end] inclusive. */
export function filterPeriod<T extends { date: string }>(
  txns: T[],
  start: Date,
  end: Date
): T[] {
  const s = start.getTime();
  const e = end.getTime() + 86399999; // end of end day
  return txns.filter((t) => {
    const d = dateToUTCDay(t.date);
    return d >= s && d <= e;
  });
}

const MONTH_SHORT = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

/** Format as "25 Apr → 30 May". */
export function formatPeriod(start: Date, end: Date): string {
  const sd = start.getUTCDate();
  const sm = MONTH_SHORT[start.getUTCMonth()];
  const ed = end.getUTCDate();
  const em = MONTH_SHORT[end.getUTCMonth()];
  return `${sd} ${sm} → ${ed} ${em}`;
}

/** Format a date as "25 Apr" — extracts the calendar day via dateToUTCDay
 * (see that function's comment above) rather than `new Date(dateStr)`
 * directly. The API sends naive datetimes like "2026-07-17T00:00:00" (no
 * timezone offset) for EVERY transaction date, including the review sheet's
 * transfer-pair legs and miscategorised-series dates alike; `new Date(...)`
 * parses a string with no zone info as LOCAL time, so in a positive-UTC-
 * offset zone (e.g. BST, UTC+1) a stored midnight instant becomes the
 * previous day once read back with getUTCDate(). Confirmed live: a pair leg
 * stored as "2026-07-17T00:00:00" rendered as "16 Jul" in BST — a plain
 * debit's non-midnight time (e.g. "04:20:31") only shifts within the same
 * day, so this bug hid in plain sight until a leg happened to land exactly
 * on midnight. Do not "simplify" this back to `new Date(dateStr)`. */
export function formatDate(dateStr: string): string {
  const t = dateToUTCDay(dateStr);
  const d = new Date(t);
  return `${d.getUTCDate()} ${MONTH_SHORT[d.getUTCMonth()]}`;
}

// ── Configurable pay period ───────────────────────────────────────────────────

export type PayPeriodConfig =
  | { type: "last_friday" }
  | { type: "last_weekday_of_month"; weekday: number }
  | { type: "calendar_month" }
  | { type: "monthly_pay_date"; day: number }   // day 1-28: period from day N to day N-1 next month
  | { type: "weekly"; weekday: number }          // 0=Sun…6=Sat, 7-day periods
  | { type: "biweekly"; weekday: number; referenceDate: string }  // ISO payday reference
  | { type: "custom"; start: string; end: string };  // one period; prev/next shift by same duration

export const DEFAULT_PAY_PERIOD_CONFIG: PayPeriodConfig = { type: "calendar_month" };

function clampDay(year: number, month: number, day: number): number {
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return Math.min(day, last);
}

function lastWeekdayOfMonthPeriod(refDate: Date, weekday: number): [Date, Date] {
  const year = refDate.getUTCFullYear();
  const month = refDate.getUTCMonth() + 1;
  const thisPayday = lastWeekdayOfMonth(year, month, weekday);
  if (refDate.getTime() >= thisPayday.getTime()) {
    const nextMonth = month === 12 ? 1 : month + 1;
    const nextYear = month === 12 ? year + 1 : year;
    const nextPayday = lastWeekdayOfMonth(nextYear, nextMonth, weekday);
    return [thisPayday, new Date(nextPayday.getTime() - 86400000)];
  } else {
    const prevMonth = month === 1 ? 12 : month - 1;
    const prevYear = month === 1 ? year - 1 : year;
    const prevPayday = lastWeekdayOfMonth(prevYear, prevMonth, weekday);
    return [prevPayday, new Date(thisPayday.getTime() - 86400000)];
  }
}

function calendarMonthPeriod(refDate: Date): [Date, Date] {
  const y = refDate.getUTCFullYear();
  const m = refDate.getUTCMonth();
  return [new Date(Date.UTC(y, m, 1)), new Date(Date.UTC(y, m + 1, 0))];
}

function monthlyPayDatePeriod(refDate: Date, payDay: number): [Date, Date] {
  const y = refDate.getUTCFullYear();
  const m = refDate.getUTCMonth() + 1; // 1-based
  const d = refDate.getUTCDate();
  const thisPay = clampDay(y, m, payDay);
  if (d >= thisPay) {
    const nm = m === 12 ? 1 : m + 1;
    const ny = m === 12 ? y + 1 : y;
    const nextPay = clampDay(ny, nm, payDay);
    return [
      new Date(Date.UTC(y, m - 1, thisPay)),
      new Date(Date.UTC(ny, nm - 1, nextPay - 1)),
    ];
  } else {
    const pm = m === 1 ? 12 : m - 1;
    const py = m === 1 ? y - 1 : y;
    const prevPay = clampDay(py, pm, payDay);
    return [
      new Date(Date.UTC(py, pm - 1, prevPay)),
      new Date(Date.UTC(y, m - 1, thisPay - 1)),
    ];
  }
}

function weeklyPeriod(refDate: Date, weekday: number): [Date, Date] {
  const day = refDate.getUTCDay();
  const back = (day - weekday + 7) % 7;
  const start = new Date(Date.UTC(refDate.getUTCFullYear(), refDate.getUTCMonth(), refDate.getUTCDate() - back));
  const end = new Date(start.getTime() + 6 * 86400000);
  return [start, end];
}

function biweeklyPeriod(refDate: Date, weekday: number, referenceDate: string): [Date, Date] {
  const ref = new Date(referenceDate);
  const diffDays = Math.floor((Date.UTC(refDate.getUTCFullYear(), refDate.getUTCMonth(), refDate.getUTCDate()) - ref.getTime()) / 86400000);
  const periodNum = Math.floor(diffDays / 14);
  const start = new Date(ref.getTime() + periodNum * 14 * 86400000);
  const end = new Date(start.getTime() + 13 * 86400000);
  return [start, end];
}

function customPeriod(refDate: Date, start: string, end: string): [Date, Date] {
  const s = new Date(start);
  const e = new Date(end);
  const duration = e.getTime() - s.getTime(); // ms (same length for prev/next)
  const t = refDate.getTime();

  // Current period
  if (t >= s.getTime() && t <= e.getTime() + 86399999) return [s, e];

  // Previous period: ends day before start, same duration
  const prevEnd = new Date(s.getTime() - 86400000);
  const prevStart = new Date(prevEnd.getTime() - duration);
  if (t >= prevStart.getTime() && t <= prevEnd.getTime() + 86399999) return [prevStart, prevEnd];

  // Next period: starts day after end, same duration
  const nextStart = new Date(e.getTime() + 86400000);
  const nextEnd = new Date(nextStart.getTime() + duration);
  if (t >= nextStart.getTime() && t <= nextEnd.getTime() + 86399999) return [nextStart, nextEnd];

  // Beyond the 3 custom periods: fall back to calendar month
  return calendarMonthPeriod(refDate);
}

export function getPayPeriodWithConfig(refDate: Date, config: PayPeriodConfig): [Date, Date] {
  switch (config.type) {
    case "last_friday":              return getPayPeriod(refDate);
    case "last_weekday_of_month":   return lastWeekdayOfMonthPeriod(refDate, config.weekday);
    case "calendar_month":          return calendarMonthPeriod(refDate);
    case "monthly_pay_date":   return monthlyPayDatePeriod(refDate, config.day);
    case "weekly":             return weeklyPeriod(refDate, config.weekday);
    case "biweekly":           return biweeklyPeriod(refDate, config.weekday, config.referenceDate);
    case "custom":             return customPeriod(refDate, config.start, config.end);
  }
}

/**
 * Human-readable pay-period rhythm, or null when it doesn't map to a clean
 * cadence ("custom") — callers should fall back to unqualified copy rather
 * than a wrong label. Mirrors backend/app/services/pay_period.py's
 * period_rhythm_label so a client-side estimate (e.g. CommitmentSheet's
 * live "≈ £X" preview, before there's a saved doc to ask the server about)
 * agrees with what the server says once saved. "biweekly" here is a strict
 * 14-day cycle (labelled "Every two weeks" in PayPeriodSettingsSheet.tsx),
 * not a 4-weekly or twice-a-month cadence.
 */
export function periodRhythmLabel(config: PayPeriodConfig): string | null {
  switch (config.type) {
    case "calendar_month":
    case "monthly_pay_date":
    case "last_friday":
    case "last_weekday_of_month":
      return "monthly";
    case "weekly":
      return "weekly";
    case "biweekly":
      return "every 2 weeks";
    default:
      return null; // "custom" — irregular, no clean rhythm to name
  }
}

export function prevPeriodWithConfig(start: Date, config: PayPeriodConfig): [Date, Date] {
  const d = new Date(start.getTime() - 86400000);
  return getPayPeriodWithConfig(d, config);
}

export function nextPeriodWithConfig(end: Date, config: PayPeriodConfig): [Date, Date] {
  const d = new Date(end.getTime() + 86400000);
  return getPayPeriodWithConfig(d, config);
}
