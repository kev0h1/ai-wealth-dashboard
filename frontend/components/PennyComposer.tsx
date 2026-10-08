"use client";

import type { RefObject } from "react";
import { Loader2, Send } from "lucide-react";
import { BRAND_GRADIENT } from "@/lib/brand";

/** Shared production input, send control and caveat. G198: the input is never
 * disabled or readOnly while a reply is pending (Android Chrome closes the
 * keyboard when a focused input turns readOnly or disabled), and the send
 * button never takes focus, so sending keeps the keyboard up like any chat
 * app. Duplicate sends are blocked in the handlers, not on the input. */
export default function PennyComposer({ inputRef, value, onChange, onSend, placeholder, loading, atCap, onMoreMessages }: {
  inputRef: RefObject<HTMLInputElement | null>;
  value: string;
  onChange: (value: string) => void;
  onSend: () => void;
  placeholder: string;
  loading: boolean;
  atCap: boolean;
  onMoreMessages?: () => void;
}) {
  return <>
    <div className="flex items-center gap-2">
      <input
        ref={inputRef} data-penny-input type="text" value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.nativeEvent.isComposing && event.keyCode !== 229 && !loading && !atCap) onSend();
        }}
        placeholder={placeholder} aria-label="Ask Penny a spending question" maxLength={160}
        disabled={atCap}
        className="flex-1 min-w-0 min-h-[44px] text-sm bg-slate-50 dark:bg-slate-700 dark:text-slate-100 rounded-full px-4 py-2 outline-none border border-slate-200 dark:border-slate-600 focus:border-violet-300 disabled:opacity-60"
      />
      <button type="button" onClick={onSend} disabled={!value.trim() || loading || atCap} aria-label="Ask Penny"
        tabIndex={-1}
        onPointerDown={(event) => event.preventDefault()}
        onMouseDown={(event) => event.preventDefault()}
        className="flex-shrink-0 w-11 h-11 rounded-full flex items-center justify-center disabled:opacity-40 text-white active:scale-95 transition-transform"
        style={{ background: BRAND_GRADIENT }}
      >{loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}</button>
    </div>
    <div className="flex items-center justify-between gap-2 mt-1.5">
      <p className="text-[11px] leading-snug text-slate-500 dark:text-slate-400 min-w-0">General information, not regulated financial advice.</p>
      {atCap && onMoreMessages && <button type="button" onClick={onMoreMessages}
        className="flex-shrink-0 text-[11px] font-semibold text-indigo-600 dark:text-indigo-400 underline decoration-dotted underline-offset-2 whitespace-nowrap flex items-center justify-center"
        style={{ minHeight: 44, minWidth: 44, padding: "14px 4px", margin: "-14px -4px -14px 0" }}
      >Get more messages</button>}
    </div>
  </>;
}
