"use client";

// Board view: two entirely different DOM trees depending on the `lg`
// breakpoint (1024px), gated by `useIsDesktop` below (a `matchMedia`
// hook, not just CSS `hidden`/`lg:` classes).
//
// At `lg` and up: a true kanban CSS grid — lane label as a fixed-width
// first column, one equal column per `BOARD_COLUMNS` entry, column
// headers sticky to the top of the board — see `DesktopBoardGrid` below.
// Cards are dnd-kit draggables and can be dropped straight onto a column
// cell as a shortcut for the state change a tap into the detail sheet
// would otherwise require; see the drop-mapping comment above
// `handleDragEnd` for the exact column/lane rules. `DndContext` (sensors,
// collision detection, `DragOverlay`) wraps only this desktop branch.
//
// Below `lg` (H56, 2026-09-17, Kevin's "ribbon" pick from
// frontend/app/design/ops-board-mobile/): `MobileRibbonBoard.tsx`, a
// sticky status-count strip over dense single-line rows, replacing the
// old per-section horizontally-scrolling lane strip that made a phone
// visit a two-axis scroll through a roughly 300-card grid. There is no
// drag on this tree at all — a tap opens `ItemDetailSheet` exactly as the
// desktop grid does, whose "Move to" state picker (H55) is the only route
// to a state change on a phone — so this tree registers zero dnd-kit
// draggables or droppables and is rendered completely outside
// `<DndContext>`, not just visually hidden from it. That is simpler than
// the old reason the two trees had to stay DOM-mutually-exclusive
// (dnd-kit registers every mounted draggable/droppable by id regardless
// of visibility, so two trees with real cards in both would
// double-register every id and corrupt collision detection): now there is
// only ever one tree with any draggables in it, full stop.
//
// Collision detection (desktop only): `pointerWithin` first,
// `closestCenter` as a fallback only when the pointer isn't literally over
// any droppable (e.g. dropped in the gap between cells). `closestCenter`
// alone compares droppable *rect centres* to the pointer, not containment
// — with cells of very different heights (a tall "In progress" column
// full of cards next to a short, maybe-empty "To do" column) the pointer
// can be visually inside "To do" while its centre is still numerically
// closer to "In progress"'s much taller rect, so the drop silently lands
// on the wrong column. That is the root cause behind cards getting stuck
// in In progress when dragged back to To do. `pointerWithin` checks
// actual pointer containment first, which fixes it.
//
// Touch scrolling vs. drag (H55, desktop only): `Card` uses
// `touch-manipulation` (`touch-action: manipulation`), NOT `touch-none`.
// `touch-action: none` tells the browser this element never scrolls, so a
// finger landing on a card could never pan the page at all — every scroll
// gesture that started on a card silently became a drag instead, because
// the finger had nowhere to move within `TouchSensor`'s tolerance.
// `manipulation` leaves normal panning to the browser, and it's the delay
// plus tolerance on `TouchSensor` below (400ms held, under 5px of
// movement) that tells deliberate-press-and-hold apart from an ordinary
// scroll: a scroll moves the finger past the tolerance (or the browser
// starts panning) well before 400ms elapses, which cancels the pending
// drag. Do not put `touch-none` back on this element; `touch-action: none`
// is only correct for an immediate-activation TouchSensor with no delay.
// (Desktop-only in practice now: a mouse pointer never triggers
// `TouchSensor`, but the constraint is left as-is since desktop can still
// be driven by a touchscreen.)

import { Fragment, useEffect, useState } from "react";
import { MessageSquare } from "lucide-react";
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
  OWNER_LABEL,
  groupItemsByOwner,
  groupItemsBySection,
  itemFilterState,
  type GoLiveFilters,
  type GoLiveItem,
  type GoLiveItemState,
  type GoLiveLaneMode,
  type GoLiveOwner,
} from "@/lib/goLive";
import { OwnerInitialChip, PriorityPill, UnblocksTags } from "./Badges";
import { ItemDetailSheet } from "./ItemDetailSheet";
import { MobileRibbonBoard } from "./MobileRibbonBoard";

type ActionBody = Parameters<typeof api.goLiveItemAction>[1];
type SaveNote = { ok: boolean; text: string } | null;
type LaneGroup = { key: string; label: string; items: GoLiveItem[] };

// ---------------------------------------------------------------------
// Column-cell ids: dnd-kit droppable ids are strings, so a cell (one
// lane's one column) is encoded as `${laneKey}::${column}`. Lane keys are
// section letters ("A".."H") in section mode, or "kevin" | "claude" |
// "codex" | "unassigned" in owner mode — none of those contain "::", so a
// plain split is safe.
// ---------------------------------------------------------------------

function cellId(laneKey: string, column: GoLiveItemState): string {
  return `${laneKey}::${column}`;
}

function parseCellId(id: string): { laneKey: string; column: GoLiveItemState } {
  const sep = id.lastIndexOf("::");
  return { laneKey: id.slice(0, sep), column: id.slice(sep + 2) as GoLiveItemState };
}

function sourceLaneFor(item: GoLiveItem, lanes: GoLiveLaneMode): string {
  return lanes === "section" ? item.section : item.owner ?? "unassigned";
}

/** Whether `laneKey`/`column` is a legal drop target for `activeItem` (or,
 *  when nothing is being dragged, whether it could ever be one — used to
 *  decide the droppable's `disabled` flag). Review, Rejected and UAT are
 *  never targets: review is set automatically when a session finishes
 *  work, rejecting requires a reason a drag can't capture, and UAT
 *  requires a preview link a drag can't capture either (both only ever
 *  happen through a control in the detail sheet — "Reject, with a reason"
 *  and "Approve, which variant", see ItemDetailSheet.tsx). Section lanes
 *  are fixed by id (no cross-lane drops). Owner lanes allow moving freely
 *  between any of kevin/claude/codex but never *into* "unassigned" —
 *  there's no action that un-assigns an owner — while staying within an
 *  already unassigned item's own lane is fine. */
function isValidDropTarget(activeItem: GoLiveItem | undefined, lanes: GoLiveLaneMode, laneKey: string, column: GoLiveItemState): boolean {
  if (column === "review" || column === "rejected" || column === "uat") return false;
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
      className={`glass-card w-full touch-manipulation rounded-xl p-2.5 text-left transition-transform hover:-translate-y-0.5 ${
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
 *  first column, one equal-width column per `BOARD_COLUMNS` entry for the
 *  rest, column headers sticky under the filter bar, lanes as plain rows
 *  (no per-lane collapse — at this width a lane is already one compact
 *  row, not a tall mobile card). `minmax(0,1fr)` on every column means the
 *  grid always fits the container; nothing here needs `overflow-x-auto`. */
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
    <div
      className="grid rounded-2xl border border-slate-200 dark:border-white/10"
      style={{ gridTemplateColumns: `180px repeat(${BOARD_COLUMNS.length}, minmax(0, 1fr))` }}
    >
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
          {col.key === "uat" && <p className="mt-0.5 text-[10px] text-slate-400 dark:text-slate-500">Automatic</p>}
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
  return OWNER_LABEL[owner];
}

/** The reverse of a single forward action, for the undo toast. This is a
 *  best-effort inverse keyed off the action itself, not a full history of
 *  the item's prior state — reversing "todo" always goes to "start" (i.e.
 *  In progress), even if the item was actually Blocked or In review before
 *  the drop that sent it to To do. Good enough for "I dropped this a
 *  second ago and want it back", not a general undo stack.
 *
 *  H57: "start" and "block" are the one place this best-effort shortcut
 *  used to be flatly wrong rather than just imprecise. Dropping a Done
 *  card onto In progress or onto Blocked still sends the plain "start" /
 *  "block" forward action (there is no done-aware special case for those
 *  two columns the way the To do column has one, see the drop-mapping
 *  comment above `handleDragEnd`), and `TodoDoc.set_state` unconditionally
 *  clears `done` for any of those (H55) — so undoing with the old
 *  unconditional `{ action: "todo" }` left a Done card un-ticked in To do
 *  instead of back in Done. `wasDone` (the source column the drag actually
 *  started from) lets this send the card back to where it came from.
 *
 *  H57 correction round, finding C1: every `{ action: "done" }` this
 *  returns (the two `wasDone` branches below, and "reopen"'s reverse,
 *  which by construction only ever fires when the card started out Done)
 *  must also carry the source item's original `commit`. Without it,
 *  `set_done` stamps today's date and drops the merge sha, turning
 *  `(done 2026-09-06, abc1234)` into `(done 2026-09-17)` — a control
 *  labelled Undo must not rewrite the completion record like that. Note
 *  this stays lossy on `done_at` itself: restoring the exact original
 *  date would need a new parameter on `set_done` (backend/app/services/
 *  backlog.py), which is a larger change left for its own board item. */
function reverseAction(
  action: ActionBody,
  priorOwner: GoLiveOwner,
  wasDone: boolean,
  commit: string | null
): ActionBody | null {
  switch (action.action) {
    case "done":
      return { action: "reopen" };
    case "reopen":
      return { action: "done", commit: commit ?? undefined };
    case "start":
      return wasDone ? { action: "done", commit: commit ?? undefined } : { action: "todo" };
    case "todo":
      return { action: "start" };
    case "block":
      return wasDone ? { action: "done", commit: commit ?? undefined } : { action: "todo" };
    case "owner":
      return { action: "owner", owner: priorOwner };
    default:
      return null;
  }
}

function buildUndo(
  actions: ActionBody[],
  priorOwner: GoLiveOwner,
  wasDone: boolean,
  commit: string | null
): ActionBody[] {
  const reversed: ActionBody[] = [];
  for (const action of [...actions].reverse()) {
    const r = reverseAction(action, priorOwner, wasDone, commit);
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
type BlockDraft = { itemId: string; lane: string; wasDone: boolean; commit: string | null };
type ToastState = { seq: number; itemId: string; message: string; undo: ActionBody[] } | null;

export function BoardView({
  items,
  scopeItems,
  filters,
  onFiltersChange,
  todoMarkdown,
  lanes,
  onLanesChange,
  pendingIds,
  saveNotes,
  onAction,
}: {
  /** The full owner/priority/state/search filter applied — what the
   *  desktop grid renders, and what `MobileRibbonBoard` renders as its
   *  flat "Results" list the moment a filter (including a ribbon state
   *  chip) is active. */
  items: GoLiveItem[];
  /** Owner/priority/search only, `states` excluded — the honest, always-
   *  live source for `MobileRibbonBoard`'s own ribbon counts and its
   *  default (no active filter) in-flight rows, so picking one ribbon
   *  chip never zeroes the other three counts. Unused on the desktop
   *  grid, which has no ribbon. */
  scopeItems: GoLiveItem[];
  filters: GoLiveFilters;
  onFiltersChange: (next: GoLiveFilters) => void;
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
    useSensor(TouchSensor, { activationConstraint: { delay: 400, tolerance: 5 } }),
    useSensor(KeyboardSensor)
  );

  const laneGroups: LaneGroup[] =
    lanes === "section"
      ? groupItemsBySection(items, todoMarkdown).map((g) => ({ key: g.section, label: g.heading, items: g.items }))
      : groupItemsByOwner(items).map((g) => ({ key: g.key, label: g.label, items: g.items }));

  const activeItem = activeId ? items.find((i) => i.id === activeId) : undefined;

  // MobileRibbonBoard inputs. `scopeItems` isn't paginated in production
  // (it's the whole board, owner/priority/search-filtered), so the To
  // do/Done sample arrays below are just the full matching arrays — see
  // MobileRibbonBoard.tsx's own CollapsedSection doc for why that means no
  // "sample of N" caveat renders here (it only does in the /design
  // preview, which deliberately passes a smaller curated slice).
  const hasActiveFilter =
    filters.owner !== "all" || filters.priorities.length > 0 || filters.states.length > 0 || filters.search.trim() !== "";
  const todoItems = scopeItems.filter((item) => itemFilterState(item) === "open");
  const doneItems = scopeItems.filter((item) => itemFilterState(item) === "done");

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
  // This handler only ever fires from inside the desktop `DndContext`
  // (H56): the mobile tree (`MobileRibbonBoard`) has no draggables at all.
  // --------------------------------------------------------------------
  function handleDragEnd(event: DragEndEvent) {
    setActiveId(null);
    const { active, over } = event;
    if (!over) return;

    const item = items.find((i) => i.id === active.id);
    if (!item) return;

    const sourceLane = sourceLaneFor(item, lanes);
    const { laneKey: targetLane, column: targetColumn } = parseCellId(String(over.id));

    const laneChanged = targetLane !== sourceLane;
    const columnChanged = targetColumn !== item.state;
    if (!laneChanged && !columnChanged) return;
    if (!isValidDropTarget(item, lanes, targetLane, targetColumn)) return; // belt and braces; droppable is already disabled for these

    const priorOwner: GoLiveOwner = item.owner ?? "claude";
    const ownerAction: ActionBody | null = laneChanged ? { action: "owner", owner: targetLane as GoLiveOwner } : null;

    if (targetColumn === "blocked") {
      if (ownerAction) fireOptimistic(item.id, targetLane, item.state, [ownerAction]);
      setBlockDraft({ itemId: item.id, lane: targetLane, wasDone: item.state === "done", commit: item.commit });
      return;
    }

    if (!columnChanged) {
      // Owner-only move: lane changed, column didn't.
      fireOptimistic(item.id, targetLane, item.state, [ownerAction as ActionBody]);
      showDropToast(
        item.id,
        `${item.id} reassigned to ${ownerLabel(targetLane as GoLiveOwner)}.`,
        buildUndo([ownerAction as ActionBody], priorOwner, item.state === "done", item.commit)
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
        : { action: "done" }; // only "done" remains: review/rejected excluded above, blocked handled above

    const actions = ownerAction ? [ownerAction, columnAction] : [columnAction];
    fireOptimistic(item.id, targetLane, targetColumn, actions);
    showDropToast(
      item.id,
      `${item.id} moved to ${columnLabel(targetColumn)}.`,
      buildUndo(actions, priorOwner, item.state === "done", item.commit)
    );
  }

  function submitBlockDraft(reason: string) {
    if (!blockDraft) return;
    const { itemId, lane, wasDone, commit } = blockDraft;
    setBlockDraft(null);
    fireOptimistic(itemId, lane, "blocked", [{ action: "block", reason }]);
    showDropToast(itemId, `${itemId} moved to Blocked.`, [
      wasDone ? { action: "done", commit: commit ?? undefined } : { action: "todo" },
    ]);
  }

  // Keep `selected` pointed at the freshest copy of the item after a write
  // replaces `items` from the server response, so the sheet doesn't show
  // stale state while it's still open. Falls back to the last known
  // `selected` object (not null) when the id no longer matches anything
  // in `items` (H56, found by independent audit 2026-09-17): `items` is
  // the fully filtered set, and on the mobile ribbon board a state chip
  // is a one-tap primary gesture, so tapping a row under a "Blocked"
  // filter and then using the sheet's own "Move to In progress" makes the
  // item stop matching that filter mid-action — without this fallback
  // `liveSelected` went null and the sheet vanished under the user's
  // finger with no confirmation anything saved. Only clears on `onClose`,
  // which resets `selected` to null directly.
  const liveSelected = selected ? items.find((i) => i.id === selected.id) ?? selected : null;
  const blockDraftItem = blockDraft ? items.find((i) => i.id === blockDraft.itemId) ?? null : null;

  return (
    <div>
      {/* The Lanes (section/owner) toggle only means anything for the
          desktop kanban grid — MobileRibbonBoard has no lane concept at
          all, it's a single always-visible list keyed on state, not
          section/owner. Hiding it below `lg` avoids showing Kevin a
          control on his phone that would silently do nothing there. */}
      {isDesktop && (
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
      )}

      {isDesktop ? (
        laneGroups.length === 0 ? (
          <p className="text-sm text-slate-500 dark:text-slate-400">No items match the current filters.</p>
        ) : (
          <DndContext
            sensors={sensors}
            collisionDetection={collisionDetectionStrategy}
            autoScroll={{ threshold: { x: 0.25, y: 0.2 } }}
            onDragStart={handleDragStart}
            onDragEnd={handleDragEnd}
          >
            <DesktopBoardGrid
              laneGroups={laneGroups}
              allItems={items}
              effectiveLane={effectiveLane}
              effectiveColumn={effectiveColumn}
              activeItem={activeItem}
              lanes={lanes}
              onOpen={setSelected}
            />
            <DragOverlay dropAnimation={null}>{activeItem ? <CardOverlay item={activeItem} /> : null}</DragOverlay>
          </DndContext>
        )
      ) : (
        <MobileRibbonBoard
          filters={filters}
          onFiltersChange={onFiltersChange}
          hasActiveFilter={hasActiveFilter}
          filteredItems={items}
          scopeItems={scopeItems}
          todoTotalCount={todoItems.length}
          todoSampleItems={todoItems}
          doneTotalCount={doneItems.length}
          doneSampleItems={doneItems}
          onOpen={setSelected}
        />
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
