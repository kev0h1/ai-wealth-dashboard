"use client";

// Kanban board: columns To do / In progress / Blocked / In review / Done,
// swimlanes by section or owner (toggle), each lane collapsible and
// showing counts per column. Below `lg` this scrolls horizontally per lane,
// with the lane label sticky on the left of that scroller. At `lg` and up
// it switches to a true CSS grid instead — lane label as a fixed-width
// first column, five equal columns, column headers sticky to the top of
// the board, no horizontal scroll needed at 1280px+ — see
// `DesktopBoardGrid` below. The two layouts are mutually exclusive in the
// DOM (gated by `useIsDesktop`, not just CSS `hidden`/`lg:` classes):
// dnd-kit registers every mounted draggable/droppable by id regardless of
// visibility, so rendering both trees at once would double-register every
// card and cell id and corrupt collision detection.
//
// Drag and drop (dnd-kit): a card can be dragged straight onto a column
// cell as a shortcut for the state change a tap into the detail sheet
// would otherwise require. Every state change is still a normal item
// action under the hood (drops are optimistic, then reconciled from the
// server response like every other action on this page) — dragging never
// bypasses `onAction`. See the drop-mapping comment above `handleDragEnd`
// for the exact column/lane rules. Tapping a card without dragging still
// opens `ItemDetailSheet` as before.
//
// Collision detection: `pointerWithin` first, `closestCenter` as a
// fallback only when the pointer isn't literally over any droppable (e.g.
// dropped in the gap between cells). `closestCenter` alone compares
// droppable *rect centres* to the pointer, not containment — with cells of
// very different heights (a tall "In progress" column full of cards next
// to a short, maybe-empty "To do" column) the pointer can be visually
// inside "To do" while its centre is still numerically closer to "In
// progress"'s much taller rect, so the drop silently lands on the wrong
// column. That is the root cause behind cards getting stuck in In
// progress when dragged back to To do. `pointerWithin` checks actual
// pointer containment first, which fixes it.

import { Fragment, useEffect, useState } from "react";
import { ChevronDown, MessageSquare } from "lucide-react";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  closestCenter,
  pointerWithin,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import type { api } from "@/lib/api";
import {
  BOARD_COLUMNS,
  groupItemsByOwner,
  groupItemsBySection,
  type GoLiveItem,
  type GoLiveItemState,
  type GoLiveLaneMode,
  type GoLiveOwner,
} from "@/lib/goLive";
import { OwnerInitialChip, PriorityPill, UnblocksTags } from "./Badges";
import { ItemDetailSheet } from "./ItemDetailSheet";

type ActionBody = Parameters<typeof api.goLiveItemAction>[1];
type SaveNote = { ok: boolean; text: string } | null;
type LaneGroup = { key: string; label: string; items: GoLiveItem[] };

// ---------------------------------------------------------------------
// Column-cell ids: dnd-kit droppable ids are strings, so a cell (one
// lane's one column) is encoded as `${laneKey}::${column}`. Lane keys are
// section letters ("A".."H") in section mode, or "kevin" | "claude" |
// "unassigned" in owner mode — none of those contain "::", so a plain
// split is safe.
// ---------------------------------------------------------------------

function cellId(laneKey: string, column: GoLiveItemState): string {
  return `${laneKey}::${column}`;
}

function parseCellId(id: string): { laneKey: string; column: GoLiveItemState } {
  const sep = id.lastIndexOf("::");
  return { laneKey: id.slice(0, sep), column: id.slice(sep + 2) as GoLiveItemState };
}

/** The always-visible drop target rendered at the left edge of the screen
 *  while a card is being dragged on a narrow (non-desktop) layout, so a
 *  user doesn't have to scroll a horizontally-scrolling lane all the way
 *  back to its first column mid-drag. Distinct from every real cell id so
 *  it can never collide with one; `handleDragEnd` maps it onto "that
 *  item's own lane, To do column" explicitly. */
const EDGE_TODO_DROP_ID = "__edge-todo__";

function sourceLaneFor(item: GoLiveItem, lanes: GoLiveLaneMode): string {
  return lanes === "section" ? item.section : item.owner ?? "unassigned";
}

/** Whether `laneKey`/`column` is a legal drop target for `activeItem` (or,
 *  when nothing is being dragged, whether it could ever be one — used to
 *  decide the droppable's `disabled` flag). Review is never a target.
 *  Section lanes are fixed by id (no cross-lane drops). Owner lanes allow
 *  kevin<->claude either way but never *into* "unassigned" — there's no
 *  action that un-assigns an owner — while staying within an already
 *  unassigned item's own lane is fine. */
function isValidDropTarget(activeItem: GoLiveItem | undefined, lanes: GoLiveLaneMode, laneKey: string, column: GoLiveItemState): boolean {
  if (column === "review") return false;
  if (!activeItem) return true;
  const sourceLane = sourceLaneFor(activeItem, lanes);
  if (lanes === "section") return laneKey === sourceLane;
  if (laneKey === sourceLane) return true;
  if (laneKey === "unassigned") return false;
  return true;
}

/** `pointerWithin` first (actual pointer containment — what the user sees
 *  themselves dragging over), `closestCenter` only as a fallback for when
 *  the pointer sits in a gap/margin between droppables and isn't inside
 *  any of them. Composing the two like this is dnd-kit's documented
 *  pattern for exactly this failure mode. */
const collisionDetectionStrategy: CollisionDetection = (args) => {
  const pointerCollisions = pointerWithin(args);
  if (pointerCollisions.length > 0) return pointerCollisions;
  return closestCenter(args);
};

/** Tracks the `lg` breakpoint (1024px, matching Tailwind) so the board can
 *  render one of two mutually-exclusive DOM trees — see the file header
 *  comment for why both can never be mounted at once. This whole page only
 *  ever mounts `BoardView` client-side (after the initial fetch resolves,
 *  behind a loading skeleton), so there's no SSR/hydration pass to match
 *  here — the lazy `useState` initialiser can read `matchMedia` directly
 *  on first render instead of correcting it a tick later inside an effect. */
function useIsDesktop(): boolean {
  const [isDesktop, setIsDesktop] = useState(() => window.matchMedia("(min-width: 1024px)").matches);
  useEffect(() => {
    const mql = window.matchMedia("(min-width: 1024px)");
    const handler = (e: MediaQueryListEvent) => setIsDesktop(e.matches);
    mql.addEventListener("change", handler);
    return () => mql.removeEventListener("change", handler);
  }, []);
  return isDesktop;
}

function Card({ item, onOpen }: { item: GoLiveItem; onOpen: () => void }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: item.id });

  return (
    <button
      ref={setNodeRef}
      type="button"
      onClick={onOpen}
      className={`glass-card w-full touch-none rounded-xl p-2.5 text-left transition-transform hover:-translate-y-0.5 ${
        isDragging ? "opacity-30" : ""
      }`}
      {...listeners}
      {...attributes}
    >
      <CardBody item={item} />
    </button>
  );
}

/** The static, non-interactive copy rendered inside the `DragOverlay`
 *  while a card is being dragged — same markup as `Card` minus the drag
 *  handlers, plus a slightly deeper shadow, no rotation. */
function CardOverlay({ item }: { item: GoLiveItem }) {
  return (
    <div className="glass-card w-[220px] rounded-xl p-2.5 text-left shadow-lg">
      <CardBody item={item} />
    </div>
  );
}

function CardBody({ item }: { item: GoLiveItem }) {
  return (
    <>
      <div className="flex items-center justify-between gap-1.5">
        <span className="money text-[10px] font-bold text-slate-400 dark:text-slate-500">{item.id}</span>
        <div className="flex items-center gap-1">
          <PriorityPill priority={item.priority} />
          <OwnerInitialChip owner={item.owner} />
        </div>
      </div>
      <p className="mt-1.5 line-clamp-2 text-xs font-semibold text-pretty text-slate-800 dark:text-slate-100">{item.title}</p>
      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
        <UnblocksTags unblocks={item.unblocks} />
        {item.notes.length > 0 && (
          <span className="inline-flex items-center gap-0.5 text-[10px] font-semibold text-slate-400 dark:text-slate-500">
            <MessageSquare size={11} aria-hidden="true" />
            {item.notes.length}
          </span>
        )}
      </div>
    </>
  );
}

function ColumnCell({
  laneKey,
  column,
  items,
  activeItem,
  lanes,
  onOpen,
}: {
  laneKey: string;
  column: GoLiveItemState;
  items: GoLiveItem[];
  activeItem: GoLiveItem | undefined;
  lanes: GoLiveLaneMode;
  onOpen: (item: GoLiveItem) => void;
}) {
  const valid = isValidDropTarget(activeItem, lanes, laneKey, column);
  const { setNodeRef, isOver } = useDroppable({ id: cellId(laneKey, column), disabled: !valid });
  const highlight = isOver && valid;
  const empty = items.length === 0;

  return (
    <div
      ref={setNodeRef}
      className={`min-w-0 space-y-1.5 rounded-lg p-1 transition-colors ${empty ? "min-h-16 lg:min-h-24" : ""} ${
        highlight ? "bg-indigo-50/60 outline outline-1 outline-dashed outline-indigo-300 dark:bg-indigo-950/20 dark:outline-indigo-700" : ""
      }`}
    >
      {items.map((item) => (
        <Card key={item.id} item={item} onOpen={() => onOpen(item)} />
      ))}
      {empty && (
        <div
          className={`flex h-full min-h-16 items-center justify-center rounded-xl border border-dashed p-3 text-center text-[11px] transition-colors lg:min-h-24 ${
            highlight
              ? "border-indigo-300 text-indigo-500 dark:border-indigo-700 dark:text-indigo-300"
              : "border-slate-200 text-slate-300 dark:border-white/10 dark:text-slate-600"
          }`}
        >
          {highlight ? "Drop here" : "—"}
        </div>
      )}
    </div>
  );
}

function LaneRow({
  laneKey,
  label,
  allItems,
  effectiveLane,
  effectiveColumn,
  activeItem,
  lanes,
  onOpen,
}: {
  laneKey: string;
  label: string;
  allItems: GoLiveItem[];
  effectiveLane: (item: GoLiveItem) => string;
  effectiveColumn: (item: GoLiveItem) => GoLiveItemState;
  activeItem: GoLiveItem | undefined;
  lanes: GoLiveLaneMode;
  onOpen: (item: GoLiveItem) => void;
}) {
  const [open, setOpen] = useState(true);

  // Placement uses the *effective* (optimistic-aware) lane/column, computed
  // over the whole board's items, so a card that was just dropped
  // elsewhere shows there immediately even though this lane's real
  // (server-truth) membership hasn't changed yet.
  const cellItems = (column: GoLiveItemState) =>
    allItems.filter((item) => effectiveLane(item) === laneKey && effectiveColumn(item) === column);
  const counts = BOARD_COLUMNS.map((col) => cellItems(col.key).length);
  const laneTotal = counts.reduce((a, b) => a + b, 0);

  return (
    <div className="glass-card rounded-2xl p-3">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex min-h-9 w-full items-center justify-between gap-3 text-left"
      >
        <span className="text-sm font-semibold text-pretty text-slate-800 dark:text-slate-100">{label}</span>
        <span className="flex shrink-0 items-center gap-2">
          <span className="money text-xs font-semibold text-slate-500 dark:text-slate-400">{laneTotal}</span>
          <ChevronDown
            size={16}
            className={`shrink-0 text-slate-400 transition-transform ${open ? "rotate-180" : ""}`}
            aria-hidden="true"
          />
        </span>
      </button>

      {open && (
        <div className="mt-2 flex gap-3 overflow-x-auto pb-1">
          {BOARD_COLUMNS.map((col, idx) => (
            <div key={col.key} className="w-[220px] shrink-0">
              <p className="mb-1.5 flex items-center justify-between px-0.5 text-[10px] font-bold uppercase tracking-wide text-slate-400 dark:text-slate-500">
                {col.label}
                <span className="money">{counts[idx]}</span>
              </p>
              {col.key === "review" && (
                <p className="mb-1.5 px-0.5 text-[10px] text-slate-400 dark:text-slate-500">Set automatically when work finishes</p>
              )}
              <ColumnCell
                laneKey={laneKey}
                column={col.key}
                items={cellItems(col.key)}
                activeItem={activeItem}
                lanes={lanes}
                onOpen={onOpen}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// Sticky header offset for the desktop grid: `FilterBar.tsx` measures its
// own rendered height with a ResizeObserver and publishes it as
// `--go-live-filter-h` on <html>, so the column headers stick exactly
// beneath the real filter bar instead of a guessed pixel value. The 96px
// fallback only covers the one frame before that effect's first
// measurement lands (or the rare case FilterBar isn't mounted at all).
//
// This offset only matters once `position: sticky` is actually being
// measured against the page's own scroll — a `sticky` element's
// containing block is the nearest ancestor whose `overflow` isn't
// `visible`, even `overflow: hidden`. The grid below deliberately has no
// `overflow-hidden` on it for exactly this reason: that class had
// previously made the grid box itself the sticky containing block, so
// `top: <offset>` was measured from the grid's own top edge (where the
// header row already sits) rather than the viewport — pushing the header
// down onto the first row of cards instead of pinning it under the filter
// bar. Corner rounding is done per-cell instead (see the `rounded-*`
// classes below) so the visual border can still look clipped without an
// `overflow-hidden` ancestor.
const DESKTOP_HEADER_TOP = "var(--go-live-filter-h, 96px)";

/** The `lg`-and-up board: a true CSS grid, lane label as a fixed 180px
 *  first column, five equal columns for the rest, column headers sticky
 *  under the filter bar, lanes as plain rows (no per-lane collapse — at
 *  this width a lane is already one compact row, not a tall mobile card).
 *  `minmax(0,1fr)` on every column means the grid always fits the
 *  container; nothing here needs `overflow-x-auto`. */
function DesktopBoardGrid({
  laneGroups,
  allItems,
  effectiveLane,
  effectiveColumn,
  activeItem,
  lanes,
  onOpen,
}: {
  laneGroups: LaneGroup[];
  allItems: GoLiveItem[];
  effectiveLane: (item: GoLiveItem) => string;
  effectiveColumn: (item: GoLiveItem) => GoLiveItemState;
  activeItem: GoLiveItem | undefined;
  lanes: GoLiveLaneMode;
  onOpen: (item: GoLiveItem) => void;
}) {
  const cellItems = (laneKey: string, column: GoLiveItemState) =>
    allItems.filter((item) => effectiveLane(item) === laneKey && effectiveColumn(item) === column);

  const lastColIdx = BOARD_COLUMNS.length - 1;
  const lastLaneIdx = laneGroups.length - 1;

  return (
    <div className="grid grid-cols-[180px_repeat(5,minmax(0,1fr))] rounded-2xl border border-slate-200 dark:border-white/10">
      <div
        className="sticky z-10 rounded-tl-2xl border-b border-r border-slate-200 bg-[#f0f2f7]/95 backdrop-blur dark:border-white/10 dark:bg-[#0f172a]/95"
        style={{ top: DESKTOP_HEADER_TOP }}
      />
      {BOARD_COLUMNS.map((col, idx) => (
        <div
          key={col.key}
          className={`sticky z-10 border-b border-slate-200 bg-[#f0f2f7]/95 p-2 backdrop-blur dark:border-white/10 dark:bg-[#0f172a]/95 ${
            idx < lastColIdx ? "border-r" : "rounded-tr-2xl"
          }`}
          style={{ top: DESKTOP_HEADER_TOP }}
        >
          <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400 dark:text-slate-500">{col.label}</p>
          {col.key === "review" && <p className="mt-0.5 text-[10px] text-slate-400 dark:text-slate-500">Automatic</p>}
        </div>
      ))}

      {laneGroups.map((lane, laneIdx) => (
        <Fragment key={lane.key}>
          {/* Lane label: sticky on the left axis only (`left-0`, no `top`).
              Each row is at most a few cards tall, never taller than the
              viewport, so there's no scroll-within-a-row case that would
              need the label to also pin vertically — it doesn't share
              DESKTOP_HEADER_TOP with the column headers above because it
              isn't meant to stick to the top of the page at all. */}
          <div
            className={`sticky left-0 z-[5] flex items-center border-b border-r border-slate-200 bg-[#f0f2f7] p-2 dark:border-white/10 dark:bg-[#0f172a] ${
              laneIdx === lastLaneIdx ? "rounded-bl-2xl" : ""
            }`}
          >
            <span className="text-xs font-semibold text-pretty text-slate-700 dark:text-slate-200">{lane.label}</span>
          </div>
          {BOARD_COLUMNS.map((col, idx) => (
            <div
              key={col.key}
              className={`min-w-0 border-b border-slate-200 p-1.5 dark:border-white/10 ${idx < lastColIdx ? "border-r" : ""} ${
                laneIdx === lastLaneIdx && idx === lastColIdx ? "rounded-br-2xl" : ""
              }`}
            >
              <ColumnCell
                laneKey={lane.key}
                column={col.key}
                items={cellItems(lane.key, col.key)}
                activeItem={activeItem}
                lanes={lanes}
                onOpen={onOpen}
              />
            </div>
          ))}
        </Fragment>
      ))}
    </div>
  );
}

/** Fixed 56px strip at the left edge of the viewport, shown only while a
 *  card is being dragged on a narrow (non-desktop) layout. Lets a user
 *  drop a card back onto To do without first scrolling its horizontally-
 *  scrolling lane all the way left. Droppable id is `EDGE_TODO_DROP_ID`,
 *  handled specially in `handleDragEnd` as "this item's own lane, To do". */
function EdgeTodoDropTarget() {
  const { setNodeRef, isOver } = useDroppable({ id: EDGE_TODO_DROP_ID });
  return (
    <div
      ref={setNodeRef}
      className={`fixed inset-y-0 left-0 z-40 flex w-14 items-center justify-center border-r-2 border-dashed p-1.5 text-center text-[10px] font-semibold leading-tight transition-colors ${
        isOver
          ? "border-indigo-400 bg-indigo-50/95 text-indigo-700 dark:border-indigo-600 dark:bg-indigo-950/80 dark:text-indigo-200"
          : "border-slate-300 bg-white/85 text-slate-400 dark:border-white/15 dark:bg-slate-900/85 dark:text-slate-500"
      }`}
    >
      Drop here for To do
    </div>
  );
}

/** Small calm toast at the bottom of the screen after a drop, offering an
 *  undo. Auto-dismisses after 6s; any new drop replaces it (the `key` the
 *  caller passes resets this timer). No red — a drop is never an error. */
function DropToast({ message, onUndo, onDismiss }: { message: string; onUndo: () => void; onDismiss: () => void }) {
  useEffect(() => {
    const t = window.setTimeout(onDismiss, 6000);
    return () => window.clearTimeout(t);
  }, [onDismiss]);

  return (
    <div
      className="fixed inset-x-0 z-50 flex justify-center px-4"
      style={{ bottom: "calc(1.5rem + env(safe-area-inset-bottom, 0px))" }}
      role="status"
    >
      <div className="glass-card flex items-center gap-3 rounded-full py-2 pl-4 pr-2 shadow-lg">
        <span className="text-xs font-semibold text-slate-700 dark:text-slate-200">{message}</span>
        <button
          type="button"
          onClick={onUndo}
          className="min-h-9 shrink-0 rounded-full px-2.5 text-xs font-bold text-indigo-600 hover:bg-indigo-50 dark:text-indigo-400 dark:hover:bg-indigo-950/40"
        >
          Undo
        </button>
      </div>
    </div>
  );
}

function columnLabel(column: GoLiveItemState): string {
  return BOARD_COLUMNS.find((c) => c.key === column)?.label ?? column;
}

function ownerLabel(owner: GoLiveOwner): string {
  return owner === "kevin" ? "Kevin" : "Claude";
}

/** The reverse of a single forward action, for the undo toast. This is a
 *  best-effort inverse keyed off the action itself, not a full history of
 *  the item's prior state — reversing "todo" always goes to "start" (i.e.
 *  In progress), even if the item was actually Blocked or In review before
 *  the drop that sent it to To do. Good enough for "I dropped this a
 *  second ago and want it back", not a general undo stack. */
function reverseAction(action: ActionBody, priorOwner: GoLiveOwner): ActionBody | null {
  switch (action.action) {
    case "done":
      return { action: "reopen" };
    case "reopen":
      return { action: "done" };
    case "start":
      return { action: "todo" };
    case "todo":
      return { action: "start" };
    case "block":
      return { action: "todo" };
    case "owner":
      return { action: "owner", owner: priorOwner };
    default:
      return null;
  }
}

function buildUndo(actions: ActionBody[], priorOwner: GoLiveOwner): ActionBody[] {
  const reversed: ActionBody[] = [];
  for (const action of [...actions].reverse()) {
    const r = reverseAction(action, priorOwner);
    if (r) reversed.push(r);
  }
  return reversed;
}

/** The inline reason input shown after a card is dropped on Blocked — the
 *  card doesn't move until this is submitted; cancelling just closes it
 *  (nothing was moved, so nothing to snap back). Same field/button shape
 *  as the block control in `ItemDetailSheet.tsx`. */
function BlockDropPanel({
  item,
  onSubmit,
  onCancel,
}: {
  item: GoLiveItem;
  onSubmit: (reason: string) => void;
  onCancel: () => void;
}) {
  const [reason, setReason] = useState("");

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/40 sm:items-center" onClick={onCancel}>
      <div className="glass-card w-full max-w-sm rounded-t-3xl p-5 sm:rounded-3xl" onClick={(e) => e.stopPropagation()}>
        <p className="money text-xs font-bold text-slate-400 dark:text-slate-500">{item.id}</p>
        <h3 className="mt-0.5 text-sm font-semibold text-pretty text-slate-800 dark:text-slate-100">{item.title}</h3>
        <label className="mb-1.5 mt-4 block text-xs font-semibold text-slate-500 dark:text-slate-400">Reason for blocking</label>
        <input
          autoFocus
          type="text"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Reason"
          className="min-h-11 w-full rounded-lg border border-slate-200 bg-slate-50 px-2.5 text-xs text-slate-800 focus:border-indigo-400 focus:outline-none dark:border-white/10 dark:bg-slate-900 dark:text-slate-100"
        />
        <div className="mt-3 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="min-h-11 rounded-lg px-3 text-xs font-semibold text-slate-500 hover:bg-slate-50 dark:text-slate-400 dark:hover:bg-white/5"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={!reason.trim()}
            onClick={() => onSubmit(reason.trim())}
            className="min-h-11 rounded-lg bg-slate-800 px-3 text-xs font-semibold text-white disabled:opacity-50 dark:bg-slate-700"
          >
            Block
          </button>
        </div>
      </div>
    </div>
  );
}

type OptimisticPlacement = Record<string, { lane: string; column: GoLiveItemState }>;
type BlockDraft = { itemId: string; lane: string };
type ToastState = { seq: number; itemId: string; message: string; undo: ActionBody[] } | null;

export function BoardView({
  items,
  todoMarkdown,
  lanes,
  onLanesChange,
  pendingIds,
  saveNotes,
  onAction,
}: {
  items: GoLiveItem[];
  todoMarkdown?: string;
  lanes: GoLiveLaneMode;
  onLanesChange: (lanes: GoLiveLaneMode) => void;
  pendingIds: Set<string>;
  saveNotes: Record<string, SaveNote>;
  onAction: (itemId: string, body: ActionBody) => void | Promise<void>;
}) {
  const [selected, setSelected] = useState<GoLiveItem | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [optimisticPlacement, setOptimisticPlacement] = useState<OptimisticPlacement>({});
  const [blockDraft, setBlockDraft] = useState<BlockDraft | null>(null);
  const [toast, setToast] = useState<ToastState>(null);
  const isDesktop = useIsDesktop();

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 8 } }),
    useSensor(KeyboardSensor)
  );

  const laneGroups: LaneGroup[] =
    lanes === "section"
      ? groupItemsBySection(items, todoMarkdown).map((g) => ({ key: g.section, label: g.heading, items: g.items }))
      : groupItemsByOwner(items).map((g) => ({ key: g.key, label: g.label, items: g.items }));

  const activeItem = activeId ? items.find((i) => i.id === activeId) : undefined;

  function effectiveLane(item: GoLiveItem): string {
    const opt = optimisticPlacement[item.id];
    if (opt) return opt.lane;
    return sourceLaneFor(item, lanes);
  }

  function effectiveColumn(item: GoLiveItem): GoLiveItemState {
    const opt = optimisticPlacement[item.id];
    if (opt) return opt.column;
    return item.state;
  }

  function clearOptimistic(itemId: string) {
    setOptimisticPlacement((prev) => {
      if (!(itemId in prev)) return prev;
      const next = { ...prev };
      delete next[itemId];
      return next;
    });
  }

  function fireOptimistic(itemId: string, lane: string, column: GoLiveItemState, actions: ActionBody[]) {
    setOptimisticPlacement((prev) => ({ ...prev, [itemId]: { lane, column } }));
    (async () => {
      try {
        for (const body of actions) {
          await Promise.resolve(onAction(itemId, body));
        }
      } finally {
        clearOptimistic(itemId);
      }
    })();
  }

  function showDropToast(itemId: string, message: string, undo: ActionBody[]) {
    if (undo.length === 0) return;
    setToast((prev) => ({ seq: (prev?.seq ?? 0) + 1, itemId, message, undo }));
  }

  async function handleUndo(itemId: string, undo: ActionBody[]) {
    setToast(null);
    for (const body of undo) {
      await Promise.resolve(onAction(itemId, body));
    }
  }

  function handleDragStart(event: DragStartEvent) {
    setActiveId(String(event.active.id));
  }

  // --------------------------------------------------------------------
  // Drop mapping (target column -> action, given the current lane mode):
  //   To do        -> "reopen" if the item was done, else "todo"
  //   In progress  -> "start"
  //   Blocked      -> opens the inline reason input; "block" fires on submit
  //   In review    -> not a drop target (disabled droppable, no-op)
  //   Done         -> "done"
  // Lane changes: section mode never allows a cross-lane drop (section is
  // fixed by id). Owner mode fires "owner" first when the lane (owner)
  // changed, then the column action above, in sequence — except into
  // Blocked, where "owner" fires immediately but "block" waits for the
  // reason. Dropping into "unassigned" is refused (no un-assign action).
  // The edge "Drop here for To do" target (mobile only, see
  // `EdgeTodoDropTarget`) maps onto the dragged item's own lane's To do
  // cell, so it goes through this exact same mapping.
  // --------------------------------------------------------------------
  function handleDragEnd(event: DragEndEvent) {
    setActiveId(null);
    const { active, over } = event;
    if (!over) return;

    const item = items.find((i) => i.id === active.id);
    if (!item) return;

    const sourceLane = sourceLaneFor(item, lanes);
    const { laneKey: targetLane, column: targetColumn } =
      over.id === EDGE_TODO_DROP_ID ? { laneKey: sourceLane, column: "todo" as GoLiveItemState } : parseCellId(String(over.id));

    const laneChanged = targetLane !== sourceLane;
    const columnChanged = targetColumn !== item.state;
    if (!laneChanged && !columnChanged) return;
    if (!isValidDropTarget(item, lanes, targetLane, targetColumn)) return; // belt and braces; droppable is already disabled for these

    const priorOwner: GoLiveOwner = item.owner ?? "claude";
    const ownerAction: ActionBody | null = laneChanged ? { action: "owner", owner: targetLane as GoLiveOwner } : null;

    if (targetColumn === "blocked") {
      if (ownerAction) fireOptimistic(item.id, targetLane, item.state, [ownerAction]);
      setBlockDraft({ itemId: item.id, lane: targetLane });
      return;
    }

    if (!columnChanged) {
      // Owner-only move: lane changed, column didn't.
      fireOptimistic(item.id, targetLane, item.state, [ownerAction as ActionBody]);
      showDropToast(
        item.id,
        `${item.id} reassigned to ${ownerLabel(targetLane as GoLiveOwner)}.`,
        buildUndo([ownerAction as ActionBody], priorOwner)
      );
      return;
    }

    const columnAction: ActionBody =
      targetColumn === "todo"
        ? item.state === "done"
          ? { action: "reopen" }
          : { action: "todo" }
        : targetColumn === "in-progress"
        ? { action: "start" }
        : { action: "done" }; // only "done" remains: review is excluded, blocked handled above

    const actions = ownerAction ? [ownerAction, columnAction] : [columnAction];
    fireOptimistic(item.id, targetLane, targetColumn, actions);
    showDropToast(item.id, `${item.id} moved to ${columnLabel(targetColumn)}.`, buildUndo(actions, priorOwner));
  }

  function submitBlockDraft(reason: string) {
    if (!blockDraft) return;
    const { itemId, lane } = blockDraft;
    setBlockDraft(null);
    fireOptimistic(itemId, lane, "blocked", [{ action: "block", reason }]);
    showDropToast(itemId, `${itemId} moved to Blocked.`, [{ action: "todo" }]);
  }

  // Keep `selected` pointed at the freshest copy of the item after a write
  // replaces `items` from the server response, so the sheet doesn't show
  // stale state while it's still open.
  const liveSelected = selected ? items.find((i) => i.id === selected.id) ?? null : null;
  const blockDraftItem = blockDraft ? items.find((i) => i.id === blockDraft.itemId) ?? null : null;

  return (
    <div>
      <div className="mb-3 flex items-center justify-end gap-1.5">
        <span className="text-[11px] font-semibold text-slate-400 dark:text-slate-500">Lanes</span>
        <div className="flex min-h-8 items-center rounded-full bg-slate-100 p-0.5 dark:bg-white/5">
          {(["section", "owner"] as GoLiveLaneMode[]).map((mode) => (
            <button
              key={mode}
              type="button"
              onClick={() => onLanesChange(mode)}
              className={`min-h-7 rounded-full px-2.5 text-[11px] font-semibold capitalize ${
                lanes === mode
                  ? "bg-white text-slate-800 shadow-sm dark:bg-slate-700 dark:text-slate-100"
                  : "text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
              }`}
            >
              {mode}
            </button>
          ))}
        </div>
      </div>

      {laneGroups.length === 0 ? (
        <p className="text-sm text-slate-500 dark:text-slate-400">No items match the current filters.</p>
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={collisionDetectionStrategy}
          autoScroll={{ threshold: { x: 0.25, y: 0.2 } }}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
        >
          {isDesktop ? (
            <DesktopBoardGrid
              laneGroups={laneGroups}
              allItems={items}
              effectiveLane={effectiveLane}
              effectiveColumn={effectiveColumn}
              activeItem={activeItem}
              lanes={lanes}
              onOpen={setSelected}
            />
          ) : (
            <div className="space-y-3">
              {laneGroups.map((lane) => (
                <LaneRow
                  key={lane.key}
                  laneKey={lane.key}
                  label={lane.label}
                  allItems={items}
                  effectiveLane={effectiveLane}
                  effectiveColumn={effectiveColumn}
                  activeItem={activeItem}
                  lanes={lanes}
                  onOpen={setSelected}
                />
              ))}
            </div>
          )}
          {activeItem && !isDesktop && <EdgeTodoDropTarget />}
          <DragOverlay dropAnimation={null}>{activeItem ? <CardOverlay item={activeItem} /> : null}</DragOverlay>
        </DndContext>
      )}

      {liveSelected && (
        <ItemDetailSheet
          item={liveSelected}
          pending={pendingIds.has(liveSelected.id)}
          saveNote={saveNotes[liveSelected.id] ?? null}
          onAction={(body) => onAction(liveSelected.id, body)}
          onClose={() => setSelected(null)}
        />
      )}

      {blockDraftItem && (
        <BlockDropPanel item={blockDraftItem} onSubmit={submitBlockDraft} onCancel={() => setBlockDraft(null)} />
      )}

      {toast && (
        <DropToast
          key={toast.seq}
          message={toast.message}
          onUndo={() => handleUndo(toast.itemId, toast.undo)}
          onDismiss={() => setToast(null)}
        />
      )}
    </div>
  );
}
