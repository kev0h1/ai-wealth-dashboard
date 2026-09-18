"use client";

import { Wallet, ChevronRight } from "lucide-react";
import MoneyText from "@/components/MoneyText";
import { titleFor, statusFor, humanizeRaw, fmtC, type SetAsideDisplayInput } from "@/lib/setAsideDisplay";

// The "Set aside this period" list (PlanningPage.tsx's PlansSection), G131
// fold-in of the g124-upcoming-refine design round's variant A ("today's
// shape, kept, with the typography and truncation fixes applied in
// place"). This is the row layout PlanningPage.tsx already had — the
// bounded-card shell, the Wallet chip, the trailing chevron, the
// min-h-[62px] tap target, MoneyText on the detail line for the Money Is
// Mono Rule — with exactly two hygiene fixes now applied in place, both
// from lib/setAsideDisplay.ts: the primary title runs through `titleFor`
// (a bare-number name becomes a small #tag next to a humanised title
// recovered from the feed, rather than showing the bare number as the
// whole title) and the "Fed by …" line runs through `humanizeRaw` (title
// case with a curated acronym list, word-safe truncation, a card-like
// string collapsed to "Brand •• 1234"). Every line that showed before
// still shows.
//
// Shared with the design preview (app/design/g124-upcoming-refine/) so the
// two can't drift — this component takes an already-resolved
// SetAsideDisplayInput per row rather than the raw Allocation/Account API
// shapes, the same "props, not raw fetches" boundary UpcomingHeroCard and
// UpcomingDayCard already use; PlanningPage.tsx does the Allocation +
// Account -> SetAsideItem resolution itself (see its own toSetAsideItem
// helper), and the preview's fixtures are written directly in this shape.
export interface SetAsideItem extends SetAsideDisplayInput {
  id: string;
  createdViaPenny?: boolean;
  /** Appended after the feed label is humanised, never title-cased or
   * truncated with it — production's existing " · similar payments"
   * qualifier for a fuzzy (description_contains) match rule. */
  feedSuffix?: string;
}

function WalletChip() {
  return (
    <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-indigo-50 text-indigo-500 dark:bg-indigo-400/10 dark:text-indigo-300">
      <Wallet size={15} aria-hidden="true" />
    </span>
  );
}

export default function SetAsideList({ items, onEdit }: { items: SetAsideItem[]; onEdit: (id: string) => void }) {
  if (items.length === 0) return null;
  return (
    <div
      className="divide-y divide-slate-100 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm dark:divide-slate-700 dark:border-slate-700 dark:bg-slate-800"
      data-tutorial-id="tutorial-planning-allocations"
    >
      {items.map((a) => {
        const { primary, tag } = titleFor(a);
        const { detail, amount } = statusFor(a);
        const remaining = Math.max(0, a.remaining);
        const complete = a.completed || remaining < 0.5;
        const editLabel = a.pending
          ? (a.pendingStartsLabel ? `starts ${a.pendingStartsLabel}` : "nothing reserved yet")
          : complete
            ? "fully set aside"
            : `${fmtC(remaining)} still to reserve`;
        return (
          <button
            key={a.id}
            type="button"
            onClick={() => onEdit(a.id)}
            aria-label={`${a.name}: ${editLabel}. Edit pay-period plan`}
            className="flex min-h-[62px] w-full items-center gap-3 px-3.5 py-2.5 text-left transition-colors hover:bg-slate-50/80 focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-500 dark:hover:bg-white/[0.035]"
          >
            <WalletChip />
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-1.5">
                <span className="truncate text-sm font-semibold text-slate-900 dark:text-slate-100">{primary}</span>
                {tag && <span className="shrink-0 text-[11px] font-medium text-slate-400 dark:text-slate-500">{tag}</span>}
                {a.createdViaPenny && <span className="shrink-0 text-[10px] text-slate-400 dark:text-slate-500">with Penny</span>}
              </span>
              <MoneyText text={detail} className="mt-0.5 block truncate text-xs text-slate-500 dark:text-slate-400" />
              {a.feedLabel && (
                <span className="mt-0.5 block truncate text-[11px] text-slate-400 dark:text-slate-500" title={a.feedLabel}>
                  Fed by {humanizeRaw(a.feedLabel)}{a.feedSuffix ?? ""}
                </span>
              )}
            </span>
            {amount && (
              <span className="shrink-0 text-right">
                <span className="block font-mono text-sm font-semibold tabular-nums text-slate-900 dark:text-slate-100">{amount}</span>
                <span className="block text-[10px] text-slate-400 dark:text-slate-500">to reserve</span>
              </span>
            )}
            <ChevronRight size={15} className="shrink-0 text-slate-400 dark:text-slate-500" aria-hidden="true" />
          </button>
        );
      })}
    </div>
  );
}
