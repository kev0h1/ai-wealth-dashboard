import { getPayPeriodWithConfig, nextPeriodWithConfig, dateToUTCDay, type PayPeriodConfig } from "./payPeriod";

/**
 * G329: the last client-side pay-period derivations (Home's pinned chart
 * window, CommitmentSheet's periods-left estimate) read the server's period
 * (safe-to-spend `period`, cashflow `period` or the Spend verdict `period`,
 * all built by backend pay_period.period_facts). The client config is a
 * clearly marked fallback only, used when no server period is available yet.
 */
export type ServerPeriodBounds = { start: string; end: string };
export type PeriodWindow = { start: Date; end: Date };
export type HomeChartWindow = PeriodWindow & { source: "safe-to-spend" | "verdict" | "client-fallback" };

const toWindow = (p: ServerPeriodBounds): PeriodWindow => ({
  start: new Date(dateToUTCDay(p.start)),
  end: new Date(dateToUTCDay(p.end)),
});

/** First usable server period of the candidates (null when none). */
export function pickServerPeriod(...candidates: Array<ServerPeriodBounds | null | undefined>): PeriodWindow | null {
  for (const c of candidates) if (c && c.start && c.end) return toWindow(c);
  return null;
}

/**
 * Home's pinned-chart window. Order: the Safe to Spend payload's `period`
 * (already loaded for the hero), then the current-period Spend verdict from
 * the shared cache, then the client config (FALLBACK ONLY, e.g. a payload
 * cached before `period` existed, or before either has loaded).
 */
export function resolveHomeChartWindow(opts: {
  safeToSpendPeriod?: ServerPeriodBounds | null;
  verdictPeriod?: ServerPeriodBounds | null;
  fallback: { config: PayPeriodConfig; now: Date };
}): HomeChartWindow {
  const sts = pickServerPeriod(opts.safeToSpendPeriod);
  if (sts) return { ...sts, source: "safe-to-spend" };
  const v = pickServerPeriod(opts.verdictPeriod);
  if (v) return { ...v, source: "verdict" };
  const [start, end] = getPayPeriodWithConfig(opts.fallback.now, opts.fallback.config);
  return { start, end, source: "client-fallback" };
}

/**
 * Pay-period START days in [today, target month's first day] inclusive, min 1.
 * Mirrors the backend's _period_starts_between. The current period is anchored
 * on the server's period when given; the config only supplies the rhythm of
 * later periods (and the whole anchor when `anchor` is null: FALLBACK ONLY).
 */
export function periodsLeftFrom(targetYm: string, config: PayPeriodConfig, anchor: PeriodWindow | null, now: Date): number {
  if (!/^\d{4}-\d{2}$/.test(targetYm)) return 1;
  const [y, m] = targetYm.split("-").map(Number);
  const target = Date.UTC(y, m - 1, 1);
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  let [start, end] = anchor ? [anchor.start, anchor.end] : getPayPeriodWithConfig(now, config);
  let count = 0;
  for (let i = 0; i < 60; i++) {
    if (start.getTime() > target) break;
    if (start.getTime() >= today) count++;
    [start, end] = nextPeriodWithConfig(end, config);
  }
  return Math.max(1, count);
}
