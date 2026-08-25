"use client";

import { usePennySheet } from "@/components/PennySheetProvider";
import { BRAND_GRADIENT } from "@/lib/brand";
import PennyMark from "@/components/PennyMark";

const BG = BRAND_GRADIENT;

// The four quick prompts TaxChat.tsx used to open its popup with — carried
// over verbatim so the retirement of that component doesn't lose them.
const QUICK = [
  "How does pension carry-forward work?",
  "What counts as salary sacrifice?",
  "Do I need to register for self-assessment?",
  "How does Gift Aid reduce my tax?",
];

/** Penny's door into tax questions, replacing the retired TaxChat popup
 * (components/TaxChat.tsx, deleted). Same visual grammar as
 * PennyConversation.tsx's PennyPromptBar (glass-card row + gradient Penny
 * chip + quiet placeholder, plus persistent quick-prompt chips underneath),
 * but this one always opens the app-wide Penny sheet
 * (components/PennySheetProvider.tsx) instead of navigating to a page —
 * there's no separate tax chat state any more, an `ask` question there now
 * returns an "explainer" message (see PennyConversation's ExplainerBubble)
 * instead of a verdict. Previously routed to `/penny?compose=1`/`?ask=`
 * before the conversation moved off that page into the sheet (2026-08-25).
 *
 * Rendered in normal document flow at the end of the page content in both
 * places TaxChat used to float (TaxPage.tsx, InsightsPage.tsx's mobile tax
 * tab) — deliberately NOT fixed-position; the floating-popup pattern is
 * exactly what's being retired here. */
export default function TaxPennyEntry() {
  const { open } = usePennySheet();

  return (
    <div className="mt-4">
      <button
        type="button"
        onClick={() => open({ screen: "tax" })}
        className="w-full glass-card rounded-2xl min-h-[44px] px-3.5 py-3 flex items-center gap-2.5 text-left active:scale-[0.99] transition-transform focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
      >
        <span
          className="w-7 h-7 rounded-xl flex items-center justify-center flex-shrink-0"
          style={{ background: BG }}
        >
          <PennyMark size={13} className="text-white" />
        </span>
        <span className="text-[14px] text-slate-500 dark:text-slate-400 truncate">
          Ask Penny about tax&hellip;
        </span>
      </button>

      {/* Quick prompts — 44px chips (the old popup's were py-1.5 and missed
          the target size, don't repeat that here), each opens the sheet
          with the question queued as `ask` rather than a second tap
          through an empty composer. */}
      <div className="mt-2.5 flex flex-wrap gap-2">
        {QUICK.map((q) => (
          <button
            key={q}
            type="button"
            onClick={() => open({ screen: "tax", ask: q })}
            className="min-h-[44px] inline-flex items-center text-[13px] font-medium px-4 rounded-full border border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-700/60 text-slate-600 dark:text-slate-300 active:scale-95 transition-transform focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
          >
            {q}
          </button>
        ))}
      </div>
    </div>
  );
}
