"use client";

import { useState } from "react";
import { Check } from "lucide-react";
import { CardHeader, DismissChip, ExecutedRow, GlassCard, MinimiseControl, ReceiptLedger } from "./shared";
import { ACTUAL_COUNT, ACTUAL_MOVES, ACTUAL_TOTAL, LANDED_AT, LANDED_DATE, STAYS_AFTER } from "./fixtures";

export type Surface = "home" | "penny";
export type PreviewState = "row" | "expanded";

const CELEBRATION_LINE = `Your standing orders split £${ACTUAL_TOTAL.toLocaleString("en-GB")} across ${ACTUAL_COUNT} accounts this morning.`;
const PENNY_ROW_LABEL = `Split done: £${ACTUAL_TOTAL.toLocaleString("en-GB")} moved across ${ACTUAL_COUNT} standing orders, ${LANDED_DATE} ›`;

/**
 * Variant C, "Celebration line" — Home drops the expandable card entirely
 * for this state: Upcoming already lists the standing orders that fired
 * (no-app-artefacts rule), so a completed split earns one calm, dismissible
 * line rather than a report to open. The tick uses Verified Emerald
 * (DESIGN.md: "positive money... verified"), a small signifier only, never
 * a flooded background. Penny keeps the full past-tense receipt behind its
 * usual row, with a chevron-up Minimise and no dismiss (its plan can never
 * leave the screen).
 */
export default function VariantC({ surface, state }: { surface: Surface; state: PreviewState }) {
  const [expanded, setExpanded] = useState(state === "expanded");
  const [dismissed, setDismissed] = useState(false);

  if (surface === "home") {
    if (dismissed) {
      return (
        <p className="rounded-2xl border border-dashed border-slate-300 px-4 py-3 text-[13px] text-slate-400 dark:border-slate-600 dark:text-slate-500">
          Dismissed for this window. (Preview only, nothing is persisted.)
        </p>
      );
    }
    return (
      <div className="flex items-center gap-3 rounded-2xl border border-slate-100 bg-white px-4 py-3 shadow-sm dark:border-slate-700 dark:bg-slate-800">
        <span aria-hidden="true" className="grid size-8 flex-shrink-0 place-items-center rounded-full bg-emerald-50 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-400">
          <Check size={16} />
        </span>
        <p className="min-w-0 flex-1 text-[14px] leading-snug text-slate-700 dark:text-slate-200">{CELEBRATION_LINE}</p>
        <DismissChip label="Dismiss" onClick={() => setDismissed(true)} className="flex-shrink-0" />
      </div>
    );
  }

  // Penny: same row → full-card behaviour as the other variants, just with
  // this variant's card content (identical ledger, chevron-up minimise).
  if (!expanded) {
    return <ExecutedRow label={PENNY_ROW_LABEL} onExpand={() => setExpanded(true)} />;
  }

  return (
    <GlassCard>
      <CardHeader right={<MinimiseControl onClick={() => setExpanded(false)} />} />
      <ReceiptLedger
        salaryName="Premier Current Account"
        salaryProvider="Barclays"
        salaryAmount={4798.08}
        landedAt={LANDED_AT}
        landedDate={LANDED_DATE}
        moves={ACTUAL_MOVES}
        total={ACTUAL_TOTAL}
        stays={STAYS_AFTER}
      />
    </GlassCard>
  );
}
