"use client";

// The board card's detail sheet: the same controls as the list-view row
// (done/reopen, owner, start, block with reason, note, priority,
// unblocks) collected into one popover since a kanban card doesn't have
// room for the list's inline buttons. Opened by tapping a card in
// BoardView; no drag-and-drop, every state change goes through here.

import { useEffect, useState } from "react";
import { Square, SquareCheck, X } from "lucide-react";
import type { api } from "@/lib/api";
import { PRIORITY_LABEL, PRIORITY_ORDER, type GoLiveItem, type GoLiveOwner, type GoLivePriority } from "@/lib/goLive";
import { PriorityPill, StatePill } from "./Badges";

type ActionBody = Parameters<typeof api.goLiveItemAction>[1];
type SaveNote = { ok: boolean; text: string } | null;

export function ItemDetailSheet({
  item,
  pending,
  saveNote,
  onAction,
  onClose,
}: {
  item: GoLiveItem;
  pending: boolean;
  saveNote: SaveNote;
  onAction: (body: ActionBody) => void;
  onClose: () => void;
}) {
  const [blockReason, setBlockReason] = useState("");
  const [noteText, setNoteText] = useState("");
  const [unblocksDraft, setUnblocksDraft] = useState(item.unblocks.join(", "));

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const done = item.state === "done";
  const Icon = done ? SquareCheck : Square;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/40 sm:items-center" onClick={onClose}>
      <div
        className="glass-card max-h-[85vh] w-full max-w-md overflow-y-auto rounded-t-3xl p-5 sm:rounded-3xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="money text-xs font-bold text-slate-400 dark:text-slate-500">{item.id}</p>
            <h3 className="mt-0.5 text-sm font-semibold text-pretty text-slate-800 dark:text-slate-100">{item.title}</h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex min-h-9 min-w-9 shrink-0 items-center justify-center rounded-full text-slate-400 hover:bg-slate-100 dark:text-slate-500 dark:hover:bg-white/5"
          >
            <X size={16} aria-hidden="true" />
          </button>
        </div>

        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <PriorityPill priority={item.priority} />
          <StatePill item={item} />
        </div>

        {item.text && <p className="mt-3 text-xs leading-relaxed text-pretty text-slate-600 dark:text-slate-300">{item.text}</p>}

        {item.notes.length > 0 && (
          <ul className="mt-3 space-y-1 border-t border-slate-100 pt-3 dark:border-white/10">
            {item.notes.map((note, idx) => (
              <li key={idx} className="text-[11px] leading-relaxed text-slate-400 dark:text-slate-500">
                <span className="money font-semibold">{note.date}</span> ({note.actor}): {note.text}
              </li>
            ))}
          </ul>
        )}

        <div className="mt-4 space-y-4 border-t border-slate-100 pt-4 dark:border-white/10">
          <div className="flex items-center justify-between gap-3">
            <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">Done</span>
            <button
              type="button"
              disabled={pending}
              onClick={() => onAction(done ? { action: "reopen" } : { action: "done" })}
              className="flex min-h-9 min-w-9 items-center justify-center disabled:opacity-50"
              aria-label={done ? "Reopen item" : "Mark done"}
            >
              <Icon size={20} className={done ? "text-emerald-500" : "text-slate-400 dark:text-slate-500"} aria-hidden="true" />
            </button>
          </div>

          <div className="flex items-center justify-between gap-3">
            <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">Owner</span>
            <div className="flex gap-1.5">
              {(["kevin", "claude"] as GoLiveOwner[]).map((owner) => (
                <button
                  key={owner}
                  type="button"
                  disabled={pending}
                  onClick={() => onAction({ action: "owner", owner })}
                  className={`min-h-9 rounded-full border px-3 text-xs font-semibold disabled:opacity-50 ${
                    (item.owner ?? "claude") === owner
                      ? "border-indigo-300 bg-indigo-50 text-indigo-700 dark:border-indigo-800 dark:bg-indigo-950/40 dark:text-indigo-300"
                      : "border-slate-200 text-slate-600 hover:bg-slate-50 dark:border-white/10 dark:text-slate-300 dark:hover:bg-white/5"
                  }`}
                >
                  {owner === "kevin" ? "Kevin" : "Claude"}
                </button>
              ))}
            </div>
          </div>

          {!done && (
            <div className="flex items-center justify-between gap-3">
              <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">Priority</span>
              <div className="flex gap-1.5">
                {PRIORITY_ORDER.map((p: GoLivePriority) => (
                  <button
                    key={p}
                    type="button"
                    disabled={pending}
                    onClick={() => onAction({ action: "priority", priority: p })}
                    className={`min-h-9 rounded-full px-3 text-xs font-bold disabled:opacity-50 ${
                      item.priority === p
                        ? "bg-indigo-600 text-white"
                        : "bg-slate-50 text-slate-600 hover:bg-slate-100 dark:bg-white/5 dark:text-slate-300 dark:hover:bg-white/10"
                    }`}
                  >
                    {PRIORITY_LABEL[p]}
                  </button>
                ))}
              </div>
            </div>
          )}

          {!done && item.state !== "in-progress" && (
            <button
              type="button"
              disabled={pending}
              onClick={() => onAction({ action: "start" })}
              className="min-h-9 w-full rounded-lg border border-slate-200 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50 dark:border-white/10 dark:text-slate-200 dark:hover:bg-white/5"
            >
              Start
            </button>
          )}

          {!done && (
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-500 dark:text-slate-400">Block, with a reason</label>
              <div className="flex gap-1.5">
                <input
                  type="text"
                  value={blockReason}
                  onChange={(e) => setBlockReason(e.target.value)}
                  placeholder="Reason"
                  className="min-h-9 flex-1 rounded-lg border border-slate-200 bg-slate-50 px-2 text-xs text-slate-800 focus:border-indigo-400 focus:outline-none dark:border-white/10 dark:bg-slate-900 dark:text-slate-100"
                />
                <button
                  type="button"
                  disabled={pending || !blockReason.trim()}
                  onClick={() => {
                    onAction({ action: "block", reason: blockReason.trim() });
                    setBlockReason("");
                  }}
                  className="min-h-9 shrink-0 rounded-lg bg-slate-800 px-3 text-xs font-semibold text-white disabled:opacity-50 dark:bg-slate-700"
                >
                  Block
                </button>
              </div>
            </div>
          )}

          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-500 dark:text-slate-400">Add a note</label>
            <div className="flex gap-1.5">
              <input
                type="text"
                value={noteText}
                onChange={(e) => setNoteText(e.target.value)}
                placeholder="Note"
                className="min-h-9 flex-1 rounded-lg border border-slate-200 bg-slate-50 px-2 text-xs text-slate-800 focus:border-indigo-400 focus:outline-none dark:border-white/10 dark:bg-slate-900 dark:text-slate-100"
              />
              <button
                type="button"
                disabled={pending || !noteText.trim()}
                onClick={() => {
                  onAction({ action: "note", text: noteText.trim() });
                  setNoteText("");
                }}
                className="min-h-9 shrink-0 rounded-lg bg-indigo-600 px-3 text-xs font-semibold text-white disabled:opacity-50"
              >
                Add
              </button>
            </div>
          </div>

          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-500 dark:text-slate-400">Unblocks (comma-separated)</label>
            <div className="flex gap-1.5">
              <input
                type="text"
                value={unblocksDraft}
                onChange={(e) => setUnblocksDraft(e.target.value)}
                placeholder="Q5, Q6"
                className="min-h-9 flex-1 rounded-lg border border-slate-200 bg-slate-50 px-2 text-xs text-slate-800 focus:border-indigo-400 focus:outline-none dark:border-white/10 dark:bg-slate-900 dark:text-slate-100"
              />
              <button
                type="button"
                disabled={pending}
                onClick={() =>
                  onAction({
                    action: "unblocks",
                    questions: unblocksDraft
                      .split(",")
                      .map((q) => q.trim())
                      .filter(Boolean),
                  })
                }
                className="min-h-9 shrink-0 rounded-lg bg-indigo-600 px-3 text-xs font-semibold text-white disabled:opacity-50"
              >
                Save
              </button>
            </div>
          </div>

          {saveNote && (
            <p className={`money text-[11px] font-semibold ${saveNote.ok ? "text-slate-400 dark:text-slate-500" : "text-amber-600 dark:text-amber-400"}`}>
              {saveNote.text}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
