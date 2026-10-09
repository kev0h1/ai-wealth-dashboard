"use client";

import Toggle from "@/components/Toggle";
import { OPEN_LAST_CHAT_HELPER, OPEN_LAST_CHAT_LABEL } from "@/lib/pennyHistoryFormat";

/** G248: the "Open my last chat" switch. One component for both homes, the
 * history sheet footer and the Settings Penny card, so the two can never read
 * differently. Uses the app's Toggle; a failed save passes `saveError`, shown
 * as ink with a small amber dot (never a coloured sentence). */
export default function PennyOpenLastChatRow({ checked, onChange, saveError, className = "", inset = "sheet" }: {
  checked: boolean;
  onChange: (next: boolean) => void;
  saveError?: string | null;
  className?: string;
  /** "sheet" lines up with the Penny sheet's 20px inset; "card" with Settings' 16px. */
  inset?: "sheet" | "card";
}) {
  const px = inset === "card" ? "px-4" : "px-5";
  return (
    <div className={className}>
      <div className={`flex items-center justify-between gap-3 py-3 ${px}`}>
        <div className="min-w-0">
          <p className="text-[14px] font-medium text-slate-800 dark:text-slate-100">{OPEN_LAST_CHAT_LABEL}</p>
          <p className="mt-0.5 text-[12px] text-slate-500 dark:text-slate-400">{OPEN_LAST_CHAT_HELPER}</p>
        </div>
        <Toggle checked={checked} onChange={() => onChange(!checked)} label={OPEN_LAST_CHAT_LABEL} />
      </div>
      {saveError && (
        <p role="status" aria-live="polite" className={`flex items-start gap-1.5 pb-3 text-xs font-medium text-slate-600 dark:text-slate-300 ${px}`}>
          <span aria-hidden="true" className="mt-1 size-1.5 shrink-0 rounded-full bg-amber-500 dark:bg-amber-400" />
          <span>{saveError}</span>
        </p>
      )}
    </div>
  );
}
