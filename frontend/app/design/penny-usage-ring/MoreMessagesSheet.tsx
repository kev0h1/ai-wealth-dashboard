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
// B11 (docs/pricing/tiering-unit-economics-mcp-2026-09.md section 9):
// mocks the three packs, good/better/best, that replaced the single
// £2.99/100-message row on the real sheet. `packsBoughtThisMonth` mirrors
// GET /subscription's `usage.penny_packs_bought_this_month` — pass 2+ (see
// this route's own `?packs=2` flag) to preview the Move to Max row leading
// instead of trailing.
//
// Copy rules: no em dashes (feedback_no_em_dashes), British English, and
// "Move to Max" rather than "upgrade" (Kevin's framing — the alternative
// isn't positioned as fixing a shortfall, it's a bigger tier).

import { X } from "lucide-react";

const PACKS = [
  { id: "small", messages: 20, price_gbp: 0.99, badge: null as string | null },
  { id: "medium", messages: 100, price_gbp: 2.99, badge: "Most popular" },
  { id: "large", messages: 200, price_gbp: 4.99, badge: "Best value" },
];

function PackRow({ pack }: { pack: (typeof PACKS)[number] }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-2xl border border-slate-200 dark:border-slate-700 px-4 py-3 min-h-[44px]">
      <span className="flex items-center gap-2 min-w-0 pr-2">
        <span className="text-[13px] font-medium text-slate-800 dark:text-slate-100">{pack.messages} messages</span>
        {pack.badge && (
          <span className="flex-shrink-0 text-[10px] font-semibold uppercase tracking-wide text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-500/15 rounded-full px-2 py-0.5">
            {pack.badge}
          </span>
        )}
      </span>
      <span className="flex-shrink-0 font-mono text-[13px] text-slate-900 dark:text-slate-100">£{pack.price_gbp.toFixed(2)}</span>
    </div>
  );
}

const MAX_ROW = (
  <div className="flex items-center justify-between gap-3 rounded-2xl border border-slate-200 dark:border-slate-700 px-4 py-3 min-h-[44px]">
    <span className="text-[13px] font-medium text-slate-800 dark:text-slate-100 pr-2">
      Move to Max, 400 a month
    </span>
    <span className="flex-shrink-0 font-mono text-[13px] text-slate-900 dark:text-slate-100">£16.99</span>
  </div>
);

export default function MoreMessagesSheet({
  onClose,
  resetDate = "1 Oct",
  packsBoughtThisMonth = 0,
}: {
  /** Omitted for the standalone section D mock, where there is nothing to
   * dismiss back to — provided only when this is rendered as an overlay
   * inside the A2 mock (MockSheetFrame.tsx). */
  onClose?: () => void;
  resetDate?: string;
  /** Mirrors usage.penny_packs_bought_this_month — 2+ makes Move to Max
   * lead, packs trail below it. */
  packsBoughtThisMonth?: number;
}) {
  const maxLeads = packsBoughtThisMonth >= 2;
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
        {maxLeads ? (
          <>
            {MAX_ROW}
            {PACKS.map((pack) => <PackRow key={pack.id} pack={pack} />)}
          </>
        ) : (
          <>
            {PACKS.map((pack) => <PackRow key={pack.id} pack={pack} />)}
            {MAX_ROW}
          </>
        )}
      </div>

      <p className="text-[11px] leading-snug text-slate-500 dark:text-slate-400">
        Packs last 90 days and are used after your monthly allowance. Quick questions from the chips are always free.
      </p>
    </div>
  );
}
