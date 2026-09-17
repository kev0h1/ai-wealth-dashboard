"use client";

// H56: the Focus-first "ribbon" board, Kevin's pick from the
// frontend/app/design/ops-board-mobile/ round (2026-09-16/17), folded in
// as the production below-`lg` tree for BoardView.tsx. Replaces the old
// per-section, horizontally-scrolling lane strip: with roughly 300 items
// across 8 sections and 7 states, that old layout was a two-axis scroll
// through the whole board, burying the dozen or so items actually in
// flight. This component surfaces those in-flight items as dense,
// readable rows under a sticky counts strip, with To do and Done tucked
// behind two collapsible sections — reachable through search/filters, not
// a second board.
//
// No fetch, no local "which chip is active" state: the counts strip
// reads and writes the exact same `filters.states` FilterBar.tsx already
// owns and persists (GO_LIVE_FILTERS_STORAGE_KEY, held by page.tsx),
// through the same `toggleValue` helper (lib/goLive.ts) both components
// import. Tapping "Blocked" here and tapping "Blocked" in FilterBar are
// the same action and always agree — there is deliberately no private
// selection anywhere in this file.
//
// No drag: a tap opens the real ItemDetailSheet (rendered by BoardView,
// not this component), whose "Move to" picker (H55) is the only route to
// a state change on a phone. That means this whole tree registers zero
// dnd-kit draggables/droppables, which is why BoardView can mount it
// completely outside its `<DndContext>` — see BoardView.tsx's file header
// for the full reasoning.

import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { itemFilterState, toggleValue, type GoLiveFilterState, type GoLiveFilters, type GoLiveItem } from "@/lib/goLive";
import { OwnerInitialChip, PriorityPill, StatePill } from "./Badges";

// ---------------------------------------------------------------------
// Shared rows/sections — also used by the two not-picked reference
// variants (live-now, waiting) in the /design/ops-board-mobile preview,
// which is why these are exported rather than kept private to this file.
// ---------------------------------------------------------------------

export function SectionHeading({ children, count }: { children: React.ReactNode; count: number }) {
  return (
    <div className="flex items-center justify-between px-0.5">
      <h2 className="text-base font-bold text-slate-800 dark:text-slate-100">{children}</h2>
      <span className="money text-xs font-semibold text-slate-400 dark:text-slate-500">{count}</span>
    </div>
  );
}

/** One dense row: a single truncated title line (`truncate`, never
 *  `line-clamp`, so even a full-paragraph title collapses to one
 *  ellipsised line rather than wrapping the row open) with the id and
 *  priority pinned either side, and a compact state pill on a second
 *  line. `StatePill`'s `compact` mode drops the free-text reason/branch
 *  suffix entirely (rather than truncating it) — a phone-width row has no
 *  room for both a title and a reason fragment, and the full text stays
 *  one tap away in ItemDetailSheet. */
export function ItemRow({ item, onOpen }: { item: GoLiveItem; onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="glass-card flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-left transition-transform active:scale-[0.99]"
    >
      <OwnerInitialChip owner={item.owner} />
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline gap-1.5">
          <span className="money shrink-0 text-[10px] font-bold text-slate-400 dark:text-slate-500">{item.id}</span>
          <span className="min-w-0 truncate text-xs font-semibold text-slate-800 dark:text-slate-100">{item.title}</span>
        </span>
        <span className="mt-1 flex flex-wrap items-center gap-1.5">
          <StatePill item={item} compact />
        </span>
      </span>
      <PriorityPill priority={item.priority} />
    </button>
  );
}

/** The collapsed "To do" / "Done" section. `sampleItems` is the full,
 *  honest list in production (`sampleItems.length === totalCount` always,
 *  since this board isn't paginated) so no caveat renders there; the
 *  /design preview passes a small curated slice against the real bigger
 *  count, so the caveat renders only when the two differ. */
export function CollapsedSection({
  label,
  totalCount,
  sampleItems,
  onOpen,
}: {
  label: string;
  totalCount: number;
  sampleItems: GoLiveItem[];
  onOpen: (item: GoLiveItem) => void;
}) {
  const [open, setOpen] = useState(false);
  const isSample = sampleItems.length < totalCount;
  return (
    <div className="glass-card rounded-2xl p-3">
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} className="flex min-h-9 w-full items-center justify-between gap-3">
        <span className="text-sm font-semibold text-slate-700 dark:text-slate-200">{label}</span>
        <span className="flex shrink-0 items-center gap-2">
          <span className="money text-xs font-semibold text-slate-500 dark:text-slate-400">{totalCount}</span>
          <ChevronDown size={16} className={`text-slate-400 transition-transform ${open ? "rotate-180" : ""}`} aria-hidden="true" />
        </span>
      </button>
      {open && (
        <div className="mt-3 space-y-2 border-t border-slate-100 pt-3 dark:border-white/10">
          {isSample && (
            <p className="px-0.5 text-[11px] leading-relaxed text-slate-400 dark:text-slate-500">
              A sample of {sampleItems.length} of {totalCount}. Use search or a state filter above to reach the rest.
            </p>
          )}
          {sampleItems.map((item) => (
            <ItemRow key={item.id} item={item} onOpen={() => onOpen(item)} />
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------
// The ribbon board itself
// ---------------------------------------------------------------------

// All four live-flow states plus Rejected: the old lane strip rendered
// every BOARD_COLUMNS entry, and Rejected is the one state whose whole
// purpose is "a reviewer found a defect, this needs your decision" (a
// design round's uat chip covers the parallel "Kevin needs to pick"
// case) — dropping it from the ribbon left a rejected item reachable
// from no section with no filter active, while HeaderHero still prints
// its count above the board (found auditing H56, 2026-09-17).
//
// Measured at a true 390px: the five chips overflow the strip by 58px
// (scrollWidth 448 vs clientWidth 390), and the fifth ("UAT") sits past
// the right edge until the strip is scrolled — it does NOT fit. Kept
// horizontally scrollable rather than shrinking chip text below
// DESIGN.md's 10-11px Label floor or wrapping to a second row (which
// would cost this strip exactly the vertical space Kevin's "ribbon
// only" decision on FilterBar was trying to reclaim): AccountsPage.tsx's
// "Lens chips" row is a comparable shape already shipped elsewhere in
// this app (a compact filter-chip strip that scrolls rather than wraps
// or shrinks, though it additionally hides its own scrollbar, which
// this strip does not), so this isn't a wholly new interaction pattern,
// and the fifth chip stays one swipe away rather than permanently
// hidden — the 21px slice of "UAT" visible at the right edge is itself
// the affordance that more chips exist.
const RIBBON_STATES: { key: GoLiveFilterState; label: string }[] = [
  { key: "in-progress", label: "In progress" },
  { key: "blocked", label: "Blocked" },
  { key: "review", label: "In review" },
  { key: "rejected", label: "Rejected" },
  { key: "uat", label: "UAT" },
];

export type MobileRibbonBoardProps = {
  filters: GoLiveFilters;
  onFiltersChange: (next: GoLiveFilters) => void;
  /** owner !== "all" || priorities.length > 0 || states.length > 0 || search.trim() !== "" */
  hasActiveFilter: boolean;
  /** The full owner/priority/state/search filter applied — same `items`
   *  prop BoardView receives today. Rendered as a flat row list the
   *  moment `hasActiveFilter` is true. */
  filteredItems: GoLiveItem[];
  /** Owner/priority/search only, states excluded, so selecting one ribbon
   *  chip never zeroes the other three counts. The live source for both
   *  the ribbon's own counts and the default (no active filter) in-flight
   *  rows. */
  scopeItems: GoLiveItem[];
  todoTotalCount: number;
  todoSampleItems: GoLiveItem[];
  doneTotalCount: number;
  doneSampleItems: GoLiveItem[];
  onOpen: (item: GoLiveItem) => void;
};

export function MobileRibbonBoard({
  filters,
  onFiltersChange,
  hasActiveFilter,
  filteredItems,
  scopeItems,
  todoTotalCount,
  todoSampleItems,
  doneTotalCount,
  doneSampleItems,
  onOpen,
}: MobileRibbonBoardProps) {
  const countsByState: Record<GoLiveFilterState, number> = RIBBON_STATES.reduce(
    (acc, s) => {
      acc[s.key] = scopeItems.filter((item) => itemFilterState(item) === s.key).length;
      return acc;
    },
    {} as Record<GoLiveFilterState, number>
  );

  const inFlight = scopeItems.filter((item) => RIBBON_STATES.some((s) => s.key === itemFilterState(item)));

  return (
    <div className="space-y-3">
      {/* This strip pins to the top of the scroll container itself
          (`top-0`), not beneath FilterBar.tsx (Kevin's decision, H56,
          2026-09-17): once sticky genuinely started working below `lg`,
          FilterBar plus this strip together would have permanently
          occupied roughly 28% of a 390x844 phone viewport (185px
          measured FilterBar height + this strip, against an 844px-tall
          viewport). Below `lg`, FilterBar now scrolls away with the rest
          of the page content (see its own className comment in
          FilterBar.tsx) and only this strip stays pinned, so there is no
          filter bar height left to sit under — `var(--go-live-filter-h,
          ...)` would be the wrong offset here now (it still exists,
          published unconditionally, but only DesktopBoardGrid's column
          headers in BoardView.tsx consume it, at `lg` and up, where this
          component never renders at all). Nothing between this element
          and the page's own scroll container may set `overflow-hidden`,
          or that ancestor becomes the sticky containing block and
          `top-0` is measured from the wrong edge. */}
      <div
        role="group"
        aria-label="Filter by status"
        className="sticky top-0 z-10 -mx-6 flex items-center gap-1.5 overflow-x-auto bg-[#f0f2f7]/95 px-6 py-2 backdrop-blur dark:bg-[#0f172a]/95"
      >
        {RIBBON_STATES.map((s) => {
          const active = filters.states.includes(s.key);
          return (
            <button
              key={s.key}
              type="button"
              onClick={() => onFiltersChange({ ...filters, states: toggleValue(filters.states, s.key) })}
              aria-pressed={active}
              className={`min-h-8 shrink-0 rounded-full px-3 text-[11px] font-bold transition-colors active:scale-95 ${
                active ? "bg-indigo-600 text-white" : "bg-slate-100 text-slate-600 dark:bg-white/5 dark:text-slate-300"
              }`}
            >
              {s.label} <span className="money">{countsByState[s.key]}</span>
            </button>
          );
        })}
      </div>

      {hasActiveFilter ? (
        <div className="space-y-3">
          <SectionHeading count={filteredItems.length}>Results</SectionHeading>
          <div className="space-y-1.5">
            {filteredItems.map((item) => (
              <ItemRow key={item.id} item={item} onOpen={() => onOpen(item)} />
            ))}
            {filteredItems.length === 0 && (
              <p className="px-1 py-6 text-center text-xs text-slate-400 dark:text-slate-500">No items match the current filters.</p>
            )}
          </div>
        </div>
      ) : (
        <>
          <div className="space-y-1.5">
            {inFlight.map((item) => (
              <ItemRow key={item.id} item={item} onOpen={() => onOpen(item)} />
            ))}
            {inFlight.length === 0 && (
              <p className="px-1 py-6 text-center text-xs text-slate-400 dark:text-slate-500">Nothing in flight right now.</p>
            )}
          </div>
          <div className="space-y-2.5 pt-1">
            <CollapsedSection label="To do" totalCount={todoTotalCount} sampleItems={todoSampleItems} onOpen={onOpen} />
            <CollapsedSection label="Done" totalCount={doneTotalCount} sampleItems={doneSampleItems} onOpen={onOpen} />
          </div>
        </>
      )}
    </div>
  );
}
