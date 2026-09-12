"use client";

// VARIANT B — "Tiered dashboard, unified row" (G38).
//
// Point of view: today's three-tier structure (a full hero card for the one
// thing that needs a look most, a grouped tile of compact peers below it,
// then the calm majority list) is the RIGHT information architecture —
// ranking by severity is a real, useful signal, and collapsing it into one
// flat list (Variant A) loses that at-a-glance "is there one big thing or
// several small ones" read. What's wrong today is only that the header ROW
// inside the hero card and a mini-row's header ROW are two separately
// hand-drawn templates that happen to place the figure and its pace badge
// differently. This variant keeps the three-tier structure and fixes that
// structurally rather than cosmetically — the hero card's header and a
// mini-row's header are now literally the same component (NotableRow below,
// two sizes) sharing one FigureBadge primitive, so the two can never drift
// into two different grammars again (G53 moved that shared primitive's
// figure+badge from inline to stacked-and-right-aligned, matching the
// shipped hero card's own layout — this variant picked up that change for
// free precisely because there is only one component to change). A thin
// amber top rule (not a card-size difference alone) now carries the "this
// is the one that matters most" signal, since the header row itself no
// longer looks meaningfully different at the two sizes.
//
// Reader's order: 1) is there one thing that needs a look, and what's the
// story (hero, always expanded) 2) what else is running warm, one tap away
// 3) everything calm, in one list using the same figure/badge placement.

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

function splitNotables(notables: SpendVerdictNotable[]): { hero: SpendVerdictNotable | null; rest: SpendVerdictNotable[] } {
  if (notables.length === 0) return { hero: null, rest: [] };
  const sorted = [...notables].sort((a, b) => b.multiple - a.multiple || b.spent - a.spent);
  return { hero: sorted[0], rest: sorted.slice(1) };
}

// ONE row molecule, two sizes ("lead" for the hero, "compact" for a mini-row
// or a majority row) — this IS the fix: there is only one place in this
// file's code where a figure sits next to a badge, so the two densities can
// never disagree on inline-vs-stacked again.
function NotableRow({
  notable,
  colours,
  daysElapsed,
  size,
  expanded,
  onToggle,
}: {
  notable: SpendVerdictNotable;
  colours: Record<string, string>;
  daysElapsed: number;
  size: "lead" | "compact";
  expanded: boolean;
  onToggle: () => void;
}) {
  const [resolved, setResolved] = useState<"one_off" | "new_normal" | null>(null);
  const tips = openTipsFor(notable.category, PREVIEW_INSIGHTS);
  const suffix = tipSubline(tips);
  const cause = causeLine(notable.cause);
  const s = notable.payments_count === 1 ? "" : "s";
  const lead = size === "lead";

  return (
    <div>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        className={`w-full flex items-center gap-2.5 text-left active:bg-slate-50 dark:active:bg-slate-700/30 transition-colors ${
          lead ? "min-h-[56px] px-4 py-3" : "min-h-[44px] pl-4 pr-5 py-2.5"
        }`}
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
          size={size}
        />
        {lead ? null : expanded ? <ChevronUp size={15} className="text-slate-400 flex-shrink-0" /> : <ChevronDown size={15} className="text-slate-400 flex-shrink-0" />}
      </button>

      <div
        className={`grid transition-[grid-template-rows,opacity] duration-200 ease-out ${expanded ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"}`}
        inert={!expanded}
      >
        <div className={`overflow-hidden ${lead ? "px-4 pb-4" : "px-4 pb-3"}`}>
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
              <button type="button" onClick={() => {}} className="min-h-[44px] inline-flex items-center gap-1 text-[12px] font-semibold text-indigo-600 dark:text-indigo-400 active:opacity-70 transition-opacity">
                <Target size={13} className="flex-shrink-0" aria-hidden="true" />
                Set an aim
              </button>
            </div>
          )}
          {!resolved && (
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
          )}
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
    <button type="button" onClick={() => {}} className="w-full min-h-[44px] flex items-center gap-2.5 pl-4 pr-5 py-2.5 text-left active:bg-slate-50 dark:active:bg-slate-700/30 transition-colors">
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

export default function VariantB() {
  const { colours } = useColours();
  const v = SPEND_VERDICT_FIXTURE;
  const { hero, rest } = splitNotables(v.notables);
  const [expandedRest, setExpandedRest] = useState<string | null>(null);
  const quietCategories = new Set(v.quiet_flags.map((q) => q.category));
  const nonZero = v.majority.filter((r) => r.spent > 0);
  const zero = v.majority.filter((r) => r.spent <= 0);

  return (
    <div className="space-y-5">
      <MiscategorisedBanner count={PREVIEW_MISCATEGORISED_COUNT} />

      {hero && (
        <section className="glass-card-flat rounded-2xl overflow-hidden">
          {/* A small leading amber dot on the section's own whisper label
              carries "this is the one that matters most" now that the
              header row below is the same molecule a mini-row uses — the
              documented signifier (DESIGN.md: "Figures Are Ink; Amber Lives
              In The Signifier") rather than a border-on-rounded-corner
              accent (a clashing combination flagged on an earlier draft). */}
          <p className="px-4 pt-3 pb-0.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
            <span className="w-1.5 h-1.5 rounded-full bg-amber-400 dark:bg-amber-300 flex-shrink-0" aria-hidden="true" />
            Needs a look
          </p>
          <NotableRow notable={hero} colours={colours} daysElapsed={v.period.days_elapsed} size="lead" expanded onToggle={() => {}} />
        </section>
      )}

      {rest.length > 0 && (
        <div className="glass-card-flat rounded-2xl overflow-hidden">
          <p className="px-4 pt-3 pb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Also running warm</p>
          <div className="divide-y divide-slate-100 dark:divide-slate-700/50">
            {rest.map((n) => (
              <NotableRow
                key={n.category}
                notable={n}
                colours={colours}
                daysElapsed={v.period.days_elapsed}
                size="compact"
                expanded={expandedRest === n.category}
                onToggle={() => setExpandedRest((c) => (c === n.category ? null : n.category))}
              />
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
