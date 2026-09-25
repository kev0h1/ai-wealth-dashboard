"use client";

import { useState } from "react";
import { ChevronDown, ChevronUp, WalletCards } from "lucide-react";
import { CardHeader, DismissChip, ReceiptLedger } from "./shared";
import { ACTUAL_COUNT, ACTUAL_MOVES, ACTUAL_TOTAL, LANDED_AT, LANDED_DATE, STAYS_AFTER } from "./fixtures";

export type Surface = "home" | "penny";
export type PreviewState = "row" | "expanded";

const ROW_LABEL = `Split done: £${ACTUAL_TOTAL.toLocaleString("en-GB")} moved across ${ACTUAL_COUNT} standing orders, ${LANDED_DATE}`;

/**
 * Variant B, "Fold" — the row itself IS the disclosure trigger
 * (aria-expanded), the same element whether collapsed or open. There is
 * no separate close/minimise button anywhere (item 1's "never an X" taken
 * furthest: not even a chevron button distinct from the row) — tapping the
 * row again is the only way to collapse it, on both surfaces. Home's
 * dismiss is a small chip beside the row, in the same G-style glass "×"
 * treatment as every other Home card (see HomeBrief.tsx's DismissChip);
 * Penny never renders one, since its plan can never leave the screen,
 * only fold shut.
 */
export default function VariantB({ surface, state }: { surface: Surface; state: PreviewState }) {
  const [expanded, setExpanded] = useState(state === "expanded");
  const [dismissed, setDismissed] = useState(false);

  if (surface === "home" && dismissed) {
    return (
      <p className="rounded-2xl border border-dashed border-slate-300 px-4 py-3 text-[13px] text-slate-400 dark:border-slate-600 dark:text-slate-500">
        Dismissed for this window. (Preview only, nothing is persisted.)
      </p>
    );
  }

  return (
    <div className="glass-card overflow-hidden rounded-2xl">
      <div className="relative">
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          aria-label={`${ROW_LABEL}, ${expanded ? "tap to fold" : "tap for details"}`}
          className={`flex min-h-[44px] w-full touch-manipulation items-center gap-3 px-4 py-3 text-left [-webkit-tap-highlight-color:transparent] active:scale-[0.99] transition-transform motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${surface === "home" ? "pr-14" : ""}`}
        >
          <span aria-hidden="true" className="grid size-8 flex-shrink-0 place-items-center rounded-xl bg-indigo-50 text-indigo-600 dark:bg-indigo-500/15 dark:text-indigo-300">
            <WalletCards size={15} />
          </span>
          <span className="min-w-0 flex-1 text-[15px] font-semibold leading-snug text-slate-900 dark:text-slate-100">{ROW_LABEL}</span>
          {expanded ? (
            <ChevronUp size={16} aria-hidden="true" className="flex-shrink-0 text-slate-400 dark:text-slate-500" />
          ) : (
            <ChevronDown size={16} aria-hidden="true" className="flex-shrink-0 text-slate-400 dark:text-slate-500" />
          )}
        </button>
        {surface === "home" && (
          <DismissChip label="Dismiss" onClick={() => setDismissed(true)} className="absolute right-1 top-1/2 -translate-y-1/2" />
        )}
      </div>

      {expanded && (
        <div className="border-t border-slate-100 px-4 pb-4 pt-3 dark:border-slate-700/70">
          <CardHeader />
          <ReceiptLedger
            salaryName="Premier Current Account"
            salaryProvider="Barclays"
            salaryAmount={4798.08}
            landedAt={LANDED_AT}
            landedDate={LANDED_DATE}
            moves={ACTUAL_MOVES}
            total={ACTUAL_TOTAL}
            stays={STAYS_AFTER}
          />
        </div>
      )}
    </div>
  );
}
