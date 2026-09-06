"use client";

// Private go-live board. Gated by the normal AuthProvider (see
// components/AuthProvider.tsx — this route is not in its /design, /terms,
// /privacy public-page exemption list) plus a server-side owner check in
// backend/app/routers/ops.py (GET/POST /ops/go-live 403s for anyone but
// the account owner).
//
// TODO.md and the Finexer compliance doc stay the source of truth, but
// this page can now write to them too: every action below goes through
// backend/app/services/backlog.py (atomic write, file lock, best-effort
// git commit + push of just that file) and the response is the full
// refreshed board, so the page always re-renders from what actually
// landed on disk rather than guessing at the new state. Never tick an
// item by hand outside this page or `scripts/backlog.py` — see
// docs/ops/BACKLOG.md.

import { useCallback, useEffect, useMemo, useState } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import { Check, ChevronDown, Copy, MoreHorizontal, Square, SquareCheck } from "lucide-react";
import { api, type GoLiveActionResponse, type GoLiveResponse } from "@/lib/api";
import { LegalTable, splitMarkdownIntoSegments } from "@/components/LegalDocument";
import {
  groupItemsBySection,
  itemTotals,
  stripKevinMarkers,
  type GoLiveItem,
  type GoLiveItemState,
  type GoLiveOwner,
  type GoLiveQuestion,
  type GoLiveStatus,
} from "@/lib/goLive";

const STATUS_LABEL: Record<GoLiveStatus, string> = {
  ready: "Ready",
  "needs-kevin": "Needs Kevin",
  "blocked-deploy": "Blocked on deploy",
  submitted: "Submitted",
};
const STATUS_OPTIONS: GoLiveStatus[] = ["needs-kevin", "ready", "blocked-deploy", "submitted"];

function formatUpdatedAt(iso: string): string {
  try {
    return new Date(iso).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" });
  } catch {
    return iso;
  }
}

function formatDoneDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
  } catch {
    return iso;
  }
}

type SaveNote = { ok: boolean; text: string } | null;

/** Quiet inline save indicator — never a toast, never blocking. */
function SaveIndicator({ note }: { note: SaveNote }) {
  if (!note) return null;
  return (
    <p
      className={`money mt-1.5 text-[11px] font-semibold ${
        note.ok ? "text-slate-400 dark:text-slate-500" : "text-amber-600 dark:text-amber-400"
      }`}
    >
      {note.text}
    </p>
  );
}

function StatePill({ item }: { item: GoLiveItem }) {
  if (item.state === "todo") return null;
  if (item.state === "in-progress") {
    return (
      <span className="inline-flex shrink-0 items-center rounded-full bg-indigo-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-300">
        In progress
      </span>
    );
  }
  if (item.state === "blocked") {
    return (
      <span className="inline-flex max-w-[220px] shrink-0 items-center truncate rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
        Blocked{item.reason ? `: ${item.reason}` : ""}
      </span>
    );
  }
  // done
  const short = item.commit ? item.commit.slice(0, 7) : null;
  return (
    <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
      Done{item.done_at ? ` ${formatDoneDate(item.done_at)}` : ""}
      {short ? ` · ${short}` : ""}
    </span>
  );
}

function OwnerToggle({
  owner,
  disabled,
  onToggle,
}: {
  owner: GoLiveOwner | null;
  disabled: boolean;
  onToggle: (next: GoLiveOwner) => void;
}) {
  const current: GoLiveOwner = owner ?? "claude";
  const label = current === "kevin" ? "Kevin" : "Claude";
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => onToggle(current === "kevin" ? "claude" : "kevin")}
      className="inline-flex min-h-9 shrink-0 items-center rounded-full border border-slate-200 px-2.5 text-[11px] font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-50 dark:border-white/10 dark:text-slate-300 dark:hover:bg-white/5"
      title="Tap to reassign owner"
    >
      {label}
    </button>
  );
}

function ItemMenu({
  item,
  disabled,
  onStart,
  onBlock,
  onNote,
}: {
  item: GoLiveItem;
  disabled: boolean;
  onStart: () => void;
  onBlock: (reason: string) => void;
  onNote: (text: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"menu" | "block" | "note">("menu");
  const [draft, setDraft] = useState("");

  function closeAll() {
    setOpen(false);
    setMode("menu");
    setDraft("");
  }

  if (item.state === "done") return null;

  return (
    <div className="relative">
      <button
        type="button"
        disabled={disabled}
        onClick={() => {
          setOpen((v) => !v);
          setMode("menu");
        }}
        aria-label="More actions"
        className="flex min-h-9 min-w-9 shrink-0 items-center justify-center rounded-full text-slate-400 hover:bg-slate-100 disabled:opacity-50 dark:text-slate-500 dark:hover:bg-white/5"
      >
        <MoreHorizontal size={16} aria-hidden="true" />
      </button>

      {open && mode === "menu" && (
        <div className="absolute right-0 top-10 z-10 w-40 rounded-xl border border-slate-200 bg-white p-1 shadow-lg dark:border-white/10 dark:bg-slate-800">
          {item.state !== "in-progress" && (
            <button
              type="button"
              onClick={() => {
                onStart();
                closeAll();
              }}
              className="flex min-h-9 w-full items-center rounded-lg px-2 text-left text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-white/5"
            >
              Start
            </button>
          )}
          <button
            type="button"
            onClick={() => setMode("block")}
            className="flex min-h-9 w-full items-center rounded-lg px-2 text-left text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-white/5"
          >
            Block
          </button>
          <button
            type="button"
            onClick={() => setMode("note")}
            className="flex min-h-9 w-full items-center rounded-lg px-2 text-left text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-white/5"
          >
            Note
          </button>
        </div>
      )}

      {open && (mode === "block" || mode === "note") && (
        <div className="absolute right-0 top-10 z-10 w-64 rounded-xl border border-slate-200 bg-white p-2.5 shadow-lg dark:border-white/10 dark:bg-slate-800">
          <label className="mb-1.5 block text-[11px] font-semibold text-slate-500 dark:text-slate-400">
            {mode === "block" ? "Reason for blocking" : "Note"}
          </label>
          <textarea
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={2}
            className="w-full resize-none rounded-lg border border-slate-200 bg-slate-50 p-2 text-xs text-slate-800 focus:border-indigo-400 focus:outline-none dark:border-white/10 dark:bg-slate-900 dark:text-slate-100"
          />
          <div className="mt-2 flex justify-end gap-2">
            <button
              type="button"
              onClick={closeAll}
              className="min-h-9 rounded-lg px-2.5 text-xs font-semibold text-slate-500 hover:bg-slate-50 dark:text-slate-400 dark:hover:bg-white/5"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={!draft.trim()}
              onClick={() => {
                if (mode === "block") onBlock(draft.trim());
                else onNote(draft.trim());
                closeAll();
              }}
              className="min-h-9 rounded-lg bg-indigo-600 px-2.5 text-xs font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
            >
              Save
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function ItemRow({
  item,
  pending,
  saveNote,
  onAction,
}: {
  item: GoLiveItem;
  pending: boolean;
  saveNote: SaveNote;
  onAction: (body: Parameters<typeof api.goLiveItemAction>[1]) => void;
}) {
  const done = item.state === "done";
  const Icon = done ? SquareCheck : Square;

  return (
    <li className="py-2.5">
      <div className="flex items-start gap-2">
        <button
          type="button"
          disabled={pending}
          onClick={() => onAction(done ? { action: "reopen" } : { action: "done" })}
          aria-label={done ? "Reopen item" : "Mark done"}
          className="flex min-h-11 min-w-11 shrink-0 items-center justify-center disabled:opacity-50"
        >
          <Icon
            size={18}
            className={done ? "text-emerald-500" : "text-slate-400 dark:text-slate-500"}
            aria-hidden="true"
          />
        </button>

        <div className="min-w-0 flex-1 pt-2.5">
          <div className="flex flex-wrap items-center gap-1.5">
            <span
              className={`text-sm font-semibold text-pretty ${
                done ? "text-slate-400 line-through dark:text-slate-500" : "text-slate-800 dark:text-slate-100"
              }`}
            >
              {item.id}. {item.title}
            </span>
            <StatePill item={item} />
          </div>
          {item.text && (
            <p
              className={`mt-0.5 text-xs leading-relaxed text-pretty ${
                done ? "text-slate-400 dark:text-slate-500" : "text-slate-600 dark:text-slate-300"
              }`}
            >
              {item.text}
            </p>
          )}
          {item.notes.length > 0 && (
            <ul className="mt-1.5 space-y-1">
              {item.notes.map((note, idx) => (
                <li key={idx} className="text-[11px] leading-relaxed text-slate-400 dark:text-slate-500">
                  <span className="money font-semibold">{note.date}</span> ({note.actor}): {note.text}
                </li>
              ))}
            </ul>
          )}
          <SaveIndicator note={saveNote} />
        </div>

        <div className="flex shrink-0 items-center gap-1.5 pt-1.5">
          <OwnerToggle
            owner={item.owner}
            disabled={pending}
            onToggle={(owner) => onAction({ action: "owner", owner })}
          />
          <ItemMenu
            item={item}
            disabled={pending}
            onStart={() => onAction({ action: "start" })}
            onBlock={(reason) => onAction({ action: "block", reason })}
            onNote={(text) => onAction({ action: "note", text })}
          />
        </div>
      </div>
    </li>
  );
}

function SectionCard({
  heading,
  items,
  defaultOpen,
  pendingIds,
  saveNotes,
  onAction,
}: {
  heading: string;
  items: GoLiveItem[];
  defaultOpen: boolean;
  pendingIds: Set<string>;
  saveNotes: Record<string, SaveNote>;
  onAction: (itemId: string, body: Parameters<typeof api.goLiveItemAction>[1]) => void;
}) {
  const total = items.length;
  const done = items.filter((item) => item.state === "done").length;
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;

  return (
    <details className="group glass-card rounded-2xl p-4" open={defaultOpen}>
      <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 [&::-webkit-details-marker]:hidden">
        <span className="text-sm font-semibold text-pretty text-slate-800 dark:text-slate-100">{heading}</span>
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
      <ul className="mt-1 divide-y divide-slate-100 dark:divide-white/10">
        {items.map((item) => (
          <ItemRow
            key={item.id}
            item={item}
            pending={pendingIds.has(item.id)}
            saveNote={saveNotes[item.id] ?? null}
            onAction={(body) => onAction(item.id, body)}
          />
        ))}
      </ul>
    </details>
  );
}

function QuestionStatusControl({
  status,
  disabled,
  onChange,
}: {
  status: GoLiveStatus;
  disabled: boolean;
  onChange: (status: GoLiveStatus) => void;
}) {
  return (
    <select
      value={status}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value as GoLiveStatus)}
      className="min-h-9 shrink-0 rounded-full border border-slate-200 bg-white px-2.5 text-[11px] font-bold uppercase tracking-wide text-slate-600 disabled:opacity-50 dark:border-white/10 dark:bg-slate-800 dark:text-slate-300"
    >
      {STATUS_OPTIONS.map((s) => (
        <option key={s} value={s}>
          {STATUS_LABEL[s]}
        </option>
      ))}
    </select>
  );
}

const inlineMdComponents: Components = {
  p: ({ children }) => <>{children}</>,
  strong: ({ children }) => <strong className="font-semibold text-slate-800 dark:text-slate-100">{children}</strong>,
  code: ({ children }) => (
    <code className="rounded bg-slate-100 px-1 py-0.5 font-mono text-[0.85em] dark:bg-slate-700/70">{children}</code>
  ),
};

function QuestionCard({
  question,
  pending,
  saveNote,
  onStatusChange,
}: {
  question: GoLiveQuestion;
  pending: boolean;
  saveNote: SaveNote;
  onStatusChange: (status: GoLiveStatus) => void;
}) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const overLimit = question.chars >= 1900;

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
        <h3 className="text-sm font-semibold text-pretty text-slate-800 dark:text-slate-100">
          <ReactMarkdown components={inlineMdComponents}>{question.title}</ReactMarkdown>
        </h3>
        <QuestionStatusControl status={question.status} disabled={pending} onChange={onStatusChange} />
      </div>

      <p className={`money mt-2 text-[11px] font-semibold ${overLimit ? "text-amber-600 dark:text-amber-400" : "text-slate-400 dark:text-slate-500"}`}>
        {question.chars.toLocaleString("en-GB")} / 2,000
      </p>

      {question.kevin_markers.length > 0 && (
        <div className="mt-3 space-y-2">
          {question.kevin_markers.map((marker, idx) => (
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
      <SaveIndicator note={saveNote} />
    </div>
  );
}

export default function GoLivePage() {
  const [data, setData] = useState<GoLiveResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [forbidden, setForbidden] = useState(false);
  const [error, setError] = useState(false);
  const [pendingIds, setPendingIds] = useState<Set<string>>(new Set());
  const [saveNotes, setSaveNotes] = useState<Record<string, SaveNote>>({});

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

  const applyResult = useCallback((key: string, res: GoLiveActionResponse) => {
    setData(res);
    setSaveNotes((prev) => ({
      ...prev,
      [key]: res.committed ? { ok: true, text: "Saved" } : { ok: false, text: "Saved to file, git commit failed" },
    }));
  }, []);

  const handleItemAction = useCallback(
    async (itemId: string, body: Parameters<typeof api.goLiveItemAction>[1]) => {
      setPendingIds((prev) => new Set(prev).add(itemId));
      try {
        const res = await api.goLiveItemAction(itemId, body);
        applyResult(itemId, res);
      } catch (e) {
        setSaveNotes((prev) => ({
          ...prev,
          [itemId]: { ok: false, text: e instanceof Error ? e.message : "Couldn't save, try again" },
        }));
      } finally {
        setPendingIds((prev) => {
          const next = new Set(prev);
          next.delete(itemId);
          return next;
        });
      }
    },
    [applyResult]
  );

  const handleQuestionStatus = useCallback(
    async (q: string, status: GoLiveStatus) => {
      setPendingIds((prev) => new Set(prev).add(q));
      try {
        const res = await api.goLiveQuestionStatus(q, status);
        applyResult(q, res);
      } catch (e) {
        setSaveNotes((prev) => ({
          ...prev,
          [q]: { ok: false, text: e instanceof Error ? e.message : "Couldn't save, try again" },
        }));
      } finally {
        setPendingIds((prev) => {
          const next = new Set(prev);
          next.delete(q);
          return next;
        });
      }
    },
    [applyResult]
  );

  const sections = useMemo(
    () => (data ? groupItemsBySection(data.items, data.files.todo?.markdown) : []),
    [data]
  );
  const { done, total } = useMemo(() => (data ? itemTotals(data.items) : { done: 0, total: 0 }), [data]);
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  const pricingSegments = useMemo(
    () => (data?.files.pricing ? splitMarkdownIntoSegments(data.files.pricing.markdown) : []),
    [data]
  );

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
          <div className="h-7 w-56 rounded-lg bg-slate-200 dark:bg-slate-700" />
          <div className="h-28 rounded-3xl bg-slate-200 dark:bg-slate-700" />
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

        {data.questions.length > 0 && (
          <section className="mb-8">
            <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-slate-700 dark:text-slate-200">Questionnaire</h2>
            <div className="space-y-3">
              {data.questions.map((q) => (
                <QuestionCard
                  key={q.q}
                  question={q}
                  pending={pendingIds.has(q.q)}
                  saveNote={saveNotes[q.q] ?? null}
                  onStatusChange={(status) => handleQuestionStatus(q.q, status)}
                />
              ))}
            </div>
          </section>
        )}

        {sections.length > 0 && (
          <section className="mb-8">
            <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-slate-700 dark:text-slate-200">Backlog</h2>
            <div className="space-y-3">
              {sections.map((section, idx) => (
                <SectionCard
                  key={section.section}
                  heading={section.heading}
                  items={section.items}
                  defaultOpen={idx === 0}
                  pendingIds={pendingIds}
                  saveNotes={saveNotes}
                  onAction={handleItemAction}
                />
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
            Source of truth: TODO.md and docs/ in the repo. This page writes back through git; sessions can also use
            `scripts/backlog.py`.
          </p>
        </footer>
      </div>
    </main>
  );
}
