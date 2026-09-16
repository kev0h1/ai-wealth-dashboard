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
// F20: fetches `month: "all"` (GET /mcp/audit's TTL-bounded full history)
// by default, unlike the card's own current-month-only call, but the "Time
// range" fieldset below is a real, working toggle onto `month: "YYYY-MM"`
// for the current month — see currentYearMonth()'s comment.

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Check } from "lucide-react";
import { api, type McpAuditCall } from "@/lib/api";
import { formatDateTime, toolLabel } from "@/components/ConnectedAssistantsCard";
import Spinner from "@/components/Spinner";

const PAGE_SIZE = 20;

type LoadState = "loading" | "ready" | "error";

// F20: `client: "session"` is backend/app/routers/mcp.py's F3 session-bearer
// stopgap — Kevin's own signed-in app reading his data through the same
// tool dispatch a real MCP client uses (see resolve_mcp_principal's own
// comment). It is a real, read-only access and stays in the log (an audit
// log that quietly dropped some of its own reads would be worse than one
// with an odd label), but it is not a connected assistant: Kevin has one
// (Claude), not two. Kept out of the "N connected assistants" count and
// given its own display name rather than sitting next to "Claude" as if
// it were a peer assistant.
const SESSION_CLIENT = "session";

function clientDisplayName(client: string): string {
  return client === SESSION_CLIENT ? "You, in the app" : client;
}

// F20: the endpoint already supports a real per-month scope (`month`,
// backend/app/routers/mcp.py get_mcp_audit — "all" drops the year_month
// filter, an explicit "YYYY-MM" narrows to it), this page just never used
// anything but "all". A client-side filter over the loaded page would only
// filter whatever page is already in hand (this list is cursor-paginated,
// not fully loaded), so the toggle below re-fetches from the server.
function currentYearMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

type MonthScope = "all" | "month";

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

// G101 (variant A, see app/design/mcp-activity-canvas-before-cards):
// the context line's "Latest record: today at 10:42" phrasing, built from
// the same day-heading logic as the row groups above so "today"/"yesterday"
// always agree with the rows underneath it.
function formatLatestRecord(iso: string): string {
  const heading = formatDayHeading(iso);
  const time = new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false });
  const dayPart = heading === "Today" || heading === "Yesterday" ? heading.toLowerCase() : `on ${heading}`;
  return `${dayPart} at ${time}`;
}

export default function McpActivityPage() {
  const router = useRouter();

  const [clientFilter, setClientFilter] = useState<string | null>(null);
  const [monthScope, setMonthScope] = useState<MonthScope>("all");
  const [clients, setClients] = useState<string[]>([]);
  const [items, setItems] = useState<McpAuditCall[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [state, setState] = useState<LoadState>("loading");
  const [loadingMore, setLoadingMore] = useState(false);
  // G101 variant A: which row's "Details" panel is open, keyed by
  // `${ts}-${index in that render}` since a row has no server-issued id.
  const [openRow, setOpenRow] = useState<string | null>(null);

  const loadFirstPage = useCallback((client: string | null, scope: MonthScope) => {
    setState("loading");
    const month = scope === "all" ? "all" : currentYearMonth();
    api.getMcpAudit(month, PAGE_SIZE, { client: client || undefined })
      .then((r) => {
        setItems(r.calls);
        setNextCursor(r.next_cursor);
        setClients(r.clients);
        setState("ready");
      })
      .catch(() => setState("error"));
  }, []);

  useEffect(() => { loadFirstPage(clientFilter, monthScope); }, [clientFilter, monthScope, loadFirstPage]);

  function handleLoadMore() {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    const month = monthScope === "all" ? "all" : currentYearMonth();
    api.getMcpAudit(month, PAGE_SIZE, { client: clientFilter || undefined, cursor: nextCursor })
      .then((r) => {
        setItems((prev) => [...prev, ...r.calls]);
        setNextCursor(r.next_cursor);
      })
      .catch(() => {})
      .finally(() => setLoadingMore(false));
  }

  const groups = groupByDay(items);
  // F20: only real OAuth-connected assistants count toward "N connected
  // assistants" — Kevin's own session rows are real reads, not a second
  // assistant. Session sorts last in the filter row so the real
  // assistants read first.
  const assistantClients = clients.filter((c) => c !== SESSION_CLIENT);
  const sortedClients = [...clients].sort((a, b) => {
    if (a === SESSION_CLIENT) return 1;
    if (b === SESSION_CLIENT) return -1;
    return a.localeCompare(b);
  });

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
      </div>

      <div className="px-4 pt-4">
        {/* G101 variant A: canvas header copy (description + context line),
            ported from app/design/mcp-activity-canvas-before-cards. The
            context line only appears once there is a real row to describe
            (state "ready" with at least one item), so it never states a
            "latest record" that does not exist. */}
        <p className="text-sm leading-6 text-slate-600 dark:text-slate-400">
          Check which connected assistant made each request, when it happened and the read-only scope recorded for it.
        </p>
        {state === "ready" && items.length > 0 && (
          <p className="mt-3 border-l-2 border-emerald-500 pl-3 text-sm leading-6 text-slate-600 dark:text-slate-300">
            <strong className="text-slate-900 dark:text-slate-100">
              {assistantClients.length > 0
                ? `${assistantClients.length} connected assistant${assistantClients.length === 1 ? "" : "s"}.`
                : "No assistant connected yet."}
            </strong>{" "}
            Every request is read-only. Latest record: {formatLatestRecord(items[0].ts)}.
          </p>
        )}
        {/* F20: explains the "You, in the app" rows/chip below — they are
            Kevin's own signed-in app reading his data (see SESSION_CLIENT's
            comment above), not hidden, just named honestly and kept out of
            the assistant count above. */}
        {clients.includes(SESSION_CLIENT) && (
          <p className="mt-2 text-xs leading-5 text-slate-400 dark:text-slate-500">
            Rows marked &quot;You, in the app&quot; are Sorted itself reading your data on your own behalf, not a connected assistant.
          </p>
        )}

        {clients.length > 0 && (
          <fieldset className="mt-4 flex flex-wrap items-center gap-2">
            <legend className="mb-2 text-sm font-semibold text-slate-700 dark:text-slate-200">Filter activity</legend>
            <button
              type="button"
              onClick={() => setClientFilter(null)}
              aria-pressed={clientFilter === null}
              className={`min-h-11 rounded-xl px-3 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${
                clientFilter === null
                  ? "bg-indigo-600 text-white"
                  : "border border-slate-200 bg-white text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300"
              }`}
            >
              All activity
            </button>
            {sortedClients.map((c) => (
              <button
                type="button"
                key={c}
                onClick={() => setClientFilter(c)}
                aria-pressed={clientFilter === c}
                className={`min-h-11 rounded-xl px-3 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${
                  clientFilter === c
                    ? "bg-indigo-600 text-white"
                    : "border border-slate-200 bg-white text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300"
                }`}
              >
                {clientDisplayName(c)}
              </button>
            ))}
          </fieldset>
        )}

        {/* F20: a real, server-side date scope (previously a decorative
            "All time" span next to the filter chips that never did
            anything, its own comment admitting the endpoint was always
            called with month="all"). Both options re-fetch GET /mcp/audit
            with a different `month` value rather than filtering the page
            already in hand, which would only affect the loaded page under
            cursor pagination, not the true full-month set. */}
        {clients.length > 0 && (
          <fieldset className="mt-3 flex flex-wrap items-center gap-2">
            <legend className="mb-2 text-sm font-semibold text-slate-700 dark:text-slate-200">Time range</legend>
            <button
              type="button"
              onClick={() => setMonthScope("all")}
              aria-pressed={monthScope === "all"}
              className={`min-h-11 rounded-xl px-3 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${
                monthScope === "all"
                  ? "bg-indigo-600 text-white"
                  : "border border-slate-200 bg-white text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300"
              }`}
            >
              All time
            </button>
            <button
              type="button"
              onClick={() => setMonthScope("month")}
              aria-pressed={monthScope === "month"}
              className={`min-h-11 rounded-xl px-3 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${
                monthScope === "month"
                  ? "bg-indigo-600 text-white"
                  : "border border-slate-200 bg-white text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300"
              }`}
            >
              This month
            </button>
          </fieldset>
        )}

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
              onClick={() => loadFirstPage(clientFilter, monthScope)}
              className="mt-2 text-[13px] font-semibold text-indigo-600 dark:text-indigo-400 active:opacity-70 transition-opacity"
            >
              Try again
            </button>
          </div>
        )}

        {state === "ready" && items.length === 0 && (
          <div className="py-8 text-center">
            <p className="text-sm text-slate-600 dark:text-slate-400">
              {clientFilter
                ? `No activity from ${clientDisplayName(clientFilter)}${monthScope === "month" ? " this month" : ""} yet`
                : monthScope === "month" ? "No activity this month yet" : "No activity yet"}
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
                  {group.rows.map((call, i) => {
                    const rowId = `${call.ts}-${i}`;
                    const isOpen = openRow === rowId;
                    return (
                      <div key={rowId}>
                        <button
                          type="button"
                          onClick={() => setOpenRow(isOpen ? null : rowId)}
                          aria-expanded={isOpen}
                          className="flex w-full items-center gap-3 px-4 py-3 min-h-[44px] text-left hover:bg-slate-50 dark:hover:bg-slate-700/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-500"
                        >
                          {call.ok ? (
                            <Check size={14} className="flex-shrink-0 text-slate-400 dark:text-slate-500" aria-hidden="true" />
                          ) : (
                            <span className="flex-shrink-0 text-[10px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
                              Failed
                            </span>
                          )}
                          <span className="min-w-0 flex-1">
                            <span className="block text-sm text-slate-800 dark:text-slate-100 truncate">{toolLabel(call.tool)}</span>
                            <span className="block text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                              {clientDisplayName(call.client)} · {formatDateTime(call.ts)}
                            </span>
                          </span>
                          <span className="flex-shrink-0 text-xs font-semibold text-indigo-600 dark:text-indigo-400">
                            Details
                          </span>
                        </button>
                        {isOpen && (
                          <div className="border-t border-slate-100 px-4 py-3 text-xs leading-5 text-slate-600 dark:border-slate-700 dark:text-slate-300">
                            <p>
                              <strong className="text-slate-900 dark:text-slate-100">Scope:</strong>{" "}
                              Read-only {toolLabel(call.tool)} request from {clientDisplayName(call.client)}. No write action was made.
                            </p>
                            {!call.ok && (
                              <p className="mt-1">This request did not complete successfully.</p>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
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
                  {loadingMore ? "Loading…" : "Show older activity"}
                </button>
              </div>
            )}

            <p className="text-[11px] text-slate-400 dark:text-slate-500 text-center pt-1">
              Sorted keeps this log for 90 days.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
