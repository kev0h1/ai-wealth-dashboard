"use client";

// Sticky filter bar: owner segmented control, priority chips (multi),
// state chips (multi), search, and the List/Board view toggle. Persisted
// as one object under lib/goLive's GO_LIVE_FILTERS_STORAGE_KEY by the
// parent page; this component is purely controlled.

import { useEffect, useRef } from "react";
import { LayoutGrid, List, Search, X } from "lucide-react";
import {
  FILTER_STATE_LABEL,
  FILTER_STATE_ORDER,
  PRIORITY_LABEL,
  PRIORITY_ORDER,
  type GoLiveFilterState,
  type GoLiveFilters,
  type GoLiveOwner,
  type GoLivePriority,
} from "@/lib/goLive";

const OWNER_OPTIONS: { value: "all" | GoLiveOwner; label: string }[] = [
  { value: "all", label: "All" },
  { value: "kevin", label: "Kevin" },
  { value: "claude", label: "Claude" },
];

function toggleValue<T>(list: T[], value: T): T[] {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
}

export function FilterBar({ filters, onChange }: { filters: GoLiveFilters; onChange: (next: GoLiveFilters) => void }) {
  const hasActiveFilters =
    filters.owner !== "all" || filters.priorities.length > 0 || filters.states.length > 0 || filters.search.trim() !== "";

  // Publishes this bar's real rendered height as a CSS variable on <html>
  // so BoardView.tsx's desktop column headers (a sibling deep in the tree,
  // not a descendant — a CSS variable is simpler here than prop-drilling a
  // measured height down through page.tsx) can sit their `sticky` offset
  // exactly under it, rather than guessing a fixed pixel value that drifts
  // whenever this bar's content wraps differently (active filters, window
  // width, font loading, etc).
  const barRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = barRef.current;
    if (!el) return;
    const publishHeight = () => {
      document.documentElement.style.setProperty("--go-live-filter-h", `${el.getBoundingClientRect().height}px`);
    };
    publishHeight();
    const observer = new ResizeObserver(publishHeight);
    observer.observe(el);
    return () => {
      observer.disconnect();
      document.documentElement.style.removeProperty("--go-live-filter-h");
    };
  }, []);

  return (
    <div
      ref={barRef}
      className="sticky top-0 z-20 -mx-6 mb-6 border-b border-slate-200 bg-[#f0f2f7]/90 px-6 py-3 backdrop-blur dark:border-white/10 dark:bg-[#0f172a]/90 xl:-mx-10 xl:px-10"
    >
      <div className="mx-auto max-w-2xl space-y-2.5 lg:max-w-none">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex min-h-9 shrink-0 items-center rounded-full bg-slate-100 p-0.5 dark:bg-white/5">
            {OWNER_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => onChange({ ...filters, owner: opt.value })}
                className={`min-h-8 rounded-full px-3 text-xs font-semibold transition-colors ${
                  filters.owner === opt.value
                    ? "bg-white text-slate-800 shadow-sm dark:bg-slate-700 dark:text-slate-100"
                    : "text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>

          <div className="flex min-h-9 shrink-0 items-center gap-1 rounded-full bg-slate-100 p-0.5 dark:bg-white/5">
            {PRIORITY_ORDER.map((p: GoLivePriority) => (
              <button
                key={p}
                type="button"
                onClick={() => onChange({ ...filters, priorities: toggleValue(filters.priorities, p) })}
                className={`min-h-8 rounded-full px-3 text-xs font-bold transition-colors ${
                  filters.priorities.includes(p)
                    ? "bg-white text-slate-800 shadow-sm dark:bg-slate-700 dark:text-slate-100"
                    : "text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
                }`}
              >
                {PRIORITY_LABEL[p]}
              </button>
            ))}
          </div>

          <div className="ml-auto flex min-h-9 shrink-0 items-center rounded-full bg-slate-100 p-0.5 dark:bg-white/5">
            <button
              type="button"
              onClick={() => onChange({ ...filters, view: "list" })}
              aria-label="List view"
              className={`flex min-h-8 min-w-8 items-center justify-center rounded-full px-2.5 ${
                filters.view === "list"
                  ? "bg-white text-slate-800 shadow-sm dark:bg-slate-700 dark:text-slate-100"
                  : "text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
              }`}
            >
              <List size={15} aria-hidden="true" />
            </button>
            <button
              type="button"
              onClick={() => onChange({ ...filters, view: "board" })}
              aria-label="Board view"
              className={`flex min-h-8 min-w-8 items-center justify-center rounded-full px-2.5 ${
                filters.view === "board"
                  ? "bg-white text-slate-800 shadow-sm dark:bg-slate-700 dark:text-slate-100"
                  : "text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
              }`}
            >
              <LayoutGrid size={15} aria-hidden="true" />
            </button>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          {FILTER_STATE_ORDER.map((s: GoLiveFilterState) => (
            <button
              key={s}
              type="button"
              onClick={() => onChange({ ...filters, states: toggleValue(filters.states, s) })}
              className={`min-h-8 rounded-full border px-2.5 text-[11px] font-semibold transition-colors ${
                filters.states.includes(s)
                  ? "border-indigo-300 bg-indigo-50 text-indigo-700 dark:border-indigo-800 dark:bg-indigo-950/40 dark:text-indigo-300"
                  : "border-slate-200 text-slate-500 hover:bg-slate-50 dark:border-white/10 dark:text-slate-400 dark:hover:bg-white/5"
              }`}
            >
              {FILTER_STATE_LABEL[s]}
            </button>
          ))}

          <div className="relative ml-auto min-w-0 flex-1 sm:max-w-[180px]">
            <Search size={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" aria-hidden="true" />
            <input
              type="text"
              value={filters.search}
              onChange={(e) => onChange({ ...filters, search: e.target.value })}
              placeholder="Search"
              className="min-h-8 w-full rounded-full border border-slate-200 bg-white py-1 pl-7 pr-2 text-xs text-slate-700 focus:border-indigo-400 focus:outline-none dark:border-white/10 dark:bg-slate-800 dark:text-slate-100"
            />
          </div>

          {hasActiveFilters && (
            <button
              type="button"
              onClick={() => onChange({ ...filters, owner: "all", priorities: [], states: [], search: "" })}
              aria-label="Clear filters"
              className="flex min-h-8 min-w-8 shrink-0 items-center justify-center rounded-full text-slate-400 hover:bg-slate-100 dark:text-slate-500 dark:hover:bg-white/5"
            >
              <X size={14} aria-hidden="true" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
