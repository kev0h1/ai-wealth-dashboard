"use client";

// The active-filter chip vocabulary for the transactions hub
// (app/transactions/TransactionsPage.tsx) — folded in from the G119 design
// round (Kevin's approved pick, "Treatment A (tint)": indigo-50 fill,
// indigo-500 hairline, indigo-700 text, demoted outlined trigger with an
// active dot, 44px chips). Originally built and screenshotted at
// app/design/g119-filter-pill/FilterPillClient.tsx and
// app/design/g119-transactions-live/FilterChips.tsx; both previews now
// import THIS file rather than keeping their own copy, so a screenshot of
// a chip there is a screenshot of the real production markup.
//
// The border is load-bearing: bg-indigo-50 alone measures ~1.00:1 against
// the #f0f2f7 page canvas (no better than the bg-slate-100 pill this
// replaces), so the indigo-500/400 hairline and the indigo-700/300 text are
// what actually make the chip read as a surface — do not drop the border
// "to simplify" (measured 3.99:1 light / 5.98:1 dark against the canvas,
// see this round's own report).
//
// `treatment="legacy"` is kept only so app/design/g119-transactions-live's
// own G119Client.tsx can keep showing Kevin's flagged defect (the
// bg-slate-100 invisible pill) as the reference he compared his pick
// against — it is not used anywhere in production.

import { X, SlidersHorizontal } from "lucide-react";
import type { SearchFilters } from "@/lib/transactionFilters";

export type ChipTreatment = "legacy" | "tint" | "surface";

// Formats the period chip. British English, no em dashes, no arrows — a
// bounded window reads "11 Sept to 24 Sept" (Kevin: "use 'to', not an
// en dash or arrow"), an open-ended lower bound reads "Since 11 Sept" (not
// "From 11 Sept").
export function formatPeriodChip(from: string | null, to: string | null): string {
  const fmt = (iso: string) => {
    const d = new Date(iso + "T00:00:00");
    return d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
  };
  if (from && to) return `${fmt(from)} to ${fmt(to)}`;
  if (from) return `Since ${fmt(from)}`;
  return `Until ${fmt(to!)}`;
}

export interface ChipItem {
  key: "category" | "direction" | "merchant" | "period";
  label: string;
  ariaLabel: string;
  onClear: () => void;
  // "merchant" carried its own indigo tint even before this round (the
  // other three shared one slate tone) — kept only so treatment="legacy"
  // can reproduce that exact, pre-existing asymmetry. Every other
  // treatment renders all four kinds identically; the fix is that every
  // active filter now reads as the same kind of object, not a hierarchy
  // of some chips mattering more than others.
  kind: "primary" | "merchant";
}

export interface BuildChipItemsArgs {
  filters: SearchFilters;
  categoryLabel: string | null;
  onClearCategory: () => void;
  onClearDirection: () => void;
  onClearMerchants: () => void;
  onClearPeriod: () => void;
}

// Ordering and grouping preserved verbatim from TransactionsPage.tsx's own
// original logic: category + label + txn_type clear as ONE unit via
// onClearCategory; a direction chip only ever appears when no category is
// set (mutually exclusive in the UI, not just visually) and clears
// independently via onClearDirection; merchants and the date window each
// clear independently.
export function buildChipItems({
  filters, categoryLabel, onClearCategory, onClearDirection, onClearMerchants, onClearPeriod,
}: BuildChipItemsArgs): ChipItem[] {
  const items: ChipItem[] = [];
  const hasCategory = Boolean(filters.category || (filters.categories && filters.categories.length > 0));
  if (hasCategory) {
    const label = categoryLabel ?? filters.category ?? filters.categories!.join(", ");
    items.push({ key: "category", label, ariaLabel: `Remove ${label} filter`, onClear: onClearCategory, kind: "primary" });
  } else if (filters.txnType) {
    const label = filters.txnType === "debit" ? "Money out" : "Money in";
    items.push({ key: "direction", label, ariaLabel: "Remove direction filter", onClear: onClearDirection, kind: "primary" });
  }
  if (filters.merchants && filters.merchants.length > 0) {
    const label = filters.merchants.length > 1
      ? `${filters.merchants[0]} +${filters.merchants.length - 1}`
      : filters.merchants[0];
    items.push({
      key: "merchant",
      label,
      ariaLabel: `Remove ${filters.merchants.join(", ")} filter`,
      onClear: onClearMerchants,
      kind: "merchant",
    });
  }
  if (filters.from || filters.to) {
    items.push({
      key: "period",
      label: formatPeriodChip(filters.from, filters.to),
      ariaLabel: "Remove period filter, widen to all history",
      onClear: onClearPeriod,
      kind: "primary",
    });
  }
  return items;
}

function chipClasses(treatment: ChipTreatment, kind: ChipItem["kind"]): string {
  if (treatment === "legacy") {
    return kind === "merchant"
      ? "min-h-[28px] px-2 py-0.5 rounded-full bg-indigo-50 dark:bg-indigo-500/10 text-indigo-600 dark:text-indigo-300 text-[11px] font-semibold active:opacity-70 transition-opacity"
      : "min-h-[28px] px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-700/60 text-slate-600 dark:text-slate-300 text-[11px] font-semibold active:opacity-70 transition-opacity";
  }
  if (treatment === "tint") {
    // Selected-state tint (frontend/components/Sidebar.tsx's own
    // active-nav vocabulary), plus the border the fill alone can't
    // supply: indigo-50 fill measures ~1.0:1 against the #f0f2f7 canvas,
    // no better than the slate-100 it replaces, so the boundary that
    // actually makes the pill readable as a surface is the indigo-500
    // (light) / indigo-400 (dark) hairline, which clears WCAG 1.4.11's
    // 3:1 non-text contrast threshold.
    return "min-h-[44px] px-3.5 py-2 rounded-full border border-indigo-500 dark:border-indigo-400 bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300 text-[13px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-1";
  }
  // "surface" — the app's real card material (Card White / Slate Card),
  // the same pattern every other "this is an object" on this canvas uses:
  // shadow-sm in light (the One Shadow Rule), a hairline + tone contrast
  // in dark, never a heavier shadow. Not currently used in production
  // (Kevin picked "tint"), kept for the g119-filter-pill reference preview.
  return "min-h-[44px] px-3.5 py-2 rounded-full border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 text-[13px] font-semibold shadow-sm dark:shadow-none transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-1";
}

// Icon size scales with the chip: legacy's 10px matched its 28px/11px
// chip; the 44px/13px chips this round introduces read better with a
// slightly larger glyph.
function chipIconSize(treatment: ChipTreatment): number {
  return treatment === "legacy" ? 10 : 13;
}

export function FilterChips({
  filters,
  categoryLabel,
  onClearCategory,
  onClearDirection,
  onClearMerchants,
  onClearPeriod,
  onClearAll,
  treatment = "tint",
  className,
}: BuildChipItemsArgs & {
  onClearAll?: () => void;
  treatment?: ChipTreatment;
  className?: string;
}) {
  const items = buildChipItems({ filters, categoryLabel, onClearCategory, onClearDirection, onClearMerchants, onClearPeriod });
  if (items.length === 0) return null;
  const iconSize = chipIconSize(treatment);
  return (
    <div className={`flex items-center gap-1.5 flex-wrap ${className ?? ""}`}>
      {items.map((item) => (
        <button
          key={item.key}
          type="button"
          onClick={item.onClear}
          aria-label={item.ariaLabel}
          className={`flex-shrink-0 inline-flex items-center gap-1 motion-reduce:transition-none ${chipClasses(treatment, item.kind)}`}
        >
          {item.label}
          <X size={iconSize} aria-hidden="true" />
        </button>
      ))}
      {onClearAll && items.length > 1 && (
        <button
          type="button"
          onClick={onClearAll}
          className={
            treatment === "legacy"
              ? "flex-shrink-0 min-h-[28px] px-2 py-0.5 text-[11px] font-semibold text-indigo-600 dark:text-indigo-300 active:opacity-70 transition-opacity"
              : "flex-shrink-0 min-h-[44px] px-3 text-[13px] font-semibold text-indigo-600 dark:text-indigo-300 active:opacity-70 transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-1 rounded-full"
          }
        >
          Clear all
        </button>
      )}
    </div>
  );
}

export type TriggerVariant = "solid" | "ghost";

// The filter-open control. "ghost" is Kevin's pick: a hairline-bordered
// circular button whose only "active" signal is a colour shift plus a
// small dot, never a solid puck (a solid indigo circle read as Penny's FAB
// silhouette in the round he rejected — colour alone, indigo, is fine per
// DESIGN.md; the round shape plus a full solid fill together is what reads
// as "AI lives here"). "solid" is kept only for the g119-transactions-live
// reference preview, which still shows the rejected control for
// comparison; production never uses it.
export function FilterTrigger({
  active,
  onOpen,
  variant = "ghost",
}: {
  active: boolean;
  onOpen: () => void;
  variant?: TriggerVariant;
}) {
  if (variant === "solid") {
    return (
      <button
        type="button"
        onClick={onOpen}
        aria-label="Open filters"
        className={`min-h-[44px] min-w-[44px] flex-shrink-0 flex items-center justify-center rounded-full shadow-sm transition-colors ${
          active ? "bg-indigo-600 text-white" : "bg-white dark:bg-slate-800 text-slate-500 dark:text-slate-300"
        }`}
      >
        <SlidersHorizontal size={17} aria-hidden="true" />
      </button>
    );
  }
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label="Open filters"
      className={`relative min-h-[44px] min-w-[44px] flex-shrink-0 flex items-center justify-center rounded-full border bg-white dark:bg-slate-800 transition-colors motion-reduce:transition-none active:scale-95 motion-reduce:active:scale-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-1 ${
        active
          ? "border-indigo-500 dark:border-indigo-400 text-indigo-600 dark:text-indigo-300"
          : "border-slate-300 dark:border-slate-600 text-slate-500 dark:text-slate-400"
      }`}
    >
      <SlidersHorizontal size={17} aria-hidden="true" />
      {active && (
        <span aria-hidden="true" className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-indigo-600 dark:bg-indigo-400" />
      )}
    </button>
  );
}

// The G119 round's "filter bar" alternative (treatment C: trigger, chips
// and Clear all as one bounded strip) — Kevin picked "tint" instead, so
// this is not used in production. Kept only so the g119-filter-pill
// reference preview can keep showing all three treatments he compared.
export function FilterBar({
  filters,
  categoryLabel,
  onClearCategory,
  onClearDirection,
  onClearMerchants,
  onClearPeriod,
  onClearAll,
  onOpenFilters,
  className,
}: BuildChipItemsArgs & {
  onClearAll: () => void;
  onOpenFilters: () => void;
  className?: string;
}) {
  const items = buildChipItems({ filters, categoryLabel, onClearCategory, onClearDirection, onClearMerchants, onClearPeriod });
  if (items.length === 0) return null;
  return (
    <div
      role="group"
      aria-label="Active filters"
      className={`flex flex-wrap items-center gap-1 rounded-2xl border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 shadow-sm dark:shadow-none pl-1.5 pr-1.5 py-1.5 ${className ?? ""}`}
    >
      <button
        type="button"
        onClick={onOpenFilters}
        aria-label="Open filters"
        className="flex-shrink-0 min-h-[44px] min-w-[44px] flex items-center justify-center rounded-full text-indigo-600 dark:text-indigo-300 transition-colors motion-reduce:transition-none active:scale-95 motion-reduce:active:scale-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-1"
      >
        <SlidersHorizontal size={17} aria-hidden="true" />
      </button>
      <span aria-hidden="true" className="self-stretch w-px my-2 bg-slate-200 dark:bg-slate-600 flex-shrink-0" />
      {items.map((item) => (
        <button
          key={item.key}
          type="button"
          onClick={item.onClear}
          aria-label={item.ariaLabel}
          className="flex-shrink-0 inline-flex items-center gap-1 min-h-[44px] px-2.5 rounded-full text-[13px] font-semibold text-slate-700 dark:text-slate-200 active:bg-slate-100 dark:active:bg-slate-700/60 transition-colors motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-1"
        >
          {item.label}
          <X size={13} aria-hidden="true" />
        </button>
      ))}
      <button
        type="button"
        onClick={onClearAll}
        className="ml-auto flex-shrink-0 min-h-[44px] px-3 rounded-full text-[13px] font-semibold text-indigo-600 dark:text-indigo-300 active:opacity-70 transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-1"
      >
        Clear all
      </button>
    </div>
  );
}
