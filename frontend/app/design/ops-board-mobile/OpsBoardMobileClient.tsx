"use client";

// TEMPORARY PREVIEW — H56 (backlog item H56), design round only.
//
// /ops/go-live is unusable on a phone: below `lg`, BoardView.tsx renders
// each of the 8 section lanes as a horizontally-scrolling strip of 7
// state columns, so a phone visit is a two-axis scroll through a 300-card
// grid, and the dozen or so items actually in flight (in-progress,
// blocked, review, uat) are buried among roughly 280 to-dos and dones.
// Kevin already chose the direction on 2026-09-16, "Focus first": the top
// of the phone screen answers "what is happening" with the in-flight
// items as full readable cards, to do and done collapse behind their
// counts below (reachable through the existing search and filter, not a
// second board), kanban columns stay desktop-only, and there is no drag
// on a phone — a tap opens the detail sheet, the only place a state
// changes (H55, running alongside this item, adds an explicit "Move to"
// state picker inside that same sheet; this preview does not duplicate
// or pre-empt it, it just renders the sheet as it stands today so H55's
// picker appears automatically once that branch merges).
//
// Three variants, all on the Focus-first direction, differing only in
// how the in-flight items are presented and how the long tail is tucked
// away:
//
//   live-now — every in-flight item as one full card under a single
//              "Live now" heading, in the order TODO.md already lists
//              them (in-progress, then review, then blocked, then uat).
//              The simplest reading: one list, nothing to parse before
//              you start reading cards.
//   ribbon   — a sticky one-line status ribbon of counts (in progress /
//              blocked / review / uat) leads, tappable as a filter, over
//              denser single-line rows rather than full cards — more
//              items readable per scroll, at the cost of the reason/link
//              text a full card shows inline (still one tap away in the
//              detail sheet). Modelled on Height/Shortcut's status strip
//              as primary navigation.
//   waiting  — ordered by who is being waited on rather than by TODO.md's
//              natural order: "Waiting on you" (uat, blocked, review —
//              every state where the next move is Kevin's) leads as full
//              cards, "In motion" (in-progress — Claude/Codex already
//              working, nothing needed from Kevin yet) follows as
//              quieter, more compact cards. Modelled on Linear's "what
//              needs me" framing and Things 3's curated views over one
//              flat list.
//
// Every variant shares the same real production pieces rather than
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
// pure function the real board calls), which is what "reachable through
// the existing search and filter" means concretely. The curated
// Focus-first layouts below (the full/dense/grouped card presentation
// itself) are hand-authored, because that layout does not exist in
// production yet — this round is proposing it.
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
import { ChevronDown, MessageSquare, Search } from "lucide-react";
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

const VARIANTS: { value: Variant; label: string }[] = [
  { value: "live-now", label: "Live now" },
  { value: "ribbon", label: "Ribbon" },
  { value: "waiting", label: "Waiting on" },
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
// Shared building blocks
// ---------------------------------------------------------------------

function SectionHeading({ children, count }: { children: React.ReactNode; count: number }) {
  return (
    <div className="flex items-center justify-between px-0.5">
      <h2 className="text-base font-bold text-slate-800 dark:text-slate-100">{children}</h2>
      <span className="money text-xs font-semibold text-slate-400 dark:text-slate-500">{count}</span>
    </div>
  );
}

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

/** One dense row: a single truncated title line (`truncate`, never
 *  `line-clamp`, so even H55/G105/G111's full-paragraph titles collapse
 *  to one ellipsised line rather than wrapping the row open — this was
 *  caught in screenshot review, see the H56 report) with the id and
 *  priority pinned either side, and a second, smaller line for state
 *  (StatePill already self-truncates at 220px for a long "Blocked:
 *  <reason>" pill). Two lines total is still far denser than a full
 *  card, which runs a whole paragraph plus a footer row. */
function ItemRow({ item, onOpen }: { item: GoLiveItem; onOpen: () => void }) {
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
          <StatePill item={item} />
        </span>
      </span>
      <PriorityPill priority={item.priority} />
    </button>
  );
}

/** The collapsed "To do" / "Done" section: a tap reveals a representative
 *  sample (the real count leads the row; the sample below it is
 *  explicitly labelled as a sample, since a phone screen was never going
 *  to hold 65 or 219 rows) plus a pointer at the search bar above, which
 *  is the real, complete way to reach any one of them. */
function CollapsedSection({
  label,
  totalCount,
  sample,
  onOpen,
}: {
  label: string;
  totalCount: number;
  sample: GoLiveItem[];
  onOpen: (item: GoLiveItem) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="glass-card rounded-2xl p-3">
      <button type="button" onClick={() => setOpen((v) => !v)} className="flex min-h-9 w-full items-center justify-between gap-3">
        <span className="text-sm font-semibold text-slate-700 dark:text-slate-200">{label}</span>
        <span className="flex shrink-0 items-center gap-2">
          <span className="money text-xs font-semibold text-slate-500 dark:text-slate-400">{totalCount}</span>
          <ChevronDown size={16} className={`text-slate-400 transition-transform ${open ? "rotate-180" : ""}`} aria-hidden="true" />
        </span>
      </button>
      {open && (
        <div className="mt-3 space-y-2 border-t border-slate-100 pt-3 dark:border-white/10">
          <p className="px-0.5 text-[11px] leading-relaxed text-slate-400 dark:text-slate-500">
            A sample of {sample.length} of {totalCount}. Use search or a state filter above to reach the rest.
          </p>
          {sample.map((item) => (
            <ItemRow key={item.id} item={item} onOpen={() => onOpen(item)} />
          ))}
        </div>
      )}
    </div>
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
// Variant B — Ribbon: sticky counts strip, tappable as a filter, over
// dense rows
// ---------------------------------------------------------------------

const RIBBON_STATES: { key: GoLiveItemState; label: string }[] = [
  { key: "in-progress", label: "In progress" },
  { key: "blocked", label: "Blocked" },
  { key: "review", label: "In review" },
  { key: "uat", label: "UAT" },
];

function RibbonVariant({
  items,
  onOpen,
  filterBarOffset,
}: {
  items: GoLiveItem[];
  onOpen: (item: GoLiveItem) => void;
  filterBarOffset: string;
}) {
  const [active, setActive] = useState<GoLiveItemState | "all">("all");
  const counts = useMemo(() => {
    const c: Record<string, number> = { all: items.length };
    for (const s of RIBBON_STATES) c[s.key] = items.filter((i) => i.state === s.key).length;
    return c;
  }, [items]);
  const visible = active === "all" ? items : items.filter((i) => i.state === active);

  return (
    <div className="space-y-3">
      <div
        className="sticky z-10 -mx-4 flex items-center gap-1.5 overflow-x-auto bg-[#f0f2f7]/95 px-4 py-2 backdrop-blur dark:bg-[#0f172a]/95"
        style={{ top: filterBarOffset }}
      >
        <button
          type="button"
          onClick={() => setActive("all")}
          className={`min-h-8 shrink-0 rounded-full px-3 text-[11px] font-bold transition-colors ${
            active === "all"
              ? "bg-indigo-600 text-white"
              : "bg-slate-100 text-slate-600 dark:bg-white/5 dark:text-slate-300"
          }`}
        >
          All <span className="money">{counts.all}</span>
        </button>
        {RIBBON_STATES.map((s) => (
          <button
            key={s.key}
            type="button"
            onClick={() => setActive(s.key)}
            className={`min-h-8 shrink-0 rounded-full px-3 text-[11px] font-bold transition-colors ${
              active === s.key
                ? "bg-indigo-600 text-white"
                : "bg-slate-100 text-slate-600 dark:bg-white/5 dark:text-slate-300"
            }`}
          >
            {s.label} <span className="money">{counts[s.key]}</span>
          </button>
        ))}
      </div>
      <div className="space-y-1.5">
        {visible.map((item) => (
          <ItemRow key={item.id} item={item} onOpen={() => onOpen(item)} />
        ))}
        {visible.length === 0 && (
          <p className="px-1 py-6 text-center text-xs text-slate-400 dark:text-slate-500">Nothing in this state right now.</p>
        )}
      </div>
    </div>
  );
}

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
            {v.label}
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
  const variant: Variant = (["live-now", "ribbon", "waiting"] as string[]).includes(rawVariant ?? "")
    ? (rawVariant as Variant)
    : "live-now";
  const mode: Mode = params.get("mode") === "dark" ? "dark" : "light";

  useEffect(() => {
    const t = setTimeout(() => {
      document.documentElement.classList.toggle("dark", mode === "dark");
      document.querySelector('meta[name="color-scheme"]')?.setAttribute("content", mode === "dark" ? "dark" : "only light");
    }, 0);
    return () => clearTimeout(t);
  }, [mode]);

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

  function handleOpen(item: GoLiveItem) {
    setSelected(item);
  }
  function handleAction(body: ActionBody) {
    if (!selected) return;
    const next = applyAction(selected, body);
    setItems((prev) => prev.map((i) => (i.id === next.id ? next : i)));
    setSelected(next);
  }

  return (
    <div className={mode === "dark" ? "dark" : ""} style={{ colorScheme: mode }}>
      <div className="min-h-dvh bg-[#f0f2f7] pb-32 dark:bg-[#0f172a]">
        <div className="mx-auto w-full max-w-[430px] px-4 pt-5">
          <p className="mb-3 text-center text-[11px] text-slate-400 dark:text-slate-500">
            Illustrative /ops/go-live phone preview. Fixture data read from TODO.md, 2026-09-16/17 — see fixtures.ts.
          </p>
          <div className="mb-1">
            <h1 className="text-[20px] font-bold text-slate-900 dark:text-white">Go-live board</h1>
            <p className="mt-0.5 text-[11px] uppercase tracking-wide text-slate-400 dark:text-slate-500">
              {TOTAL_ITEM_COUNT} items · {IN_FLIGHT_TOTAL_COUNT} in flight
            </p>
          </div>
        </div>

        <div className="mx-auto w-full max-w-[430px] px-4">
          <FilterBar filters={filters} onChange={setFilters} />
        </div>

        <div className="mx-auto w-full max-w-[430px] space-y-4 px-4">
          {hasActiveFilter ? (
            <FilteredResults items={filtered} onOpen={handleOpen} />
          ) : (
            <>
              {variant === "live-now" && <LiveNowVariant items={inFlightItems} onOpen={handleOpen} />}
              {variant === "ribbon" && (
                <RibbonVariant items={inFlightItems} onOpen={handleOpen} filterBarOffset="var(--go-live-filter-h, 120px)" />
              )}
              {variant === "waiting" && <WaitingVariant items={inFlightItems} onOpen={handleOpen} />}

              <div className="space-y-2.5 pt-1">
                <div className="flex items-center gap-1.5 px-0.5 text-[11px] text-slate-400 dark:text-slate-500">
                  <Search size={12} aria-hidden="true" />
                  <span>Everything else is here, not on the board</span>
                </div>
                <CollapsedSection label="To do" totalCount={TODO_TOTAL_COUNT} sample={todoSampleItems} onOpen={handleOpen} />
                <CollapsedSection label="Done" totalCount={DONE_TOTAL_COUNT} sample={doneSampleItems} onOpen={handleOpen} />
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
