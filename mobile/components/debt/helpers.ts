/**
 * Shared helper functions for the Debt Plan screen.
 * Ported from frontend/app/debt-plan/DebtPlanPage.tsx.
 */

const THIS_YEAR = new Date().getFullYear();

/** Format a money amount: £X or £•••• when hidden. */
export function fmtMoney(n: number, hide: boolean): string {
  if (hide) return "£••••";
  return "£" + Math.round(Math.abs(n)).toLocaleString("en-GB");
}

/** Format a "YYYY-MM" month string → "Jan" (same year) or "Jan 2027". */
export function fmtMonth(ym: string): string {
  const y = parseInt(ym.slice(0, 4), 10);
  const m = parseInt(ym.slice(5, 7), 10);
  const d = new Date(y, m - 1, 1);
  if (y === THIS_YEAR) return d.toLocaleDateString("en-GB", { month: "short" });
  return d.toLocaleDateString("en-GB", { month: "short", year: "numeric" });
}

/**
 * Is the given "YYYY-MM" promo end-month within 60 days of today?
 * Convention: the promo runs to the last day of that month.
 */
export function isCliff(until: string): boolean {
  const y = parseInt(until.slice(0, 4), 10);
  const m = parseInt(until.slice(5, 7), 10);
  const lastDay = new Date(y, m, 0); // last day of that month
  return (lastDay.getTime() - Date.now()) / 86_400_000 <= 60;
}

/** Replace all £XXXX amounts with £•••• for hideNetWorth mode. */
export function maskAmounts(text: string): string {
  return text.replace(/£[\d,]+(\.\d+)?/g, "£••••");
}

/**
 * Last day of a month as a local ISO date string.
 * monthIndex is 0-based (Jan=0).
 */
export function endOfMonthIso(year: number, monthIndex: number): string {
  const d = new Date(year, monthIndex + 1, 0);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

export const THIS_MONTH = new Date().getMonth(); // 0-based
