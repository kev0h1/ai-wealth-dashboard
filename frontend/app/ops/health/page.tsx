"use client";

// E6 slice 1: private platform health page for Kevin. Gated like /ops/go-live:
// the normal AuthProvider (this route is not in its public-page exemption
// list) plus a server-side owner check on GET /ops/health in
// backend/app/routers/ops.py. It shows only what existing data supports today:
// API and database reachability, the running release and environment, VPS
// memory, disk and load, LLM usage per pipeline, sync stats, and links into
// Sentry for grouped errors. Latency and error-rate metrics (slice 2) and
// alerts (slice 3, E8) have their own block. E7 (slice 2) adds one section per
// metrics collector (./sections.ts), each fetched on its own from
// GET /ops/health/collectors/{name} so a slow or unconfigured source shows
// "Timed out" or "Not configured" in its own block and blocks nothing else,
// plus 24 h and 7 d trends from the capped sample store. Each block loads on its own so
// one failing source never blanks the page. Nothing here is a secret: the
// DSN is never sent to the browser, only issue-view links built from the org
// and project slugs.

import { useEffect, useState } from "react";
import Link from "next/link";
import { api, type OpsAlert, type OpsAlerts, type OpsCollector, type OpsHealth, type OpsLlmUsage, type OpsSetting, type OpsSyncStats, type OpsTrends } from "@/lib/api";
import RecentWebhooks, { RECENT_WEBHOOKS_TITLE } from "./RecentWebhooks";
import RuntimeSettings, { RUNTIME_SETTINGS_TITLE, RUNTIME_SETTINGS_WORDING } from "./RuntimeSettings";
import { ALERTS_TITLE, ALERTS_WORDING, SECTIONS, TRENDS_TITLE, WORDING } from "./sections";

type Load<T> = { state: "loading" } | { state: "error" } | { state: "forbidden" } | { state: "ok"; data: T };

function useLoad<T>(fn: () => Promise<T>): Load<T> {
  const [result, setResult] = useState<Load<T>>({ state: "loading" });
  useEffect(() => {
    let cancelled = false;
    fn()
      .then((data) => { if (!cancelled) setResult({ state: "ok", data }); })
      .catch((e) => {
        if (cancelled) return;
        const message = e instanceof Error ? e.message : "";
        setResult({ state: message.startsWith("403") ? "forbidden" : "error" });
      });
    return () => { cancelled = true; };
    // fn is a stable api method reference.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return result;
}

const CARD = "glass-card rounded-3xl p-5";
const LABEL = "text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400";
const MUTED = "text-sm text-slate-500 dark:text-slate-400";
const OK = "text-emerald-700 dark:text-emerald-400";
const WARN = "text-amber-700 dark:text-amber-400";
const BAD = "text-red-700 dark:text-red-400";

function pctTone(pct: number | null): string {
  if (pct === null) return "text-slate-900 dark:text-slate-100";
  if (pct >= 90) return BAD;
  if (pct >= 75) return WARN;
  return "text-slate-900 dark:text-slate-100";
}

function Stat({ label, value, tone, hint }: { label: string; value: string; tone?: string; hint?: string }) {
  return (
    <div className="min-w-0">
      <p className={LABEL}>{label}</p>
      <p className={`money mt-1 text-xl font-bold ${tone ?? "text-slate-900 dark:text-slate-100"}`}>{value}</p>
      {hint && <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{hint}</p>}
    </div>
  );
}

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-6">
      <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-slate-700 dark:text-slate-200">{title}</h2>
      {children}
    </section>
  );
}

function Skeleton() {
  return <div className="h-24 rounded-3xl bg-slate-200 dark:bg-slate-700" aria-hidden="true" />;
}

function Unavailable({ what }: { what: string }) {
  return (
    <div className={CARD}>
      <p className={MUTED}>Couldn&apos;t load {what}. Try refreshing.</p>
    </div>
  );
}

function formatDate(iso?: string): string {
  if (!iso) return "unknown";
  try {
    return new Date(iso).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" });
  } catch {
    return iso;
  }
}

function HealthBlocks({ health }: { health: OpsHealth }) {
  const { build, memory, disk, load, mongo, sentry, uptime_hours, finexer_webhooks: fxw } = health;
  const loadPerCpu = load ? load.load_5m / load.cpus : null;
  return (
    <>
      <div className={`${CARD} mb-6`}>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Stat label="API" value="Reachable" tone={OK} />
          <Stat
            label="Database"
            value={mongo.ok ? "Reachable" : "Not responding"}
            tone={mongo.ok ? OK : BAD}
            hint={mongo.ok && mongo.ping_ms !== null ? `${mongo.ping_ms} ms` : undefined}
          />
          <Stat label="Environment" value={build.environment} />
          <Stat label="Release" value={build.release_short ?? "unknown"} hint={uptime_hours !== null ? `up ${uptime_hours} h` : undefined} />
        </div>
      </div>

      <Block title="This server">
        <div className={CARD}>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            <Stat
              label="Memory used"
              value={memory ? `${memory.used_pct}%` : "n/a"}
              tone={pctTone(memory?.used_pct ?? null)}
              hint={memory ? `${memory.available_mb} MB free of ${memory.total_mb}` : undefined}
            />
            <Stat
              label="Disk used"
              value={disk?.used_pct != null ? `${disk.used_pct}%` : "n/a"}
              tone={pctTone(disk?.used_pct ?? null)}
              hint={disk ? `${disk.free_gb} GB free of ${disk.total_gb}` : undefined}
            />
            <Stat
              label="Load (5 min)"
              value={load ? `${load.load_5m}` : "n/a"}
              tone={pctTone(loadPerCpu === null ? null : loadPerCpu * 100)}
              hint={load ? `${load.cpus} CPUs, 1 min ${load.load_1m}` : undefined}
            />
          </div>
        </div>
      </Block>

      <Block title="Errors">
        <div className={CARD}>
          {sentry.configured ? (
            <>
              <p className={MUTED}>Grouped errors, users affected and releases live in Sentry ({sentry.environment}).</p>
              <div className="mt-3 flex flex-wrap gap-2">
                {sentry.links.map((l) => (
                  <a
                    key={l.url}
                    href={l.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex min-h-11 items-center rounded-xl px-3 text-sm font-semibold text-indigo-600 dark:text-indigo-400"
                  >
                    Sentry issues: {l.label}
                  </a>
                ))}
              </div>
            </>
          ) : (
            <p className={MUTED}>
              Sentry is not linked yet. Set SENTRY_ORG and SENTRY_PROJECTS on this server to show the issue links here
              {build.sentry_dsn_set ? "." : ", and SENTRY_DSN to start collecting errors."}
            </p>
          )}
        </div>
      </Block>

      {fxw && (
        <Block title="Finexer webhooks">
          <div className={CARD}>
            <p className={`text-sm font-semibold ${fxw.authorized_consents > 0 && (fxw.minutes_ago === null || fxw.minutes_ago > fxw.stale_hours * 60) ? WARN : "text-slate-900 dark:text-slate-100"}`}>
              {fxw.line}
            </p>
            <div className="mt-3 grid grid-cols-2 gap-4 sm:grid-cols-4">
              <Stat label="Signing" value={fxw.signing_configured ? "Enforced" : "Not set"} tone={fxw.signing_configured ? OK : WARN} />
              <Stat label="Without webhook" value={`${fxw.consents_without_webhook}`} hint={`of ${fxw.authorized_consents} connected`} />
              <Stat label="API calls today" value={`${fxw.api_calls_today}`} hint={`yesterday ${fxw.api_calls_yesterday}`} />
              <Stat label="Syncs today" value={`${fxw.webhook_syncs_today} webhook`} hint={`${fxw.poll_syncs_today} polled`} />
            </div>
          </div>
        </Block>
      )}
    </>
  );
}

function LlmBlock({ usage }: { usage: OpsLlmUsage }) {
  const rows = usage.by_pipeline.slice(0, 8);
  return (
    <div className={CARD}>
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <p className={LABEL}>This month ({usage.month})</p>
        <p className="money text-sm font-semibold text-slate-900 dark:text-slate-100">
          ${usage.totals.cost_usd.toFixed(2)} across {usage.totals.calls} calls
        </p>
      </div>
      {rows.length === 0 ? (
        <p className={MUTED}>No model calls recorded yet this month.</p>
      ) : (
        <ul className="divide-y divide-slate-200 dark:divide-slate-700">
          {rows.map((r) => (
            <li key={r.pipeline} className="flex items-center justify-between gap-3 py-2 text-sm">
              <span className="min-w-0 truncate text-slate-700 dark:text-slate-200">{r.pipeline}</span>
              <span className="money shrink-0 text-slate-500 dark:text-slate-400">
                {r.calls} calls, {Math.round(r.avg_latency_ms)} ms
              </span>
              <span className="money w-16 shrink-0 text-right font-semibold text-slate-900 dark:text-slate-100">${r.cost_usd.toFixed(2)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function SyncBlock({ stats }: { stats: OpsSyncStats }) {
  const lr = stats.last_reconcile;
  const pending = stats.orphaned_revocations.pending;
  return (
    <div className={CARD}>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Stat
          label="Last reconcile"
          value={lr ? `${lr.reconciled ?? 0} synced` : "none yet"}
          hint={lr ? `${formatDate(lr.at)}, skipped ${(lr.skipped_fresh ?? 0) + (lr.skipped_on_upload ?? 0)}` : undefined}
        />
        <Stat
          label="Finexer requests"
          value={`${stats.finexer_requests.mean} avg`}
          hint={`max ${stats.finexer_requests.max} over ${stats.finexer_requests.count} connections`}
        />
        <Stat
          label="Pending revocations"
          value={`${pending}`}
          tone={pending > 0 ? WARN : OK}
          hint={pending > 0 ? "retried nightly" : "none waiting"}
        />
        <Stat label="Tips research" value={stats.tips_research.status} hint={stats.tips_research.line ?? undefined} />
      </div>
    </div>
  );
}


const statusTone = (status: OpsCollector["status"]) => (status === "crit" ? BAD : status === "warn" ? WARN : "text-slate-900 dark:text-slate-100");
const statusWord = (status: OpsCollector["status"]) => (status === "crit" ? "Needs attention" : status === "warn" ? "Watch" : status === "ok" ? "Healthy" : "Unknown");

const num = (v: unknown, digits = 0): string => (typeof v === "number" ? v.toFixed(digits) : "n/a");
const ms = (v: unknown): string => (typeof v === "number" ? `${Math.round(v)} ms` : "n/a");
const age = (h: unknown): string => {
  if (typeof h !== "number") return "n/a";
  return h < 1 ? `${Math.round(h * 60)} min` : h < 48 ? `${h.toFixed(1)} h` : `${(h / 24).toFixed(1)} d`;
};

// Own tone per stat (thresholds mirror backend/app/services/health/latency.py).
const p95Tone = (v: unknown): string | undefined => (typeof v !== "number" ? undefined : v >= 3000 ? BAD : v >= 1500 ? WARN : undefined);
const errorTone = (rate: unknown, count: unknown): string | undefined =>
  typeof rate !== "number" || typeof count !== "number" || count < 20 ? undefined : rate >= 0.1 ? BAD : rate >= 0.02 ? WARN : undefined;

function CollectorBody({ c }: { c: OpsCollector }) {
  const v = c.values;
  const tone = statusTone(c.status);
  switch (c.name) {
    case "api_latency":
      return (
        <>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Stat label="Requests (1 h)" value={num(v.count)} />
            <Stat label="p50" value={ms(v.p50_ms)} />
            <Stat label="p95" value={ms(v.p95_ms)} tone={p95Tone(v.p95_ms)} />
            <Stat label="Errors (5xx)" value={typeof v.error_rate === "number" ? `${(v.error_rate * 100).toFixed(1)}%` : "n/a"} tone={errorTone(v.error_rate, v.count)} />
          </div>
          {Array.isArray(v.routes) && v.routes.length > 0 && (
            <ul className="mt-4 divide-y divide-slate-200 dark:divide-slate-700">
              {v.routes.slice(0, 8).map((r: { route: string; count: number; p50_ms: number; p95_ms: number; error_rate: number }) => (
                <li key={r.route} className="flex items-center justify-between gap-3 py-2 text-xs">
                  <span className="min-w-0 truncate text-slate-700 dark:text-slate-200">{r.route}</span>
                  <span className="money shrink-0 text-slate-500 dark:text-slate-400">
                    {r.count} req, p50 {Math.round(r.p50_ms)}, p95 {Math.round(r.p95_ms)} ms
                    {r.error_rate > 0 ? `, ${(r.error_rate * 100).toFixed(0)}% errors` : ""}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </>
      );
    case "finexer_sync":
      return (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Stat label="Last reconcile" value={age(v.last_reconcile_age_h)} hint={v.reconciled != null ? `${v.reconciled} synced` : undefined} />
          <Stat label="Synced (24 h)" value={num(v.synced_24h)} />
          <Stat label="Failed (24 h)" value={num(v.failed_24h)} tone={v.failed_24h > 0 ? tone : undefined} />
          <Stat label="Pending revocations" value={num(v.pending_revocations)} tone={v.pending_revocations > 0 ? tone : undefined} />
          {typeof v.no_webhook_24h === "number" && <Stat label="No webhook (24 h)" value={num(v.no_webhook_24h)} tone={v.no_webhook_24h > 0 ? tone : undefined} />}
        </div>
      );
    case "worker":
      return (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Stat label="Queue depth" value={num(v.queue_depth)} tone={tone} />
          <Stat label="Oldest waiting" value={typeof v.oldest_queued_age_s === "number" ? age(v.oldest_queued_age_s / 3600) : "none"} />
          <Stat label="Running" value={num(v.running)} />
          <Stat label="Failed (recent)" value={num(v.failed_recent)} tone={v.failed_recent > 0 ? tone : undefined} hint={`of ${num(v.finished_recent)} finished`} />
        </div>
      );
    case "llm_tavily": {
      const t = v.tavily ?? {};
      return (
        <>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Stat label="Spend this month" value={`$${num(v.month_cost_usd, 2)}`} tone={tone} hint={v.budget_usd ? `budget $${num(v.budget_usd, 2)}` : undefined} />
            <Stat label="Spend this week" value={`$${num(v.week_cost_usd, 2)}`} />
            <Stat label="Tavily calls" value={`${num(t.calls_week)} wk`} hint={`${num(t.calls_month)} this month`} />
            <Stat label="Tavily quota" value={t.research_status === "failing" ? "Failing" : t.research_status === "ok" ? "Fine" : "Unknown"} tone={t.research_status === "failing" ? tone : undefined} hint={t.line ?? undefined} />
          </div>
          {Array.isArray(v.month_by_pipeline) && v.month_by_pipeline.length > 0 && (
            <ul className="mt-4 divide-y divide-slate-200 dark:divide-slate-700">
              {v.month_by_pipeline.slice(0, 6).map((p: { pipeline: string; calls: number; cost_usd: number }) => (
                <li key={p.pipeline} className="flex items-center justify-between gap-3 py-2 text-xs">
                  <span className="min-w-0 truncate text-slate-700 dark:text-slate-200">{p.pipeline}</span>
                  <span className="money shrink-0 text-slate-500 dark:text-slate-400">{p.calls} calls, ${p.cost_usd.toFixed(2)}</span>
                </li>
              ))}
            </ul>
          )}
        </>
      );
    }
    case "mongo":
      return (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Stat label="Stored" value={`${num(v.storage_mb, 1)} MB`} tone={tone} hint={v.limit_mb ? `of ${num(v.limit_mb)} MB` : undefined} />
          <Stat label="Indexes" value={`${num(v.index_mb, 1)} MB`} />
          <Stat label="Collections" value={num(v.collections)} />
          <Stat label="Slow queries (24 h)" value={typeof v.slow_queries_24h === "number" ? num(v.slow_queries_24h) : "profiler off"} tone={v.slow_queries_24h > 0 ? tone : undefined} />
        </div>
      );
    case "vps":
      return (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Stat label="Memory" value={typeof v.memory_used_pct === "number" ? `${v.memory_used_pct}%` : "n/a"} hint={v.memory_available_mb != null ? `${v.memory_available_mb} MB free` : undefined} />
          <Stat label="Disk" value={typeof v.disk_used_pct === "number" ? `${v.disk_used_pct}%` : "n/a"} />
          <Stat label="Load" value={typeof v.load_pct === "number" ? `${v.load_pct}%` : "n/a"} hint={v.cpus ? `${v.cpus} CPUs` : undefined} />
          <Stat label="Uptime" value={age(v.uptime_hours)} />
        </div>
      );
    case "railway":
      return (
        <>
          <p className={MUTED}>{v.project ? `${v.project}, ` : ""}{num(v.service_count)} services</p>
          <ul className="mt-2 divide-y divide-slate-200 dark:divide-slate-700">
            {(v.services ?? []).map((s: { service: string; status: string | null; age_hours: number | null }) => (
              <li key={s.service} className="flex items-center justify-between gap-3 py-2 text-sm">
                <span className="min-w-0 truncate text-slate-700 dark:text-slate-200">{s.service}</span>
                <span className={`money shrink-0 ${s.status === "FAILED" || s.status === "CRASHED" ? BAD : "text-slate-500 dark:text-slate-400"}`}>
                  {(s.status ?? "no deployment").toLowerCase()}, {age(s.age_hours)} ago
                </span>
              </li>
            ))}
          </ul>
        </>
      );
    case "vercel":
      return (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
          <Stat label="Latest deployment" value={(v.latest_state ?? "none").toLowerCase()} tone={tone} hint={v.latest_age_hours != null ? `${age(v.latest_age_hours)} ago` : undefined} />
          <Stat label="Deployments this month" value={`${num(v.deployments_month)}${v.deployments_month_capped ? "+" : ""}`} />
          <Stat label="Failed this month" value={num(v.errors_month)} />
        </div>
      );
    case "push":
      return (
        <div className="grid grid-cols-2 gap-4">
          <Stat label="Sent (24 h)" value={num(v.sent_24h)} />
          <Stat label="Failed (24 h)" value={num(v.failed_24h)} tone={v.failed_24h > 0 ? tone : undefined} />
        </div>
      );
    default:
      return null;
  }
}

function CollectorBlock({ section }: { section: (typeof SECTIONS)[number] }) {
  const res = useLoad(() => api.getOpsCollector(section.key));
  return (
    <Block title={section.title}>
      {res.state === "loading" && <Skeleton />}
      {(res.state === "error" || res.state === "forbidden") && <Unavailable what={section.title.toLowerCase()} />}
      {res.state === "ok" && (
        <div className={CARD}>
          {res.data.state === "ok" ? (
            <>
              <p className={`${LABEL} mb-3`}>
                <span className={statusTone(res.data.status)}>{statusWord(res.data.status)}</span>
              </p>
              <CollectorBody c={res.data} />
            </>
          ) : (
            <p className={MUTED}>
              {res.data.state === "timed_out" && `${WORDING.timedOut}. ${res.data.note ?? ""}`}
              {res.data.state === "not_configured" && (res.data.note ?? `${WORDING.notConfigured}.`)}
              {res.data.state === "omitted" && `${WORDING.omitted}. ${res.data.note ?? ""}`}
              {res.data.state === "error" && `${WORDING.failed} this source. ${res.data.note ?? ""}`}
            </p>
          )}
          {res.data.state === "ok" && res.data.note && <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">{res.data.note}</p>}
        </div>
      )}
    </Block>
  );
}

function TrendsBlock({ trends }: { trends: OpsTrends }) {
  const rows = Object.entries(trends.metrics);
  const fmt = (n: number | null, unit: string) => (n === null ? "n/a" : `${Number.isInteger(n) ? n : n.toFixed(1)} ${unit}`.trim());
  return (
    <div className={CARD}>
      {rows.length === 0 ? (
        <p className={MUTED}>No samples yet. The worker records one every 5 minutes.</p>
      ) : (
        <ul className="divide-y divide-slate-200 dark:divide-slate-700">
          {rows.map(([key, m]) => (
            <li key={key} className="py-3">
              <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">{m.label}</p>
              {(["h24", "d7"] as const).map((w) => (
                <p key={w} className="money mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                  {w === "h24" ? "24 h" : "7 d"}:{" "}
                  {m[w].n === 0 ? "no samples yet" : `min ${fmt(m[w].min, m.unit)}, avg ${fmt(m[w].avg, m.unit)}, max ${fmt(m[w].max, m.unit)}`}
                </p>
              ))}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function AlertRow({ a, history }: { a: OpsAlert; history?: boolean }) {
  const tone = a.state === "resolved" ? OK : a.severity === "crit" ? BAD : WARN;
  const word = a.state === "resolved" ? "Resolved" : a.severity === "crit" ? "Critical" : "Warning";
  return (
    <li className="py-3">
      <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">
        <span className={tone}>{word}</span>, {a.title ?? a.key}
      </p>
      {a.body && <p className="mt-0.5 text-sm text-slate-600 dark:text-slate-300">{a.body}</p>}
      <p className="money mt-0.5 text-xs text-slate-500 dark:text-slate-400">
        {history && a.state === "resolved" && a.resolved_at
          ? `Resolved ${formatDate(a.resolved_at)}`
          : `Since ${formatDate(a.first_seen ?? undefined)}`}
        {a.last_notified ? `, notified ${formatDate(a.last_notified)}` : ""}
      </p>
    </li>
  );
}

function AlertsBlock({ alerts }: { alerts: OpsAlerts }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function sendTest() {
    setBusy(true);
    setMessage(null);
    try {
      const res = await api.sendOpsTestAlert();
      if (res.throttled) setMessage(ALERTS_WORDING.testThrottled);
      else if (res.sent) setMessage(ALERTS_WORDING.testSent);
      else setMessage(res.note ?? ALERTS_WORDING.testFailed);
    } catch {
      setMessage(ALERTS_WORDING.testFailed);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={CARD}>
      {!alerts.enabled && <p className={`${MUTED} mb-3`}>{ALERTS_WORDING.off}</p>}
      <p className={LABEL}>Open</p>
      {alerts.open.length === 0 ? (
        <p className={`${MUTED} mt-1`}>{ALERTS_WORDING.none}</p>
      ) : (
        <ul className="divide-y divide-slate-200 dark:divide-slate-700">
          {alerts.open.map((a) => <AlertRow key={a.key} a={a} />)}
        </ul>
      )}
      <p className={`${LABEL} mt-4`}>Last 24 hours</p>
      {alerts.history.length === 0 ? (
        <p className={`${MUTED} mt-1`}>{ALERTS_WORDING.noHistory}</p>
      ) : (
        <ul className="divide-y divide-slate-200 dark:divide-slate-700">
          {alerts.history.map((a) => <AlertRow key={a.key} a={a} history />)}
        </ul>
      )}
      {alerts.config && (
        <p className="mt-4 text-xs text-slate-500 dark:text-slate-400">
          One alert per issue every {alerts.config.cooldown_hours} h, at most {alerts.config.hourly_cap} an hour.
        </p>
      )}
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={sendTest}
          disabled={busy}
          className="min-h-11 rounded-2xl border border-slate-300 px-4 text-sm font-semibold text-slate-800 disabled:opacity-60 dark:border-slate-600 dark:text-slate-100"
        >
          {ALERTS_WORDING.testButton}
        </button>
        {message && <p role="status" className="text-sm text-slate-600 dark:text-slate-300">{message}</p>}
      </div>
    </div>
  );
}

function SettingsBlock() {
  const [rows, setRows] = useState<OpsSetting[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api.getOpsSettings()
      .then((r) => { if (!cancelled) setRows(r.settings); })
      .catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; };
  }, []);

  const apply = async (key: string, run: () => Promise<OpsSetting>) => {
    setBusyKey(key);
    setMessage(null);
    try {
      const next = await run();
      setRows((cur) => (cur ?? []).map((r) => (r.key === key ? next : r)));
      setMessage(RUNTIME_SETTINGS_WORDING.saved);
    } catch (e) {
      const detail = e instanceof Error ? e.message.replace(/^\d+:?\s*/, "") : "";
      setMessage(detail ? `${RUNTIME_SETTINGS_WORDING.failed} ${detail}` : RUNTIME_SETTINGS_WORDING.failed);
    } finally {
      setBusyKey(null);
    }
  };

  if (failed) return <Unavailable what="runtime settings" />;
  if (rows === null) return <Skeleton />;
  return (
    <RuntimeSettings
      rows={rows}
      busyKey={busyKey}
      message={message}
      onSave={(key, value, confirm) => apply(key, () => api.putOpsSetting(key, value, confirm))}
      onClear={(key) => apply(key, () => api.clearOpsSetting(key))}
    />
  );
}

export default function OpsHealthPage() {
  const health = useLoad(api.getOpsHealth);
  const llm = useLoad(api.getOpsLlmUsage);
  const sync = useLoad(api.getOpsSyncStats);
  const trends = useLoad(api.getOpsTrends);
  const alerts = useLoad(api.getOpsAlerts);
  const webhooks = useLoad(api.getOpsRecentWebhooks);

  if (health.state === "forbidden") {
    return (
      <main className="flex min-h-dvh items-center justify-center bg-[#f0f2f7] px-6 dark:bg-[#0f172a]">
        <p className="text-sm text-slate-500 dark:text-slate-400">This page is for the account owner.</p>
      </main>
    );
  }

  return (
    <main className="min-h-dvh bg-[#f0f2f7] px-6 py-10 dark:bg-[#0f172a] xl:px-10">
      <div className="mx-auto max-w-2xl">
        <header className="mb-6">
          <h1 className="text-xl font-bold text-slate-900 dark:text-slate-100">Platform health</h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            What this server can see today. Each section loads on its own.
          </p>
          <Link href="/ops/go-live" className="mt-2 inline-block text-xs font-semibold text-indigo-600 dark:text-indigo-400">
            Go-live readiness
          </Link>
        </header>

        {health.state === "loading" && <Skeleton />}
        {health.state === "error" && <Unavailable what="server health" />}
        {health.state === "ok" && <HealthBlocks health={health.data} />}

        <Block title={RECENT_WEBHOOKS_TITLE}>
          {webhooks.state === "loading" && <Skeleton />}
          {(webhooks.state === "error" || webhooks.state === "forbidden") && <Unavailable what="recent webhooks" />}
          {webhooks.state === "ok" && <RecentWebhooks data={webhooks.data} />}
        </Block>

        <Block title="Model usage">
          {llm.state === "loading" && <Skeleton />}
          {(llm.state === "error" || llm.state === "forbidden") && <Unavailable what="model usage" />}
          {llm.state === "ok" && <LlmBlock usage={llm.data} />}
        </Block>

        <Block title="Bank sync">
          {sync.state === "loading" && <Skeleton />}
          {(sync.state === "error" || sync.state === "forbidden") && <Unavailable what="sync stats" />}
          {sync.state === "ok" && <SyncBlock stats={sync.data} />}
        </Block>

        {SECTIONS.map((section) => (
          <CollectorBlock key={section.key} section={section} />
        ))}

        <Block title={ALERTS_TITLE}>
          {alerts.state === "loading" && <Skeleton />}
          {(alerts.state === "error" || alerts.state === "forbidden") && <Unavailable what="alerts" />}
          {alerts.state === "ok" && <AlertsBlock alerts={alerts.data} />}
        </Block>

        <Block title={RUNTIME_SETTINGS_TITLE}>
          <SettingsBlock />
        </Block>

        <Block title={TRENDS_TITLE}>
          {trends.state === "loading" && <Skeleton />}
          {(trends.state === "error" || trends.state === "forbidden") && <Unavailable what="trends" />}
          {trends.state === "ok" && <TrendsBlock trends={trends.data} />}
        </Block>
      </div>
    </main>
  );
}
