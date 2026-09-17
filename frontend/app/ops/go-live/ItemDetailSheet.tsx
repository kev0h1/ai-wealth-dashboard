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

import { useState } from "react";
import { ChevronDown, X } from "lucide-react";
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
import { useSheetA11y } from "@/lib/useSheetA11y";
import { PriorityPill, StatePill } from "./Badges";

// Word-safe single-line preview: cuts at the last space at or before
// `maxLength` rather than mid-word, then appends a real ellipsis
// character (H71, corrected after review). This is a DOM-size guard, not
// a width calculation, and `truncate` (CSS `text-overflow: ellipsis`,
// restored below) is deliberately still applied on top of it: when CSS
// is what actually clips the line, the JS-appended ellipsis sits past
// the clip point and is never painted, so there is no stacked/second
// ellipsis — proved on this exact markup by forcing `text-overflow:
// ellipsis` at runtime with the budget untouched and observing one clean
// ellipsis. A fixed character count cannot track the available pixel
// width anyway (this sheet is ~348px at a true 390px but 406px at the
// `sm:` centred-modal `max-w-md` width, and glyph width varies by
// content), so CSS owns the real clipping; this budget only exists as a
// cheap backstop against pathologically long single notes reaching the
// DOM at all (hence "generous", not tuned to any particular box).
const NOTE_PREVIEW_BUDGET = 100;
function truncateWords(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  const cut = text.slice(0, maxLength);
  const lastSpace = cut.lastIndexOf(" ");
  const safe = (lastSpace > 0 ? cut.slice(0, lastSpace) : cut).trimEnd();
  return `${safe}…`;
}

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
    case "cancelled":
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
  const [cancelReason, setCancelReason] = useState("");
  const [approveChoice, setApproveChoice] = useState("");
  const [noteText, setNoteText] = useState("");
  const [unblocksDraft, setUnblocksDraft] = useState(item.unblocks.join(", "));
  // Which reason input the "Move to" row has revealed, if any — null means
  // none are showing. Tapping the same chip again collapses it.
  const [revealed, setRevealed] = useState<"blocked" | "rejected" | "cancelled" | null>(null);
  // Notes default COLLAPSED (H71): an item can carry several long
  // paragraph notes (its audit trail), which pushed every actual control
  // below the fold. The state tag's own reason (StatePill, above) is
  // deliberately NOT part of this collapse — a rejection/block reason is
  // an instruction, not history, so it always stays visible.
  const [notesExpanded, setNotesExpanded] = useState(false);

  // H71: focus trap, Escape, background scroll lock (position-fixed with
  // scroll-offset restore, not the naive overflow:hidden) and back-to-close
  // (Android hardware back / browser back closes the sheet and returns to
  // the board scroll position) all come from the shared hook now, replacing
  // the partial Escape-only handler this file used to carry on its own.
  // `close` — not the raw `onClose` prop — is the one path every in-app
  // affordance below (X button, backdrop tap) must call, so a hardware
  // back press and an in-app close run the exact same code (see
  // lib/useSheetA11y.ts's file header for the full reasoning).
  const { ref: panelRef, close } = useSheetA11y<HTMLDivElement>(onClose, {
    lockScroll: true,
    backToClose: true,
  });

  const done = item.state === "done";

  // The states a "Move to" tap can actually land on, in board-column
  // order. `rejected` only appears while the item is genuinely `review` —
  // see the file header comment for why. `cancelled` (H80) is offered
  // from any state (Kevin can cancel work at any point, not just out of
  // review) but is kevin-only, enforced server-side, not hidden here —
  // this page is already reachable only by the account owner, and a
  // non-owner attempt would fail with a clear error surfaced via
  // `saveNote` the same way any other refused action does. `review` and
  // `uat` are never offered at all.
  const moveToStates = BOARD_COLUMNS.filter(
    (col) => col.key !== "review" && col.key !== "uat" && (col.key !== "rejected" || item.state === "review")
  );

  // Tapping a chip: Blocked/Rejected/Cancelled reveal their reason input
  // (toggling closed on a second tap of the same chip) instead of firing
  // right away, and do so even when the item is already in that state, so
  // a wrong reason can be corrected (see the file header comment). Every
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
    if (target === "cancelled") {
      setRevealed((r) => (r === "cancelled" ? null : "cancelled"));
      return;
    }
    if (target === item.state) return;
    setRevealed(null);
    onAction(actionForMoveTo(target, done));
  }

  const newestNote = item.notes.length > 0 ? item.notes[item.notes.length - 1] : null;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/40 sm:items-center" onClick={close}>
      <div
        className="glass-card flex max-h-[85vh] w-full max-w-md flex-col overflow-hidden rounded-t-3xl sm:rounded-3xl"
        onClick={(e) => e.stopPropagation()}
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="item-detail-title"
      >
        {/* Sticky header (H71, corrected after review): only the id, the
            close X (the only visible close affordance) and the
            priority/state pill row are pinned — NOT the full title. This
            board's titles are the item text itself: a real audit at a
            true 390px measured H55's header at 378px of a 717px panel,
            G41 at 498/717, and A38 (678/717, 37px left for everything
            else) — 72% of the 317 real items exceed 200 characters, so
            A38 is the median case, not an edge one. Pinning the whole
            title recreated Kevin's original complaint in a worse form:
            at 390x500 (landscape, or the note-input keyboard open) it
            pushed Move to and every input below the fold with nothing to
            scroll them into view. The title still gets a `line-clamp-2`
            line here for orientation while scrolled, with the full text
            repeated, unclamped, at the top of the scrollable body below.
            `max-h-[50vh]` (a viewport unit, not a `%` of this flex
            column's own auto/max-height, which CSS would resolve as
            "none" against an indefinite parent height) plus
            `overflow-hidden` is the hard cap so the header itself can
            never eat the panel regardless of content — raised from an
            earlier 34vh, which clipped this pill row by 2px at a real
            390x340 measurement; `line-clamp-2` already bounds the
            header's real height to a constant 118px regardless of title
            length, so the cap only exists as a backstop and costs
            nothing to raise. NOTE: pinning this row does NOT, on its
            own, keep a block/reject/cancel reason readable — StatePill
            (below) truncates its own `Blocked: <reason>` /
            `Rejected: <reason>` / `Cancelled: <reason>` text at
            `max-w-[220px]`, so a long reason still gets cut off
            here exactly like the title used to. The FULL reason is
            rendered separately, unclamped, in the scrollable body next
            to the repeated title — see below — which is the actual fix
            for keeping it reachable, not this pinning. */}
        <div className="flex max-h-[50vh] shrink-0 flex-col overflow-hidden border-b border-slate-100 p-5 pb-3 dark:border-white/10">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="money text-xs font-bold text-slate-400 dark:text-slate-500">{item.id}</p>
              <h3 id="item-detail-title" className="mt-0.5 line-clamp-2 text-sm font-semibold text-pretty text-slate-800 dark:text-slate-100">
                {item.title}
              </h3>
            </div>
            <button
              type="button"
              onClick={close}
              aria-label="Close"
              className="flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-full text-slate-400 hover:bg-slate-100 dark:text-slate-500 dark:hover:bg-white/5"
            >
              <X size={16} aria-hidden="true" />
            </button>
          </div>

          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <PriorityPill priority={item.priority} />
            <StatePill item={item} />
          </div>
        </div>

        {/* Scrollable body. `min-h-0` is load-bearing: a flex item's
            default `min-height: auto` sizes it to its content first,
            which is exactly what let the header's unclamped title eat
            the whole panel before this fix — without it, overflow-y-auto
            here would not actually kick in until content exceeded that
            content-driven minimum. The full title repeats here,
            unclamped, since the header above only shows two lines;
            `aria-hidden` on it because `aria-labelledby` on the panel
            already names the dialog from the header's h3 (whose
            accessible text is the full, unclamped title regardless of
            its visual `line-clamp-2` — CSS clamping doesn't touch the
            accessibility tree), so a screen reader would otherwise hear
            the same title twice in a row: once as the dialog's name,
            then again as the first thing read in the body. The full
            block/reject/cancel reason (see the header comment above)
            renders right after it, NOT hidden — StatePill above only
            shows a 220px-truncated version. */}
        <div className="min-h-0 flex-1 overflow-y-auto p-5 pt-3">
          <p aria-hidden="true" className="text-sm font-semibold text-pretty text-slate-800 dark:text-slate-100">
            {item.title}
          </p>

          {item.reason && (
            <div className="mt-2">
              <p className="text-xs font-semibold text-slate-500 dark:text-slate-400">Reason</p>
              <p className="mt-0.5 text-xs leading-relaxed text-pretty text-slate-700 dark:text-slate-200">{item.reason}</p>
            </div>
          )}

          {item.text && <p className="mt-2 text-xs leading-relaxed text-pretty text-slate-600 dark:text-slate-300">{item.text}</p>}

          {newestNote && (
            <div className="mt-3 space-y-1 border-t border-slate-100 pt-3 dark:border-white/10">
              {/* No `aria-controls`: the list it would reference is only
                  in the DOM while expanded, so the id would dangle
                  while collapsed. `aria-expanded` alone is the correct,
                  supported signal for a disclosure whose target isn't
                  always present. */}
              <button
                type="button"
                onClick={() => setNotesExpanded((v) => !v)}
                aria-expanded={notesExpanded}
                className="flex min-h-11 w-full items-center justify-between gap-2 text-left"
              >
                <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">Notes ({item.notes.length})</span>
                <ChevronDown
                  size={14}
                  className={`shrink-0 text-slate-400 transition-transform dark:text-slate-500 ${notesExpanded ? "rotate-180" : ""}`}
                  aria-hidden="true"
                />
              </button>

              {!notesExpanded && (
                <p className="truncate text-[11px] leading-relaxed text-slate-400 dark:text-slate-500">
                  <span className="money font-semibold">{newestNote.date}</span> ({newestNote.actor}): {truncateWords(newestNote.text, NOTE_PREVIEW_BUDGET)}
                </p>
              )}

              {notesExpanded && (
                <ul className="space-y-1">
                  {item.notes.map((note, idx) => (
                    <li key={idx} className="text-[11px] leading-relaxed text-slate-400 dark:text-slate-500">
                      <span className="money font-semibold">{note.date}</span> ({note.actor}): {note.text}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          <div className="mt-4 space-y-4 border-t border-slate-100 pt-4 dark:border-white/10">
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-500 dark:text-slate-400">Move to</label>
              <div className="flex flex-wrap gap-1.5">
                {moveToStates.map((col) => {
                  const selected = item.state === col.key;
                  const hasReason = col.key === "blocked" || col.key === "rejected" || col.key === "cancelled";
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
                            // Only set aria-controls when the reason
                            // input it names is actually in the DOM
                            // (revealed below renders it conditionally on
                            // this same check) — otherwise it dangles the
                            // same way the notes toggle's used to.
                            ...(revealed === col.key ? { "aria-controls": `move-to-${col.key}-reason` } : {}),
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

            {revealed === "cancelled" && (
              <div id="move-to-cancelled-reason">
                <label className="mb-1 block text-xs font-semibold text-slate-500 dark:text-slate-400">
                  Cancel, with a reason (Kevin only)
                </label>
                <div className="flex gap-1.5">
                  <input
                    autoFocus
                    type="text"
                    value={cancelReason}
                    onChange={(e) => setCancelReason(e.target.value)}
                    placeholder="Reason, this should not happen at all"
                    className="min-h-9 flex-1 rounded-lg border border-slate-200 bg-slate-50 px-2 text-xs text-slate-800 focus:border-indigo-400 focus:outline-none dark:border-white/10 dark:bg-slate-900 dark:text-slate-100"
                  />
                  <button
                    type="button"
                    disabled={pending || !cancelReason.trim()}
                    onClick={() => {
                      onAction({ action: "cancel", reason: cancelReason.trim() });
                      setCancelReason("");
                      setRevealed(null);
                    }}
                    className="min-h-9 shrink-0 rounded-lg bg-slate-600 px-3 text-xs font-semibold text-white disabled:opacity-50 dark:bg-slate-500"
                  >
                    Cancel
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
    </div>
  );
}
