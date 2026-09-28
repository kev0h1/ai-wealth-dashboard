"use client";

import { useState } from "react";
import { ActionLink, CollapsedRow, DismissChip, GlassCard, MinimiseControl, NEEDLE_ITEM, rowLabelFor } from "./shared";

export type Surface = "home" | "penny";
export type PreviewState = "default" | "minimised";

/**
 * Variant A, "Chip and chevron" — the plainest read of the brief: Home's
 * existing bare card (components/HomeBrief.tsx ~2102-2117, reproduced
 * verbatim below since there is no exported component for it, see this
 * directory's page copy) gains only the standard glass × in its usual
 * top-right slot. Penny renders the identical card, full, in the permanent
 * section under the payday plan, with a chevron-up Minimise in place of the
 * (absent) dismiss — tapping it collapses to the one-line row; tapping the
 * row expands it back.
 */
export default function VariantA({ surface, state }: { surface: Surface; state: PreviewState }) {
  const [dismissed, setDismissed] = useState(false);
  const [expanded, setExpanded] = useState(state !== "minimised");

  if (surface === "home" && dismissed) {
    return (
      <p className="rounded-2xl border border-dashed border-slate-300 px-4 py-3 text-[13px] text-slate-400 dark:border-slate-600 dark:text-slate-500">
        Dismissed for this window. (Preview only, nothing is persisted.)
      </p>
    );
  }

  if (surface === "penny" && !expanded) {
    return <CollapsedRow label={rowLabelFor(NEEDLE_ITEM)} onClick={() => setExpanded(true)} />;
  }

  return (
    <GlassCard className={surface === "home" ? "pr-12" : "pr-12"}>
      <p className="text-[15px] font-semibold text-slate-700 dark:text-slate-300 leading-snug mb-2">
        {NEEDLE_ITEM.headline}
      </p>
      {NEEDLE_ITEM.action && <ActionLink label={NEEDLE_ITEM.action.label} route={NEEDLE_ITEM.action.route} />}
      {surface === "home" ? (
        <DismissChip onClick={() => setDismissed(true)} />
      ) : (
        <MinimiseControl onClick={() => setExpanded(false)} />
      )}
    </GlassCard>
  );
}
