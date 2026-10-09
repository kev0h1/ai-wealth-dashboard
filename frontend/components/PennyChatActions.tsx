"use client";

import { useEffect, useRef, useState } from "react";
import { Ellipsis, History, Plus, SquarePen } from "lucide-react";

/** G248: the "New chat" and "History" actions for the full-screen Penny
 * header, in the three proposed placements. Neutral ink only: the indigo to
 * violet gradient stays on Penny's mark and send button.
 *  - PennyChatToolbar: a labelled row under the title row (pass as `toolbar`).
 *  - PennyChatMenu: one Ellipsis button with a two-row menu (`trailingActions`).
 *  - PennyChatIcons: two icon buttons beside Close (`trailingActions`). */

type Handlers = { onNewChat: () => void; onHistory: () => void };

const text = "inline-flex min-h-11 items-center gap-1.5 rounded-xl px-2 text-[14px] font-semibold text-slate-700 active:opacity-70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:text-slate-200";
const round = "flex min-h-11 min-w-11 items-center justify-center rounded-full text-slate-600 active:scale-90 transition-transform focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:text-slate-300";

export function PennyChatToolbar({ onNewChat, onHistory }: Handlers) {
  return (
    <div data-penny-chat-toolbar className="flex items-center gap-2 px-3">
      <button type="button" onClick={onNewChat} className={text}><Plus size={20} aria-hidden="true" />New chat</button>
      <button type="button" onClick={onHistory} className={text}><History size={20} aria-hidden="true" />History</button>
    </div>
  );
}

export function PennyChatIcons({ onNewChat, onHistory }: Handlers) {
  return (
    <>
      <button type="button" onClick={onNewChat} aria-label="New chat" className={round}><SquarePen size={20} aria-hidden="true" /></button>
      <button type="button" onClick={onHistory} aria-label="History" className={round}><History size={20} aria-hidden="true" /></button>
    </>
  );
}

export function PennyChatMenu({ onNewChat, onHistory }: Handlers) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (event: PointerEvent) => { if (!wrap.current?.contains(event.target as Node)) setOpen(false); };
    const key = (event: KeyboardEvent) => { if (event.key === "Escape") { event.stopPropagation(); setOpen(false); } };
    document.addEventListener("pointerdown", away);
    document.addEventListener("keydown", key, true);
    return () => { document.removeEventListener("pointerdown", away); document.removeEventListener("keydown", key, true); };
  }, [open]);
  const item = "flex min-h-11 w-full items-center gap-2 px-4 text-left text-[14px] font-semibold text-slate-800 active:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-500 dark:text-slate-100 dark:active:bg-slate-700";
  return (
    <div ref={wrap} className="relative">
      <button type="button" aria-label="Chat options" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(v => !v)} className={round}>
        <Ellipsis size={20} aria-hidden="true" />
      </button>
      {open && (
        <div role="menu" aria-label="Chat options" className="absolute right-0 top-full z-20 mt-1 w-44 overflow-hidden rounded-2xl border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-800">
          <button type="button" role="menuitem" className={item} onClick={() => { setOpen(false); onNewChat(); }}><Plus size={18} aria-hidden="true" />New chat</button>
          <button type="button" role="menuitem" className={`${item} border-t border-slate-200/70 dark:border-slate-700`} onClick={() => { setOpen(false); onHistory(); }}><History size={18} aria-hidden="true" />History</button>
        </div>
      )}
    </div>
  );
}
