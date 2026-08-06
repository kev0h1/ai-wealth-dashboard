// Period arithmetic for the Spend screen — self-contained port of the web
// frontend/lib/payPeriod.ts logic, simplified to calendar-month only for now
// (the mobile app does not yet expose pay-period configuration).

import type { Transaction } from "@/lib/api/spend";

export interface PeriodBounds {
  start: Date;
  end: Date;
}

/** Return the calendar-month period that contains `date`. */
export function getCurrentPeriod(date: Date = new Date()): PeriodBounds {
  const start = new Date(date.getFullYear(), date.getMonth(), 1);
  const end = new Date(date.getFullYear(), date.getMonth() + 1, 0); // last day
  return { start, end };
}

/** Return the period immediately before `periodStart`. */
export function prevPeriod(periodStart: Date): PeriodBounds {
  const m = periodStart.getMonth(); // 0–11
  const y = periodStart.getFullYear();
  const prevMonth = m === 0 ? 11 : m - 1;
  const prevYear = m === 0 ? y - 1 : y;
  const start = new Date(prevYear, prevMonth, 1);
  const end = new Date(y, m, 0); // last day of prevMonth
  return { start, end };
}

/** Return the period immediately after `periodEnd`. */
export function nextPeriod(periodEnd: Date): PeriodBounds {
  const y = periodEnd.getFullYear();
  const m = periodEnd.getMonth(); // 0–11
  const nextMonth = m === 11 ? 0 : m + 1;
  const nextYear = m === 11 ? y + 1 : y;
  const start = new Date(y, m + 1, 1);
  const end = new Date(nextYear, nextMonth + 1, 0);
  return { start, end };
}

/** Format a period as "Jan 2026" or "1 Jan – 28 Feb" for multi-month periods. */
export function formatPeriodLocal(start: Date, end: Date): string {
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
                  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  if (
    start.getFullYear() === end.getFullYear() &&
    start.getMonth() === end.getMonth()
  ) {
    return `${MONTHS[start.getMonth()]} ${start.getFullYear()}`;
  }
  return `${start.getDate()} ${MONTHS[start.getMonth()]} – ${end.getDate()} ${MONTHS[end.getMonth()]}`;
}

/** Filter transactions to those that fall within [start, end] inclusive. */
export function filterPeriod(
  transactions: Transaction[],
  start: Date,
  end: Date
): Transaction[] {
  const s = start.getTime();
  const e = end.getTime() + 86_400_000 - 1; // include all of end day
  return transactions.filter((tx) => {
    const d = new Date(tx.date).getTime();
    return d >= s && d <= e;
  });
}

/** Determine if two periods refer to the same calendar month. */
export function isSamePeriod(a: PeriodBounds, b: PeriodBounds): boolean {
  return (
    a.start.getFullYear() === b.start.getFullYear() &&
    a.start.getMonth() === b.start.getMonth()
  );
}

const HOME_CURRENCY = "GBP";

/** True if the transaction is in the user's home currency (GBP for UK). */
export function isHomeCurrency(currency: string): boolean {
  return currency.toUpperCase() === HOME_CURRENCY;
}

/** Format a date string (YYYY-MM-DD) for display, e.g. "12 Jan". */
export function formatDate(dateStr: string): string {
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
                  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const d = new Date(dateStr + "T00:00:00");
  return `${d.getDate()} ${MONTHS[d.getMonth()]}`;
}

/** Format a currency amount for display: "£1,234". */
export function formatCurrency(amount: number, currency: string): string {
  const sym = currency.toUpperCase() === "GBP" ? "£" : `${currency} `;
  return `${sym}${Math.abs(amount).toLocaleString("en-GB", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  })}`;
}
