import type { SafeToSpend } from "./api";
import { homeForecastPresentation, type SafeToSpendHeadline } from "./pennyScreenViews";
export { homeForecastPresentation } from "./pennyScreenViews";

export type ForecastTone = "risk" | "watch" | "good" | "neutral";
export type ForecastStatus = { tone: ForecastTone; label: string };
export type UpcomingForecastPresentation = { status: ForecastStatus; qualifierTone: ForecastTone; pending?: boolean };
export const FORECAST_INK = "text-slate-900 dark:text-slate-100";
export const FORECAST_QUALIFIER: Record<ForecastTone, string> = {
  risk: "text-rose-700 dark:text-rose-300",
  watch: "text-amber-800 dark:text-amber-200",
  good: "text-emerald-800 dark:text-emerald-300",
  neutral: FORECAST_INK,
};
export const FORECAST_SURFACE = "bg-slate-100 dark:bg-slate-700";

export type HomeForecastPresentation = {
  status: ForecastStatus;
  eyebrow: string;
  caption?: string;
  signed: boolean;
};
const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);

/**
 * Cashflow inputs are already penny-denominated. Normalise only after the
 * client-side walk has combined them, so binary floating-point residue cannot
 * turn an exactly-covered forecast into a microscopic red shortage. Non-finite
 * values remain untouched for the existing neutral availability guard.
 */
export function forecastPence(value: number): number {
  if (!finite(value)) return value;
  const rounded = Math.round(value * 100) / 100;
  return rounded === 0 ? 0 : rounded;
}

/** Compare UK calendar days, including ISO timestamps with an offset. */
function ukDay(value: string | number): string | null {
  const date = new Date(value);
  return Number.isFinite(date.getTime())
    ? new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit" }).format(date)
    : null;
}

/** The own dated cash walk supplies payment risk. Comparable Home metadata
 * supplies buffer, card-check and Tight context, never a replacement amount.
 * Missing, stale or mismatched evidence cannot assert that payments are safe. */
export function upcomingForecastPresentation(input: {
  runway: number;
  lowestCash: number | null;
  evidenceCurrent: boolean;
  nextPayday: number;
  isCalendarMonth: boolean;
  metadata: SafeToSpend | null;
  metadataPending?: boolean;
  headline: SafeToSpendHeadline | null;
  plansAvailable: boolean;
}): UpcomingForecastPresentation {
  const neutral: UpcomingForecastPresentation = { status: { tone: "neutral", label: "Check forecast" }, qualifierTone: "neutral" };
  if (!input.evidenceCurrent || !finite(input.runway) || !finite(input.lowestCash)) return neutral;
  if (input.lowestCash < 0) return {
    status: { tone: "risk", label: input.runway < 0 ? "Short" : "Earlier gap" },
    qualifierTone: input.runway < 0 ? "risk" : "neutral",
  };
  if (input.metadataPending) return { ...neutral, pending: true };
  const data = input.metadata;
  if (input.isCalendarMonth || !data || data.status !== "ok" || !input.headline || data.calculation_status !== "complete"
    || !ukDay(data.next_payday) || ukDay(data.next_payday) !== ukDay(input.nextPayday)
    || !input.plansAvailable || !finite(data.lowest_projected_balance)) return neutral;
  // Conflicting snapshots must not turn a known dated gap into green.
  if (data.lowest_projected_balance < 0) return neutral;
  const home = homeForecastPresentation(data, input.headline);
  if (input.runway === 0) return { status: { tone: "watch", label: "No headroom" }, qualifierTone: "watch" };
  if (home.status.tone === "neutral") return neutral;
  // A negative endpoint needs proved optional-reserve context, never green.
  if (input.runway < 0) return home.status.label === "Plans gap"
    ? { status: home.status, qualifierTone: "watch" } : neutral;
  return { status: home.status, qualifierTone: home.status.tone === "good" ? "good" : "neutral" };
}
