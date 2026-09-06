"use client";

// The questionnaire section: one card per compliance question, with its
// status control, the answer preview, and (new) a line naming which
// backlog items unblock it, each id scrolling to that item's row in the
// list view below.

import { useState } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import { Check, ChevronDown, Copy } from "lucide-react";
import { stripKevinMarkers, type GoLiveQuestion, type GoLiveStatus } from "@/lib/goLive";

const STATUS_LABEL: Record<GoLiveStatus, string> = {
  ready: "Ready",
  "needs-kevin": "Needs Kevin",
  "blocked-deploy": "Blocked on deploy",
  submitted: "Submitted",
};
const STATUS_OPTIONS: GoLiveStatus[] = ["needs-kevin", "ready", "blocked-deploy", "submitted"];

type SaveNote = { ok: boolean; text: string } | null;

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

function jumpToItem(itemId: string) {
  document.getElementById(`item-${itemId}`)?.scrollIntoView({ block: "center" });
}

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

      {question.unblocked_by.length > 0 && (
        <p className="mt-2 flex flex-wrap items-center gap-1 text-[11px] font-semibold text-slate-400 dark:text-slate-500">
          Unblocked by
          {question.unblocked_by.map((id) => (
            <button
              key={id}
              type="button"
              onClick={() => jumpToItem(id)}
              className="money rounded-full bg-slate-100 px-1.5 py-0.5 text-slate-600 hover:bg-slate-200 dark:bg-white/5 dark:text-slate-300 dark:hover:bg-white/10"
            >
              {id}
            </button>
          ))}
        </p>
      )}

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

export function QuestionsSection({
  questions,
  pendingIds,
  saveNotes,
  onStatusChange,
}: {
  questions: GoLiveQuestion[];
  pendingIds: Set<string>;
  saveNotes: Record<string, SaveNote>;
  onStatusChange: (q: string, status: GoLiveStatus) => void;
}) {
  if (questions.length === 0) {
    return <p className="text-sm text-slate-500 dark:text-slate-400">No questions match the current filters.</p>;
  }
  return (
    <div className="space-y-3">
      {questions.map((q) => (
        <QuestionCard
          key={q.q}
          question={q}
          pending={pendingIds.has(q.q)}
          saveNote={saveNotes[q.q] ?? null}
          onStatusChange={(status) => onStatusChange(q.q, status)}
        />
      ))}
    </div>
  );
}
