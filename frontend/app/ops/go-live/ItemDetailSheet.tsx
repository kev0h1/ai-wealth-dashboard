"use client";

// The board card's detail sheet: the same controls as the list-view row
// (owner, move-to-state including done/reopen, block with reason, reject
// with reason (review items only), note, priority, unblocks) collected
// into one popover since a kanban card doesn't have room for the list's
// inline buttons. Opened by tapping a card in BoardView; no drag-and-drop,
// every state change goes through here.
//
// Move to (H55): a labelled block of state chips, directly above Owner,
// showing the item's current state as selected. This is the deliberate,
// undo-a-drag-by-hand route for the board's touch-scroll fix (see the
// header comment in BoardView.tsx) — a drag on a phone should be rare
// now, but when one still lands on the wrong column this sets it back in
// one tap with no drag involved. It replaces the old standalone "Start",
// "Move to To do" buttons and the "Done" checkbox row, which did the same
// three transitions through separate control languages; all are now just
// chips in this one row. Only states this API can actually move an item
// to are offered: `review` isn't included because nothing but
// `scripts/session.sh finish` can set it (see `backend/app/routers/
// ops.py`); `uat` isn't included because its action requires a preview
// link this sheet has no input for and isn't allowed to invent one for;
// `rejected` is only offered while the item is already `review`, same as
// the list view's `ItemMenu` and the same reason CLAUDE.md gives for the
// state existing at all — a rejection is defined relative to a review
// that's actually happened, and BoardView already refuses `rejected` as a
// drop target for the same reason. Tapping "Blocked" or "Rejected" reveals
// the existing reason input below instead of firing immediately, exactly
// like the pre-H55 block control already did, and stays available on the
// item's own current state too (unlike every other chip) so a wrong
// reason can still be corrected — the whole point of this sheet is fixing
// a mistaken state, and a mistaken *reason* is exactly the same kind of
// mistake.

import { useEffect, useState } from "react";
import { X } from "lucide-react";
import type { api } from "@/lib/api";
import {
  BOARD_COLUMNS,
  OWNER_LABEL,
  OWNER_ORDER,
  PRIORITY_LABEL,
  PRIORITY_ORDER,
  type GoLiveItem,
  type GoLiveItemState,
  type GoLivePriority,
} from "@/lib/goLive";
import { PriorityPill, StatePill } from "./Badges";

type ActionBody = Parameters<typeof api.goLiveItemAction>[1];
type SaveNote = { ok: boolean; text: string } | null;

// The states a "Move to" tap can immediately fire an action for, without
// a reason input — everything except `blocked`/`rejected` (handled by
// `handleMoveTo` below, which reveals a reason input instead of calling
// this) and `review`/`uat` (never offered as chips at all — see the file
// header comment). Explicit per-case rather than a chained ternary or a
// static lookup table, and no `default` branch: `todo`'s action depends
// on whether the item is currently done, and listing every
// `GoLiveItemState` by name means adding a new state to that type without
// adding a case here fails the build instead of silently falling through
// to some other action (a destructive default is exactly how a future
// "uat" chip could end up marking an item done).
function actionForMoveTo(target: GoLiveItemState, isDone: boolean): ActionBody {
  switch (target) {
    case "todo":
      return isDone ? { action: "reopen" } : { action: "todo" };
    case "in-progress":
      return { action: "start" };
    case "done":
      return { action: "done" };
    case "blocked":
    case "rejected":
    case "review":
    case "uat":
      throw new Error(`"${target}" has no direct Move to action`);
  }
}

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
  const [rejectReason, setRejectReason] = useState("");
  const [approveChoice, setApproveChoice] = useState("");
  const [noteText, setNoteText] = useState("");
  const [unblocksDraft, setUnblocksDraft] = useState(item.unblocks.join(", "));
  // Which reason input the "Move to" row has revealed, if any — null means
  // neither is showing. Tapping the same chip again collapses it.
  const [revealed, setRevealed] = useState<"blocked" | "rejected" | null>(null);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const done = item.state === "done";

  // The states a "Move to" tap can actually land on, in board-column
  // order. `rejected` only appears while the item is genuinely `review` —
  // see the file header comment for why. `review` and `uat` are never
  // offered at all.
  const moveToStates = BOARD_COLUMNS.filter(
    (col) => col.key !== "review" && col.key !== "uat" && (col.key !== "rejected" || item.state === "review")
  );

  // Tapping a chip: Blocked/Rejected reveal their reason input (toggling
  // closed on a second tap of the same chip) instead of firing right
  // away, and do so even when the item is already in that state, so a
  // wrong reason can be corrected (see the file header comment). Every
  // other chip fires its action immediately via `actionForMoveTo` and
  // closes whichever input was open; tapping the item's own current state
  // among those is a no-op, since there's nothing to set it back to.
  function handleMoveTo(target: GoLiveItemState) {
    if (target === "blocked") {
      setRevealed((r) => (r === "blocked" ? null : "blocked"));
      return;
    }
    if (target === "rejected") {
      setRevealed((r) => (r === "rejected" ? null : "rejected"));
      return;
    }
    if (target === item.state) return;
    setRevealed(null);
    onAction(actionForMoveTo(target, done));
  }

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
          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-500 dark:text-slate-400">Move to</label>
            <div className="flex flex-wrap gap-1.5">
              {moveToStates.map((col) => {
                const selected = item.state === col.key;
                const hasReason = col.key === "blocked" || col.key === "rejected";
                return (
                  <button
                    key={col.key}
                    type="button"
                    disabled={pending}
                    onClick={() => handleMoveTo(col.key)}
                    aria-pressed={selected}
                    {...(hasReason
                      ? {
                          "aria-expanded": revealed === col.key,
                          "aria-controls": `move-to-${col.key}-reason`,
                        }
                      : {})}
                    className={`min-h-11 rounded-full border px-3 text-xs font-semibold disabled:opacity-50 ${
                      selected
                        ? "border-indigo-300 bg-indigo-50 text-indigo-700 dark:border-indigo-800 dark:bg-indigo-950/40 dark:text-indigo-300"
                        : "border-slate-200 text-slate-600 hover:bg-slate-50 dark:border-white/10 dark:text-slate-300 dark:hover:bg-white/5"
                    }`}
                  >
                    {col.label}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="flex items-center justify-between gap-3">
            <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">Owner</span>
            <div className="flex gap-1.5">
              {OWNER_ORDER.map((owner) => (
                <button
                  key={owner}
                  type="button"
                  disabled={pending}
                  onClick={() => onAction({ action: "owner", owner })}
                  className={`min-h-11 rounded-full border px-3 text-xs font-semibold disabled:opacity-50 ${
                    (item.owner ?? "claude") === owner
                      ? "border-indigo-300 bg-indigo-50 text-indigo-700 dark:border-indigo-800 dark:bg-indigo-950/40 dark:text-indigo-300"
                      : "border-slate-200 text-slate-600 hover:bg-slate-50 dark:border-white/10 dark:text-slate-300 dark:hover:bg-white/5"
                  }`}
                >
                  {OWNER_LABEL[owner]}
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
                    className={`min-h-11 rounded-full px-3 text-xs font-bold disabled:opacity-50 ${
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

          {revealed === "blocked" && (
            <div id="move-to-blocked-reason">
              <label className="mb-1 block text-xs font-semibold text-slate-500 dark:text-slate-400">Block, with a reason</label>
              <div className="flex gap-1.5">
                <input
                  autoFocus
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
                    setRevealed(null);
                  }}
                  className="min-h-9 shrink-0 rounded-lg bg-slate-800 px-3 text-xs font-semibold text-white disabled:opacity-50 dark:bg-slate-700"
                >
                  Block
                </button>
              </div>
            </div>
          )}

          {revealed === "rejected" && (
            <div id="move-to-rejected-reason">
              <label className="mb-1 block text-xs font-semibold text-slate-500 dark:text-slate-400">Reject, with a reason</label>
              <div className="flex gap-1.5">
                <input
                  autoFocus
                  type="text"
                  value={rejectReason}
                  onChange={(e) => setRejectReason(e.target.value)}
                  placeholder="Reason"
                  className="min-h-9 flex-1 rounded-lg border border-slate-200 bg-slate-50 px-2 text-xs text-slate-800 focus:border-indigo-400 focus:outline-none dark:border-white/10 dark:bg-slate-900 dark:text-slate-100"
                />
                <button
                  type="button"
                  disabled={pending || !rejectReason.trim()}
                  onClick={() => {
                    onAction({ action: "reject", reason: rejectReason.trim() });
                    setRejectReason("");
                    setRevealed(null);
                  }}
                  className="min-h-9 shrink-0 rounded-lg bg-slate-800 px-3 text-xs font-semibold text-white disabled:opacity-50 dark:bg-slate-700"
                >
                  Reject
                </button>
              </div>
            </div>
          )}

          {item.state === "uat" && item.link && (
            <p className="text-xs leading-relaxed text-slate-600 dark:text-slate-300">
              Preview:{" "}
              <a
                href={item.link}
                target="_blank"
                rel="noreferrer"
                className="font-semibold text-indigo-600 underline dark:text-indigo-400"
              >
                {item.link}
              </a>
            </p>
          )}

          {item.state === "uat" && (
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-500 dark:text-slate-400">Approve, which variant</label>
              <div className="flex gap-1.5">
                <input
                  type="text"
                  value={approveChoice}
                  onChange={(e) => setApproveChoice(e.target.value)}
                  placeholder="Which one, e.g. Variant B"
                  className="min-h-9 flex-1 rounded-lg border border-slate-200 bg-slate-50 px-2 text-xs text-slate-800 focus:border-indigo-400 focus:outline-none dark:border-white/10 dark:bg-slate-900 dark:text-slate-100"
                />
                <button
                  type="button"
                  disabled={pending || !approveChoice.trim()}
                  onClick={() => {
                    onAction({ action: "approve", choice: approveChoice.trim() });
                    setApproveChoice("");
                  }}
                  className="min-h-9 shrink-0 rounded-lg bg-indigo-600 px-3 text-xs font-semibold text-white disabled:opacity-50"
                >
                  Approve
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
