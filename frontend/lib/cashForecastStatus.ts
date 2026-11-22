export { homeForecastPresentation, forecastPence, isNoHeadroom } from "./pennyScreenViews";

export type ForecastTone = "risk" | "watch" | "good" | "neutral";
export type ForecastStatus = { tone: ForecastTone; label: string };
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
