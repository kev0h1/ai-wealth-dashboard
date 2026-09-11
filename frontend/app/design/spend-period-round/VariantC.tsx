"use client";

// VARIANT C — "The sentence leads, a strip of evidence follows" (G38).
//
// Point of view: the boldest of the three. Today's page opens on an
// instrument (Out/In/Moved figures) with the verdict sentence relegated to
// a caption underneath it (per DESIGN.md's "Instrument Header" — untouched
// by this round, reused as-is below). This variant argues the reader's
// FIRST need on Spend is not a second set of numbers, it's the one-sentence
// answer ("running about £1,586 ahead of usual, mostly Bills"); everything
// below exists only to back that sentence up. So the reading gets its own
// headline-weight line directly under the instrument, no card chrome. Their
// SECOND need is "which categories made that true" — answered as a single
// horizontally-scrolling strip of compact attention cards (the hero and
// every warm notable as equal-family peers, the hero simply first and
// slightly wider), rather than a vertically stacked hero-card-then-tile.
// Tapping a card opens ONE shared detail panel below the strip for whichever
// card is selected (a master/detail split, not per-card inline expansion).
// Third need, once the story is told: everything calm, compressed into a
// quiet two-column tile grid rather than a tall list, since by this point
// in the page nothing there is asking for attention.
//
// How this resolves the ticket's named inconsistency: AttentionCard (below)
// is the ONE card template used for every notable regardless of rank —
// bigger padding for the lead card, identical internal layout otherwise —
// and its figure+badge pair is always inline under the category name,
// never stacked in a separate row grid. There is only one place in this
// file where a figure meets a badge.

import { useState } from "react";
import { ChevronRight, Target } from "lucide-react";
import MoneyText from "@/components/MoneyText";
import { useColours } from "@/components/ColourProvider";
import SpendShapeCard from "@/components/SpendShapeCard";
import type { SpendVerdictNotable, SpendVerdictMajorityRow } from "@/lib/api";
import { openTipsFor, tipSubline } from "@/lib/spendTips";
import { IconChip, FigureBadge, paceLine, causeLine } from "./primitives";
import { MiscategorisedBanner, UnresolvedAskCard, MoneyMovedAccordion } from "./SecondaryCards";
import {
  SPEND_VERDICT_FIXTURE,
  PREVIEW_ACCOUNTS,
  PREVIEW_INSIGHTS,
  PREVIEW_MISCATEGORISED_COUNT,
  PREVIEW_MONEY_SHAPE,
  PREVIEW_SIGNALS,
} from "./fixtures";

function rankNotables(notables: SpendVerdictNotable[]): SpendVerdictNotable[] {
  return [...notables].sort((a, b) => b.multiple - a.multiple || b.spent - a.spent);
}

function AttentionCard({
  notable,
  colours,
  lead,
  selected,
  onSelect,
}: {
  notable: SpendVerdictNotable;
  colours: Record<string, string>;
  lead: boolean;
  selected: boolean;
  onSelect: () => void;
}) {
  const tips = openTipsFor(notable.category, PREVIEW_INSIGHTS);
  const suffix = tipSubline(tips);
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={`flex-shrink-0 snap-start rounded-2xl text-left transition-colors ${lead ? "w-[168px] p-4" : "w-[144px] p-3"} ${
        selected ? "glass-card-flat ring-2 ring-indigo-500" : "glass-card-flat"
      }`}
    >
      <IconChip name={notable.category} colours={colours} size={lead ? 36 : 28} />
      <p className="mt-2 text-sm font-semibold text-slate-800 dark:text-slate-100 truncate">{notable.category}</p>
      {/* The figure and its pace badge sit on ONE line under the name,
          exactly like every other row on this page — the actual fix, just
          applied inside a card shape instead of a list row. */}
      <div className="mt-1">
        <FigureBadge amount={notable.spent} multiple={notable.multiple} size={lead ? "lead" : "compact"} />
      </div>
      {suffix && (
        <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400 truncate">
          <MoneyText text={suffix} />
        </p>
      )}
    </button>
  );
}

function DetailPanel({ notable, daysElapsed }: { notable: SpendVerdictNotable; daysElapsed: number }) {
  const [resolved, setResolved] = useState<"one_off" | "new_normal" | null>(null);
  const cause = causeLine(notable.cause);
  const s = notable.payments_count === 1 ? "" : "s";
  return (
    <div className="glass-card-flat rounded-2xl p-4">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
        {notable.category} · {notable.payments_count} payment{s} · day {daysElapsed}
      </p>
      {!resolved ? (
        <>
          <p className="mt-1.5 text-[13px] text-slate-700 dark:text-slate-300">
            <MoneyText text={paceLine(notable.multiple, notable.excess, daysElapsed)} />
          </p>
          {notable.consequence_line?.text && (
            <p className="mt-1 text-[13px] font-medium text-slate-700 dark:text-slate-200">
              <MoneyText text={notable.consequence_line.text} />
            </p>
          )}
          {cause && <p className="mt-0.5 text-[13px] text-slate-600 dark:text-slate-400"><MoneyText text={cause} /></p>}
        </>
      ) : (
        <p className="mt-1.5 text-[13px] text-slate-700 dark:text-slate-300">{resolved === "one_off" ? "Noted as a one-off." : "Filed as your new normal."}</p>
      )}
      <button type="button" onClick={() => {}} className="mt-2 inline-flex items-center gap-0.5 text-[12px] font-semibold text-indigo-600 dark:text-indigo-400">
        See the {notable.payments_count} payment{s}
        <ChevronRight size={14} className="flex-shrink-0" aria-hidden="true" />
      </button>
      {!resolved && PREVIEW_SIGNALS[notable.category] && (
        <div className="mt-2">
          <button type="button" onClick={() => {}} className="min-h-[44px] inline-flex items-center gap-1 text-[12px] font-semibold text-indigo-600 dark:text-indigo-400 active:opacity-70 transition-opacity">
            <Target size={13} className="flex-shrink-0" aria-hidden="true" />
            Set an aim
          </button>
        </div>
      )}
      {!resolved && (
        <div className="mt-3 pt-3 border-t border-slate-100 dark:border-slate-700/60">
          <p className="text-[12px] text-slate-600 dark:text-slate-400">{notable.prior_intent?.question ?? "Was this a one-off, or the new normal?"}</p>
          <div className="mt-1.5 flex items-center gap-2">
            <button type="button" onClick={() => setResolved("one_off")} className="flex-1 min-h-[44px] rounded-xl border border-slate-300 dark:border-slate-500 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 text-xs font-semibold active:scale-95 transition-transform">
              One-off
            </button>
            <button type="button" onClick={() => setResolved("new_normal")} className="flex-1 min-h-[44px] rounded-xl border border-slate-300 dark:border-slate-500 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 text-xs font-semibold active:scale-95 transition-transform">
              New normal
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function CalmTile({ row, colours, quietTag }: { row: SpendVerdictMajorityRow; colours: Record<string, string>; quietTag: boolean }) {
  const tips = openTipsFor(row.category, PREVIEW_INSIGHTS);
  const suffix = tipSubline(tips);
  return (
    <button type="button" onClick={() => {}} className="min-h-[44px] glass-card-flat rounded-xl p-2.5 text-left active:bg-slate-50 dark:active:bg-slate-700/30 transition-colors">
      <div className="flex items-center gap-2">
        <IconChip name={row.category} colours={colours} size={24} />
        <span className="min-w-0 flex-1 text-[13px] font-semibold text-slate-800 dark:text-slate-100 truncate">{row.category}</span>
      </div>
      <p className="mt-1.5 text-sm font-bold text-slate-900 dark:text-slate-100 font-mono tabular-nums">{`£${Math.round(row.spent).toLocaleString("en-GB")}`}</p>
      <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
        {quietTag && <span className="text-amber-700 dark:text-amber-300 font-semibold">above usual</span>}
        {!quietTag && suffix && <MoneyText text={suffix} />}
        {!quietTag && !suffix && `${row.payments_count} payment${row.payments_count === 1 ? "" : "s"}`}
      </p>
    </button>
  );
}

export default function VariantC() {
  const { colours } = useColours();
  const v = SPEND_VERDICT_FIXTURE;
  const ranked = rankNotables(v.notables);
  const [selected, setSelected] = useState<string | null>(ranked[0]?.category ?? null);
  const selectedNotable = ranked.find((n) => n.category === selected) ?? ranked[0] ?? null;
  const quietCategories = new Set(v.quiet_flags.map((q) => q.category));
  const nonZero = v.majority.filter((r) => r.spent > 0);
  const zero = v.majority.filter((r) => r.spent <= 0);

  return (
    <div className="space-y-5">
      {/* The sentence leads — Headline weight, no card, directly answering
          "am I okay" before any figure asks the reader to do arithmetic. */}
      <div className="px-1">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">This period</p>
        <p className="mt-1 text-xl font-bold leading-snug text-slate-900 dark:text-slate-100 text-pretty">
          <MoneyText text={v.reading} />
        </p>
      </div>

      <MiscategorisedBanner count={PREVIEW_MISCATEGORISED_COUNT} />

      {ranked.length > 0 && (
        <div>
          <p className="px-1 pb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Worth a look</p>
          <div className="flex gap-2.5 overflow-x-auto snap-x snap-mandatory pb-1 -mx-4 px-4">
            {ranked.map((n, i) => (
              <AttentionCard key={n.category} notable={n} colours={colours} lead={i === 0} selected={selected === n.category} onSelect={() => setSelected(n.category)} />
            ))}
          </div>
          {selectedNotable && <div className="mt-3"><DetailPanel notable={selectedNotable} daysElapsed={v.period.days_elapsed} /></div>}
        </div>
      )}

      {v.unresolved.largest && (
        <UnresolvedAskCard
          largest={v.unresolved.largest}
          paymentsCount={v.unresolved.payments_count}
          unresolvedTotal={v.unresolved.total}
          periodOut={v.pills.spent}
          accountName={PREVIEW_ACCOUNTS[0]?.name}
        />
      )}

      <div>
        <p className="px-1 pb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-400">
          LOOKING NORMAL · £{Math.round(nonZero.reduce((s, r) => s + r.spent, 0)).toLocaleString("en-GB")} across {nonZero.length} categories
        </p>
        <div className="grid grid-cols-2 gap-2">
          {nonZero.map((row) => (
            <CalmTile key={row.category} row={row} colours={colours} quietTag={quietCategories.has(row.category)} />
          ))}
        </div>
        {zero.length > 0 && (
          <p className="mt-2 px-1 text-[11px] text-slate-600 dark:text-slate-400">Nothing in {zero.map((r) => r.category).join(" or ")} yet</p>
        )}
      </div>

      <MoneyMovedAccordion moved={v.moved} />

      <SpendShapeCard shape={PREVIEW_MONEY_SHAPE} hideValues={false} onOpen={() => {}} />
    </div>
  );
}
