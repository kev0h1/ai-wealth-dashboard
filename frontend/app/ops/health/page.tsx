"use client";

// E6 slice 1: private platform health page for Kevin. Gated like /ops/go-live:
// the normal AuthProvider (this route is not in its public-page exemption
// list) plus a server-side owner check on GET /ops/health in
// backend/app/routers/ops.py. It shows only what existing data supports today:
// API and database reachability, the running release and environment, VPS
// memory, disk and load, LLM usage per pipeline, sync stats, and links into
// Sentry for grouped errors. Latency and error-rate metrics (slice 2) and
// alerts (slice 3) are tracked on the board. Each block loads on its own so
// one failing source never blanks the page. Nothing here is a secret: the
// DSN is never sent to the browser, only issue-view links built from the org
// and project slugs.

import { useEffect, useState } from "react";
import Link from "next/link";
import { api, type OpsHealth, type OpsLlmUsage, type OpsSyncStats } from "@/lib/api";

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

export default function OpsHealthPage() {
  const health = useLoad(api.getOpsHealth);
  const llm = useLoad(api.getOpsLlmUsage);
  const sync = useLoad(api.getOpsSyncStats);

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
            What this server can see today. Latency, error rates and alerts follow in later slices.
          </p>
          <Link href="/ops/go-live" className="mt-2 inline-block text-xs font-semibold text-indigo-600 dark:text-indigo-400">
            Go-live readiness
          </Link>
        </header>

        {health.state === "loading" && <Skeleton />}
        {health.state === "error" && <Unavailable what="server health" />}
        {health.state === "ok" && <HealthBlocks health={health.data} />}

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
      </div>
    </main>
  );
}
