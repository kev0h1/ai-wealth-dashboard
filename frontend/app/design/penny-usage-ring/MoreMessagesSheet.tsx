"use client";

// TEMPORARY PREVIEW — delete after design review.
//
// Mock of the sheet a user reaches from the "Get more messages" link that
// sits next to the composer disclaimer once the Standard tier hits its
// monthly cap (see MockSheetFrame.tsx's avatarRing/A2 composer). Rendered
// two ways by PennyUsageRingClient.tsx: standalone, in its own section
// ("D"), and overlaid inside the A2 mock itself when `?state=cap` or
// `?sheet=1` — see this file's own callers for that wiring.
//
// Both option rows and the close control are visual-only in this preview
// (no onClick side effects beyond the optional `onClose`, which just hides
// the overlay wrapper when this is rendered inside MockSheetFrame.tsx) —
// there is no real purchase flow to wire up here, only the shape of the
// choice a user would be offered.
//
// Copy rules: no em dashes (feedback_no_em_dashes), British English, and
// "Move to Max" rather than "upgrade" (Kevin's framing — the alternative
// isn't positioned as fixing a shortfall, it's a bigger tier).

import { X } from "lucide-react";

export default function MoreMessagesSheet({
  onClose,
  resetDate = "1 Oct",
}: {
  /** Omitted for the standalone section D mock, where there is nothing to
   * dismiss back to — provided only when this is rendered as an overlay
   * inside the A2 mock (MockSheetFrame.tsx). */
  onClose?: () => void;
  resetDate?: string;
}) {
  return (
    <div className="w-full glass-sheet rounded-3xl shadow-xl ring-1 ring-black/[0.06] dark:ring-white/[0.12] px-5 pt-4 pb-5 space-y-4">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-[16px] font-bold text-slate-900 dark:text-slate-100">More Penny messages</h3>
        {onClose ? (
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="w-9 h-9 min-w-[44px] min-h-[44px] -m-2.5 flex items-center justify-center rounded-full bg-slate-100 dark:bg-slate-700 active:scale-90 transition-transform focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
          >
            <X size={15} className="text-slate-500 dark:text-slate-400" />
          </button>
        ) : (
          // Standalone section D has nothing to close back to. Kept as a
          // real (disabled-looking, inert) control rather than removed
          // outright, so this mock's chrome matches the overlay case
          // pixel-for-pixel — a reviewer comparing the two should see the
          // same sheet, not a trimmed-down stand-in.
          <span
            aria-hidden="true"
            className="w-9 h-9 flex items-center justify-center rounded-full bg-slate-100 dark:bg-slate-700 opacity-50"
          >
            <X size={15} className="text-slate-500 dark:text-slate-400" />
          </span>
        )}
      </div>

      <p className="text-[13px] leading-relaxed text-slate-600 dark:text-slate-300">
        You have used <span className="money">150</span> of <span className="money">150</span> this month. Your
        allowance resets on {resetDate}.
      </p>

      <div className="space-y-2">
        <div className="flex items-center justify-between gap-3 rounded-2xl border border-slate-200 dark:border-slate-700 px-4 py-3 min-h-[44px]">
          <span className="text-[13px] font-medium text-slate-800 dark:text-slate-100 pr-2">
            100 more messages, this month only
          </span>
          <span className="flex-shrink-0 font-mono text-[13px] text-slate-900 dark:text-slate-100">£2.99</span>
        </div>
        <div className="flex items-center justify-between gap-3 rounded-2xl border border-slate-200 dark:border-slate-700 px-4 py-3 min-h-[44px]">
          <span className="text-[13px] font-medium text-slate-800 dark:text-slate-100 pr-2">
            Move to Max, 400 a month
          </span>
          <span className="flex-shrink-0 font-mono text-[13px] text-slate-900 dark:text-slate-100">£16.99</span>
        </div>
      </div>

      <p className="text-[11px] leading-snug text-slate-500 dark:text-slate-400">
        Quick questions from the chips are always free.
      </p>
    </div>
  );
}
