"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { EllipsisVertical, Trash2, X } from "lucide-react";
import type { PennyConversationSummary } from "@/lib/api";
import {
  HISTORY_EMPTY, HISTORY_RETENTION_NOTE, formatHistoryDate, isHistoryToday,
} from "@/lib/pennyHistoryFormat";

/** G248: Penny's chat history. An in-flow, full-height column meant to replace
 * the conversation inside the Penny panel (so the dialog, its focus trap and
 * the G244 close path are untouched): the host hides the thread and composer,
 * it does not unmount them, and shows this instead. Row styles are the three
 * proposed art directions:
 *  - "ledger": date beside the title, a visible bin on every row.
 *  - "overflow": roomier rows, a trailing options button that reveals Delete.
 *  - "sections": rows grouped under TODAY and EARLIER, a visible bin.
 * Deleting is deferred for 5 seconds with Undo (the app's toast-with-undo
 * grammar), and committed at once if the sheet closes. Neutral ink throughout:
 * no red, no Penny gradient. */
export type PennyHistoryRowStyle = "ledger" | "overflow" | "sections";

const iconButton = "inline-flex min-h-11 min-w-11 items-center justify-center rounded-full text-slate-500 active:scale-90 transition-transform focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:text-slate-400";

export default function PennyHistorySheet({
  conversations, activeId, rowStyle = "ledger", onResume, onDelete, onClose, footer, now,
}: {
  conversations: PennyConversationSummary[];
  /** The chat currently open, marked "Current". */
  activeId?: string | null;
  rowStyle?: PennyHistoryRowStyle;
  onResume: (id: string) => void;
  onDelete: (id: string) => void;
  onClose: () => void;
  /** Optional footer, e.g. the "Open my last chat" row. */
  footer?: ReactNode;
  /** Fixed clock for previews and tests. */
  now?: Date;
}) {
  const [pending, setPending] = useState<{ id: string } | null>(null);
  const [openOptions, setOpenOptions] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingRef = useRef<string | null>(null);
  const onDeleteRef = useRef(onDelete);
  useEffect(() => { onDeleteRef.current = onDelete; }, [onDelete]);

  // Commit a pending delete if the sheet goes away before the 5 seconds end.
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
    if (pendingRef.current) onDeleteRef.current(pendingRef.current);
  }, []);

  function commit() {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    const id = pendingRef.current;
    pendingRef.current = null;
    setPending(null);
    if (id) onDeleteRef.current(id);
  }

  function requestDelete(id: string) {
    if (pendingRef.current) commit();
    pendingRef.current = id;
    setPending({ id });
    setOpenOptions(null);
    timer.current = setTimeout(commit, 5000);
  }

  function undo() {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    pendingRef.current = null;
    setPending(null);
  }

  const shown = conversations.filter((c) => c.id !== pending?.id);
  const clock = now ?? new Date();

  const row = (c: PennyConversationSummary) => {
    const date = formatHistoryDate(c.updated_at ?? c.created_at, clock);
    const roomy = rowStyle === "overflow";
    return (
      <li key={c.id} className="border-b border-slate-200/70 last:border-b-0 dark:border-slate-700">
        <div className="flex items-stretch">
          <button
            type="button"
            onClick={() => onResume(c.id)}
            className={`min-w-0 flex-1 px-5 text-left active:opacity-70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-500 ${roomy ? "py-4" : "py-3"}`}
          >
            <span className="flex items-baseline justify-between gap-3">
              <span className="min-w-0 truncate text-[14px] font-semibold text-slate-900 dark:text-slate-100">{c.title}</span>
              {!roomy && <span className="flex-shrink-0 text-[12px] text-slate-500 dark:text-slate-400">{date}</span>}
            </span>
            {roomy && <span className="mt-0.5 block text-[12px] text-slate-500 dark:text-slate-400">{date}</span>}
            {c.preview && <span className={`block truncate text-[14px] text-slate-600 dark:text-slate-300 ${roomy ? "mt-1" : "mt-0.5"}`}>{c.preview}</span>}
            {c.id === activeId && <span className="mt-1 block text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">Current</span>}
          </button>
          {rowStyle === "overflow" ? (
            <button type="button" aria-label={`Options for ${c.title}`} aria-expanded={openOptions === c.id}
              onClick={() => setOpenOptions(openOptions === c.id ? null : c.id)} className={`${iconButton} mr-2 self-center`}>
              <EllipsisVertical size={20} aria-hidden="true" />
            </button>
          ) : (
            <button type="button" aria-label={`Delete chat: ${c.title}`} onClick={() => requestDelete(c.id)} className={`${iconButton} mr-2 self-center`}>
              <Trash2 size={20} aria-hidden="true" />
            </button>
          )}
        </div>
        {rowStyle === "overflow" && openOptions === c.id && (
          <div className="px-5 pb-3">
            <button type="button" onClick={() => requestDelete(c.id)}
              className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-slate-200 px-3 text-[14px] font-semibold text-slate-800 active:scale-95 transition-transform focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:border-slate-600 dark:text-slate-100">
              <Trash2 size={16} aria-hidden="true" />Delete chat
            </button>
          </div>
        )}
      </li>
    );
  };

  const today = shown.filter((c) => isHistoryToday(c.updated_at ?? c.created_at, clock));
  const earlier = shown.filter((c) => !today.includes(c));
  const label = (text: string) => <h3 className="px-5 pb-1 pt-4 text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">{text}</h3>;

  return (
    <div data-penny-history className="flex min-h-0 flex-1 flex-col bg-white text-slate-900 dark:bg-slate-900 dark:text-slate-100">
      <div className="flex-shrink-0 border-b border-slate-200/70 pt-3 dark:border-slate-700">
        <div className="flex items-center justify-between gap-2 px-5 pb-2">
          <h2 className="text-[16px] font-bold">History</h2>
          <button type="button" onClick={onClose} aria-label="Close history"
            className="flex min-h-11 min-w-11 items-center justify-center rounded-full bg-slate-100 active:scale-90 transition-transform focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:bg-slate-700">
            <X size={15} className="text-slate-500 dark:text-slate-400" aria-hidden="true" />
          </button>
        </div>
        <p className="px-5 pb-3 text-[12px] leading-5 text-slate-500 dark:text-slate-400">{HISTORY_RETENTION_NOTE}</p>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        {shown.length === 0 ? (
          <p className="px-5 py-6 text-[14px] text-slate-600 dark:text-slate-300">{HISTORY_EMPTY}</p>
        ) : rowStyle === "sections" ? (
          <>
            {today.length > 0 && <>{label("Today")}<ul>{today.map(row)}</ul></>}
            {earlier.length > 0 && <>{label("Earlier")}<ul>{earlier.map(row)}</ul></>}
          </>
        ) : (
          <ul>{shown.map(row)}</ul>
        )}
      </div>

      {pending && (
        <div role="status" aria-live="polite" className="flex flex-shrink-0 items-center justify-between gap-3 border-t border-slate-200/70 px-5 py-1 text-[14px] dark:border-slate-700">
          <span>Chat deleted</span>
          <button type="button" onClick={undo}
            className="min-h-11 px-2 text-[14px] font-semibold text-indigo-600 active:opacity-70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:text-indigo-400">Undo</button>
        </div>
      )}

      {footer && <div className="flex-shrink-0 border-t border-slate-200/70 dark:border-slate-700">{footer}</div>}
    </div>
  );
}
