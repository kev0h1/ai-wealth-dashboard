"use client";

// The list view: sections as collapsible cards, each with its items as
// rows. Same shape as the original page.tsx SectionCard/ItemRow, now with
// a priority pill and "unblocks Q5, Q6" tags per item.

import { ChevronDown, Square, SquareCheck } from "lucide-react";
import type { api } from "@/lib/api";
import { type GoLiveItem, type GoLiveSectionGroup } from "@/lib/goLive";
import { OwnerToggle, PriorityPill, StatePill, UnblocksTags } from "./Badges";
import { ItemMenu } from "./ItemMenu";

type SaveNote = { ok: boolean; text: string } | null;
type ActionBody = Parameters<typeof api.goLiveItemAction>[1];

/** Quiet inline save indicator — never a toast, never blocking. */
function SaveIndicator({ note }: { note: SaveNote }) {
  if (!note) return null;
  return (
    <p
      className={`money mt-1.5 text-[11px] font-semibold ${
        note.ok ? "text-slate-400 dark:text-slate-500" : "text-amber-600 dark:text-amber-400"
      }`}
    >
      {note.text}
    </p>
  );
}

function ItemRow({
  item,
  pending,
  saveNote,
  onAction,
}: {
  item: GoLiveItem;
  pending: boolean;
  saveNote: SaveNote;
  onAction: (body: ActionBody) => void;
}) {
  const done = item.state === "done";
  const Icon = done ? SquareCheck : Square;

  return (
    <li id={`item-${item.id}`} className="scroll-mt-24 py-2.5">
      <div className="flex items-start gap-2">
        <button
          type="button"
          disabled={pending}
          onClick={() => onAction(done ? { action: "reopen" } : { action: "done" })}
          aria-label={done ? "Reopen item" : "Mark done"}
          className="flex min-h-11 min-w-11 shrink-0 items-center justify-center disabled:opacity-50"
        >
          <Icon
            size={18}
            className={done ? "text-emerald-500" : "text-slate-400 dark:text-slate-500"}
            aria-hidden="true"
          />
        </button>

        <div className="min-w-0 flex-1 pt-2.5">
          <div className="flex flex-wrap items-center gap-1.5">
            <span
              className={`text-sm font-semibold text-pretty ${
                done ? "text-slate-400 line-through dark:text-slate-500" : "text-slate-800 dark:text-slate-100"
              }`}
            >
              {item.id}. {item.title}
            </span>
            <PriorityPill priority={item.priority} />
            <StatePill item={item} />
          </div>
          {item.text && (
            <p
              className={`mt-0.5 text-xs leading-relaxed text-pretty ${
                done ? "text-slate-400 dark:text-slate-500" : "text-slate-600 dark:text-slate-300"
              }`}
            >
              {item.text}
            </p>
          )}
          {item.unblocks.length > 0 && (
            <div className="mt-1.5">
              <UnblocksTags unblocks={item.unblocks} />
            </div>
          )}
          {item.notes.length > 0 && (
            <ul className="mt-1.5 space-y-1">
              {item.notes.map((note, idx) => (
                <li key={idx} className="text-[11px] leading-relaxed text-slate-400 dark:text-slate-500">
                  <span className="money font-semibold">{note.date}</span> ({note.actor}): {note.text}
                </li>
              ))}
            </ul>
          )}
          <SaveIndicator note={saveNote} />
        </div>

        <div className="flex shrink-0 items-center gap-1.5 pt-1.5">
          <OwnerToggle
            owner={item.owner}
            disabled={pending}
            onToggle={(owner) => onAction({ action: "owner", owner })}
          />
          <ItemMenu
            item={item}
            disabled={pending}
            onStart={() => onAction({ action: "start" })}
            onMoveToTodo={() => onAction({ action: "todo" })}
            onBlock={(reason) => onAction({ action: "block", reason })}
            onNote={(text) => onAction({ action: "note", text })}
            onPriority={(priority) => onAction({ action: "priority", priority })}
            onUnblocks={(questions) => onAction({ action: "unblocks", questions })}
          />
        </div>
      </div>
    </li>
  );
}

function SectionCard({
  heading,
  items,
  defaultOpen,
  pendingIds,
  saveNotes,
  onAction,
}: {
  heading: string;
  items: GoLiveItem[];
  defaultOpen: boolean;
  pendingIds: Set<string>;
  saveNotes: Record<string, SaveNote>;
  onAction: (itemId: string, body: ActionBody) => void;
}) {
  const total = items.length;
  const done = items.filter((item) => item.state === "done").length;
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;

  return (
    <details className="group glass-card rounded-2xl p-4" open={defaultOpen}>
      <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 [&::-webkit-details-marker]:hidden">
        <span className="text-sm font-semibold text-pretty text-slate-800 dark:text-slate-100">{heading}</span>
        <span className="flex shrink-0 items-center gap-2">
          <span className="money text-xs font-semibold text-slate-500 dark:text-slate-400">
            {done} / {total}
          </span>
          <ChevronDown size={17} className="shrink-0 text-slate-400 transition-transform group-open:rotate-180" aria-hidden="true" />
        </span>
      </summary>
      <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-700">
        <div className="h-full rounded-full bg-indigo-500" style={{ width: `${pct}%` }} />
      </div>
      <ul className="mt-1 divide-y divide-slate-100 dark:divide-white/10">
        {items.map((item) => (
          <ItemRow
            key={item.id}
            item={item}
            pending={pendingIds.has(item.id)}
            saveNote={saveNotes[item.id] ?? null}
            onAction={(body) => onAction(item.id, body)}
          />
        ))}
      </ul>
    </details>
  );
}

export function ListView({
  sections,
  pendingIds,
  saveNotes,
  onAction,
}: {
  sections: GoLiveSectionGroup[];
  pendingIds: Set<string>;
  saveNotes: Record<string, SaveNote>;
  onAction: (itemId: string, body: ActionBody) => void;
}) {
  if (sections.length === 0) {
    return <p className="text-sm text-slate-500 dark:text-slate-400">No items match the current filters.</p>;
  }
  return (
    <div className="space-y-3">
      {sections.map((section, idx) => (
        <SectionCard
          key={section.section}
          heading={section.heading}
          items={section.items}
          defaultOpen={idx === 0}
          pendingIds={pendingIds}
          saveNotes={saveNotes}
          onAction={onAction}
        />
      ))}
    </div>
  );
}
