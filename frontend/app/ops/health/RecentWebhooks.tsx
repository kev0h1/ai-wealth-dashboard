// E9: the "Recent webhooks" block on /ops/health. Props only, so the render
// test (scripts/e9-recent-webhooks.test.mjs) can feed it raw data. The backend
// (GET /ops/webhooks/recent) already projects to an allowlist: time, provider,
// event type, outcome and a short reason code. Nothing here is a secret.
import type { OpsRecentWebhooks } from "@/lib/api";

const CARD = "glass-card rounded-3xl p-5";
const LABEL = "text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400";
const MUTED = "text-sm text-slate-500 dark:text-slate-400";
const WARN = "text-amber-700 dark:text-amber-400";

export const RECENT_WEBHOOKS_TITLE = "Recent webhooks";

const PROVIDERS: Record<string, string> = {
  finexer: "Finexer",
  truelayer: "TrueLayer",
  stripe: "Stripe",
  apple: "Apple",
  google: "Google Play",
};
const OUTCOME_ORDER = ["failed", "skipped", "queued", "coalesced", "processed", "noted", "ignored"];

const label = (p: string) => PROVIDERS[p] ?? p;
const isWarn = (outcome: string) => outcome === "failed";

export function formatUkTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString("en-GB", {
      timeZone: "Europe/London",
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

export default function RecentWebhooks({ data }: { data: OpsRecentWebhooks }) {
  const providers = Object.keys(data.webhook_counts_24h).filter((p) =>
    Object.values(data.webhook_counts_24h[p]).some((n) => n > 0),
  );
  return (
    <div className={CARD} data-recent-webhooks>
      <p className={LABEL}>Last 24 hours</p>
      {providers.length === 0 ? (
        <p className={`${MUTED} mt-1`}>Nothing received in the last 24 hours.</p>
      ) : (
        <ul className="mt-1 space-y-1">
          {providers.map((p) => {
            const counts = data.webhook_counts_24h[p];
            const outcomes = OUTCOME_ORDER.filter((o) => (counts[o] ?? 0) > 0);
            return (
              <li key={p} className="text-sm text-slate-700 dark:text-slate-200">
                <span className="font-semibold">{label(p)}</span>{" "}
                {outcomes.map((o, i) => (
                  <span key={o} className={isWarn(o) ? WARN : "text-slate-500 dark:text-slate-400"}>
                    {i > 0 ? ", " : ""}
                    {counts[o]} {o}
                  </span>
                ))}
              </li>
            );
          })}
        </ul>
      )}
      {data.counts_truncated && <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Counts cover the most recent events only.</p>}
      <p className={`${LABEL} mt-4`}>Latest {data.recent_webhooks.length}</p>
      {data.recent_webhooks.length === 0 ? (
        <p className={`${MUTED} mt-1`}>No webhooks recorded yet.</p>
      ) : (
        <ul className="divide-y divide-slate-200 dark:divide-slate-700">
          {data.recent_webhooks.map((r, i) => (
            <li key={`${r.received_at}-${i}`} className="py-2">
              <p className="flex items-baseline justify-between gap-3 text-sm">
                <span className="min-w-0 truncate text-slate-900 dark:text-slate-100">
                  <span className="font-semibold">{label(r.provider)}</span>, {r.event_type}
                </span>
                <span className={`shrink-0 text-xs font-semibold ${isWarn(r.outcome) ? WARN : "text-slate-600 dark:text-slate-300"}`}>
                  {r.outcome}
                  {r.reason ? `, ${r.reason.replace(/_/g, " ")}` : ""}
                </span>
              </p>
              <p className="money mt-0.5 text-xs text-slate-500 dark:text-slate-400">{formatUkTime(r.received_at)}</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
