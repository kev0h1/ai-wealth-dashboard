import type { CashflowData } from "./api";
import { getPayPeriodWithConfig, type PayPeriodConfig } from "./payPeriod";

/**
 * G327: the one pay period Upcoming renders. Once the cashflow payload has
 * arrived, every date and count comes from `cashflow.period` (the server's
 * definition, the same builder the Spend verdict uses). The client
 * pay-period config is ONLY a loading seed, used before the payload arrives
 * (or when an older API build omits `period`); `fromServer` says which.
 */
export type UpcomingPeriod = {
  start: Date;
  /** Last day of the period (midnight UTC). */
  end: Date;
  /** First day of the next period (end + 1 day). */
  payday: Date;
  daysToPayday: number;
  paydayLabel: string;
  isCalendarMonth: boolean;
  fromServer: boolean;
};

const DAY = 86400000;
const isoToUtc = (iso: string) => new Date(`${iso}T00:00:00Z`);
const labelFor = (d: Date) => d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });

export function resolveUpcomingPeriod(
  cashflow: Pick<CashflowData, "period"> | null,
  seed: { config: PayPeriodConfig; nowMs: number },
): UpcomingPeriod {
  const p = cashflow?.period;
  if (p) {
    const end = isoToUtc(p.end);
    const payday = isoToUtc(p.payday);
    return {
      start: isoToUtc(p.start),
      end,
      payday,
      daysToPayday: Math.max(0, p.length_days - p.day_number + 1),
      paydayLabel: labelFor(payday),
      isCalendarMonth: p.type === "calendar_month",
      fromServer: true,
    };
  }
  // Loading seed only: never rendered once the payload (with `period`) is present.
  const [start, end] = getPayPeriodWithConfig(new Date(seed.nowMs), seed.config);
  const payday = new Date(end.getTime() + DAY);
  const now = new Date(seed.nowMs);
  const todayMidnight = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return {
    start,
    end,
    payday,
    daysToPayday: Math.round((Date.UTC(payday.getUTCFullYear(), payday.getUTCMonth(), payday.getUTCDate()) - todayMidnight) / DAY),
    paydayLabel: labelFor(payday),
    isCalendarMonth: seed.config.type === "calendar_month",
    fromServer: false,
  };
}

/**
 * G329: "Pay expected Wed 28 Oct." only when the server reports a confirmed
 * salary date that differs from the period's own payday, so Home's until-date
 * and Upcoming's payday do not read as a contradiction. Null otherwise.
 */
export function payExpectedLabel(period: CashflowData["period"] | null | undefined): string | null {
  const o = period?.payday_observed;
  if (!period || !o || o.date === period.payday) return null;
  return `Pay expected ${labelFor(isoToUtc(o.date))}.`;
}
