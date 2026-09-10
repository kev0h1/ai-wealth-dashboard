"use client";

// F14: the full, paginated "Connected assistants" audit log — reached from
// ConnectedAssistantsCard.tsx's "View full log" link (the card's own inline
// expander stays capped at 10 rows for the current month, this page is the
// unabridged version, following the same page-structure conventions as
// frontend/app/transactions/TransactionsPage.tsx: sticky back header, a
// filter row, a "Load more" cursor-paginated list. Unlike Transactions this
// list groups by calendar day and paginates with a cursor rather than page
// numbers, since GET /mcp/audit's ordering (ts desc, _id desc as a
// tiebreaker) is a cursor, not a page-count — see backend/app/routers/mcp.py
// get_mcp_audit's docstring for why a plain "row N of M" pager does not fit.
//
// Always fetches `month: "all"` (GET /mcp/audit's TTL-bounded full history),
// unlike the card's own current-month-only call.

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Check } from "lucide-react";
import { api, type McpAuditCall } from "@/lib/api";
import { formatDateTime, toolLabel } from "@/components/ConnectedAssistantsCard";
import BottomNav from "@/components/BottomNav";
import Spinner from "@/components/Spinner";

const PAGE_SIZE = 20;

type LoadState = "loading" | "ready" | "error";

// Local calendar day (not UTC) so "Today"/"Yesterday" match the device
// clock, same as every other date heading in the app.
function dayKey(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

function formatDayHeading(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const startOfDay = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diffDays = Math.round((startOfDay(now) - startOfDay(d)) / 86400000);
  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  const sameYear = d.getFullYear() === now.getFullYear();
  return d.toLocaleDateString("en-GB", sameYear
    ? { day: "numeric", month: "long" }
    : { day: "numeric", month: "long", year: "numeric" });
}

// Groups an already ts-desc-sorted list into consecutive same-day sections.
// Safe across "Load more" appends: pages are contiguous slices of one global
// sorted order (the cursor guarantees no gap or overlap), so a day never
// splits into two non-adjacent sections.
function groupByDay(items: McpAuditCall[]): { key: string; heading: string; rows: McpAuditCall[] }[] {
  const groups: { key: string; heading: string; rows: McpAuditCall[] }[] = [];
  for (const call of items) {
    const key = dayKey(call.ts);
    const last = groups[groups.length - 1];
    if (last && last.key === key) {
      last.rows.push(call);
    } else {
      groups.push({ key, heading: formatDayHeading(call.ts), rows: [call] });
    }
  }
  return groups;
}

export default function McpActivityPage() {
  const router = useRouter();

  const [clientFilter, setClientFilter] = useState<string | null>(null);
  const [clients, setClients] = useState<string[]>([]);
  const [items, setItems] = useState<McpAuditCall[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [state, setState] = useState<LoadState>("loading");
  const [loadingMore, setLoadingMore] = useState(false);

  const loadFirstPage = useCallback((client: string | null) => {
    setState("loading");
    api.getMcpAudit("all", PAGE_SIZE, { client: client || undefined })
      .then((r) => {
        setItems(r.calls);
        setNextCursor(r.next_cursor);
        setClients(r.clients);
        setState("ready");
      })
      .catch(() => setState("error"));
  }, []);

  useEffect(() => { loadFirstPage(clientFilter); }, [clientFilter, loadFirstPage]);

  function handleLoadMore() {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    api.getMcpAudit("all", PAGE_SIZE, { client: clientFilter || undefined, cursor: nextCursor })
      .then((r) => {
        setItems((prev) => [...prev, ...r.calls]);
        setNextCursor(r.next_cursor);
      })
      .catch(() => {})
      .finally(() => setLoadingMore(false));
  }

  const groups = groupByDay(items);

  return (
    <div className="min-h-dvh pb-[calc(9rem+env(safe-area-inset-bottom,0px))] lg:pb-8 lg:max-w-2xl lg:mx-auto" style={{ paddingTop: "env(safe-area-inset-top, 0px)" }}>
      <div className="sticky top-0 z-10 bg-[#f0f2f7]/90 dark:bg-[#0f172a]/90 backdrop-blur-sm border-b border-slate-200/60 dark:border-slate-700/60">
        <div className="px-4 pt-6 pb-3 flex items-center gap-3">
          <button
            type="button"
            onClick={() => router.back()}
            aria-label="Back"
            className="w-11 h-11 flex items-center justify-center rounded-full glass-tile flex-shrink-0 active:scale-95 transition-transform"
          >
            <ArrowLeft size={18} className="text-slate-500 dark:text-slate-400" />
          </button>
          <div>
            <p className="text-xs text-slate-600 dark:text-slate-400 font-medium uppercase tracking-wide">
              Connected assistants
            </p>
            <h1 className="text-xl font-bold text-slate-900 dark:text-slate-100">Activity log</h1>
          </div>
        </div>

        {clients.length > 0 && (
          <div className="px-4 pb-3 flex items-center gap-1.5 flex-wrap">
            <button
              type="button"
              onClick={() => setClientFilter(null)}
              className={`flex-shrink-0 min-h-[28px] px-2.5 py-0.5 rounded-full text-[11px] font-semibold transition-colors ${
                clientFilter === null
                  ? "bg-indigo-50 dark:bg-indigo-500/10 text-indigo-600 dark:text-indigo-300"
                  : "bg-slate-100 dark:bg-slate-700/60 text-slate-600 dark:text-slate-300"
              }`}
            >
              All assistants
            </button>
            {clients.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setClientFilter(c)}
                className={`flex-shrink-0 min-h-[28px] px-2.5 py-0.5 rounded-full text-[11px] font-semibold transition-colors ${
                  clientFilter === c
                    ? "bg-indigo-50 dark:bg-indigo-500/10 text-indigo-600 dark:text-indigo-300"
                    : "bg-slate-100 dark:bg-slate-700/60 text-slate-600 dark:text-slate-300"
                }`}
              >
                {c}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="px-4 pt-4">
        {state === "loading" && (
          <div className="flex items-center justify-center py-16">
            <Spinner size={32} />
          </div>
        )}

        {state === "error" && (
          <div className="py-8 text-center">
            <p className="text-sm text-slate-600 dark:text-slate-400">Could not load the activity log.</p>
            <button
              type="button"
              onClick={() => loadFirstPage(clientFilter)}
              className="mt-2 text-[13px] font-semibold text-indigo-600 dark:text-indigo-400 active:opacity-70 transition-opacity"
            >
              Try again
            </button>
          </div>
        )}

        {state === "ready" && items.length === 0 && (
          <div className="py-8 text-center">
            <p className="text-sm text-slate-600 dark:text-slate-400">
              {clientFilter ? `No activity from ${clientFilter} yet` : "No activity yet"}
            </p>
          </div>
        )}

        {state === "ready" && items.length > 0 && (
          <div className="space-y-4">
            {groups.map((group) => (
              <div key={group.key}>
                <p className="px-1 pb-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                  {group.heading}
                </p>
                <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-sm overflow-hidden divide-y divide-slate-50 dark:divide-slate-700">
                  {group.rows.map((call, i) => (
                    <div key={i} className="flex items-center gap-3 px-4 py-3 min-h-[44px]">
                      {call.ok ? (
                        <Check size={14} className="flex-shrink-0 text-slate-400 dark:text-slate-500" aria-hidden="true" />
                      ) : (
                        <span className="flex-shrink-0 text-[10px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
                          Failed
                        </span>
                      )}
                      <div className="min-w-0 flex-1">
                        <p className="text-sm text-slate-800 dark:text-slate-100 truncate">{toolLabel(call.tool)}</p>
                        <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                          {call.client} · {formatDateTime(call.ts)}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}

            {nextCursor && (
              <div className="flex justify-center py-2">
                <button
                  type="button"
                  onClick={handleLoadMore}
                  disabled={loadingMore}
                  className="min-h-[44px] px-5 rounded-xl bg-white dark:bg-slate-800 shadow-sm text-sm font-medium text-slate-600 dark:text-slate-300 disabled:opacity-60 active:scale-95 transition-transform"
                >
                  {loadingMore ? "Loading…" : "Load more"}
                </button>
              </div>
            )}

            <p className="text-[11px] text-slate-400 dark:text-slate-500 text-center pt-1">
              Sorted keeps this log for 90 days.
            </p>
          </div>
        )}
      </div>

      <BottomNav />
    </div>
  );
}
