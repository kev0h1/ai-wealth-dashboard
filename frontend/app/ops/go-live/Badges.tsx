"use client";

// Small presentational pieces shared between the list and board views:
// the state pill, the priority pill, the unblocks tags, and the owner
// toggle button. Kept in one file since none of these carry their own
// state or fetch logic — they're pure display plus a click callback.

import { PRIORITY_LABEL, PRIORITY_PILL_CLASS, type GoLiveItem, type GoLiveOwner, type GoLivePriority } from "@/lib/goLive";

function formatDoneDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
  } catch {
    return iso;
  }
}

export function StatePill({ item }: { item: GoLiveItem }) {
  if (item.state === "todo") return null;
  if (item.state === "in-progress") {
    return (
      <span className="inline-flex shrink-0 items-center rounded-full bg-indigo-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-300">
        In progress
      </span>
    );
  }
  if (item.state === "blocked") {
    return (
      <span className="inline-flex max-w-[220px] shrink-0 items-center truncate rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
        Blocked{item.reason ? `: ${item.reason}` : ""}
      </span>
    );
  }
  if (item.state === "review") {
    return (
      <span className="inline-flex max-w-[220px] shrink-0 items-center truncate rounded-full bg-indigo-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-300">
        In review{item.branch ? `: ${item.branch}` : ""}
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
  const label = current === "kevin" ? "Kevin" : "Claude";
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => onToggle(current === "kevin" ? "claude" : "kevin")}
      className="inline-flex min-h-9 shrink-0 items-center rounded-full border border-slate-200 px-2.5 text-[11px] font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-50 dark:border-white/10 dark:text-slate-300 dark:hover:bg-white/5"
      title="Tap to reassign owner"
    >
      {label}
    </button>
  );
}

export function OwnerInitialChip({ owner }: { owner: GoLiveOwner | null }) {
  const current: GoLiveOwner = owner ?? "claude";
  const initial = current === "kevin" ? "K" : "C";
  return (
    <span
      className="money inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-slate-100 text-[10px] font-bold text-slate-500 dark:bg-white/10 dark:text-slate-300"
      title={current === "kevin" ? "Kevin" : "Claude"}
    >
      {initial}
    </span>
  );
}
