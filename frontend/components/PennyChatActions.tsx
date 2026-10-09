"use client";

import { History, Plus } from "lucide-react";

/** G248 (variant A, Quiet toolbar, approved by Kevin 2026-10-09): the "New
 * chat" and "History" actions, one quiet labelled row under the Ask Penny
 * title row. Pass as PennySheetHeader's `toolbar`. Neutral ink only: the
 * indigo to violet gradient stays on Penny's mark and send button. Hidden
 * with the other secondary rows while the keyboard is up (data-penny-fs-secondary). */
export function PennyChatToolbar({ onNewChat, onHistory }: { onNewChat: () => void; onHistory: () => void }) {
  const text = "inline-flex min-h-11 items-center gap-1.5 rounded-xl px-2 text-[14px] font-semibold text-slate-700 active:opacity-70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:text-slate-200";
  return (
    <div data-penny-chat-toolbar data-penny-fs-secondary className="flex items-center gap-2 px-3">
      <button type="button" onClick={onNewChat} className={text}><Plus size={20} aria-hidden="true" />New chat</button>
      <button type="button" onClick={onHistory} className={text}><History size={20} aria-hidden="true" />History</button>
    </div>
  );
}
