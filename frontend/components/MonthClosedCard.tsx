"use client";

import { useState } from "react";
import type { useRouter } from "next/navigation";
import { ChevronRight, ChevronUp, X } from "lucide-react";
import type { CompanionItem } from "@/lib/api";

// G168 (Kevin 2026-09-26, variant A "Chip and chevron", /design/month-closed-card):
// the month-closed ("needle") card used to be bare inline markup in
// HomeBrief.tsx's BriefBody (the needle branch, no dismiss at all) and was
// entirely absent from the Penny hub (lib/companionItems.ts's
// isActionableCompanionItem returns false for type "needle", so PennyPage's
// actionable/informational split never surfaced it there). Extracted here so
// both surfaces render the identical card:
//   - Home: dismissible via the standard glass × (DismissChip below), wired
//     by the caller to a REAL server dismiss (api.dismissTodayItem, keyed
//     `needle:<period_end>`) — companion.py already honours that dismissed
//     set for this item type, so this is a genuine two-day suppression, not
//     a local "hide on Home" preference (unlike the advice-card convention
//     in HomeBrief.tsx, there is no separate Penny archive for this card to
//     preserve).
//   - Penny: permanent, minimise-only, never dismiss, mirroring the payday
//     plan's own owner rule (G164). Collapses to a one-line row; the
//     minimised state is remembered locally per item id so it stays
//     collapsed across visits for as long as that period's card exists.

const MINIMISED_STORAGE_KEY = "wd_month_closed_minimised";

function readMinimisedId(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(MINIMISED_STORAGE_KEY);
  } catch {
    return null;
  }
}

function writeMinimisedId(id: string | null): void {
  if (typeof window === "undefined") return;
  try {
    if (id) window.localStorage.setItem(MINIMISED_STORAGE_KEY, id);
    else window.localStorage.removeItem(MINIMISED_STORAGE_KEY);
  } catch {
    // Storage unavailable (private mode / quota) — the card just won't
    // remember its collapsed state across a reload this session.
  }
}

// Dismiss × — the app-wide V2 glass chip (Kevin 2026-08-27, /design/dismiss-x),
// copied verbatim from HomeBrief.tsx's own factored (unexported) DismissChip,
// the same convention PaydayPlanCard.tsx already follows for living outside
// that file. Home only.
function DismissChip({ onClick }: { onClick: (e: React.MouseEvent) => void }) {
  return (
    <button
      type="button"
      aria-label="Dismiss"
      onClick={onClick}
      className="absolute top-2 right-2 z-10 flex h-11 w-11 touch-manipulation items-center justify-center rounded-full [-webkit-tap-highlight-color:transparent] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 focus-visible:ring-offset-white active:scale-95 transition-transform duration-150 motion-reduce:transition-none dark:focus-visible:ring-offset-slate-800"
    >
      <span className="w-7 h-7 flex items-center justify-center rounded-full bg-slate-900/[0.05] dark:bg-white/[0.06] border border-slate-900/[0.06] dark:border-white/10 [@media(hover:hover)]:hover:bg-slate-900/[0.09] dark:[@media(hover:hover)]:hover:bg-white/[0.11] transition-colors duration-150">
        <X size={14} aria-hidden="true" className="text-slate-500 dark:text-slate-300" />
      </span>
    </button>
  );
}

// Minimise chevron — same 44px glass-chip treatment as DismissChip above,
// chevron-up in place of the ×. Penny only: collapses the card, never
// removes it (owner rule, mirrors the payday plan's minimise-not-dismiss
// control, G164).
function MinimiseChip({ onClick }: { onClick: (e: React.MouseEvent) => void }) {
  return (
    <button
      type="button"
      aria-label="Minimise"
      onClick={onClick}
      className="absolute top-2 right-2 z-10 flex h-11 w-11 touch-manipulation items-center justify-center rounded-full [-webkit-tap-highlight-color:transparent] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 focus-visible:ring-offset-white active:scale-95 transition-transform duration-150 motion-reduce:transition-none dark:focus-visible:ring-offset-slate-800"
    >
      <span className="w-7 h-7 flex items-center justify-center rounded-full bg-slate-900/[0.05] dark:bg-white/[0.06] border border-slate-900/[0.06] dark:border-white/10 [@media(hover:hover)]:hover:bg-slate-900/[0.09] dark:[@media(hover:hover)]:hover:bg-white/[0.11] transition-colors duration-150">
        <ChevronUp size={14} aria-hidden="true" className="text-slate-500 dark:text-slate-300" />
      </span>
    </button>
  );
}

export interface MonthClosedCardProps {
  item: CompanionItem;
  router: ReturnType<typeof useRouter>;
  surface: "home" | "penny";
  /**
   * Home only. Called when the dismiss chip is tapped — the caller owns the
   * real persistence (a direct api.dismissTodayItem call, not the
   * localStorage "hide on Home" mechanism other advice cards use, since
   * this needs to be a genuine, server-side, two-day suppression). Ignored
   * on Penny, which never dismisses this card.
   */
  onDismiss?: () => void;
}

export default function MonthClosedCard({ item, router, surface, onDismiss }: MonthClosedCardProps) {
  const [hidden, setHidden] = useState(false);
  const [expanded, setExpanded] = useState<boolean>(() =>
    surface === "home" ? true : readMinimisedId() !== item.id
  );

  if (surface === "home" && hidden) return null;

  function handleDismiss(e: React.MouseEvent) {
    e.stopPropagation();
    setHidden(true);
    onDismiss?.();
  }

  function handleMinimise(e: React.MouseEvent) {
    e.stopPropagation();
    setExpanded(false);
    writeMinimisedId(item.id);
  }

  function handleExpand() {
    setExpanded(true);
    writeMinimisedId(null);
  }

  if (surface === "penny" && !expanded) {
    const label = `${item.headline.replace(/\.$/, "")} ›`;
    return (
      <button
        type="button"
        onClick={handleExpand}
        aria-expanded={false}
        className="glass-card flex min-h-[44px] w-full touch-manipulation items-center justify-between gap-3 rounded-2xl px-4 py-3 text-left [-webkit-tap-highlight-color:transparent] active:scale-[0.99] transition-transform motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
      >
        <span className="min-w-0 truncate text-[15px] font-semibold leading-snug text-slate-900 dark:text-slate-100">
          {label}
        </span>
        <ChevronRight size={16} aria-hidden="true" className="flex-shrink-0 text-slate-400 dark:text-slate-500" />
      </button>
    );
  }

  return (
    <div className="glass-card relative overflow-hidden rounded-2xl p-4 pr-12" aria-expanded={surface === "penny" ? true : undefined}>
      <p className="text-[15px] font-semibold text-slate-700 dark:text-slate-300 leading-snug mb-2">
        {item.headline}
      </p>
      {item.action && (
        <button
          onClick={() => router.push(item.action!.route)}
          className="text-[14px] text-indigo-600 dark:text-indigo-400 font-medium hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 rounded"
        >
          {item.action.label}
        </button>
      )}
      {surface === "home" && <DismissChip onClick={handleDismiss} />}
      {surface === "penny" && <MinimiseChip onClick={handleMinimise} />}
    </div>
  );
}
