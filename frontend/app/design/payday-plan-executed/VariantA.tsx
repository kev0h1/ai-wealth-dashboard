"use client";

import { useState } from "react";
import {
  CardHeader,
  ExecutedRow,
  GlassCard,
  MinimiseControl,
  QuietDismissText,
  ReceiptLedger,
} from "./shared";
import { ACTUAL_COUNT, ACTUAL_MOVES, ACTUAL_TOTAL, LANDED_AT, LANDED_DATE, STAYS_AFTER } from "./fixtures";

export type Surface = "home" | "penny";
export type PreviewState = "row" | "expanded";

const ROW_LABEL = `Split done: £${ACTUAL_TOTAL.toLocaleString("en-GB")} moved across ${ACTUAL_COUNT} standing orders, ${LANDED_DATE} ›`;

/**
 * Variant A, "Receipt" — the expanded card reads as a bank-statement-style
 * receipt: what landed, what moved, what stayed, all past tense. Penny's
 * header carries only the chevron-up Minimise (item 1: never an X); Home's
 * header carries the same Minimise plus a separate, quiet "Dismiss" text
 * control in the footer (item 2: a real, whole-component dismiss distinct
 * from minimise). Both surfaces start from the same corrected row (item
 * 4): £3,170 across 7 standing orders, not the plan's own £2,725/3.
 */
export default function VariantA({ surface, state }: { surface: Surface; state: PreviewState }) {
  const [expanded, setExpanded] = useState(state === "expanded");
  const [dismissed, setDismissed] = useState(false);

  if (surface === "home" && dismissed) {
    return (
      <p className="rounded-2xl border border-dashed border-slate-300 px-4 py-3 text-[13px] text-slate-400 dark:border-slate-600 dark:text-slate-500">
        Dismissed for this window. (Preview only, nothing is persisted.)
      </p>
    );
  }

  if (!expanded) {
    return (
      <ExecutedRow
        label={ROW_LABEL}
        onExpand={() => setExpanded(true)}
        dismissible={surface === "home"}
        onDismiss={() => setDismissed(true)}
      />
    );
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
      {surface === "home" && (
        <div className="-mx-4 -mb-4 mt-4 flex items-center justify-end border-t border-slate-100 bg-slate-50/80 px-4 py-3 dark:border-slate-700/70 dark:bg-slate-900/25">
          <QuietDismissText onClick={() => setDismissed(true)} />
        </div>
      )}
    </GlassCard>
  );
}
