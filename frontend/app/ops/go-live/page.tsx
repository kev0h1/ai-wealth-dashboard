"use client";

// Private go-live board. Gated by the normal AuthProvider (see
// components/AuthProvider.tsx — this route is not in its /design, /terms,
// /privacy public-page exemption list) plus a server-side owner check in
// backend/app/routers/ops.py (GET/POST /ops/go-live 403s for anyone but
// the account owner).
//
// TODO.md and the Finexer compliance doc stay the source of truth, but
// this page can write to them too: every action below goes through
// backend/app/services/backlog.py (atomic write, file lock, best-effort
// git commit + push of just that file) and the response is the full
// refreshed board, so the page always re-renders from what actually
// landed on disk rather than guessing at the new state. Never tick an
// item by hand outside this page or `scripts/backlog.py` — see
// docs/ops/BACKLOG.md.
//
// This file stayed thin on purpose: the filter bar, list view, board view
// and questionnaire section each moved into their own component under
// app/ops/go-live/ once priorities/unblocks/filters/a kanban view made the
// single-file version too long to hold in one head.

import { useCallback, useEffect, useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import { ChevronDown } from "lucide-react";
import { api, type GoLiveActionResponse, type GoLiveResponse } from "@/lib/api";
import { LegalTable, splitMarkdownIntoSegments } from "@/components/LegalDocument";
import {
  DEFAULT_GO_LIVE_FILTERS,
  filterItems,
  filterQuestions,
  groupItemsBySection,
  itemTotals,
  loadGoLiveFilters,
  saveGoLiveFilters,
  type GoLiveFilters,
  type GoLiveStatus,
} from "@/lib/goLive";
import { FilterBar } from "./FilterBar";
import { HeaderHero } from "./HeaderHero";
import { ListView } from "./ListView";
import { BoardView } from "./BoardView";
import { QuestionsSection } from "./QuestionsSection";

type SaveNote = { ok: boolean; text: string } | null;

function formatUpdatedAt(iso: string): string {
  try {
    return new Date(iso).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" });
  } catch {
    return iso;
  }
}

export default function GoLivePage() {
  const [data, setData] = useState<GoLiveResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [forbidden, setForbidden] = useState(false);
  const [error, setError] = useState(false);
  const [pendingIds, setPendingIds] = useState<Set<string>>(new Set());
  const [saveNotes, setSaveNotes] = useState<Record<string, SaveNote>>({});
  const [filters, setFilters] = useState<GoLiveFilters>(DEFAULT_GO_LIVE_FILTERS);

  // Filters are read from localStorage once on mount (after hydration, so
  // server and first client render match) and written back on every change.
  useEffect(() => {
    setFilters(loadGoLiveFilters());
  }, []);

  const updateFilters = useCallback((next: GoLiveFilters) => {
    setFilters(next);
    saveGoLiveFilters(next);
  }, []);

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

  const filteredItems = useMemo(() => (data ? filterItems(data.items, filters) : []), [data, filters]);
  const filteredQuestions = useMemo(
    () => (data ? filterQuestions(data.questions, data.items, filters) : []),
    [data, filters]
  );
  const sections = useMemo(
    () => groupItemsBySection(filteredItems, data?.files.todo?.markdown),
    [filteredItems, data]
  );
  const { done, total } = useMemo(() => (data ? itemTotals(data.items) : { done: 0, total: 0 }), [data]);
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
        <header className="mb-2">
          <h1 className="text-xl font-bold text-slate-900 dark:text-slate-100">Go-live readiness</h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Finexer production access: 1 Oct 2026</p>
          <div className="mt-5">
            <HeaderHero items={data.items} done={done} total={total} />
          </div>
        </header>
      </div>

      <FilterBar filters={filters} onChange={updateFilters} />

      <div className="mx-auto max-w-2xl">
        {filteredQuestions.length > 0 && (
          <section className="mb-8">
            <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-slate-700 dark:text-slate-200">Questionnaire</h2>
            <QuestionsSection
              questions={filteredQuestions}
              pendingIds={pendingIds}
              saveNotes={saveNotes}
              onStatusChange={handleQuestionStatus}
            />
          </section>
        )}

        <section className="mb-8">
          <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-slate-700 dark:text-slate-200">Backlog</h2>
          {filters.view === "list" ? (
            <ListView sections={sections} pendingIds={pendingIds} saveNotes={saveNotes} onAction={handleItemAction} />
          ) : (
            <BoardView
              items={filteredItems}
              todoMarkdown={data.files.todo?.markdown}
              lanes={filters.lanes}
              onLanesChange={(lanes) => updateFilters({ ...filters, lanes })}
              pendingIds={pendingIds}
              saveNotes={saveNotes}
              onAction={handleItemAction}
            />
          )}
        </section>

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
