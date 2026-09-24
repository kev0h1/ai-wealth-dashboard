"use client";

// G131 fold-in note (Kevin approved variant A + the cluster interval rule,
// 2026-09-18): the bounded day-card shell, the divider/marker grammar and
// the cluster-interval algorithm are now the SAME production pieces
// PlanningPage.tsx renders — UpcomingDayCard, UpcomingDivider and
// computeClusterMarkers below are imported, not reimplemented, so those
// three can't drift from what shipped. See each one's own doctrine
// comment (components/upcoming/UpcomingDayCard.tsx,
// components/upcoming/UpcomingDivider.tsx, lib/upcomingMarkers.ts).
//
// What's still fixture-only, disclosed prominently rather than presented as
// proof of the shipped page: the ROW itself (`Row` below). PlanningPage.tsx's
// `renderRow` is a large, page-scoped closure over ~10 pieces of live state
// and business logic (the risk walk that decides flagged/timingRisk,
// `whyOpen` disclosure state, the planned/predicted edit sheets, dismiss and
// skip handlers, the highlight-and-scroll target) — extracting it into a
// standalone props-only component is a real refactor beyond this fold-in's
// scope, not something reasonably done alongside the hero/day-card/marker
// work. `Row` below is a hand-authored visual match against representative
// fixtures, kept in sync by hand, not an import. Its settling treatment
// (the ONLY thing this file changed row-wise for G131) mirrors
// PlanningPage.tsx's corrected version: the long "Left earlier today, still
// settling" line under the payment name is gone, and the right-hand slot
// under the figure reads "Settling" (capitalised) where a live row's
// "After: £X left" caption sits.
//
// The "gap" and "rhythm" interval rules, and the switcher that compared all
// three, are gone from this preview as of the fold-in — Kevin picked
// "cluster" (G127, 2026-09-18), and per the brief neither losing rule nor
// the switcher ships anywhere, including here.
//
// G133 (regression fix, 2026-09-19): `Row` still stays a hand-authored
// fixture match for the reasons above, but its swipe-to-dismiss wrap no
// longer does. SwipeDismissRow was a self-contained, props-only component
// (no coupling to PlanningPage's live state) even before this fix, so it
// has been extracted to components/upcoming/SwipeDismissRow.tsx and is now
// imported here verbatim, the same instance PlanningPage.tsx renders. This
// closes the actual gap G133 exposed: a mid-swipe screenshot of this
// preview previously could not have caught the transparent-sliding-layer
// regression, because the preview never wrapped its rows in the reveal at
// all. It does now, so the reveal-occlusion contract between
// SwipeDismissRow and whatever surface hosts it is exercised here going
// forward. Dismissal here just hides the fixture row locally (dismissedIds
// below); no backend or shared state involved.
import { useState } from "react";
import { AlertTriangle, AlertCircle, Clock } from "lucide-react";
import { useColours } from "@/components/ColourProvider";
import { getCategoryColour } from "@/lib/categories";
import { useCategoryIcons } from "@/components/IconProvider";
import { getCategoryIcon } from "@/lib/categoryIcons";
import { computeClusterMarkers } from "@/lib/upcomingMarkers";
import UpcomingDayCard from "@/components/upcoming/UpcomingDayCard";
import UpcomingDivider from "@/components/upcoming/UpcomingDivider";
import SwipeDismissRow from "@/components/upcoming/SwipeDismissRow";
import type { PreviewItem } from "./fixtures";

const sym = "£";

interface DayGroup {
  word?: "Today" | "Tomorrow";
  dateLabel: string;
  dayOffset: number;
  dayKeyIso: string;
  nextPeriod: boolean;
  active: PreviewItem[];
  settling: PreviewItem[];
}

function groupItems(items: PreviewItem[]): DayGroup[] {
  const groups: DayGroup[] = [];
  for (const item of items) {
    let g = groups.find((g) => g.dayKeyIso === item.dayKeyIso);
    if (!g) {
      g = {
        word: item.dayLabel,
        dateLabel: item.dateLabel,
        dayOffset: item.dayOffset,
        dayKeyIso: item.dayKeyIso,
        nextPeriod: !!item.nextPeriod,
        active: [],
        settling: [],
      };
      groups.push(g);
    }
    if (item.isSettling) g.settling.push(item);
    else g.active.push(item);
  }
  return groups.sort((a, b) => a.dayOffset - b.dayOffset);
}

function headingText(g: DayGroup): string {
  return g.word ? `${g.word} · ${g.dateLabel}` : g.dateLabel;
}

function Row({ item }: { item: PreviewItem }) {
  const { colours } = useColours();
  const { icons: iconOverrides } = useCategoryIcons();
  const colour = getCategoryColour(item.category, colours);
  const Icon = getCategoryIcon(item.category, iconOverrides);

  return (
    <div className="flex items-center gap-3 px-4 py-3">
      {item.flagged ? (
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-rose-100 text-rose-500 dark:bg-rose-900/40" aria-hidden="true">
          <AlertTriangle size={14} />
        </span>
      ) : item.timingRisk ? (
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-amber-100 text-amber-500 dark:bg-amber-900/40 dark:text-amber-400" aria-hidden="true">
          <AlertCircle size={14} />
        </span>
      ) : item.isSettling ? (
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-400 dark:bg-slate-800 dark:text-slate-500" aria-hidden="true">
          <Clock size={14} />
        </span>
      ) : (
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg" style={{ backgroundColor: `${colour}26` }} aria-hidden="true">
          <Icon size={15} style={{ color: colour }} />
        </span>
      )}

      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-1.5">
          <p className="truncate text-sm font-medium text-slate-800 dark:text-slate-100">{item.name}</p>
          {item.planned && <span className="shrink-0 rounded-md bg-indigo-50 px-1.5 py-0.5 text-[10px] font-semibold text-indigo-600 dark:bg-indigo-900/30 dark:text-indigo-400">planned</span>}
          {!item.planned && item.edited && <span className="shrink-0 rounded-md bg-indigo-50 px-1.5 py-0.5 text-[10px] font-semibold text-indigo-600 dark:bg-indigo-900/30 dark:text-indigo-400">edited</span>}
        </div>
        {item.accountLabel && (
          <p className="truncate text-xs text-slate-400 dark:text-slate-500">{item.accountLabel}</p>
        )}
        {/* G131 correction — the long "Left earlier today, still settling"
            line that used to sit here is gone. This reversed an earlier
            reading of Kevin's instruction that had removed the right-hand
            "Settling" caption instead and kept this line; his 2026-09-18
            correction is precise: this line goes, the right-hand slot
            below the figure stays. */}
      </div>

      <div className="shrink-0 text-right">
        {/* The Money Is Mono Rule collision fix: the live row glues the
            estimate tilde straight onto the sign ("−~£99.80"), which is
            also two leading sigils MoneyText's own currency-token regex
            only expects one of (`[~−+-]?£`) — the fix separates the
            estimate flag from the figure instead of gluing a second sign
            onto it, so the amount itself always tokenises as one clean
            mono figure. */}
        <p className={`font-mono text-base tabular-nums ${
          item.type === "income" ? "font-bold text-emerald-500" :
          item.flagged ? "font-bold text-rose-600 dark:text-rose-400" :
          item.isSettling ? "font-semibold text-slate-500 dark:text-slate-400" :
          "font-bold text-slate-800 dark:text-slate-100"
        }`}>
          {item.type === "income" ? "+" : "−"}{sym}{item.amount.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
        </p>
        {item.amountBasis === "balance_estimate" && (
          <p className="text-[10px] font-medium text-slate-400 dark:text-slate-500">estimated</p>
        )}
        {/* G131 correction — "Settling" (capitalised) is the ONE right-hand
            status word a settling row carries now, in the same slot
            "After: £X left" occupies on a live row. It used to render
            nothing here (null) while carrying the long descriptive line
            under the payment name instead — the opposite of what shipped;
            see PlanningPage.tsx's own corrected renderRow. */}
        {item.isSettling ? (
          <p className="text-xs font-medium text-slate-400 dark:text-slate-500">Settling</p>
        ) : item.poolNote ? (
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400">{item.poolNote}</p>
        ) : item.balanceAfter != null ? (
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
            After: <span className="font-mono tabular-nums">{item.balanceAfter >= 0 ? "" : "−"}{sym}{Math.abs(item.balanceAfter).toLocaleString("en-GB", { maximumFractionDigits: 0 })}</span> {item.balanceAfter < 0 ? "short" : "left"}
          </p>
        ) : null}
      </div>
    </div>
  );
}

export default function DayGroups({ items, paydayLabel }: { items: PreviewItem[]; paydayLabel: string }) {
  // G133: local-only dismiss so the preview's swipe reveal has somewhere
  // to go, matching production's "row slides off, then resolves" shape
  // without wiring any real deletion.
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(new Set());
  const visibleItems = items.filter((item) => !dismissedIds.has(item.id));
  const groups = groupItems(visibleItems);
  const markers = computeClusterMarkers(
    groups.map((g) => ({ dayOffset: g.dayOffset, dayKeyIso: g.dayKeyIso, itemCount: g.active.length + g.settling.length }))
  );
  let paydayDividerInserted = false;
  const nodes: React.ReactNode[] = [];

  for (const g of groups) {
    const isPaydaySeam = g.nextPeriod && !paydayDividerInserted;
    const marker = markers.find((m) => m.beforeDayKeyIso === g.dayKeyIso);

    if (isPaydaySeam) {
      nodes.push(
        <UpcomingDivider
          key="payday-boundary"
          label={`Next pay period · from ${paydayLabel}`}
          ariaLabel={`Next pay period, from ${paydayLabel}`}
          sublabel={marker?.label}
        />
      );
      paydayDividerInserted = true;
    } else if (marker) {
      nodes.push(<UpcomingDivider key={`marker-${marker.beforeDayKeyIso}`} label={marker.label} />);
    }

    nodes.push(
      <UpcomingDayCard
        key={g.dayKeyIso}
        dayKeyIso={g.dayKeyIso}
        heading={headingText(g)}
        activeRows={g.active.map((item) => (
          <SwipeDismissRow
            key={item.id}
            label={item.planned ? "Delete" : "Not recurring"}
            onDismiss={() => setDismissedIds((prev) => new Set(prev).add(item.id))}
          >
            <Row item={item} />
          </SwipeDismissRow>
        ))}
        settlingRows={g.settling.map((item) => (
          <SwipeDismissRow
            key={item.id}
            label={item.planned ? "Delete" : "Not recurring"}
            onDismiss={() => setDismissedIds((prev) => new Set(prev).add(item.id))}
          >
            <Row item={item} />
          </SwipeDismissRow>
        ))}
      />
    );
  }

  return <div className="space-y-3">{nodes}</div>;
}
