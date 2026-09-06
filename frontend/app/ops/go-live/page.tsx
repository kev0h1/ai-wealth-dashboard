"use client";

// Private go-live readiness page. Gated by the normal AuthProvider (see
// components/AuthProvider.tsx — this route is not in its /design, /terms,
// /privacy public-page exemption list) plus a server-side owner check in
// backend/app/routers/ops.py (GET /ops/go-live 403s for anyone but the
// account owner). Not linked from any nav; bookmark the URL.
//
// TODO.md and the Finexer compliance doc stay the source of truth — other
// sessions edit them directly. This page only reads and renders them; there
// is no editing UI here on purpose.

import { useEffect, useMemo, useState } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import { Check, ChevronDown, Copy, Square, SquareCheck } from "lucide-react";
import { api, type GoLiveResponse } from "@/lib/api";
import { LegalTable, splitMarkdownIntoSegments } from "@/components/LegalDocument";
import {
  parseComplianceMarkdown,
  parseTodoMarkdown,
  stripKevinMarkers,
  todoTotals,
  type GoLiveQuestion,
  type GoLiveStatus,
  type GoLiveTodoSection,
} from "@/lib/goLive";

const STATUS_LABEL: Record<GoLiveStatus, string> = {
  ready: "Ready",
  "needs-kevin": "Needs Kevin",
  "blocked-deploy": "Blocked on deploy",
  submitted: "Submitted",
  unknown: "Unknown",
};

/** Small "(SRT-12)" tag next to an item or question. Links to the Jira
 *  issue when the backend has a jira_base_url (from `.jira.env`, see
 *  GET /ops/go-live); otherwise renders as plain text since there is
 *  nowhere useful to link to yet. */
function JiraKeyTag({ jiraKey, jiraBaseUrl }: { jiraKey?: string; jiraBaseUrl: string | null }) {
  if (!jiraKey) return null;
  if (jiraBaseUrl) {
    return (
      <a
        href={`${jiraBaseUrl.replace(/\/$/, "")}/browse/${jiraKey}`}
        target="_blank"
        rel="noreferrer"
        className="money ml-1.5 shrink-0 text-[11px] font-semibold text-indigo-600 underline underline-offset-2 hover:text-indigo-700 dark:text-indigo-400 dark:hover:text-indigo-300"
      >
        {jiraKey}
      </a>
    );
  }
  return <span className="money ml-1.5 shrink-0 text-[11px] font-semibold text-slate-400 dark:text-slate-500">{jiraKey}</span>;
}

function formatUpdatedAt(iso: string): string {
  try {
    return new Date(iso).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" });
  } catch {
    return iso;
  }
}

function StatusPill({ status }: { status: GoLiveStatus }) {
  const tone =
    status === "needs-kevin" || status === "blocked-deploy"
      ? "bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-200"
      : "bg-slate-100 text-slate-600 dark:bg-slate-700/70 dark:text-slate-300";
  return (
    <span className={`inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${tone}`}>
      {STATUS_LABEL[status]}
    </span>
  );
}

function SummaryChip({ label, count, amber }: { label: string; count: number; amber: boolean }) {
  const tone = amber
    ? "bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-200"
    : "bg-slate-100 text-slate-600 dark:bg-slate-700/70 dark:text-slate-300";
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold ${tone}`}>
      <span className="money">{count}</span>
      {label}
    </span>
  );
}

function QuestionnaireSummary({ questions }: { questions: GoLiveQuestion[] }) {
  const counts = questions.reduce<Record<GoLiveStatus, number>>(
    (acc, q) => ({ ...acc, [q.status]: (acc[q.status] ?? 0) + 1 }),
    { ready: 0, "needs-kevin": 0, "blocked-deploy": 0, submitted: 0, unknown: 0 }
  );
  return (
    <div className="flex flex-wrap gap-2">
      <SummaryChip label="Ready" count={counts.ready} amber={false} />
      <SummaryChip label="Needs Kevin" count={counts["needs-kevin"]} amber={counts["needs-kevin"] > 0} />
      <SummaryChip label="Blocked on deploy" count={counts["blocked-deploy"]} amber={counts["blocked-deploy"] > 0} />
      <SummaryChip label="Submitted" count={counts.submitted} amber={false} />
    </div>
  );
}

function QuestionCard({ question, jiraBaseUrl }: { question: GoLiveQuestion; jiraBaseUrl: string | null }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const charCount = question.answer.length;
  const overLimit = charCount >= 1900;

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(stripKevinMarkers(question.answer));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard API unavailable (e.g. insecure context) — no-op, the
      // answer is still readable and selectable in the pre block below.
    }
  }

  return (
    <div className="glass-card rounded-2xl p-4">
      <div className="flex items-start justify-between gap-3">
        <h3 className="text-sm font-semibold text-pretty text-slate-800 dark:text-slate-100">{question.title}</h3>
        <span className="flex shrink-0 items-center">
          <StatusPill status={question.status} />
          <JiraKeyTag jiraKey={question.jiraKey} jiraBaseUrl={jiraBaseUrl} />
        </span>
      </div>

      <p className={`money mt-2 text-[11px] font-semibold ${overLimit ? "text-amber-600 dark:text-amber-400" : "text-slate-400 dark:text-slate-500"}`}>
        {charCount.toLocaleString("en-GB")} / 2,000
      </p>

      {question.kevinMarkers.length > 0 && (
        <div className="mt-3 space-y-2">
          {question.kevinMarkers.map((marker, idx) => (
            <p
              key={idx}
              className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-relaxed text-pretty text-amber-800 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200"
            >
              {marker.replace(/^\[KEVIN:\s*/, "").replace(/\]$/, "")}
            </p>
          ))}
        </div>
      )}

      <details
        className="group mt-3"
        open={open}
        onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}
      >
        <summary className="flex min-h-9 cursor-pointer list-none items-center gap-1.5 text-xs font-semibold text-indigo-600 hover:text-indigo-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:text-indigo-400 dark:hover:text-indigo-300 [&::-webkit-details-marker]:hidden">
          {open ? "Hide answer" : "Show answer"}
          <ChevronDown size={15} className="shrink-0 transition-transform group-open:rotate-180" aria-hidden="true" />
        </summary>
        <pre className="mt-2 whitespace-pre-wrap rounded-xl bg-slate-50 p-3 text-xs leading-relaxed text-pretty text-slate-600 dark:bg-slate-800/60 dark:text-slate-300">
          {question.answer}
        </pre>
        <button
          type="button"
          onClick={handleCopy}
          className="mt-2 inline-flex min-h-9 items-center gap-1.5 rounded-lg px-2 text-xs font-semibold text-indigo-600 hover:text-indigo-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:text-indigo-400 dark:hover:text-indigo-300"
        >
          {copied ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}
          {copied ? "Copied" : "Copy answer"}
        </button>
      </details>
    </div>
  );
}

const inlineMdComponents: Components = {
  p: ({ children }) => <>{children}</>,
  strong: ({ children }) => <strong className="font-semibold text-slate-800 dark:text-slate-100">{children}</strong>,
  code: ({ children }) => (
    <code className="rounded bg-slate-100 px-1 py-0.5 font-mono text-[0.85em] dark:bg-slate-700/70">{children}</code>
  ),
  a: ({ children, href }) => (
    <a
      href={href}
      className="text-indigo-600 underline underline-offset-2 hover:text-indigo-700 dark:text-indigo-400 dark:hover:text-indigo-300"
    >
      {children}
    </a>
  ),
};

function TodoItemRow({
  item,
  jiraBaseUrl,
}: {
  item: { text: string; done: boolean; jiraKey?: string };
  jiraBaseUrl: string | null;
}) {
  const Icon = item.done ? SquareCheck : Square;
  return (
    <li className="flex items-start gap-2.5 py-1.5">
      <Icon size={16} className="mt-0.5 shrink-0 text-slate-400 dark:text-slate-500" aria-hidden="true" />
      <span
        className={`flex flex-wrap items-baseline text-sm leading-6 text-pretty ${
          item.done ? "text-slate-400 line-through dark:text-slate-500" : "text-slate-700 dark:text-slate-200"
        }`}
      >
        <ReactMarkdown components={inlineMdComponents}>{item.text}</ReactMarkdown>
        <JiraKeyTag jiraKey={item.jiraKey} jiraBaseUrl={jiraBaseUrl} />
      </span>
    </li>
  );
}

function TodoSectionCard({
  section,
  defaultOpen,
  jiraBaseUrl,
}: {
  section: GoLiveTodoSection;
  defaultOpen: boolean;
  jiraBaseUrl: string | null;
}) {
  const total = section.items.length;
  const done = section.items.filter((item) => item.done).length;
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;

  return (
    <details className="group glass-card rounded-2xl p-4" open={defaultOpen}>
      <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 [&::-webkit-details-marker]:hidden">
        <span className="text-sm font-semibold text-pretty text-slate-800 dark:text-slate-100">{section.title}</span>
        <span className="flex shrink-0 items-center gap-2">
          <span className="money text-xs font-semibold text-slate-500 dark:text-slate-400">
            {done} / {total}
          </span>
          <ChevronDown size={17} className="shrink-0 text-slate-400 transition-transform group-open:rotate-180" aria-hidden="true" />
        </span>
      </summary>
      <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-700">
        <div className="h-full rounded-full bg-indigo-500" style={{ width: `${pct}%` }} />
      </div>
      <ul className="mt-3 divide-y divide-slate-100 dark:divide-white/10">
        {section.items.map((item, idx) => (
          <TodoItemRow key={idx} item={item} jiraBaseUrl={jiraBaseUrl} />
        ))}
      </ul>
    </details>
  );
}

export default function GoLivePage() {
  const [data, setData] = useState<GoLiveResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [forbidden, setForbidden] = useState(false);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await api.getGoLive();
        if (!cancelled) setData(res);
      } catch (e) {
        if (cancelled) return;
        const message = e instanceof Error ? e.message : "";
        if (message.startsWith("403")) setForbidden(true);
        else setError(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const questions = useMemo(
    () => (data?.files.compliance ? parseComplianceMarkdown(data.files.compliance.markdown) : []),
    [data]
  );
  const todoSections = useMemo(
    () => (data?.files.todo ? parseTodoMarkdown(data.files.todo.markdown) : []),
    [data]
  );
  const { done, total } = useMemo(() => todoTotals(todoSections), [todoSections]);
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  const pricingSegments = useMemo(
    () => (data?.files.pricing ? splitMarkdownIntoSegments(data.files.pricing.markdown) : []),
    [data]
  );
  const jiraBaseUrl = data?.jira_base_url ?? null;

  if (forbidden) {
    return (
      <main className="flex min-h-dvh items-center justify-center bg-[#f0f2f7] px-6 dark:bg-[#0f172a]">
        <p className="text-sm text-slate-500 dark:text-slate-400">This page is for the account owner.</p>
      </main>
    );
  }

  if (loading) {
    return (
      <main className="min-h-dvh bg-[#f0f2f7] px-6 py-10 dark:bg-[#0f172a]">
        <div className="mx-auto max-w-2xl space-y-4">
          <div className="h-7 w-56 animate-pulse rounded-lg bg-slate-200 dark:bg-slate-700" />
          <div className="h-28 animate-pulse rounded-3xl bg-slate-200 dark:bg-slate-700" />
        </div>
      </main>
    );
  }

  if (error || !data) {
    return (
      <main className="flex min-h-dvh items-center justify-center bg-[#f0f2f7] px-6 dark:bg-[#0f172a]">
        <p className="text-sm text-slate-500 dark:text-slate-400">Couldn&apos;t load go-live readiness. Try refreshing.</p>
      </main>
    );
  }

  return (
    <main className="min-h-dvh bg-[#f0f2f7] px-6 py-10 dark:bg-[#0f172a]">
      <div className="mx-auto max-w-2xl">
        <header className="mb-8">
          <h1 className="text-xl font-bold text-slate-900 dark:text-slate-100">Go-live readiness</h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Finexer production access: 1 Oct 2026</p>

          <div className="mt-5 glass-hero rounded-3xl p-5">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Backlog progress</p>
            <p className="money mt-1 text-3xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
              {done} of {total} done
            </p>
            <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-700">
              <div className="h-full rounded-full bg-indigo-500" style={{ width: `${pct}%` }} />
            </div>
          </div>
        </header>

        {questions.length > 0 && (
          <section className="mb-8">
            <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-slate-700 dark:text-slate-200">Questionnaire</h2>
            <div className="mb-4">
              <QuestionnaireSummary questions={questions} />
            </div>
            <div className="space-y-3">
              {questions.map((q) => (
                <QuestionCard key={q.id} question={q} jiraBaseUrl={jiraBaseUrl} />
              ))}
            </div>
          </section>
        )}

        {todoSections.length > 0 && (
          <section className="mb-8">
            <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-slate-700 dark:text-slate-200">Backlog</h2>
            <div className="space-y-3">
              {todoSections.map((section, idx) => (
                <TodoSectionCard key={section.id} section={section} defaultOpen={idx === 0} jiraBaseUrl={jiraBaseUrl} />
              ))}
            </div>
          </section>
        )}

        {data.files.pricing && (
          <section className="mb-8">
            <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-slate-700 dark:text-slate-200">Reference</h2>
            <details className="group glass-card rounded-2xl p-4">
              <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 [&::-webkit-details-marker]:hidden">
                <span className="text-sm font-semibold text-slate-800 dark:text-slate-100">Pricing and unit economics</span>
                <ChevronDown size={17} className="shrink-0 text-slate-400 transition-transform group-open:rotate-180" aria-hidden="true" />
              </summary>
              <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">Last updated {formatUpdatedAt(data.files.pricing.updated_at)}</p>
              <article className="mt-3">
                {pricingSegments.map((segment, index) =>
                  segment.type === "table" ? (
                    <LegalTable key={index} headers={segment.headers} rows={segment.rows} />
                  ) : (
                    <ReactMarkdown key={index}>{segment.content}</ReactMarkdown>
                  )
                )}
              </article>
            </details>
          </section>
        )}

        <footer className="border-t border-slate-200 pt-4 dark:border-white/10">
          <p className="text-xs text-slate-400 dark:text-slate-500">
            Source of truth: TODO.md and docs/ in the repo. Tick items there, this page only reads them.
          </p>
        </footer>
      </div>
    </main>
  );
}
