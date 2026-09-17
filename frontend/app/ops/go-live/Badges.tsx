"use client";

// Small presentational pieces shared between the list and board views:
// the state pill, the priority pill, the unblocks tags, and the owner
// toggle button. Kept in one file since none of these carry their own
// state or fetch logic — they're pure display plus a click callback.

import {
  OWNER_INITIAL,
  OWNER_LABEL,
  PRIORITY_LABEL,
  PRIORITY_PILL_CLASS,
  nextOwner,
  type GoLiveItem,
  type GoLiveOwner,
  type GoLivePriority,
} from "@/lib/goLive";

function formatDoneDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
  } catch {
    return iso;
  }
}

export function StatePill({ item, compact = false }: { item: GoLiveItem; compact?: boolean }) {
  if (item.state === "todo") return null;
  if (item.state === "in-progress") {
    return (
      <span className="inline-flex shrink-0 items-center rounded-full bg-indigo-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-300">
        In progress
      </span>
    );
  }
  if (item.state === "blocked") {
    // `compact` (dense one-line rows, e.g. MobileRibbonBoard's ItemRow)
    // drops the free-text reason entirely rather than truncating it: a
    // phone-width row has no room for both an id, a title and a reason
    // fragment, and a mid-string cut (even an ellipsised one) is still
    // noise next to the state word itself. The full reason stays one tap
    // away in ItemDetailSheet, which is why its own truncation (the inner
    // `truncate` span below) has to actually work — see the H56 fix note
    // on that inner span.
    return (
      <span className="inline-flex max-w-[220px] min-w-0 shrink-0 items-center rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
        {/* `truncate` (overflow-hidden + text-overflow:ellipsis +
            white-space:nowrap) has no effect applied directly to an
            `inline-flex` container's own raw text children: text-overflow
            only renders on a block-level box, and a flex container's
            direct text is laid out as an anonymous flex item, not a block
            box, so the browser clipped mid-word with no "…" (H56, found
            2026-09-17 rendering this exact pill on UAT). Moving `truncate`
            (plus `min-w-0`, so the flex item can actually shrink below its
            content size) onto this inner span — which flex blockifies —
            fixes it: the ellipsis now renders for real. */}
        <span className="min-w-0 truncate">Blocked{!compact && item.reason ? `: ${item.reason}` : ""}</span>
      </span>
    );
  }
  if (item.state === "review") {
    return (
      <span className="inline-flex max-w-[220px] min-w-0 shrink-0 items-center rounded-full bg-indigo-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-300">
        <span className="min-w-0 truncate">In review{!compact && item.branch ? `: ${item.branch}` : ""}</span>
      </span>
    );
  }
  if (item.state === "rejected") {
    // Same amber treatment as Blocked, never red: a rejection means a
    // reviewer found something and this needs a decision, not that
    // anything has failed (DESIGN.md "The Red Is Risk Rule").
    return (
      <span className="inline-flex max-w-[220px] min-w-0 shrink-0 items-center rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
        <span className="min-w-0 truncate">Rejected{!compact && item.reason ? `: ${item.reason}` : ""}</span>
      </span>
    );
  }
  if (item.state === "uat") {
    // Same amber treatment as Blocked/Rejected, never red: a design round
    // waiting on Kevin's choice is not a failure of anything (see H31 and
    // DESIGN.md "The Red Is Risk Rule").
    return (
      <span className="inline-flex max-w-[220px] shrink-0 items-center truncate rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
        UAT, waiting on you
      </span>
    );
  }
  // done
  const short = item.commit ? item.commit.slice(0, 7) : null;
  return (
    <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
      Done{item.done_at ? ` ${formatDoneDate(item.done_at)}` : ""}
      {short ? ` · ${short}` : ""}
    </span>
  );
}

export function PriorityPill({ priority }: { priority: GoLivePriority }) {
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${PRIORITY_PILL_CLASS[priority]}`}
    >
      {PRIORITY_LABEL[priority]}
    </span>
  );
}

export function UnblocksTags({ unblocks, onJumpTo }: { unblocks: string[]; onJumpTo?: (questionId: string) => void }) {
  if (unblocks.length === 0) return null;
  return (
    <span className="inline-flex flex-wrap items-center gap-1 text-[10px] font-semibold text-slate-400 dark:text-slate-500">
      unblocks
      {unblocks.map((q) =>
        onJumpTo ? (
          <button
            key={q}
            type="button"
            onClick={() => onJumpTo(q)}
            className="money rounded-full bg-slate-100 px-1.5 py-0.5 text-slate-500 hover:bg-slate-200 dark:bg-white/5 dark:text-slate-400 dark:hover:bg-white/10"
          >
            {q}
          </button>
        ) : (
          <span key={q} className="money rounded-full bg-slate-100 px-1.5 py-0.5 text-slate-500 dark:bg-white/5 dark:text-slate-400">
            {q}
          </span>
        )
      )}
    </span>
  );
}

export function OwnerToggle({
  owner,
  disabled,
  onToggle,
}: {
  owner: GoLiveOwner | null;
  disabled: boolean;
  onToggle: (next: GoLiveOwner) => void;
}) {
  const current: GoLiveOwner = owner ?? "claude";
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => onToggle(nextOwner(current))}
      className="inline-flex min-h-9 shrink-0 items-center rounded-full border border-slate-200 px-2.5 text-[11px] font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-50 dark:border-white/10 dark:text-slate-300 dark:hover:bg-white/5"
      title="Tap to cycle owner (Kevin, Claude, Codex)"
    >
      {OWNER_LABEL[current]}
    </button>
  );
}

export function OwnerInitialChip({ owner }: { owner: GoLiveOwner | null }) {
  const current: GoLiveOwner = owner ?? "claude";
  return (
    <span
      className="money inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-slate-100 text-[10px] font-bold text-slate-500 dark:bg-white/10 dark:text-slate-300"
      title={OWNER_LABEL[current]}
    >
      {OWNER_INITIAL[current]}
    </span>
  );
}
