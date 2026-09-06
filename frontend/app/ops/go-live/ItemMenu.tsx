"use client";

// The "more actions" menu on a list-view item row: Start, Block, Note,
// Priority (three-way) and Unblocks (comma-separated inline field). Same
// shape as the original page.tsx ItemMenu, extended with the two new
// controls per the priorities/unblocks round.

import { useState } from "react";
import { MoreHorizontal } from "lucide-react";
import { PRIORITY_LABEL, PRIORITY_ORDER, type GoLiveItem, type GoLivePriority } from "@/lib/goLive";

type Mode = "menu" | "block" | "note" | "unblocks";

export function ItemMenu({
  item,
  disabled,
  onStart,
  onBlock,
  onNote,
  onPriority,
  onUnblocks,
}: {
  item: GoLiveItem;
  disabled: boolean;
  onStart: () => void;
  onBlock: (reason: string) => void;
  onNote: (text: string) => void;
  onPriority: (priority: GoLivePriority) => void;
  onUnblocks: (questions: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<Mode>("menu");
  const [draft, setDraft] = useState("");

  function closeAll() {
    setOpen(false);
    setMode("menu");
    setDraft("");
  }

  if (item.state === "done") return null;

  return (
    <div className="relative">
      <button
        type="button"
        disabled={disabled}
        onClick={() => {
          setOpen((v) => !v);
          setMode("menu");
        }}
        aria-label="More actions"
        className="flex min-h-9 min-w-9 shrink-0 items-center justify-center rounded-full text-slate-400 hover:bg-slate-100 disabled:opacity-50 dark:text-slate-500 dark:hover:bg-white/5"
      >
        <MoreHorizontal size={16} aria-hidden="true" />
      </button>

      {open && mode === "menu" && (
        <div className="absolute right-0 top-10 z-10 w-44 rounded-xl border border-slate-200 bg-white p-1 shadow-lg dark:border-white/10 dark:bg-slate-800">
          {item.state !== "in-progress" && (
            <button
              type="button"
              onClick={() => {
                onStart();
                closeAll();
              }}
              className="flex min-h-9 w-full items-center rounded-lg px-2 text-left text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-white/5"
            >
              Start
            </button>
          )}
          <button
            type="button"
            onClick={() => setMode("block")}
            className="flex min-h-9 w-full items-center rounded-lg px-2 text-left text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-white/5"
          >
            Block
          </button>
          <button
            type="button"
            onClick={() => setMode("note")}
            className="flex min-h-9 w-full items-center rounded-lg px-2 text-left text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-white/5"
          >
            Note
          </button>
          <div className="my-1 border-t border-slate-100 dark:border-white/10" />
          <p className="px-2 pb-1 pt-1.5 text-[10px] font-bold uppercase tracking-wide text-slate-400 dark:text-slate-500">
            Priority
          </p>
          <div className="flex gap-1 px-2 pb-1.5">
            {PRIORITY_ORDER.map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => {
                  onPriority(p);
                  closeAll();
                }}
                className={`min-h-8 flex-1 rounded-lg text-xs font-bold ${
                  item.priority === p
                    ? "bg-indigo-600 text-white"
                    : "bg-slate-50 text-slate-600 hover:bg-slate-100 dark:bg-white/5 dark:text-slate-300 dark:hover:bg-white/10"
                }`}
              >
                {PRIORITY_LABEL[p]}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={() => {
              setDraft(item.unblocks.join(", "));
              setMode("unblocks");
            }}
            className="flex min-h-9 w-full items-center rounded-lg px-2 text-left text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-white/5"
          >
            Unblocks…
          </button>
        </div>
      )}

      {open && (mode === "block" || mode === "note") && (
        <div className="absolute right-0 top-10 z-10 w-64 rounded-xl border border-slate-200 bg-white p-2.5 shadow-lg dark:border-white/10 dark:bg-slate-800">
          <label className="mb-1.5 block text-[11px] font-semibold text-slate-500 dark:text-slate-400">
            {mode === "block" ? "Reason for blocking" : "Note"}
          </label>
          <textarea
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={2}
            className="w-full resize-none rounded-lg border border-slate-200 bg-slate-50 p-2 text-xs text-slate-800 focus:border-indigo-400 focus:outline-none dark:border-white/10 dark:bg-slate-900 dark:text-slate-100"
          />
          <div className="mt-2 flex justify-end gap-2">
            <button
              type="button"
              onClick={closeAll}
              className="min-h-9 rounded-lg px-2.5 text-xs font-semibold text-slate-500 hover:bg-slate-50 dark:text-slate-400 dark:hover:bg-white/5"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={!draft.trim()}
              onClick={() => {
                if (mode === "block") onBlock(draft.trim());
                else onNote(draft.trim());
                closeAll();
              }}
              className="min-h-9 rounded-lg bg-indigo-600 px-2.5 text-xs font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
            >
              Save
            </button>
          </div>
        </div>
      )}

      {open && mode === "unblocks" && (
        <div className="absolute right-0 top-10 z-10 w-64 rounded-xl border border-slate-200 bg-white p-2.5 shadow-lg dark:border-white/10 dark:bg-slate-800">
          <label className="mb-1.5 block text-[11px] font-semibold text-slate-500 dark:text-slate-400">
            Unblocks (comma-separated question ids)
          </label>
          <input
            autoFocus
            type="text"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Q5, Q6"
            className="w-full rounded-lg border border-slate-200 bg-slate-50 p-2 text-xs text-slate-800 focus:border-indigo-400 focus:outline-none dark:border-white/10 dark:bg-slate-900 dark:text-slate-100"
          />
          <div className="mt-2 flex justify-end gap-2">
            <button
              type="button"
              onClick={closeAll}
              className="min-h-9 rounded-lg px-2.5 text-xs font-semibold text-slate-500 hover:bg-slate-50 dark:text-slate-400 dark:hover:bg-white/5"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => {
                onUnblocks(
                  draft
                    .split(",")
                    .map((q) => q.trim())
                    .filter(Boolean)
                );
                closeAll();
              }}
              className="min-h-9 rounded-lg bg-indigo-600 px-2.5 text-xs font-semibold text-white hover:bg-indigo-700"
            >
              Save
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
