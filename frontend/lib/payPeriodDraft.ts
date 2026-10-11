/**
 * D8: the shape the shared pay period picker edits, and the one place it is
 * turned into (and read back from) a stored `pay_period_config`.
 *
 * Pure, no React, so scripts/d8-payday-picker.test.mjs can pin every
 * option-to-engine mapping. Engine side: backend/app/services/pay_period.py.
 *
 * "Last day of the month" is `monthly_pay_date` with day 31. The engine clamps
 * the pay day to the month's length (28/29/30/31), so day 31 is the last day
 * of every month. `calendar_month` is NOT that: it is a 1st-to-last budgeting
 * window, so it is never used for "paid on the last day".
 */
import type { PayPeriodConfig } from "./payPeriod.js";

export type PayMode = "monthly_pay_date" | "last_day" | "biweekly" | "last_weekday_of_month" | "calendar_month";

export interface PayPeriodDraft {
  mode: PayMode;
  /** 1-30, used when mode is monthly_pay_date. */
  day: number;
  /** 0 (Sunday) to 6 (Saturday), used when mode is last_weekday_of_month. */
  weekday: number;
  /** ISO date of a recent payday, used when mode is biweekly. Empty until chosen. */
  referenceDate: string;
}

export const LAST_DAY_OF_MONTH = 31;

/** Onboarding starts here: monthly, on a date the user then picks. */
export const DEFAULT_DRAFT: PayPeriodDraft = { mode: "monthly_pay_date", day: 25, weekday: 5, referenceDate: "" };

export function weekdayOfIso(iso: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return null;
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))).getUTCDay();
}

/** A draft can be saved when every field its mode needs is filled. */
export function isDraftComplete(d: PayPeriodDraft): boolean {
  if (d.mode === "biweekly") return weekdayOfIso(d.referenceDate) !== null;
  return true;
}

/** Null while incomplete (biweekly with no payday chosen yet). */
export function configFromDraft(d: PayPeriodDraft): PayPeriodConfig | null {
  switch (d.mode) {
    case "monthly_pay_date": return { type: "monthly_pay_date", day: d.day };
    case "last_day": return { type: "monthly_pay_date", day: LAST_DAY_OF_MONTH };
    case "last_weekday_of_month": return { type: "last_weekday_of_month", weekday: d.weekday };
    case "calendar_month": return { type: "calendar_month" };
    case "biweekly": {
      const wd = weekdayOfIso(d.referenceDate);
      if (wd === null) return null;
      return { type: "biweekly", weekday: wd, referenceDate: d.referenceDate };
    }
  }
}

/** Read a stored config back into a draft so Settings opens on what is saved. */
export function draftFromConfig(c: PayPeriodConfig | null | undefined): PayPeriodDraft {
  if (!c) return { ...DEFAULT_DRAFT };
  switch (c.type) {
    case "monthly_pay_date":
      return c.day >= LAST_DAY_OF_MONTH
        ? { ...DEFAULT_DRAFT, mode: "last_day" }
        : { ...DEFAULT_DRAFT, mode: "monthly_pay_date", day: c.day };
    case "last_friday": return { ...DEFAULT_DRAFT, mode: "last_weekday_of_month", weekday: 5 };
    case "last_weekday_of_month": return { ...DEFAULT_DRAFT, mode: "last_weekday_of_month", weekday: c.weekday };
    case "biweekly": return { ...DEFAULT_DRAFT, mode: "biweekly", referenceDate: c.referenceDate };
    case "calendar_month": return { ...DEFAULT_DRAFT, mode: "calendar_month" };
    default: return { ...DEFAULT_DRAFT, mode: "calendar_month" };
  }
}

export function ordinal(n: number): string {
  const v = n % 100;
  if (v >= 11 && v <= 13) return `${n}th`;
  return `${n}${n % 10 === 1 ? "st" : n % 10 === 2 ? "nd" : n % 10 === 3 ? "rd" : "th"}`;
}
