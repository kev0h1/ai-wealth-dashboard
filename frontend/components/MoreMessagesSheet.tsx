"use client";

// Reached from the Penny sheet header's usage-ring crossfade (tap the title
// a second time while it shows the count — see PennySheet.tsx's
// AvatarRingButton) and from the composer's "Get more messages" link once
// the tier hits its monthly cap (PennyConversation.tsx's composer). Ported
// from the approved design preview (app/design/penny-usage-ring/
// MoreMessagesSheet.tsx, variant A2) with real data from
// PennySheetProvider's usePennyUsage() singleton, and wired to close via
// that same file's closeMoreMessagesSheet() rather than local state — the
// two trigger points live in different components (PennySheet.tsx and
// PennyConversation.tsx), so open/closed has to be shared the same way
// usePennySheet() itself already is.
//
// Rendered by PennySheet.tsx as an absolute overlay on top of the existing
// floating panel (header + thread + composer), not as its own portal/sheet
// — see that file's own render for the exact positioning.
//
// Rows are NOT buttons yet (2026-09-06, contract in flight — there is no
// purchase endpoint to call): each shows a muted "Available soon" trailing
// label instead of looking like a live, tappable price row, so nothing here
// reads as broken. Replace with real onClick handlers once a purchase flow
// exists.
//
// Copy rules: no em dashes, British English, "Move to Max" not "upgrade"
// (Kevin's framing, see the design preview's own header comment for why).

import { X } from "lucide-react";
import { usePennyUsage, formatPennyResetDate } from "@/components/PennySheetProvider";

export default function MoreMessagesSheet({ onClose }: { onClose: () => void }) {
  const usage = usePennyUsage();
  const info = usage.info;
  const used = info?.usage.penny_messages ?? 0;
  const limit = info?.usage.penny_limit ?? 0;
  const resetLabel = formatPennyResetDate(usage.resetsOn);
  const topupMessages = info?.topup?.messages ?? 100;
  const topupPrice = info?.topup?.price_gbp;
  // ASSUMPTION (contract doesn't name this key explicitly — flagged in this
  // feature's own report): `prices_gbp` is keyed by SubscriptionTier value,
  // same as every other tier reference in this codebase (SubscriptionTier
  // itself is "statements" | "lite" | "standard" | "connect" | "max"), so
  // the Max tier's own monthly price is `prices_gbp.max`.
  const maxPrice = info?.prices_gbp?.max;
  // Hide the Max row entirely once the user is already on it — there is
  // nothing to move to.
  const onMax = info?.tier === "max";

  return (
    // Backdrop — tapping outside the card closes it, same convention as
    // every other sheet in this app (PennySheet.tsx's own click-catcher,
    // CommitmentSheet.tsx, etc).
    <div
      className="absolute inset-0 z-10 flex flex-col justify-end bg-slate-900/40 p-3 rounded-3xl"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="More Penny messages"
        onClick={(e) => e.stopPropagation()}
        className="w-full glass-sheet rounded-3xl shadow-xl ring-1 ring-black/[0.06] dark:ring-white/[0.12] px-5 pt-4 pb-5 space-y-4"
      >
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-[16px] font-bold text-slate-900 dark:text-slate-100">More Penny messages</h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="w-9 h-9 min-w-[44px] min-h-[44px] -m-2.5 flex items-center justify-center rounded-full bg-slate-100 dark:bg-slate-700 active:scale-90 transition-transform focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
          >
            <X size={15} className="text-slate-500 dark:text-slate-400" />
          </button>
        </div>

        <p className="text-[13px] leading-relaxed text-slate-600 dark:text-slate-300">
          You have used <span className="money">{used}</span> of <span className="money">{limit}</span> this month.
          Your allowance resets on {resetLabel}.
        </p>

        <div className="space-y-2">
          <div className="flex items-center justify-between gap-3 rounded-2xl border border-slate-200 dark:border-slate-700 px-4 py-3 min-h-[44px]">
            <span className="text-[13px] font-medium text-slate-800 dark:text-slate-100 pr-2">
              {topupMessages} more messages, this month only
            </span>
            <span className="flex-shrink-0 flex flex-col items-end gap-0.5">
              {typeof topupPrice === "number" && (
                <span className="font-mono text-[13px] text-slate-900 dark:text-slate-100">£{topupPrice.toFixed(2)}</span>
              )}
              <span className="text-[10px] font-medium uppercase tracking-wide text-slate-400 dark:text-slate-500">
                Available soon
              </span>
            </span>
          </div>
          {!onMax && (
            <div className="flex items-center justify-between gap-3 rounded-2xl border border-slate-200 dark:border-slate-700 px-4 py-3 min-h-[44px]">
              <span className="text-[13px] font-medium text-slate-800 dark:text-slate-100 pr-2">
                Move to Max, 400 a month
              </span>
              <span className="flex-shrink-0 flex flex-col items-end gap-0.5">
                {typeof maxPrice === "number" && (
                  <span className="font-mono text-[13px] text-slate-900 dark:text-slate-100">£{maxPrice.toFixed(2)}</span>
                )}
                <span className="text-[10px] font-medium uppercase tracking-wide text-slate-400 dark:text-slate-500">
                  Available soon
                </span>
              </span>
            </div>
          )}
        </div>

        <p className="text-[11px] leading-snug text-slate-500 dark:text-slate-400">
          Quick questions from the chips are always free.
        </p>
      </div>
    </div>
  );
}
