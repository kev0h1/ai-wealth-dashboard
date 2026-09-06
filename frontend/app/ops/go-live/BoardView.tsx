"use client";

// Kanban board: columns To do / In progress / Blocked / In review / Done,
// swimlanes by section or owner (toggle), each lane collapsible and
// showing counts per column. Columns scroll horizontally on narrow
// screens with the lane label sticky on the left.
//
// Drag and drop (dnd-kit): a card can be dragged straight onto a column
// cell as a shortcut for the state change a tap into the detail sheet
// would otherwise require. Every state change is still a normal item
// action under the hood (drops are optimistic, then reconciled from the
// server response like every other action on this page) — dragging never
// bypasses `onAction`. See the drop-mapping comment above `handleDragEnd`
// for the exact column/lane rules. Tapping a card without dragging still
// opens `ItemDetailSheet` as before.

import { useState } from "react";
import { ChevronDown, MessageSquare } from "lucide-react";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  closestCenter,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
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

  return (
    <div
      ref={setNodeRef}
      className={`space-y-1.5 rounded-lg p-1 transition-colors ${
        highlight ? "bg-indigo-50/60 outline outline-1 outline-dashed outline-indigo-300 dark:bg-indigo-950/20 dark:outline-indigo-700" : ""
      }`}
    >
      {items.map((item) => (
        <Card key={item.id} item={item} onOpen={() => onOpen(item)} />
      ))}
      {items.length === 0 && (
        <div className="rounded-xl border border-dashed border-slate-200 p-3 text-center text-[11px] text-slate-300 dark:border-white/10 dark:text-slate-600">
          —
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

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 8 } }),
    useSensor(KeyboardSensor)
  );

  const laneGroups =
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
  // --------------------------------------------------------------------
  function handleDragEnd(event: DragEndEvent) {
    setActiveId(null);
    const { active, over } = event;
    if (!over) return;

    const item = items.find((i) => i.id === active.id);
    if (!item) return;

    const { laneKey: targetLane, column: targetColumn } = parseCellId(String(over.id));
    const sourceLane = sourceLaneFor(item, lanes);
    const laneChanged = targetLane !== sourceLane;
    const columnChanged = targetColumn !== item.state;
    if (!laneChanged && !columnChanged) return;
    if (!isValidDropTarget(item, lanes, targetLane, targetColumn)) return; // belt and braces; droppable is already disabled for these

    const ownerAction: ActionBody | null = laneChanged ? { action: "owner", owner: targetLane as GoLiveOwner } : null;

    if (targetColumn === "blocked") {
      if (ownerAction) fireOptimistic(item.id, targetLane, item.state, [ownerAction]);
      setBlockDraft({ itemId: item.id, lane: targetLane });
      return;
    }

    if (!columnChanged) {
      // Owner-only move: lane changed, column didn't.
      fireOptimistic(item.id, targetLane, item.state, [ownerAction as ActionBody]);
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
  }

  function submitBlockDraft(reason: string) {
    if (!blockDraft) return;
    const { itemId, lane } = blockDraft;
    setBlockDraft(null);
    fireOptimistic(itemId, lane, "blocked", [{ action: "block", reason }]);
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
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
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
    </div>
  );
}
