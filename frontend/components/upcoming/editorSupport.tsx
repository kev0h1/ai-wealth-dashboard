"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { useFlowSubmission } from "@/components/UpcomingFlowSheet";

export const editorField = "mt-2 min-h-12 w-full min-w-0 rounded-xl border border-slate-300 bg-white px-3 py-2 text-base text-slate-950 placeholder:text-slate-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-50 dark:placeholder:text-slate-400";
export const editorSecondary = "min-h-11 rounded-xl border border-slate-300 px-4 py-3 text-sm font-semibold text-slate-800 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:border-slate-600 dark:text-slate-100 dark:hover:bg-slate-800";
export const editorQuiet = "min-h-11 rounded-lg px-3 text-sm font-medium text-slate-600 hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 disabled:opacity-60 dark:text-slate-300 dark:hover:bg-slate-800";

/** One in-flight operation. A committed write is never repeated on refresh failure. */
export function useEditorRequest() {
  const setSubmission = useFlowSubmission();
  const state = useRef({ live: false, generation: 0, busy: false, refresh: null as null | (() => Promise<void>), after: undefined as undefined | (() => void) });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [needsRefresh, setNeedsRefresh] = useState(false);
  useEffect(() => {
    const current = state.current;
    current.live = true; current.generation += 1; current.busy = false;
    return () => { current.live = false; current.generation += 1; setSubmission(false); };
  }, [setSubmission]);
  async function run(operation: () => Promise<unknown>, after?: () => void, failure = "Your changes could not be saved. They are still here. Try again.", refresh?: () => void | Promise<void>) {
    const current = state.current;
    if (current.busy || !current.live) return;
    const generation = current.generation;
    current.busy = true; setSubmission(true); setBusy(true); setError("");
    let complete = false;
    try {
      if (!current.refresh) {
        await operation();
        current.after = after;
        if (refresh) current.refresh = async () => { await refresh(); };
      }
      if (current.refresh) await current.refresh();
      current.refresh = null;
      complete = true;
    } catch {
      if (current.live && current.generation === generation) {
        setNeedsRefresh(Boolean(current.refresh));
        setError(current.refresh ? "Changes saved, but this view could not be refreshed. Retry the refresh to see the latest figures. Your changes will not be sent again." : failure);
      }
    } finally {
      if (current.live && current.generation === generation) {
        current.busy = false; setSubmission(false); setBusy(false);
        if (complete) { setNeedsRefresh(false); current.after?.(); }
      }
    }
  }
  return { busy, error, needsRefresh, setError, run, retryRefresh: () => run(async () => {}) };
}

export function EditorActions({ formId, busy, needsRefresh = false, onCancel, renderActions }: {
  formId: string; busy: boolean; needsRefresh?: boolean; onCancel(): void; renderActions?: (actions: ReactNode) => ReactNode;
}) {
  const actions = <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,2fr)] gap-3">
    <button type="button" disabled={busy} onClick={onCancel} className={editorSecondary + " disabled:opacity-50"}>{needsRefresh ? "Back" : "Cancel"}</button>
    <button type="submit" form={formId} disabled={busy} className="min-h-11 rounded-xl bg-indigo-600 px-4 py-3 text-sm font-semibold text-white hover:bg-indigo-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 disabled:opacity-60">{busy ? needsRefresh ? "Refreshing…" : "Saving…" : needsRefresh ? "Retry refresh" : "Save changes"}</button>
  </div>;
  return renderActions ? renderActions(actions) : actions;
}

export function EditorError({ message }: { message: string }) {
  const ref = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    // The actions stay in the sheet footer while a long form scrolls. Make
    // a failed save visible without stealing focus or opening another sheet.
    if (message) ref.current?.scrollIntoView({ block: "nearest", behavior: "instant" });
  }, [message]);
  return message ? <p ref={ref} role="alert" className="rounded-xl border border-slate-300 p-3 text-sm leading-6 text-slate-700 dark:border-slate-600 dark:text-slate-200">{message}</p> : null;
}

export function validDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(`${value}T12:00:00Z`)) && new Date(`${value}T12:00:00Z`).toISOString().slice(0, 10) === value;
}
