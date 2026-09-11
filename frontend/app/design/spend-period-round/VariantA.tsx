"use client";

// VARIANT A — "One ledger, ranked" (G38).
//
// Point of view: the reader's first need on Spend is a single, fast scan of
// every category that moved money this period, ranked by how much it needs
// attention — not two different card systems (a big hero card vs a tile of
// mini-rows) that force the eye to re-learn the layout partway down the
// page. This variant removes the hero/grouped split entirely: "Needs a
// look" and "Also running warm" become ONE list, "Worth a look", built from
// exactly one row shape (NotableRow below) used at every rank. Severity is
// carried by order, a left accent bar, and starting-expanded state, not by
// swapping to a visually different template.
//
// Second need: once a row's detail is open, what caused it and what to do
// about it (pace line, consequence, biggest cause, the one-off/new-normal
// question). Third need: everything that ISN'T worth a look, in one calm
// list using the SAME row grammar so the whole page reads as one system —
// "Looking normal" rows use the identical chip/name/subline/figure+badge
// placement as the ranked list above them, just without the expand affordance.
//
// How this resolves the ticket's named inconsistency: NotableRow places the
// figure and pace badge inline on ONE line (primitives.tsx's FigureBadge)
// for every row, hero-ranked or not — there is only one row template on this
// whole page, so there is structurally nothing left to stack differently.

import { useState } from "react";
import { ChevronDown, ChevronUp, ChevronRight, Target } from "lucide-react";
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

function NotableRow({
  notable,
  colours,
  daysElapsed,
  rank,
  defaultOpen,
}: {
  notable: SpendVerdictNotable;
  colours: Record<string, string>;
  daysElapsed: number;
  rank: number;
  defaultOpen: boolean;
}) {
  const [expanded, setExpanded] = useState(defaultOpen);
  const [resolved, setResolved] = useState<"one_off" | "new_normal" | null>(null);
  const tips = openTipsFor(notable.category, PREVIEW_INSIGHTS);
  const suffix = tipSubline(tips);
  const cause = causeLine(notable.cause);
  const s = notable.payments_count === 1 ? "" : "s";
  const lead = rank === 0;

  return (
    <div>
      {/* Rank 0 gets one whisper eyebrow, not a coloured border — a small
          leading amber dot on a caption line is the documented signifier
          for "this sentence carries a caution" (DESIGN.md: "Figures Are
          Ink; Amber Lives In The Signifier"), reused here instead of a
          side-tab accent bar (a recognisable AI-slop tell). */}
      {lead && (
        <p className="pl-3 pt-2.5 pb-0.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
          <span className="w-1.5 h-1.5 rounded-full bg-amber-400 dark:bg-amber-300 flex-shrink-0" aria-hidden="true" />
          Biggest impact this period
        </p>
      )}
      <button
        type="button"
        onClick={() => setExpanded((e) => !e)}
        aria-expanded={expanded}
        className="w-full min-h-[56px] flex items-center gap-2.5 pl-3 pr-4 py-2.5 text-left active:bg-slate-50 dark:active:bg-slate-700/30 transition-colors"
      >
        <IconChip name={notable.category} colours={colours} size={lead ? 36 : 28} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-slate-800 dark:text-slate-100">{notable.category}</p>
          <p className="mt-0.5 text-[11px] text-slate-600 dark:text-slate-400">
            <MoneyText text={`${notable.payments_count} payment${s} · day ${daysElapsed}${suffix ? ` · ${suffix}` : ""}`} />
          </p>
        </div>
        <FigureBadge
          amount={notable.spent}
          multiple={notable.multiple}
          resolvedLabel={resolved ? (resolved === "one_off" ? "noted · one-off" : "usual updating") : null}
          size={lead ? "lead" : "compact"}
        />
        {expanded ? <ChevronUp size={15} className="text-slate-400 flex-shrink-0" /> : <ChevronDown size={15} className="text-slate-400 flex-shrink-0" />}
      </button>

      <div
        className={`grid transition-[grid-template-rows,opacity] duration-200 ease-out ${expanded ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"}`}
        inert={!expanded}
      >
        <div className="overflow-hidden pl-3 pr-4 pb-3">
          {!resolved && (
            <>
              <p className="text-[12px] text-slate-700 dark:text-slate-300">
                <MoneyText text={paceLine(notable.multiple, notable.excess, daysElapsed)} />
              </p>
              {notable.consequence_line?.text && (
                <p className="mt-1 text-[12px] font-medium text-slate-700 dark:text-slate-200">
                  <MoneyText text={notable.consequence_line.text} />
                </p>
              )}
              {cause && <p className="mt-0.5 text-[12px] text-slate-600 dark:text-slate-400 line-clamp-2"><MoneyText text={cause} /></p>}
            </>
          )}
          <button type="button" onClick={() => {}} className="mt-2 inline-flex items-center gap-0.5 text-[12px] font-semibold text-indigo-600 dark:text-indigo-400">
            See the {notable.payments_count} payment{s}
            <ChevronRight size={14} className="flex-shrink-0" aria-hidden="true" />
          </button>
          {!resolved && PREVIEW_SIGNALS[notable.category] && (
            <div className="mt-2">
              <button
                type="button"
                onClick={() => {}}
                className="min-h-[44px] inline-flex items-center gap-1 text-[12px] font-semibold text-indigo-600 dark:text-indigo-400 active:opacity-70 transition-opacity"
              >
                <Target size={13} className="flex-shrink-0" aria-hidden="true" />
                Set an aim
              </button>
            </div>
          )}
          {!resolved ? (
            <div className="mt-2">
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
          ) : null}
        </div>
      </div>
    </div>
  );
}

function MajorityRow({ row, colours, quietTag }: { row: SpendVerdictMajorityRow; colours: Record<string, string>; quietTag: boolean }) {
  const tips = openTipsFor(row.category, PREVIEW_INSIGHTS);
  const suffix = tipSubline(tips);
  const s = row.payments_count === 1 ? "" : "s";
  return (
    <button type="button" onClick={() => {}} className="w-full min-h-[44px] flex items-center gap-2.5 pl-3 pr-4 py-2.5 text-left active:bg-slate-50 dark:active:bg-slate-700/30 transition-colors">
      <IconChip name={row.category} colours={colours} size={28} />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-slate-800 dark:text-slate-100 truncate">{row.category}</p>
        <p className="text-[11px] text-slate-600 dark:text-slate-400 mt-0.5">
          {row.payments_count} payment{s}
          {quietTag && <span className="text-amber-700 dark:text-amber-300 font-semibold"> · above usual</span>}
          {suffix && <MoneyText text={` · ${suffix}`} />}
        </p>
      </div>
      <span className="flex-shrink-0 text-sm font-bold text-slate-900 dark:text-slate-100 font-mono tabular-nums">{`£${Math.round(row.spent).toLocaleString("en-GB")}`}</span>
      <ChevronRight size={14} className="flex-shrink-0 text-slate-400 dark:text-slate-500" aria-hidden="true" />
    </button>
  );
}

export default function VariantA() {
  const { colours } = useColours();
  const v = SPEND_VERDICT_FIXTURE;
  const ranked = rankNotables(v.notables);
  const quietCategories = new Set(v.quiet_flags.map((q) => q.category));
  const nonZero = v.majority.filter((r) => r.spent > 0);
  const zero = v.majority.filter((r) => r.spent <= 0);

  return (
    <div className="space-y-5">
      <MiscategorisedBanner count={PREVIEW_MISCATEGORISED_COUNT} />

      {ranked.length > 0 && (
        <div>
          <p className="px-1 pb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Worth a look</p>
          <div className="glass-card-flat rounded-2xl overflow-hidden divide-y divide-slate-100 dark:divide-slate-700/50">
            {ranked.map((n, i) => (
              <NotableRow key={n.category} notable={n} colours={colours} daysElapsed={v.period.days_elapsed} rank={i} defaultOpen={i === 0} />
            ))}
          </div>
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
        <div className="glass-card-flat rounded-2xl overflow-hidden divide-y divide-slate-100 dark:divide-slate-700/50">
          {nonZero.map((row) => (
            <MajorityRow key={row.category} row={row} colours={colours} quietTag={quietCategories.has(row.category)} />
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
