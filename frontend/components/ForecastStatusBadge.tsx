import { AlertCircle, AlertTriangle, Minus, ShieldCheck } from "lucide-react";
import { FORECAST_QUALIFIER, FORECAST_SURFACE, type ForecastStatus } from "@/lib/cashForecastStatus";

/** G287 E: colour is confined to the small icon and its plain-language label. */
export default function ForecastStatusBadge({ status }: { status: ForecastStatus }) {
  const Icon = status.tone === "risk" ? AlertTriangle : status.tone === "watch" ? AlertCircle : status.tone === "good" ? ShieldCheck : Minus;
  return <span role="status" data-forecast-tone={status.tone} className={`inline-flex min-h-7 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-[11px] font-semibold leading-[1.3] ${FORECAST_SURFACE} ${FORECAST_QUALIFIER[status.tone]}`}>
    <Icon size={13} className="shrink-0" aria-hidden="true" />{status.label}
  </span>;
}
