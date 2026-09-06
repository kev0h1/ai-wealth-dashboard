"use client";

// Kanban board: columns To do / In progress / Blocked / In review / Done,
// swimlanes by section or owner (toggle), each lane collapsible and
// showing counts per column. Columns scroll horizontally on narrow
// screens with the lane label sticky on the left. No drag-and-drop — every
// state change goes through a card's detail sheet (ItemDetailSheet).

import { useState } from "react";
import { ChevronDown, MessageSquare } from "lucide-react";
import type { api } from "@/lib/api";
import {
  BOARD_COLUMNS,
  groupItemsByOwner,
  groupItemsBySection,
  type GoLiveItem,
  type GoLiveLaneMode,
} from "@/lib/goLive";
import { OwnerInitialChip, PriorityPill, UnblocksTags } from "./Badges";
import { ItemDetailSheet } from "./ItemDetailSheet";

type ActionBody = Parameters<typeof api.goLiveItemAction>[1];
type SaveNote = { ok: boolean; text: string } | null;

function Card({ item, onOpen }: { item: GoLiveItem; onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="glass-card w-full rounded-xl p-2.5 text-left transition-transform hover:-translate-y-0.5"
    >
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
    </button>
  );
}

function LaneRow({
  label,
  items,
  onOpen,
}: {
  label: string;
  items: GoLiveItem[];
  onOpen: (item: GoLiveItem) => void;
}) {
  const [open, setOpen] = useState(true);
  const counts = BOARD_COLUMNS.map((col) => items.filter((i) => i.state === col.key).length);

  return (
    <div className="glass-card rounded-2xl p-3">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex min-h-9 w-full items-center justify-between gap-3 text-left"
      >
        <span className="text-sm font-semibold text-pretty text-slate-800 dark:text-slate-100">{label}</span>
        <span className="flex shrink-0 items-center gap-2">
          <span className="money text-xs font-semibold text-slate-500 dark:text-slate-400">{items.length}</span>
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
              <div className="space-y-1.5">
                {items
                  .filter((item) => item.state === col.key)
                  .map((item) => (
                    <Card key={item.id} item={item} onOpen={() => onOpen(item)} />
                  ))}
                {counts[idx] === 0 && (
                  <div className="rounded-xl border border-dashed border-slate-200 p-3 text-center text-[11px] text-slate-300 dark:border-white/10 dark:text-slate-600">
                    —
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

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
  onAction: (itemId: string, body: ActionBody) => void;
}) {
  const [selected, setSelected] = useState<GoLiveItem | null>(null);

  const laneGroups =
    lanes === "section"
      ? groupItemsBySection(items, todoMarkdown).map((g) => ({ key: g.section, label: g.heading, items: g.items }))
      : groupItemsByOwner(items).map((g) => ({ key: g.key, label: g.label, items: g.items }));

  // Keep `selected` pointed at the freshest copy of the item after a write
  // replaces `items` from the server response, so the sheet doesn't show
  // stale state while it's still open.
  const liveSelected = selected ? items.find((i) => i.id === selected.id) ?? null : null;

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
        <div className="space-y-3">
          {laneGroups.map((lane) => (
            <LaneRow key={lane.key} label={lane.label} items={lane.items} onOpen={setSelected} />
          ))}
        </div>
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
    </div>
  );
}
