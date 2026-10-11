"use client";

import { useLayoutEffect, type KeyboardEvent, type RefObject } from "react";
import { Loader2, Send } from "lucide-react";
import { BRAND_GRADIENT } from "@/lib/brand";

/** G249: question length cap (backend can_i.py enforces the same 500) and the
 * point from which the quiet counter appears. */
export const PENNY_MAX_CHARS = 500;
export const PENNY_COUNTER_FROM = 400;
/** The field grows from one line up to this many lines, then scrolls inside. */
export const PENNY_MAX_LINES = 5;

/** Touch devices: the return key inserts a newline and the send button sends
 * (chat-app convention). Read at key time, so no hook is needed. */
function isCoarsePointer(): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function"
    && window.matchMedia("(pointer: coarse)").matches;
}

/** Auto-growing textarea. Height is measured, never assumed: it resets to auto,
 * reads scrollHeight, clamps to PENNY_MAX_LINES lines and scrolls inside past
 * that. Empties back to one line after a send or clear. */
function PennyComposerField({ inputRef, value, onChange, onKeyDown, placeholder, disabled }: {
  inputRef: RefObject<HTMLTextAreaElement | null>;
  value: string;
  onChange: (value: string) => void;
  onKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
  placeholder: string;
  disabled: boolean;
}) {
  useLayoutEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    const cs = window.getComputedStyle(el);
    const lineHeight = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.4;
    const chrome = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom)
      + parseFloat(cs.borderTopWidth) + parseFloat(cs.borderBottomWidth);
    const max = Math.ceil(lineHeight * PENNY_MAX_LINES + chrome);
    el.style.height = "auto";
    const full = el.scrollHeight + parseFloat(cs.borderTopWidth) + parseFloat(cs.borderBottomWidth);
    el.style.height = `${Math.min(full, max)}px`;
    el.style.overflowY = full > max ? "auto" : "hidden";
  }, [value, inputRef]);
  return <textarea
    ref={inputRef} data-penny-input rows={1} value={value}
    onChange={(event) => onChange(event.target.value)}
    onKeyDown={onKeyDown}
    placeholder={placeholder} aria-label="Ask Penny a spending question" maxLength={PENNY_MAX_CHARS}
    disabled={disabled} enterKeyHint="enter"
    className="flex-1 min-w-0 min-h-[44px] resize-none overflow-y-hidden text-sm leading-5 bg-slate-50 dark:bg-slate-700 dark:text-slate-100 rounded-[22px] px-4 py-[11px] outline-none border border-slate-200 dark:border-slate-600 focus:border-violet-300 disabled:opacity-60"
  />;
}

/** Shared production input, send control and caveat. G198: the input is never
 * disabled or readOnly while a reply is pending (Android Chrome closes the
 * keyboard when a focused input turns readOnly or disabled), and the send
 * button never takes focus, so sending keeps the keyboard up like any chat
 * app. Duplicate sends are blocked in the handlers, not on the input. */
export default function PennyComposer({ inputRef, value, onChange, onSend, placeholder, loading, atCap, onMoreMessages, chatFull }: {
  inputRef: RefObject<HTMLTextAreaElement | null>;
  value: string;
  onChange: (value: string) => void;
  onSend: () => void;
  placeholder: string;
  loading: boolean;
  atCap: boolean;
  onMoreMessages?: () => void;
  /** G248: this conversation has reached its turn cap. Replaces the input row
   * with the notice and a New chat action. Absent (the default), the composer
   * renders exactly as before. */
  chatFull?: { notice: string; actionLabel: string; onAction: () => void };
}) {
  return <>
    {chatFull ? <div data-penny-chat-full className="flex items-center justify-between gap-3">
      <p role="status" className="min-w-0 text-sm leading-5 text-slate-700 dark:text-slate-200">{chatFull.notice}</p>
      <button type="button" onClick={chatFull.onAction}
        className="flex-shrink-0 min-h-[44px] rounded-xl bg-indigo-600 px-4 text-sm font-semibold text-white active:scale-95 transition-transform hover:bg-indigo-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-slate-900">
        {chatFull.actionLabel}
      </button>
    </div> : <div className="flex items-end gap-2">
      <PennyComposerField
        inputRef={inputRef} value={value} onChange={onChange} placeholder={placeholder} disabled={atCap}
        onKeyDown={(event) => {
          if (event.key !== "Enter" || event.nativeEvent.isComposing || event.keyCode === 229) return;
          // Touch: return is a newline (default). Desktop: Shift+Enter is a newline, Enter sends.
          if (event.shiftKey || isCoarsePointer()) return;
          event.preventDefault();
          if (!loading && !atCap) onSend();
        }}
      />
      <button type="button" onClick={onSend} disabled={!value.trim() || loading || atCap} aria-label="Ask Penny"
        tabIndex={-1}
        onPointerDown={(event) => event.preventDefault()}
        onMouseDown={(event) => event.preventDefault()}
        className="flex-shrink-0 w-11 h-11 rounded-full flex items-center justify-center disabled:opacity-40 text-white active:scale-95 transition-transform"
        style={{ background: BRAND_GRADIENT }}
      >{loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}</button>
    </div>}
    <div className="flex items-center justify-between gap-2 mt-1.5">
      <p className="text-[11px] leading-snug text-slate-500 dark:text-slate-400 min-w-0">General information, not regulated financial advice.</p>
      {!chatFull && value.length >= PENNY_COUNTER_FROM && <span data-penny-counter aria-live="polite"
        className="flex-shrink-0 text-[11px] leading-snug tabular-nums text-slate-500 dark:text-slate-400">{value.length}/{PENNY_MAX_CHARS}</span>}
      {atCap && onMoreMessages && <button type="button" onClick={onMoreMessages}
        className="flex-shrink-0 text-[11px] font-semibold text-indigo-600 dark:text-indigo-400 underline decoration-dotted underline-offset-2 whitespace-nowrap flex items-center justify-center"
        style={{ minHeight: 44, minWidth: 44, padding: "14px 4px", margin: "-14px -4px -14px 0" }}
      >Get more messages</button>}
    </div>
  </>;
}
