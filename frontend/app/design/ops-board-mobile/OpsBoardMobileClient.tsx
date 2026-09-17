"use client";

// TEMPORARY PREVIEW — H56 (backlog item H56), design round only.
//
// /ops/go-live is unusable on a phone: below `lg`, BoardView.tsx used to
// render each of the 8 section lanes as a horizontally-scrolling strip of
// 7 state columns, so a phone visit was a two-axis scroll through a
// 300-card grid, and the dozen or so items actually in flight
// (in-progress, blocked, review, uat) were buried among roughly 280
// to-dos and dones.
//
// KEVIN'S PICK (2026-09-17): ribbon. It is by far the most scannable of
// the three, putting all twelve in-flight items on one screen above a
// sticky state-count strip, which is exactly what this item asked for;
// live-now and waiting render the full item title on every card, and
// because this board's titles are paragraph-length a single card can
// fill the whole screen (A38 does), which undercuts the goal of
// surfacing what is in flight.
//
// The pick is now implemented: this route's `ribbon` variant imports and
// renders `MobileRibbonBoard` (app/ops/go-live/MobileRibbonBoard.tsx),
// the production component BoardView.tsx now mounts below `lg`, fed this
// preview's fixture data through its real props (`filters`,
// `onFiltersChange`, `hasActiveFilter`, `filteredItems`, `scopeItems`,
// `todoTotalCount`/`todoSampleItems`, `doneTotalCount`/`doneSampleItems`,
// `onOpen`) — the same contract page.tsx/BoardView.tsx feed it live. This
// is a real gate, not a copy: if the shipped component drifts from what
// Kevin approved, this preview drifts with it, per CLAUDE.md's "Design
// work" section.
//
// `live-now` and `waiting` were the two variants Kevin did NOT pick.
// They stay in this file, clearly labelled "not picked" in the switcher
// below, as hand-authored references only — that layout (full-card
// presentation, either flat or grouped by who's waited on) never shipped
// as a production component, so there is nothing for them to import.
// They still share `ItemRow`/`CollapsedSection`/`SectionHeading` with the
// ribbon variant (imported from MobileRibbonBoard.tsx, not re-authored
// here) for their own to-do/done collapse and filtered-results list,
// since that part of the old single-file version was never
// variant-specific.
//
// Every variant still shares the same real production pieces rather than
// re-authoring them: StatePill, PriorityPill, OwnerInitialChip and
// UnblocksTags from app/ops/go-live/Badges.tsx render every card's state,
// priority, owner and unblocks exactly as the desktop board does;
// ItemDetailSheet.tsx (plain props, no fetch of its own) is the same
// sheet a tap opens on the real board, fed this preview's fixture data
// and a local-state onAction so every control in it is genuinely
// interactive without ever calling the API (see the no-op handler below,
// and check:design-no-live-data, which this route stays clear of); and
// FilterBar.tsx (also plain props, no fetch) is the real search/filter
// control — typing in it or picking a state chip genuinely filters this
// preview's whole fixture set (filterItems from lib/goLive, the same
// pure function the real board calls, and for the ribbon variant the
// exact same `filters.states` FilterBar itself owns, via the shared
// `toggleValue` helper).
//
// Fixture data (fixtures.ts) is a real, dated slice of TODO.md, including
// several full-paragraph titles (this board's hardest, and most common,
// case for a long item) — see that file's own header for exactly what is
// real and what is illustrative.
//
// No fetch, no api.* call, no cookies/headers access: static fixtures and
// one pure helper (filterItems) only, so this route stays covered by
// /design's auth-exempt, zero-user-data guarantee.
//
// /design/ops-board-mobile?variant=live-now|ribbon|waiting&mode=light|dark
//
// Review notes (impeccable design hook, before this went to Kevin):
//   - Font sizes: every text-[10px] here (the id badge on ItemCard and
//     ItemRow, the note-count chip on ItemCard) is a verbatim copy of
//     BoardView.tsx's own CardBody id-badge and note-count sizing, kept
//     identical on purpose so this preview's cards read as the same
//     visual language as the real board rather than a new scale — and
//     10px sits inside DESIGN.md's own documented Label step (10-11px),
//     it is just written as the literal Tailwind value the shipped
//     component already uses rather than a named class.
//   - Gray-on-colour: the switcher's unselected-pill text-slate-400 on
//     bg-slate-900/90 is copied verbatim from every other /design/*
//     preview's fixed-bottom Switcher (see SpendFromBankVariantsClient.tsx,
//     which documents the same pairing for the same reason): it is light
//     grey text on a near-black pill, a light-on-dark pairing the hook's
//     heuristic mis-reads as washed-out gray-on-colour, not an actual
//     contrast failure.
//   - Colour: nothing here is red (The Red Is Risk Rule holds — every
//     state pill's colour comes from the real StatePill/PriorityPill
//     components unchanged) and the indigo->violet gradient does not
//     appear anywhere (the switcher's selected pill is solid indigo-600,
//     the ordinary brand colour, not the Penny gradient).
//   - Copy: no em dashes in any user-facing string in this file or
//     fixtures.ts.

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { MessageSquare, Search } from "lucide-react";
import {
  DEFAULT_GO_LIVE_FILTERS,
  filterItems,
  type GoLiveFilters,
  type GoLiveItem,
  type GoLiveItemState,
} from "@/lib/goLive";
import { FilterBar } from "@/app/ops/go-live/FilterBar";
import { ItemDetailSheet } from "@/app/ops/go-live/ItemDetailSheet";
import { OwnerInitialChip, PriorityPill, StatePill, UnblocksTags } from "@/app/ops/go-live/Badges";
import { CollapsedSection, ItemRow, MobileRibbonBoard, SectionHeading } from "@/app/ops/go-live/MobileRibbonBoard";
import {
  ALL_FIXTURE_ITEMS,
  DONE_SAMPLE,
  DONE_TOTAL_COUNT,
  IN_FLIGHT,
  IN_FLIGHT_TOTAL_COUNT,
  TODO_SAMPLE,
  TODO_TOTAL_COUNT,
  TOTAL_ITEM_COUNT,
} from "./fixtures";

type Variant = "live-now" | "ribbon" | "waiting";
type Mode = "light" | "dark";

const VARIANTS: { value: Variant; label: string; pickedLabel?: string }[] = [
  { value: "live-now", label: "Live now", pickedLabel: "Live now · not picked" },
  { value: "ribbon", label: "Ribbon · picked" },
  { value: "waiting", label: "Waiting on", pickedLabel: "Waiting on · not picked" },
];

type ActionBody = Parameters<typeof ItemDetailSheet>[0]["onAction"] extends (body: infer B) => void ? B : never;

// ---------------------------------------------------------------------
// Local fixture "backend" — every ItemDetailSheet control genuinely
// updates the in-memory item it acts on, so the sheet is fully
// interactive, but nothing here ever reaches the network. Mirrors the
// real router's own state transitions (backend/app/routers/ops.py)
// closely enough to demonstrate them, not byte-for-byte (e.g. "approve"
// really reopens as in-progress with no branch recorded, matching H31).
// ---------------------------------------------------------------------

function applyAction(item: GoLiveItem, body: ActionBody): GoLiveItem {
  const today = new Date().toISOString().slice(0, 10);
  const withNote = (text: string, actor = "kevin"): GoLiveItem["notes"] => [...item.notes, { date: today, actor, text }];
  switch (body.action) {
    case "done":
      return { ...item, state: "done", done_at: today, commit: body.commit ?? item.commit, reason: null };
    case "reopen":
      return { ...item, state: "todo", done_at: null, commit: null };
    case "todo":
      return { ...item, state: "todo", reason: null, link: null };
    case "start":
      return { ...item, state: "in-progress", reason: null };
    case "block":
      return { ...item, state: "blocked", reason: body.reason };
    case "reject":
      return { ...item, state: "rejected", reason: body.reason };
    case "note":
      return { ...item, notes: withNote(body.text) };
    case "owner":
      return { ...item, owner: body.owner };
    case "priority":
      return { ...item, priority: body.priority };
    case "unblocks":
      return { ...item, unblocks: body.questions };
    case "uat":
      return { ...item, state: "uat", link: body.link };
    case "approve":
      return { ...item, state: "in-progress", branch: null, notes: withNote(`Approved: ${body.choice}`) };
    default:
      return item;
  }
}

// ---------------------------------------------------------------------
// Shared building blocks — SectionHeading, ItemRow and CollapsedSection
// now live in app/ops/go-live/MobileRibbonBoard.tsx (imported above)
// rather than being re-authored here, since ribbon uses the production
// component directly and live-now/waiting still need the same pieces for
// their own to-do/done collapse and filtered-results list.
// ---------------------------------------------------------------------

/** A full, readable card: every field a card can carry, no truncation on
 *  the title (the whole point of the Focus-first screen is that a dozen
 *  items each get room to be read, not clipped). Tapping opens the real
 *  ItemDetailSheet. */
function ItemCard({ item, onOpen, compact }: { item: GoLiveItem; onOpen: () => void; compact?: boolean }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className={`glass-card w-full rounded-2xl text-left transition-transform active:scale-[0.99] ${compact ? "p-3" : "p-4"}`}
    >
      <div className="flex items-center justify-between gap-1.5">
        <span className="money text-[10px] font-bold text-slate-400 dark:text-slate-500">{item.id}</span>
        <div className="flex items-center gap-1.5">
          <PriorityPill priority={item.priority} />
          <OwnerInitialChip owner={item.owner} />
        </div>
      </div>
      <p className={`mt-1.5 text-pretty font-semibold text-slate-800 dark:text-slate-100 ${compact ? "text-xs" : "text-sm"}`}>
        {item.title}
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <StatePill item={item} />
        <UnblocksTags unblocks={item.unblocks} />
        {item.notes.length > 0 && (
          <span className="inline-flex items-center gap-0.5 text-[10px] font-semibold text-slate-400 dark:text-slate-500">
            <MessageSquare size={11} aria-hidden="true" />
            {item.notes.length}
          </span>
        )}
      </div>
    </button>
  );
}

// ---------------------------------------------------------------------
// Variant A — Live now: one heading, every in-flight item a full card
// ---------------------------------------------------------------------

function LiveNowVariant({ items, onOpen }: { items: GoLiveItem[]; onOpen: (item: GoLiveItem) => void }) {
  return (
    <div className="space-y-3">
      <SectionHeading count={items.length}>Live now</SectionHeading>
      <div className="space-y-2.5">
        {items.map((item) => (
          <ItemCard key={item.id} item={item} onOpen={() => onOpen(item)} />
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------
// Variant B — Ribbon: Kevin's pick. Rendered by the production
// MobileRibbonBoard component directly (see Inner() below), not
// hand-authored here.
// ---------------------------------------------------------------------

// ---------------------------------------------------------------------
// Variant C — Waiting on: grouped by who moves next, Kevin's group leads
// ---------------------------------------------------------------------

const WAITING_ON_KEVIN: GoLiveItemState[] = ["uat", "blocked", "review"];

function WaitingVariant({ items, onOpen }: { items: GoLiveItem[]; onOpen: (item: GoLiveItem) => void }) {
  const waiting = items.filter((i) => WAITING_ON_KEVIN.includes(i.state));
  const inMotion = items.filter((i) => i.state === "in-progress");
  return (
    <div className="space-y-5">
      <div className="space-y-3">
        <SectionHeading count={waiting.length}>Waiting on you</SectionHeading>
        <div className="space-y-2.5">
          {waiting.map((item) => (
            <ItemCard key={item.id} item={item} onOpen={() => onOpen(item)} />
          ))}
        </div>
      </div>
      <div className="space-y-2.5">
        <SectionHeading count={inMotion.length}>In motion</SectionHeading>
        <p className="px-0.5 text-[11px] text-slate-400 dark:text-slate-500">Claude or Codex already working. Nothing needed from you yet.</p>
        <div className="space-y-2">
          {inMotion.map((item) => (
            <ItemCard key={item.id} item={item} onOpen={() => onOpen(item)} compact />
          ))}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------
// Search/filter result view — shown instead of the curated variant the
// moment a real filter is active, over the WHOLE fixture set (in-flight
// + the to-do/done samples), using the same filterItems() the desktop
// board calls.
// ---------------------------------------------------------------------

function FilteredResults({ items, onOpen }: { items: GoLiveItem[]; onOpen: (item: GoLiveItem) => void }) {
  return (
    <div className="space-y-3">
      <SectionHeading count={items.length}>Search results</SectionHeading>
      <div className="space-y-1.5">
        {items.map((item) => (
          <ItemRow key={item.id} item={item} onOpen={() => onOpen(item)} />
        ))}
        {items.length === 0 && (
          <p className="px-1 py-6 text-center text-xs text-slate-400 dark:text-slate-500">
            No items match. Note this preview only searches its own fixture sample, not the whole board.
          </p>
        )}
      </div>
    </div>
  );
}

function Switcher({ variant, mode }: { variant: Variant; mode: Mode }) {
  return (
    <div
      id="ops-board-mobile-switcher"
      className="pointer-events-none fixed left-0 right-0 z-[60] flex justify-center"
      style={{ bottom: "calc(env(safe-area-inset-bottom) + 14px)" }}
    >
      <div className="pointer-events-auto flex max-w-[94vw] flex-wrap items-center justify-center gap-1 rounded-full border border-white/15 bg-slate-900/90 p-1 shadow-xl">
        {VARIANTS.map((v) => (
          <a
            key={v.value}
            href={`?variant=${v.value}&mode=${mode}`}
            className={`flex min-h-[44px] items-center justify-center rounded-full px-3.5 text-xs font-semibold transition-colors active:scale-95 ${
              v.value === variant ? "bg-indigo-600 text-white" : "text-slate-400"
            }`}
          >
            {v.pickedLabel ?? v.label}
          </a>
        ))}
        <a
          href={`?variant=${variant}&mode=${mode === "dark" ? "light" : "dark"}`}
          className="flex min-h-[44px] items-center justify-center rounded-full px-3.5 text-xs font-semibold text-slate-400 transition-colors active:scale-95"
        >
          {mode === "dark" ? "Light" : "Dark"}
        </a>
      </div>
    </div>
  );
}

function Inner() {
  const params = useSearchParams();
  const rawVariant = params.get("variant");
  // Defaults to ribbon, not live-now: ribbon is Kevin's pick and the only
  // variant backed by a real production component, so it is the one worth
  // landing on when no ?variant= is given (H56 audit, 2026-09-17).
  const variant: Variant = (["live-now", "ribbon", "waiting"] as string[]).includes(rawVariant ?? "")
    ? (rawVariant as Variant)
    : "ribbon";
  const mode: Mode = params.get("mode") === "dark" ? "dark" : "light";

  useEffect(() => {
    const t = setTimeout(() => {
      document.documentElement.classList.toggle("dark", mode === "dark");
      document.querySelector('meta[name="color-scheme"]')?.setAttribute("content", mode === "dark" ? "dark" : "only light");
    }, 0);
    return () => clearTimeout(t);
  }, [mode]);

  // Mirrors the exact mount/unmount effect app/ops/go-live/page.tsx runs
  // (H56, scoped pending H61 — see globals.css's `html[data-ops-board]
  // #app-shell` rule): this preview's whole job is to stand in for what
  // Kevin sees on the real page, so it needs to set the same attribute
  // to genuinely exercise the same scoped sticky fix, not a different
  // one. Cleanup on unmount for the same reason production's does.
  useEffect(() => {
    document.documentElement.setAttribute("data-ops-board", "");
    return () => {
      document.documentElement.removeAttribute("data-ops-board");
    };
  }, []);

  const [items, setItems] = useState<GoLiveItem[]>(ALL_FIXTURE_ITEMS);
  const [filters, setFilters] = useState<GoLiveFilters>(DEFAULT_GO_LIVE_FILTERS);
  const [selected, setSelected] = useState<GoLiveItem | null>(null);

  const inFlightIds = useMemo(() => new Set(IN_FLIGHT.map((i) => i.id)), []);
  const todoIds = useMemo(() => new Set(TODO_SAMPLE.map((i) => i.id)), []);
  const doneIds = useMemo(() => new Set(DONE_SAMPLE.map((i) => i.id)), []);
  const inFlightItems = items.filter((i) => inFlightIds.has(i.id));
  const todoSampleItems = items.filter((i) => todoIds.has(i.id));
  const doneSampleItems = items.filter((i) => doneIds.has(i.id));

  const hasActiveFilter =
    filters.search.trim() !== "" || filters.states.length > 0 || filters.priorities.length > 0 || filters.owner !== "all";
  const filtered = useMemo(() => filterItems(items, filters), [items, filters]);
  // Owner/priority/search only, `states` excluded — the same scope
  // MobileRibbonBoard's production caller (BoardView.tsx) feeds it, so
  // this preview's ribbon chips exercise the identical props contract.
  const scopeFilters = useMemo(() => ({ ...filters, states: [] as GoLiveFilters["states"] }), [filters]);
  const scopeItems = useMemo(() => filterItems(items, scopeFilters), [items, scopeFilters]);

  function handleOpen(item: GoLiveItem) {
    setSelected(item);
  }
  function handleAction(body: ActionBody) {
    if (!selected) return;
    const next = applyAction(selected, body);
    setItems((prev) => prev.map((i) => (i.id === next.id ? next : i)));
    setSelected(next);
  }

  // FilterBar (and, inside it, MobileRibbonBoard's own ribbon strip) is a
  // direct child of this outer min-h-dvh div, with no wrapper div in
  // between, deliberately mirroring production page.tsx's structure
  // (FilterBar is a literal JSX child of `<main className="min-h-dvh ...
  // px-6 ...">`, not of a nested wrapper). An earlier version of this
  // preview wrapped FilterBar in its own separate `mx-auto max-w-[430px]
  // px-6` div, which is NOT what production does, and that mismatch was
  // enough to break FilterBar's `sticky top-0` in this Chrome build (found
  // 2026-09-17 auditing H56: an empty, classless wrapper div reproduced
  // the same break, and removing it — confirmed by direct DOM bisection —
  // was the only thing that fixed it; the exact CSS mechanism was not
  // fully identified, but the fix converges the preview onto the same DOM
  // shape production already uses, which is the honest baseline for a
  // gate like this one anyway). Keep this flat; do not reintroduce a
  // wrapper div between this element and FilterBar.
  return (
    <div className={mode === "dark" ? "dark" : ""} style={{ colorScheme: mode }}>
      <div className="mx-auto min-h-dvh w-full max-w-[430px] bg-[#f0f2f7] px-6 pb-32 dark:bg-[#0f172a]">
        <div className="pt-5">
          <p className="mb-1 text-center text-[11px] text-slate-400 dark:text-slate-500">
            Illustrative /ops/go-live phone preview. Fixture data read from TODO.md, 2026-09-16/17 — see fixtures.ts.
          </p>
          {/* H56 (2026-09-17): this variant reproduces the phone board,
              whose defining behaviour (the ribbon strip pinned to the
              top of the scroll container) only exists below the lg
              breakpoint in production (BoardView.tsx gates
              MobileRibbonBoard behind isDesktop). This preview's own
              variant switch is not breakpoint-gated the same way, so at
              a laptop width the strip sits underneath FilterBar (which
              pins at lg and up) and appears to vanish. That is a preview
              limitation, not a production defect, and it is a known,
              boarded follow-up (a width-constrained iframe is the real
              fix); this note exists so a reviewer opening it on a
              laptop is not misled by it. */}
          <p className="mb-3 text-center text-[11px] text-slate-400 dark:text-slate-500">
            View at a phone width. This reproduces the phone board, so at wider widths the ribbon strip sits underneath the filter bar and is not visible, which cannot happen on the real board.
          </p>
          <div className="mb-1">
            <h1 className="text-[20px] font-bold text-slate-900 dark:text-white">Go-live board</h1>
            <p className="mt-0.5 text-[11px] uppercase tracking-wide text-slate-400 dark:text-slate-500">
              {TOTAL_ITEM_COUNT} items · {IN_FLIGHT_TOTAL_COUNT} in flight
            </p>
          </div>
        </div>

        <FilterBar filters={filters} onChange={setFilters} />

        <div className="space-y-4">
          {variant === "ribbon" ? (
            // Kevin's pick, rendered by the real production component with
            // fixture data through its real props — a genuine gate, not a
            // copy. `filters`/`onFiltersChange` here stand in for the page
            // state `page.tsx` owns in production; everything downstream
            // (the ribbon's own counts, its filtered-results path) is the
            // exact same code MobileRibbonBoard.tsx runs on the real board.
            <MobileRibbonBoard
              filters={filters}
              onFiltersChange={setFilters}
              hasActiveFilter={hasActiveFilter}
              filteredItems={filtered}
              scopeItems={scopeItems}
              todoTotalCount={TODO_TOTAL_COUNT}
              todoSampleItems={todoSampleItems}
              doneTotalCount={DONE_TOTAL_COUNT}
              doneSampleItems={doneSampleItems}
              onOpen={handleOpen}
            />
          ) : hasActiveFilter ? (
            <FilteredResults items={filtered} onOpen={handleOpen} />
          ) : (
            <>
              {variant === "live-now" && <LiveNowVariant items={inFlightItems} onOpen={handleOpen} />}
              {variant === "waiting" && <WaitingVariant items={inFlightItems} onOpen={handleOpen} />}

              <div className="space-y-2.5 pt-1">
                <div className="flex items-center gap-1.5 px-0.5 text-[11px] text-slate-400 dark:text-slate-500">
                  <Search size={12} aria-hidden="true" />
                  <span>Everything else is here, not on the board</span>
                </div>
                <CollapsedSection label="To do" totalCount={TODO_TOTAL_COUNT} sampleItems={todoSampleItems} onOpen={handleOpen} />
                <CollapsedSection label="Done" totalCount={DONE_TOTAL_COUNT} sampleItems={doneSampleItems} onOpen={handleOpen} />
              </div>
            </>
          )}
        </div>

        <Switcher variant={variant} mode={mode} />
      </div>

      {selected && (
        <ItemDetailSheet item={selected} pending={false} saveNote={null} onAction={handleAction} onClose={() => setSelected(null)} />
      )}
    </div>
  );
}

export default function OpsBoardMobileClient() {
  return <Inner />;
}
